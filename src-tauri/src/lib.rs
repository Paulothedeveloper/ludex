mod libretro;
use libretro::LibretroCore;

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

/// Info do jogo rodando atualmente. PID e metadata; o ownership do Child fica
/// na thread que faz wait() e registra a sessao quando termina.
#[derive(Clone)]
struct RunningGameInfo {
    pid: u32,
    started_at: u64,
    system_id: String,
    rom_path: String,
    rom_name: String,
}

static RUNNING_GAME: OnceLock<Arc<StdMutex<Option<RunningGameInfo>>>> = OnceLock::new();
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

fn running_game_slot() -> Arc<StdMutex<Option<RunningGameInfo>>> {
    RUNNING_GAME
        .get_or_init(|| Arc::new(StdMutex::new(None)))
        .clone()
}

fn kill_running_game_inner() -> bool {
    let info = {
        let slot = running_game_slot();
        let guard = slot.lock().unwrap();
        guard.clone()
    };
    if let Some(info) = info {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let _ = Command::new("taskkill")
                .args(["/PID", &info.pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        #[cfg(not(windows))]
        {
            let _ = Command::new("kill").args(["-9", &info.pid.to_string()]).status();
        }
        // A thread de wait() vai detectar o processo morto, registrar sessao e limpar o slot.
        true
    } else {
        false
    }
}

/// Registra duracao da sessao no profile ativo + atualiza last_played.
/// Tambem emite evento "game-ended" pro front re-fetchar config.
fn register_session_end(info: &RunningGameInfo, duration_sec: u64) {
    let mut cfg = load_config();
    if let Some(active_id) = cfg.active_profile_id.clone() {
        if let Some(profile) = cfg.profiles.iter_mut().find(|p| p.id == active_id) {
            let key = format!("{}::{}", info.system_id, info.rom_path);
            let entry = profile.play_time.entry(key.clone()).or_insert(0);
            *entry = entry.saturating_add(duration_sec);
            profile.last_played = Some(LastPlayed {
                system_id: info.system_id.clone(),
                rom_path: info.rom_path.clone(),
                rom_name: info.rom_name.clone(),
                at: info.started_at + duration_sec,
            });
            // Sessions: so guarda se durou >= 30 segundos (filtra falhas de boot)
            if duration_sec >= 30 {
                profile.sessions.push(PlaySession {
                    started_at: info.started_at,
                    duration_sec,
                    rom_path: info.rom_path.clone(),
                    rom_name: info.rom_name.clone(),
                    system_id: info.system_id.clone(),
                });
                // Cap em 500 sessoes mais recentes
                if profile.sessions.len() > 500 {
                    let drop_n = profile.sessions.len() - 500;
                    profile.sessions.drain(0..drop_n);
                }
            }
            let _ = save_config_internal(cfg);
        }
    }
    if let Some(handle) = APP_HANDLE.get() {
        let _ = handle.emit("game-ended", duration_sec);
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

/// Mapeia sistema -> nome do .dll do core libretro embarcado.
/// Sistemas que retornam string vazia rodam via emulador externo (caminho original).
fn libretro_core_for(system_id: &str) -> &'static str {
    match system_id {
        "snes" => "snes9x_libretro.dll",
        "gba"  => "mgba_libretro.dll",
        "nes"  => "nestopia_libretro.dll",
        "gb"   => "gambatte_libretro.dll",
        "gbc"  => "gambatte_libretro.dll",
        "md"   => "genesis_plus_gx_libretro.dll",
        "n64"  => "mupen64plus_next_libretro.dll",
        "ps1"  => "swanstation_libretro.dll",
        _ => "",
    }
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
        id: "3ds",
        name: "NINTENDO 3DS",
        color: "#d4145a",
        folder_name: "3DS",
        emulator_rel: "CITRA\\citra-qt.exe",
        extensions: &["3ds", "cci", "cxi", "3dsx", "app", "elf", "axf"],
        launch_args: &[],
        igdb_platform: 37,
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
        launch_args: &["-dvd_path"],
        igdb_platform: 11,
    },
    EmulatorConfig {
        id: "snes",
        name: "SUPER NINTENDO",
        color: "#7d2d8a",
        folder_name: "SNES",
        emulator_rel: "",  // libretro embarcado
        extensions: &["sfc", "smc", "fig", "swc"],
        launch_args: &[],
        igdb_platform: 19,
    },
    EmulatorConfig {
        id: "nes",
        name: "NINTENDO",
        color: "#dc2626",
        folder_name: "NES",
        emulator_rel: "",  // libretro embarcado (nestopia)
        extensions: &["nes", "fds", "unf"],
        launch_args: &[],
        igdb_platform: 18,
    },
    EmulatorConfig {
        id: "gb",
        name: "GAME BOY",
        color: "#84cc16",
        folder_name: "GB",
        emulator_rel: "",  // libretro embarcado (gambatte)
        extensions: &["gb"],
        launch_args: &[],
        igdb_platform: 33,
    },
    EmulatorConfig {
        id: "gbc",
        name: "GAME BOY COLOR",
        color: "#facc15",
        folder_name: "GBC",
        emulator_rel: "",  // libretro embarcado (gambatte)
        extensions: &["gbc", "gb"],
        launch_args: &[],
        igdb_platform: 22,
    },
    EmulatorConfig {
        id: "md",
        name: "MEGA DRIVE",
        color: "#0ea5e9",
        folder_name: "MEGADRIVE",
        emulator_rel: "",  // libretro embarcado (genesis_plus_gx)
        extensions: &["md", "gen", "smd", "bin", "sg"],
        launch_args: &[],
        igdb_platform: 29,
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
/// 3. D:\Playbox\emulators (organizacao recomendada)
/// 4. <Documents>\EMULADORES\ROMS EMULADORES (legacy / dev)
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
    // Autodetect: roda na ordem de prioridade. Primeiro acha = vence.
    // Ludex (novo nome do projeto) vem antes do legacy Playbox.
    let candidates = [
        PathBuf::from("D:\\Projetos do Claude\\Ludex\\emulators"),
        PathBuf::from("D:\\Projetos do Claude\\Playbox\\emulators"),
        PathBuf::from("D:\\Ludex\\emulators"),
        PathBuf::from("D:\\Playbox\\emulators"),
        PathBuf::from("C:\\Ludex\\emulators"),
    ];
    for c in candidates.iter() {
        if c.is_dir() { return c.clone(); }
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
    let candidates = [
        PathBuf::from("D:\\Projetos do Claude\\Ludex\\roms"),
        PathBuf::from("D:\\Projetos do Claude\\Playbox\\roms"),
        PathBuf::from("D:\\Ludex\\roms"),
        PathBuf::from("D:\\Playbox\\roms"),
        PathBuf::from("C:\\Ludex\\roms"),
    ];
    for c in candidates.iter() {
        if c.is_dir() { return c.clone(); }
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
struct Disc {
    label: String,  // "Disc 1", "Disc 2"...
    path: String,
}

#[derive(Debug, Clone, Serialize)]
struct Game {
    name: String,
    path: String,
    extension: String,
    size_mb: u64,
    /// Se for jogo multi-disc, lista de discos. None = single-disc.
    /// path principal aponta pro disco 1 por convencao.
    #[serde(skip_serializing_if = "Option::is_none")]
    discs: Option<Vec<Disc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct SystemInfo {
    id: String,
    name: String,
    color: String,
    folder_name: String,
    emulator_path: String,
    emulator_exists: bool,
    folder_exists: bool,
    games: Vec<Game>,
    /// Nome do .dll do core libretro (vazio = roda via emulador externo)
    libretro_core: String,
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
            discs: None,
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
            discs: None,
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
            discs: None,
        });
    }
}

/// Detecta se o nome tem indicador de disco. Retorna (base_name, label_disco).
/// Reconhece: "Disc 1", "Disc N", "CD 1", "Disco 1", "(Disc N)" etc.
fn parse_disc_marker(name: &str) -> Option<(String, String)> {
    let lower = name.to_lowercase();
    // Padroes comuns: "disc 1", "disc1", "cd 1", "disco 1", "side a/b" (raro)
    let markers = [" disc ", " disc", " cd ", " cd", " disco ", " disk "];
    for marker in markers.iter() {
        if let Some(idx) = lower.rfind(marker) {
            let after = &name[idx + marker.len()..];
            // Pega o numero (1-9 ou letra A-Z)
            let mut digits = String::new();
            for ch in after.chars() {
                if ch.is_ascii_digit() || ch.is_ascii_alphabetic() {
                    digits.push(ch);
                    if digits.len() >= 2 { break; }
                } else {
                    break;
                }
            }
            if digits.is_empty() { continue; }
            // Confirma que ate aqui parece "Disc N" e nao "discrete" ou similar
            let cap_marker = marker.trim();
            let label = format!("{} {}", capitalize(cap_marker), digits.trim_start_matches('0'));
            // base_name = trecho ate o marker, sem o disc, com trim
            let base = name[..idx].trim_end().to_string();
            if base.is_empty() { continue; }
            return Some((base, label));
        }
    }
    None
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Agrupa jogos com mesmo base_name em multi-disc.
/// Mantem ordem original (jogos sem disc) e cria entries unicos pra grupos.
fn group_multidisc_games(games: Vec<Game>) -> Vec<Game> {
    use std::collections::BTreeMap;
    let mut groups: BTreeMap<String, Vec<(String, Game)>> = BTreeMap::new();
    let mut singles: Vec<Game> = Vec::new();

    for g in games {
        match parse_disc_marker(&g.name) {
            Some((base, label)) => {
                groups.entry(base).or_default().push((label, g));
            }
            None => singles.push(g),
        }
    }

    let mut result = singles;
    for (base, mut entries) in groups {
        if entries.len() == 1 {
            // So 1 disco encontrado — trata como single mesmo
            result.push(entries.remove(0).1);
            continue;
        }
        // Ordena por label (Disc 1 antes de Disc 2)
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let total_size: u64 = entries.iter().map(|(_, g)| g.size_mb).sum();
        let first_path = entries[0].1.path.clone();
        let extension = entries[0].1.extension.clone();
        let discs: Vec<Disc> = entries.into_iter().map(|(label, g)| Disc {
            label,
            path: g.path,
        }).collect();
        result.push(Game {
            name: base,
            path: first_path,
            extension,
            size_mb: total_size,
            discs: Some(discs),
        });
    }

    result.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    result
}

fn scan_system(roms_root: &Path, emulators_root: &Path, cfg: &EmulatorConfig) -> SystemInfo {
    let folder = roms_root.join(cfg.folder_name);
    let folder_exists = folder.is_dir();
    let mut libretro_core = libretro_core_for(cfg.id).to_string();
    let core_dll_exists = if libretro_core.is_empty() {
        false
    } else {
        resolve_cores_dir().map(|d| d.join(&libretro_core).is_file()).unwrap_or(false)
    };
    // Se mapeou pra libretro mas o DLL nao esta presente, cai pro emulador externo
    if !libretro_core.is_empty() && !core_dll_exists {
        libretro_core.clear();
    }
    let emulator_full = if libretro_core.is_empty() {
        emulators_root.join(cfg.emulator_rel)
    } else {
        resolve_cores_dir().map(|d| d.join(&libretro_core)).unwrap_or_default()
    };
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
                discs: None,
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
        // Multi-disc grouping pra sistemas de disco optico
        if matches!(cfg.id, "ps1" | "ps2" | "gc") {
            games = group_multidisc_games(games);
        } else {
            games.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
        }
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
        libretro_core,
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

    let rom_name = rom.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rom_path.clone());

    // Mata jogo anterior se existir
    kill_running_game_inner();

    let mut command = Command::new(&exe);
    for arg in cfg.launch_args {
        command.arg(arg);
    }
    command.arg(&rom_path);
    if let Some(parent) = exe.parent() {
        command.current_dir(parent);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const HIGH_PRIORITY_CLASS: u32 = 0x0000_0080;
        command.creation_flags(HIGH_PRIORITY_CLASS);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Falha ao executar emulador: {}", e))?;

    let pid = child.id();
    let started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let info = RunningGameInfo {
        pid,
        started_at,
        system_id: system_id.clone(),
        rom_path: rom_path.clone(),
        rom_name: rom_name.clone(),
    };

    // Incrementa total_launches imediatamente
    {
        let mut cfg_now = load_config();
        if let Some(active_id) = cfg_now.active_profile_id.clone() {
            if let Some(profile) = cfg_now.profiles.iter_mut().find(|p| p.id == active_id) {
                profile.total_launches = profile.total_launches.saturating_add(1);
                profile.last_played = Some(LastPlayed {
                    system_id: system_id.clone(),
                    rom_path: rom_path.clone(),
                    rom_name: rom_name.clone(),
                    at: started_at,
                });
                let _ = save_config_internal(cfg_now);
            }
        }
    }

    {
        let slot = running_game_slot();
        let mut guard = slot.lock().unwrap();
        *guard = Some(info.clone());
    }

    // Thread que faz wait() no Child e registra duracao quando o jogo termina
    std::thread::spawn(move || {
        let _ = child.wait();
        let ended_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(info.started_at);
        let duration = ended_at.saturating_sub(info.started_at);
        register_session_end(&info, duration);
        // Limpa o slot se ainda for esse jogo
        let slot = running_game_slot();
        let mut guard = slot.lock().unwrap();
        if let Some(current) = guard.as_ref() {
            if current.pid == info.pid {
                *guard = None;
            }
        }
    });

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
    let dir = base.join("Ludex").join("covers");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn screenshots_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Ludex").join("screenshots");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn details_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Ludex").join("details");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn token_path() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Ludex");
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct PlaySession {
    started_at: u64,
    duration_sec: u64,
    rom_path: String,
    rom_name: String,
    system_id: String,
}

/// Metadata pessoal do jogo: rating, status, notas. Uma entry por (system_id::rom_path).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct GameMeta {
    /// 0..=5 estrelas (0 = sem rating)
    rating: u8,
    /// "wishlist" | "playing" | "beat" | "mastered" | "abandoned" | "" (none)
    status: String,
    /// Notas livres do usuario
    notes: String,
    /// Timestamp Unix de quando foi marcado como "beat"/"mastered" (0 = nao marcado)
    completed_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Profile {
    id: String,
    name: String,
    photo_path: Option<String>,
    /// ID de um avatar default do Ludex (av-purple, av-pink, etc) escolhido no
    /// onboarding. Vazio se o user usou foto custom (photo_path) ou nao escolheu.
    avatar_id: Option<String>,
    created_at: u64,
    favorites: Vec<String>,
    play_time: std::collections::BTreeMap<String, u64>,
    total_launches: u32,
    achievements: Vec<String>,
    last_played: Option<LastPlayed>,
    sessions: Vec<PlaySession>,
    /// Metadata pessoal por jogo (chave = "system_id::rom_path")
    game_meta: std::collections::BTreeMap<String, GameMeta>,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            photo_path: None,
            avatar_id: None,
            created_at: 0,
            favorites: Vec::new(),
            play_time: std::collections::BTreeMap::new(),
            total_launches: 0,
            achievements: Vec::new(),
            last_played: None,
            sessions: Vec::new(),
            game_meta: std::collections::BTreeMap::new(),
        }
    }
}

/// Helper: obtem ou cria entry de game_meta no profile ativo, salva config.
fn update_active_game_meta<F: FnOnce(&mut GameMeta)>(
    system_id: &str,
    rom_path: &str,
    f: F,
) -> Result<(), String> {
    let mut cfg = load_config();
    let active_id = cfg.active_profile_id.clone().ok_or("nenhum profile ativo")?;
    let key = format!("{}::{}", system_id, rom_path);
    let profile = cfg.profiles.iter_mut().find(|p| p.id == active_id)
        .ok_or("profile ativo nao encontrado")?;
    let entry = profile.game_meta.entry(key).or_default();
    f(entry);
    save_config_internal(cfg)
}

fn save_config_internal(cfg: AppConfig) -> Result<(), String> {
    let path = config_path().ok_or("config path indisponivel")?;
    let content = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
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
    /// Tema customizado (paleta de cores escolhida pelo user)
    custom_theme: Option<CustomTheme>,
    /// Musica ambiente no menu
    music_enabled: bool,
    music_volume: f32,
    /// RetroAchievements: username + web API key (gerada em /controlpanel.php)
    ra_username: Option<String>,
    ra_api_key: Option<String>,
    /// Marca que o usuario completou o onboarding+criacao de perfil. Default false em
    /// configs novas/legadas; setado pelo front com complete_first_run() apos o tour.
    first_run_done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct CustomTheme {
    bg: String,
    surface: String,
    card: String,
    text: String,
    muted: String,
    border: String,
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
            custom_theme: None,
            music_enabled: true,
            music_volume: 0.35,
            ra_username: None,
            ra_api_key: None,
            first_run_done: false,
        }
    }
}

fn config_path() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Ludex");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("config.json"))
}

fn profiles_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Ludex").join("profiles");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn wallpapers_dir() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Ludex").join("wallpapers");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Migra config.json do Playbox antigo (%AppData%\Playbox) pro Ludex
/// (%AppData%\Ludex) na primeira vez que o Ludex roda. Tambem copia subpastas
/// de profiles e wallpapers se existirem. Marca first_run_done = true porque
/// pra um user de Playbox isso ja eh segunda execucao, nao primeira.
fn try_migrate_playbox_config() -> Option<AppConfig> {
    let base = dirs::data_dir()?;
    let old_dir = base.join("Playbox");
    let new_dir = base.join("Ludex");
    let old_config = old_dir.join("config.json");
    if !old_config.is_file() { return None; }
    let new_config = new_dir.join("config.json");
    if new_config.is_file() { return None; } // ja migrou ou ja existe

    log::info!("Migrando config do Playbox: {} -> {}", old_config.display(), new_config.display());
    let _ = std::fs::create_dir_all(&new_dir);

    // Copia config + atualiza first_run_done
    let data = std::fs::read_to_string(&old_config).ok()?;
    let mut cfg: AppConfig = serde_json::from_str(&data).ok()?;
    cfg.first_run_done = true;
    let _ = std::fs::write(&new_config, serde_json::to_string_pretty(&cfg).ok()?);

    // Copia profiles/ e wallpapers/ se existirem
    for sub in &["profiles", "wallpapers", "covers", "screenshots", "details"] {
        let src = old_dir.join(sub);
        let dst = new_dir.join(sub);
        if src.is_dir() && !dst.exists() {
            copy_dir_recursive(&src, &dst).ok();
        }
    }
    Some(cfg)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn load_config() -> AppConfig {
    if let Some(path) = config_path() {
        // Tenta migrar do Playbox antigo se config nao existe ainda
        if !path.is_file() {
            if let Some(migrated) = try_migrate_playbox_config() {
                return migrated;
            }
        }
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
    let dir = base.join("Ludex").join("profiles").join(profile_id).join("saves").join(emu_id);
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

/// Resolve a pasta de musica seguindo a mesma logica dos emuladores:
/// 1. <install_dir>/music/  (bundlado pelo instalador)
/// 2. <project_root>/music/  (dev: ao lado do exe em target/release)
fn resolve_music_dir() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("music");
            if bundled.is_dir() { return Some(bundled); }
            // dev: src-tauri/target/release/playbox.exe -> ../../../music
            let dev = parent.join("..").join("..").join("..").join("music");
            if dev.is_dir() { return Some(dev); }
        }
    }
    None
}

// ----- Libretro embedded -----

static LIBRETRO_CORE: OnceLock<Arc<StdMutex<Option<LibretroCore>>>> = OnceLock::new();

fn libretro_slot() -> Arc<StdMutex<Option<LibretroCore>>> {
    LIBRETRO_CORE.get_or_init(|| Arc::new(StdMutex::new(None))).clone()
}

/// Resolve a pasta de cores libretro:
/// 1. <install_dir>/cores/  (bundlado)
/// 2. <project_root>/cores/ (dev)
fn resolve_cores_dir() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("cores");
            if bundled.is_dir() { return Some(bundled); }
            let dev = parent.join("..").join("..").join("..").join("cores");
            if dev.is_dir() { return Some(dev); }
        }
    }
    None
}

#[tauri::command]
fn libretro_list_cores() -> Vec<String> {
    let Some(dir) = resolve_cores_dir() else { return Vec::new(); };
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()).map(|s| s.eq_ignore_ascii_case("dll")).unwrap_or(false) {
                out.push(p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string());
            }
        }
    }
    out.sort();
    out
}

#[derive(Serialize)]
struct LibretroLoadResult {
    library_name: String,
    library_version: String,
    base_width: u32,
    base_height: u32,
    fps: f64,
    sample_rate: f64,
}

#[tauri::command]
fn libretro_load_game(core_filename: String, rom_path: String) -> Result<LibretroLoadResult, String> {
    let cores_dir = resolve_cores_dir().ok_or("pasta cores nao encontrada")?;
    let core_path = cores_dir.join(&core_filename);
    if !core_path.is_file() {
        return Err(format!("core nao encontrado: {}", core_path.display()));
    }
    let rom = PathBuf::from(&rom_path);
    if !rom.is_file() {
        return Err(format!("ROM nao encontrada: {}", rom_path));
    }

    // Descarrega anterior se existe
    {
        let slot = libretro_slot();
        let mut g = slot.lock().unwrap();
        if let Some(prev) = g.take() {
            unsafe {
                prev.unload_game();
                prev.deinit();
            }
        }
    }

    let core = unsafe { LibretroCore::load(&core_path)? };
    unsafe {
        core.set_callbacks()?;
        core.init()?;
    }
    let (lib_name, lib_ver) = unsafe { core.system_info()? };
    let av_info = unsafe { core.load_game(&rom)? };

    // Guarda av_info no state pra render saber dimensoes
    {
        let s = libretro::state();
        let mut g = s.lock().unwrap();
        g.av_info = Some(libretro::RetroSystemAvInfo {
            geometry: libretro::RetroGameGeometry {
                base_width:   av_info.geometry.base_width,
                base_height:  av_info.geometry.base_height,
                max_width:    av_info.geometry.max_width,
                max_height:   av_info.geometry.max_height,
                aspect_ratio: av_info.geometry.aspect_ratio,
            },
            timing: libretro::RetroSystemTiming {
                fps:         av_info.timing.fps,
                sample_rate: av_info.timing.sample_rate,
            },
        });
    }

    let result = LibretroLoadResult {
        library_name: lib_name,
        library_version: lib_ver,
        base_width:  av_info.geometry.base_width,
        base_height: av_info.geometry.base_height,
        fps:         av_info.timing.fps,
        sample_rate: av_info.timing.sample_rate,
    };

    let slot = libretro_slot();
    let mut g = slot.lock().unwrap();
    *g = Some(core);
    Ok(result)
}

/// Roda 1 frame. Retorna Response binario: [u32 width LE][u32 height LE][rgba bytes].
/// Vazio se nao tem frame novo. Binary evita overhead de serializacao JSON do Vec<u8>.
#[tauri::command]
fn libretro_run_frame() -> tauri::ipc::Response {
    {
        let slot = libretro_slot();
        let g = slot.lock().unwrap();
        if let Some(core) = g.as_ref() {
            unsafe { let _ = core.run(); }
        } else {
            return tauri::ipc::Response::new(Vec::new());
        }
    }
    let s = libretro::state();
    let mut g = s.lock().unwrap();
    if let Some(f) = g.frame.take() {
        let mut buf = Vec::with_capacity(8 + f.rgba.len());
        buf.extend_from_slice(&f.width.to_le_bytes());
        buf.extend_from_slice(&f.height.to_le_bytes());
        buf.extend_from_slice(&f.rgba);
        tauri::ipc::Response::new(buf)
    } else {
        tauri::ipc::Response::new(Vec::new())
    }
}

/// Dreno do buffer de audio. Retorna bytes raw (i16 LE interleaved L,R,L,R...).
#[tauri::command]
fn libretro_take_audio() -> tauri::ipc::Response {
    let s = libretro::state();
    let mut g = s.lock().unwrap();
    if g.audio_buf.is_empty() {
        return tauri::ipc::Response::new(Vec::new());
    }
    // Drena tudo
    let n = g.audio_buf.len();
    let mut buf = Vec::with_capacity(n * 2);
    for sample in g.audio_buf.drain(..) {
        buf.extend_from_slice(&sample.to_le_bytes());
    }
    tauri::ipc::Response::new(buf)
}

#[tauri::command]
fn libretro_set_input(button_id: u32, pressed: bool) {
    if button_id >= 16 { return; }
    let s = libretro::state();
    let mut g = s.lock().unwrap();
    g.input_state[button_id as usize] = pressed;
}

fn save_state_path(rom_path: &str, slot: u32) -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Ludex").join("saves-libretro");
    std::fs::create_dir_all(&dir).ok()?;
    let stem = Path::new(rom_path).file_stem()?.to_string_lossy().to_string();
    let safe = sanitize_filename(&stem);
    Some(dir.join(format!("{}.slot{}.state", safe, slot)))
}

fn save_thumb_path(rom_path: &str, slot: u32) -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let dir = base.join("Ludex").join("saves-libretro");
    std::fs::create_dir_all(&dir).ok()?;
    let stem = Path::new(rom_path).file_stem()?.to_string_lossy().to_string();
    let safe = sanitize_filename(&stem);
    Some(dir.join(format!("{}.slot{}.png", safe, slot)))
}

#[tauri::command]
fn libretro_save_state(rom_path: String, slot: u32, thumbnail_png: Option<Vec<u8>>) -> Result<String, String> {
    let path = save_state_path(&rom_path, slot).ok_or("path indisponivel")?;
    let slot_lock = libretro_slot();
    let g = slot_lock.lock().unwrap();
    let core = g.as_ref().ok_or("nenhum core ativo")?;
    let bytes = unsafe { core.serialize()? };
    std::fs::write(&path, &bytes).map_err(|e| {
        log::error!("save_state: {}", e);
        format!("escrever state: {}", e)
    })?;
    if let Some(png) = thumbnail_png {
        if let Some(thumb) = save_thumb_path(&rom_path, slot) {
            let _ = std::fs::write(&thumb, &png);
        }
    }
    log::info!("save_state slot={} rom={}", slot, rom_path);
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn libretro_load_state(rom_path: String, slot: u32) -> Result<(), String> {
    let path = save_state_path(&rom_path, slot).ok_or("path indisponivel")?;
    if !path.is_file() {
        return Err(format!("nenhum save no slot {}", slot));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("ler state: {}", e))?;
    let slot_lock = libretro_slot();
    let g = slot_lock.lock().unwrap();
    let core = g.as_ref().ok_or("nenhum core ativo")?;
    let res = unsafe { core.unserialize(&bytes) };
    if let Err(ref e) = res {
        log::error!("load_state slot={}: {}", slot, e);
    } else {
        log::info!("load_state slot={} rom={}", slot, rom_path);
    }
    res
}

#[tauri::command]
fn libretro_state_exists(rom_path: String, slot: u32) -> bool {
    save_state_path(&rom_path, slot).map(|p| p.is_file()).unwrap_or(false)
}

#[derive(Serialize)]
struct SaveSlotInfo {
    slot: u32,
    modified_at: u64,
    thumbnail_path: Option<String>,
}

#[tauri::command]
fn libretro_list_states(rom_path: String) -> Vec<SaveSlotInfo> {
    let mut out = Vec::new();
    for slot in 0..10 {
        let Some(p) = save_state_path(&rom_path, slot) else { continue };
        if !p.is_file() { continue }
        let modified_at = std::fs::metadata(&p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let thumb = save_thumb_path(&rom_path, slot)
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().to_string());
        out.push(SaveSlotInfo { slot, modified_at, thumbnail_path: thumb });
    }
    out
}

#[tauri::command]
fn libretro_delete_state(rom_path: String, slot: u32) -> Result<(), String> {
    if let Some(p) = save_state_path(&rom_path, slot) {
        if p.is_file() { let _ = std::fs::remove_file(&p); }
    }
    if let Some(t) = save_thumb_path(&rom_path, slot) {
        if t.is_file() { let _ = std::fs::remove_file(&t); }
    }
    log::info!("delete_state slot={} rom={}", slot, rom_path);
    Ok(())
}

#[tauri::command]
fn libretro_unload() {
    let slot = libretro_slot();
    let mut g = slot.lock().unwrap();
    if let Some(core) = g.take() {
        unsafe {
            core.unload_game();
            core.deinit();
        }
    }
    // Limpa frame/audio/input
    let s = libretro::state();
    let mut sg = s.lock().unwrap();
    sg.frame = None;
    sg.input_state = [false; 16];
    sg.audio_buf.clear();
}

#[tauri::command]
fn list_music_tracks() -> Vec<String> {
    let Some(dir) = resolve_music_dir() else { return Vec::new(); };
    let mut tracks = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            let ext = p.extension().and_then(|x| x.to_str()).map(|s| s.to_lowercase()).unwrap_or_default();
            if matches!(ext.as_str(), "mp3" | "ogg" | "wav" | "m4a" | "flac") {
                tracks.push(p.to_string_lossy().to_string());
            }
        }
    }
    tracks.sort();
    tracks
}

fn app_log_dir() -> Option<PathBuf> {
    let base = dirs::data_local_dir().or_else(dirs::data_dir)?;
    Some(base.join("com.paulobatista.playbox").join("logs"))
}

#[tauri::command]
fn frontend_log(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!(target: "frontend", "{}", message),
        "warn"  => log::warn!(target: "frontend", "{}", message),
        "info"  => log::info!(target: "frontend", "{}", message),
        _       => log::debug!(target: "frontend", "{}", message),
    }
}

#[tauri::command]
fn get_app_log_dir() -> Result<String, String> {
    app_log_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or("data dir indisponivel".into())
}

#[tauri::command]
fn clear_app_logs() -> Result<u32, String> {
    let dir = app_log_dir().ok_or("data dir indisponivel")?;
    if !dir.is_dir() { return Ok(0); }
    let mut n = 0u32;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("log") {
                if std::fs::remove_file(&p).is_ok() { n += 1; }
            }
        }
    }
    log::info!("clear_app_logs: {} arquivos removidos", n);
    Ok(n)
}

#[tauri::command]
fn read_app_logs(max_lines: Option<usize>) -> Result<String, String> {
    let limit = max_lines.unwrap_or(200);
    // tauri-plugin-log salva em <log_dir>/<bundle_id>.log
    let base = dirs::data_local_dir().or_else(dirs::data_dir).ok_or("data dir indisponivel")?;
    let log_dir = base.join("gg.ludex.app").join("logs");
    let mut log_files: Vec<PathBuf> = Vec::new();
    if log_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&log_dir) {
            for e in entries.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some("log") {
                    log_files.push(p);
                }
            }
        }
    }
    if log_files.is_empty() {
        return Ok(format!("(nenhum log encontrado em {})", log_dir.display()));
    }
    // Pega o mais recente
    log_files.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    let latest = log_files.last().unwrap();
    let content = std::fs::read_to_string(latest).map_err(|e| format!("ler log: {}", e))?;
    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > limit { lines.len() - limit } else { 0 };
    Ok(lines[start..].join("\n"))
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

/// Marca que o onboarding + criacao de perfil terminaram. Chamado pelo front
/// no fim do FirstRunWizard. Configs antigas (Playbox v0.3.x) tem default false,
/// mas se ja existir um active_profile_id, o front trata como done.
#[tauri::command]
fn complete_first_run() -> Result<(), String> {
    let mut cfg = load_config();
    cfg.first_run_done = true;
    save_config_internal(cfg)
}

/// Estrutura de pastas por sistema: ROMs, DLCs, Mods/Patches.
/// Tudo fica em <roms_root>/<folder_name>/, com subpastas _DLC e _MODS criadas
/// on-demand. Underscore prefixo evita que o scanner pegue como ROM.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SystemFolders {
    system_id: String,
    system_name: String,
    roms_path: String,
    dlc_path: String,
    mods_path: String,
}

#[tauri::command]
fn get_system_folders(system_id: String) -> Result<SystemFolders, String> {
    let cfg = EMULATORS.iter().find(|c| c.id == system_id)
        .ok_or_else(|| format!("Sistema desconhecido: {}", system_id))?;
    let roms_root = current_roms_root();
    let base = roms_root.join(cfg.folder_name);
    let dlc = base.join("_DLC");
    let mods = base.join("_MODS");
    // Cria as pastas se nao existem (silenciosamente, ok se ja existir)
    let _ = std::fs::create_dir_all(&base);
    let _ = std::fs::create_dir_all(&dlc);
    let _ = std::fs::create_dir_all(&mods);
    Ok(SystemFolders {
        system_id: cfg.id.to_string(),
        system_name: cfg.name.to_string(),
        roms_path: base.to_string_lossy().to_string(),
        dlc_path: dlc.to_string_lossy().to_string(),
        mods_path: mods.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        // tenta criar (caso seja uma pasta nova nao escrita ainda)
        std::fs::create_dir_all(&p).map_err(|e| format!("criar pasta: {}", e))?;
    }
    Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("explorer.exe: {}", e))?;
    Ok(())
}

/// Abre uma URL no navegador padrao do user. Usado pra "Sugestoes de jogos"
/// que linka pra sites externos (vimms, romhacking, etc).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("URL invalida (precisa http/https)".into());
    }
    Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|e| format!("abrir url: {}", e))?;
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
        // Combos aceitos pra matar emulador externo: Select+Start (RetroArch padrao)
        // OU Select+R1 (combo recomendado, dificil de apertar acidentalmente).
        let mut select_held: std::collections::HashSet<gilrs::GamepadId> =
            std::collections::HashSet::new();
        let mut start_held: std::collections::HashSet<gilrs::GamepadId> =
            std::collections::HashSet::new();
        let mut r1_held: std::collections::HashSet<gilrs::GamepadId> =
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
                    ButtonPressed(Button::RightTrigger, _) => { r1_held.insert(id); }
                    ButtonReleased(Button::RightTrigger, _) => { r1_held.remove(&id); }
                    Disconnected => {
                        select_held.remove(&id);
                        start_held.remove(&id);
                        r1_held.remove(&id);
                    }
                    _ => {}
                }
                // Combo no MESMO controle: Select+Start OU Select+R1
                let combo = select_held.contains(&id)
                    && (start_held.contains(&id) || r1_held.contains(&id));
                if combo {
                    let now = std::time::Instant::now();
                    if now.duration_since(last_kill) < std::time::Duration::from_millis(1500) {
                        continue;
                    }
                    last_kill = now;
                    select_held.remove(&id);
                    start_held.remove(&id);
                    r1_held.remove(&id);
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
// ============================================================
// === GAME PERSONAL METADATA — rating, status, notes ========
// ============================================================

#[tauri::command]
fn set_game_rating(system_id: String, rom_path: String, rating: u8) -> Result<(), String> {
    let r = rating.min(5);
    update_active_game_meta(&system_id, &rom_path, |m| { m.rating = r; })
}

#[tauri::command]
fn set_game_status(system_id: String, rom_path: String, status: String) -> Result<(), String> {
    let valid = ["", "wishlist", "playing", "beat", "mastered", "abandoned"];
    if !valid.contains(&status.as_str()) {
        return Err(format!("status invalido: {}", status));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    update_active_game_meta(&system_id, &rom_path, |m| {
        let was_completed = m.status == "beat" || m.status == "mastered";
        let will_be_completed = status == "beat" || status == "mastered";
        m.status = status;
        if will_be_completed && !was_completed {
            m.completed_at = now;
        } else if !will_be_completed {
            m.completed_at = 0;
        }
    })
}

#[tauri::command]
fn set_game_notes(system_id: String, rom_path: String, notes: String) -> Result<(), String> {
    let trimmed = notes.chars().take(4000).collect::<String>();
    update_active_game_meta(&system_id, &rom_path, |m| { m.notes = trimmed; })
}

// ============================================================
// === RANDOM GAME — sorteia jogo entre todos os scaneados ===
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RandomGamePick {
    system_id: String,
    rom_path: String,
    rom_name: String,
}

#[tauri::command]
fn pick_random_game(roms_root: Option<String>) -> Option<RandomGamePick> {
    use std::time::SystemTime;
    let systems = scan_roms(roms_root);
    let mut pool: Vec<RandomGamePick> = Vec::new();
    for sys in systems {
        for game in sys.games {
            pool.push(RandomGamePick {
                system_id: sys.id.clone(),
                rom_path: game.path.clone(),
                rom_name: game.name.clone(),
            });
        }
    }
    if pool.is_empty() { return None; }
    // PRNG simples baseada em timestamp nanos (sem dep externa)
    let nanos = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1);
    let idx = (nanos.wrapping_mul(2862933555777941757).wrapping_add(3037000493)) as usize % pool.len();
    pool.into_iter().nth(idx)
}

// ============================================================
// === PLAY STATS — agregados de playtime do profile ativo ===
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TopGameStat {
    system_id: String,
    rom_path: String,
    rom_name: String,
    seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlayStats {
    total_play_seconds: u64,
    total_launches: u32,
    total_sessions: u32,
    distinct_games_played: u32,
    top_games: Vec<TopGameStat>,
    recent_sessions: Vec<PlaySession>,
    last_played: Option<LastPlayed>,
}

#[tauri::command]
fn get_play_stats() -> PlayStats {
    let cfg = load_config();
    let active_id = match cfg.active_profile_id.clone() {
        Some(id) => id,
        None => return PlayStats {
            total_play_seconds: 0, total_launches: 0, total_sessions: 0,
            distinct_games_played: 0, top_games: Vec::new(),
            recent_sessions: Vec::new(), last_played: None,
        },
    };
    let profile = match cfg.profiles.iter().find(|p| p.id == active_id) {
        Some(p) => p,
        None => return PlayStats {
            total_play_seconds: 0, total_launches: 0, total_sessions: 0,
            distinct_games_played: 0, top_games: Vec::new(),
            recent_sessions: Vec::new(), last_played: None,
        },
    };

    let total_play_seconds: u64 = profile.play_time.values().sum();
    let distinct_games_played = profile.play_time.iter().filter(|(_, &s)| s > 0).count() as u32;

    // Top 5 jogos. Tenta resolver rom_name a partir das sessions (mais recente).
    let mut name_lookup: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for s in profile.sessions.iter().rev() {
        let key = format!("{}::{}", s.system_id, s.rom_path);
        name_lookup.entry(key).or_insert_with(|| s.rom_name.clone());
    }

    let mut top_pairs: Vec<(String, u64)> = profile.play_time.iter()
        .filter(|(_, &s)| s > 0)
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    top_pairs.sort_by(|a, b| b.1.cmp(&a.1));
    top_pairs.truncate(5);

    let top_games: Vec<TopGameStat> = top_pairs.into_iter().map(|(key, seconds)| {
        let (system_id, rom_path) = match key.split_once("::") {
            Some((sid, rp)) => (sid.to_string(), rp.to_string()),
            None => (String::new(), key.clone()),
        };
        let rom_name = name_lookup.get(&key)
            .cloned()
            .or_else(|| {
                std::path::Path::new(&rom_path).file_stem()
                    .map(|s| s.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| rom_path.clone());
        TopGameStat { system_id, rom_path, rom_name, seconds }
    }).collect();

    // Ultimas 10 sessoes
    let mut recent_sessions: Vec<PlaySession> = profile.sessions.iter().rev().take(10).cloned().collect();
    recent_sessions.reverse();

    PlayStats {
        total_play_seconds,
        total_launches: profile.total_launches,
        total_sessions: profile.sessions.len() as u32,
        distinct_games_played,
        top_games,
        recent_sessions,
        last_played: profile.last_played.clone(),
    }
}

// ============================================================
// === RETROACHIEVEMENTS — login + summary + recent ach ======
// ============================================================
// Web API key gerada em https://retroachievements.org/controlpanel.php
// Endpoints: https://retroachievements.org/API/

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RaRecentAchievement {
    title: String,
    description: String,
    points: i32,
    badge_url: String,
    game_title: String,
    game_id: u32,
    console_name: String,
    date_iso: String,
    hardcore: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RaSummary {
    authenticated: bool,
    username: String,
    avatar_url: String,
    total_points: i32,
    softcore_points: i32,
    rank: i32,
    total_ranked: i32,
    member_since: String,
    recent_achievements: Vec<RaRecentAchievement>,
    last_game_title: String,
    last_game_image_url: String,
    rich_presence_msg: String,
}

fn ra_creds_from_cfg(cfg: &AppConfig) -> Option<(String, String)> {
    let u = cfg.ra_username.clone()?;
    let k = cfg.ra_api_key.clone()?;
    if u.is_empty() || k.is_empty() { return None; }
    Some((u, k))
}

async fn ra_fetch_summary_internal(username: &str, api_key: &str) -> Result<RaSummary, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Ludex/0.4 (RA-companion)")
        .build()
        .map_err(|e| format!("http client: {}", e))?;

    // 1) GetUserSummary
    let url = format!(
        "https://retroachievements.org/API/API_GetUserSummary.php?u={}&y={}&g=1&a=10",
        urlencode(username), urlencode(api_key)
    );
    let resp = client.get(&url).send().await
        .map_err(|e| format!("ra summary req: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("ra summary body: {}", e))?;
    if !status.is_success() {
        return Err(format!("ra summary HTTP {}: {}", status, text.chars().take(200).collect::<String>()));
    }
    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("ra summary json: {} (body: {})", e, text.chars().take(120).collect::<String>()))?;

    // RA retorna 200 com {"User":null} se invalid, ou erro string. Detecta:
    if v.get("User").map(|u| u.is_null()).unwrap_or(true) && v.get("RecentAchievements").is_none() {
        return Err("Credenciais invalidas (RA respondeu sem User).".to_string());
    }

    let user = v.get("User").and_then(|x| x.as_str()).unwrap_or(username).to_string();
    let total_points = v.get("TotalPoints").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
    let softcore = v.get("TotalSoftcorePoints").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
    let rank = v.get("Rank").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
    let total_ranked = v.get("TotalRanked").and_then(|x| x.as_i64())
        .or_else(|| v.get("TotalRanked").and_then(|x| x.as_str()).and_then(|s| s.parse().ok()))
        .unwrap_or(0) as i32;
    let member_since = v.get("MemberSince").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let rich = v.get("RichPresenceMsg").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let last_game_title = v.get("LastGame")
        .and_then(|g| g.get("Title"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let last_game_img = v.get("LastGame")
        .and_then(|g| g.get("ImageIcon"))
        .and_then(|x| x.as_str())
        .map(|p| if p.starts_with("http") { p.to_string() } else { format!("https://retroachievements.org{}", p) })
        .unwrap_or_default();

    // 2) GetUserRecentAchievements (ultimas 24h, ate 50)
    let url2 = format!(
        "https://retroachievements.org/API/API_GetUserRecentAchievements.php?u={}&y={}&m=1440&c=20",
        urlencode(username), urlencode(api_key)
    );
    let recent: Vec<RaRecentAchievement> = match client.get(&url2).send().await {
        Ok(r) => match r.text().await {
            Ok(t) => parse_recent_achievements(&t),
            Err(_) => Vec::new(),
        },
        Err(_) => Vec::new(),
    };

    Ok(RaSummary {
        authenticated: true,
        username: user.clone(),
        avatar_url: format!("https://media.retroachievements.org/UserPic/{}.png", user),
        total_points,
        softcore_points: softcore,
        rank,
        total_ranked,
        member_since,
        recent_achievements: recent,
        last_game_title,
        last_game_image_url: last_game_img,
        rich_presence_msg: rich,
    })
}

fn parse_recent_achievements(text: &str) -> Vec<RaRecentAchievement> {
    let v: serde_json::Value = match serde_json::from_str(text) { Ok(v) => v, Err(_) => return Vec::new() };
    let arr = match v.as_array() { Some(a) => a, None => return Vec::new() };
    arr.iter().map(|a| {
        let badge = a.get("BadgeName").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let badge_url = if badge.is_empty() {
            String::new()
        } else {
            format!("https://media.retroachievements.org/Badge/{}.png", badge)
        };
        RaRecentAchievement {
            title: a.get("Title").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            description: a.get("Description").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            points: a.get("Points").and_then(|x| x.as_i64())
                .or_else(|| a.get("Points").and_then(|x| x.as_str()).and_then(|s| s.parse().ok()))
                .unwrap_or(0) as i32,
            badge_url,
            game_title: a.get("GameTitle").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            game_id: a.get("GameID").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
            console_name: a.get("ConsoleName").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            date_iso: a.get("Date").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            hardcore: a.get("HardcoreMode").and_then(|x| x.as_i64()).map(|n| n == 1).unwrap_or(false),
        }
    }).collect()
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[tauri::command]
async fn ra_save_credentials(username: String, api_key: String) -> Result<RaSummary, String> {
    let u = username.trim().to_string();
    let k = api_key.trim().to_string();
    if u.is_empty() || k.is_empty() {
        return Err("username/api_key vazios".to_string());
    }
    // Valida antes de salvar
    let summary = ra_fetch_summary_internal(&u, &k).await?;
    let mut cfg = load_config();
    cfg.ra_username = Some(u);
    cfg.ra_api_key = Some(k);
    save_config_internal(cfg)?;
    Ok(summary)
}

#[tauri::command]
fn ra_clear_credentials() -> Result<(), String> {
    let mut cfg = load_config();
    cfg.ra_username = None;
    cfg.ra_api_key = None;
    save_config_internal(cfg)
}

#[tauri::command]
async fn ra_get_summary() -> Result<RaSummary, String> {
    let cfg = load_config();
    let (u, k) = ra_creds_from_cfg(&cfg).ok_or("RA nao configurado")?;
    ra_fetch_summary_internal(&u, &k).await
}

// ============================================================
// === SYSTEM HEALTH CHECK — diagnostica setup de cada emu ===
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SystemHealth {
    system_id: String,
    system_name: String,
    /// "ok" | "warn" | "error"
    status: String,
    /// Emulador externo encontrado (.exe presente)
    emulator_present: bool,
    emulator_path: String,
    /// Quantas ROMs detectadas
    rom_count: u32,
    /// Lista de avisos / erros pra mostrar ao user
    issues: Vec<String>,
    /// Lista de checks que passaram
    checks_ok: Vec<String>,
}

#[tauri::command]
fn system_health_check() -> Vec<SystemHealth> {
    let emu_root = current_emulators_root();
    let roms_root = current_roms_root();
    let scanned = scan_roms(Some(roms_root.to_string_lossy().to_string()));
    let mut out = Vec::new();
    for cfg in EMULATORS.iter() {
        let exe = emu_root.join(cfg.emulator_rel);
        let emulator_present = exe.is_file();
        let emulator_path = exe.to_string_lossy().to_string();
        let scan_match = scanned.iter().find(|s| s.id == cfg.id);
        let rom_count = scan_match.map(|s| s.games.len() as u32).unwrap_or(0);
        let mut issues: Vec<String> = Vec::new();
        let mut checks_ok: Vec<String> = Vec::new();

        if emulator_present {
            checks_ok.push(format!("Emulador encontrado em {}", cfg.emulator_rel));
        } else {
            issues.push(format!("Emulador {}.exe NAO encontrado em {}", cfg.name, cfg.emulator_rel));
        }

        if rom_count > 0 {
            checks_ok.push(format!("{} ROMs detectadas", rom_count));
        } else {
            issues.push(format!("Nenhuma ROM em pasta {}/", cfg.folder_name));
        }

        // Check BIOS pra Xbox (xemu)
        if cfg.id == "xbox" {
            let bios_dir = emu_root.join(cfg.folder_name).join("bios");
            let mcpx = bios_dir.join("mcpx_1.0.bin");
            let complex = bios_dir.join("complex_4627.bin");
            let hdd = bios_dir.join("xbox_hdd.qcow2");
            if mcpx.is_file() && complex.is_file() && hdd.is_file() {
                checks_ok.push("3 BIOS files Xbox presentes (mcpx + complex + qcow2)".to_string());
            } else {
                let mut missing = Vec::new();
                if !mcpx.is_file() { missing.push("mcpx_1.0.bin"); }
                if !complex.is_file() { missing.push("complex_4627.bin"); }
                if !hdd.is_file() { missing.push("xbox_hdd.qcow2"); }
                issues.push(format!("BIOS Xbox faltando: {}", missing.join(", ")));
            }
        }

        let status = if !issues.is_empty() && !emulator_present {
            "error".to_string()
        } else if !issues.is_empty() {
            "warn".to_string()
        } else {
            "ok".to_string()
        };

        out.push(SystemHealth {
            system_id: cfg.id.to_string(),
            system_name: cfg.name.to_string(),
            status,
            emulator_present,
            emulator_path,
            rom_count,
            issues,
            checks_ok,
        });
    }
    out
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Plugin de log sempre ativo (release tambem) — antes so debug, sem arquivo de log em prod
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    ])
                    .max_file_size(2_000_000) // 2MB rotation
                    .build(),
            )?;
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
            read_app_logs,
            list_music_tracks,
            libretro_list_cores,
            libretro_load_game,
            libretro_run_frame,
            libretro_take_audio,
            libretro_set_input,
            libretro_save_state,
            libretro_load_state,
            libretro_state_exists,
            libretro_list_states,
            libretro_delete_state,
            libretro_unload,
            frontend_log,
            get_app_log_dir,
            clear_app_logs,
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
            setup_switch_keys,
            set_game_rating,
            set_game_status,
            set_game_notes,
            pick_random_game,
            system_health_check,
            get_play_stats,
            ra_save_credentials,
            ra_clear_credentials,
            ra_get_summary,
            complete_first_run,
            get_system_folders,
            open_folder,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
