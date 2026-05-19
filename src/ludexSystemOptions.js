// v0.8.37: Manifest de opcoes por sistema. Define quais opcoes libretro o user
// pode mexer pela UI de cada emulador. Cada opcao tem key (variavel libretro),
// label (PT-BR), type, choices (pra select), default e category.
//
// Categorias: 'video', 'performance', 'audio', 'sistema'
//
// Persistencia: localStorage chave 'ludex.options.<systemId>' = {key: value, ...}
// Apply: invoke('libretro_set_option', {key, value}) — efeito no proximo load_game.

import { invoke } from '@tauri-apps/api/core';

const sel = (key, label, category, options, defaultValue) => ({
  key, label, category, type: 'select', options, default: defaultValue,
});

export const SYSTEM_OPTIONS = {
  // ===== PS2 (PCSX2 / LRPS2) =====
  ps2: [
    sel('pcsx2_upscale_multiplier', 'Resolução', 'video',
      ['1x Native (PS2)', '2x Native (~720p)', '3x Native (~1080p)', '4x Native (~1440p/2K)', '6x Native (~2160p/4K)'],
      '1x Native (PS2)'),
    sel('pcsx2_widescreen_hint', 'Widescreen', 'video',
      ['disabled', 'enabled (16:9)', 'enabled (16:10)', 'enabled (21:9)'],
      'disabled'),
    sel('pcsx2_texture_filtering', 'Filtro de Textura', 'video',
      ['Nearest', 'Bilinear (PS2)', 'Bilinear (Forced)', 'Bilinear (Forced excluding sprite)'],
      'Bilinear (PS2)'),
    sel('pcsx2_anisotropic_filtering', 'Filtro Anisotrópico', 'video',
      ['disabled', '2x', '4x', '8x', '16x'],
      'disabled'),
    sel('pcsx2_deinterlace_mode', 'Desentrelaçamento', 'video',
      ['Automatic', 'Off', 'Weave TFF', 'Bob TFF', 'Blend TFF', 'Adaptive TFF'],
      'Automatic'),
    sel('pcsx2_ee_cycle_rate', 'Velocidade CPU (EE)', 'performance',
      ['50% (Underclock)', '60% (Underclock)', '75% (Underclock)', '100% (Normal Speed)', '130% (Overclock)', '180% (Overclock)', '300% (Overclock)'],
      '100% (Normal Speed)'),
    sel('pcsx2_fastboot', 'Boot Rápido (sem BIOS)', 'performance',
      ['enabled', 'disabled'],
      'enabled'),
    sel('pcsx2_fastcdvd', 'Leitura Rápida CD/DVD', 'performance',
      ['disabled', 'enabled'],
      'disabled'),
    sel('pcsx2_uncapped_framerate_hint', 'FPS sem Limite', 'performance',
      ['disabled', 'enabled', '60fps PAL-to-NTSC'],
      'disabled'),
    sel('pcsx2_renderer', 'Renderer (avançado)', 'sistema',
      ['Auto', 'OpenGL', 'Software (HW)', 'Software (SW)'],
      'Auto'),
  ],

  // ===== PS1 (swanstation) =====
  ps1: [
    sel('swanstation_GPU_ResolutionScale', 'Resolução', 'video',
      ['1', '2', '3', '4', '6', '8'],
      '1'),
    sel('swanstation_GPU_TrueColor', 'Cores True Color (24-bit)', 'video',
      ['enabled', 'disabled'],
      'enabled'),
    sel('swanstation_GPU_TextureFilter', 'Filtro Textura', 'video',
      ['Nearest', 'Bilinear', 'JINC2', 'xBR'],
      'Nearest'),
    sel('swanstation_GPU_DisableInterlacing', 'Sem Entrelaçamento', 'video',
      ['true', 'false'],
      'true'),
    sel('swanstation_GPU_PGXPEnable', 'PGXP (sem warping de polígono)', 'video',
      ['false', 'true'],
      'false'),
    sel('swanstation_GPU_WidescreenHack', 'Widescreen 16:9', 'video',
      ['false', 'true'],
      'false'),
    sel('swanstation_Display_AspectRatio', 'Aspect Ratio', 'video',
      ['4:3', '16:9', '16:10', '19:9', '21:9', 'Auto'],
      '4:3'),
    sel('swanstation_CPU_Overclock', 'Overclock CPU', 'performance',
      ['25', '50', '75', '100', '150', '200', '300', '500', '1000'],
      '100'),
    sel('swanstation_GPU_Renderer', 'Renderer (avançado)', 'sistema',
      ['Hardware', 'Software', 'Vulkan', 'OpenGL'],
      'Hardware'),
  ],

  // ===== N64 (mupen64plus-next) =====
  n64: [
    sel('mupen64plus-43screensize', 'Resolução 4:3', 'video',
      ['320x240', '640x480', '960x720', '1280x960', '1920x1440'],
      '640x480'),
    sel('mupen64plus-169screensize', 'Resolução 16:9', 'video',
      ['640x360', '960x540', '1280x720', '1920x1080', '2560x1440'],
      '960x540'),
    sel('mupen64plus-aspect', 'Aspect Ratio', 'video',
      ['4:3', '16:9', '16:9 adjusted'],
      '4:3'),
    sel('mupen64plus-ThreadedRenderer', 'Renderer Threaded', 'performance',
      ['True', 'False'],
      'True'),
    sel('mupen64plus-FrameDuping', 'Frame Duplicação', 'performance',
      ['False', 'True'],
      'False'),
    sel('mupen64plus-EnableFBEmulation', 'Emulação Framebuffer', 'video',
      ['True', 'False'],
      'True'),
    sel('mupen64plus-FXAA', 'Anti-Aliasing FXAA', 'video',
      ['0', '1'],
      '0'),
    sel('mupen64plus-MultiSampling', 'MSAA', 'video',
      ['0', '2', '4', '8', '16'],
      '0'),
  ],

  // ===== Dreamcast (Flycast) =====
  dreamcast: [
    sel('flycast_internal_resolution', 'Resolução', 'video',
      ['320x240', '640x480', '960x720', '1280x960', '1920x1440', '2560x1920', '3840x2880'],
      '640x480'),
    sel('flycast_cable_type', 'Tipo Cabo TV', 'video',
      ['TV (Composite)', 'TV (RGB)', 'VGA'],
      'TV (Composite)'),
    sel('flycast_widescreen_hack', 'Widescreen 16:9 (hack)', 'video',
      ['disabled', 'enabled'],
      'disabled'),
    sel('flycast_anisotropic_filtering', 'Anisotrópico', 'video',
      ['off', '2', '4', '8', '16'],
      'off'),
    sel('flycast_threaded_rendering', 'Renderer Threaded', 'performance',
      ['enabled', 'disabled'],
      'enabled'),
    sel('flycast_synchronous_rendering', 'Render Síncrono', 'performance',
      ['disabled', 'enabled'],
      'disabled'),
    sel('flycast_region', 'Região', 'sistema',
      ['Default', 'Japan', 'USA', 'Europe'],
      'Default'),
    sel('flycast_broadcast', 'Modo TV', 'sistema',
      ['Default', 'NTSC', 'PAL', 'PAL/M', 'PAL/N'],
      'Default'),
  ],

  // ===== PSP (PPSSPP) =====
  psp: [
    sel('ppsspp_internal_resolution', 'Resolução Interna', 'video',
      ['480x272', '960x544', '1440x816', '1920x1088', '2400x1360', '2880x1632', '3360x1904', '3840x2176'],
      '1440x816'),
    sel('ppsspp_texture_anisotropic_filtering', 'Anisotrópico', 'video',
      ['off', '2x', '4x', '8x', '16x'],
      'off'),
    sel('ppsspp_texture_filtering', 'Filtro Textura', 'video',
      ['Auto', 'Nearest', 'Linear', 'Auto Max Quality'],
      'Auto'),
    sel('ppsspp_buffer_filter', 'Filtro Buffer (display)', 'video',
      ['Linear', 'Nearest'],
      'Linear'),
    sel('ppsspp_cpu_core', 'Core CPU', 'performance',
      ['JIT', 'IR JIT', 'Interpreter'],
      'JIT'),
    sel('ppsspp_fast_memory', 'Memória Rápida (unsafe)', 'performance',
      ['enabled', 'disabled'],
      'enabled'),
    sel('ppsspp_frame_skipping', 'Frame Skip', 'performance',
      ['Off', '1', '2', '3', '4', '5', '6', '7', '8'],
      'Off'),
    sel('ppsspp_auto_frame_skip', 'Auto Frame Skip', 'performance',
      ['disabled', 'enabled'],
      'disabled'),
    sel('ppsspp_force_max_fps', 'FPS Máximo', 'performance',
      ['off', '15', '30', '60'],
      '60'),
    sel('ppsspp_language', 'Idioma', 'sistema',
      ['Automatic', 'Portuguese BR', 'English', 'Japanese', 'Spanish'],
      'Automatic'),
  ],

  // ===== 3DS (Citra) =====
  '3ds': [
    sel('citra_resolution_factor', 'Resolução', 'video',
      ['1x (Native)', '2x', '3x', '4x', '5x', '6x', '7x', '8x', '10x'],
      '1x (Native)'),
    sel('citra_use_hw_renderer', 'Renderer HW', 'video',
      ['enabled', 'disabled'],
      'enabled'),
    sel('citra_use_hw_shader', 'Shaders HW', 'video',
      ['enabled', 'disabled'],
      'enabled'),
    sel('citra_use_shader_jit', 'Shader JIT', 'performance',
      ['enabled', 'disabled'],
      'enabled'),
    sel('citra_use_cpu_jit', 'CPU JIT', 'performance',
      ['enabled', 'disabled'],
      'enabled'),
    sel('citra_layout_option', 'Layout Telas', 'video',
      ['Default Top-Bottom Screen', 'Single Screen Only', 'Large Screen, Small Screen', 'Side by Side'],
      'Default Top-Bottom Screen'),
    sel('citra_swap_screen', 'Tela Principal', 'video',
      ['Top', 'Bottom'],
      'Top'),
    sel('citra_is_new_3ds', 'Modo New 3DS', 'sistema',
      ['New 3DS', 'Old 3DS'],
      'New 3DS'),
    sel('citra_region_value', 'Região', 'sistema',
      ['Auto', 'Japan', 'USA', 'Europe', 'Australia', 'China', 'Korea', 'Taiwan'],
      'Auto'),
    sel('citra_language', 'Idioma', 'sistema',
      ['Portuguese', 'English', 'Japanese', 'Spanish', 'German', 'French', 'Italian'],
      'Portuguese'),
  ],

  // ===== Wii / GameCube (Dolphin) — compartilham config =====
  wii: [
    sel('dolphin_efb_scale', 'Resolução Interna', 'video',
      ['x1 (640 x 528)', 'x2 (1280 x 1056)', 'x3 (1920 x 1584)', 'x4 (2560 x 2112)', 'x5 (3200 x 2640)', 'x6 (3840 x 3168)'],
      'x1 (640 x 528)'),
    sel('dolphin_widescreen_hack', 'Widescreen Hack', 'video',
      ['disabled', 'enabled'],
      'disabled'),
    sel('dolphin_anisotropic_filtering', 'Anisotrópico', 'video',
      ['1x', '2x', '4x', '8x', '16x'],
      '1x'),
    sel('dolphin_antialiasing', 'Anti-Aliasing', 'video',
      ['None', '2x MSAA', '4x MSAA', '8x MSAA', '2x SSAA', '4x SSAA', '8x SSAA'],
      'None'),
    sel('dolphin_efb_copy_method', 'Cópia EFB', 'performance',
      ['EFB to Texture', 'EFB to RAM (HLE)', 'EFB to RAM (LLE)'],
      'EFB to Texture'),
    sel('dolphin_fast_depth_calculation', 'Cálculo de Profundidade Rápido', 'performance',
      ['enabled', 'disabled'],
      'enabled'),
    sel('dolphin_disable_dual_core', 'Desabilitar Dual-Core', 'performance',
      ['disabled', 'enabled'],
      'disabled'),
    sel('dolphin_cpu_core', 'Core CPU', 'performance',
      ['JIT64', 'Interpreter', 'Cached Interpreter', 'JIT64 Inline Caches'],
      'JIT64'),
    sel('dolphin_progressive_scan', 'Progressive Scan', 'sistema',
      ['enabled', 'disabled'],
      'enabled'),
    sel('dolphin_pal60', 'PAL 60Hz', 'sistema',
      ['enabled', 'disabled'],
      'enabled'),
  ],

  // ===== DS (melonDS) =====
  ds: [
    sel('melonds_opengl_resolution', 'Resolução', 'video',
      ['1', '2', '3', '4', '5', '6', '7', '8'],
      '1'),
    sel('melonds_screen_layout', 'Layout Telas', 'video',
      ['Top/Bottom', 'Bottom/Top', 'Left/Right', 'Right/Left', 'Top Only', 'Bottom Only', 'Hybrid Top', 'Hybrid Bottom'],
      'Top/Bottom'),
    sel('melonds_hybrid_ratio', 'Razão Hybrid', 'video',
      ['2', '3'],
      '2'),
    sel('melonds_screen_gap', 'Gap entre Telas', 'video',
      ['0', '1', '2', '8', '16', '24', '32', '48', '64', '90', '128'],
      '0'),
    sel('melonds_opengl_filtering', 'Filtro', 'video',
      ['nearest', 'linear'],
      'nearest'),
    sel('melonds_renderer', 'Renderer', 'video',
      ['software', 'OpenGL'],
      'OpenGL'),
    sel('melonds_threaded_renderer', 'Renderer Threaded', 'performance',
      ['enabled', 'disabled'],
      'enabled'),
    sel('melonds_jit_enable', 'JIT', 'performance',
      ['enabled', 'disabled'],
      'enabled'),
    sel('melonds_console_mode', 'Modo Console', 'sistema',
      ['DS', 'DSi'],
      'DS'),
    sel('melonds_language', 'Idioma', 'sistema',
      ['Portuguese', 'English', 'Japanese', 'Spanish', 'French', 'German', 'Italian'],
      'Portuguese'),
  ],

  // ===== GBA (mGBA) =====
  gba: [
    sel('mgba_frameskip', 'Frame Skip', 'performance',
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
      '0'),
    sel('mgba_solar_sensor_level', 'Sensor Solar (Boktai)', 'sistema',
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      '0'),
    sel('mgba_color_correction', 'Correção de Cor (LCD GBA)', 'video',
      ['OFF', 'GBA', 'GBC'],
      'OFF'),
    sel('mgba_interframe_blending', 'Inter-frame Blending', 'video',
      ['OFF', 'Simple', 'Smart', 'LCD Ghosting'],
      'OFF'),
    sel('mgba_idle_optimization', 'Otimização Idle', 'performance',
      ['Remove Known', 'Detect and Remove', 'Don\'t Remove'],
      'Remove Known'),
    sel('mgba_skip_bios', 'Pular BIOS', 'sistema',
      ['ON', 'OFF'],
      'ON'),
  ],

  // ===== Saturn (mednafen_saturn) =====
  saturn: [
    sel('beetle_saturn_resolution_mode', 'Resolução', 'video',
      ['original', '480p', '720p', '1080p', 'self-adjusting'],
      'self-adjusting'),
    sel('beetle_saturn_region', 'Região', 'sistema',
      ['Auto Detect', 'Japan', 'North America', 'Europe', 'South Korea', 'Asia (NTSC)', 'Asia (PAL)', 'Brazil', 'Latin America'],
      'Auto Detect'),
    sel('beetle_saturn_cdimagecache', 'Cache do CD', 'performance',
      ['disabled', 'enabled'],
      'disabled'),
  ],

  // ===== SNES (snes9x) =====
  snes: [
    sel('snes9x_aspect', 'Aspect Ratio', 'video',
      ['auto', '4:3', 'uncorrected', 'ntsc', 'pal', 'square'],
      'auto'),
    sel('snes9x_region', 'Região', 'sistema',
      ['auto', 'ntsc', 'pal'],
      'auto'),
    sel('snes9x_overscan', 'Overscan', 'video',
      ['auto', 'enabled', 'disabled'],
      'auto'),
    sel('snes9x_audio_interpolation', 'Interpolação Áudio', 'audio',
      ['gaussian', 'cubic', 'sinc', 'none', 'linear'],
      'gaussian'),
    sel('snes9x_reduce_sprite_flicker', 'Reduzir Flicker Sprite', 'video',
      ['disabled', 'enabled'],
      'disabled'),
  ],

  // ===== NES (Nestopia) =====
  nes: [
    sel('nestopia_aspect', 'Aspect Ratio', 'video',
      ['auto', 'ntsc', 'pal', '4:3', 'uncorrected'],
      'auto'),
    sel('nestopia_palette', 'Paleta', 'video',
      ['cxa2025as', 'consumer', 'canonical', 'alternative', 'rgb', 'pal', 'composite-direct-fbx', 'pvm-style-d93-fbx', 'ntsc-hardware-fbx', 'nes-classic-fbx', 'wavebeam'],
      'consumer'),
    sel('nestopia_blargg_ntsc_filter', 'Filtro NTSC', 'video',
      ['disabled', 'composite', 'svideo', 'rgb', 'monochrome'],
      'disabled'),
    sel('nestopia_nospritelimit', 'Sem Limite Sprite', 'video',
      ['enabled', 'disabled'],
      'enabled'),
  ],

  // ===== GB/GBC (Gambatte) — compartilham =====
  gb: [
    sel('gambatte_gb_colorization', 'Colorização (GB)', 'video',
      ['auto', 'GBC', 'SGB', 'internal', 'custom', 'disabled'],
      'auto'),
    sel('gambatte_gb_internal_palette', 'Paleta Interna', 'video',
      ['GB - DMG', 'GB - Pocket', 'GB - Light', 'GBC - Blue', 'GBC - Brown', 'GBC - Dark Blue', 'GBC - Dark Brown', 'GBC - Dark Green', 'GBC - Grayscale', 'GBC - Green', 'GBC - Inverted', 'GBC - Orange', 'GBC - Pastel Mix', 'GBC - Red', 'GBC - Yellow'],
      'GB - DMG'),
    sel('gambatte_audio_resampler', 'Resampler Áudio', 'audio',
      ['sinc', 'cc'],
      'sinc'),
    sel('gambatte_mix_frames', 'Mix Frames (LCD ghosting)', 'video',
      ['disabled', 'accurate', 'fast'],
      'disabled'),
    sel('gambatte_dark_filter_level', 'Filtro Escuro', 'video',
      ['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50'],
      '0'),
  ],

  // ===== Mega Drive / Genesis (genesis_plus_gx) =====
  md: [
    sel('genesis_plus_gx_aspect_ratio', 'Aspect Ratio', 'video',
      ['auto', 'NTSC PAR', 'PAL PAR', '4:3', '16:9', 'Uncorrected'],
      'auto'),
    sel('genesis_plus_gx_overscan', 'Overscan', 'video',
      ['disabled', 'top/bottom', 'left/right', 'full'],
      'disabled'),
    sel('genesis_plus_gx_blargg_ntsc_filter', 'Filtro NTSC', 'video',
      ['disabled', 'monochrome', 'composite', 'svideo', 'rgb'],
      'disabled'),
    sel('genesis_plus_gx_region_detect', 'Região', 'sistema',
      ['auto', 'ntsc-u', 'pal', 'ntsc-j'],
      'auto'),
    sel('genesis_plus_gx_render', 'Render', 'performance',
      ['single field', 'double field'],
      'single field'),
  ],
};

// gambatte_gb_colorization tb pra gbc
SYSTEM_OPTIONS.gbc = SYSTEM_OPTIONS.gb;
SYSTEM_OPTIONS.gc = SYSTEM_OPTIONS.wii; // gc reusa Dolphin
SYSTEM_OPTIONS.sms = SYSTEM_OPTIONS.md;
SYSTEM_OPTIONS.gg = SYSTEM_OPTIONS.md;
SYSTEM_OPTIONS.segacd = SYSTEM_OPTIONS.md;

// ===== v0.9.1: opcoes do FRONTEND (Ludex), nao do core libretro =====
// Aplicadas no LudexEmulatorView (audio gain, deadzone analogica, rewind,
// fast-forward speed). Chave comeca com 'ludex_' pra nao colidir com cores.
// Persistidas no mesmo localStorage por sistema. Atualizam em tempo real.
const FRONTEND_OPTIONS = [
  sel('ludex_audio_volume', 'Volume Áudio', 'audio',
    ['0% (mudo)', '25%', '50%', '75%', '100% (normal)', '125%', '150%', '200% (amplificado)'],
    '100% (normal)'),
  sel('ludex_audio_low_latency', 'Modo Baixa Latência', 'audio',
    ['enabled', 'disabled'],
    'enabled'),
  sel('ludex_stick_deadzone', 'Deadzone Analógico', 'input',
    ['0%', '5%', '10%', '15%', '20%', '25%', '30%'],
    '15%'),
  sel('ludex_pad_vibration', 'Vibração do Controle', 'input',
    ['enabled', 'disabled'],
    'enabled'),
  sel('ludex_rewind', 'Rewind (voltar no tempo)', 'sistema',
    ['disabled', 'enabled'],
    'disabled'),
  sel('ludex_rewind_buffer_mb', 'Buffer Rewind (RAM)', 'sistema',
    ['16 MB (~10s)', '32 MB (~20s)', '64 MB (~40s)', '128 MB (~80s)', '256 MB (~160s)'],
    '64 MB (~40s)'),
  sel('ludex_fast_forward_speed', 'Velocidade Fast-Forward', 'performance',
    ['2x', '3x', '4x', '5x', '8x', '10x', 'sem limite'],
    '4x'),
  sel('ludex_auto_save_state_on_exit', 'Auto Save State ao Sair', 'sistema',
    ['enabled', 'disabled'],
    'enabled'),
  sel('ludex_pixel_filter', 'Filtro Visual', 'video',
    ['none', 'CRT Scanlines (sutil)', 'CRT Scanlines (forte)', 'LCD Grid', 'Nearest Pixels (chunky)', 'Smooth (bilinear)'],
    'none'),
  sel('ludex_show_fps', 'Mostrar FPS', 'video',
    ['disabled', 'enabled'],
    'disabled'),
];

// Adiciona FRONTEND_OPTIONS no fim de cada sistema (preserva opcoes especificas do core)
for (const sysId of Object.keys(SYSTEM_OPTIONS)) {
  SYSTEM_OPTIONS[sysId] = [...SYSTEM_OPTIONS[sysId], ...FRONTEND_OPTIONS];
}

// Lista de opcoes que NAO precisam de reload (frontend) — UI usa pra esconder badge
export const HOT_RELOAD_KEYS = new Set([
  ...FRONTEND_OPTIONS.map(o => o.key),
  // Opcoes do core que aceitam hot-reload via GET_VARIABLE_UPDATE
  // (cores modernos suportam todos, mas algumas mudancas de renderer
  // requerem rebuild do contexto)
]);

// Opcoes que SAO de frontend (nao manda pro core via libretro_set_option)
export const FRONTEND_OPTION_KEYS = new Set(FRONTEND_OPTIONS.map(o => o.key));

// ===== Helpers de persistencia + apply =====

const STORAGE_PREFIX = 'ludex.options.';

export function loadSystemOptions(systemId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + systemId);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveSystemOptions(systemId, values) {
  try {
    localStorage.setItem(STORAGE_PREFIX + systemId, JSON.stringify(values));
  } catch {}
}

export function clearSystemOptions(systemId) {
  try { localStorage.removeItem(STORAGE_PREFIX + systemId); } catch {}
}

// Aplica todas opcoes salvas de um sistema (chamado antes de load_game).
// v0.9.1: skip opcoes frontend-only (ludex_*) — essas sao lidas pelo EmulatorView
// diretamente do localStorage, nao mandam pro core libretro.
export async function applySystemOptions(systemId) {
  const values = loadSystemOptions(systemId);
  for (const [key, value] of Object.entries(values)) {
    if (FRONTEND_OPTION_KEYS && FRONTEND_OPTION_KEYS.has(key)) continue;
    try { await invoke('libretro_set_option', { key, value }); } catch {}
  }
}

// v0.9.1: helper pra LudexEmulatorView ler config frontend efetiva.
// Retorna {audioGain, deadzone, rewindEnabled, rewindBufferMb, ffSpeed, autoSaveOnExit, pixelFilter, showFps}
// com fallback pros defaults se nao houver salvo.
export function getFrontendConfig(systemId) {
  const values = loadSystemOptions(systemId);
  const parsePercent = (v, def) => {
    if (!v) return def;
    const m = String(v).match(/(\d+)%/);
    return m ? parseInt(m[1]) / 100 : def;
  };
  const parseInt0 = (v, def) => {
    if (!v) return def;
    const m = String(v).match(/(\d+)/);
    return m ? parseInt(m[1]) : def;
  };
  return {
    audioGain:        parsePercent(values.ludex_audio_volume, 1.0),
    lowLatencyAudio:  values.ludex_audio_low_latency !== 'disabled',
    deadzone:         parsePercent(values.ludex_stick_deadzone, 0.15),
    vibration:        values.ludex_pad_vibration !== 'disabled',
    rewindEnabled:    values.ludex_rewind === 'enabled',
    rewindBufferMb:   parseInt0(values.ludex_rewind_buffer_mb, 64),
    ffSpeed:          values.ludex_fast_forward_speed === 'sem limite' ? 99 : parseInt0(values.ludex_fast_forward_speed, 4),
    autoSaveOnExit:   (values.ludex_auto_save_state_on_exit ?? 'enabled') === 'enabled',
    pixelFilter:      values.ludex_pixel_filter || 'none',
    showFps:          values.ludex_show_fps === 'enabled',
  };
}

// Aplica opcoes de TODOS sistemas (chamado no boot)
export async function applyAllSavedOptions() {
  for (const systemId of Object.keys(SYSTEM_OPTIONS)) {
    await applySystemOptions(systemId);
  }
}

// Conveniente pra dropdown UI
export function getOptionsForSystem(systemId) {
  return SYSTEM_OPTIONS[systemId] || null;
}

export function hasOptionsForSystem(systemId) {
  return Array.isArray(SYSTEM_OPTIONS[systemId]) && SYSTEM_OPTIONS[systemId].length > 0;
}

// ===== v0.8.42: Controller Remap =====
// padIdx (W3C standard gamepad) -> libretroId (RETRO_DEVICE_ID_JOYPAD_*)
// Libretro convention:
//   0=B, 1=Y, 2=SELECT, 3=START, 4=UP, 5=DOWN, 6=LEFT, 7=RIGHT,
//   8=A, 9=X, 10=L, 11=R, 12=L2, 13=R2, 14=L3, 15=R3
// Default = layout SNES (B sul, A leste, Y oeste, X norte) — convencao libretro
export const DEFAULT_PAD_MAP = {
  0: 0,    // Pad sul (A Xbox / X PS / B Switch) -> libretro B
  1: 8,    // Pad leste (B Xbox / O PS / A Switch) -> libretro A
  2: 1,    // Pad oeste (X Xbox / □ PS / Y Switch) -> libretro Y
  3: 9,    // Pad norte (Y Xbox / △ PS / X Switch) -> libretro X
  4: 10,   // L1/LB -> L
  5: 11,   // R1/RB -> R
  6: 12,   // L2/LT/ZL -> L2
  7: 13,   // R2/RT/ZR -> R2
  8: 2,    // Select/Back -> SELECT
  9: 3,    // Start -> START
  10: 14,  // L3 -> L3
  11: 15,  // R3 -> R3
  12: 4,   // D-pad Up -> UP
  13: 5,   // D-pad Down -> DOWN
  14: 6,   // D-pad Left -> LEFT
  15: 7,   // D-pad Right -> RIGHT
};

// Libretro buttons que user pode remapear. v0.8.45: D-pad incluido tb.
export const LIBRETRO_BUTTONS = [
  { id: 0,  label: 'B', hint: 'Sul (baixo)' },
  { id: 8,  label: 'A', hint: 'Leste (direita)' },
  { id: 1,  label: 'Y', hint: 'Oeste (esquerda)' },
  { id: 9,  label: 'X', hint: 'Norte (cima)' },
  { id: 10, label: 'L1', hint: 'Ombro esquerdo' },
  { id: 11, label: 'R1', hint: 'Ombro direito' },
  { id: 12, label: 'L2', hint: 'Gatilho esquerdo' },
  { id: 13, label: 'R2', hint: 'Gatilho direito' },
  { id: 14, label: 'L3', hint: 'Click stick esquerdo' },
  { id: 15, label: 'R3', hint: 'Click stick direito' },
  { id: 3,  label: 'Start' },
  { id: 2,  label: 'Select' },
  { id: 4,  label: 'D-pad ↑', hint: 'Cima' },
  { id: 5,  label: 'D-pad ↓', hint: 'Baixo' },
  { id: 6,  label: 'D-pad ←', hint: 'Esquerda' },
  { id: 7,  label: 'D-pad →', hint: 'Direita' },
];

const PAD_STORAGE_PREFIX = 'ludex.padmap.';

export function loadPadMap(systemId) {
  try {
    const raw = localStorage.getItem(PAD_STORAGE_PREFIX + systemId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function savePadMap(systemId, map) {
  try { localStorage.setItem(PAD_STORAGE_PREFIX + systemId, JSON.stringify(map)); } catch {}
}

export function clearPadMap(systemId) {
  try { localStorage.removeItem(PAD_STORAGE_PREFIX + systemId); } catch {}
}

// Retorna mapa efetivo: salvo do user OU default. Sempre tem todas 16 entradas.
export function effectivePadMap(systemId) {
  const saved = loadPadMap(systemId);
  if (saved && typeof saved === 'object') {
    return { ...DEFAULT_PAD_MAP, ...saved };
  }
  return { ...DEFAULT_PAD_MAP };
}

// Inverte: dado libretroId, retorna padIdx que mapeia pra ele
export function padIdxForLibretroBtn(map, libretroId) {
  for (const [padIdx, libId] of Object.entries(map)) {
    if (libId === libretroId) return parseInt(padIdx);
  }
  return null;
}

// Atualiza mapa: padIdx -> libretroId. Se outro padIdx ja mapeia esse libretroId,
// troca os dois (swap) pra nao ter botoes sem funcao.
export function remapPadButton(systemId, padIdx, libretroId) {
  const map = effectivePadMap(systemId);
  // Acha outro padIdx que mapeia esse libretroId atualmente
  const conflict = padIdxForLibretroBtn(map, libretroId);
  const oldLibForThisPad = map[padIdx];
  if (conflict != null && conflict !== padIdx) {
    map[conflict] = oldLibForThisPad; // swap
  }
  map[padIdx] = libretroId;
  savePadMap(systemId, map);
  return map;
}

// Nomes amigáveis pra padIdx (W3C standard) — usado em "press to remap"
export function padIdxLabel(idx, mappingStyle = 'xbox') {
  const FACES = {
    xbox:    { 0: 'A', 1: 'B', 2: 'X', 3: 'Y' },
    ps:      { 0: '×', 1: '○', 2: '□', 3: '△' },
    switch:  { 0: 'B', 1: 'A', 2: 'Y', 3: 'X' },
    generic: { 0: '0', 1: '1', 2: '2', 3: '3' },
  };
  const set = FACES[mappingStyle] || FACES.generic;
  const names = {
    0: set[0], 1: set[1], 2: set[2], 3: set[3],
    4: 'L1/LB', 5: 'R1/RB', 6: 'L2/LT', 7: 'R2/RT',
    8: 'Select', 9: 'Start',
    10: 'L3', 11: 'R3',
    12: 'D-Cima', 13: 'D-Baixo', 14: 'D-Esq', 15: 'D-Dir',
  };
  return names[idx] != null ? names[idx] : `btn${idx}`;
}
