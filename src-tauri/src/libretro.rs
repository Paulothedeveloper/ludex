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
        let dir_base = dirs::data_dir()
            .map(|d| d.join("Playbox"))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let sys_dir  = dir_base.join("system");
        let save_dir = dir_base.join("saves-libretro");
        std::fs::create_dir_all(&sys_dir).ok();
        std::fs::create_dir_all(&save_dir).ok();
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
        RETRO_ENVIRONMENT_GET_VARIABLE => false, // por enquanto sem options
        RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE => unsafe {
            if !data.is_null() { *(data as *mut bool) = false; }
            true
        },
        _ => false,
    }
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

        // Le ROM em memoria (way mais simples que need_fullpath)
        let bytes = std::fs::read(rom_path).map_err(|e| format!("ler ROM: {}", e))?;
        let path_c = CString::new(rom_path.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;

        let info = RetroGameInfo {
            path: path_c.as_ptr(),
            data: bytes.as_ptr() as *const c_void,
            size: bytes.len(),
            meta: std::ptr::null(),
        };

        let load: Symbol<LoadFn> = self.lib.get(b"retro_load_game").map_err(|e| e.to_string())?;
        if !load(&info as *const _) {
            return Err("retro_load_game retornou false".into());
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
