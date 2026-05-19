//! Contexto OpenGL offscreen pra libretro hw_render (PCSX2, Dolphin, Flycast, Citra).
//!
//! Cria janela Win32 oculta + contexto WGL OpenGL 4.3 Core + FBO + PBO duplo.
//! Cores HW-rendered desenham no FBO; trazemos pra RAM via PBO async (sem stall).
//!
//! v0.8.32: contexto basico GL 1.1 (PCSX2 funcionava mas sem shaders modernos).
//! v0.8.34: GL 4.3 Core via wglCreateContextAttribsARB (PCSX2/Dolphin/etc rodam
//!          shaders direito) + PBO async readback (sem GPU stall).
//!
//! Apenas Windows por enquanto.

#![cfg(windows)]

use std::ffi::CString;
use std::os::raw::{c_char, c_void};
use std::ptr::null_mut;
use std::sync::{Mutex, OnceLock};

use winapi::shared::minwindef::{HINSTANCE, HMODULE, LPARAM, LRESULT, UINT, WPARAM};
use winapi::shared::windef::{HDC, HGLRC, HWND};
use winapi::um::libloaderapi::{GetModuleHandleW, GetProcAddress, LoadLibraryA};
use winapi::um::wingdi::{
    wglCreateContext, wglDeleteContext, wglGetProcAddress, wglMakeCurrent,
    ChoosePixelFormat, SetPixelFormat,
    PFD_DOUBLEBUFFER, PFD_DRAW_TO_WINDOW, PFD_MAIN_PLANE, PFD_SUPPORT_OPENGL,
    PFD_TYPE_RGBA, PIXELFORMATDESCRIPTOR,
};
use winapi::um::winuser::{
    CreateWindowExW, DefWindowProcW, GetDC, RegisterClassW, ReleaseDC, CS_OWNDC,
    HWND_MESSAGE, WNDCLASSW, WS_OVERLAPPEDWINDOW,
};

// WGL ARB constants pra criar contexto moderno
const WGL_CONTEXT_MAJOR_VERSION_ARB: i32 = 0x2091;
const WGL_CONTEXT_MINOR_VERSION_ARB: i32 = 0x2092;
const WGL_CONTEXT_PROFILE_MASK_ARB: i32 = 0x9126;
const WGL_CONTEXT_FLAGS_ARB: i32 = 0x2094;
const WGL_CONTEXT_CORE_PROFILE_BIT_ARB: i32 = 0x00000001;
const WGL_CONTEXT_FORWARD_COMPATIBLE_BIT_ARB: i32 = 0x00000002;

type WglCreateContextAttribsArbFn = unsafe extern "system" fn(
    hdc: HDC, share: HGLRC, attrib_list: *const i32,
) -> HGLRC;

pub struct GlContext {
    hwnd: HWND,
    hdc: HDC,
    hglrc: HGLRC,
    opengl32: HMODULE,
    pub fbo: u32,
    pub color_tex: u32,
    pub depth_rb: u32,
    pub width: u32,
    pub height: u32,
    pbos: [u32; 2],
    pbo_size: usize, // tamanho atual alocado (cresce se frame maior chegar)
    pbo_idx: usize,  // proximo a escrever
}

unsafe impl Send for GlContext {}

static GL_CTX: OnceLock<Mutex<Option<GlContext>>> = OnceLock::new();

fn ctx_slot() -> &'static Mutex<Option<GlContext>> {
    GL_CTX.get_or_init(|| Mutex::new(None))
}

pub fn ensure_init() -> bool {
    let mut slot = ctx_slot().lock().unwrap();
    if slot.is_some() { return true; }
    match unsafe { create_gl_context() } {
        Ok(ctx) => {
            log::info!("[gl] contexto OpenGL 4.3 Core offscreen criado: {}x{} fbo={}",
                ctx.width, ctx.height, ctx.fbo);
            unsafe {
                let mut major = 0i32; let mut minor = 0i32;
                gl::GetIntegerv(gl::MAJOR_VERSION, &mut major);
                gl::GetIntegerv(gl::MINOR_VERSION, &mut minor);
                let ver = gl::GetString(gl::VERSION) as *const i8;
                let renderer = gl::GetString(gl::RENDERER) as *const i8;
                let ver_s = if ver.is_null() { "?".into() }
                    else { std::ffi::CStr::from_ptr(ver).to_string_lossy().into_owned() };
                let ren_s = if renderer.is_null() { "?".into() }
                    else { std::ffi::CStr::from_ptr(renderer).to_string_lossy().into_owned() };
                log::info!("[gl] reportado: GL {}.{} \"{}\" \"{}\"", major, minor, ver_s, ren_s);
            }
            *slot = Some(ctx);
            true
        }
        Err(e) => {
            log::error!("[gl] falha criar contexto: {}", e);
            false
        }
    }
}

pub fn make_current() -> bool {
    let slot = ctx_slot().lock().unwrap();
    let Some(ctx) = slot.as_ref() else { return false; };
    unsafe { wglMakeCurrent(ctx.hdc, ctx.hglrc) != 0 }
}

pub fn current_fbo() -> u32 {
    let slot = ctx_slot().lock().unwrap();
    slot.as_ref().map(|c| c.fbo).unwrap_or(0)
}

pub fn get_proc_addr(name: *const c_char) -> *const c_void {
    if name.is_null() { return std::ptr::null(); }
    let slot = ctx_slot().lock().unwrap();
    let Some(ctx) = slot.as_ref() else { return std::ptr::null(); };
    unsafe {
        let p = wglGetProcAddress(name) as *const c_void;
        if !p.is_null() && (p as isize) != -1 && (p as isize) != 1
            && (p as isize) != 2 && (p as isize) != 3
        {
            return p;
        }
        GetProcAddress(ctx.opengl32, name) as *const c_void
    }
}

/// Le pixels do FBO via PBO async (1 frame de latencia, sem GPU stall).
/// Frame N: dispara glReadPixels pro PBO atual (GPU async)
/// Frame N+1: lê PBO do frame N (já completo)
pub fn read_pixels(width: u32, height: u32) -> Option<Vec<u8>> {
    let mut slot = ctx_slot().lock().unwrap();
    let ctx = slot.as_mut()?;
    if !unsafe { wglMakeCurrent(ctx.hdc, ctx.hglrc) != 0 } { return None; }
    let bytes = (width as usize) * (height as usize) * 4;
    let idx_now = ctx.pbo_idx;
    let idx_prev = 1 - idx_now;
    unsafe {
        // Realoca PBOs se tamanho cresceu
        if bytes > ctx.pbo_size {
            for &pbo in &ctx.pbos {
                gl::BindBuffer(gl::PIXEL_PACK_BUFFER, pbo);
                gl::BufferData(gl::PIXEL_PACK_BUFFER, bytes as isize,
                    std::ptr::null(), gl::STREAM_READ);
            }
            ctx.pbo_size = bytes;
        }
        gl::PixelStorei(gl::PACK_ALIGNMENT, 1);
        gl::BindFramebuffer(gl::READ_FRAMEBUFFER, ctx.fbo);

        // Dispara read pro PBO atual (async — nao bloqueia)
        gl::BindBuffer(gl::PIXEL_PACK_BUFFER, ctx.pbos[idx_now]);
        gl::ReadPixels(0, 0, width as i32, height as i32,
            gl::RGBA, gl::UNSIGNED_BYTE, std::ptr::null_mut());

        // Mapeia PBO do frame anterior (ja completo, sem stall na maioria dos casos)
        gl::BindBuffer(gl::PIXEL_PACK_BUFFER, ctx.pbos[idx_prev]);
        let mapped = gl::MapBuffer(gl::PIXEL_PACK_BUFFER, gl::READ_ONLY);
        let buf = if !mapped.is_null() {
            let slice = std::slice::from_raw_parts(mapped as *const u8, bytes);
            let mut out = vec![0u8; bytes];
            // Flipa vertical (GL bottom-left origin, canvas top-left)
            // v0.8.36: FORCA alpha=255. PCSX2/Dolphin/etc renderizam com alpha
            //   garbage no FBO — canvas trata como transparente -> tela preta.
            //   Bug visivel em GoW2/Crash: imagem aparece "atras" do alpha zero.
            let row = (width * 4) as usize;
            for y in 0..height as usize {
                let src = (height as usize - 1 - y) * row;
                let dst = y * row;
                let src_row = &slice[src..src + row];
                let dst_row = &mut out[dst..dst + row];
                dst_row.copy_from_slice(src_row);
                // Forca alpha=255 em todo pixel da linha
                for px in 0..(width as usize) {
                    dst_row[px * 4 + 3] = 0xFF;
                }
            }
            gl::UnmapBuffer(gl::PIXEL_PACK_BUFFER);
            Some(out)
        } else { None };

        gl::BindBuffer(gl::PIXEL_PACK_BUFFER, 0);
        ctx.pbo_idx = idx_prev; // proximo frame escreve no que acabamos de ler
        buf
    }
}

// ----- internos -----

unsafe extern "system" fn wndproc(hwnd: HWND, msg: UINT, w: WPARAM, l: LPARAM) -> LRESULT {
    DefWindowProcW(hwnd, msg, w, l)
}

unsafe fn create_gl_context() -> Result<GlContext, String> {
    use std::os::windows::ffi::OsStrExt;
    let class_name: Vec<u16> = std::ffi::OsStr::new("LudexGlHidden\0")
        .encode_wide().collect();
    let hinstance: HINSTANCE = GetModuleHandleW(null_mut()) as HINSTANCE;
    let wc = WNDCLASSW {
        style: CS_OWNDC,
        lpfnWndProc: Some(wndproc),
        cbClsExtra: 0, cbWndExtra: 0,
        hInstance: hinstance,
        hIcon: null_mut(), hCursor: null_mut(), hbrBackground: null_mut(),
        lpszMenuName: null_mut(),
        lpszClassName: class_name.as_ptr(),
    };
    RegisterClassW(&wc);
    let title: Vec<u16> = std::ffi::OsStr::new("LudexGl\0").encode_wide().collect();
    let hwnd = CreateWindowExW(
        0, class_name.as_ptr(), title.as_ptr(),
        WS_OVERLAPPEDWINDOW, 0, 0, 16, 16,
        HWND_MESSAGE, null_mut(), hinstance, null_mut(),
    );
    if hwnd.is_null() { return Err("CreateWindowExW falhou".into()); }

    let hdc = GetDC(hwnd);
    if hdc.is_null() { return Err("GetDC retornou null".into()); }

    let pfd = PIXELFORMATDESCRIPTOR {
        nSize: std::mem::size_of::<PIXELFORMATDESCRIPTOR>() as u16,
        nVersion: 1,
        dwFlags: PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER,
        iPixelType: PFD_TYPE_RGBA,
        cColorBits: 32,
        cRedBits: 0, cRedShift: 0, cGreenBits: 0, cGreenShift: 0,
        cBlueBits: 0, cBlueShift: 0, cAlphaBits: 8, cAlphaShift: 0,
        cAccumBits: 0, cAccumRedBits: 0, cAccumGreenBits: 0,
        cAccumBlueBits: 0, cAccumAlphaBits: 0,
        cDepthBits: 24, cStencilBits: 8, cAuxBuffers: 0,
        iLayerType: PFD_MAIN_PLANE,
        bReserved: 0, dwLayerMask: 0, dwVisibleMask: 0, dwDamageMask: 0,
    };
    let pf = ChoosePixelFormat(hdc, &pfd);
    if pf == 0 { return Err("ChoosePixelFormat falhou".into()); }
    if SetPixelFormat(hdc, pf, &pfd) == 0 { return Err("SetPixelFormat falhou".into()); }

    // Etapa 1: contexto temporario legacy (so pra carregar wglCreateContextAttribsARB)
    let tmp_ctx = wglCreateContext(hdc);
    if tmp_ctx.is_null() { return Err("wglCreateContext(tmp) falhou".into()); }
    if wglMakeCurrent(hdc, tmp_ctx) == 0 {
        return Err("wglMakeCurrent(tmp) falhou".into());
    }

    // Etapa 2: pega ponteiro pra wglCreateContextAttribsARB
    let cname = CString::new("wglCreateContextAttribsARB").unwrap();
    let create_fn_ptr = wglGetProcAddress(cname.as_ptr());
    if create_fn_ptr.is_null() {
        return Err("wglCreateContextAttribsARB nao suportada (GL antigo demais)".into());
    }
    let create_fn: WglCreateContextAttribsArbFn = std::mem::transmute(create_fn_ptr);

    // Etapa 3: cria contexto 4.3 Core. Tenta 4.3, fallback 3.3.
    // PCSX2 precisa 4.3, Dolphin/Flycast/PPSSPP 3.3, Citra 4.3.
    let attribs_43: [i32; 9] = [
        WGL_CONTEXT_MAJOR_VERSION_ARB, 4,
        WGL_CONTEXT_MINOR_VERSION_ARB, 3,
        WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
        WGL_CONTEXT_FLAGS_ARB, WGL_CONTEXT_FORWARD_COMPATIBLE_BIT_ARB,
        0,
    ];
    let attribs_33: [i32; 9] = [
        WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
        WGL_CONTEXT_MINOR_VERSION_ARB, 3,
        WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
        WGL_CONTEXT_FLAGS_ARB, WGL_CONTEXT_FORWARD_COMPATIBLE_BIT_ARB,
        0,
    ];
    let mut hglrc = create_fn(hdc, null_mut(), attribs_43.as_ptr());
    if hglrc.is_null() {
        log::warn!("[gl] 4.3 Core falhou, tentando 3.3 Core");
        hglrc = create_fn(hdc, null_mut(), attribs_33.as_ptr());
    }
    if hglrc.is_null() { return Err("wglCreateContextAttribsARB(4.3/3.3) falhou".into()); }

    // Etapa 4: descarta tmp, ativa moderno
    wglMakeCurrent(null_mut(), null_mut());
    wglDeleteContext(tmp_ctx);
    if wglMakeCurrent(hdc, hglrc) == 0 {
        return Err("wglMakeCurrent(moderno) falhou".into());
    }

    let opengl32 = LoadLibraryA(b"opengl32.dll\0".as_ptr() as *const c_char);
    if opengl32.is_null() { return Err("LoadLibraryA(opengl32.dll) falhou".into()); }

    gl::load_with(|name| {
        let cname = match CString::new(name) {
            Ok(c) => c,
            Err(_) => return std::ptr::null(),
        };
        let p = wglGetProcAddress(cname.as_ptr()) as *const c_void;
        if !p.is_null() && (p as isize) != -1 && (p as isize) != 1
            && (p as isize) != 2 && (p as isize) != 3
        {
            return p;
        }
        GetProcAddress(opengl32, cname.as_ptr()) as *const c_void
    });

    // FBO + textura color 2048x2048 + depth/stencil RB
    let width = 2048u32;
    let height = 2048u32;
    let mut fbo = 0u32;
    let mut color_tex = 0u32;
    let mut depth_rb = 0u32;
    gl::GenFramebuffers(1, &mut fbo);
    gl::BindFramebuffer(gl::FRAMEBUFFER, fbo);

    gl::GenTextures(1, &mut color_tex);
    gl::BindTexture(gl::TEXTURE_2D, color_tex);
    gl::TexImage2D(gl::TEXTURE_2D, 0, gl::RGBA8 as i32, width as i32, height as i32, 0,
        gl::RGBA, gl::UNSIGNED_BYTE, std::ptr::null());
    gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MIN_FILTER, gl::LINEAR as i32);
    gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MAG_FILTER, gl::LINEAR as i32);
    gl::FramebufferTexture2D(gl::FRAMEBUFFER, gl::COLOR_ATTACHMENT0,
        gl::TEXTURE_2D, color_tex, 0);

    gl::GenRenderbuffers(1, &mut depth_rb);
    gl::BindRenderbuffer(gl::RENDERBUFFER, depth_rb);
    gl::RenderbufferStorage(gl::RENDERBUFFER, gl::DEPTH24_STENCIL8,
        width as i32, height as i32);
    gl::FramebufferRenderbuffer(gl::FRAMEBUFFER, gl::DEPTH_STENCIL_ATTACHMENT,
        gl::RENDERBUFFER, depth_rb);

    let status = gl::CheckFramebufferStatus(gl::FRAMEBUFFER);
    if status != gl::FRAMEBUFFER_COMPLETE {
        return Err(format!("FBO incompleto: status=0x{:x}", status));
    }
    gl::BindFramebuffer(gl::FRAMEBUFFER, 0);

    // PBOs pra readback async (2x: enquanto GPU escreve em um, CPU le do outro)
    let mut pbos = [0u32; 2];
    gl::GenBuffers(2, pbos.as_mut_ptr());
    let init_size = (1920 * 1080 * 4) as usize; // chute inicial 1080p
    for &pbo in &pbos {
        gl::BindBuffer(gl::PIXEL_PACK_BUFFER, pbo);
        gl::BufferData(gl::PIXEL_PACK_BUFFER, init_size as isize,
            std::ptr::null(), gl::STREAM_READ);
    }
    gl::BindBuffer(gl::PIXEL_PACK_BUFFER, 0);

    Ok(GlContext {
        hwnd, hdc, hglrc, opengl32, fbo, color_tex, depth_rb, width, height,
        pbos, pbo_size: init_size, pbo_idx: 0,
    })
}

impl Drop for GlContext {
    fn drop(&mut self) {
        unsafe {
            if !self.hglrc.is_null() {
                wglMakeCurrent(null_mut(), null_mut());
                wglDeleteContext(self.hglrc);
            }
            if !self.hdc.is_null() && !self.hwnd.is_null() {
                ReleaseDC(self.hwnd, self.hdc);
            }
        }
    }
}
