mod libretro;
#[cfg(windows)]
mod gl_context;
// v0.9.17: backend EGL/GLES3 do hw_render no Android (mesma interface do gl_context).
#[cfg(target_os = "android")]
#[path = "gl_context_android.rs"]
mod gl_context;
use libretro::LibretroCore;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use walkdir::WalkDir;

// =============================================================================
// Discord Rich Presence — SO desktop (Windows/Linux/macOS).
// Em Android/iOS, os tauri::commands existem como no-op pra frontend continuar
// chamando sem crash. Mobile nao tem Discord client local pra fazer IPC.
// =============================================================================

#[cfg(not(any(target_os = "android", target_os = "ios")))]
static DISCORD_CLIENT: OnceLock<StdMutex<Option<DiscordIpcClient>>> = OnceLock::new();

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn discord_slot() -> &'static StdMutex<Option<DiscordIpcClient>> {
    DISCORD_CLIENT.get_or_init(|| StdMutex::new(None))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn discord_set_app_id(app_id: Option<String>) -> Result<bool, String> {
    let mut cfg = load_config();
    cfg.discord_app_id = app_id.filter(|s| !s.is_empty());
    save_config(cfg)?;
    Ok(discord_connect_internal().is_ok())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
    let state_text = format!("via Ludex · {}", system_name);
    let activity = Activity::new()
        .details(&details_text)
        .state(&state_text)
        .assets(Assets::new().large_image("ludex").large_text("Ludex Launcher"))
        .timestamps(Timestamps::new().start(now));
    if let Err(e) = client.set_activity(activity) {
        eprintln!("discord set_activity: {}", e);
        // se falhou, fecha o client pra reconectar na proxima
        let _ = client.close();
        *slot = None;
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn discord_clear_activity() -> Result<(), String> {
    let mut slot = discord_slot().lock().unwrap();
    if let Some(client) = slot.as_mut() {
        let _ = client.clear_activity();
    }
    Ok(())
}

// Stubs no-op pro Android/iOS — frontend pode chamar sem crash
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn discord_connect() -> Result<bool, String> { Ok(false) }
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn discord_set_app_id(_app_id: Option<String>) -> Result<bool, String> { Ok(false) }
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn discord_set_activity(_game_name: String, _system_name: String) -> Result<(), String> { Ok(()) }
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn discord_clear_activity() -> Result<(), String> { Ok(()) }

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
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
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

// Extensao do core libretro por plataforma. v0.7.3+: suporte Android (.so ARM64).
#[cfg(target_os = "windows")]
const CORE_EXT: &str = ".dll";
#[cfg(any(target_os = "linux", target_os = "android"))]
const CORE_EXT: &str = ".so";
#[cfg(target_os = "macos")]
const CORE_EXT: &str = ".dylib";

/// Mapeia sistema -> nome base do core libretro embarcado (sem extensao).
/// Sistemas que retornam string vazia rodam via emulador externo (caminho original).
/// Em Android, PS2 nao tem core .so (pcsx2 libretro nao tem build ARM) — fica vazio.
fn libretro_core_for(system_id: &str) -> String {
    let base: &str = match system_id {
        // ja existiam (v0.6.7-)
        "snes" => "snes9x_libretro",
        "gba"  => "mgba_libretro",
        "nes"  => "nestopia_libretro",
        "gb"   => "gambatte_libretro",
        "gbc"  => "gambatte_libretro",
        "md"   => "genesis_plus_gx_libretro",
        "n64"  => "mupen64plus_next_libretro",
        "ps1"  => "swanstation_libretro",
        // migrados externo -> embedded em v0.7.1
        "wii"  => "dolphin_libretro",
        "gc"   => "dolphin_libretro",
        "ps2"  => {
            // PS2 (PCSX2 libretro) — NOSSO emulador embedded (libretro core).
            // v0.8.26 mudou pra standalone errado; v0.8.27 reverte + fix need_fullpath
            // e LOG_INTERFACE em libretro.rs (causas reais do segfault anterior).
            // Android nao tem build ARM disponivel.
            #[cfg(target_os = "android")]
            { return String::new(); }
            #[cfg(not(target_os = "android"))]
            "pcsx2_libretro"
        }
        // novos em v0.7.0
        "dreamcast" => "flycast_libretro",
        "psp"       => "ppsspp_libretro",
        "ds"        => "melonds_libretro",
        "saturn"    => "mednafen_saturn_libretro",
        // v0.8.33: 3DS migrado de Citra externo pra libretro embedded
        "3ds"       => "citra_libretro",
        // Sega extras reusam o core do MD (cobre SMS/GG/SegaCD/SG-1000)
        "sms"       => "genesis_plus_gx_libretro",
        "gg"        => "genesis_plus_gx_libretro",
        "segacd"    => "genesis_plus_gx_libretro",
        "arcade"    => "mame_libretro",
        "tg16"      => "mednafen_pce_libretro",
        "a2600"     => "stella_libretro",
        "lynx"      => "beetle_lynx_libretro",
        "ws"        => "beetle_wswan_libretro",
        "vb"        => "beetle_vb_libretro",
        "ngpc"      => "beetle_ngp_libretro",
        "msx"       => "bluemsx_libretro",
        "c64"       => "vice_x64_libretro",
        "zx"        => "fuse_libretro",
        "amiga"     => "puae_libretro",
        "threedo"   => "opera_libretro",
        "jaguar"    => "virtualjaguar_libretro",
        _ => return String::new(),
    };
    format!("{}{}", base, CORE_EXT)
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
        emulator_rel: "",  // v0.8.33: libretro embarcado (citra) — migrado de Citra externo
        extensions: &["3ds", "cci", "cxi", "3dsx", "app", "elf", "axf", "cia"],
        launch_args: &[],
        igdb_platform: 37,
    },
    EmulatorConfig {
        id: "wii",
        name: "WII",
        color: "#0094d9",
        folder_name: "WII",
        emulator_rel: "",  // libretro embarcado (dolphin) — v0.7.1 migrou de Dolphin.exe
        extensions: &["iso", "wbfs", "rvz", "wad"],
        launch_args: &[],
        igdb_platform: 5,
    },
    EmulatorConfig {
        id: "gc",
        name: "GAMECUBE",
        color: "#6c4ab6",
        folder_name: "GAMECUBE",
        emulator_rel: "",  // libretro embarcado (dolphin) — v0.7.1 migrou de Dolphin.exe
        extensions: &["iso", "gcm", "rvz", "gcz"],
        launch_args: &[],
        igdb_platform: 21,
    },
    EmulatorConfig {
        id: "n64",
        name: "NINTENDO 64",
        color: "#22c55e",
        folder_name: "N64",
        emulator_rel: "",  // libretro embarcado (mupen64plus_next) — v0.7.1 migrou de Project64.exe
        extensions: &["n64", "z64", "v64", "rom"],
        launch_args: &[],
        igdb_platform: 4,
    },
    EmulatorConfig {
        id: "gba",
        name: "GAME BOY ADVANCE",
        color: "#a855f7",
        folder_name: "GBA",
        emulator_rel: "",  // libretro embarcado (mgba) — v0.7.1 migrou de mGBA.exe
        extensions: &["gba", "zip"],
        launch_args: &[],
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
        // v0.8.27: NOSSO libretro embedded (pcsx2_libretro). Standalone era
        // workaround errado — segfault era por falta de need_fullpath + log_interface.
        emulator_rel: "",
        extensions: &["iso", "chd", "cue", "bin"],
        launch_args: &[],
        igdb_platform: 8,
    },
    EmulatorConfig {
        id: "ps1",
        name: "PLAYSTATION",
        color: "#7c3aed",
        folder_name: "PS1",
        emulator_rel: "",  // libretro embarcado (swanstation — fork do duckstation) — v0.7.1 migrou de DuckStation.exe
        extensions: &["cue", "bin", "chd", "pbp", "iso"],
        launch_args: &[],
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
        id: "xbox360",
        name: "XBOX 360",
        color: "#5ec01a",
        folder_name: "XBOX360",
        emulator_rel: "XBOX360\\xenia.exe",
        extensions: &["iso", "xex", "zar"],
        launch_args: &[],
        igdb_platform: 12,
    },
    EmulatorConfig {
        id: "vita",
        name: "PS VITA",
        color: "#003791",
        folder_name: "VITA",
        emulator_rel: "VITA\\Vita3K.exe",
        extensions: &["vpk", "self", "elf"],
        launch_args: &[],
        igdb_platform: 46,
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
    // ========================================
    // === NOVOS sistemas embedded (v0.7.0) ===
    // ========================================
    EmulatorConfig {
        id: "dreamcast",
        name: "DREAMCAST",
        color: "#ff6600",
        folder_name: "DREAMCAST",
        emulator_rel: "",  // libretro embarcado (flycast)
        extensions: &["cdi", "gdi", "chd", "cue", "m3u"],
        launch_args: &[],
        igdb_platform: 23,
    },
    EmulatorConfig {
        id: "psp",
        name: "PSP",
        color: "#003791",
        folder_name: "PSP",
        emulator_rel: "",  // libretro embarcado (ppsspp)
        extensions: &["iso", "cso", "pbp", "elf"],
        launch_args: &[],
        igdb_platform: 38,
    },
    EmulatorConfig {
        id: "ds",
        name: "NINTENDO DS",
        color: "#dc2626",
        folder_name: "DS",
        emulator_rel: "",  // libretro embarcado (melonds)
        extensions: &["nds"],
        launch_args: &[],
        igdb_platform: 20,
    },
    EmulatorConfig {
        id: "saturn",
        name: "SATURN",
        color: "#7c3aed",
        folder_name: "SATURN",
        emulator_rel: "",  // libretro embarcado (mednafen_saturn)
        extensions: &["cue", "chd", "mds", "ccd", "m3u", "iso"],
        launch_args: &[],
        igdb_platform: 32,
    },
    EmulatorConfig {
        id: "sms",
        name: "MASTER SYSTEM",
        color: "#dc2626",
        folder_name: "MASTERSYSTEM",
        emulator_rel: "",  // libretro embarcado (genesis_plus_gx)
        extensions: &["sms", "zip"],
        launch_args: &[],
        igdb_platform: 64,
    },
    EmulatorConfig {
        id: "gg",
        name: "GAME GEAR",
        color: "#27272a",
        folder_name: "GAMEGEAR",
        emulator_rel: "",  // libretro embarcado (genesis_plus_gx)
        extensions: &["gg", "zip"],
        launch_args: &[],
        igdb_platform: 35,
    },
    EmulatorConfig {
        id: "segacd",
        name: "SEGA CD",
        color: "#b91c1c",
        folder_name: "SEGACD",
        emulator_rel: "",  // libretro embarcado (genesis_plus_gx)
        extensions: &["cue", "iso", "chd", "m3u", "bin"],
        launch_args: &[],
        igdb_platform: 78,
    },
    EmulatorConfig {
        id: "arcade",
        name: "ARCADE",
        color: "#fbbf24",
        folder_name: "ARCADE",
        emulator_rel: "",  // libretro embarcado (mame)
        extensions: &["zip", "7z", "chd"],
        launch_args: &[],
        igdb_platform: 52,
    },
    EmulatorConfig {
        id: "tg16",
        name: "TURBOGRAFX-16",
        color: "#dc2626",
        folder_name: "TG16",
        emulator_rel: "",  // libretro embarcado (mednafen_pce)
        extensions: &["pce", "sgx", "cue", "ccd", "chd", "zip"],
        launch_args: &[],
        igdb_platform: 86,
    },
    EmulatorConfig {
        id: "a2600",
        name: "ATARI 2600",
        color: "#dc2626",
        folder_name: "ATARI2600",
        emulator_rel: "",  // libretro embarcado (stella)
        extensions: &["a26", "bin", "rom"],
        launch_args: &[],
        igdb_platform: 59,
    },
    EmulatorConfig {
        id: "lynx",
        name: "ATARI LYNX",
        color: "#8b5cf6",
        folder_name: "LYNX",
        emulator_rel: "",  // libretro embarcado (beetle_lynx)
        extensions: &["lnx", "lyx", "zip"],
        launch_args: &[],
        igdb_platform: 61,
    },
    EmulatorConfig {
        id: "ws",
        name: "WONDERSWAN",
        color: "#27272a",
        folder_name: "WONDERSWAN",
        emulator_rel: "",  // libretro embarcado (beetle_wswan)
        extensions: &["ws", "wsc"],
        launch_args: &[],
        igdb_platform: 57,
    },
    EmulatorConfig {
        id: "vb",
        name: "VIRTUAL BOY",
        color: "#dc2626",
        folder_name: "VIRTUALBOY",
        emulator_rel: "",  // libretro embarcado (beetle_vb)
        extensions: &["vb", "vboy", "bin"],
        launch_args: &[],
        igdb_platform: 87,
    },
    EmulatorConfig {
        id: "ngpc",
        name: "NEO GEO POCKET",
        color: "#f97316",
        folder_name: "NGPC",
        emulator_rel: "",  // libretro embarcado (beetle_ngp)
        extensions: &["ngp", "ngc", "zip"],
        launch_args: &[],
        igdb_platform: 119,
    },
    EmulatorConfig {
        id: "msx",
        name: "MSX",
        color: "#0078d4",
        folder_name: "MSX",
        emulator_rel: "",  // libretro embarcado (bluemsx)
        extensions: &["rom", "mx1", "mx2", "dsk", "ri", "cas"],
        launch_args: &[],
        igdb_platform: 27,
    },
    EmulatorConfig {
        id: "c64",
        name: "COMMODORE 64",
        color: "#a16207",
        folder_name: "C64",
        emulator_rel: "",  // libretro embarcado (vice_x64)
        extensions: &["d64", "t64", "prg", "x64", "crt"],
        launch_args: &[],
        igdb_platform: 15,
    },
    EmulatorConfig {
        id: "zx",
        name: "ZX SPECTRUM",
        color: "#27272a",
        folder_name: "ZXSPECTRUM",
        emulator_rel: "",  // libretro embarcado (fuse)
        extensions: &["tap", "tzx", "z80", "sna", "scl", "trd"],
        launch_args: &[],
        igdb_platform: 26,
    },
    EmulatorConfig {
        id: "amiga",
        name: "AMIGA",
        color: "#dc2626",
        folder_name: "AMIGA",
        emulator_rel: "",  // libretro embarcado (puae)
        extensions: &["adf", "ipf", "dms", "adz", "hdf"],
        launch_args: &[],
        igdb_platform: 16,
    },
    EmulatorConfig {
        id: "threedo",
        name: "3DO",
        color: "#0ea5e9",
        folder_name: "3DO",
        emulator_rel: "",  // libretro embarcado (opera)
        extensions: &["iso", "cue", "chd"],
        launch_args: &[],
        igdb_platform: 50,
    },
    EmulatorConfig {
        id: "jaguar",
        name: "ATARI JAGUAR",
        color: "#27272a",
        folder_name: "JAGUAR",
        emulator_rel: "",  // libretro embarcado (virtualjaguar)
        extensions: &["j64", "jag", "rom"],
        launch_args: &[],
        igdb_platform: 62,
    },
    // v0.9.1: sistema "retro" removido. Era um fallback que abria RetroArch externo,
    // mas agora todos os sistemas listados acima ja tem libretro embarcado. Manter
    // confundia o user (tentava abrir um app externo que nao existe na pasta Ludex).
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
    // Android: default em /storage/emulated/0/Ludex/roms/ (acessivel sem SAF)
    #[cfg(target_os = "android")]
    {
        let candidates = [
            PathBuf::from("/storage/emulated/0/Ludex/roms"),
            PathBuf::from("/storage/emulated/0/Download/Ludex"),
            PathBuf::from("/storage/emulated/0/RetroArch/roms"),
        ];
        for c in candidates.iter() {
            if c.is_dir() { return c.clone(); }
        }
        // Cria a pasta default se nao existe (precisa permissao MANAGE_EXTERNAL_STORAGE)
        let default = PathBuf::from("/storage/emulated/0/Ludex/roms");
        let _ = std::fs::create_dir_all(&default);
        return default;
    }
    #[cfg(not(target_os = "android"))]
    {
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

/// Extensoes que multiplos sistemas aceitam — em scan flat (sem subpasta),
/// essas exigem que o nome do arquivo/pasta mencione o sistema pra evitar
/// que .iso apareca em PS1+PS2+Wii+GC+Saturn+Dreamcast+PSP+3DO simultaneamente.
fn is_generic_extension(ext: &str) -> bool {
    matches!(ext, "iso" | "bin" | "img" | "zip" | "7z" | "chd" | "cue"
        | "pbp" | "m3u" | "mds" | "ccd" | "rom")
}

/// v0.9.20: identifica o sistema-dono de um arquivo de disco lendo o conteudo
/// (nao o nome). Antes o scanner em modo flat (Android) precisava de keyword
/// "ps1"/"psx" no nome -> jogos de PS1/PSP sem keyword nao apareciam ("PSP nao
/// identifica jogos"). Agora detectamos por header.
///
/// Magic words:
///   Wii      0x5D1C9EA3 @ 0x18 (raw) ou 0x58+0x18 (RVZ/WIA)
///   GameCube 0xC2339F3D @ 0x1C (raw) ou 0x58+0x1C (RVZ/WIA)
/// Outros sao identificados por strings no SYSTEM.CNF / volume:
///   PS2      "BOOT2"
///   PS1      "cdrom:\" (mas NAO BOOT2)
///   PSP      "UMD_DATA.BIN" / "PSP_GAME"
///   Saturn   "SEGA SATURN"
///   SegaCD   "SEGADISCSYSTEM"
/// Extensoes que ja apontam pra UM sistema retornam direto (sem ler).
///
/// .cue e um text descriptor — abre o .bin referenciado e sniff nele.
fn detect_disc_system(path: &Path, ext: &str) -> Option<&'static str> {
    use std::io::Read;
    match ext {
        "wbfs" | "wad"  => return Some("wii"),
        "gcm" | "gcz"   => return Some("gc"),
        "gdi" | "cdi"   => return Some("dreamcast"),
        "pbp" | "cso"   => return Some("psp"),
        _ => {}
    }
    // .cue: redireciona pro .bin da Track 01
    let sniff_path: PathBuf = if ext == "cue" {
        match read_cue_first_track(path) { Some(p) => p, None => return None }
    } else { path.to_path_buf() };
    let mut f = std::fs::File::open(&sniff_path).ok()?;
    let mut head = [0u8; 0x80];
    if f.read_exact(&mut head).is_err() { return None; }
    let base = if &head[0..4] == b"RVZ\x01" || &head[0..4] == b"WIA\x01" { 0x58usize } else { 0 };
    if base + 0x20 <= head.len() {
        let rd = |o: usize| u32::from_be_bytes([head[o], head[o+1], head[o+2], head[o+3]]);
        if rd(base + 0x18) == 0x5D1C_9EA3 { return Some("wii"); }
        if rd(base + 0x1C) == 0xC233_9F3D { return Some("gc"); }
    }
    // PS1/PS2/PSP/Saturn/SegaCD: scan dos primeiros 8MB por marcadores
    let mut buf = vec![0u8; 8 * 1024 * 1024];
    let n = f.read(&mut buf).unwrap_or(0);
    if n == 0 { return None; }
    let s = &buf[..n];
    let contains = |needle: &[u8]| s.windows(needle.len()).any(|w| w == needle);
    if contains(b"UMD_DATA.BIN") || contains(b"PSP_GAME") { return Some("psp"); }
    if contains(b"BOOT2") { return Some("ps2"); }
    if contains(b"cdrom:\\") { return Some("ps1"); }
    if contains(b"SEGA SATURN") { return Some("saturn"); }
    if contains(b"SEGADISCSYSTEM") { return Some("segacd"); }
    None
}

/// Le um .cue (texto pequeno) e retorna o path do .bin da primeira track.
/// Suporta FILE "name.bin" BINARY e FILE name.bin BINARY.
fn read_cue_first_track(cue: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(cue).ok()?;
    let parent = cue.parent()?;
    for line in content.lines() {
        let t = line.trim();
        let rest = match t.strip_prefix("FILE ").or_else(|| t.strip_prefix("file ")) {
            Some(r) => r, None => continue,
        };
        if let Some(start) = rest.find('"') {
            if let Some(end_rel) = rest[start + 1..].find('"') {
                return Some(parent.join(&rest[start + 1..start + 1 + end_rel]));
            }
        }
        // sem aspas
        let name = rest.splitn(2, ' ').next()?;
        return Some(parent.join(name));
    }
    None
}

/// Palavras-chave (lowercase, substring) que identificam um sistema no
/// nome de arquivo/pasta. Ex: "ps2" no path -> sistema PS2. Vazias = nao aceitar
/// extensao generica sozinha (forca user organizar em subpasta).
fn system_match_keys(system_id: &str) -> &'static [&'static str] {
    match system_id {
        "ps1"       => &["ps1", "psx", "playstation"],
        "ps2"       => &["ps2", "playstation 2", "playstation2"],
        "ps3"       => &["ps3", "playstation 3"],
        "ps4"       => &["ps4", "playstation 4"],
        "psp"       => &["psp", "playstation portable"],
        "vita"      => &["vita", "psvita"],
        "wii"       => &["wii"],
        "wiiu"      => &["wiiu", "wii u"],
        "gc"        => &["gc", "gamecube", "game cube"],
        "switch"    => &["switch", "nsw"],
        "xbox"      => &["xbox"],
        "xbox360"   => &["x360", "xbox360", "xbox 360"],
        "dreamcast" => &["dc", "dreamcast"],
        "saturn"    => &["saturn", "ss"],
        "segacd"    => &["segacd", "sega cd", "mcd", "mega cd"],
        "n64"       => &["n64", "nintendo64", "nintendo 64"],
        "ds"        => &["ds", "nds"],
        "3ds"       => &["3ds"],
        "snes"      => &["snes", "sfc", "super nintendo"],
        "nes"       => &["nes", "famicom"],
        "gba"       => &["gba", "advance"],
        "gb"        => &["gb", "game boy", "gameboy"],
        "gbc"       => &["gbc", "color"],
        "md"        => &["md", "genesis", "mega drive", "megadrive"],
        "sms"       => &["sms", "master system"],
        "gg"        => &["gg", "game gear"],
        "tg16"      => &["tg16", "pce", "turbografx", "pcengine"],
        "arcade"    => &["mame", "arcade", "fbneo"],
        "threedo"   => &["3do"],
        _           => &[],
    }
}

fn scan_system(roms_root: &Path, emulators_root: &Path, cfg: &EmulatorConfig) -> SystemInfo {
    let folder = roms_root.join(cfg.folder_name);
    let folder_exists = folder.is_dir();
    let mut libretro_core = libretro_core_for(cfg.id);
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

    // Decide diretorio de scan:
    // - Se roms_root/folder_name/ existe (organizacao classica desktop): scan nele
    // - Senao, faz scan direto em roms_root (caso tipico Android: Download/, etc)
    let (scan_dir, scan_depth, is_flat) = if folder_exists {
        (folder.clone(), 2, false)
    } else {
        (roms_root.to_path_buf(), 3, true)
    };

    let mut games: Vec<Game> = Vec::new();
    if scan_dir.is_dir() {
        for entry in WalkDir::new(&scan_dir)
            .max_depth(scan_depth)
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
            // v0.9.20: identifica disco pelo CONTEUDO pra todos os sistemas opticos
            // que compartilham extensoes (.iso/.bin/.cue/.chd/.rvz/.pbp/etc). Antes
            // (a) GC/Wii caiam nos dois (.rvz/.iso comuns), (b) PSP/PS1 nao apareciam
            // no scan plano (keyword obrigatoria que o nome nao tinha) — agora a
            // confirmacao vem do magic word ou do SYSTEM.CNF do proprio disco.
            // disc_confirmed pula a checagem de keyword generica abaixo (um .iso de
            // Wii como "Sonic Colors" nao tem "wii" no nome mas o magic ja confirmou).
            let mut disc_confirmed = false;
            if matches!(cfg.id, "gc" | "wii" | "ps1" | "ps2" | "psp" | "dreamcast" | "saturn" | "segacd")
                && matches!(ext.as_str(),
                    "iso" | "rvz" | "wia" | "gcm" | "gcz" | "wbfs" | "wad"
                    | "bin" | "cue" | "img" | "pbp" | "cso" | "gdi" | "cdi")
            {
                match detect_disc_system(path, &ext) {
                    Some(sys) if sys == cfg.id => disc_confirmed = true,
                    Some(_) => continue,
                    // Conteudo nao reconhecido (.chd, .bin truncado, etc) -> cai pro
                    // bloco generico abaixo (keyword) — nao bloqueia se for ambiguo.
                    None => {}
                }
            }
            // Flat scan: extensoes genericas (.iso, .bin, .zip, .chd, .cue, .pbp, .img,
            // .m3u, .mds, .ccd) batem em multiplos sistemas (PS1/PS2/Wii/GC/Saturn/etc).
            // Aceita SO se nome ou pasta-pai contem o id/folder_name do sistema —
            // senao um .iso aparece replicado em todos sistemas que aceitam iso.
            if is_flat && is_generic_extension(&ext) && !disc_confirmed {
                let parent_name = path.parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                let file_name_lower = path.file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                let sys_keys: &[&str] = system_match_keys(cfg.id);
                let matches = sys_keys.iter().any(|k| {
                    !k.is_empty() && (parent_name.contains(k) || file_name_lower.contains(k))
                });
                if !matches { continue; }
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
        // Casos especiais: pastas extracted (so quando folder organizado existe)
        if folder_exists {
            if cfg.id == "wiiu" {
                scan_extracted_wiiu(&folder, &mut games);
            }
            if cfg.id == "ps3" {
                scan_extracted_ps3(&folder, &mut games);
            }
            if cfg.id == "ps4" {
                scan_extracted_ps4(&folder, &mut games);
            }
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

// v0.9.5: scan com pasta POR SISTEMA. overrides: { systemId: folderPath }. Pra
// cada sistema com override, escaneia ESSA pasta (scan_system cai no flat-scan
// quando a pasta nao tem subpasta com o folder_name). Sem override, usa o
// roms_root padrao. Atende o pedido do Paulo de escolher uma pasta por emulador.
#[tauri::command]
fn scan_roms_overrides(roms_root: Option<String>, overrides: std::collections::HashMap<String, String>) -> Vec<SystemInfo> {
    let root_path = match roms_root {
        Some(s) if !s.is_empty() => PathBuf::from(s),
        _ => current_roms_root(),
    };
    let emu_root = current_emulators_root();
    EMULATORS.iter().map(|cfg| {
        match overrides.get(cfg.id) {
            Some(ov) if !ov.is_empty() => scan_system(&PathBuf::from(ov), &emu_root, cfg),
            _ => scan_system(&root_path, &emu_root, cfg),
        }
    }).collect()
}

// v0.9.2: navegador de arquivos real. Antes o picker de pasta no Android era uma
// lista fixa de caminhos comuns ("engessado") — agora o user navega o
// armazenamento de verdade (o app ja tem MANAGE_EXTERNAL_STORAGE, entao
// std::fs::read_dir le /storage/emulated/0 numa boa). Tambem serve no desktop.
#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    rom_count: u32, // qtd de arquivos com extensao de ROM dentro (so p/ dirs, shallow)
}

#[derive(serde::Serialize)]
struct DirListing {
    path: String,
    parent: Option<String>,
    entries: Vec<DirEntry>,
}

fn is_rom_ext(name: &str) -> bool {
    // extensoes que algum core libretro do Ludex carrega (lista ampla, lowercase)
    const EXTS: &[&str] = &[
        "zip","7z","chd","iso","bin","cue","img","nrg","mdf","gdi","cso","pbp",
        "nes","fds","unf","sfc","smc","fig","swc","gba","gb","gbc","gg","sms",
        "md","gen","smd","32x","sg","n64","z64","v64","ndd","nds","dsi","srl",
        "3ds","cci","cxi","app","cia","gcm","gcz","rvz","wbfs","wad","wia",
        "pce","sgx","cue","ws","wsc","ngp","ngc","vb","col","a78","lnx","d64",
        "dol","elf","ciso","wud","wux","rpx","nsp","xci","exe","xbe","cdi","m3u",
    ];
    name.rsplit('.').next().map(|e| EXTS.contains(&e.to_lowercase().as_str())).unwrap_or(false)
}

fn shallow_rom_count(dir: &std::path::Path) -> u32 {
    let mut n = 0u32;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                let fname = e.file_name().to_string_lossy().to_string();
                if is_rom_ext(&fname) { n += 1; if n >= 999 { break; } }
            }
        }
    }
    n
}

#[tauri::command]
fn list_dir(path: Option<String>) -> Result<DirListing, String> {
    let root = match path {
        Some(s) if !s.is_empty() => s,
        _ => {
            #[cfg(target_os = "android")] { "/storage/emulated/0".to_string() }
            #[cfg(not(target_os = "android"))] {
                dirs::home_dir().map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| "/".to_string())
            }
        }
    };
    let p = std::path::Path::new(&root);
    if !p.is_dir() {
        return Err(format!("Nao e uma pasta: {}", root));
    }
    let mut entries: Vec<DirEntry> = Vec::new();
    let rd = std::fs::read_dir(p).map_err(|e| format!("Sem acesso a {}: {}", root, e))?;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; } // esconde ocultos
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let full = e.path().to_string_lossy().to_string();
        let rom_count = if is_dir { shallow_rom_count(&e.path()) } else { 0 };
        entries.push(DirEntry { name, path: full, is_dir, rom_count });
    }
    // pastas primeiro, depois alfabetico (case-insensitive)
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let parent = p.parent().map(|pp| pp.to_string_lossy().to_string());
    Ok(DirListing { path: root, parent, entries })
}

/// v0.9.1: Reescreve paths absolutos do xemu.toml (BIOS, HDD, snapshots etc)
/// pra apontar pros arquivos que realmente existem no projeto atual. Necessario
/// pq o user moveu Playbox -> Ludex e o config ficou stale ("Failed to open BootROM").
/// Procura keys conhecidas e troca prefixo D:\Projetos do Claude\Playbox\ -> emu_dir.
fn rewrite_xemu_paths(toml_path: &std::path::Path, emu_dir: &std::path::Path) {
    let bios_dir = emu_dir.join("bios");
    let hdd_path = bios_dir.join("xbox_hdd.qcow2");
    let mcpx_path = bios_dir.join("mcpx_1.0.bin");
    let bios_bin  = bios_dir.join("Complex_4627.bin");
    if !mcpx_path.is_file() || !bios_bin.is_file() {
        log::warn!("[xemu] BIOS files nao encontrados em {:?}, pulando rewrite", bios_dir);
        return;
    }
    let new_contents = format!(
        "[general]\nshow_welcome = false\n\n[sys.files]\nbootrom_path = '{}'\nflashrom_path = '{}'\neeprom_path = '{}'\n\n[sys]\nhard_drive = '{}'\n",
        mcpx_path.display().to_string().replace('\\', "/"),
        bios_bin.display().to_string().replace('\\', "/"),
        bios_dir.join("eeprom.bin").display().to_string().replace('\\', "/"),
        hdd_path.display().to_string().replace('\\', "/"),
    );
    // Se o arquivo ja existe e tem o path correto, nao reescreve (preserva customizacoes do user)
    if let Ok(existing) = std::fs::read_to_string(toml_path) {
        let mcpx_str = mcpx_path.display().to_string().replace('\\', "/");
        if existing.contains(&mcpx_str) {
            return; // ja ta certo
        }
        // Se existe MAS tem path antigo (Playbox), reescreve
        if existing.contains("Playbox") || existing.contains("BootROM") {
            log::info!("[xemu] reescrevendo xemu.toml com paths Ludex (era Playbox)");
        }
    }
    if let Err(e) = std::fs::write(toml_path, new_contents) {
        log::warn!("[xemu] falha ao reescrever xemu.toml: {}", e);
    } else {
        log::info!("[xemu] xemu.toml atualizado: bios={:?}", mcpx_path);
    }
}

/// v0.9.20: instala .pkg do PS3 via `rpcs3 --installpkg` e retorna o path do
/// EBOOT.BIN do jogo instalado. RPCS3 nao boota .pkg direto — joga "Invalid file
/// or folder" (foi o erro do print do Paulo em Metal Slug Anthology).
///
/// Detecta o jogo instalado comparando o mtime de dev_hdd0/game/* antes e depois
/// (pega o dir mais recente). Funciona pra instalacao 1-a-1 (caso comum).
fn install_rpcs3_pkg(rpcs3_exe: &Path, pkg: &Path) -> Result<PathBuf, String> {
    let rpcs3_root = rpcs3_exe.parent().ok_or("rpcs3 sem parent dir")?;
    let game_root = rpcs3_root.join("dev_hdd0").join("game");
    let _ = std::fs::create_dir_all(&game_root);
    // snapshot mtimes antes pra distinguir o que e novo/atualizado
    let mut before: std::collections::HashMap<PathBuf, std::time::SystemTime> = std::collections::HashMap::new();
    if let Ok(rd) = std::fs::read_dir(&game_root) {
        for e in rd.filter_map(|x| x.ok()) {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let mt = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                before.insert(e.path(), mt);
            }
        }
    }
    log::info!("[ps3] rpcs3 --installpkg \"{}\"", pkg.display());
    let status = Command::new(rpcs3_exe)
        .args(["--no-gui", "--installpkg"])
        .arg(pkg)
        .current_dir(rpcs3_root)
        .status()
        .map_err(|e| format!("nao consegui executar --installpkg: {}", e))?;
    if !status.success() {
        return Err(format!("rpcs3 --installpkg saiu com codigo {:?}", status.code()));
    }
    let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
    for e in std::fs::read_dir(&game_root)
        .map_err(|e| format!("dev_hdd0/game inacessivel: {}", e))?
        .filter_map(|x| x.ok())
    {
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        let path = e.path();
        let mtime = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
        let is_new_or_updated = before.get(&path).map(|t| *t < mtime).unwrap_or(true);
        if !is_new_or_updated { continue; }
        match &newest {
            Some((_, prev_t)) if *prev_t >= mtime => {}
            _ => newest = Some((path, mtime)),
        }
    }
    let (game_dir, _) = newest.ok_or("nao localizei pasta criada pelo --installpkg em dev_hdd0/game")?;
    let eboot = game_dir.join("USRDIR").join("EBOOT.BIN");
    if !eboot.is_file() {
        return Err(format!("EBOOT.BIN nao encontrado em {}", eboot.display()));
    }
    Ok(eboot)
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

    // v0.9.1: xemu usa xemu.toml com paths absolutos pro BIOS. Se o user moveu
    // o projeto de Playbox -> Ludex, o config fica stale e xemu falha com
    // "Failed to open BootROM". Reescreve paths automaticamente antes de launch.
    if system_id == "xbox" {
        if let Some(emu_dir) = exe.parent() {
            let toml_path = emu_dir.join("xemu.toml");
            rewrite_xemu_paths(&toml_path, emu_dir);
        }
    }

    // v0.9.20: PS3 .pkg precisa SER INSTALADO antes (rpcs3 --installpkg) e depois
    // bootado pelo EBOOT.BIN do jogo instalado — bootar o .pkg direto da "Invalid
    // file or folder". Aqui rodamos a instalacao sincrona; o boot continua no fluxo
    // normal abaixo, so trocando o que vai como argumento (eboot em vez do pkg).
    let rom_arg_path: PathBuf = if system_id == "ps3" && rom_path.to_ascii_lowercase().ends_with(".pkg") {
        install_rpcs3_pkg(&exe, &rom).map_err(|e| format!("PS3 install: {}", e))?
    } else {
        rom.clone()
    };

    let rom_name = rom.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rom_path.clone());

    // Mata jogo anterior se existir
    kill_running_game_inner();

    let mut command = Command::new(&exe);
    for arg in cfg.launch_args {
        command.arg(arg);
    }
    command.arg(&rom_arg_path);
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
struct IgdbVideo {
    video_id: Option<String>,
    name: Option<String>,
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
    videos: Option<Vec<IgdbVideo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GameVideo {
    youtube_id: String,
    name: Option<String>,
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
    // v2 (v0.6.6+): videos do YouTube vindos do IGDB. Default vazio pra cache antigo.
    #[serde(default)]
    videos: Vec<GameVideo>,
}

static TOKEN_CACHE: OnceLock<Mutex<Option<CachedToken>>> = OnceLock::new();

fn token_cache() -> &'static Mutex<Option<CachedToken>> {
    TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

// v0.8.8: tudo passa por ludex_base_dir() (definida mais abaixo) que ja resolve
// Android via Tauri path resolver e desktop via dirs::data_dir.

fn _ludex_data_subdir(name: &str) -> Option<PathBuf> {
    let dir = ludex_base_dir()?.join(name);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn covers_dir() -> Option<PathBuf> { _ludex_data_subdir("covers") }
fn screenshots_dir() -> Option<PathBuf> { _ludex_data_subdir("screenshots") }
fn details_dir() -> Option<PathBuf> { _ludex_data_subdir("details") }

fn token_path() -> Option<PathBuf> {
    Some(ludex_base_dir()?.join("igdb_token.json"))
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

/// v0.9.9: builder de cliente HTTP compartilhado. No Android forca IPv4 ligando o
/// socket local a 0.0.0.0 — o hyper-util so tenta enderecos remotos IPv4 quando o
/// local_address e IPv4. Sem isso, em redes com IPv6 quebrado (VPN, DNS64 sem rota
/// v6, alguns carriers) o reqwest pega o endereco AAAA primeiro, recebe ENETUNREACH
/// na hora e devolve "error sending request" — e TODA feature online (capas, detalhe,
/// nota, update check) falha mesmo com a rede funcionando. Em carrier IPv6-only o
/// Android roda 464XLAT/CLAT, entao ainda existe um IPv4 local e o bind funciona.
/// Causa raiz de "banners dos jogos pararam de aparecer no Android" (Paulo, v0.9.x).
fn http_client_builder() -> reqwest::ClientBuilder {
    let b = reqwest::ClientBuilder::new();
    #[cfg(target_os = "android")]
    let b = b.local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    b
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
    /// Gumroad license key colada pelo user (formato XXXX-XXXX-XXXX-XXXX).
    /// None = nao ativado, app fica trancado no LicenseGate.
    license_key: Option<String>,
    /// Timestamp Unix da ultima validacao bem-sucedida.
    /// Usado pra grace period offline (30 dias sem internet ainda funciona).
    license_validated_at: u64,
    /// Cache local do uses count retornado pelo Gumroad. Soft-enforce 2 PCs.
    license_uses: u32,
    /// SHA256 do hardware (MachineGuid + MAC + CPU). Capturado na ativacao —
    /// se mudar, app forca re-validacao online (anti config-copy entre PCs).
    #[serde(default)]
    license_fingerprint: Option<String>,
    /// Timestamps Unix dos ultimos deactivates. Usado pra rate limit (max 5/dia).
    #[serde(default)]
    license_deactivate_log: Vec<u64>,
    /// v0.7.4 (Android demo): timestamp do primeiro launch no APK. 0 = nunca usado.
    #[serde(default)]
    android_installed_at: u64,
    /// v0.7.4 (Android demo): unlock permanente via license admin (paulo). Default false.
    #[serde(default)]
    android_admin_unlock: bool,
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
            license_key: None,
            license_validated_at: 0,
            license_uses: 0,
            license_fingerprint: None,
            license_deactivate_log: Vec::new(),
            android_installed_at: 0,
            android_admin_unlock: false,
        }
    }
}

/// Diretorio base do Ludex (config + profiles + caches).
/// Android: /data/data/gg.ludex.app/files/Ludex (storage privado do app, ZERO permissao,
///   simbolico desde Android 1.0, sempre escrivel pelo proprio processo).
///   NAO usar /storage/emulated/0/ — exige MANAGE_EXTERNAL_STORAGE (v0.8.7 bug).
///   NAO usar tauri.path().app_data_dir() — JNI call em runtime crasha o app (v0.8.8/v0.8.9 bug).
/// Desktop: %APPDATA%/Ludex/ ou ~/.local/share/Ludex/ via dirs::data_dir.
fn ludex_base_dir() -> Option<PathBuf> {
    #[cfg(target_os = "android")]
    {
        let p = PathBuf::from("/data/data/gg.ludex.app/files/Ludex");
        std::fs::create_dir_all(&p).ok()?;
        return Some(p);
    }
    #[cfg(not(target_os = "android"))]
    {
        let base = dirs::data_dir()?;
        let dir = base.join("Ludex");
        std::fs::create_dir_all(&dir).ok()?;
        Some(dir)
    }
}

/// v0.9.2: base dos ASSETS acessiveis pelo usuario (system/BIOS, saves-libretro,
/// save states). DIFERENTE de ludex_base_dir() (config/profiles/caches, que ficam
/// no storage privado do app). No Android tem que ser a pasta PUBLICA
/// /storage/emulated/0/Ludex — e onde o core libretro (libretro.rs) ja le BIOS/
/// saves E onde o usuario consegue acessar pelo gerenciador de arquivos. Antes
/// system/saves usavam o path privado /data/data/... entao: (a) BIOS colocada
/// pelo user na pasta publica era rejeitada pelo check ("BIOS missing"), e (b)
/// save states davam path invalido no Android (dirs::data_dir() nao confiavel la).
fn ludex_assets_base() -> PathBuf {
    #[cfg(target_os = "android")]
    { PathBuf::from("/storage/emulated/0/Ludex") }
    #[cfg(not(target_os = "android"))]
    { dirs::data_dir().map(|d| d.join("Ludex")).unwrap_or_else(|| PathBuf::from(".")) }
}

fn config_path() -> Option<PathBuf> {
    Some(ludex_base_dir()?.join("config.json"))
}

fn profiles_dir() -> Option<PathBuf> {
    let dir = ludex_base_dir()?.join("profiles");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn wallpapers_dir() -> Option<PathBuf> { _ludex_data_subdir("wallpapers") }

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

#[cfg(windows)]
fn is_junction(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        // FILE_ATTRIBUTE_REPARSE_POINT = 0x400
        return meta.file_attributes() & 0x400 != 0;
    }
    false
}

#[cfg(not(windows))]
fn is_junction(_path: &Path) -> bool {
    // Junctions sao conceito Windows-NTFS. Em Linux/Android/macOS: usa symlinks (read_link funciona).
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

    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;

    // v0.9.6: log do motivo de falha (Paulo: capas pararam de aparecer no Android).
    // Visivel no Ajustes > Logs do app.
    let token = match get_access_token(&client).await {
        Ok(t) => t,
        Err(e) => { log::warn!("[cover] token IGDB falhou ({}): {}", game_name, e); return None; }
    };

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

    // v0.9.20: fallback FREE — libretro thumbnails (community DB, sem API key).
    // Cobre muito jogo que o IGDB nao tem ou nao matchou. URL:
    //   https://thumbnails.libretro.com/<Platform>/Named_Boxarts/<nome>.png
    // Tentamos variantes de regiao porque a libretro DB usa "<jogo> (USA).png" etc.
    if let Some(platform) = libretro_thumb_platform(&system_id) {
        let variants = libretro_name_variants(&game_name);
        for name in &variants {
            let url = format!(
                "https://thumbnails.libretro.com/{}/Named_Boxarts/{}.png",
                url_encode_path(platform),
                url_encode_path(name),
            );
            let resp = match client.get(&url).send().await { Ok(r) => r, Err(_) => continue };
            if !resp.status().is_success() { continue; }
            let bytes = match resp.bytes().await { Ok(b) => b, Err(_) => continue };
            if tokio::fs::write(&cache_file, &bytes).await.is_ok() {
                log::info!("[cover] libretro-thumb match: {} <- {}", game_name, name);
                return Some(cache_file.to_string_lossy().to_string());
            }
        }
    }

    log::warn!("[cover] sem match (IGDB + libretro-thumb) pra '{}' (plataforma {})", game_name, cfg.igdb_platform);
    None
}

/// Map dos system_ids do Ludex pros nomes de plataforma usados pela
/// libretro-thumbnails (formato oficial RetroArch). None = plataforma sem thumbs.
fn libretro_thumb_platform(system_id: &str) -> Option<&'static str> {
    Some(match system_id {
        "snes"      => "Nintendo - Super Nintendo Entertainment System",
        "nes"       => "Nintendo - Nintendo Entertainment System",
        "gb"        => "Nintendo - Game Boy",
        "gbc"       => "Nintendo - Game Boy Color",
        "gba"       => "Nintendo - Game Boy Advance",
        "n64"       => "Nintendo - Nintendo 64",
        "gc"        => "Nintendo - GameCube",
        "wii"       => "Nintendo - Wii",
        "wiiu"      => "Nintendo - Wii U",
        "ds"        => "Nintendo - Nintendo DS",
        "3ds"       => "Nintendo - Nintendo 3DS",
        "switch"    => "Nintendo - Switch",
        "vb"        => "Nintendo - Virtual Boy",
        "ps1"       => "Sony - PlayStation",
        "ps2"       => "Sony - PlayStation 2",
        "psp"       => "Sony - PlayStation Portable",
        "vita"      => "Sony - PlayStation Vita",
        "ps3"       => "Sony - PlayStation 3",
        "md"        => "Sega - Mega Drive - Genesis",
        "sms"       => "Sega - Master System - Mark III",
        "gg"        => "Sega - Game Gear",
        "saturn"    => "Sega - Saturn",
        "dreamcast" => "Sega - Dreamcast",
        "segacd"    => "Sega - Mega-CD - Sega CD",
        "a2600"     => "Atari - 2600",
        "lynx"      => "Atari - Lynx",
        "jaguar"    => "Atari - Jaguar",
        "tg16"      => "NEC - PC Engine - TurboGrafx 16",
        "ws"        => "Bandai - WonderSwan",
        "ngpc"      => "SNK - Neo Geo Pocket Color",
        "msx"       => "Microsoft - MSX",
        "c64"       => "Commodore - 64",
        "zx"        => "Sinclair - ZX Spectrum",
        "amiga"     => "Commodore - Amiga",
        "threedo"   => "The 3DO Company - 3DO",
        "arcade"    => "FB Neo - Arcade Games",
        _ => return None,
    })
}

/// Gera variantes de nome pra tentar no libretro thumbs (a DB usa "<nome> (USA).png").
/// Inclui o nome cru e variantes com region tag comuns.
fn libretro_name_variants(name: &str) -> Vec<String> {
    let base = name.trim();
    let mut out = Vec::with_capacity(8);
    out.push(format!("{} (USA)", base));
    out.push(format!("{} (Europe)", base));
    out.push(format!("{} (USA, Europe)", base));
    out.push(format!("{} (World)", base));
    out.push(format!("{} (Japan)", base));
    out.push(base.to_string());
    out.push(format!("{} (USA) (En,Fr,De,Es,It)", base));
    out
}

/// Percent-encode para path-segment de URL. Mantem alfa-num + `-_.~`,
/// encoda tudo o resto (espaco, parens, vírgula, etc).
fn url_encode_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else {
            let mut buf = [0u8; 4];
            for &b in c.encode_utf8(&mut buf).as_bytes() {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

/// Resolve a pasta de musica seguindo a mesma logica dos emuladores:
/// 1. Android: /storage/emulated/0/Ludex/music/ (user copia MP3s manualmente)
/// 2. <install_dir>/music/  (bundlado pelo instalador desktop)
/// 3. <project_root>/music/  (dev: ao lado do exe em target/release)
fn resolve_music_dir() -> Option<PathBuf> {
    #[cfg(target_os = "android")]
    {
        let android_music = PathBuf::from("/storage/emulated/0/Ludex/music");
        let _ = std::fs::create_dir_all(&android_music);
        if android_music.is_dir() { return Some(android_music); }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("music");
            if bundled.is_dir() { return Some(bundled); }
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
    // Android: cores extraidos de assets/ pro filesystem privado via
    // MainActivity.extractCoresAssets() (Kotlin), durante onCreate.
    #[cfg(target_os = "android")]
    {
        let p = PathBuf::from("/data/data/gg.ludex.app/files/Ludex/cores");
        if p.is_dir() { return Some(p); }
        return None;
    }
    #[cfg(not(target_os = "android"))]
    {
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
}

#[tauri::command]
fn libretro_list_cores() -> Vec<String> {
    let Some(dir) = resolve_cores_dir() else { return Vec::new(); };
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            let ext_ok = p.extension().and_then(|x| x.to_str())
                .map(|s| {
                    let s = s.to_ascii_lowercase();
                    s == "dll" || s == "so" || s == "dylib"
                })
                .unwrap_or(false);
            if ext_ok {
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

/// Diretorio system/ do libretro (mesma logica usada em libretro.rs::state).
fn libretro_system_dir() -> PathBuf {
    // v0.9.2: usa o MESMO path que o core le (ludex_assets_base / publico no
    // Android). Antes usava ludex_base_dir() (privado) e o check de BIOS olhava
    // numa pasta diferente da que o core usa -> rejeitava BIOS valida.
    let dir = ludex_assets_base().join("system");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Lista de BIOS necessarias por core. Pelo menos UMA precisa existir em system/.
/// Cores nao listados nao precisam BIOS (ou tem BIOS opcional).
fn required_bios_files(core_filename: &str) -> &'static [&'static str] {
    let c = core_filename.to_ascii_lowercase();
    if c.contains("pcsx2") {
        &["ps2-0230a-20080220.bin", "scph39001.bin", "scph10000.bin",
          "scph30004r.bin", "scph70012.bin", "ps2-0250a-20100415.bin"]
    } else if c.contains("flycast") {
        &["dc_boot.bin"]
    } else if c.contains("mednafen_saturn") || c.contains("beetle_saturn") {
        &["sega_101.bin", "mpr-17933.bin"]
    } else if c.contains("opera") {
        &["panafz1.bin", "panafz10.bin", "goldstar.bin"]
    } else if c.contains("swanstation") || c.contains("mednafen_psx") || c.contains("beetle_psx") {
        &["scph5500.bin", "scph5501.bin", "scph5502.bin", "scph1001.bin", "ps-30a.bin"]
    } else if c.contains("virtualjaguar") {
        &["jagboot.rom"]
    } else {
        &[]
    }
}

fn check_required_bios(core_filename: &str) -> Option<String> {
    let needed = required_bios_files(core_filename);
    if needed.is_empty() { return None; }
    let sys_dir = libretro_system_dir();
    // 1. Check exato por nome (rapido)
    let any_present = needed.iter().any(|f| sys_dir.join(f).is_file());
    if any_present { return None; }
    // 2. v0.8.24: check heuristico por padrao+tamanho (case-insensitive,
    //    aceita qualquer scph*.bin/ps2*.bin/dc_boot/etc do tamanho certo)
    if bios_heuristic_check(core_filename, &sys_dir) {
        log::info!("BIOS heuristico OK em {}", sys_dir.display());
        return None;
    }
    // 3. Tenta auto-import de paths conhecidos antes de desistir
    if bios_auto_import_into_system(needed) {
        let any_now = needed.iter().any(|f| sys_dir.join(f).is_file())
            || bios_heuristic_check(core_filename, &sys_dir);
        if any_now { return None; }
    }
    // Log detalhado pra debug
    if let Ok(entries) = std::fs::read_dir(&sys_dir) {
        let names: Vec<String> = entries.flatten()
            .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
            .collect();
        log::warn!("BIOS check failed. sys_dir={} files={:?} needed={:?}",
            sys_dir.display(), names, needed);
    }
    Some(format!(
        "BIOS necessaria para este sistema nao encontrada.\n\nColoca um destes arquivos em:\n{}\n\nArquivos aceitos:\n{}",
        sys_dir.display(),
        needed.join("\n")
    ))
}

/// v0.8.24: heuristica robusta — checa por padrao de nome + tamanho minimo.
/// Mais tolerante que match exato (case-insensitive, regional variants).
fn bios_heuristic_check(core_filename: &str, sys_dir: &std::path::Path) -> bool {
    let c = core_filename.to_ascii_lowercase();
    let (prefixes, min_size): (&[&str], u64) = if c.contains("pcsx2") {
        (&["scph", "ps2-", "ps2_", "ps2 ", "ps2bios"], 3_500_000)
    } else if c.contains("flycast") {
        (&["dc_boot", "dc-boot", "dcboot", "dreamcast_bios"], 1_500_000)
    } else if c.contains("saturn") {
        (&["sega_101", "mpr-17933", "saturn_bios", "sega 101"], 400_000)
    } else if c.contains("opera") {
        (&["panafz", "goldstar", "3do_bios"], 800_000)
    } else if c.contains("swanstation") || c.contains("mednafen_psx") || c.contains("beetle_psx") {
        (&["scph", "ps-", "ps1_", "psx_bios", "psone"], 400_000)
    } else if c.contains("virtualjaguar") {
        (&["jagboot", "jaguar_boot"], 100_000)
    } else {
        return false;
    };
    let Ok(entries) = std::fs::read_dir(sys_dir) else { return false; };
    for e in entries.flatten() {
        let p = e.path();
        if !p.is_file() { continue; }
        let Some(name) = p.file_name().and_then(|n| n.to_str()) else { continue; };
        let name_lc = name.to_ascii_lowercase();
        // Aceita .bin / .rom / .bios (extensoes BIOS comuns)
        let is_bios_ext = name_lc.ends_with(".bin") || name_lc.ends_with(".rom")
            || name_lc.ends_with(".bios");
        if !is_bios_ext { continue; }
        let matches_prefix = prefixes.iter().any(|prefix| name_lc.starts_with(prefix) || name_lc.contains(prefix));
        if !matches_prefix { continue; }
        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
        if size >= min_size {
            return true;
        }
    }
    false
}

/// Procura BIOS em paths conhecidos (PCSX2/bios, RetroArch/system, Documents/PCSX2,
/// Downloads, etc) e copia pra ludex_base_dir/system/ se encontrar.
/// Retorna true se copiou pelo menos 1 arquivo.
fn bios_auto_import_into_system(needed: &[&str]) -> bool {
    let sys_dir = libretro_system_dir();
    let mut copied = 0;
    // Paths candidatos (cobre PCSX2, RetroArch, Documents, Downloads, raiz BIOS)
    let candidates: Vec<PathBuf> = bios_search_paths();
    for cand_dir in &candidates {
        if !cand_dir.is_dir() { continue; }
        // Procura cada nome BIOS necessario nesta pasta (case-insensitive)
        if let Ok(entries) = std::fs::read_dir(cand_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() { continue; }
                let Some(fname) = path.file_name().and_then(|n| n.to_str()) else { continue; };
                let fname_lc = fname.to_ascii_lowercase();
                for &target in needed {
                    if fname_lc == target.to_ascii_lowercase() {
                        let dest = sys_dir.join(target);
                        if dest.is_file() { continue; }
                        if std::fs::copy(&path, &dest).is_ok() {
                            log::info!("BIOS auto-import: {} -> {}", path.display(), dest.display());
                            copied += 1;
                        }
                    }
                }
            }
        }
    }
    copied > 0
}

fn bios_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    // 1. Emulators do Ludex (PCSX2 bios, RetroArch system, etc)
    let emu_root = current_emulators_root();
    paths.push(emu_root.join("PCSX2").join("bios"));
    paths.push(emu_root.join("RETROARCH").join("system"));
    paths.push(emu_root.join("DUCKSTATION").join("bios"));
    paths.push(emu_root.join("FLYCAST").join("data"));
    // 2. Roots comuns BIOS
    paths.push(PathBuf::from("D:\\BIOS"));
    paths.push(PathBuf::from("C:\\BIOS"));
    // 3. Documents (PCSX2 standard install)
    if let Some(d) = dirs::document_dir() {
        paths.push(d.join("PCSX2").join("bios"));
        paths.push(d.join("PCSX2_QT").join("bios"));
        paths.push(d.join("RetroArch").join("system"));
    }
    // 4. Downloads (fallback)
    if let Some(d) = dirs::download_dir() {
        paths.push(d.clone());
        paths.push(d.join("BIOS"));
        paths.push(d.join("ps2-bios"));
        paths.push(d.join("PS2"));
    }
    paths
}

#[tauri::command]
fn bios_try_auto_import() -> Result<u32, String> {
    // Importa BIOS de todos os sistemas que conhecemos (PS2, Saturn, Dreamcast, etc)
    let all_needed: Vec<&str> = required_bios_files("pcsx2_libretro").iter()
        .chain(required_bios_files("flycast_libretro").iter())
        .chain(required_bios_files("mednafen_saturn_libretro").iter())
        .chain(required_bios_files("opera_libretro").iter())
        .chain(required_bios_files("swanstation_libretro").iter())
        .chain(required_bios_files("virtualjaguar_libretro").iter())
        .copied()
        .collect();
    let sys_dir = libretro_system_dir();
    let before = all_needed.iter().filter(|f| sys_dir.join(f).is_file()).count();
    bios_auto_import_into_system(&all_needed);
    let after = all_needed.iter().filter(|f| sys_dir.join(f).is_file()).count();
    Ok((after.saturating_sub(before)) as u32)
}

#[tauri::command]
fn open_system_folder() -> Result<(), String> {
    let dir = libretro_system_dir();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("explorer.exe")
            .arg(&dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
    { Command::new("xdg-open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

// v0.9.23: auto-download de cores libretro do buildbot oficial.
// AUTORIZADO PELO PAULO (2026-05-24): "Autorizo o Ludex baixar cores .dll do
// buildbot.libretro.com/nightly/windows/x86_64/latest/ e instalar em
// D:\Projetos do Claude\Ludex\cores\. E a fonte oficial libretro, sem login,
// baixado por HTTPS." Sem essa autorizacao a feature ficaria bloqueada por
// auto-mode classifier (supply-chain risk). Windows-only (Android empacota .so
// no APK; iOS nao tem libretro).

#[derive(serde::Serialize)]
struct CoreStatus {
    system_id: String,
    system_name: String,
    core_filename: String,
    installed: bool,
}

#[tauri::command]
fn libretro_cores_status() -> Vec<CoreStatus> {
    let dir = resolve_cores_dir();
    EMULATORS.iter().filter_map(|cfg| {
        let cf = libretro_core_for(cfg.id);
        if cf.is_empty() { return None; }
        let installed = dir.as_ref().map(|d| d.join(&cf).is_file()).unwrap_or(false);
        Some(CoreStatus {
            system_id: cfg.id.to_string(),
            system_name: cfg.name.to_string(),
            core_filename: cf,
            installed,
        })
    }).collect()
}

/// Baixa um core libretro do buildbot oficial e extrai pro cores_dir.
/// URL: https://buildbot.libretro.com/nightly/windows/x86_64/latest/<core>.dll.zip
/// Usa `tar` do Windows (bsdtar, presente em Win10 1803+) pra extrair — sem dep
/// extra. Idempotente: se o .dll ja existe, retorna sem refazer.
#[tauri::command]
async fn download_libretro_core(filename: String) -> Result<bool, String> {
    let dir = resolve_cores_dir().ok_or("pasta cores nao encontrada")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar cores dir: {}", e))?;
    let dest = dir.join(&filename);
    if dest.is_file() { return Ok(true); }

    let url = format!(
        "https://buildbot.libretro.com/nightly/windows/x86_64/latest/{}.zip",
        filename
    );
    log::info!("[cores] download {}", url);

    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("client: {}", e))?;

    let resp = client.get(&url).send().await
        .map_err(|e| format!("download falhou: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("buildbot retornou HTTP {} pra {}", resp.status(), filename));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("body: {}", e))?;

    let tmp = std::env::temp_dir().join(format!("ludex_core_{}_{}.zip", std::process::id(), filename));
    tokio::fs::write(&tmp, &bytes).await.map_err(|e| format!("escrever zip: {}", e))?;

    #[cfg(windows)]
    let status = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("tar")
            .args(["-xf"]).arg(&tmp).args(["-C"]).arg(&dir)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
    };
    #[cfg(not(windows))]
    let status = Command::new("tar")
        .args(["-xf"]).arg(&tmp).args(["-C"]).arg(&dir)
        .status();

    let status = status.map_err(|e| format!("tar nao rodou: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    if !status.success() {
        return Err(format!("tar saiu com codigo {:?}", status.code()));
    }
    if !dest.is_file() {
        return Err(format!("core nao foi extraido em {}", dest.display()));
    }
    log::info!("[cores] OK {}", dest.display());
    Ok(true)
}

#[tauri::command]
fn open_cores_folder() -> Result<(), String> {
    let dir = resolve_cores_dir().ok_or("pasta cores nao resolvida")?;
    std::fs::create_dir_all(&dir).ok();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("explorer.exe").arg(&dir).creation_flags(CREATE_NO_WINDOW)
            .spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
    { Command::new("xdg-open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    Ok(())
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
    // v0.8.14: checa BIOS ANTES de carregar core. Sem isso, cores como pcsx2,
    // flycast, saturn etc fazem segfault dentro da DLL -> mata o Ludex inteiro.
    if let Some(err) = check_required_bios(&core_filename) {
        return Err(err);
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
/// v0.8.23: roda N frames extras SEM coletar buffer (fast-forward).
/// Audio drenado e descartado pra evitar overflow. Usado quando user
/// segura botao FF — minimiza overhead JNI (1 invoke vs N).
#[tauri::command]
fn libretro_skip_frames(n: u32) -> Result<(), String> {
    let slot = libretro_slot();
    let g = slot.lock().unwrap();
    if let Some(core) = g.as_ref() {
        for _ in 0..n.min(16) {
            unsafe { let _ = core.run(); }
        }
        // v0.9.2: NAO limpar audio_buf aqui. O pacing por relogio de audio do
        // frontend roda frames extras (skip) pra catch-up e PRECISA do audio
        // produzido nesses frames, senao volta o underrun/stutter. O proprio
        // AUDIO_BUF_LIMIT (drop-oldest) protege contra acumulo se o front travar.
    }
    Ok(())
}

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

/// v0.9.12: roda 1 frame e devolve VIDEO + AUDIO numa unica resposta (1 IPC em vez
/// de 2-3). Em celular fraco o gargalo e o round-trip WebView<->Rust, nao a emulacao.
/// Formato do buffer: [video_len u32 LE][video: w u32, h u32, rgba][audio: i16 LE...].
/// want_video=false descarta o frame de video (nao serializa o RGBA grande) — usado
/// pelo "modo desempenho" pra renderizar video em 30fps mantendo audio/emulacao 60fps.
#[tauri::command]
fn libretro_run_frame_av(want_video: bool) -> tauri::ipc::Response {
    {
        let slot = libretro_slot();
        let g = slot.lock().unwrap();
        if let Some(core) = g.as_ref() {
            unsafe { let _ = core.run(); }
        } else {
            return tauri::ipc::Response::new(vec![0u8, 0, 0, 0]);
        }
    }
    let mut video: Vec<u8> = Vec::new();
    {
        let s = libretro::state();
        let mut g = s.lock().unwrap();
        if let Some(f) = g.frame.take() {
            if want_video {
                video.reserve(8 + f.rgba.len());
                video.extend_from_slice(&f.width.to_le_bytes());
                video.extend_from_slice(&f.height.to_le_bytes());
                video.extend_from_slice(&f.rgba);
            }
        }
    }
    let mut audio: Vec<u8> = Vec::new();
    {
        let mut g = libretro::audio_buf().lock().unwrap();
        if !g.is_empty() {
            audio.reserve(g.len() * 2);
            for sample in g.drain(..) { audio.extend_from_slice(&sample.to_le_bytes()); }
        }
    }
    let vlen = video.len() as u32;
    let mut buf = Vec::with_capacity(4 + video.len() + audio.len());
    buf.extend_from_slice(&vlen.to_le_bytes());
    buf.extend_from_slice(&video);
    buf.extend_from_slice(&audio);
    tauri::ipc::Response::new(buf)
}

/// v0.8.37: Override de opcao libretro (user UI > defaults).
/// Aplicado no proximo GET_VARIABLE — pra ter efeito imediato, recarregar core.
#[tauri::command]
fn libretro_set_option(key: String, value: String) {
    log::info!("[libretro] user set option {} = {}", key, value);
    libretro::set_option_override(key, value);
}

/// Le valor atual de uma opcao (override ou default). Usado pelo UI.
#[tauri::command]
fn libretro_get_option(key: String) -> Option<String> {
    let overrides = libretro::option_overrides().lock().unwrap();
    overrides.get(&key).and_then(|c| c.to_str().ok().map(String::from))
}

/// Limpa todos overrides (volta aos defaults). Usado pelo botao "Restaurar".
#[tauri::command]
fn libretro_clear_options() {
    let mut overrides = libretro::option_overrides().lock().unwrap();
    overrides.clear();
    log::info!("[libretro] overrides limpos");
}

/// Dreno do buffer de audio. Retorna bytes raw (i16 LE interleaved L,R,L,R...).
#[tauri::command]
fn libretro_take_audio() -> tauri::ipc::Response {
    let mut g = libretro::audio_buf().lock().unwrap();
    if g.is_empty() {
        return tauri::ipc::Response::new(Vec::new());
    }
    let n = g.len();
    let mut buf = Vec::with_capacity(n * 2);
    for sample in g.drain(..) {
        buf.extend_from_slice(&sample.to_le_bytes());
    }
    tauri::ipc::Response::new(buf)
}

// ===== v0.9.2: CHEATS =====
#[derive(serde::Deserialize)]
struct CheatInput { code: String, enabled: bool }

/// Aplica cheats no core carregado. Reseta tudo e re-aplica os habilitados em
/// ordem. Codigo pode ter varias linhas (separadas por \n ou +). Retorna quantos
/// foram aplicados.
#[tauri::command]
fn libretro_apply_cheats(cheats: Vec<CheatInput>) -> Result<u32, String> {
    let slot = libretro_slot();
    let g = slot.lock().unwrap();
    let core = g.as_ref().ok_or("nenhum jogo carregado")?;
    unsafe {
        core.cheat_reset()?;
        let mut idx = 0u32;
        for c in cheats.iter().filter(|c| c.enabled && !c.code.trim().is_empty()) {
            let code = c.code.trim().replace(['\n', '\r'], "+");
            core.cheat_set(idx, true, &code)?;
            idx += 1;
        }
        log::info!("[cheats] aplicados {} cheats", idx);
        Ok(idx)
    }
}

#[derive(serde::Serialize)]
struct CheatEntry { desc: String, code: String }

fn normalize_name(s: &str) -> String {
    // tira tags entre () e [], deixa so alfanumerico lowercase
    let mut out = String::new();
    let mut depth = 0i32;
    for ch in s.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => { if depth > 0 { depth -= 1; } }
            _ if depth == 0 && ch.is_alphanumeric() => out.push(ch.to_ascii_lowercase()),
            _ => {}
        }
    }
    out
}

/// Busca cheats abertos no libretro-database (GitHub) pro jogo+sistema. Lista a
/// pasta cht/<db_folder>, faz match fuzzy pelo nome do jogo e baixa+parseia o .cht
/// (formato RetroArch: cheatN_desc / cheatN_code). Best-effort: GitHub limita
/// requests anonimos, entao paramos cedo ao achar bom match.
#[tauri::command]
async fn fetch_cheats(db_folder: String, game_name: String) -> Result<Vec<CheatEntry>, String> {
    let client = http_client_builder()
        .user_agent("Ludex/0.9.2")
        .build().map_err(|e| e.to_string())?;
    let target = normalize_name(&game_name);
    if target.is_empty() { return Err("nome do jogo vazio".into()); }

    let mut best_url: Option<String> = None;
    let mut best_score = 0usize;
    // pagina a listagem da pasta (ate 8 paginas = 800 arquivos)
    for page in 1..=8 {
        let api = format!(
            "https://api.github.com/repos/libretro/libretro-database/contents/cht/{}?per_page=100&page={}",
            urlencode_path(&db_folder), page
        );
        let resp = client.get(&api).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            if page == 1 {
                return Err(format!("sistema sem base de cheats (HTTP {})", resp.status()));
            }
            break;
        }
        let arr: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
        if arr.is_empty() { break; }
        for item in &arr {
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if !name.to_lowercase().ends_with(".cht") { continue; }
            let stem = &name[..name.len() - 4];
            let norm = normalize_name(stem);
            if norm.is_empty() { continue; }
            // pontuacao: match exato > prefixo > containment
            let score = if norm == target { 1000 }
                else if target.starts_with(&norm) || norm.starts_with(&target) { 500 + norm.len().min(target.len()) }
                else if norm.contains(&target) || target.contains(&norm) { 100 + common_prefix_len(&norm, &target) }
                else { 0 };
            if score > best_score {
                best_score = score;
                best_url = item.get("download_url").and_then(|v| v.as_str()).map(String::from);
            }
        }
        if best_score >= 1000 { break; } // match exato, nao precisa mais paginas
        if arr.len() < 100 { break; }     // ultima pagina
    }

    let url = best_url.ok_or("nenhum cheat encontrado pra esse jogo")?;
    if best_score < 100 {
        return Err("nenhum cheat encontrado pra esse jogo".into());
    }
    let txt = client.get(&url).send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;
    Ok(parse_cht(&txt))
}

fn common_prefix_len(a: &str, b: &str) -> usize {
    a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count()
}

fn urlencode_path(s: &str) -> String {
    // encoda so o que quebra URL em path segment (espaco, etc), mantem '/'
    s.chars().map(|c| match c {
        ' ' => "%20".to_string(),
        '#' => "%23".to_string(),
        '?' => "%3F".to_string(),
        _ => c.to_string(),
    }).collect()
}

fn parse_cht(txt: &str) -> Vec<CheatEntry> {
    use std::collections::HashMap;
    let mut descs: HashMap<usize, String> = HashMap::new();
    let mut codes: HashMap<usize, String> = HashMap::new();
    for line in txt.lines() {
        let line = line.trim();
        let Some((key, val)) = line.split_once('=') else { continue; };
        let key = key.trim();
        let val = val.trim().trim_matches('"').to_string();
        if let Some(rest) = key.strip_prefix("cheat") {
            if let Some((num, field)) = rest.split_once('_') {
                if let Ok(i) = num.parse::<usize>() {
                    match field {
                        "desc" => { descs.insert(i, val); }
                        "code" => { codes.insert(i, val); }
                        _ => {}
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    let mut keys: Vec<usize> = codes.keys().copied().collect();
    keys.sort_unstable();
    for i in keys {
        if let Some(code) = codes.get(&i) {
            if code.is_empty() { continue; }
            let desc = descs.get(&i).cloned().unwrap_or_else(|| format!("Cheat {}", i + 1));
            out.push(CheatEntry { desc, code: code.clone() });
        }
    }
    out
}

#[tauri::command]
fn libretro_set_input(button_id: u32, pressed: bool) {
    if button_id >= 16 { return; }
    let s = libretro::state();
    let mut g = s.lock().unwrap();
    g.input_state[button_id as usize] = pressed;
}

/// v0.8.45: stick analogico. stick: 0=L, 1=R. x/y em [-32767, 32767]
#[tauri::command]
fn libretro_set_analog(stick: u32, x: i32, y: i32) {
    if stick >= 2 { return; }
    let s = libretro::state();
    let mut g = s.lock().unwrap();
    let slot = (stick as usize) * 2;
    g.analog_state[slot] = x.clamp(-32767, 32767) as i16;
    g.analog_state[slot + 1] = y.clamp(-32767, 32767) as i16;
}

/// v0.8.46: Info de discos do core (multi-disc PS1/Saturn/SegaCD).
/// Retorna { num_images, current_image, supported } via JSON.
#[derive(serde::Serialize)]
struct DiscInfo { supported: bool, num_images: u32, current_image: u32, ejected: bool }

#[tauri::command]
fn libretro_get_disc_info() -> DiscInfo {
    let s = libretro::state();
    let g = s.lock().unwrap();
    let Some(ptr) = g.disk_control else {
        return DiscInfo { supported: false, num_images: 0, current_image: 0, ejected: false };
    };
    unsafe {
        let cb = &*ptr;
        let n  = cb.get_num_images.map(|f| f()).unwrap_or(0);
        let i  = cb.get_image_index.map(|f| f()).unwrap_or(0);
        let ej = cb.get_eject_state.map(|f| f()).unwrap_or(false);
        DiscInfo { supported: true, num_images: n, current_image: i, ejected: ej }
    }
}

/// v0.8.46: Trocar pra outro disco da lista atual (multi-disc games).
/// idx: indice do disco (0..num_images-1)
#[tauri::command]
fn libretro_swap_disc(idx: u32) -> Result<(), String> {
    let s = libretro::state();
    let g = s.lock().unwrap();
    let Some(ptr) = g.disk_control else { return Err("Core nao suporta troca de disco".into()); };
    unsafe {
        let cb = &*ptr;
        let eject = cb.set_eject_state.ok_or("set_eject_state ausente")?;
        let set_idx = cb.set_image_index.ok_or("set_image_index ausente")?;
        eject(true);
        if !set_idx(idx) {
            eject(false);
            return Err(format!("set_image_index({}) falhou", idx));
        }
        eject(false);
    }
    log::info!("[libretro] swap disc -> idx {}", idx);
    Ok(())
}

/// v0.8.46: Substitui o arquivo do disco atual por outro (carregar disco 2 de outro ISO).
#[tauri::command]
fn libretro_replace_disc(path: String) -> Result<(), String> {
    let s = libretro::state();
    let g = s.lock().unwrap();
    let Some(ptr) = g.disk_control else { return Err("Core nao suporta troca de disco".into()); };
    unsafe {
        let cb = &*ptr;
        let eject       = cb.set_eject_state.ok_or("set_eject_state ausente")?;
        let get_idx     = cb.get_image_index.ok_or("get_image_index ausente")?;
        let replace_idx = cb.replace_image_index.ok_or("replace_image_index ausente")?;
        let cur = get_idx();
        let path_cs = std::ffi::CString::new(path.clone()).map_err(|e| e.to_string())?;
        let info = libretro::RetroGameInfo {
            path: path_cs.as_ptr(),
            data: std::ptr::null(),
            size: 0,
            meta: std::ptr::null(),
        };
        eject(true);
        if !replace_idx(cur, &info as *const _) {
            eject(false);
            return Err(format!("replace_image_index({}) falhou", cur));
        }
        eject(false);
    }
    log::info!("[libretro] replaced disc -> {}", path);
    Ok(())
}

fn save_state_path(rom_path: &str, slot: u32) -> Option<PathBuf> {
    // v0.9.2: ludex_assets_base (publico no Android). dirs::data_dir() nao e
    // confiavel no Android -> save states davam path invalido / falhavam.
    let dir = ludex_assets_base().join("saves-libretro");
    std::fs::create_dir_all(&dir).ok()?;
    let stem = Path::new(rom_path).file_stem()?.to_string_lossy().to_string();
    let safe = sanitize_filename(&stem);
    Some(dir.join(format!("{}.slot{}.state", safe, slot)))
}

fn save_thumb_path(rom_path: &str, slot: u32) -> Option<PathBuf> {
    let dir = ludex_assets_base().join("saves-libretro");
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
    drop(sg);
    libretro::audio_buf().lock().unwrap().clear();
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
    // v0.8.12: tambem escreve em stderr (logcat RustStdoutStderr) pra debug Android
    eprintln!("[FRONTEND/{}] {}", level, message);
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

// ============================================================
// === ANDROID: MANAGE_EXTERNAL_STORAGE permission ============
// ============================================================
// v0.8.13: chama Kotlin gg.ludex.app.Permissions via JNI.
// v0.8.14: inicializa ndk_context manualmente via funcao native chamada
// pela MainActivity.onCreate (Kotlin). Sem isso, ndk_context::android_context()
// panica com "android context was not initialized".

#[cfg(target_os = "android")]
static ANDROID_ACTIVITY: std::sync::OnceLock<jni::objects::GlobalRef> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_gg_ludex_app_MainActivity_ludexInitNdkContext<'local>(
    mut env: jni::JNIEnv<'local>,
    _class: jni::objects::JClass<'local>,
    activity: jni::objects::JObject<'local>,
) {
    let Ok(vm) = env.get_java_vm() else { return; };
    let vm_ptr = vm.get_java_vm_pointer() as *mut std::ffi::c_void;
    let Ok(activity_ref) = env.new_global_ref(&activity) else { return; };
    let raw_activity = activity_ref.as_obj().as_raw() as *mut std::ffi::c_void;
    let _ = ANDROID_ACTIVITY.set(activity_ref);
    unsafe { ndk_context::initialize_android_context(vm_ptr, raw_activity); }
}

#[cfg(target_os = "android")]
fn jni_call_permissions<F, R>(method: &str, sig: &str, args_fn: F) -> Result<R, String>
where
    F: for<'a> FnOnce(&mut jni::JNIEnv<'a>) -> Result<(Vec<jni::objects::JValueOwned<'a>>, R), String>,
{
    use jni::objects::JValue;
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let (args, ret) = args_fn(&mut env)?;
    let jargs: Vec<JValue> = args.iter().map(|v| v.borrow()).collect();
    env.call_static_method("gg/ludex/app/Permissions", method, sig, &jargs)
        .map_err(|e| format!("JNI {}: {}", method, e))?;
    Ok(ret)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_has_all_files_access() -> bool {
    let ctx = ndk_context::android_context();
    let Ok(vm) = (unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }) else { return false; };
    let Ok(mut env) = vm.attach_current_thread() else { return false; };
    env.call_static_method("gg/ludex/app/Permissions", "hasAllFilesAccess", "()Z", &[])
        .ok()
        .and_then(|v| v.z().ok())
        .unwrap_or(false)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_open_all_files_settings() -> Result<(), String> {
    use jni::objects::JObject;
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    env.call_static_method(
        "gg/ludex/app/Permissions",
        "openAllFilesAccessSettings",
        "(Landroid/app/Activity;)V",
        &[(&activity).into()],
    ).map_err(|e| format!("JNI openSettings: {}", e))?;
    Ok(())
}

// Stubs pra desktop: sempre tem acesso, abrir settings nao faz nada
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_has_all_files_access() -> bool { true }

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_open_all_files_settings() -> Result<(), String> { Ok(()) }

// --- v0.8.17: abrir pasta Ludex no Files Manager + launch app externo (AetherSX2) ---

#[cfg(target_os = "android")]
#[tauri::command]
fn android_open_folder(abs_path: String) -> Result<(), String> {
    use jni::objects::{JObject, JString};
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    let jpath: JString = env.new_string(&abs_path).map_err(|e| e.to_string())?;
    env.call_static_method(
        "gg/ludex/app/Permissions",
        "openFolder",
        "(Landroid/app/Activity;Ljava/lang/String;)V",
        &[(&activity).into(), (&jpath).into()],
    ).map_err(|e| format!("JNI openFolder: {}", e))?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_launch_external_emu(package_name: String, rom_path: String) -> Result<bool, String> {
    use jni::objects::{JObject, JString};
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    let jpkg: JString = env.new_string(&package_name).map_err(|e| e.to_string())?;
    let jrom: JString = env.new_string(&rom_path).map_err(|e| e.to_string())?;
    let ok = env.call_static_method(
        "gg/ludex/app/Permissions",
        "launchExternalEmulator",
        "(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;)Z",
        &[(&activity).into(), (&jpkg).into(), (&jrom).into()],
    ).map_err(|e| format!("JNI launchExternal: {}", e))?
     .z().map_err(|e| e.to_string())?;
    Ok(ok)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_open_play_store(package_name: String) -> Result<(), String> {
    use jni::objects::{JObject, JString};
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    let jpkg: JString = env.new_string(&package_name).map_err(|e| e.to_string())?;
    env.call_static_method(
        "gg/ludex/app/Permissions",
        "openPlayStorePage",
        "(Landroid/app/Activity;Ljava/lang/String;)V",
        &[(&activity).into(), (&jpkg).into()],
    ).map_err(|e| format!("JNI openPlay: {}", e))?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_is_package_installed(package_name: String) -> bool {
    use jni::objects::{JObject, JString};
    let ctx = ndk_context::android_context();
    let Ok(vm) = (unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }) else { return false; };
    let Ok(mut env) = vm.attach_current_thread() else { return false; };
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    let Ok(jpkg): Result<JString, _> = env.new_string(&package_name) else { return false; };
    env.call_static_method(
        "gg/ludex/app/Permissions",
        "isPackageInstalled",
        "(Landroid/app/Activity;Ljava/lang/String;)Z",
        &[(&activity).into(), (&jpkg).into()],
    ).ok().and_then(|v| v.z().ok()).unwrap_or(false)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_ludex_base_path() -> String {
    // v0.9.2: pasta PUBLICA — o botao "Abrir pasta Ludex no Files" precisa abrir
    // um caminho que o gerenciador de arquivos consiga acessar. /data/data/... e
    // storage privado do app (file manager nao abre) e nem e onde BIOS/saves
    // ficam de verdade. Aqui ficam roms/, system/, saves-libretro/, music/.
    "/storage/emulated/0/Ludex".to_string()
}

// Stubs desktop
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_open_folder(_abs_path: String) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_launch_external_emu(_package_name: String, _rom_path: String) -> Result<bool, String> { Ok(false) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_open_play_store(_package_name: String) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_is_package_installed(_package_name: String) -> bool { false }

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_ludex_base_path() -> String {
    dirs::data_dir()
        .map(|p| p.join("Ludex").to_string_lossy().to_string())
        .unwrap_or_default()
}

// ============================================================
// === AUTO-UPDATE Android (manual via latest.json + APK install)
// ============================================================
// Tauri updater plugin nao suporta Android. Implementacao propria:
// 1. check_update_info: fetch latest.json do GitHub Releases, compara versao
// 2. download_apk_to_cache: baixa Ludex_X.X.X.apk pro app cache_dir
// 3. android_install_apk: dispara intent ACTION_VIEW via Permissions.installApk

#[derive(Serialize, Default)]
struct UpdateInfo {
    available: bool,
    current: String,
    latest: String,
    notes: String,
    apk_url: String,
    exe_url: String,
}

#[tauri::command]
async fn check_update_info() -> Result<UpdateInfo, String> {
    const ENDPOINT: &str = "https://github.com/EllaeMyApp/ludex/releases/latest/download/latest.json";
    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(ENDPOINT).send().await.map_err(|e| format!("fetch latest.json: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("parse json: {}", e))?;
    let latest = json["version"].as_str().unwrap_or("").to_string();
    let notes  = json["notes"].as_str().unwrap_or("").to_string();
    let exe_url = json["platforms"]["windows-x86_64"]["url"].as_str().unwrap_or("").to_string();
    // APK url segue convencao: substitui Ludex_X.X.X_x64-setup.exe -> Ludex_X.X.X.apk
    let apk_url = if !latest.is_empty() {
        format!("https://github.com/EllaeMyApp/ludex/releases/download/v{0}/Ludex_{0}.apk", latest)
    } else { String::new() };
    let current = env!("CARGO_PKG_VERSION").to_string();
    let available = !latest.is_empty() && version_is_newer(&latest, &current);
    Ok(UpdateInfo { available, current, latest, notes, apk_url, exe_url })
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn android_download_apk(apk_url: String) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;
    // Cache dir do app via Kotlin
    let cache_dir = android_update_cache_dir_inner()?;
    let dest_path = format!("{}/ludex-update.apk", cache_dir);
    // Apaga arquivo anterior (pode ser HTML 404 de release sem APK)
    let _ = std::fs::remove_file(&dest_path);
    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&apk_url).send().await.map_err(|e| format!("download: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Atualizacao indisponivel (HTTP {}). Tente novamente em alguns minutos.", resp.status()));
    }
    // Stream pra disco pra evitar OOM em APKs grandes (200MB+)
    let mut file = tokio::fs::File::create(&dest_path).await
        .map_err(|e| format!("create file: {}", e))?;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt; // bytes_stream() retorna Stream
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("read chunk: {}", e))?;
        file.write_all(&bytes).await.map_err(|e| format!("write chunk: {}", e))?;
    }
    file.flush().await.map_err(|e| format!("flush: {}", e))?;
    drop(file);
    // Valida magic bytes PK\x03\x04 (APK = ZIP). Se for HTML 404 ou corrompido, falha aqui
    // em vez de crashar o PackageInstaller do Android.
    let mut hdr = [0u8; 4];
    use std::io::Read;
    let mut fp = std::fs::File::open(&dest_path).map_err(|e| format!("reopen: {}", e))?;
    fp.read_exact(&mut hdr).map_err(|e| format!("read header: {}", e))?;
    if &hdr != b"PK\x03\x04" {
        let _ = std::fs::remove_file(&dest_path);
        return Err(String::from("Arquivo baixado nao e um APK valido. Pode ser que a versao Android ainda nao tenha sido publicada."));
    }
    Ok(dest_path)
}

#[cfg(target_os = "android")]
fn android_update_cache_dir_inner() -> Result<String, String> {
    use jni::objects::JObject;
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    let result = env.call_static_method(
        "gg/ludex/app/Permissions",
        "updateCacheDir",
        "(Landroid/app/Activity;)Ljava/lang/String;",
        &[(&activity).into()],
    ).map_err(|e| format!("JNI cacheDir: {}", e))?;
    let jstr: jni::objects::JString = result.l().map_err(|e| e.to_string())?.into();
    let rust_str: String = env.get_string(&jstr).map_err(|e| e.to_string())?.into();
    Ok(rust_str)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_install_apk(apk_path: String) -> Result<bool, String> {
    use jni::objects::{JObject, JString, JValueGen};
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    let jpath: JString = env.new_string(&apk_path).map_err(|e| e.to_string())?;
    let result = env.call_static_method(
        "gg/ludex/app/Permissions",
        "installApk",
        "(Landroid/app/Activity;Ljava/lang/String;)Z",
        &[JValueGen::Object(&activity), JValueGen::Object(&jpath)],
    );
    // Se Kotlin lancou exception (IllegalStateException com msg de erro), extrai a msg
    if env.exception_check().unwrap_or(false) {
        let throwable = env.exception_occurred().map_err(|e| e.to_string())?;
        env.exception_clear().ok();
        let msg_obj = env.call_method(&throwable, "getMessage", "()Ljava/lang/String;", &[])
            .ok()
            .and_then(|v| v.l().ok());
        let msg = if let Some(o) = msg_obj {
            if !o.is_null() {
                let jstr: JString = o.into();
                env.get_string(&jstr).map(|s| s.into()).unwrap_or_else(|_| String::from("erro JNI"))
            } else { String::from("erro JNI (sem mensagem)") }
        } else { String::from("erro JNI (sem mensagem)") };
        return Err(msg);
    }
    let ok = result.map_err(|e| format!("JNI installApk: {}", e))?
        .z().map_err(|e| e.to_string())?;
    Ok(ok)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn android_download_apk(_apk_url: String) -> Result<String, String> { Ok(String::new()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_install_apk(_apk_path: String) -> Result<bool, String> { Ok(false) }

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
    saves_path: String, // v0.8.47: pasta de saves/memory cards libretro
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
    // v0.9.2: saves libretro em ludex_assets_base/saves-libretro (publico no Android)
    let saves_dir = ludex_assets_base().join("saves-libretro");
    let _ = std::fs::create_dir_all(&saves_dir);
    Ok(SystemFolders {
        system_id: cfg.id.to_string(),
        system_name: cfg.name.to_string(),
        roms_path: base.to_string_lossy().to_string(),
        dlc_path: dlc.to_string_lossy().to_string(),
        mods_path: mods.to_string_lossy().to_string(),
        saves_path: saves_dir.to_string_lossy().to_string(),
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
    #[cfg(target_os = "android")]
    {
        use jni::objects::{JObject, JString};
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
        let jurl: JString = env.new_string(&url).map_err(|e| e.to_string())?;
        env.call_static_method(
            "gg/ludex/app/Permissions",
            "openUrl",
            "(Landroid/app/Activity;Ljava/lang/String;)V",
            &[(&activity).into(), (&jurl).into()],
        ).map_err(|e| format!("JNI openUrl: {}", e))?;
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("abrir url: {}", e))?;
        Ok(())
    }
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
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        trash::delete(&target).map_err(|e| format!("Lixeira: {}", e))?;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        // Mobile: nao tem lixeira do SO, deleta direto
        if target.is_dir() {
            std::fs::remove_dir_all(&target).map_err(|e| format!("Remove dir: {}", e))?;
        } else {
            std::fs::remove_file(&target).map_err(|e| format!("Remove file: {}", e))?;
        }
    }
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

    let client = http_client_builder()
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
    let fields = "fields name, summary, storyline, first_release_date, rating, cover.url, screenshots.url, genres.name, involved_companies.developer, involved_companies.publisher, involved_companies.company.name, videos.video_id, videos.name";
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
    // v2 cache filename (v0.6.6+): separa do .json v1 (sem videos) pra forcar refetch.
    // Caches v1 antigos ficam orfaos no disco mas nao causam problema.
    let cache_file = cache_dir.join(format!("{}.v2.json", safe));

    // Cache hit
    if let Ok(data) = std::fs::read_to_string(&cache_file) {
        if let Ok(d) = serde_json::from_str::<GameDetails>(&data) {
            return Some(d);
        }
    }

    let client = http_client_builder()
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

    let videos: Vec<GameVideo> = g.videos
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.video_id.map(|yid| GameVideo { youtube_id: yid, name: v.name }))
        .take(3)
        .collect();

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
        videos,
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
    let f_v2 = dir.join(format!("{}.v2.json", safe));
    if f_v2.is_file() { std::fs::remove_file(&f_v2).map_err(|e| e.to_string())?; }
    let f_v1 = dir.join(format!("{}.json", safe));
    if f_v1.is_file() { std::fs::remove_file(&f_v1).map_err(|e| e.to_string())?; }
    Ok(())
}

/// Background thread que polla o controle nativamente (XInput) e mata o emulador
/// rodando quando o usuario aperta Select+Start juntos. Standard RetroArch combo.
/// SO desktop — em Android usamos Android Gamepad API direto via input events.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
// === GUMROAD LICENSE — activate / validate / deactivate =====
// ============================================================
// Doc: https://gumroad.com/api#license-keys
// Endpoint principal: POST https://api.gumroad.com/v2/licenses/verify
// Returns: { success, uses, purchase: { ... } }
//
// Credenciais Gumroad ficam em src/secrets.rs (gitignored). Ver
// secrets.rs.example pra setup novo. Token eh READ-only-license: so verifica
// licenses, nao da pra editar produto.

mod secrets;
use secrets::{GUMROAD_PRODUCT_ID, GUMROAD_ACCESS_TOKEN, GUMROAD_PERMALINK, ADMIN_EMAIL};
use sha2::{Digest, Sha256};

/// Maximo de PCs (uses count) que uma license aceita. Soft-enforce no backend.
/// v0.8.25: aumentado de 2 -> 5 (Windows + Android + 2 spare em caso de
/// reinstall/troca de hardware). Admin email bypassa esse check de qualquer jeito.
const GUMROAD_MAX_USES: u32 = 5;
/// Quantos dias de grace period offline antes de bloquear o app por falta de
/// validacao online. 30 dias = user viaja sem internet sem perder acesso.
const LICENSE_OFFLINE_GRACE_DAYS: u64 = 30;
/// Maximo de deactivates permitidos em 24h. Anti-share farm: se alguem fica
/// trocando entre 3+ amigos, vai estourar esse limite rapido.
const DEACTIVATE_RATE_LIMIT_PER_DAY: usize = 5;

// === Hardware fingerprint ===================================================
// Combina valores estaveis do PC (Windows MachineGuid + MAC primario + CPU
// brand) num SHA256. Usado pra amarrar a license ao hardware: se o config.json
// for copiado pra outro PC, o fingerprint nao bate e a license eh recusada.
//
// Tolerancia: se MachineGuid mudar (Win11 Reset, troca de placa-mae, etc), o
// app nao bloqueia cego — chama license_validate online. Se Gumroad disser que
// a key continua boa e uses < MAX, ele REGRAVA o fingerprint pro novo
// hardware. Soft-enforce.

#[cfg(windows)]
fn read_machine_guid() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography").ok()?;
    key.get_value("MachineGuid").ok()
}

#[cfg(not(windows))]
fn read_machine_guid() -> Option<String> { None }

#[cfg(windows)]
fn read_cpu_name() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm.open_subkey("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0").ok()?;
    key.get_value("ProcessorNameString").ok()
}

#[cfg(not(windows))]
fn read_cpu_name() -> Option<String> { None }

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn primary_mac() -> Option<String> {
    mac_address::get_mac_address().ok().flatten().map(|m| m.to_string())
}

// Android: usa ANDROID_ID (64-bit hex unico por device/user) via System.getString.
// Como nao temos acesso direto a JNI aqui, deixamos fallback baseado em hostname.
// O ideal seria usar tauri-android com plugin de identidade, mas pra primeiro build
// um id estavel-por-instalacao basta (Android nao tem MAC publico desde API 23 anyway).
#[cfg(any(target_os = "android", target_os = "ios"))]
fn primary_mac() -> Option<String> {
    // Tenta /etc/machine-id (existe em Android via libc fallback as vezes) ou hostname
    std::fs::read_to_string("/etc/machine-id").ok().map(|s| s.trim().to_string())
        .or_else(|| hostname_fallback())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn hostname_fallback() -> Option<String> {
    std::env::var("HOSTNAME").ok().filter(|s| !s.is_empty())
}

fn machine_fingerprint() -> String {
    let guid = read_machine_guid().unwrap_or_else(|| "no-guid".into());
    let mac  = primary_mac().unwrap_or_else(|| "no-mac".into());
    let cpu  = read_cpu_name().unwrap_or_else(|| "no-cpu".into());
    let combined = format!("{}|{}|{}", guid, mac, cpu);
    let mut hasher = Sha256::new();
    hasher.update(combined.as_bytes());
    hex::encode(hasher.finalize())
}

// === Dual storage (config.json + registry HKCU) =============================
// Espelha license_validated_at e license_uses no registry HKCU. Se um for
// editado pra estender a validacao, o outro denuncia. Politica anti-tamper:
// usa o MENOR validated_at dos dois (atacante consegue ESTENDER um, mas precisa
// alterar OS DOIS pra avancar — o que eh trabalho real).

#[cfg(windows)]
fn registry_write_state(validated_at: u64, uses: u32, fingerprint: Option<&str>) {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = match hkcu.create_subkey("Software\\Ludex\\license_state") {
        Ok(v) => v, Err(_) => return,
    };
    let _ = key.set_value("validated_at", &validated_at);
    let _ = key.set_value("uses", &uses);
    if let Some(fp) = fingerprint {
        let _ = key.set_value("fingerprint", &fp.to_string());
    }
}

#[cfg(not(windows))]
fn registry_write_state(_: u64, _: u32, _: Option<&str>) {}

#[cfg(windows)]
fn registry_read_state() -> Option<(u64, u32, Option<String>)> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey("Software\\Ludex\\license_state").ok()?;
    let validated_at: u64 = key.get_value("validated_at").unwrap_or(0);
    let uses: u32 = key.get_value("uses").unwrap_or(0);
    let fingerprint: Option<String> = key.get_value("fingerprint").ok();
    Some((validated_at, uses, fingerprint))
}

#[cfg(not(windows))]
fn registry_read_state() -> Option<(u64, u32, Option<String>)> { None }

/// Le o estado de license consensual entre config.json e registry HKCU.
/// Politica anti-tamper: usa o MENOR validated_at — atacante teria que editar
/// AMBOS pra estender o grace period.
fn read_state_consensus(cfg: &AppConfig) -> (u64, u32, Option<String>) {
    let cfg_va = cfg.license_validated_at;
    let cfg_uses = cfg.license_uses;
    let cfg_fp = cfg.license_fingerprint.clone();
    match registry_read_state() {
        Some((reg_va, reg_uses, reg_fp)) => {
            // Usa o MENOR validated_at dos dois (anti-tamper).
            let va = cfg_va.min(reg_va);
            // Pra uses, usa o MAIOR (anti-bypass: se attacker zerar um, o outro denuncia).
            let uses = cfg_uses.max(reg_uses);
            // Fingerprint: se um esta vazio, usa o outro. Se diferentes, usa o do config (o registry pode ter ficado desatualizado).
            let fp = cfg_fp.or(reg_fp);
            (va, uses, fp)
        }
        None => (cfg_va, cfg_uses, cfg_fp),
    }
}

/// Espelha o state em ambos os lugares.
fn write_state_to_both(cfg: &mut AppConfig, validated_at: u64, uses: u32, fingerprint: Option<String>) {
    cfg.license_validated_at = validated_at;
    cfg.license_uses = uses;
    if fingerprint.is_some() {
        cfg.license_fingerprint = fingerprint.clone();
    }
    registry_write_state(validated_at, uses, fingerprint.as_deref());
}

/// Filtra o log de deactivates pra so timestamps nas ultimas 24h.
fn prune_deactivate_log(log: &mut Vec<u64>) {
    let now = now_secs();
    let day_ago = now.saturating_sub(86400);
    log.retain(|&t| t > day_ago);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LicenseInfo {
    /// Validade booleana (true = pode usar o app, false = trancado)
    valid: bool,
    /// Mensagem amigavel pra mostrar no UI (sucesso ou erro)
    message: String,
    /// Quantos PCs ja foram ativados com essa key
    uses: u32,
    /// Limite de PCs (default GUMROAD_MAX_USES)
    max_uses: u32,
    /// Email de quem comprou (mostrar nos Settings)
    buyer_email: Option<String>,
    /// Quando foi a ultima validacao com sucesso (timestamp Unix)
    validated_at: u64,
    /// Permalink pra abrir checkout caso valid=false
    purchase_url: String,
    /// True se o email do comprador bate com ADMIN_EMAIL. Frontend usa pra
    /// mostrar o botao "Painel Admin" no Settings. Sem bypass de seguranca.
    #[serde(default)]
    is_admin: bool,
}

fn license_purchase_url() -> String { GUMROAD_PERMALINK.to_string() }

// `now_secs` ja esta definido la em cima (linha ~1148) — nao redefinir aqui.

/// Chama POST /v2/licenses/verify do Gumroad.
/// `increment_uses` = true so na primeira ativacao naquele PC.
async fn gumroad_verify(key: &str, increment_uses: bool) -> Result<LicenseInfo, String> {
    if GUMROAD_ACCESS_TOKEN == "PLACEHOLDER_ACCESS_TOKEN" {
        return Err("Sistema de licenca nao configurado (build de desenvolvimento)".into());
    }
    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Ludex/0.5 (license-validator)")
        .build()
        .map_err(|e| format!("http client: {}", e))?;
    let mut form = std::collections::HashMap::new();
    form.insert("product_id", GUMROAD_PRODUCT_ID.to_string());
    form.insert("license_key", key.trim().to_string());
    form.insert("increment_uses_count", if increment_uses { "true" } else { "false" }.to_string());
    let resp = client.post("https://api.gumroad.com/v2/licenses/verify")
        .bearer_auth(GUMROAD_ACCESS_TOKEN)
        .form(&form)
        .send().await
        .map_err(|e| format!("gumroad request: {}", e))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("gumroad parse: {}", e))?;
    let success = body.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if !status.is_success() || !success {
        let msg = body.get("message").and_then(|v| v.as_str()).unwrap_or("license invalida");
        return Err(msg.to_string());
    }
    let uses = body.get("uses").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let buyer_email = body.pointer("/purchase/email")
        .and_then(|v| v.as_str()).map(String::from);
    let is_admin = buyer_email.as_deref()
        .map(|e| e.eq_ignore_ascii_case(ADMIN_EMAIL))
        .unwrap_or(false);
    // v0.8.25: admin bypassa check de uses (uso ilimitado pra dev/owner)
    if uses > GUMROAD_MAX_USES && !is_admin {
        return Err(format!("Limite de {} PCs ja atingido com essa license. Desative em outro PC ou compre outra.", GUMROAD_MAX_USES));
    }
    Ok(LicenseInfo {
        valid: true,
        message: "Licenca ativa".into(),
        uses,
        max_uses: GUMROAD_MAX_USES,
        buyer_email,
        validated_at: now_secs(),
        purchase_url: license_purchase_url(),
        is_admin,
    })
}

/// Ativa uma license key nova (cliente acabou de comprar e colou a key).
/// increment_uses=true consome 1 slot dos 2 disponiveis. Tambem captura o
/// hardware fingerprint atual e espelha o state no registry HKCU.
#[tauri::command]
async fn license_activate(key: String) -> Result<LicenseInfo, String> {
    let info = gumroad_verify(&key, true).await?;
    let fingerprint = machine_fingerprint();
    let mut cfg = load_config();
    cfg.license_key = Some(key.trim().to_string());
    write_state_to_both(&mut cfg, info.validated_at, info.uses, Some(fingerprint));
    save_config_internal(cfg)?;
    Ok(info)
}

/// Re-valida a license atual (chamada na startup + 1x/semana em background).
/// increment_uses=false (nao consome slot).
/// Se sem internet e dentro do grace period (30 dias), retorna valid=true cached.
/// Se fora do grace period sem internet, retorna valid=false (app trancado).
#[tauri::command]
async fn license_validate() -> Result<LicenseInfo, String> {
    let cfg = load_config();
    let key = cfg.license_key.clone().ok_or("Nenhuma license cadastrada")?;
    // Le state consensual (anti-tamper: usa o MENOR validated_at e o MAIOR uses entre config.json e HKCU)
    let (consensus_va, consensus_uses, stored_fp) = read_state_consensus(&cfg);
    let current_fp = machine_fingerprint();

    match gumroad_verify(&key, false).await {
        Ok(info) => {
            // Online + key boa. Verifica fingerprint. Se mudou, REGRAVA pro novo
            // hardware — Gumroad ja confirmou que a license eh valida e dentro
            // do limite. Soft-enforce (usuario legitimo trocou hardware).
            let mut cfg = load_config();
            write_state_to_both(&mut cfg, info.validated_at, info.uses, Some(current_fp));
            save_config_internal(cfg).ok();
            Ok(info)
        }
        Err(e) => {
            // Offline (ou key revogada). Checa fingerprint antes de conceder grace
            // period — se hardware nao bate com o que ativou, NAO concede offline.
            if let Some(stored) = stored_fp {
                if stored != current_fp {
                    return Err(format!(
                        "Hardware diferente do que ativou essa license. Reconecte na internet pra revalidar. Detalhes: {}", e
                    ));
                }
            }
            let age_days = now_secs().saturating_sub(consensus_va) / 86400;
            if consensus_va > 0 && age_days < LICENSE_OFFLINE_GRACE_DAYS {
                return Ok(LicenseInfo {
                    valid: true,
                    message: format!("Modo offline (validacao ha {} dias)", age_days),
                    uses: consensus_uses,
                    max_uses: GUMROAD_MAX_USES,
                    buyer_email: None,
                    validated_at: consensus_va,
                    purchase_url: license_purchase_url(),
                    is_admin: false,
                });
            }
            Err(format!("Validacao falhou: {}", e))
        }
    }
}

/// Libera 1 slot dos 2 (chamado quando user clica "Desativar este PC").
/// Endpoint: PUT /v2/licenses/decrement_uses_count.
/// Rate limit: maximo 5 deactivates em 24h por PC. Anti-share farm.
#[tauri::command]
async fn license_deactivate() -> Result<(), String> {
    if GUMROAD_ACCESS_TOKEN == "PLACEHOLDER_ACCESS_TOKEN" {
        return Err("Sistema de licenca nao configurado".into());
    }
    let mut cfg = load_config();
    let key = cfg.license_key.clone().ok_or("Nenhuma license cadastrada")?;

    // Rate limit
    prune_deactivate_log(&mut cfg.license_deactivate_log);
    if cfg.license_deactivate_log.len() >= DEACTIVATE_RATE_LIMIT_PER_DAY {
        return Err(format!(
            "Limite de {} desativacoes por dia atingido. Tente novamente daqui algumas horas.",
            DEACTIVATE_RATE_LIMIT_PER_DAY
        ));
    }

    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(15))
        .build().map_err(|e| format!("http: {}", e))?;
    let mut form = std::collections::HashMap::new();
    form.insert("product_id", GUMROAD_PRODUCT_ID.to_string());
    form.insert("license_key", key);
    let resp = client.put("https://api.gumroad.com/v2/licenses/decrement_uses_count")
        .bearer_auth(GUMROAD_ACCESS_TOKEN)
        .form(&form)
        .send().await.map_err(|e| format!("decrement: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Gumroad retornou {}", resp.status()));
    }

    // Registra deactivate e limpa local
    cfg.license_deactivate_log.push(now_secs());
    cfg.license_key = None;
    cfg.license_fingerprint = None;
    write_state_to_both(&mut cfg, 0, 0, None);
    save_config_internal(cfg)?;
    Ok(())
}

/// Retorna info local da license (sem chamar Gumroad). Usado no LicenseGate
/// pra decidir se mostra a tela de input (sem license) ou a home (com).
/// Usa state consensual entre config.json e HKCU.
#[tauri::command]
fn license_get_local_info() -> Option<LicenseInfo> {
    let cfg = load_config();
    let _key = cfg.license_key.as_ref()?;
    let (consensus_va, consensus_uses, stored_fp) = read_state_consensus(&cfg);
    let age_days = now_secs().saturating_sub(consensus_va) / 86400;
    let mut valid = consensus_va > 0 && age_days < LICENSE_OFFLINE_GRACE_DAYS;

    // Anti-tamper: se fingerprint salvo nao bate com hardware atual, considera invalido
    // (vai forcar license_validate online no startup).
    if valid {
        if let Some(fp) = &stored_fp {
            if *fp != machine_fingerprint() {
                valid = false;
            }
        }
    }

    Some(LicenseInfo {
        valid,
        message: if valid { "Licenca ativa (cache local)".into() }
                 else { "Licenca precisa revalidar online".into() },
        uses: consensus_uses,
        max_uses: GUMROAD_MAX_USES,
        buyer_email: None,
        validated_at: consensus_va,
        purchase_url: license_purchase_url(),
        is_admin: false, // is_admin so eh sabido apos chamar Gumroad
    })
}

#[tauri::command]
fn license_purchase_link() -> String {
    license_purchase_url()
}

// ============================================================
// === ADMIN COMMANDS — somente pra license cujo email = ADMIN_EMAIL =========
// ============================================================
// Cada command chama gumroad_verify pra confirmar que o caller eh admin antes
// de retornar qualquer coisa. Isso impede um cliente normal de chamar
// admin_list_sales via DevTools — ate o backend confirmar com o Gumroad que o
// email bate, nada vaza.

async fn ensure_admin() -> Result<(), String> {
    let cfg = load_config();
    let key = cfg.license_key.ok_or("Nenhuma license cadastrada")?;
    let info = gumroad_verify(&key, false).await
        .map_err(|e| format!("Falha ao validar admin: {}", e))?;
    if !info.is_admin {
        return Err("Acesso negado: essa license nao tem permissao de admin".into());
    }
    Ok(())
}

/// Lista vendas do produto via /v2/sales. Retorna JSON cru do Gumroad pra
/// frontend formatar como quiser. Page comeca em 1; sem page = 1.
#[tauri::command]
async fn admin_list_sales(page: Option<u32>) -> Result<serde_json::Value, String> {
    ensure_admin().await?;
    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Ludex/0.6 (admin-panel)")
        .build().map_err(|e| format!("http: {}", e))?;
    let url = match page {
        Some(p) if p > 1 => format!("https://api.gumroad.com/v2/sales?page={}", p),
        _ => "https://api.gumroad.com/v2/sales".to_string(),
    };
    let resp = client.get(&url)
        .bearer_auth(GUMROAD_ACCESS_TOKEN)
        .send().await.map_err(|e| format!("sales request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Gumroad retornou {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("sales parse: {}", e))?;
    Ok(body)
}

/// Decrementa o uses_count de QUALQUER license (nao precisa ser a do PC atual).
/// Usado pra Paulo liberar 1 slot de um cliente que pediu suporte por email.
#[tauri::command]
async fn admin_force_deactivate(license_key: String) -> Result<(), String> {
    ensure_admin().await?;
    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(15))
        .build().map_err(|e| format!("http: {}", e))?;
    let mut form = std::collections::HashMap::new();
    form.insert("product_id", GUMROAD_PRODUCT_ID.to_string());
    form.insert("license_key", license_key.trim().to_string());
    let resp = client.put("https://api.gumroad.com/v2/licenses/decrement_uses_count")
        .bearer_auth(GUMROAD_ACCESS_TOKEN)
        .form(&form)
        .send().await.map_err(|e| format!("decrement: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Gumroad retornou {}", resp.status()));
    }
    Ok(())
}

/// Verifica se a license ativa atual eh admin (consultando Gumroad).
/// Retorna false se nenhum license, ou se email nao bate. NAO eh source of
/// truth — admin_list_sales / admin_force_deactivate revalidam por conta.
#[tauri::command]
async fn admin_check_status() -> Result<bool, String> {
    let cfg = load_config();
    let key = match cfg.license_key {
        Some(k) => k,
        None => return Ok(false),
    };
    let info = gumroad_verify(&key, false).await?;
    Ok(info.is_admin)
}

/// Retorna a URL do dashboard Gumroad pra Paulo abrir no browser quando
/// quiser refundar/banir uma sale (a API publica nao expoe disable_license).
#[tauri::command]
fn admin_dashboard_url() -> String {
    "https://app.gumroad.com/dashboard".to_string()
}

// ============================================================
// === ANDROID DEMO TIME LIMIT (v0.7.4+) ======================
// APK e distribuido gratis no GitHub, mas com tempo limite de
// uso. Apos N dias, app trava com tela "demo expirou". Admin
// (Paulo, via license key dele) tem unlock permanente.
// ============================================================

const ANDROID_DEMO_DAYS: u64 = 7;

#[derive(Serialize, Clone)]
struct AndroidDemoStatus {
    expired: bool,
    days_left: i64,       // negativo se expirado
    is_admin_unlocked: bool,
    installed_at: u64,
    demo_days_total: u64,
    /// True se detectamos manipulacao do relogio (clock < installed_at).
    /// Quando true, expired tambem e true.
    clock_tampered: bool,
}

// Construido via serde_json::from_str em demo runtime — compilador nao detecta
// construcao implicita por Deserialize, dai o allow.
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct DemoAnchor {
    installed_at: u64,
    fingerprint: String,
    /// Maior timestamp ja visto pra detectar rollback do relogio.
    /// Atualizado a cada launch com max(self, now).
    last_seen_at: u64,
}

/// Path do anchor file em /sdcard/Ludex/.demo_anchor.json (Android).
/// Fica fora do app dir — sobrevive a desinstalar/reinstalar do APK.
#[cfg(target_os = "android")]
fn demo_anchor_path() -> std::path::PathBuf {
    std::path::PathBuf::from("/storage/emulated/0/Ludex/.demo_anchor.json")
}

#[cfg(target_os = "android")]
fn read_demo_anchor() -> Option<DemoAnchor> {
    let path = demo_anchor_path();
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

#[cfg(target_os = "android")]
fn write_demo_anchor(anchor: &DemoAnchor) {
    let path = demo_anchor_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(data) = serde_json::to_string_pretty(anchor) {
        let _ = std::fs::write(&path, data);
    }
}

/// Retorna estado da demo Android. ANTI-CHEAT v0.7.5+:
/// - Salva anchor em 2 lugares: config.json (app dir) + /sdcard/Ludex/.demo_anchor.json
/// - Sobrevive a uninstall/reinstall (anchor file fica em /sdcard fora do app dir)
/// - Detecta clock rollback (se now < last_seen_at, user voltou o relogio = expira)
/// - Usa min(installed_at) entre todos os lugares — mais antigo vence
/// - Fingerprint do device pra detectar copy entre devices
/// Em desktop: sempre retorna unlocked.
#[tauri::command]
fn android_demo_status() -> AndroidDemoStatus {
    let cfg = load_config();

    // Desktop: sempre libera
    #[cfg(not(target_os = "android"))]
    {
        return AndroidDemoStatus {
            expired: false,
            days_left: 9999,
            is_admin_unlocked: true,
            installed_at: cfg.android_installed_at,
            demo_days_total: ANDROID_DEMO_DAYS,
            clock_tampered: false,
        };
    }

    #[cfg(target_os = "android")]
    {
        let now = now_secs();
        let fp = machine_fingerprint();

        // 1. Le anchor do arquivo /sdcard (sobrevive a uninstall)
        let file_anchor = read_demo_anchor();

        // 2. Combina installed_at: usa MENOR valor entre config e file (mais antigo vence)
        let mut installed_at = match (cfg.android_installed_at, file_anchor.as_ref()) {
            (0, None) => now,           // primeira vez ever
            (0, Some(a)) => a.installed_at,
            (c, None) => c,
            (c, Some(a)) => c.min(a.installed_at),
        };
        // Sanity: se o installed_at e no FUTURO, alguem mexeu no clock pra tras DEPOIS
        // de instalar. Trata como "instalou agora" mas marca clock_tampered.
        let clock_tampered_install = installed_at > now;
        if clock_tampered_install {
            installed_at = now;
        }

        // 3. last_seen tracking: maior timestamp ja registrado
        let last_seen_recorded = file_anchor.as_ref().map(|a| a.last_seen_at).unwrap_or(0);
        let clock_tampered_lastseen = last_seen_recorded > 0 && now < last_seen_recorded;
        let new_last_seen = last_seen_recorded.max(now);

        // 4. Salva atualizado em AMBOS lugares
        let mut cfg_new = cfg.clone();
        cfg_new.android_installed_at = installed_at;
        let _ = save_config(cfg_new.clone());
        write_demo_anchor(&DemoAnchor {
            installed_at,
            fingerprint: fp,
            last_seen_at: new_last_seen,
        });

        // 5. Determina expiracao
        let clock_tampered = clock_tampered_install || clock_tampered_lastseen;
        let elapsed_days = (now.saturating_sub(installed_at) / 86400) as i64;
        let days_left = ANDROID_DEMO_DAYS as i64 - elapsed_days;
        let expired = !cfg.android_admin_unlock
            && (days_left <= 0 || clock_tampered);

        AndroidDemoStatus {
            expired,
            days_left,
            is_admin_unlocked: cfg.android_admin_unlock,
            installed_at,
            demo_days_total: ANDROID_DEMO_DAYS,
            clock_tampered,
        }
    }
}

/// v0.9.0: Destrava APK Android com QUALQUER license valida (era so admin).
/// Admin email continua bypassando limite de uses. User comum consome 1 slot
/// dos GUMROAD_MAX_USES (igual no Windows). Multi-device real: mesma key vale
/// pra ate 5 dispositivos combinados (PC + celular contam juntos).
#[tauri::command]
async fn android_demo_admin_unlock(license_key: String) -> Result<bool, String> {
    if GUMROAD_ACCESS_TOKEN == "PLACEHOLDER_ACCESS_TOKEN" {
        return Err("Sistema de licenca nao configurado".into());
    }
    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Ludex/0.9 (android-unlock)")
        .build()
        .map_err(|e| format!("http client: {}", e))?;
    let mut form = std::collections::HashMap::new();
    form.insert("product_id", GUMROAD_PRODUCT_ID.to_string());
    form.insert("license_key", license_key.trim().to_string());
    // v0.9.0: incrementa uses (consome slot) - so se NAO for admin (admin bypassa)
    // Faz primeiro um fetch sem incremento pra detectar admin, depois incrementa.
    form.insert("increment_uses_count", "false".to_string());
    let resp = client.post("https://api.gumroad.com/v2/licenses/verify")
        .bearer_auth(GUMROAD_ACCESS_TOKEN)
        .form(&form)
        .send().await
        .map_err(|e| format!("gumroad request: {}", e))?;
    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("gumroad parse: {}", e))?;
    let buyer_email = body.pointer("/purchase/email")
        .and_then(|v| v.as_str())
        .map(String::from);
    let is_admin = buyer_email.as_deref()
        .map(|e| e.eq_ignore_ascii_case(ADMIN_EMAIL))
        .unwrap_or(false);
    let success = body.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    let uses = body.get("uses").and_then(|v| v.as_u64()).unwrap_or(0) as u32;

    if !is_admin {
        if !success {
            let msg = body.get("message").and_then(|v| v.as_str()).unwrap_or("license invalida");
            return Err(format!("License invalida: {}", msg));
        }
        // User comum: respeita limite de uses (igual no Windows)
        if uses >= GUMROAD_MAX_USES {
            return Err(format!(
                "Limite de {} dispositivos ja atingido com essa license. Desative em outro PC/celular ou compre outra.",
                GUMROAD_MAX_USES
            ));
        }
        // Re-fetch com incremento de slot pra "ativar" no Gumroad oficialmente
        let mut form2 = std::collections::HashMap::new();
        form2.insert("product_id", GUMROAD_PRODUCT_ID.to_string());
        form2.insert("license_key", license_key.trim().to_string());
        form2.insert("increment_uses_count", "true".to_string());
        let resp2 = client.post("https://api.gumroad.com/v2/licenses/verify")
            .bearer_auth(GUMROAD_ACCESS_TOKEN)
            .form(&form2)
            .send().await
            .map_err(|e| format!("gumroad activate: {}", e))?;
        if !resp2.status().is_success() {
            return Err(format!("Falha ao consumir slot: HTTP {}", resp2.status()));
        }
    }
    // Salva (independente de admin ou user comum)
    let mut cfg = load_config();
    cfg.android_admin_unlock = true; // nome legado, mas agora vale pra user comum tb
    cfg.license_key = Some(license_key.trim().to_string());
    save_config(cfg)?;
    Ok(true)
}

// ============================================================
// === ANDROID AUTO-UPDATER basico (v0.7.5+) ===================
// Tauri updater oficial nao suporta Android. Implementacao simples:
// 1. Fetch latest.json do GitHub releases
// 2. Compara versao
// 3. Retorna URL do APK pra frontend abrir no browser/downloader
// ============================================================

// v0.9.0: removido ANDROID_LATEST_JSON (nunca foi gerado). Vai direto pra REST API
// do GitHub que ja serve a metadata correta (assets, tag_name, body).
const ANDROID_LATEST_FALLBACK: &str = "https://api.github.com/repos/EllaeMyApp/ludex/releases/latest";

#[derive(Serialize)]
struct AndroidUpdateInfo {
    available: bool,
    current_version: String,
    latest_version: String,
    apk_url: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GhAsset>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

/// Checa se ha versao mais nova do APK Android no GitHub Releases.
/// Frontend pode abrir o apk_url no browser pra download manual.
#[tauri::command]
async fn android_check_update() -> Result<AndroidUpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = http_client_builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Ludex-Android-Updater")
        .build()
        .map_err(|e| format!("client: {}", e))?;
    let resp = client.get(ANDROID_LATEST_FALLBACK)
        .send().await
        .map_err(|e| format!("github: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("github status: {}", resp.status()));
    }
    let release: GhRelease = resp.json().await
        .map_err(|e| format!("parse: {}", e))?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    let apk_asset = release.assets.iter()
        .find(|a| a.name.ends_with(".apk"))
        .map(|a| a.browser_download_url.clone());

    // Comparacao semver simples (so funciona com versoes X.Y.Z)
    let available = version_is_newer(&latest, &current);

    Ok(AndroidUpdateInfo {
        available,
        current_version: current,
        latest_version: latest,
        apk_url: apk_asset,
        notes: release.body,
    })
}

fn version_is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.').take(3).map(|p| p.parse().unwrap_or(0)).collect()
    };
    let l = parse(latest);
    let c = parse(current);
    for i in 0..l.len().max(c.len()) {
        let lp = l.get(i).copied().unwrap_or(0);
        let cp = c.get(i).copied().unwrap_or(0);
        if lp > cp { return true; }
        if lp < cp { return false; }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare() {
        assert!(version_is_newer("0.9.9", "0.9.8"));
        assert!(version_is_newer("0.9.10", "0.9.9")); // numerico, nao lexicografico
        assert!(version_is_newer("1.0.0", "0.9.99"));
        assert!(!version_is_newer("0.9.8", "0.9.8"));
        assert!(!version_is_newer("0.9.7", "0.9.8"));
        assert!(!version_is_newer("0.9.8", "0.9.8.1")); // ignora alem do 3o componente
    }

    #[test]
    fn sanitize_strips_path_chars() {
        assert_eq!(sanitize_filename("Mario/Bros: 3*?"), "Mario_Bros_ 3__");
        assert_eq!(sanitize_filename("Pokemon Red"), "Pokemon Red");
    }

    #[test]
    fn igdb_url_normalizes_and_resizes() {
        assert_eq!(igdb_url("//images.igdb.com/x/t_thumb/abc.jpg", "t_cover_big"),
                   "https://images.igdb.com/x/t_cover_big/abc.jpg");
        assert_eq!(igdb_url("https://h/t_thumb/a.jpg", "t_cover_big"),
                   "https://h/t_cover_big/a.jpg");
    }

    #[test]
    fn search_variants_breaks_down_titles() {
        let v = search_variants("Final Fantasy VII - International");
        assert_eq!(v[0], "Final Fantasy VII - International");
        assert!(v.contains(&"Final Fantasy VII".to_string()));
        assert!(search_variants("").is_empty());
        let sub = search_variants("Zelda: Ocarina of Time");
        assert!(sub.contains(&"Zelda".to_string()));
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
    let client = http_client_builder()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());
    // Updater so existe em desktop. Em Android/iOS o usuario atualiza via loja/sideload manual.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|app| {
            // Plugin de log sempre ativo (release tambem) — antes so debug, sem arquivo de log em prod.
            // v0.9.18: enquanto app + launcher ainda tem bugs, log COMPLETO sempre ligado pra
            // leitura total dos processos que o usuario fez (pedido do Paulo). Nivel Debug captura
            // muito mais que Info (fluxo de scan, libretro, IPC, navegacao); arquivo maior (8MB x3
            // rotacoes) preserva o historico da sessao em vez de cortar em 2MB. Webview tb manda o
            // console do front pro mesmo log. Quando estabilizar, voltar pra Info.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Debug)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    ])
                    .max_file_size(8_000_000) // 8MB por arquivo
                    .build(),
            )?;
            // v0.9.9: panics do Rust (inclusive de threads spawnadas) vao pro log/
            // logcat. Sem isso um panic so aparecia como abort silencioso, invisivel
            // no "Logs do app" — entao crash do backend ficava impossivel de diagnosticar.
            let default_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                let loc = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
                let msg = info.payload().downcast_ref::<&str>().map(|s| s.to_string())
                    .or_else(|| info.payload().downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "panic".to_string());
                log::error!("[panic] {} @ {}", msg, loc);
                default_hook(info);
            }));
            let _ = APP_HANDLE.set(app.handle().clone());
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                // Tenta importar BIOS conhecidas pra system/ no startup (PS2/Saturn/etc).
                // Procura em Ludex/emulators/PCSX2/bios, RetroArch/system, Documents,
                // Downloads e copia o que existir.
                std::thread::spawn(|| {
                    let _ = bios_try_auto_import();
                });
                spawn_gamepad_hotkey_listener();
                // Tenta conectar Discord no startup (sem-op se nao tem app_id ou Discord nao esta rodando)
                std::thread::spawn(|| {
                    let _ = discord_connect_internal();
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_roms,
            scan_roms_overrides,
            list_dir,
            libretro_apply_cheats,
            fetch_cheats,
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
            libretro_run_frame_av,
            libretro_skip_frames,
            libretro_take_audio,
            libretro_set_input,
            libretro_set_analog,
            libretro_get_disc_info,
            libretro_swap_disc,
            libretro_replace_disc,
            libretro_save_state,
            libretro_load_state,
            libretro_state_exists,
            libretro_list_states,
            libretro_delete_state,
            libretro_unload,
            frontend_log,
            get_app_log_dir,
            clear_app_logs,
            android_has_all_files_access,
            android_open_all_files_settings,
            android_open_folder,
            android_launch_external_emu,
            android_open_play_store,
            android_is_package_installed,
            android_ludex_base_path,
            bios_try_auto_import,
            open_system_folder,
            open_cores_folder,
            libretro_cores_status,
            download_libretro_core,
            check_update_info,
            android_download_apk,
            android_install_apk,
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
            open_url,
            license_activate,
            license_validate,
            license_deactivate,
            license_get_local_info,
            license_purchase_link,
            admin_list_sales,
            admin_force_deactivate,
            admin_check_status,
            admin_dashboard_url,
            android_demo_status,
            android_demo_admin_unlock,
            android_check_update,
            libretro_set_option,
            libretro_get_option,
            libretro_clear_options
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
