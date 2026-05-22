//! Libretro frontend embarcado no Playbox.
//! Carrega .dll de cores libretro dinamicamente, executa frames, captura video,
//! roteia input. Sem aplicação externa rodando.

// Constantes/campos abaixo são parte da spec libretro e mantidos pra completude e
// pra evitar regressão (cores podem comecar a usar a qualquer hora).
#![allow(dead_code)]

use libloading::{Library, Symbol};
use std::ffi::{c_char, c_void, CStr, CString};
use std::os::raw::c_uint;
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};

// ----- Tipos C do libretro -----

pub const RETRO_API_VERSION: u32 = 1;

// Pixel formats
pub const RETRO_PIXEL_FORMAT_0RGB1555: u32 = 0;
pub const RETRO_PIXEL_FORMAT_XRGB8888: u32 = 1;
pub const RETRO_PIXEL_FORMAT_RGB565:   u32 = 2;

// Environment commands (subset essencial)
pub const RETRO_ENVIRONMENT_SET_HW_RENDER:       u32 = 14;
pub const RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:    u32 = 10;
pub const RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: u32 = 9;
pub const RETRO_ENVIRONMENT_GET_VARIABLE:        u32 = 15;
pub const RETRO_ENVIRONMENT_SET_VARIABLES:       u32 = 16;
pub const RETRO_ENVIRONMENT_GET_LOG_INTERFACE:   u32 = 27;
pub const RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:  u32 = 31;
pub const RETRO_ENVIRONMENT_GET_LANGUAGE:        u32 = 39;
pub const RETRO_ENVIRONMENT_GET_USERNAME:        u32 = 38;
pub const RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIR: u32 = 30;
pub const RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:  u32 = 51;
pub const RETRO_ENVIRONMENT_GET_FASTFORWARDING:  u32 = 64;
pub const RETRO_ENVIRONMENT_SET_GEOMETRY:        u32 = 37;
pub const RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:  u32 = 32;
pub const RETRO_ENVIRONMENT_GET_CAN_DUPE:        u32 = 3;
pub const RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: u32 = 17;
pub const RETRO_ENVIRONMENT_SHUTDOWN:            u32 = 7;
// v0.8.44: env cmds que cores informam ao frontend — auto-acknowledge (return true)
pub const RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS: u32 = 19;
pub const RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:   u32 = 18;
pub const RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK: u32 = 12;
pub const RETRO_ENVIRONMENT_SET_DISK_CONTROL_INTERFACE: u32 = 13;
pub const RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK: u32 = 21;
pub const RETRO_ENVIRONMENT_SET_AUDIO_CALLBACK:    u32 = 22;
pub const RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:   u32 = 35;
pub const RETRO_ENVIRONMENT_SET_MEMORY_MAPS:       u32 = 36;
pub const RETRO_ENVIRONMENT_SET_MESSAGE:           u32 = 6;
pub const RETRO_ENVIRONMENT_SET_PROC_ADDRESS_CALLBACK: u32 = 33;

// Devices
pub const RETRO_DEVICE_NONE:     u32 = 0;
pub const RETRO_DEVICE_JOYPAD:   u32 = 1;
pub const RETRO_DEVICE_ANALOG:   u32 = 5;
// Analog indices
pub const RETRO_DEVICE_INDEX_ANALOG_LEFT:  u32 = 0;
pub const RETRO_DEVICE_INDEX_ANALOG_RIGHT: u32 = 1;
// Analog axes
pub const RETRO_DEVICE_ID_ANALOG_X: u32 = 0;
pub const RETRO_DEVICE_ID_ANALOG_Y: u32 = 1;

// Joypad button IDs
pub const RETRO_DEVICE_ID_JOYPAD_MASK:   u32 = 256; // v0.8.43: requisicao de bitmask
pub const RETRO_DEVICE_ID_JOYPAD_B:      u32 = 0;
pub const RETRO_DEVICE_ID_JOYPAD_Y:      u32 = 1;
pub const RETRO_DEVICE_ID_JOYPAD_SELECT: u32 = 2;
pub const RETRO_DEVICE_ID_JOYPAD_START:  u32 = 3;
pub const RETRO_DEVICE_ID_JOYPAD_UP:     u32 = 4;
pub const RETRO_DEVICE_ID_JOYPAD_DOWN:   u32 = 5;
pub const RETRO_DEVICE_ID_JOYPAD_LEFT:   u32 = 6;
pub const RETRO_DEVICE_ID_JOYPAD_RIGHT:  u32 = 7;
pub const RETRO_DEVICE_ID_JOYPAD_A:      u32 = 8;
pub const RETRO_DEVICE_ID_JOYPAD_X:      u32 = 9;
pub const RETRO_DEVICE_ID_JOYPAD_L:      u32 = 10;
pub const RETRO_DEVICE_ID_JOYPAD_R:      u32 = 11;
pub const RETRO_DEVICE_ID_JOYPAD_L2:     u32 = 12;
pub const RETRO_DEVICE_ID_JOYPAD_R2:     u32 = 13;
pub const RETRO_DEVICE_ID_JOYPAD_L3:     u32 = 14;
pub const RETRO_DEVICE_ID_JOYPAD_R3:     u32 = 15;

#[repr(C)]
pub struct RetroSystemInfo {
    pub library_name:     *const c_char,
    pub library_version:  *const c_char,
    pub valid_extensions: *const c_char,
    pub need_fullpath:    bool,
    pub block_extract:    bool,
}

#[repr(C)]
pub struct RetroGameGeometry {
    pub base_width:   c_uint,
    pub base_height:  c_uint,
    pub max_width:    c_uint,
    pub max_height:   c_uint,
    pub aspect_ratio: f32,
}

#[repr(C)]
pub struct RetroSystemTiming {
    pub fps:         f64,
    pub sample_rate: f64,
}

#[repr(C)]
pub struct RetroSystemAvInfo {
    pub geometry: RetroGameGeometry,
    pub timing:   RetroSystemTiming,
}

#[repr(C)]
pub struct RetroGameInfo {
    pub path: *const c_char,
    pub data: *const c_void,
    pub size: usize,
    pub meta: *const c_char,
}

// ----- hw_render (v0.8.32) -----
// Pra cores HW-rendered (PCSX2, Dolphin, Flycast). Frontend prove contexto GL
// e callbacks de framebuffer + proc_address. Core chama context_reset apos a
// gente registrar isso E load_game ter sucesso.

pub type RetroHwContextResetT = extern "C" fn();
pub type RetroHwGetCurrentFramebufferT = extern "C" fn() -> usize;
pub type RetroHwGetProcAddressT = extern "C" fn(*const c_char) -> *const c_void;

#[repr(C)]
pub struct RetroHwRenderCallback {
    pub context_type: c_uint,
    pub context_reset: Option<RetroHwContextResetT>,
    pub get_current_framebuffer: Option<RetroHwGetCurrentFramebufferT>,
    pub get_proc_address: Option<RetroHwGetProcAddressT>,
    pub depth: bool,
    pub stencil: bool,
    pub bottom_left_origin: bool,
    pub version_major: c_uint,
    pub version_minor: c_uint,
    pub cache_context: bool,
    pub context_destroy: Option<RetroHwContextResetT>,
    pub debug_context: bool,
}

/// Marker que cores HW passam pra video_refresh quando frame esta no FBO
/// (ao inves de buffer RAM). Eh literalmente o ponteiro (void*)-1.
pub const RETRO_HW_FRAME_BUFFER_VALID: isize = -1;

// v0.8.46: Disk control interface — multi-disc PS1/Saturn/SegaCD
#[repr(C)]
pub struct RetroDiskControlCallback {
    pub set_eject_state:     Option<extern "C" fn(bool) -> bool>,
    pub get_eject_state:     Option<extern "C" fn() -> bool>,
    pub get_image_index:     Option<extern "C" fn() -> c_uint>,
    pub set_image_index:     Option<extern "C" fn(c_uint) -> bool>,
    pub get_num_images:      Option<extern "C" fn() -> c_uint>,
    pub replace_image_index: Option<extern "C" fn(c_uint, *const RetroGameInfo) -> bool>,
    pub add_image_index:     Option<extern "C" fn() -> bool>,
}

// ----- Tipos de callback -----

pub type RetroEnvironmentT  = extern "C" fn(cmd: c_uint, data: *mut c_void) -> bool;
pub type RetroVideoRefreshT = extern "C" fn(data: *const c_void, width: c_uint, height: c_uint, pitch: usize);
pub type RetroAudioSampleT  = extern "C" fn(left: i16, right: i16);
pub type RetroAudioSampleBatchT = extern "C" fn(data: *const i16, frames: usize) -> usize;
pub type RetroInputPollT    = extern "C" fn();
pub type RetroInputStateT   = extern "C" fn(port: c_uint, device: c_uint, index: c_uint, id: c_uint) -> i16;

// ----- State global (1 core ativo por vez) -----

pub struct Frame {
    pub width:  u32,
    pub height: u32,
    pub rgba:   Vec<u8>, // sempre RGBA8888
}

pub struct LibretroState {
    pub library: Option<Library>,
    pub frame:   Option<Frame>,
    pub frame_pool: Vec<u8>, // v0.8.35: reusa buffer entre frames (evita alloc 60x/seg)
    pub pixel_format: u32, // 0RGB1555, XRGB8888 ou RGB565
    pub system_dir: CString,
    pub save_dir:   CString,
    pub input_state: [bool; 16], // botoes do joypad porta 0
    pub analog_state: [i16; 4], // v0.8.45: [L_x, L_y, R_x, R_y] em [-32767, 32767]
    pub av_info: Option<RetroSystemAvInfo>,
    // v0.8.32 hw_render: callbacks que o core registrou
    pub hw_context_reset:   Option<RetroHwContextResetT>,
    pub hw_context_destroy: Option<RetroHwContextResetT>,
    pub hw_bottom_left:     bool, // GL origem bottom-left? (true pra OpenGL)
    pub hw_active:          bool, // core esta usando hw_render?
    // v0.8.46: disk control + current ROM (pra BIOS region detection)
    pub disk_control:       Option<*const RetroDiskControlCallback>,
    pub current_rom_path:   Option<String>,
}

// SAFETY: disk_control aponta pra struct do core que vive enquanto o core
// estiver carregado. So usamos sob lock + zeramos em unload_game.
unsafe impl Send for LibretroState {}

// v0.8.35: audio em mutex SEPARADO. cb_audio_sample (single-sample) pode ser
// chamado 96000x/seg — locks no state principal contendem com video_refresh.
// Mutex dedicado isola contensao. VecDeque permite drop FIFO em overflow.
pub static AUDIO_BUF: OnceLock<StdMutex<std::collections::VecDeque<i16>>> = OnceLock::new();
pub fn audio_buf() -> &'static StdMutex<std::collections::VecDeque<i16>> {
    AUDIO_BUF.get_or_init(|| StdMutex::new(std::collections::VecDeque::with_capacity(48000)))
}

// v0.8.37: OVERRIDES de opcoes libretro setadas pelo user no UI.
// Tem prioridade sobre LIBRETRO_DEFAULTS no GET_VARIABLE handler.
// Box::leak pra dar 'static aos CStrings (memoria leak limitado por # de mudancas).
// v0.8.46: cache de CStrings auto-detectadas (BIOS region etc).
// Inicia uma vez por chave, leakado pra vida do app — bounded.
pub static AUTO_VARS: OnceLock<StdMutex<std::collections::HashMap<String, &'static CString>>> = OnceLock::new();
fn auto_vars() -> &'static StdMutex<std::collections::HashMap<String, &'static CString>> {
    AUTO_VARS.get_or_init(|| StdMutex::new(std::collections::HashMap::new()))
}
fn set_auto_var(key: &str, value: &str) -> &'static CString {
    let mut m = auto_vars().lock().unwrap();
    if let Some(existing) = m.get(key) {
        if existing.to_str().ok() == Some(value) { return *existing; }
    }
    let Ok(cs) = CString::new(value) else { return Box::leak(Box::new(CString::default())); };
    let leaked: &'static CString = Box::leak(Box::new(cs));
    m.insert(key.to_string(), leaked);
    leaked
}

/// v0.8.46: Detecta BIOS PS2 ideal pra ROM. NTSC-U/BR=scph39001, PAL=scph30004r/scph70004, NTSC-J=scph10000.
/// Olha hints no filename (USA/EU/PAL/JP). Fallback NTSC-U/BR.
fn detect_ps2_bios(rom_path: Option<&str>) -> &'static str {
    let Some(path) = rom_path else { return "scph39001.bin"; };
    let lower = path.to_lowercase();
    // PAL Europa
    if lower.contains("(europe)") || lower.contains("(eu)") || lower.contains("(pal)")
        || lower.contains("(e)") || lower.contains("[eu]") || lower.contains("[pal]") {
        // Prefere scph30004r (early PAL), fallback scph70004 (slim PAL)
        return "scph30004r.bin";
    }
    // NTSC-J (Japan)
    if lower.contains("(japan)") || lower.contains("(jp)") || lower.contains("(j)")
        || lower.contains("[jp]") || lower.contains("[ja]") {
        return "scph10000.bin";
    }
    // Default NTSC-U/Brazil
    "scph39001.bin"
}

pub static OPTION_OVERRIDES: OnceLock<StdMutex<std::collections::HashMap<String, &'static CString>>> = OnceLock::new();
pub fn option_overrides() -> &'static StdMutex<std::collections::HashMap<String, &'static CString>> {
    OPTION_OVERRIDES.get_or_init(|| StdMutex::new(std::collections::HashMap::new()))
}

// v0.9.1: flag dirty pra hot-reload de opcoes durante gameplay.
// Setada quando user muda config na UI, lida (e zerada) pelo core via
// GET_VARIABLE_UPDATE -> core re-le todas as variaveis via GET_VARIABLE.
pub static OPTIONS_DIRTY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_option_override(key: String, value: String) {
    if let Ok(cs) = CString::new(value) {
        let leaked: &'static CString = Box::leak(Box::new(cs));
        let mut m = option_overrides().lock().unwrap();
        m.insert(key, leaked);
        // Sinaliza pro core re-ler as variaveis (hot-reload)
        OPTIONS_DIRTY.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

static STATE: OnceLock<Arc<StdMutex<LibretroState>>> = OnceLock::new();

pub fn state() -> Arc<StdMutex<LibretroState>> {
    STATE.get_or_init(|| {
        // Android: BIOS e save em /storage/emulated/0/Ludex/ (user-accessible).
        // Desktop: em %APPDATA%/Ludex/ ou ~/.local/share/Ludex/ (dirs::data_dir).
        #[cfg(target_os = "android")]
        let dir_base = std::path::PathBuf::from("/storage/emulated/0/Ludex");
        #[cfg(not(target_os = "android"))]
        let dir_base = dirs::data_dir()
            .map(|d| d.join("Ludex"))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let sys_dir  = dir_base.join("system");
        let save_dir = dir_base.join("saves-libretro");
        std::fs::create_dir_all(&sys_dir).ok();
        std::fs::create_dir_all(&save_dir).ok();
        // v0.8.29: PCSX2 libretro pode procurar BIOSes em system/pcsx2/bios/
        // ao inves de system/ raiz. Mirror todos .bin pra la pra cobrir os 2 casos.
        let pcsx2_bios = sys_dir.join("pcsx2").join("bios");
        if std::fs::create_dir_all(&pcsx2_bios).is_ok() {
            if let Ok(entries) = std::fs::read_dir(&sys_dir) {
                for e in entries.flatten() {
                    let p = e.path();
                    if !p.is_file() { continue; }
                    let Some(name) = p.file_name() else { continue; };
                    let name_str = name.to_string_lossy().to_ascii_lowercase();
                    // So copia arquivos relacionados a PS2 (BIOS + auxiliares)
                    let is_ps2 = name_str.starts_with("scph") || name_str.starts_with("ps2")
                        || name_str == "rom1.bin";
                    if !is_ps2 { continue; }
                    let dest = pcsx2_bios.join(name);
                    if !dest.exists() { let _ = std::fs::copy(&p, &dest); }
                }
            }
        }
        // v0.8.45: Mirror BIOS Dreamcast pra system/dc/ (Flycast tenta ambos paths)
        let dc_bios_dir = sys_dir.join("dc");
        if std::fs::create_dir_all(&dc_bios_dir).is_ok() {
            for name in &["dc_boot.bin", "dc_flash.bin", "dc_bios.bin",
                          "naomi_boot.bin", "naomi.bin", "awbios.zip"] {
                let src = sys_dir.join(name);
                let dst = dc_bios_dir.join(name);
                if src.exists() && !dst.exists() { let _ = std::fs::copy(&src, &dst); }
            }
        }
        // v0.8.45: Saturn BIOSes ficam em system/ raiz (mednafen padrao).
        // Apenas garante presenca — se user botou na pasta dc, copia de volta pra raiz.
        for name in &["sega_101.bin", "mpr-17933.bin", "mpr-18811-mx.ic1",
                      "mpr-19367-mx.ic1", "stvbios.zip"] {
            let dc_path = dc_bios_dir.join(name);
            let root_path = sys_dir.join(name);
            if dc_path.exists() && !root_path.exists() {
                let _ = std::fs::copy(&dc_path, &root_path);
            }
        }
        Arc::new(StdMutex::new(LibretroState {
            library: None,
            frame:   None,
            frame_pool: Vec::with_capacity(1920 * 1080 * 4),
            pixel_format: RETRO_PIXEL_FORMAT_0RGB1555,
            system_dir: CString::new(sys_dir.to_string_lossy().as_ref()).unwrap_or_default(),
            save_dir:   CString::new(save_dir.to_string_lossy().as_ref()).unwrap_or_default(),
            input_state: [false; 16],
            analog_state: [0; 4], // v0.8.45
            av_info: None,
            hw_context_reset:   None,
            hw_context_destroy: None,
            hw_bottom_left:     false,
            hw_active:          false,
            disk_control:       None,
            current_rom_path:   None,
        }))
    }).clone()
}

// ----- Callbacks -----

extern "C" fn cb_environment(cmd: c_uint, data: *mut c_void) -> bool {
    let s = state();
    let mut g = s.lock().unwrap();
    match cmd {
        RETRO_ENVIRONMENT_SET_PIXEL_FORMAT => unsafe {
            if data.is_null() { return false; }
            let fmt = *(data as *const u32);
            g.pixel_format = fmt;
            true
        },
        // v0.8.32: SET_HW_RENDER — PCSX2/Dolphin/Flycast pedem contexto GL.
        // Windows: criamos contexto WGL offscreen + FBO, devolvemos callbacks.
        RETRO_ENVIRONMENT_SET_HW_RENDER => unsafe {
            if data.is_null() { return false; }
            #[cfg(windows)]
            {
                let cb = data as *mut RetroHwRenderCallback;
                let ctx_type = (*cb).context_type;
                log::info!("[libretro] SET_HW_RENDER context_type={} version={}.{} depth={} stencil={} bottom_left={}",
                    ctx_type, (*cb).version_major, (*cb).version_minor,
                    (*cb).depth, (*cb).stencil, (*cb).bottom_left_origin);
                // v0.8.45: Aceita OpenGL desktop (1) e Core (3). ES (2/4/5) recusa
                // pra cores caírem em fallback compatível — temos contexto desktop GL.
                let is_gl_desktop = matches!(ctx_type, 1 | 3);
                let is_gl_es = matches!(ctx_type, 2 | 4 | 5);
                if !is_gl_desktop {
                    if is_gl_es {
                        log::warn!("[libretro] SET_HW_RENDER: ctx_type={} eh OpenGL ES — recusando (so temos desktop GL 4.3 Core). Core deve fallback pra software.", ctx_type);
                    } else {
                        log::warn!("[libretro] SET_HW_RENDER: tipo {} nao-OpenGL desktop, recusando", ctx_type);
                    }
                    return false;
                }
                if !crate::gl_context::ensure_init() {
                    log::error!("[libretro] SET_HW_RENDER: falha init GL context");
                    return false;
                }
                // Salva callbacks do core, planta os nossos no struct
                g.hw_context_reset   = (*cb).context_reset;
                g.hw_context_destroy = (*cb).context_destroy;
                g.hw_bottom_left     = (*cb).bottom_left_origin;
                g.hw_active          = true;
                (*cb).get_current_framebuffer = Some(cb_get_current_framebuffer);
                (*cb).get_proc_address        = Some(cb_get_proc_address);
                log::info!("[libretro] SET_HW_RENDER: aceito (OpenGL offscreen pronto)");
                true
            }
            // v0.9.17: Android aceita OpenGL ES (contexto EGL/GLES3 offscreen).
            // ctx_type: 2=ES2, 4=ES3, 5=ES_VERSION (escolhe via version_major).
            #[cfg(target_os = "android")]
            {
                let cb = data as *mut RetroHwRenderCallback;
                let ctx_type = (*cb).context_type;
                log::info!("[libretro] SET_HW_RENDER(android) context_type={} version={}.{} depth={} stencil={} bottom_left={}",
                    ctx_type, (*cb).version_major, (*cb).version_minor,
                    (*cb).depth, (*cb).stencil, (*cb).bottom_left_origin);
                let is_gl_es = matches!(ctx_type, 2 | 4 | 5);
                if !is_gl_es {
                    log::warn!("[libretro] SET_HW_RENDER(android): ctx_type={} nao e GLES, recusando", ctx_type);
                    return false;
                }
                if !crate::gl_context::ensure_init() {
                    log::error!("[libretro] SET_HW_RENDER(android): falha init EGL/GLES");
                    return false;
                }
                g.hw_context_reset   = (*cb).context_reset;
                g.hw_context_destroy = (*cb).context_destroy;
                g.hw_bottom_left     = (*cb).bottom_left_origin;
                g.hw_active          = true;
                (*cb).get_current_framebuffer = Some(cb_get_current_framebuffer);
                (*cb).get_proc_address        = Some(cb_get_proc_address);
                log::info!("[libretro] SET_HW_RENDER(android): aceito (EGL/GLES3 pronto)");
                true
            }
            #[cfg(not(any(windows, target_os = "android")))]
            {
                let _ = data;
                log::warn!("[libretro] SET_HW_RENDER: hw_render so disponivel em Windows/Android");
                false
            }
        },
        RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY => unsafe {
            if data.is_null() { return false; }
            *(data as *mut *const c_char) = g.system_dir.as_ptr();
            true
        },
        RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY => unsafe {
            if data.is_null() { return false; }
            *(data as *mut *const c_char) = g.save_dir.as_ptr();
            true
        },
        RETRO_ENVIRONMENT_GET_CAN_DUPE => unsafe {
            if data.is_null() { return false; }
            *(data as *mut bool) = true;
            true
        },
        RETRO_ENVIRONMENT_GET_VARIABLE => unsafe {
            if data.is_null() { return false; }
            // v0.8.30: defaults pras opcoes que cores grandes (PCSX2/Dolphin/Flycast) PRECISAM.
            // v0.8.37: override do user (UI settings) tem precedencia.
            #[repr(C)]
            struct RetroVariable { key: *const c_char, value: *const c_char }
            let var = data as *mut RetroVariable;
            if (*var).key.is_null() { return false; }
            let key_cstr = CStr::from_ptr((*var).key);
            let key = key_cstr.to_string_lossy();
            let key_str: &str = &key;
            // 1) override do user
            {
                let overrides = option_overrides().lock().unwrap();
                if let Some(val) = overrides.get(key_str) {
                    (*var).value = val.as_ptr();
                    log::info!("[libretro] GET_VARIABLE {} -> {} (user)", key, val.to_string_lossy());
                    return true;
                }
            }
            // 2) v0.8.46: auto-detect — BIOS PS2 baseado em region do filename
            if key_str == "pcsx2_bios" {
                let rom = g.current_rom_path.clone();
                drop(g);
                let detected = detect_ps2_bios(rom.as_deref());
                let cs = set_auto_var("pcsx2_bios", detected);
                (*var).value = cs.as_ptr();
                log::info!("[libretro] GET_VARIABLE pcsx2_bios -> {} (auto, rom={:?})", detected, rom);
                return true;
            }
            // 3) default canonico
            if let Some(val) = libretro_defaults().get(key_str) {
                (*var).value = val.as_ptr();
                log::info!("[libretro] GET_VARIABLE {} -> {}", key, val.to_string_lossy());
                return true;
            }
            log::info!("[libretro] GET_VARIABLE key={} (no default)", key);
            false
        },
        RETRO_ENVIRONMENT_SET_VARIABLES => unsafe {
            // Loga TODAS as opcoes que o core anuncia (debug)
            if !data.is_null() {
                #[repr(C)]
                struct RetroVariable { key: *const c_char, value: *const c_char }
                let mut p = data as *const RetroVariable;
                while !p.is_null() && !(*p).key.is_null() {
                    let key = CStr::from_ptr((*p).key).to_string_lossy();
                    let val = if (*p).value.is_null() { "(null)".into() }
                              else { CStr::from_ptr((*p).value).to_string_lossy() };
                    log::info!("[libretro] SET_VARIABLES {}: {}", key, val);
                    p = p.add(1);
                }
            }
            true
        },
        RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE => unsafe {
            // v0.9.1: retorna true 1x quando o user mudou opcao na UI.
            // Core entao re-le via GET_VARIABLE -> override pega efeito sem reload.
            if !data.is_null() {
                let dirty = OPTIONS_DIRTY.swap(false, std::sync::atomic::Ordering::SeqCst);
                *(data as *mut bool) = dirty;
                if dirty { log::info!("[libretro] GET_VARIABLE_UPDATE -> true (user changed options)"); }
            }
            true
        },
        // v0.8.27: LOG_INTERFACE — cores como PCSX2 segfaultam se nao tiver
        RETRO_ENVIRONMENT_GET_LOG_INTERFACE => unsafe {
            if data.is_null() { return false; }
            #[repr(C)]
            struct RetroLogCallback { log: extern "C" fn(level: c_uint, fmt: *const c_char) }
            *(data as *mut RetroLogCallback) = RetroLogCallback { log: cb_log };
            true
        },
        // v0.8.28: handlers extras que cores grandes esperam
        RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIR => unsafe {
            if data.is_null() { return false; }
            *(data as *mut *const c_char) = g.system_dir.as_ptr();
            true
        },
        RETRO_ENVIRONMENT_GET_LANGUAGE => unsafe {
            if data.is_null() { return false; }
            *(data as *mut u32) = 8; // RETRO_LANGUAGE_PORTUGUESE_BRAZIL
            true
        },
        RETRO_ENVIRONMENT_GET_USERNAME => unsafe {
            if data.is_null() { return false; }
            static USERNAME: &[u8] = b"Player\0";
            *(data as *mut *const c_char) = USERNAME.as_ptr() as *const c_char;
            true
        },
        // v0.8.43/44: BITMASK — alem de return true, escreve bool true em *data
        // pra cores que checam o ponteiro (PCSX2 antigo, alguns forks)
        RETRO_ENVIRONMENT_GET_INPUT_BITMASKS => unsafe {
            if !data.is_null() { *(data as *mut bool) = true; }
            true
        },
        // v0.8.44: Auto-acknowledge env cmds que sao "core informa frontend".
        // Sem isso, cores que esperam ack podem desabilitar input/features.
        RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS => true,   // 19: A=Jump, B=Duck etc (info)
        RETRO_ENVIRONMENT_SET_CONTROLLER_INFO => true,     // 35: PS2 multitap, DualShock etc
        RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME => true,     // 18: core pode rodar sem ROM
        RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK => true,   // 12: core quer teclado (no-op)
        // v0.8.46: armazena callbacks pra Tauri commands depois chamarem swap de disco
        RETRO_ENVIRONMENT_SET_DISK_CONTROL_INTERFACE => {
            if !data.is_null() {
                g.disk_control = Some(data as *const RetroDiskControlCallback);
                log::info!("[libretro] SET_DISK_CONTROL_INTERFACE registrado");
            }
            true
        },
        RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK => true, // 21: core quer notify de frame time
        RETRO_ENVIRONMENT_SET_AUDIO_CALLBACK => false,     // 22: NAO suportamos audio driven by core
        RETRO_ENVIRONMENT_SET_MEMORY_MAPS => true,         // 36: cheats/RetroAchievements info
        RETRO_ENVIRONMENT_SET_MESSAGE => true,             // 6: core quer mostrar msg (ignoramos)
        RETRO_ENVIRONMENT_SET_PROC_ADDRESS_CALLBACK => true, // 33: core expoe API pra outros cores
        RETRO_ENVIRONMENT_GET_FASTFORWARDING => unsafe {
            if data.is_null() { return false; }
            *(data as *mut bool) = false; // Ludex faz FF via skip_frames
            true
        },
        // SET_GEOMETRY / SET_SYSTEM_AV_INFO: core informa novo tamanho/fps, aceita
        RETRO_ENVIRONMENT_SET_GEOMETRY => unsafe {
            if data.is_null() { return false; }
            let geom = data as *const RetroGameGeometry;
            log::info!("[libretro] SET_GEOMETRY {}x{}", (*geom).base_width, (*geom).base_height);
            true
        },
        RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO => unsafe {
            if data.is_null() { return false; }
            let av = data as *const RetroSystemAvInfo;
            log::info!("[libretro] SET_AV_INFO {}x{} fps={}", (*av).geometry.base_width, (*av).geometry.base_height, (*av).timing.fps);
            g.av_info = Some(std::ptr::read(av));
            true
        },
        // Outros cmds que retornam unhandled mas com log debug
        unknown => {
            log::debug!("[libretro] env cmd {} ignorado", unknown);
            false
        }
    }
}

/// v0.8.30: defaults por key pra GET_VARIABLE — PCSX2 e outros cores grandes
/// chamam GET_VARIABLE("pcsx2_bios"/etc) durante load_game e rejeitam carregar
/// se a opcao nao for retornada. CStrings vivem pelo ciclo todo do app (OnceLock).
static LIBRETRO_DEFAULTS: OnceLock<std::collections::HashMap<&'static str, CString>> = OnceLock::new();

fn libretro_defaults() -> &'static std::collections::HashMap<&'static str, CString> {
    LIBRETRO_DEFAULTS.get_or_init(|| {
        let mut m = std::collections::HashMap::new();
        let mut ins = |k: &'static str, v: &str| {
            m.insert(k, CString::new(v).unwrap_or_default());
        };
        // PCSX2 — defaults sensatos (vide SET_VARIABLES log)
        ins("pcsx2_bios", "scph39001.bin");
        // v0.8.45: voltei pra "OpenGL" explicito. v0.8.34 botei OpenGL e deu tela
        // preta — mas a causa REAL era alpha=0 do FBO (resolvido v0.8.36).
        // Agora com alpha fix + analog stick (v0.8.45), OpenGL eh a escolha certa
        // (provemos contexto GL 4.3 Core via hw_render). Auto pode pegar D3D11 ou
        // Vulkan e brigar com nosso contexto.
        ins("pcsx2_renderer", "OpenGL");
        ins("pcsx2_fastboot", "enabled");
        ins("pcsx2_fastcdvd", "disabled");
        ins("pcsx2_upscale_multiplier", "1x Native (PS2)");
        ins("pcsx2_widescreen_hint", "disabled");
        ins("pcsx2_nointerlacing_hint", "enabled");
        ins("pcsx2_uncapped_framerate_hint", "disabled");
        ins("pcsx2_game_enhancements_hint", "disabled");
        ins("pcsx2_ee_cycle_rate", "100% (Normal Speed)");
        ins("pcsx2_ee_cycle_skip", "disabled");
        ins("pcsx2_deinterlace_mode", "Automatic");
        ins("pcsx2_enable_cheats", "disabled");
        ins("pcsx2_shared_memory_cards", "disabled");
        ins("pcsx2_hint_language_unlock", "disabled");
        ins("pcsx2_enable_hw_hacks", "disabled");
        ins("pcsx2_pgs_ssaa", "Native");
        ins("pcsx2_pgs_ss_tex", "disabled");
        ins("pcsx2_pgs_deblur", "disabled");
        ins("pcsx2_pgs_high_res_scanout", "disabled");
        ins("pcsx2_pgs_disable_mipmaps", "disabled");
        ins("pcsx2_pcrtc_antiblur", "enabled");
        ins("pcsx2_pcrtc_screen_offsets", "disabled");
        ins("pcsx2_disable_interlace_offset", "disabled");
        ins("pcsx2_auto_flush_software", "enabled");
        ins("pcsx2_texture_filtering", "Bilinear (PS2)");
        ins("pcsx2_trilinear_filtering", "Automatic");
        ins("pcsx2_anisotropic_filtering", "disabled");
        ins("pcsx2_dithering", "Unscaled");
        ins("pcsx2_blending_accuracy", "Basic");
        // Input ports (PCSX2 pede pra port 1 e 2)
        for port in &["1", "2"] {
            ins(Box::leak(format!("pcsx2_axis_deadzone{}", port).into_boxed_str()), "15%");
            ins(Box::leak(format!("pcsx2_button_deadzone{}", port).into_boxed_str()), "0%");
            ins(Box::leak(format!("pcsx2_axis_scale{}", port).into_boxed_str()), "133%");
            ins(Box::leak(format!("pcsx2_enable_rumble{}", port).into_boxed_str()), "100%");
            ins(Box::leak(format!("pcsx2_invert_left_stick{}", port).into_boxed_str()), "disabled");
            ins(Box::leak(format!("pcsx2_invert_right_stick{}", port).into_boxed_str()), "disabled");
        }
        // HW Hacks PCSX2 (defaults seguros = desabilitado)
        for k in &[
            "pcsx2_cpu_sprite_size", "pcsx2_cpu_sprite_level", "pcsx2_software_clut_render",
            "pcsx2_gpu_target_clut", "pcsx2_auto_flush", "pcsx2_texture_inside_rt",
            "pcsx2_disable_depth_conversion", "pcsx2_framebuffer_conversion",
            "pcsx2_disable_partial_invalidation", "pcsx2_gpu_palette_conversion",
            "pcsx2_preload_frame_data", "pcsx2_half_pixel_offset", "pcsx2_native_scaling",
            "pcsx2_round_sprite", "pcsx2_align_sprite", "pcsx2_merge_sprite",
            "pcsx2_unscaled_palette_draw", "pcsx2_force_sprite_position",
        ] { ins(k, "disabled"); }
        ins("pcsx2_cpu_sprite_size", "0");
        ins("pcsx2_cpu_sprite_level", "Sprites Only");
        // ===== Dolphin (Wii / GameCube) — v0.8.35 =====
        ins("dolphin_renderer", "Hardware");
        ins("dolphin_cpu_core", "JIT64");
        ins("dolphin_dsp_hle", "enabled");
        ins("dolphin_dsp_jit", "enabled");
        ins("dolphin_efb_scale", "x1 (640 x 528)"); // native — sobe se PC for forte
        ins("dolphin_widescreen_hack", "disabled");
        ins("dolphin_progressive_scan", "enabled");
        ins("dolphin_pal60", "enabled");
        ins("dolphin_efb_copy_method", "EFB to Texture"); // mais rapido que EFB to RAM
        ins("dolphin_efb_to_texture_enable", "enabled");
        ins("dolphin_fast_depth_calculation", "enabled");
        ins("dolphin_disable_fog", "disabled");
        ins("dolphin_load_custom_textures", "disabled");
        ins("dolphin_cache_custom_textures", "disabled");
        ins("dolphin_shader_compilation_mode", "sync"); // sync = sem stutter mas espera shader
        ins("dolphin_wait_for_shaders", "enabled");
        ins("dolphin_anisotropic_filtering", "1x");
        ins("dolphin_antialiasing", "None");
        ins("dolphin_force_texture_filtering", "disabled");
        ins("dolphin_show_fps", "disabled");
        ins("dolphin_osd_enabled", "disabled");
        ins("dolphin_disable_dual_core", "disabled"); // multicore acelera

        // ===== Flycast (Dreamcast) — v0.8.35 =====
        ins("flycast_internal_resolution", "640x480");
        ins("flycast_cable_type", "TV (Composite)");
        ins("flycast_threaded_rendering", "enabled"); // grande ganho FPS
        ins("flycast_anisotropic_filtering", "off");
        ins("flycast_texture_filtering", "0");
        ins("flycast_widescreen_hack", "disabled");
        ins("flycast_widescreen_cheats", "disabled");
        ins("flycast_synchronous_rendering", "disabled");
        ins("flycast_oit_layers", "32");
        ins("flycast_div_matching", "Auto");
        ins("flycast_force_freeplay", "enabled");
        ins("flycast_region", "Default");
        ins("flycast_broadcast", "Default");
        ins("flycast_language", "Default");
        ins("flycast_per_strip_translucent_sorting", "disabled");
        ins("flycast_pvr2_filtering", "disabled");
        ins("flycast_alpha_sorting", "per-triangle (normal)");
        ins("flycast_enable_dsp", "enabled");
        ins("flycast_vmu_sound", "disabled");
        ins("flycast_mipmapping", "enabled");
        ins("flycast_fog", "enabled");
        ins("flycast_volume_modifier_enable", "enabled");

        // ===== PPSSPP (PSP) — v0.8.35 =====
        ins("ppsspp_internal_resolution", "1440x816"); // 2x — bom equilibrio
        ins("ppsspp_button_preference", "Cross");
        ins("ppsspp_language", "Automatic");
        ins("ppsspp_cpu_core", "JIT");
        ins("ppsspp_fast_memory", "enabled");
        ins("ppsspp_ignore_bad_memory_access", "enabled");
        ins("ppsspp_io_timing_method", "Fast");
        ins("ppsspp_force_lag_sync", "disabled");
        ins("ppsspp_locked_cpu_speed", "off");
        ins("ppsspp_lazy_texture_caching", "disabled");
        ins("ppsspp_retain_changed_textures", "disabled");
        ins("ppsspp_force_max_fps", "60");
        ins("ppsspp_frame_skipping", "Off");
        ins("ppsspp_frame_skipping_type", "Number of Frames");
        ins("ppsspp_auto_frame_skip", "disabled");
        ins("ppsspp_skip_buffer_effects", "disabled");
        ins("ppsspp_skip_gpu_readbacks", "Off (Safe)");
        ins("ppsspp_inflight_frames", "Up to 2");
        ins("ppsspp_software_skinning", "enabled");
        ins("ppsspp_hardware_transform", "enabled");
        ins("ppsspp_software_rendering", "disabled");
        ins("ppsspp_vertex_cache", "disabled");
        ins("ppsspp_lower_resolution_for_effects", "Off");
        ins("ppsspp_spline_quality", "Low");
        ins("ppsspp_texture_anisotropic_filtering", "off");
        ins("ppsspp_texture_filtering", "Auto");
        ins("ppsspp_texture_scaling_level", "Off");
        ins("ppsspp_texture_scaling_type", "xBRZ");
        ins("ppsspp_texture_deposterize", "disabled");
        ins("ppsspp_texture_replacement", "disabled");
        ins("ppsspp_buffer_filter", "Linear");
        ins("ppsspp_internal_shader", "Off");

        // ===== Mupen64Plus-Next (N64) — v0.8.35 =====
        ins("mupen64plus-rsp-plugin", "hle");
        ins("mupen64plus-cpucore", "dynamic_recompiler");
        ins("mupen64plus-43screensize", "640x480");
        ins("mupen64plus-169screensize", "960x540");
        ins("mupen64plus-aspect", "4:3");
        ins("mupen64plus-ThreadedRenderer", "True");
        ins("mupen64plus-EnableHybridFilter", "True");
        ins("mupen64plus-EnableLOD", "True");
        ins("mupen64plus-EnableHWLighting", "False");
        ins("mupen64plus-EnableCopyAuxToRDRAM", "False");
        ins("mupen64plus-MultiSampling", "0");
        ins("mupen64plus-EnableNativeResFactor", "1");
        ins("mupen64plus-EnableTextureCache", "True");
        ins("mupen64plus-EnableEnhancedHighResStorage", "False");
        ins("mupen64plus-EnableEnhancedTextureStorage", "False");
        ins("mupen64plus-EnableFBEmulation", "True");
        ins("mupen64plus-AspectRatio", "4:3");
        ins("mupen64plus-FrameDuping", "False");
        ins("mupen64plus-FXAA", "0");
        ins("mupen64plus-pak1", "memory");
        ins("mupen64plus-pak2", "none");
        ins("mupen64plus-pak3", "none");
        ins("mupen64plus-pak4", "none");

        // ===== Citra (3DS) — v0.8.35 =====
        ins("citra_resolution_factor", "1x (Native)");
        ins("citra_use_hw_renderer", "enabled");
        ins("citra_use_hw_shader", "enabled");
        ins("citra_use_shader_jit", "enabled");
        ins("citra_use_acc_mul", "enabled");
        ins("citra_use_acc_geo_shaders", "enabled");
        ins("citra_use_virtual_sd", "enabled");
        ins("citra_is_new_3ds", "New 3DS"); // melhor compat
        ins("citra_region_value", "Auto");
        ins("citra_language", "Portuguese");
        ins("citra_layout_option", "Default Top-Bottom Screen");
        ins("citra_swap_screen", "Top");
        ins("citra_use_libretro_save_path", "LibRetro Default");
        ins("citra_analog_function", "C-Stick and Touchscreen Pointer");
        ins("citra_render_touchscreen", "disabled");
        ins("citra_mouse_touchscreen", "enabled");
        ins("citra_touch_touchscreen", "enabled");
        ins("citra_deadzone", "15");
        ins("citra_use_cpu_jit", "enabled");
        ins("citra_dump_textures", "disabled");
        ins("citra_custom_textures", "disabled");
        ins("citra_preload_textures", "disabled");
        ins("citra_async_shader_compilation", "disabled");

        // ===== swanstation (PS1, fork DuckStation) — v0.8.35 =====
        ins("swanstation_GPU_Renderer", "Hardware");
        ins("swanstation_GPU_ResolutionScale", "1");
        ins("swanstation_GPU_MSAA", "1");
        ins("swanstation_GPU_TrueColor", "enabled");
        ins("swanstation_GPU_ScaledDithering", "enabled");
        ins("swanstation_GPU_UseSoftwareRendererForReadbacks", "false");
        ins("swanstation_GPU_TextureFilter", "Nearest");
        ins("swanstation_GPU_DisableInterlacing", "true");
        ins("swanstation_GPU_ForceNTSCTimings", "false");
        ins("swanstation_GPU_WidescreenHack", "false");
        ins("swanstation_GPU_PGXPEnable", "false"); // PGXP = anti-warp, custa FPS
        ins("swanstation_GPU_PGXPCulling", "true");
        ins("swanstation_GPU_PGXPTextureCorrection", "true");
        ins("swanstation_CPU_ExecutionMode", "Recompiler");
        ins("swanstation_CPU_Overclock", "100");
        ins("swanstation_Console_Region", "Auto");
        ins("swanstation_BIOS_PatchFastBoot", "true");
        ins("swanstation_BIOS_PatchTTYEnable", "false");
        ins("swanstation_MemoryCards_Card1Type", "PerGameTitle");
        ins("swanstation_MemoryCards_Card2Type", "None");
        ins("swanstation_Display_AspectRatio", "4:3");
        ins("swanstation_Display_CropMode", "Overscan");
        ins("swanstation_Display_LinearFiltering", "true");
        ins("swanstation_Display_IntegerScaling", "false");
        ins("swanstation_Display_ShowOSDMessages", "false");
        ins("swanstation_Audio_ResamplingMode", "Catmull-Rom");
        ins("swanstation_Logging_LogLevel", "None");

        // ===== Genesis Plus GX (MD/SMS/GG/SegaCD) — v0.8.35 =====
        ins("genesis_plus_gx_system_hw", "auto");
        ins("genesis_plus_gx_region_detect", "auto");
        ins("genesis_plus_gx_bios", "disabled");
        ins("genesis_plus_gx_bram", "per game");
        ins("genesis_plus_gx_audio_filter", "low-pass");
        ins("genesis_plus_gx_blargg_ntsc_filter", "disabled");
        ins("genesis_plus_gx_lcd_filter", "disabled");
        ins("genesis_plus_gx_overscan", "disabled");
        ins("genesis_plus_gx_aspect_ratio", "auto");
        ins("genesis_plus_gx_render", "single field"); // mais rapido que double field
        ins("genesis_plus_gx_force_dtack", "enabled");
        ins("genesis_plus_gx_addr_error", "enabled");
        ins("genesis_plus_gx_lock_on", "OFF");

        // ===== Saturn (Mednafen) — v0.8.35 =====
        ins("beetle_saturn_cdimagecache", "disabled");
        ins("beetle_saturn_region", "Auto Detect");
        ins("beetle_saturn_cart", "Auto Detect");
        ins("beetle_saturn_horizontal_overscan", "0");
        ins("beetle_saturn_initial_scanline", "0");
        ins("beetle_saturn_last_scanline", "239");
        ins("beetle_saturn_resolution_mode", "self-adjusting");
        ins("beetle_saturn_multitap_port1", "disabled");
        ins("beetle_saturn_multitap_port2", "disabled");

        // ===== melonDS (DS) — v0.8.35 =====
        ins("melonds_renderer", "OpenGL"); // HW renderer
        ins("melonds_threaded_renderer", "enabled");
        ins("melonds_screen_layout", "Top/Bottom");
        ins("melonds_hybrid_ratio", "2");
        ins("melonds_swapscreen_mode", "Toggle");
        ins("melonds_screen_gap", "0");
        ins("melonds_jit_enable", "enabled");
        ins("melonds_console_mode", "DS");
        ins("melonds_boot_directly", "enabled");
        ins("melonds_use_fw_settings", "disabled");
        ins("melonds_language", "Portuguese");
        ins("melonds_opengl_resolution", "1");
        ins("melonds_opengl_better_polygons", "disabled");
        ins("melonds_opengl_filtering", "nearest");
        ins("melonds_touch_mode", "Mouse");
        ins("melonds_audio_interpolation", "None");
        ins("melonds_audio_bitrate", "Automatic");
        ins("melonds_show_cursor", "disabled");
        ins("melonds_mic_input", "Silence");

        // ===== mGBA (GBA) — v0.8.35 (defaults sao bons, so ajustes pequenos) =====
        ins("mgba_skip_bios", "ON");
        ins("mgba_use_bios", "ON");
        ins("mgba_solar_sensor_level", "0");
        ins("mgba_allow_opposing_directions", "no");
        ins("mgba_gb_model", "Autodetect");
        ins("mgba_sgb_borders", "ON");
        ins("mgba_idle_optimization", "Remove Known");
        ins("mgba_frameskip", "0");
        ins("mgba_color_correction", "OFF");
        ins("mgba_interframe_blending", "OFF");
        ins("mgba_audio_low_pass_filter", "disabled");

        // ===== snes9x (SNES) — v0.8.35 =====
        ins("snes9x_overscan", "auto");
        ins("snes9x_aspect", "auto");
        ins("snes9x_region", "auto");
        ins("snes9x_layer_1", "enabled");
        ins("snes9x_layer_2", "enabled");
        ins("snes9x_layer_3", "enabled");
        ins("snes9x_layer_4", "enabled");
        ins("snes9x_layer_5", "enabled");
        ins("snes9x_gfx_clip", "enabled");
        ins("snes9x_gfx_transp", "enabled");
        ins("snes9x_gfx_hires", "enabled");
        ins("snes9x_audio_interpolation", "gaussian");
        ins("snes9x_reduce_sprite_flicker", "disabled");
        ins("snes9x_block_invalid_vram_access", "enabled");

        // ===== Nestopia (NES) — v0.8.35 =====
        ins("nestopia_blargg_ntsc_filter", "disabled");
        ins("nestopia_palette", "consumer");
        ins("nestopia_nospritelimit", "enabled"); // mais sprites = sem flicker
        ins("nestopia_overscan_v", "enabled");
        ins("nestopia_overscan_h_left", "0");
        ins("nestopia_overscan_h_right", "0");
        ins("nestopia_aspect", "auto");
        ins("nestopia_genie_distortion", "disabled");
        ins("nestopia_fds_auto_insert", "enabled");
        ins("nestopia_select_adapter", "auto");

        // ===== Gambatte (GB/GBC) — v0.8.35 =====
        ins("gambatte_gb_colorization", "auto");
        ins("gambatte_gb_internal_palette", "GB - DMG");
        ins("gambatte_gb_bootloader", "enabled");
        ins("gambatte_gb_hwmode", "Auto");
        ins("gambatte_audio_resampler", "sinc"); // melhor qualidade
        ins("gambatte_show_gb_link_settings", "disabled");
        ins("gambatte_gb_link_mode", "Not Connected");
        ins("gambatte_dark_filter_level", "0");
        ins("gambatte_mix_frames", "disabled");

        // ===== mednafen_pce (TurboGrafx-16) — v0.8.35 =====
        ins("pce_show_advanced_input_settings", "enabled");
        ins("pce_nospritelimit", "enabled");
        ins("pce_cdimagecache", "disabled");
        ins("pce_cdbios", "System Card 3");
        ins("pce_cdspeed", "1");
        ins("pce_adpcmextraprec", "10-bit");
        ins("pce_adpcmlp", "off");
        ins("pce_resamp_quality", "3");
        ins("pce_scaling", "auto");

        // ===== MAME (Arcade) — v0.8.35 =====
        ins("mame_alternate_renderer", "disabled");
        ins("mame_altres", "640x480");
        ins("mame_boot_to_bios", "disabled");
        ins("mame_boot_to_osd", "disabled");
        ins("mame_cheats_enable", "disabled");
        ins("mame_lightgun_mode", "none");
        ins("mame_mouse_enable", "disabled");
        ins("mame_thread_mode", "automatic"); // threading = ganho FPS
        ins("mame_throttle", "disabled"); // sem throttling interno (frontend faz)
        ins("mame_softlists_enable", "enabled");

        // ===== Defaults universais (BIOS-free / smaller cores) =====
        ins("stella_console", "auto");
        ins("stella_palette", "standard");
        ins("stella_filter", "disabled");
        ins("stella_phosphor", "default");
        ins("stella_paddle_sensitivity", "3");

        ins("beetle_lynx_rot", "None");
        ins("beetle_wswan_rotate_display", "manual");
        ins("beetle_wswan_language", "english");
        ins("beetle_vb_anaglyph_preset", "disabled");
        ins("beetle_vb_3dmode", "anaglyph");
        ins("beetle_ngp_language", "english");

        ins("bluemsx_msxromtype1", "Auto");
        ins("vice_c64_model", "C64 PAL auto");
        ins("vice_drive_true_emulation", "disabled");
        ins("fuse_machine", "Spectrum 48K");
        ins("puae_model", "auto");
        ins("opera_bios", "panafz10.bin");
        ins("virtualjaguar_doom_res_hack", "disabled");
        m
    })
}

// v0.8.27: log callback — recebe printf-style do core.
// v0.8.28: usa log::warn pra aparecer no Ludex.log.
// (variadic vsnprintf precisa nightly — fica so com fmt string crua por enquanto)
extern "C" fn cb_log(level: c_uint, fmt: *const c_char) {
    if fmt.is_null() { return; }
    let msg = unsafe { CStr::from_ptr(fmt).to_string_lossy() };
    let trimmed = msg.trim_end();
    match level {
        0 => log::debug!(target: "libretro", "{}", trimmed),
        1 => log::info!(target: "libretro", "{}", trimmed),
        2 => log::warn!(target: "libretro", "{}", trimmed),
        3 => log::error!(target: "libretro", "{}", trimmed),
        _ => log::info!(target: "libretro", "{}", trimmed),
    }
    eprintln!("[libretro/{}] {}", level, trimmed);
}

// v0.8.32: callbacks que damos pro core no SET_HW_RENDER.
#[cfg(any(windows, target_os = "android"))]
extern "C" fn cb_get_current_framebuffer() -> usize {
    crate::gl_context::current_fbo() as usize
}
#[cfg(any(windows, target_os = "android"))]
extern "C" fn cb_get_proc_address(name: *const c_char) -> *const c_void {
    crate::gl_context::get_proc_addr(name)
}

extern "C" fn cb_video_refresh(data: *const c_void, width: c_uint, height: c_uint, pitch: usize) {
    // v0.8.32: cores HW passam (void*)-1 como marker — frame esta no FBO,
    // a gente faz glReadPixels pra trazer pra RAM.
    #[cfg(any(windows, target_os = "android"))]
    if data as isize == RETRO_HW_FRAME_BUFFER_VALID {
        if let Some(rgba) = crate::gl_context::read_pixels(width, height) {
            let s = state();
            let mut g = s.lock().unwrap();
            g.frame = Some(Frame { width, height, rgba });
        }
        return;
    }
    if data.is_null() { return; }
    // v0.8.35: snapshot pixel_format e libera lock ANTES do per-pixel loop
    let fmt = {
        let s = state();
        let g = s.lock().unwrap();
        g.pixel_format
    };
    let need = (width * height * 4) as usize;
    // v0.8.35: reusa buffer do pool (sem alloc por frame). Cresce on-demand.
    let mut rgba = {
        let s = state();
        let mut g = s.lock().unwrap();
        let mut v = std::mem::take(&mut g.frame_pool);
        if v.capacity() < need { v.reserve(need - v.capacity()); }
        v.resize(need, 0);
        v
    };
    unsafe {
        match fmt {
            RETRO_PIXEL_FORMAT_XRGB8888 => {
                let src = data as *const u32;
                let row_stride_px = pitch / 4;
                for y in 0..height as usize {
                    for x in 0..width as usize {
                        let px = *src.add(y * row_stride_px + x);
                        let r = ((px >> 16) & 0xFF) as u8;
                        let gc = ((px >> 8) & 0xFF) as u8;
                        let b = (px & 0xFF) as u8;
                        let i = (y * width as usize + x) * 4;
                        rgba[i]     = r;
                        rgba[i + 1] = gc;
                        rgba[i + 2] = b;
                        rgba[i + 3] = 0xFF;
                    }
                }
            }
            RETRO_PIXEL_FORMAT_RGB565 => {
                let src = data as *const u16;
                let row_stride_px = pitch / 2;
                for y in 0..height as usize {
                    for x in 0..width as usize {
                        let px = *src.add(y * row_stride_px + x);
                        let r = (((px >> 11) & 0x1F) << 3) as u8;
                        let gc = (((px >> 5) & 0x3F) << 2) as u8;
                        let b = ((px & 0x1F) << 3) as u8;
                        let i = (y * width as usize + x) * 4;
                        rgba[i]     = r;
                        rgba[i + 1] = gc;
                        rgba[i + 2] = b;
                        rgba[i + 3] = 0xFF;
                    }
                }
            }
            _ => {
                // 0RGB1555 (default)
                let src = data as *const u16;
                let row_stride_px = pitch / 2;
                for y in 0..height as usize {
                    for x in 0..width as usize {
                        let px = *src.add(y * row_stride_px + x);
                        let r = (((px >> 10) & 0x1F) << 3) as u8;
                        let gc = (((px >> 5) & 0x1F) << 3) as u8;
                        let b = ((px & 0x1F) << 3) as u8;
                        let i = (y * width as usize + x) * 4;
                        rgba[i]     = r;
                        rgba[i + 1] = gc;
                        rgba[i + 2] = b;
                        rgba[i + 3] = 0xFF;
                    }
                }
            }
        }
    }
    // v0.8.35: devolve frame pro pool reciclando o Vec antigo
    let s = state();
    let mut g = s.lock().unwrap();
    let old = g.frame.replace(Frame { width, height, rgba });
    if let Some(old_frame) = old {
        // Pool guarda o Vec liberado pra proxima alocacao
        let mut buf = old_frame.rgba;
        buf.clear();
        g.frame_pool = buf;
    }
}

// v0.8.38: 1.5s buffer. v0.8.37 botou 500ms mas jogos PS2 pesados (GoW2, Crash)
// ainda travavam — emulacao varia 30-60 FPS e PCSX2 batcha audio em chunks
// grandes. 1.5s absorve esses bursts. Latencia 1.5s eh perceptivel mas SEM gaps
// >> gaps com latencia baixa. Memoria: 48kHz*stereo*1.5s = 144000 i16 = 288KB.
const AUDIO_BUF_LIMIT: usize = 144000;

extern "C" fn cb_audio_sample(left: i16, right: i16) {
    let mut buf = audio_buf().lock().unwrap();
    if buf.len() + 2 > AUDIO_BUF_LIMIT {
        // Drop oldest pra abrir espaco (mantem audio "atual")
        buf.pop_front();
        buf.pop_front();
    }
    buf.push_back(left);
    buf.push_back(right);
}

extern "C" fn cb_audio_sample_batch(data: *const i16, frames: usize) -> usize {
    if data.is_null() { return frames; }
    let n_samples = frames * 2;
    let mut buf = audio_buf().lock().unwrap();
    // Se batch nao cabe, dropa do inicio pra abrir espaco
    let space = AUDIO_BUF_LIMIT.saturating_sub(buf.len());
    if n_samples > space {
        let drop_n = n_samples - space;
        for _ in 0..drop_n.min(buf.len()) { buf.pop_front(); }
    }
    unsafe {
        let slice = std::slice::from_raw_parts(data, n_samples);
        buf.extend(slice.iter().copied());
    }
    frames
}

extern "C" fn cb_input_poll() {
    // sem-op — input ja foi atualizado via libretro_set_input
}

extern "C" fn cb_input_state(port: c_uint, device: c_uint, index: c_uint, id: c_uint) -> i16 {
    if port != 0 { return 0; }
    let s = state();
    let g = s.lock().unwrap();
    // v0.8.45: ANALOG stick (PCSX2/Dolphin/PSP/N64 etc precisam pro stick funcionar)
    if device == RETRO_DEVICE_ANALOG {
        if index >= 2 || id >= 2 { return 0; }
        let slot = (index as usize) * 2 + (id as usize);
        return g.analog_state[slot];
    }
    if device != RETRO_DEVICE_JOYPAD { return 0; }
    // v0.8.43: BITMASK support — cores modernos (PCSX2, Dolphin, PPSSPP, etc.)
    // pedem todos os 16 botoes via uma chamada com id=256.
    if id == RETRO_DEVICE_ID_JOYPAD_MASK {
        let mut mask: i16 = 0;
        for i in 0..16 {
            if g.input_state[i] { mask |= 1 << i; }
        }
        return mask;
    }
    if id >= 16 { return 0; }
    if g.input_state[id as usize] { 1 } else { 0 }
}

// ----- Wrapper alto-nivel -----

pub struct LibretroCore {
    lib: Library,
}

/// v0.8.31: cria hardlink/symlink em path simples se o original tem chars
/// que cores libretro lidam mal (espaco, parenteses, unicode). Retorna o path
/// que deve ser passado pro core. Se falhar criar link, retorna o original.
pub fn make_safe_link(rom_path: &Path) -> std::path::PathBuf {
    let name = rom_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    // Se ja eh "safe" (so ASCII e sem espaco/parenteses), nao mexe
    let is_safe = name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    if is_safe { return rom_path.to_path_buf(); }
    // Cria dir <data>/Ludex/temp/
    let temp_dir = dirs::data_dir()
        .map(|d| d.join("Ludex").join("temp"))
        .unwrap_or_else(|| std::env::temp_dir().join("ludex"));
    if std::fs::create_dir_all(&temp_dir).is_err() {
        return rom_path.to_path_buf();
    }
    let ext = rom_path.extension().and_then(|e| e.to_str()).unwrap_or("iso");
    // v0.8.48: nome do link inclui hash do path ORIGINAL — sem isso PCSX2 cria
    // memory card "rom.ps2" compartilhado entre TODOS os jogos PS2 (memcard eh
    // nomeado pelo filename). Com hash estavel, cada jogo tem seu memcard.
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(rom_path.to_string_lossy().as_bytes());
    let hash_hex = hex::encode(&hasher.finalize()[..6]); // 12 hex chars
    let link_path = temp_dir.join(format!("rom_{}.{}", hash_hex, ext));
    // Se ja existe (mesma rom, sessao anterior), reutiliza — memcard mantem nome
    if link_path.exists() { return link_path; }
    // 1) Tenta hardlink (mesmo volume, instantaneo)
    if std::fs::hard_link(rom_path, &link_path).is_ok() {
        return link_path;
    }
    // 2) Tenta symlink (Windows precisa Dev Mode)
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_file(rom_path, &link_path).is_ok() {
            return link_path;
        }
    }
    #[cfg(unix)]
    {
        if std::os::unix::fs::symlink(rom_path, &link_path).is_ok() {
            return link_path;
        }
    }
    // 3) Nada funcionou — usa path original
    rom_path.to_path_buf()
}

impl LibretroCore {
    pub unsafe fn load(dll_path: &Path) -> Result<Self, String> {
        let lib = Library::new(dll_path).map_err(|e| format!("load .dll: {}", e))?;
        Ok(LibretroCore { lib })
    }

    pub unsafe fn set_callbacks(&self) -> Result<(), String> {
        type SetEnv  = extern "C" fn(RetroEnvironmentT);
        type SetVid  = extern "C" fn(RetroVideoRefreshT);
        type SetAud  = extern "C" fn(RetroAudioSampleT);
        type SetAudB = extern "C" fn(RetroAudioSampleBatchT);
        type SetInP  = extern "C" fn(RetroInputPollT);
        type SetInS  = extern "C" fn(RetroInputStateT);

        let env: Symbol<SetEnv> = self.lib.get(b"retro_set_environment").map_err(|e| e.to_string())?;
        env(cb_environment);
        let vid: Symbol<SetVid> = self.lib.get(b"retro_set_video_refresh").map_err(|e| e.to_string())?;
        vid(cb_video_refresh);
        let aud: Symbol<SetAud> = self.lib.get(b"retro_set_audio_sample").map_err(|e| e.to_string())?;
        aud(cb_audio_sample);
        let audb: Symbol<SetAudB> = self.lib.get(b"retro_set_audio_sample_batch").map_err(|e| e.to_string())?;
        audb(cb_audio_sample_batch);
        let inp: Symbol<SetInP> = self.lib.get(b"retro_set_input_poll").map_err(|e| e.to_string())?;
        inp(cb_input_poll);
        let ins: Symbol<SetInS> = self.lib.get(b"retro_set_input_state").map_err(|e| e.to_string())?;
        ins(cb_input_state);
        Ok(())
    }

    pub unsafe fn init(&self) -> Result<(), String> {
        type Fn0 = extern "C" fn();
        let f: Symbol<Fn0> = self.lib.get(b"retro_init").map_err(|e| e.to_string())?;
        f();
        Ok(())
    }

    pub unsafe fn deinit(&self) {
        type Fn0 = extern "C" fn();
        if let Ok(f) = self.lib.get::<Fn0>(b"retro_deinit") { f(); }
    }

    pub unsafe fn load_game(&self, rom_path: &Path) -> Result<RetroSystemAvInfo, String> {
        type LoadFn = extern "C" fn(*const RetroGameInfo) -> bool;
        type AvFn   = extern "C" fn(*mut RetroSystemAvInfo);
        type SysFn  = extern "C" fn(*mut RetroSystemInfo);

        // v0.8.27: respeitar need_fullpath (PCSX2/Flycast/Dolphin/etc precisam
        // do path no disco direto — load em memoria de ISO 4GB faz segfault).
        // v0.8.31: hardlink em path simples (sem espacos/parenteses/unicode)
        //   PCSX2 libretro tem problemas com paths complexos. Cria hardlink em
        //   <data>/Ludex/temp/rom.<ext> e usa esse path. Hardlink eh instantaneo
        //   no mesmo volume + zero espaco extra. Symlink fallback (precisa Dev
        //   Mode em Windows). Cópia ultima opcao.
        let actual_path = make_safe_link(rom_path);
        let path_c = CString::new(actual_path.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;
        log::info!("[libretro] using path={} (original={})", actual_path.display(), rom_path.display());
        // v0.8.46: salva path da ROM pra BIOS region detection no GET_VARIABLE
        {
            let s = state();
            let mut g = s.lock().unwrap();
            g.current_rom_path = Some(rom_path.to_string_lossy().into_owned());
        }
        let sys_info_fn: Symbol<SysFn> = self.lib.get(b"retro_get_system_info").map_err(|e| e.to_string())?;
        let mut sys_info = RetroSystemInfo {
            library_name: std::ptr::null(),
            library_version: std::ptr::null(),
            valid_extensions: std::ptr::null(),
            need_fullpath: false,
            block_extract: false,
        };
        sys_info_fn(&mut sys_info as *mut _);

        // Carrega bytes so se nao precisar fullpath (ROMs pequenas GBA/SNES/etc)
        let bytes_holder: Option<Vec<u8>> = if sys_info.need_fullpath {
            None
        } else {
            Some(std::fs::read(rom_path).map_err(|e| format!("ler ROM: {}", e))?)
        };
        let (data_ptr, data_size): (*const c_void, usize) = match &bytes_holder {
            Some(b) => (b.as_ptr() as *const c_void, b.len()),
            None    => (std::ptr::null(), 0),
        };

        let info = RetroGameInfo {
            path: path_c.as_ptr(),
            data: data_ptr,
            size: data_size,
            meta: std::ptr::null(),
        };

        // Log estado pre-load (debug)
        {
            let s = state();
            let g = s.lock().unwrap();
            let sys_path = g.system_dir.to_string_lossy();
            log::info!("[libretro] load_game sys_dir={} need_fullpath={} rom={}",
                sys_path, sys_info.need_fullpath, rom_path.display());
            if let Ok(entries) = std::fs::read_dir(sys_path.as_ref()) {
                let mut files: Vec<String> = entries.flatten()
                    .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
                    .collect();
                files.sort();
                log::info!("[libretro] system_dir contains: {:?}", files);
            }
        }

        // v0.8.32: se hw_render foi negociado, contexto GL precisa estar current
        // nesta thread antes do retro_load_game (PCSX2 inicia GL state durante load)
        #[cfg(any(windows, target_os = "android"))]
        {
            let s = state();
            let g = s.lock().unwrap();
            let active = g.hw_active;
            drop(g);
            if active { let _ = crate::gl_context::make_current(); }
        }

        let load: Symbol<LoadFn> = self.lib.get(b"retro_load_game").map_err(|e| e.to_string())?;
        if !load(&info as *const _) {
            return Err(format!("retro_load_game retornou false (need_fullpath={})", sys_info.need_fullpath));
        }

        // v0.8.32: notifica core que contexto GL esta pronto pra ele inicializar
        // recursos GPU (programas/buffers/texturas). DEVE rodar com ctx current.
        #[cfg(any(windows, target_os = "android"))]
        {
            let s = state();
            let g = s.lock().unwrap();
            let reset_cb = if g.hw_active { g.hw_context_reset } else { None };
            drop(g);
            if let Some(reset) = reset_cb {
                let _ = crate::gl_context::make_current();
                log::info!("[libretro] chamando hw context_reset");
                reset();
            }
        }

        // v0.8.44: garante port 0 = JoyPad. Alguns cores defaultam pra NONE
        // se SET_CONTROLLER_INFO nao foi acknowledged corretamente -> sem input.
        // Ignora erro: nem todo core exporta esse simbolo (cores antigos).
        type PortDevFn = extern "C" fn(c_uint, c_uint);
        if let Ok(set_port) = self.lib.get::<PortDevFn>(b"retro_set_controller_port_device") {
            set_port(0, RETRO_DEVICE_JOYPAD);
            log::info!("[libretro] port 0 = JOYPAD");
        }

        let av: Symbol<AvFn> = self.lib.get(b"retro_get_system_av_info").map_err(|e| e.to_string())?;
        let mut av_info = RetroSystemAvInfo {
            geometry: RetroGameGeometry { base_width: 0, base_height: 0, max_width: 0, max_height: 0, aspect_ratio: 0.0 },
            timing:   RetroSystemTiming  { fps: 60.0, sample_rate: 32000.0 },
        };
        av(&mut av_info as *mut _);
        Ok(av_info)
    }

    pub unsafe fn unload_game(&self) {
        type Fn0 = extern "C" fn();
        // v0.8.46: notifica core que vamos descartar contexto GL — core libera
        // recursos GPU (programas/buffers/texturas). Sem isso vaza por sessao.
        #[cfg(any(windows, target_os = "android"))]
        {
            let s = state();
            let g = s.lock().unwrap();
            let destroy_cb = if g.hw_active { g.hw_context_destroy } else { None };
            drop(g);
            if let Some(destroy) = destroy_cb {
                let _ = crate::gl_context::make_current();
                log::info!("[libretro] chamando hw context_destroy");
                destroy();
            }
            let s2 = state();
            let mut g = s2.lock().unwrap();
            g.hw_active = false;
            g.hw_context_reset = None;
            g.hw_context_destroy = None;
            g.disk_control = None;
            g.current_rom_path = None;
        }
        if let Ok(f) = self.lib.get::<Fn0>(b"retro_unload_game") { f(); }
        // v0.8.46: cleanup do symlink/hardlink temp/rom.* (deixa pasta limpa)
        let temp_link = dirs::data_dir()
            .map(|d| d.join("Ludex").join("temp"));
        if let Some(temp_dir) = temp_link {
            if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                for e in entries.flatten() {
                    let p = e.path();
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with("rom.") { let _ = std::fs::remove_file(&p); }
                    }
                }
            }
        }
    }

    pub unsafe fn run(&self) -> Result<(), String> {
        type Fn0 = extern "C" fn();
        // v0.8.32: ctx GL precisa current na thread que chama retro_run
        #[cfg(any(windows, target_os = "android"))]
        {
            let s = state();
            let g = s.lock().unwrap();
            let active = g.hw_active;
            drop(g);
            if active { let _ = crate::gl_context::make_current(); }
        }
        let f: Symbol<Fn0> = self.lib.get(b"retro_run").map_err(|e| e.to_string())?;
        f();
        Ok(())
    }

    // v0.9.2: cheats. retro_cheat_reset() limpa tudo; retro_cheat_set(idx, on, code)
    // aplica um codigo. Codigos no formato do core (Game Genie/PAR p/ retro, raw
    // p/ modernos). Se o core nao exporta os simbolos, retorna erro amigavel.
    pub unsafe fn cheat_reset(&self) -> Result<(), String> {
        type Fn0 = extern "C" fn();
        let f: Symbol<Fn0> = self.lib.get(b"retro_cheat_reset")
            .map_err(|_| "core nao suporta cheats".to_string())?;
        f();
        Ok(())
    }

    pub unsafe fn cheat_set(&self, index: u32, enabled: bool, code: &str) -> Result<(), String> {
        type FnC = extern "C" fn(u32, bool, *const std::os::raw::c_char);
        let f: Symbol<FnC> = self.lib.get(b"retro_cheat_set")
            .map_err(|_| "core nao suporta cheats".to_string())?;
        let c = CString::new(code).map_err(|e| e.to_string())?;
        f(index, enabled, c.as_ptr());
        Ok(())
    }

    pub unsafe fn serialize_size(&self) -> Result<usize, String> {
        type Fn0 = extern "C" fn() -> usize;
        let f: Symbol<Fn0> = self.lib.get(b"retro_serialize_size").map_err(|e| e.to_string())?;
        Ok(f())
    }

    pub unsafe fn serialize(&self) -> Result<Vec<u8>, String> {
        let size = self.serialize_size()?;
        if size == 0 { return Err("core nao suporta serialize".into()); }
        let mut buf = vec![0u8; size];
        type FnSer = extern "C" fn(*mut c_void, usize) -> bool;
        let f: Symbol<FnSer> = self.lib.get(b"retro_serialize").map_err(|e| e.to_string())?;
        if !f(buf.as_mut_ptr() as *mut c_void, size) {
            return Err("retro_serialize retornou false".into());
        }
        Ok(buf)
    }

    pub unsafe fn unserialize(&self, data: &[u8]) -> Result<(), String> {
        type FnUns = extern "C" fn(*const c_void, usize) -> bool;
        let f: Symbol<FnUns> = self.lib.get(b"retro_unserialize").map_err(|e| e.to_string())?;
        if !f(data.as_ptr() as *const c_void, data.len()) {
            return Err("retro_unserialize retornou false (state incompativel?)".into());
        }
        Ok(())
    }

    pub unsafe fn system_info(&self) -> Result<(String, String), String> {
        type Fn1 = extern "C" fn(*mut RetroSystemInfo);
        let f: Symbol<Fn1> = self.lib.get(b"retro_get_system_info").map_err(|e| e.to_string())?;
        let mut info = RetroSystemInfo {
            library_name:     std::ptr::null(),
            library_version:  std::ptr::null(),
            valid_extensions: std::ptr::null(),
            need_fullpath:    false,
            block_extract:    false,
        };
        f(&mut info as *mut _);
        let name = if info.library_name.is_null() { String::new() }
                   else { CStr::from_ptr(info.library_name).to_string_lossy().to_string() };
        let ver  = if info.library_version.is_null() { String::new() }
                   else { CStr::from_ptr(info.library_version).to_string_lossy().to_string() };
        Ok((name, ver))
    }
}
