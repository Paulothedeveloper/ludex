//! Contexto EGL + OpenGL ES 3 offscreen pra libretro hw_render no Android.
//! Espelha a interface do gl_context.rs (Windows/WGL): ensure_init / make_current /
//! current_fbo / get_proc_addr / read_pixels. Cores 3D (Dolphin=Wii/GC, Citra=3DS,
//! Flycast=Dreamcast, PPSSPP=PSP, mupen64plus GL=N64) desenham no FBO; trazemos pra
//! RAM com glReadPixels SINCRONO (GLES nao tem MapBuffer/PBO como o desktop).
//!
//! v0.9.17: implementacao inicial. EGL e cheio de gotcha de driver — TODOS os passos
//! logam, pra diagnosticar via `adb logcat` (regra logcat-antes-de-chutar).

#![cfg(target_os = "android")]

use std::os::raw::{c_char, c_void};
use std::sync::{Mutex, OnceLock};
use khronos_egl as egl;

type Egl = egl::DynamicInstance<egl::EGL1_4>;

struct GlesContext {
    egl: Egl,
    display: egl::Display,
    context: egl::Context,
    surface: egl::Surface,
    fbo: u32,
    #[allow(dead_code)]
    color_tex: u32,
    #[allow(dead_code)]
    depth_rb: u32,
    width: u32,
    height: u32,
    readbuf: Vec<u8>, // buffer CPU reaproveitado no readback
}
unsafe impl Send for GlesContext {}

static GL_CTX: OnceLock<Mutex<Option<GlesContext>>> = OnceLock::new();
fn ctx_slot() -> &'static Mutex<Option<GlesContext>> {
    GL_CTX.get_or_init(|| Mutex::new(None))
}

pub fn ensure_init() -> bool {
    let mut slot = ctx_slot().lock().unwrap();
    if slot.is_some() { return true; }
    match unsafe { create_gles_context() } {
        Ok(ctx) => {
            log::info!("[gles] contexto EGL/GLES3 offscreen criado: {}x{} fbo={}", ctx.width, ctx.height, ctx.fbo);
            unsafe {
                let ver = gl::GetString(gl::VERSION) as *const i8;
                let ren = gl::GetString(gl::RENDERER) as *const i8;
                let vs = if ver.is_null() { "?".into() } else { std::ffi::CStr::from_ptr(ver).to_string_lossy().into_owned() };
                let rs = if ren.is_null() { "?".into() } else { std::ffi::CStr::from_ptr(ren).to_string_lossy().into_owned() };
                log::info!("[gles] reportado: \"{}\" / \"{}\"", vs, rs);
            }
            *slot = Some(ctx);
            true
        }
        Err(e) => { log::error!("[gles] falha criar contexto: {}", e); false }
    }
}

pub fn make_current() -> bool {
    let slot = ctx_slot().lock().unwrap();
    let Some(ctx) = slot.as_ref() else { return false; };
    match ctx.egl.make_current(ctx.display, Some(ctx.surface), Some(ctx.surface), Some(ctx.context)) {
        Ok(_) => true,
        Err(e) => { log::warn!("[gles] make_current falhou: {:?}", e); false }
    }
}

pub fn current_fbo() -> u32 {
    let slot = ctx_slot().lock().unwrap();
    slot.as_ref().map(|c| c.fbo).unwrap_or(0)
}

pub fn get_proc_addr(name: *const c_char) -> *const c_void {
    if name.is_null() { return std::ptr::null(); }
    let slot = ctx_slot().lock().unwrap();
    let Some(ctx) = slot.as_ref() else { return std::ptr::null(); };
    let cstr = unsafe { std::ffi::CStr::from_ptr(name) };
    let Ok(s) = cstr.to_str() else { return std::ptr::null(); };
    match ctx.egl.get_proc_address(s) {
        Some(f) => f as *const c_void,
        None => std::ptr::null(),
    }
}

/// glReadPixels SINCRONO do FBO -> RGBA flipado verticalmente + alpha forcado 255.
pub fn read_pixels(width: u32, height: u32) -> Option<Vec<u8>> {
    let mut slot = ctx_slot().lock().unwrap();
    let ctx = slot.as_mut()?;
    if ctx.egl.make_current(ctx.display, Some(ctx.surface), Some(ctx.surface), Some(ctx.context)).is_err() {
        return None;
    }
    let bytes = (width as usize) * (height as usize) * 4;
    if ctx.readbuf.len() < bytes { ctx.readbuf.resize(bytes, 0); }
    unsafe {
        gl::PixelStorei(gl::PACK_ALIGNMENT, 1);
        gl::BindFramebuffer(gl::READ_FRAMEBUFFER, ctx.fbo);
        gl::ReadPixels(0, 0, width as i32, height as i32, gl::RGBA, gl::UNSIGNED_BYTE,
            ctx.readbuf.as_mut_ptr() as *mut c_void);
    }
    let row = (width * 4) as usize;
    let mut out = vec![0u8; bytes];
    for y in 0..height as usize {
        let src = (height as usize - 1 - y) * row;
        let dst = y * row;
        out[dst..dst + row].copy_from_slice(&ctx.readbuf[src..src + row]);
        for px in 0..(width as usize) { out[dst + px * 4 + 3] = 0xFF; }
    }
    Some(out)
}

// ----- interno -----
unsafe fn create_gles_context() -> Result<GlesContext, String> {
    let egl = Egl::load_required().map_err(|e| format!("load libEGL: {:?}", e))?;
    let display = egl.get_display(egl::DEFAULT_DISPLAY).ok_or("get_display(DEFAULT) = None")?;
    let (maj, min) = egl.initialize(display).map_err(|e| format!("eglInitialize: {:?}", e))?;
    log::info!("[gles] EGL {}.{}", maj, min);

    const OPENGL_ES3_BIT: egl::Int = 0x0040;
    let cfg_attribs = [
        egl::SURFACE_TYPE, egl::PBUFFER_BIT,
        egl::RENDERABLE_TYPE, OPENGL_ES3_BIT,
        egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::ALPHA_SIZE, 8,
        egl::DEPTH_SIZE, 24, egl::STENCIL_SIZE, 8,
        egl::NONE,
    ];
    let config = match egl.choose_first_config(display, &cfg_attribs) {
        Ok(Some(c)) => c,
        _ => {
            // fallback: ES2 bit (alguns drivers nao expoem ES3 bit no config)
            let alt = [
                egl::SURFACE_TYPE, egl::PBUFFER_BIT,
                egl::RENDERABLE_TYPE, egl::OPENGL_ES2_BIT,
                egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::ALPHA_SIZE, 8,
                egl::DEPTH_SIZE, 24, egl::STENCIL_SIZE, 8,
                egl::NONE,
            ];
            egl.choose_first_config(display, &alt).map_err(|e| format!("choose_config: {:?}", e))?
                .ok_or("nenhum config EGL compativel")?
        }
    };

    let pbuf_attribs = [egl::WIDTH, 16, egl::HEIGHT, 16, egl::NONE];
    let surface = egl.create_pbuffer_surface(display, config, &pbuf_attribs)
        .map_err(|e| format!("create_pbuffer_surface: {:?}", e))?;

    egl.bind_api(egl::OPENGL_ES_API).map_err(|e| format!("bind_api: {:?}", e))?;
    let ctx_attribs = [egl::CONTEXT_CLIENT_VERSION, 3, egl::NONE];
    let context = egl.create_context(display, config, None, &ctx_attribs)
        .map_err(|e| format!("create_context(ES3): {:?}", e))?;

    egl.make_current(display, Some(surface), Some(surface), Some(context))
        .map_err(|e| format!("make_current: {:?}", e))?;

    // carrega ponteiros GLES via eglGetProcAddress
    gl::load_with(|s| match egl.get_proc_address(s) {
        Some(f) => f as *const c_void,
        None => std::ptr::null(),
    });

    // FBO 2048x2048 (color RGBA8 + depth24/stencil8) — igual ao desktop
    let width = 2048u32;
    let height = 2048u32;
    let mut fbo = 0u32; let mut color_tex = 0u32; let mut depth_rb = 0u32;
    gl::GenFramebuffers(1, &mut fbo);
    gl::BindFramebuffer(gl::FRAMEBUFFER, fbo);
    gl::GenTextures(1, &mut color_tex);
    gl::BindTexture(gl::TEXTURE_2D, color_tex);
    gl::TexImage2D(gl::TEXTURE_2D, 0, gl::RGBA8 as i32, width as i32, height as i32, 0,
        gl::RGBA, gl::UNSIGNED_BYTE, std::ptr::null());
    gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MIN_FILTER, gl::LINEAR as i32);
    gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MAG_FILTER, gl::LINEAR as i32);
    gl::FramebufferTexture2D(gl::FRAMEBUFFER, gl::COLOR_ATTACHMENT0, gl::TEXTURE_2D, color_tex, 0);
    gl::GenRenderbuffers(1, &mut depth_rb);
    gl::BindRenderbuffer(gl::RENDERBUFFER, depth_rb);
    gl::RenderbufferStorage(gl::RENDERBUFFER, gl::DEPTH24_STENCIL8, width as i32, height as i32);
    gl::FramebufferRenderbuffer(gl::FRAMEBUFFER, gl::DEPTH_STENCIL_ATTACHMENT, gl::RENDERBUFFER, depth_rb);
    let status = gl::CheckFramebufferStatus(gl::FRAMEBUFFER);
    if status != gl::FRAMEBUFFER_COMPLETE {
        return Err(format!("FBO incompleto: status=0x{:x}", status));
    }
    gl::BindFramebuffer(gl::FRAMEBUFFER, 0);

    Ok(GlesContext {
        egl, display, context, surface, fbo, color_tex, depth_rb, width, height,
        readbuf: vec![0u8; (1920 * 1080 * 4) as usize],
    })
}
