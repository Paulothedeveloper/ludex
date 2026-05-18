//! Libretro frontend embarcado no Playbox.
//! Carrega .dll de cores libretro dinamicamente, executa frames, captura video,
//! roteia input. Sem aplicação externa rodando.

use libloading::{Library, Symbol};
use std::ffi::{c_char, c_void, CStr, CString};
use std::os::raw::{c_uchar, c_uint};
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};

// ----- Tipos C do libretro -----

pub const RETRO_API_VERSION: u32 = 1;

// Pixel formats
pub const RETRO_PIXEL_FORMAT_0RGB1555: u32 = 0;
pub const RETRO_PIXEL_FORMAT_XRGB8888: u32 = 1;
pub const RETRO_PIXEL_FORMAT_RGB565:   u32 = 2;

// Environment commands (subset essencial)
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

// Devices
pub const RETRO_DEVICE_NONE:     u32 = 0;
pub const RETRO_DEVICE_JOYPAD:   u32 = 1;

// Joypad button IDs
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
    pub pixel_format: u32, // 0RGB1555, XRGB8888 ou RGB565
    pub system_dir: CString,
    pub save_dir:   CString,
    pub input_state: [bool; 16], // botoes do joypad porta 0
    pub av_info: Option<RetroSystemAvInfo>,
    pub audio_buf: std::collections::VecDeque<i16>, // samples interleaved L,R,L,R...
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
        Arc::new(StdMutex::new(LibretroState {
            library: None,
            frame:   None,
            pixel_format: RETRO_PIXEL_FORMAT_0RGB1555,
            system_dir: CString::new(sys_dir.to_string_lossy().as_ref()).unwrap_or_default(),
            save_dir:   CString::new(save_dir.to_string_lossy().as_ref()).unwrap_or_default(),
            input_state: [false; 16],
            av_info: None,
            audio_buf: std::collections::VecDeque::with_capacity(48000 * 2),
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
            // Loga o que o core esta perguntando (debug)
            #[repr(C)]
            struct RetroVariable { key: *const c_char, value: *mut c_char }
            let var = data as *const RetroVariable;
            if !(*var).key.is_null() {
                let key = CStr::from_ptr((*var).key).to_string_lossy();
                log::info!("[libretro] GET_VARIABLE key={}", key);
            }
            false // sem options por enquanto
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
            if !data.is_null() { *(data as *mut bool) = false; }
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
        RETRO_ENVIRONMENT_GET_INPUT_BITMASKS => true, // Suporte: poll retorna bitmask
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

// v0.8.27: log callback — recebe printf-style do core.
// v0.8.28: usa log::warn pra aparecer no Ludex.log (Windows GUI suprime stderr).
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

extern "C" fn cb_video_refresh(data: *const c_void, width: c_uint, height: c_uint, pitch: usize) {
    if data.is_null() { return; }
    let s = state();
    let mut g = s.lock().unwrap();
    let fmt = g.pixel_format;
    let mut rgba = vec![0u8; (width * height * 4) as usize];
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
    g.frame = Some(Frame { width, height, rgba });
}

extern "C" fn cb_audio_sample(left: i16, right: i16) {
    let s = state();
    let mut g = s.lock().unwrap();
    // Limite anti-overflow: dropa se buffer encher (2 segundos de samples)
    let limit = 48000 * 2 * 2;
    if g.audio_buf.len() < limit {
        g.audio_buf.push_back(left);
        g.audio_buf.push_back(right);
    }
}

extern "C" fn cb_audio_sample_batch(data: *const i16, frames: usize) -> usize {
    if data.is_null() { return frames; }
    let s = state();
    let mut g = s.lock().unwrap();
    let limit = 48000 * 2 * 2;
    let n_samples = frames * 2; // stereo interleaved
    unsafe {
        let slice = std::slice::from_raw_parts(data, n_samples);
        for &sample in slice {
            if g.audio_buf.len() >= limit { break; }
            g.audio_buf.push_back(sample);
        }
    }
    frames
}

extern "C" fn cb_input_poll() {
    // sem-op — input ja foi atualizado via libretro_set_input
}

extern "C" fn cb_input_state(port: c_uint, device: c_uint, _index: c_uint, id: c_uint) -> i16 {
    if port != 0 || device != RETRO_DEVICE_JOYPAD || id >= 16 { return 0; }
    let s = state();
    let g = s.lock().unwrap();
    if g.input_state[id as usize] { 1 } else { 0 }
}

// ----- Wrapper alto-nivel -----

pub struct LibretroCore {
    lib: Library,
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
        let path_c = CString::new(rom_path.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;
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

        let load: Symbol<LoadFn> = self.lib.get(b"retro_load_game").map_err(|e| e.to_string())?;
        if !load(&info as *const _) {
            return Err(format!("retro_load_game retornou false (need_fullpath={})", sys_info.need_fullpath));
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
        if let Ok(f) = self.lib.get::<Fn0>(b"retro_unload_game") { f(); }
    }

    pub unsafe fn run(&self) -> Result<(), String> {
        type Fn0 = extern "C" fn();
        let f: Symbol<Fn0> = self.lib.get(b"retro_run").map_err(|e| e.to_string())?;
        f();
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
