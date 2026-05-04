use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use walkdir::WalkDir;

static DISCORD_CLIENT: OnceLock<StdMutex<Option<DiscordIpcClient>>> = OnceLock::new();

fn discord_slot() -> &'static StdMutex<Option<DiscordIpcClient>> {
    DISCORD_CLIENT.get_or_init(|| StdMutex::new(None))
}

fn discord_connect_internal() -> Result<(), String> {
    let cfg = load_config();
    let app_id = match cfg.discord_app_id {
        Some(s) if !s.is_empty() => s,
        _ => return Err("Discord App ID nao configurado".into()),
    };
    let mut slot = discord_slot().lock().unwrap();
    if let Some(mut existing) = slot.take() {
        let _ = existing.close();
    }
    let mut client = DiscordIpcClient::new(&app_id).map_err(|e| format!("discord new: {}", e))?;
    client.connect().map_err(|e| format!("discord connect: {}", e))?;
    *slot = Some(client);
    Ok(())
}

#[tauri::command]
fn discord_connect() -> Result<bool, String> {
    match discord_connect_internal() {
        Ok(_) => Ok(true),
        Err(e) => {
            eprintln!("discord_connect: {}", e);
            Ok(false)
        }
    }
}

#[tauri::command]
fn discord_set_app_id(app_id: Option<String>) -> Result<bool, String> {
    let mut cfg = load_config();
    cfg.discord_app_id = app_id.filter(|s| !s.is_empty());
    save_config(cfg)?;
    Ok(discord_connect_internal().is_ok())
}

#[tauri::command]
fn discord_set_activity(game_name: String, system_name: String) -> Result<(), String> {
    // tenta conectar se nao conectou ainda
    {
        let slot = discord_slot().lock().unwrap();
        if slot.is_none() {
            drop(slot);
            let _ = discord_connect_internal();
        }
    }
    let mut slot = discord_slot().lock().unwrap();
    let Some(client) = slot.as_mut() else {
        return Ok(()); // silently noop se Discord nao roda
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let details_text = format!("Jogando {}", game_name);
    let state_text = format!("via Playbox · {}", system_name);
    let activity = Activity::new()
        .details(&details_text)
        .state(&state_text)
        .assets(Assets::new().large_image("playbox").large_text("Playbox Launcher"))
        .timestamps(Timestamps::new().start(now));
    if let Err(e) = client.set_activity(activity) {
        eprintln!("discord set_activity: {}", e);
        // se falhou, fecha o client pra reconectar na proxima
        let _ = client.close();
        *slot = None;
    }
    Ok(())
}

#[tauri::command]
fn discord_clear_activity() -> Result<(), String> {
    let mut slot = discord_slot().lock().unwrap();
    if let Some(client) = slot.as_mut() {
        let _ = client.clear_activity();
    }
    Ok(())
}

static RUNNING_GAME: OnceLock<Arc<StdMutex<Option<Child>>>> = OnceLock::new();
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

fn running_game_slot() -> Arc<StdMutex<Option<Child>>> {
    RUNNING_GAME
        .get_or_init(|| Arc::new(StdMutex::new(None)))
        .clone()
}

fn kill_running_game_inner() -> bool {
    let slot = running_game_slot();
    let mut guard = slot.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        true
    } else {
        false
    }
}

fn restore_launcher_window() {
    if let Some(handle) = APP_HANDLE.get() {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        let _ = handle.emit("game-killed", ());
    }
}

const IGDB_CLIENT_ID: &str = "38rn80svjsf19scuehrre8h7ncc6mz";
const IGDB_CLIENT_SECRET: &str = "wdfhgu9mfdjvvgujtwlferztkq6ocs";

#[derive(Debug, Clone)]
struct EmulatorConfig {
    id: &'static str,
    name: &'static str,
    color: &'static str,
    folder_name: &'static str,
    /// Caminho relativo ao emulators_root (ex: "YUZU EA/yuzu.exe")
    emulator_rel: &'static str,
    extensions: &'static [&'static str],
    launch_args: &'static [&'static str],
    igdb_platform: u32,
}

const EMULATORS: &[EmulatorConfig] = &[
    EmulatorConfig {
        id: "switch",
        name: "NINTENDO SWITCH",
        color: "#e60012",
        folder_name: "SWITCH",
        emulator_rel: "YUZU EA\\yuzu-windows-msvc-early-access\\yuzu.exe",
        extensions: &["nsp", "xci"],
        launch_args: &["-f", "-g"],
        igdb_platform: 130,
    },
    EmulatorConfig {
        id: "wiiu",
        name: "WII U",
        color: "#00b4d8",
        folder_name: "WII U",
        emulator_rel: "CEMU\\Cemu_2.6\\Cemu.exe",
        extensions: &["wud", "wux", "rpx", "wua"],
        launch_args: &["-f", "-g"],
        igdb_platform: 41,
    },
    EmulatorConfig {
        id: "wii",
        name: "WII",
        color: "#0094d9",
        folder_name: "WII",
        emulator_rel: "DOLPHIN\\Dolphin.exe",
        extensions: &["iso", "wbfs", "rvz", "wad"],
        launch_args: &["-b", "-e"],
        igdb_platform: 5,
    },
    EmulatorConfig {
        id: "gc",
        name: "GAMECUBE",
        color: "#6c4ab6",
        folder_name: "GAMECUBE",
        emulator_rel: "DOLPHIN\\Dolphin.exe",
        extensions: &["iso", "gcm", "rvz", "gcz"],
        launch_args: &["-b", "-e"],
        igdb_platform: 21,
    },
    EmulatorConfig {
        id: "n64",
        name: "NINTENDO 64",
        color: "#22c55e",
        folder_name: "N64",
        emulator_rel: "N64\\Project64.exe",
        extensions: &["n64", "z64", "v64", "rom"],
        launch_args: &[],
        igdb_platform: 4,
    },
    EmulatorConfig {
        id: "gba",
        name: "GAME BOY ADVANCE",
        color: "#a855f7",
        folder_name: "GBA",
        emulator_rel: "GBA\\mGBA.exe",
        extensions: &["gba", "zip"],
        launch_args: &["-f"],
        igdb_platform: 24,
    },
    EmulatorConfig {
        id: "ps3",
        name: "PLAYSTATION 3",
        color: "#003791",
        folder_name: "PS3",
        emulator_rel: "RPCS3\\rpcs3.exe",
        extensions: &["iso", "pkg", "bin"],
        launch_args: &["--no-gui"],
        igdb_platform: 9,
    },
    EmulatorConfig {
        id: "ps4",
        name: "PLAYSTATION 4",
        color: "#00439c",
        folder_name: "PS4",
        emulator_rel: "PS4\\shadPS4.exe",
        extensions: &["pkg", "bin"],
        launch_args: &["-g"],
        igdb_platform: 48,
    },
    EmulatorConfig {
        id: "ps2",
        name: "PLAYSTATION 2",
        color: "#1d4ed8",
        folder_name: "PS2",
        emulator_rel: "PCSX2\\pcsx2-qt.exe",
        extensions: &["iso", "chd", "cue", "bin"],
        launch_args: &["-fullscreen", "-batch", "--"],
        igdb_platform: 8,
    },
    EmulatorConfig {
        id: "ps1",
        name: "PLAYSTATION",
        color: "#7c3aed",
        folder_name: "PS1",
        emulator_rel: "DUCKSTATION\\duckstation-qt-x64-ReleaseLTCG.exe",
        extensions: &["cue", "bin", "chd", "pbp", "iso"],
        launch_args: &["-fullscreen"],
        igdb_platform: 7,
    },
    EmulatorConfig {
        id: "xbox",
        name: "XBOX",
        color: "#107c10",
        folder_name: "XBOX",
        emulator_rel: "XBOX\\xemu.exe",
        extensions: &["iso", "xiso"],
        launch_args: &[],
        igdb_platform: 11,
    },
    EmulatorConfig {
        id: "retro",
        name: "RETRO",
        color: "#f59e0b",
        folder_name: "RETRO",
        emulator_rel: "RETROARCH\\retroarch.exe",
        extensions: &["nes", "sfc", "smc", "n64", "z64", "gba", "gb", "gbc", "md", "gen", "zip"],
        launch_args: &[],
        igdb_platform: 0,
    },
];

/// Caminhos sao resolvidos em ordem de prioridade:
/// 1. Config customizada (user selecionou outra pasta)
/// 2. Pasta "emulators" ao lado do .exe (caso instalador tenha bundlado)
/// 3. <Documents>\EMULADORES\ROMS EMULADORES (legacy / dev)
fn resolve_emulators_root(custom: Option<&str>) -> PathBuf {
    if let Some(c) = custom {
        let p = PathBuf::from(c);
        if p.is_dir() { return p; }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("emulators");
            if bundled.is_dir() { return bundled; }
        }
    }
    if let Some(docs) = dirs::document_dir() {
        return docs.join("EMULADORES").join("ROMS EMULADORES");
    }
    PathBuf::from("EMULADORES").join("ROMS EMULADORES")
}

fn resolve_roms_root(custom: Option<&str>) -> PathBuf {
    if let Some(c) = custom {
        let p = PathBuf::from(c);
        if p.is_dir() { return p; }
    }
    if let Some(docs) = dirs::document_dir() {
        return docs.join("EMULADORES").join("ROMS GAMES");
    }
    PathBuf::from("EMULADORES").join("ROMS GAMES")
}

fn current_emulators_root() -> PathBuf {
    let custom = load_config().emulators_root;
    resolve_emulators_root(custom.as_deref())
}

fn current_roms_root() -> PathBuf {
    let custom = load_config().roms_root;
    resolve_roms_root(custom.as_deref())
}

#[derive(Debug, Clone, Serialize)]
struct Game {
    name: String,
    path: String,
    extension: String,
    size_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
struct SystemInfo {
    id: String,
    name: String,
    color: String,
    folder_name: String,
    emulator_path: String,
    emulator_exists: bool,
    folder_exists: bool,
    games: Vec<Game>,
}

fn clean_game_name(filename: &str) -> String {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);

    // 1. Strip parens () e brackets []
    let mut result = String::with_capacity(stem.len());
    let mut depth_paren = 0_i32;
    let mut depth_bracket = 0_i32;
    for ch in stem.chars() {
        match ch {
            '(' => depth_paren += 1,
            ')' if depth_paren > 0 => depth_paren -= 1,
            '[' => depth_bracket += 1,
            ']' if depth_bracket > 0 => depth_bracket -= 1,
            _ if depth_paren == 0 && depth_bracket == 0 => result.push(ch),
            _ => {}
        }
    }

    // 2. Substitui underscores e dots (dot-separator comum em ROMs) por espaco
    let normalized: String = result
        .chars()
        .map(|c| if c == '_' || c == '.' { ' ' } else { c })
        .collect();

    // 3. Remove sufixos comuns de versao/regiao/dump status case-insensitive
    let lower = normalized.to_lowercase();
    let suffix_markers = [
        " v1.0", " v1.1", " v1.2", " v1.3", " v2.0", " v2.1",
        " rev a", " rev b", " rev c", " rev 1", " rev 2",
        " demo", " beta", " proto", " prototype", " sample",
        " unl", " unlicensed",
        " usa", " eur", " jpn", " jp", " us", " eu", " ntsc", " pal",
    ];
    let mut cut_at = lower.len();
    for marker in suffix_markers.iter() {
        if let Some(idx) = lower.rfind(marker) {
            if idx < cut_at {
                cut_at = idx;
            }
        }
    }
    let trimmed = &normalized[..cut_at];

    // 4. Colapsa whitespace
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Gera variantes de busca para tentar no IGDB se a primeira falhar.
/// Retorna do mais especifico pro mais generico.
fn search_variants(name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return out;
    }
    out.push(trimmed.to_string());

    // Variante: split em " - " e tenta apenas a primeira parte
    if let Some((first, _)) = trimmed.split_once(" - ") {
        let f = first.trim();
        if !f.is_empty() && f != trimmed {
            out.push(f.to_string());
        }
    }
    // Variante: split em ":" (subtitulos)
    if let Some((first, _)) = trimmed.split_once(':') {
        let f = first.trim();
        if !f.is_empty() && !out.contains(&f.to_string()) {
            out.push(f.to_string());
        }
    }
    // Variante: primeiras 3 palavras
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    if words.len() > 3 {
        let short = words[..3].join(" ");
        if !out.contains(&short) {
            out.push(short);
        }
    }
    out
}

fn dir_size_mb(dir: &Path) -> u64 {
    let mut total: u64 = 0;
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    total / (1024 * 1024)
}

fn scan_extracted_ps3(folder: &Path, games: &mut Vec<Game>) {
    let entries = match std::fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        // tenta layout disc: <pasta>/PS3_GAME/USRDIR/EBOOT.BIN
        let disc_eboot = p.join("PS3_GAME").join("USRDIR").join("EBOOT.BIN");
        // tenta layout instalado: <pasta>/USRDIR/EBOOT.BIN
        let hdd_eboot = p.join("USRDIR").join("EBOOT.BIN");
        let eboot = if disc_eboot.is_file() {
            Some(disc_eboot)
        } else if hdd_eboot.is_file() {
            Some(hdd_eboot)
        } else {
            None
        };
        let eboot = match eboot {
            Some(e) => e,
            None => continue,
        };
        let folder_name = p.file_name().and_then(|f| f.to_str()).unwrap_or("");
        if folder_name.is_empty() {
            continue;
        }
        let size_mb = dir_size_mb(&p);
        games.push(Game {
            name: clean_game_name(folder_name),
            path: eboot.to_string_lossy().to_string(),
            extension: "bin".to_string(),
            size_mb,
        });
    }
}

fn scan_extracted_ps4(folder: &Path, games: &mut Vec<Game>) {
    let entries = match std::fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        // PS4 layout tipico: <pasta>/eboot.bin (extracted ou unpacked .pkg)
        // Tambem pode estar em <pasta>/<title-id>/eboot.bin se for hierarquico
        let direct_eboot = p.join("eboot.bin");
        let eboot = if direct_eboot.is_file() {
            Some(direct_eboot)
        } else {
            // tenta um nivel a mais (caso o usuario tenha agrupado por title-id)
            std::fs::read_dir(&p).ok().and_then(|it| {
                it.filter_map(|e| e.ok())
                    .find_map(|e| {
                        let inner = e.path().join("eboot.bin");
                        if inner.is_file() { Some(inner) } else { None }
                    })
            })
        };
        let eboot = match eboot {
            Some(e) => e,
            None => continue,
        };
        let folder_name = p.file_name().and_then(|f| f.to_str()).unwrap_or("");
        if folder_name.is_empty() {
            continue;
        }
        let size_mb = dir_size_mb(&p);
        games.push(Game {
            name: clean_game_name(folder_name),
            path: eboot.to_string_lossy().to_string(),
            extension: "bin".to_string(),
            size_mb,
        });
    }
}

fn scan_extracted_wiiu(folder: &Path, games: &mut Vec<Game>) {
    let entries = match std::fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let code_dir = p.join("code");
        if !code_dir.is_dir() {
            continue;
        }
        // achar primeiro .rpx dentro de code/
        let rpx = std::fs::read_dir(&code_dir)
            .ok()
            .and_then(|mut it| {
                it.find_map(|e| {
                    let path = e.ok()?.path();
                    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
                    if ext == "rpx" { Some(path) } else { None }
                })
            });
        let rpx = match rpx {
            Some(r) => r,
            None => continue,
        };
        let folder_name = p.file_name().and_then(|f| f.to_str()).unwrap_or("");
        if folder_name.is_empty() {
            continue;
        }
        let size_mb = dir_size_mb(&p);
        games.push(Game {
            name: clean_game_name(folder_name),
            path: rpx.to_string_lossy().to_string(),
            extension: "rpx".to_string(),
            size_mb,
        });
    }
}

fn scan_system(roms_root: &Path, emulators_root: &Path, cfg: &EmulatorConfig) -> SystemInfo {
    let folder = roms_root.join(cfg.folder_name);
    let folder_exists = folder.is_dir();
    let emulator_full = emulators_root.join(cfg.emulator_rel);
    let emulator_exists = emulator_full.is_file();

    let mut games: Vec<Game> = Vec::new();
    if folder_exists {
        for entry in WalkDir::new(&folder)
            .max_depth(2)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            if !cfg.extensions.iter().any(|e| *e == ext) {
                continue;
            }
            let filename = path.file_name().and_then(|f| f.to_str()).unwrap_or("");
            if filename.to_ascii_lowercase().ends_with(".part") {
                continue;
            }
            let size_mb = entry
                .metadata()
                .map(|m| m.len() / (1024 * 1024))
                .unwrap_or(0);
            games.push(Game {
                name: clean_game_name(filename),
                path: path.to_string_lossy().to_string(),
                extension: ext,
                size_mb,
            });
        }
        // Casos especiais: pastas extracted
        if cfg.id == "wiiu" {
            scan_extracted_wiiu(&folder, &mut games);
        }
        if cfg.id == "ps3" {
            scan_extracted_ps3(&folder, &mut games);
        }
        if cfg.id == "ps4" {
            scan_extracted_ps4(&folder, &mut games);
        }
        games.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    }

    SystemInfo {
        id: cfg.id.to_string(),
        name: cfg.name.to_string(),
        color: cfg.color.to_string(),
        folder_name: cfg.folder_name.to_string(),
        emulator_path: emulator_full.to_string_lossy().to_string(),
        emulator_exists,
        folder_exists,
        games,
    }
}

#[tauri::command]
fn scan_roms(roms_root: Option<String>) -> Vec<SystemInfo> {
    let root_path = match roms_root {
        Some(s) if !s.is_empty() => PathBuf::from(s),
        _ => current_roms_root(),
    };
    let emu_root = current_emulators_root();
    EMULATORS.iter().map(|cfg| scan_system(&root_path, &emu_root, cfg)).collect()
}

#[tauri::command]
fn launch_game(system_id: String, rom_path: String) -> Result<(), String> {
    let cfg = EMULATORS
        .iter()
        .find(|c| c.id == system_id)
        .ok_or_else(|| format!("Sistema desconhecido: {}", system_id))?;

    let exe = current_emulators_root().join(cfg.emulator_rel);
    if !exe.is_file() {
        return Err(format!("Emulador nao encontrado em: {}", exe.display()));
    }
    let rom = PathBuf::from(&rom_path);
    if !rom.is_file() {
        return Err(format!("ROM nao encontrada em: {}", rom_path));
    }

    let mut command = Command::new(&exe);
    for arg in cfg.launch_args {
        command.arg(arg);
    }
    command.arg(&rom_path);
    if let Some(parent) = exe.parent() {
        command.current_dir(parent);
    }

    let child = command
        .spawn()
        .map_err(|e| format!("Falha ao executar emulador: {}", e))?;

    // Mata jogo anterior (defensivo) e armazena o novo PID
    let slot = running_game_slot();
    let mut guard = slot.lock().unwrap();
    if let Some(mut prev) = guard.take() {
        let _ = prev.kill();
        let _ = prev.wait();
    }
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
fn kill_running_game() -> Result<bool, String> {
    Ok(kill_running_game_inner())
}

#[tauri::command]
fn get_default_roms_root() -> String {
    current_roms_root().to_string_lossy().to_string()
}

#[tauri::command]
fn get_default_emulators_root() -> String {
    current_emulators_root().to_string_lossy().to_string()
}

#[tauri::command]
fn set_paths_config(emulators_root: Option<String>, roms_root: Option<String>) -> Result<(), String> {
    let mut cfg = load_config();
    if emulators_root.is_some() {
        cfg.emulators_root = emulators_root.filter(|s| !s.is_empty());
    }
    if roms_root.is_some() {
        cfg.roms_root = roms_root.filter(|s| !s.is_empty());
    }
    save_config(cfg)
}

// ---------- IGDB cover fetching ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedToken {
    access_token: String,
    expires_at: u64, // unix timestamp
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct IgdbCover {
    url: String,
}

#[derive(Debug, Deserialize)]
struct IgdbScreenshot {
    url: String,
}

#[derive(Debug, Deserialize)]
struct IgdbGame {
    cover: Option<IgdbCover>,
    screenshots: Option<Vec<IgdbScreenshot>>,
}

#[derive(Debug, Deserialize)]
struct IgdbCompany {
    name: String,
}

#[derive(Debug, Deserialize)]
struct IgdbInvolvedCompany {
    company: IgdbCompany,
    developer: Option<bool>,
    publisher: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct IgdbGenre {
    name: String,
}

#[derive(Debug, Deserialize)]
struct IgdbGameDetails {
    name: Option<String>,
    summary: Option<String>,
    storyline: Option<String>,
    first_release_date: Option<i64>,
    rating: Option<f64>,
    cover: Option<IgdbCover>,
    screenshots: Option<Vec<IgdbScreenshot>>,
    genres: Option<Vec<IgdbGenre>>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GameDetails {
    name: String,
    summary: String,
    first_release_year: Option<i32>,
    rating: Option<f64>,
    genres: Vec<String>,
    developer: Option<String>,
    publisher: Option<String>,
    cover_path: Option<String>,
    screenshot_paths: Vec<String>,
}

static TOKEN_CACHE: OnceLock<Mutex<Option<CachedToken>>> = OnceLock::new();

fn token_cache() -> &'static Mutex<Option<CachedToken>> {
    TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

fn covers_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Playbox").join("covers");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn screenshots_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Playbox").join("screenshots");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn details_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Playbox").join("details");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn token_path() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Playbox");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("igdb_token.json"))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

async fn get_access_token(client: &reqwest::Client) -> Result<String, String> {
    {
        let cache = token_cache().lock().await;
        if let Some(t) = cache.as_ref() {
            if t.expires_at > now_secs() + 86400 {
                return Ok(t.access_token.clone());
            }
        }
    }

    if let Some(path) = token_path() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(t) = serde_json::from_str::<CachedToken>(&data) {
                if t.expires_at > now_secs() + 86400 {
                    let mut cache = token_cache().lock().await;
                    *cache = Some(t.clone());
                    return Ok(t.access_token);
                }
            }
        }
    }

    let url = format!(
        "https://id.twitch.tv/oauth2/token?client_id={}&client_secret={}&grant_type=client_credentials",
        IGDB_CLIENT_ID, IGDB_CLIENT_SECRET
    );
    let resp: TokenResponse = client
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("token request: {}", e))?
        .json()
        .await
        .map_err(|e| format!("token parse: {}", e))?;

    let cached = CachedToken {
        access_token: resp.access_token.clone(),
        expires_at: now_secs() + resp.expires_in,
    };
    if let Some(path) = token_path() {
        let _ = std::fs::write(&path, serde_json::to_string(&cached).unwrap_or_default());
    }
    let mut cache = token_cache().lock().await;
    *cache = Some(cached);
    Ok(resp.access_token)
}

async fn igdb_search_game(
    client: &reqwest::Client,
    token: &str,
    name: &str,
    platform: u32,
) -> Result<Option<IgdbGame>, String> {
    let escaped = name.replace('"', "\\\"");
    let body = if platform > 0 {
        format!(
            "search \"{}\"; fields cover.url, screenshots.url; where platforms = ({}); limit 1;",
            escaped, platform
        )
    } else {
        format!("search \"{}\"; fields cover.url, screenshots.url; limit 1;", escaped)
    };

    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", IGDB_CLIENT_ID)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("igdb request: {}", e))?;

    let games: Vec<IgdbGame> = resp
        .json()
        .await
        .map_err(|e| format!("igdb parse: {}", e))?;
    Ok(games.into_iter().next())
}

fn igdb_url(raw: &str, replace_thumb: &str) -> String {
    let url = if raw.starts_with("//") {
        format!("https:{}", raw)
    } else {
        raw.to_string()
    };
    url.replace("t_thumb", replace_thumb)
}

// ---------- Config / Profiles / Theme ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct LastPlayed {
    system_id: String,
    rom_path: String,
    rom_name: String,
    at: u64,
}

impl Default for LastPlayed {
    fn default() -> Self {
        Self { system_id: String::new(), rom_path: String::new(), rom_name: String::new(), at: 0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Profile {
    id: String,
    name: String,
    photo_path: Option<String>,
    created_at: u64,
    favorites: Vec<String>,
    play_time: std::collections::BTreeMap<String, u64>,
    total_launches: u32,
    achievements: Vec<String>,
    last_played: Option<LastPlayed>,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            photo_path: None,
            created_at: 0,
            favorites: Vec::new(),
            play_time: std::collections::BTreeMap::new(),
            total_launches: 0,
            achievements: Vec::new(),
            last_played: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct AppConfig {
    profiles: Vec<Profile>,
    active_profile_id: Option<String>,
    theme_id: String,
    wallpaper_path: Option<String>,
    last_system_id: Option<String>,
    /// Pasta com os emuladores (None = autodetect)
    emulators_root: Option<String>,
    /// Pasta com as ROMs (None = autodetect)
    roms_root: Option<String>,
    /// Discord Application ID (registrar em https://discord.com/developers/applications)
    discord_app_id: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            profiles: Vec::new(),
            active_profile_id: None,
            theme_id: "switch-dark".to_string(),
            wallpaper_path: None,
            last_system_id: None,
            emulators_root: None,
            roms_root: None,
            discord_app_id: None,
        }
    }
}

fn config_path() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Playbox");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("config.json"))
}

fn profiles_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Playbox").join("profiles");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn wallpapers_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Playbox").join("wallpapers");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

#[tauri::command]
fn load_config() -> AppConfig {
    if let Some(path) = config_path() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(mut cfg) = serde_json::from_str::<AppConfig>(&data) {
                // sanity: descarta last_played apontando pra ROM que nao existe mais
                for p in &mut cfg.profiles {
                    if let Some(lp) = &p.last_played {
                        if !PathBuf::from(&lp.rom_path).is_file() {
                            p.last_played = None;
                        }
                    }
                }
                return cfg;
            }
        }
    }
    AppConfig::default()
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    let path = config_path().ok_or("config path indisponivel")?;
    let data = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_config() -> Result<(), String> {
    if let Some(path) = config_path() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn decode_data_url(data_url: &str) -> Option<Vec<u8>> {
    let comma = data_url.find(',')?;
    let b64 = &data_url[comma + 1..];
    decode_base64(b64)
}

fn decode_base64(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[i8; 256] = &{
        let mut t = [-1i8; 256];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < chars.len() {
            t[chars[i] as usize] = i as i8;
            i += 1;
        }
        t
    };
    let bytes: Vec<u8> = input
        .bytes()
        .filter(|&b| !b.is_ascii_whitespace())
        .collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u32;
    for b in bytes {
        if b == b'=' {
            break;
        }
        let v = TABLE[b as usize];
        if v < 0 {
            return None;
        }
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[tauri::command]
fn save_profile_photo(profile_id: String, data_url: String) -> Result<String, String> {
    let bytes = decode_data_url(&data_url).ok_or("data url invalido")?;
    let dir = profiles_dir().ok_or("dir profiles indisponivel")?;
    let safe = sanitize_filename(&profile_id);
    let path = dir.join(format!("{}.png", safe));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_wallpaper(image_id: String, data_url: String) -> Result<String, String> {
    let bytes = decode_data_url(&data_url).ok_or("data url invalido")?;
    let dir = wallpapers_dir().ok_or("dir wallpapers indisponivel")?;
    let safe = sanitize_filename(&image_id);
    let path = dir.join(format!("{}.png", safe));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_profile_photo_from_path(profile_id: String, source_path: String) -> Result<String, String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err(format!("arquivo nao existe: {}", source_path));
    }
    let dir = profiles_dir().ok_or("dir profiles indisponivel")?;
    let safe = sanitize_filename(&profile_id);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    // Limpa fotos antigas (qualquer extensao) antes de gravar a nova
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                if stem == safe {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    let dst = dir.join(format!("{}.{}", safe, ext));
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_profile_photo(profile_id: String) -> Result<(), String> {
    let dir = profiles_dir().ok_or("dir profiles indisponivel")?;
    let safe = sanitize_filename(&profile_id);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                if stem == safe {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn save_wallpaper_from_path(image_id: String, source_path: String) -> Result<String, String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err(format!("arquivo nao existe: {}", source_path));
    }
    let dir = wallpapers_dir().ok_or("dir wallpapers indisponivel")?;
    let safe = sanitize_filename(&image_id);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let dst = dir.join(format!("{}.{}", safe, ext));
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
fn quit_app() {
    std::process::exit(0);
}

// ---------- Saves separados por perfil (Windows junctions) ----------

#[derive(Debug, Clone, Serialize)]
struct SaveSlot {
    emulator_id: &'static str,
    name: &'static str,
    source_path: String,
    is_junction: bool,
    points_to: Option<String>,
}

fn expand_save_path(template: &str) -> Option<PathBuf> {
    let appdata = dirs::data_dir()?;
    let docs = dirs::document_dir()?;
    let s = template
        .replace("{APPDATA}", appdata.to_string_lossy().as_ref())
        .replace("{DOCUMENTS}", docs.to_string_lossy().as_ref());
    Some(PathBuf::from(s))
}

const SAVE_TEMPLATES: &[(&str, &str, &str)] = &[
    ("yuzu",        "Yuzu (Switch)",     "{APPDATA}\\yuzu\\nand\\user\\save"),
    ("pcsx2",       "PCSX2",             "{DOCUMENTS}\\PCSX2\\memcards"),
    ("dolphin_gc",  "Dolphin (GC cards)", "{DOCUMENTS}\\Dolphin Emulator\\GC"),
    ("dolphin_wii", "Dolphin (Wii saves)", "{DOCUMENTS}\\Dolphin Emulator\\Wii"),
    ("duckstation", "DuckStation",       "{DOCUMENTS}\\DuckStation\\memcards"),
    ("rpcs3",       "RPCS3",             "C:\\Users\\paulo\\OneDrive\\Documents\\EMULADORES\\ROMS EMULADORES\\RPCS3\\dev_hdd0\\home"),
    ("project64",   "Project64",         "C:\\Users\\paulo\\OneDrive\\Documents\\EMULADORES\\ROMS EMULADORES\\N64\\Save"),
];

fn is_junction(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        // FILE_ATTRIBUTE_REPARSE_POINT = 0x400
        return meta.file_attributes() & 0x400 != 0;
    }
    false
}

fn read_junction_target(path: &Path) -> Option<String> {
    std::fs::read_link(path).ok().map(|p| p.to_string_lossy().to_string())
}

fn create_junction(link: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = link.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::create_dir_all(target).ok();
    let status = Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .status()
        .map_err(|e| format!("mklink falhou: {}", e))?;
    if !status.success() {
        return Err(format!("mklink retornou {}", status));
    }
    Ok(())
}

fn remove_junction(path: &Path) -> Result<(), String> {
    if !is_junction(path) {
        return Err("nao e junction".into());
    }
    // rmdir num junction so remove o link, nao o target
    let status = Command::new("cmd")
        .args(["/c", "rmdir"])
        .arg(path)
        .status()
        .map_err(|e| format!("rmdir falhou: {}", e))?;
    if !status.success() {
        return Err(format!("rmdir retornou {}", status));
    }
    Ok(())
}

fn move_dir_contents(from: &Path, to: &Path) -> Result<u32, String> {
    if !from.is_dir() { return Ok(0); }
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dst = to.join(entry.file_name());
        std::fs::rename(entry.path(), &dst).map_err(|e| format!("rename: {}", e))?;
        count += 1;
    }
    Ok(count)
}

fn profile_saves_dir(profile_id: &str, emu_id: &str) -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Playbox").join("profiles").join(profile_id).join("saves").join(emu_id);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

#[tauri::command]
fn list_save_slots() -> Vec<SaveSlot> {
    let mut out = Vec::new();
    for (id, name, tmpl) in SAVE_TEMPLATES {
        if let Some(path) = expand_save_path(tmpl) {
            let exists = path.exists();
            let junction = exists && is_junction(&path);
            let target = if junction { read_junction_target(&path) } else { None };
            out.push(SaveSlot {
                emulator_id: id,
                name,
                source_path: path.to_string_lossy().to_string(),
                is_junction: junction,
                points_to: target,
            });
            let _ = exists;
        }
    }
    out
}

#[tauri::command]
fn swap_profile_saves(profile_id: String, previous_profile_id: Option<String>) -> Result<Vec<String>, String> {
    let mut log = Vec::new();
    for (emu_id, _, tmpl) in SAVE_TEMPLATES {
        let source = match expand_save_path(tmpl) { Some(p) => p, None => continue };
        let new_target = match profile_saves_dir(&profile_id, emu_id) { Some(p) => p, None => continue };

        if source.exists() && is_junction(&source) {
            // Source ja e junction: aponta pro perfil anterior. Remove e troca.
            remove_junction(&source).map_err(|e| format!("[{}] remove junction: {}", emu_id, e))?;
            log.push(format!("{}: removido junction antigo", emu_id));
        } else if source.is_dir() {
            // Source e pasta real com conteudo. Move pro perfil anterior (ou pro novo se nao tem anterior).
            let absorb_target = match previous_profile_id.as_ref().and_then(|p| profile_saves_dir(p, emu_id)) {
                Some(p) => p,
                None => new_target.clone(),
            };
            let n = move_dir_contents(&source, &absorb_target)
                .map_err(|e| format!("[{}] mover: {}", emu_id, e))?;
            log.push(format!("{}: absorvidos {} arquivos pro perfil anterior", emu_id, n));
            // remove pasta vazia
            let _ = std::fs::remove_dir(&source);
        }

        // cria nova junction
        create_junction(&source, &new_target)
            .map_err(|e| format!("[{}] criar junction: {}", emu_id, e))?;
        log.push(format!("{}: junction -> perfil {}", emu_id, profile_id));
    }
    Ok(log)
}

#[tauri::command]
fn unlink_profile_saves() -> Result<Vec<String>, String> {
    let mut log = Vec::new();
    for (emu_id, _, tmpl) in SAVE_TEMPLATES {
        let source = match expand_save_path(tmpl) { Some(p) => p, None => continue };
        if source.exists() && is_junction(&source) {
            // copia conteudo do target pra source antes de quebrar
            let target = read_junction_target(&source);
            remove_junction(&source).ok();
            if let Some(t) = target {
                let target_path = PathBuf::from(&t);
                if target_path.is_dir() {
                    std::fs::create_dir_all(&source).ok();
                    let _ = move_dir_contents(&target_path, &source);
                }
            }
            log.push(format!("{}: junction removida, conteudo restaurado", emu_id));
        }
    }
    Ok(log)
}

// ---------- Setup das keys do Switch (Yuzu) ----------

#[derive(Debug, Serialize)]
struct YuzuSetupResult {
    keys_copied: bool,
    firmware_files: u32,
    yuzu_dir: String,
}

#[tauri::command]
fn setup_switch_keys(roms_root: String) -> Result<YuzuSetupResult, String> {
    let appdata = dirs::data_dir().ok_or("appdata indisponivel")?;
    let yuzu_dir = appdata.join("yuzu");
    let keys_dir = yuzu_dir.join("keys");
    std::fs::create_dir_all(&keys_dir).map_err(|e| e.to_string())?;

    // procura prod.keys
    let roms_keys = PathBuf::from(&roms_root).join("KEYS");
    if !roms_keys.is_dir() {
        return Err("Pasta KEYS nao encontrada em ROMS".into());
    }

    let mut keys_copied = false;
    for entry in WalkDir::new(&roms_keys).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path.file_name().and_then(|f| f.to_str()).unwrap_or("");
        if name.eq_ignore_ascii_case("prod.keys") || name.eq_ignore_ascii_case("title.keys") {
            let dst = keys_dir.join(name);
            std::fs::copy(path, &dst).map_err(|e| format!("copy {}: {}", name, e))?;
            keys_copied = true;
        }
    }

    // firmware: procura *.nca
    let registered = yuzu_dir
        .join("nand")
        .join("system")
        .join("Contents")
        .join("registered");
    std::fs::create_dir_all(&registered).map_err(|e| e.to_string())?;

    let mut firmware_count = 0u32;
    for entry in WalkDir::new(&roms_keys).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() { continue; }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !ext.eq_ignore_ascii_case("nca") { continue; }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if stem.is_empty() { continue; }
        // estrutura registered: <hash>.nca/00 (atomic file id)
        // formato suportado pelo yuzu: <hash>.nca solto OU <hash>/00 dentro
        // mais simples: copiar como arquivo solto
        let dst_dir = registered.join(format!("{}.nca", stem));
        std::fs::create_dir_all(&dst_dir).ok();
        let dst = dst_dir.join("00");
        if dst.is_file() { firmware_count += 1; continue; }
        std::fs::copy(path, &dst).map_err(|e| format!("copy nca {}: {}", stem, e))?;
        firmware_count += 1;
    }

    Ok(YuzuSetupResult {
        keys_copied,
        firmware_files: firmware_count,
        yuzu_dir: yuzu_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn clear_covers_cache(system_id: Option<String>) -> Result<u32, String> {
    let dir = covers_dir().ok_or("dir covers indisponivel")?;
    let target = match &system_id {
        Some(s) => dir.join(s),
        None => dir.clone(),
    };
    if !target.is_dir() {
        return Ok(0);
    }
    let mut count = 0u32;
    for entry in WalkDir::new(&target).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file()
            && entry
                .path()
                .extension()
                .map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("png"))
                .unwrap_or(false)
        {
            if std::fs::remove_file(entry.path()).is_ok() {
                count += 1;
            }
        }
    }
    Ok(count)
}

#[tauri::command]
async fn fetch_cover(system_id: String, game_name: String) -> Option<String> {
    let cfg = EMULATORS.iter().find(|c| c.id == system_id)?;
    let dir = covers_dir()?.join(&system_id);
    std::fs::create_dir_all(&dir).ok()?;
    let safe = sanitize_filename(&game_name);
    let cache_file = dir.join(format!("{}.jpg", safe));

    if cache_file.is_file() {
        return Some(cache_file.to_string_lossy().to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;

    let token = get_access_token(&client).await.ok()?;

    // Tenta cada variante: nome completo, sem subtitulo, primeiras 3 palavras
    for variant in search_variants(&game_name) {
        let game = match igdb_search_game(&client, &token, &variant, cfg.igdb_platform).await {
            Ok(Some(g)) => g,
            _ => continue,
        };
        let Some(cover) = game.cover else { continue };
        let url = igdb_url(&cover.url, "t_cover_big");
        let Ok(resp) = client.get(&url).send().await else { continue };
        let Ok(bytes) = resp.bytes().await else { continue };
        if tokio::fs::write(&cache_file, &bytes).await.is_ok() {
            return Some(cache_file.to_string_lossy().to_string());
        }
    }

    // Ultimo recurso: busca SEM filtrar por plataforma (jogos crossplatform comuns)
    if let Ok(Some(game)) = igdb_search_game(&client, &token, &game_name, 0).await {
        if let Some(cover) = game.cover {
            let url = igdb_url(&cover.url, "t_cover_big");
            if let Ok(resp) = client.get(&url).send().await {
                if let Ok(bytes) = resp.bytes().await {
                    if tokio::fs::write(&cache_file, &bytes).await.is_ok() {
                        return Some(cache_file.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    None
}

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Caminho nao existe: {}", path));
    }
    // /select, abre o Explorer com o arquivo destacado
    Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("explorer.exe: {}", e))?;
    Ok(())
}

#[tauri::command]
fn delete_game_to_trash(system_id: String, game_name: String, game_path: String) -> Result<(), String> {
    let p = PathBuf::from(&game_path);
    if !p.exists() {
        return Err(format!("Arquivo nao existe: {}", game_path));
    }
    // Para PS3/PS4/WiiU extracted, o path aponta pro EBOOT/RPX dentro de uma subpasta —
    // a gente quer mandar a pasta-jogo inteira pra lixeira, nao so o EBOOT.
    let target = if game_path.to_lowercase().ends_with("eboot.bin") || game_path.to_lowercase().ends_with(".rpx") {
        // sobe ate achar a pasta-jogo (filha direta de ROMS GAMES/<system>/)
        let mut current = p.parent().unwrap_or(&p).to_path_buf();
        let roms_root = current_roms_root();
        let system_folder_name = EMULATORS.iter().find(|c| c.id == system_id).map(|c| c.folder_name);
        if let Some(sys_name) = system_folder_name {
            let system_dir = roms_root.join(sys_name);
            // sobe ate o pai ser system_dir
            while current.parent().map(|p| p != system_dir).unwrap_or(false) {
                if let Some(parent) = current.parent() {
                    current = parent.to_path_buf();
                } else {
                    break;
                }
            }
        }
        current
    } else {
        p
    };
    trash::delete(&target).map_err(|e| format!("Lixeira: {}", e))?;
    // Tambem remove a capa em cache pra nao ficar fantasma
    let _ = clear_single_cover(system_id, game_name);
    Ok(())
}

#[tauri::command]
fn set_custom_cover(system_id: String, game_name: String, source_path: String) -> Result<String, String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err(format!("Arquivo nao existe: {}", source_path));
    }
    let dir = covers_dir().ok_or("dir covers indisponivel")?.join(&system_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe = sanitize_filename(&game_name);
    // Limpa qualquer capa/screenshot/marker antigos
    for ext in ["jpg", "png", "jpeg", "webp"] {
        let f = dir.join(format!("{}.{}", safe, ext));
        if f.is_file() { let _ = std::fs::remove_file(&f); }
    }
    if let Some(sdir) = screenshots_dir() {
        let sd = sdir.join(&system_id);
        for ext in ["jpg", "png", "miss"] {
            let f = sd.join(format!("{}.{}", safe, ext));
            if f.is_file() { let _ = std::fs::remove_file(&f); }
        }
    }
    // Mantem extensao original (jpg padrao)
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("jpg").to_lowercase();
    let dst_ext = if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "bmp") { ext } else { "jpg".to_string() };
    let dst = dir.join(format!("{}.{}", safe, dst_ext));
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
fn clear_single_cover(system_id: String, game_name: String) -> Result<(), String> {
    let dir = covers_dir().ok_or("dir covers indisponivel")?.join(&system_id);
    let safe = sanitize_filename(&game_name);
    for ext in ["jpg", "png"] {
        let f = dir.join(format!("{}.{}", safe, ext));
        if f.is_file() {
            std::fs::remove_file(&f).map_err(|e| e.to_string())?;
        }
    }
    // Tambem invalida o screenshot pra ser re-buscado
    if let Some(sdir) = screenshots_dir() {
        let sd = sdir.join(&system_id);
        for ext in ["jpg", "png", "miss"] {
            let f = sd.join(format!("{}.{}", safe, ext));
            if f.is_file() { let _ = std::fs::remove_file(&f); }
        }
    }
    Ok(())
}

#[tauri::command]
async fn fetch_screenshot(system_id: String, game_name: String) -> Option<String> {
    let cfg = EMULATORS.iter().find(|c| c.id == system_id)?;
    let dir = screenshots_dir()?.join(&system_id);
    std::fs::create_dir_all(&dir).ok()?;
    let safe = sanitize_filename(&game_name);
    let cache_file = dir.join(format!("{}.jpg", safe));
    let miss_marker = dir.join(format!("{}.miss", safe));

    if cache_file.is_file() {
        return Some(cache_file.to_string_lossy().to_string());
    }
    if miss_marker.is_file() {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .ok()?;

    let token = get_access_token(&client).await.ok()?;

    for variant in search_variants(&game_name) {
        let game = match igdb_search_game(&client, &token, &variant, cfg.igdb_platform).await {
            Ok(Some(g)) => g,
            _ => continue,
        };
        let shots = game.screenshots.unwrap_or_default();
        let Some(shot) = shots.into_iter().next() else { continue };
        let url = igdb_url(&shot.url, "t_screenshot_big");
        let Ok(resp) = client.get(&url).send().await else { continue };
        let Ok(bytes) = resp.bytes().await else { continue };
        if tokio::fs::write(&cache_file, &bytes).await.is_ok() {
            return Some(cache_file.to_string_lossy().to_string());
        }
    }

    let _ = tokio::fs::write(&miss_marker, b"").await;
    None
}

async fn igdb_search_game_details(
    client: &reqwest::Client,
    token: &str,
    name: &str,
    platform: u32,
) -> Result<Option<IgdbGameDetails>, String> {
    let escaped = name.replace('"', "\\\"");
    let fields = "fields name, summary, storyline, first_release_date, rating, cover.url, screenshots.url, genres.name, involved_companies.developer, involved_companies.publisher, involved_companies.company.name";
    let body = if platform > 0 {
        format!("search \"{}\"; {}; where platforms = ({}); limit 1;", escaped, fields, platform)
    } else {
        format!("search \"{}\"; {}; limit 1;", escaped, fields)
    };
    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", IGDB_CLIENT_ID)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("igdb request: {}", e))?;
    let games: Vec<IgdbGameDetails> = resp.json().await.map_err(|e| format!("igdb parse: {}", e))?;
    Ok(games.into_iter().next())
}

#[tauri::command]
async fn fetch_game_details(system_id: String, game_name: String) -> Option<GameDetails> {
    let cfg = EMULATORS.iter().find(|c| c.id == system_id)?;
    let cache_dir = details_dir()?.join(&system_id);
    std::fs::create_dir_all(&cache_dir).ok()?;
    let safe = sanitize_filename(&game_name);
    let cache_file = cache_dir.join(format!("{}.json", safe));

    // Cache hit
    if let Ok(data) = std::fs::read_to_string(&cache_file) {
        if let Ok(d) = serde_json::from_str::<GameDetails>(&data) {
            return Some(d);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .ok()?;
    let token = get_access_token(&client).await.ok()?;

    let mut details: Option<IgdbGameDetails> = None;
    for variant in search_variants(&game_name) {
        if let Ok(Some(g)) = igdb_search_game_details(&client, &token, &variant, cfg.igdb_platform).await {
            details = Some(g);
            break;
        }
    }
    let g = details?;

    // Baixa screenshots em paralelo (max 4)
    let screenshots_root = screenshots_dir()?.join(&system_id);
    std::fs::create_dir_all(&screenshots_root).ok();
    let mut shot_paths: Vec<String> = Vec::new();
    if let Some(shots) = &g.screenshots {
        for (i, s) in shots.iter().take(4).enumerate() {
            let url = igdb_url(&s.url, "t_screenshot_big");
            let dst = screenshots_root.join(format!("{}_{}.jpg", safe, i));
            if dst.is_file() {
                shot_paths.push(dst.to_string_lossy().to_string());
                continue;
            }
            if let Ok(resp) = client.get(&url).send().await {
                if let Ok(bytes) = resp.bytes().await {
                    if tokio::fs::write(&dst, &bytes).await.is_ok() {
                        shot_paths.push(dst.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    // Re-aproveita cover ja baixada (ou baixa agora)
    let covers_root = covers_dir()?.join(&system_id);
    std::fs::create_dir_all(&covers_root).ok();
    let cover_file = covers_root.join(format!("{}.jpg", safe));
    let cover_path = if cover_file.is_file() {
        Some(cover_file.to_string_lossy().to_string())
    } else if let Some(c) = &g.cover {
        let url = igdb_url(&c.url, "t_cover_big");
        if let Ok(resp) = client.get(&url).send().await {
            if let Ok(bytes) = resp.bytes().await {
                if tokio::fs::write(&cover_file, &bytes).await.is_ok() {
                    Some(cover_file.to_string_lossy().to_string())
                } else { None }
            } else { None }
        } else { None }
    } else { None };

    let year = g.first_release_date.and_then(|t| {
        // unix timestamp -> ano
        let secs_per_year = 31_557_600_i64;
        let years = t / secs_per_year;
        let year = 1970 + years as i32;
        if year > 1900 && year < 2100 { Some(year) } else { None }
    });

    let mut developer: Option<String> = None;
    let mut publisher: Option<String> = None;
    if let Some(companies) = &g.involved_companies {
        for c in companies {
            if developer.is_none() && c.developer == Some(true) {
                developer = Some(c.company.name.clone());
            }
            if publisher.is_none() && c.publisher == Some(true) {
                publisher = Some(c.company.name.clone());
            }
        }
    }

    let result = GameDetails {
        name: g.name.unwrap_or_else(|| game_name.clone()),
        summary: g.storyline.or(g.summary).unwrap_or_default(),
        first_release_year: year,
        rating: g.rating.map(|r| (r * 10.0).round() / 10.0),
        genres: g.genres.unwrap_or_default().into_iter().map(|x| x.name).collect(),
        developer,
        publisher,
        cover_path,
        screenshot_paths: shot_paths,
    };

    if let Ok(data) = serde_json::to_string_pretty(&result) {
        let _ = std::fs::write(&cache_file, data);
    }
    Some(result)
}

#[tauri::command]
fn clear_game_details(system_id: String, game_name: String) -> Result<(), String> {
    let dir = details_dir().ok_or("dir details indisponivel")?.join(&system_id);
    let safe = sanitize_filename(&game_name);
    let f = dir.join(format!("{}.json", safe));
    if f.is_file() { std::fs::remove_file(&f).map_err(|e| e.to_string())?; }
    Ok(())
}

/// Background thread que polla o controle nativamente (XInput) e mata o emulador
/// rodando quando o usuario aperta Select+Start juntos. Standard RetroArch combo.
fn spawn_gamepad_hotkey_listener() {
    std::thread::spawn(|| {
        let mut gilrs = match gilrs::Gilrs::new() {
            Ok(g) => g,
            Err(e) => {
                eprintln!("gilrs init falhou: {:?}", e);
                return;
            }
        };
        // Pads que estao com Select e Start pressionados respectivamente
        let mut select_held: std::collections::HashSet<gilrs::GamepadId> =
            std::collections::HashSet::new();
        let mut start_held: std::collections::HashSet<gilrs::GamepadId> =
            std::collections::HashSet::new();
        let mut last_kill = std::time::Instant::now() - std::time::Duration::from_secs(5);

        loop {
            while let Some(gilrs::Event { id, event, .. }) = gilrs.next_event() {
                use gilrs::Button;
                use gilrs::EventType::*;
                match event {
                    ButtonPressed(Button::Select, _) => { select_held.insert(id); }
                    ButtonReleased(Button::Select, _) => { select_held.remove(&id); }
                    ButtonPressed(Button::Start, _) => { start_held.insert(id); }
                    ButtonReleased(Button::Start, _) => { start_held.remove(&id); }
                    Disconnected => {
                        select_held.remove(&id);
                        start_held.remove(&id);
                    }
                    _ => {}
                }
                // Combo no MESMO controle
                if select_held.contains(&id) && start_held.contains(&id) {
                    let now = std::time::Instant::now();
                    if now.duration_since(last_kill) < std::time::Duration::from_millis(800) {
                        continue;
                    }
                    last_kill = now;
                    select_held.remove(&id);
                    start_held.remove(&id);
                    if kill_running_game_inner() {
                        restore_launcher_window();
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let _ = APP_HANDLE.set(app.handle().clone());
            spawn_gamepad_hotkey_listener();
            // Tenta conectar Discord no startup (sem-op se nao tem app_id ou Discord nao esta rodando)
            std::thread::spawn(|| {
                let _ = discord_connect_internal();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_roms,
            launch_game,
            kill_running_game,
            get_default_roms_root,
            get_default_emulators_root,
            set_paths_config,
            fetch_cover,
            clear_single_cover,
            set_custom_cover,
            open_in_explorer,
            delete_game_to_trash,
            load_config,
            save_config,
            reset_config,
            save_profile_photo,
            save_profile_photo_from_path,
            delete_profile_photo,
            save_wallpaper,
            save_wallpaper_from_path,
            clear_covers_cache,
            fetch_screenshot,
            fetch_game_details,
            clear_game_details,
            discord_connect,
            discord_set_app_id,
            discord_set_activity,
            discord_clear_activity,
            quit_app,
            list_save_slots,
            swap_profile_saves,
            unlink_profile_saves,
            setup_switch_keys
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
