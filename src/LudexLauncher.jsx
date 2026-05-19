import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./LudexLauncher.css";
import LudexOnboarding, { DEFAULT_AVATARS, avatarUrl, getProfileAvatarUrl } from "./LudexOnboarding";
import LudexLicenseGate from "./LudexLicenseGate";
import LudexAdminPanel from "./LudexAdminPanel";
import {
  EmptyStateSystem, SuggestionsModal, ControlsTipModal,
  SystemSettingsModal,
  FolderIcon as LxFolderIcon,
  GiftIcon as LxGiftIcon,
  ToolsIcon as LxToolsIcon,
  GlobeIcon as LxGlobeIcon,
  GamepadIcon as LxGamepadIcon,
} from "./LudexExtras";
import {
  SYSTEM_OPTIONS, getOptionsForSystem, hasOptionsForSystem,
  loadSystemOptions, saveSystemOptions, clearSystemOptions,
  applySystemOptions, applyAllSavedOptions,
  effectivePadMap,
} from "./ludexSystemOptions";
import {
  GearIcon, CloseIcon, PowerIcon, FullscreenIcon, RefreshIcon, PlusIcon,
  TrashIcon, EditIcon, RotateIcon, UserIcon, SearchIcon, StarIcon, PlayIcon,
  FolderIcon, InfoIcon, SpeakerIcon, SpeakerMuteIcon, CheckIcon, ShieldIcon,
  SortIcon, ImageIcon, GamepadIcon, SystemIcon,
} from "./ludexIcons";
// v0.8.51: EmulatorView + ResumePromptModal extraidos pra arquivo proprio (~680L removidas)
import { EmulatorView, ResumePromptModal } from "./LudexEmulatorView";
// v0.8.51 + v0.9.0: helpers compartilhados (antes locais aqui)
import {
  invokeTimeout, validRomExtension, formatPlayTime,
  GAME_STATUS_LABELS, GAME_STATUS_ORDER, GAME_STATUS_EMOJI,
} from "./ludexUtils";
// v0.9.0: SearchOverlay extraido pra arquivo proprio (~194L removidas)
import SearchOverlay from "./LudexSearchOverlay";
// v0.9.0: GameDetailPanel extraido pra arquivo proprio (~222L removidas)
import GameDetailPanel from "./LudexGameDetailPanel";
// v0.9.0: SettingsPanel extraido pra arquivo proprio (~636L removidas).
// sfx/ambientMusic/THEMES/etc + sub-componentes ainda vivem aqui e sao
// passados via props pra evitar duplicar codigo e impedir import circular.
import SettingsPanel from "./LudexSettingsPanel";

// === Captura global de erros JS -> log do Rust ===
// Garante que crashes do frontend chegam ao arquivo de log lido pelo LogsViewerModal.
let __frontendLogInstalled = false;
function installFrontendLogCapture() {
  if (__frontendLogInstalled) return;
  __frontendLogInstalled = true;
  const send = (level, message) => {
    try { invoke("frontend_log", { level, message: String(message).slice(0, 4000) }); } catch {}
  };
  window.addEventListener("error", (e) => {
    const msg = e?.error?.stack || e?.message || String(e);
    send("error", `[window.error] ${msg}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e?.reason;
    const msg = (r && (r.stack || r.message)) || String(r);
    send("error", `[unhandledrejection] ${msg}`);
  });
  const origErr = console.error.bind(console);
  console.error = (...args) => {
    try { send("error", args.map((a) => (a && a.stack) ? a.stack : (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); } catch {}
    origErr(...args);
  };
  const origWarn = console.warn.bind(console);
  console.warn = (...args) => {
    try { send("warn", args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); } catch {}
    origWarn(...args);
  };
}
installFrontendLogCapture();

async function pickImageFile() {
  try {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Imagem", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    return typeof selected === "string" ? selected : null;
  } catch (e) {
    console.error("dialog open", e);
    return null;
  }
}

const MODAL_EXIT_MS = 220;

// Detecta se rodando em Android (APK) — usado pra desativar features desktop-only
// (license gate, OSK auto-open, etc) e ativar layout portrait.
const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");
const IS_MOBILE = IS_ANDROID || (typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || ""));

// Categorias pros sistemas — agrupa por fabricante/familia.
// Cada sistema vai em UMA categoria. Switch + handhelds Nintendo continuam em Nintendo.
// icon: id pra CategoryIcon component renderizar SVG (sem emojis, regra Paulo).
const SYSTEM_CATEGORIES = [
  { id: "all",       name: "TODOS",       systems: null /* = mostra tudo */ },
  { id: "nintendo",  name: "NINTENDO",    systems: ["switch","wiiu","3ds","wii","gc","n64","gba","ds","gb","gbc","snes","nes","vb"] },
  { id: "sony",      name: "SONY",        systems: ["ps3","ps4","ps2","ps1","psp","vita"] },
  { id: "sega",      name: "SEGA",        systems: ["dreamcast","saturn","md","sms","gg","segacd"] },
  { id: "microsoft", name: "MICROSOFT",   systems: ["xbox","xbox360"] },
  { id: "atari",     name: "ATARI",       systems: ["a2600","lynx","jaguar"] },
  { id: "arcade",    name: "ARCADE",      systems: ["arcade"] },
  { id: "handheld",  name: "PORTATEIS",   systems: ["ws","ngpc"] },
  { id: "outros",    name: "OUTROS",      systems: ["tg16","threedo","msx","c64","zx","amiga","retro"] },
];

function CategoryIcon({ id }) {
  const f = "currentColor";
  switch (id) {
    case "all":
      // Grade 2x2 = "todos os sistemas"
      return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>);
    case "nintendo":
      return (<svg viewBox="0 0 24 24" aria-hidden><text x="12" y="18" textAnchor="middle" fill={f} fontSize="16" fontWeight="900" fontFamily="system-ui">N</text></svg>);
    case "sony":
      return (<svg viewBox="0 0 24 24" aria-hidden><text x="12" y="17" textAnchor="middle" fill={f} fontSize="11" fontWeight="900" fontStyle="italic" fontFamily="Impact, system-ui">PS</text></svg>);
    case "sega":
      return (<svg viewBox="0 0 24 24" aria-hidden><text x="12" y="18" textAnchor="middle" fill={f} fontSize="16" fontWeight="900" fontFamily="system-ui">S</text></svg>);
    case "microsoft":
      // X estilizado (Xbox)
      return (<svg viewBox="0 0 24 24" fill="none" stroke={f} strokeWidth="3" strokeLinecap="round" aria-hidden><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>);
    case "atari":
      return (<svg viewBox="0 0 24 24" aria-hidden><text x="12" y="18" textAnchor="middle" fill={f} fontSize="16" fontWeight="900" fontFamily="system-ui">A</text></svg>);
    case "arcade":
      // Joystick (representa arcade)
      return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="8" y="14" width="8" height="3" rx="1" /><rect x="11" y="6" width="2" height="9" /><circle cx="12" cy="6" r="2.5" /><rect x="6" y="17" width="12" height="2" rx="1" opacity="0.5" /></svg>);
    case "handheld":
      // Console portatil (silhueta simples)
      return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="6" y="3" width="12" height="18" rx="2.5" /><rect x="8.5" y="5.5" width="7" height="6" rx="0.5" fill="#1c1c1c" /><circle cx="10" cy="16" r="1" fill="#1c1c1c" /><circle cx="14" cy="16" r="1" fill="#1c1c1c" /><circle cx="10" cy="19" r="1" fill="#1c1c1c" /><circle cx="14" cy="19" r="1" fill="#1c1c1c" /></svg>);
    case "outros":
      // Plus stylized
      return (<svg viewBox="0 0 24 24" fill="none" stroke={f} strokeWidth="3" strokeLinecap="round" aria-hidden><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
    default: return null;
  }
}

function systemMatchesCategory(systemId, categoryId) {
  if (categoryId === "all") return true;
  const cat = SYSTEM_CATEGORIES.find(c => c.id === categoryId);
  if (!cat || !cat.systems) return true;
  return cat.systems.includes(systemId);
}

const THEMES = [
  {
    id: "switch-dark",
    name: "Switch Dark",
    swatch: ["#161616", "#2a2a2a", "#fff"],
    vars: { "--theme-bg": "#161616", "--theme-surface": "#1a1a1a", "--theme-card": "#2a2a2a", "--theme-text": "#fff", "--theme-muted": "#888", "--theme-border": "#2a2a2a" },
  },
  {
    id: "ps3-wave",
    name: "PS3 Wave",
    swatch: ["#001a3a", "#1d4ed8", "#ffd700"],
    vars: { "--theme-bg": "#021232", "--theme-surface": "#0a1f4a", "--theme-card": "#0e2a5a", "--theme-text": "#e8f1ff", "--theme-muted": "#7d9bc4", "--theme-border": "#0e2a5a" },
  },
  {
    id: "sunset",
    name: "Sunset",
    swatch: ["#2a0a1a", "#ff6b35", "#fcd34d"],
    vars: { "--theme-bg": "#1a0a14", "--theme-surface": "#2a1424", "--theme-card": "#3a1830", "--theme-text": "#fff8f0", "--theme-muted": "#c9a8b8", "--theme-border": "#3a1830" },
  },
  {
    id: "forest",
    name: "Forest",
    swatch: ["#0a1a0a", "#22c55e", "#86efac"],
    vars: { "--theme-bg": "#0a1612", "--theme-surface": "#142822", "--theme-card": "#1a3a30", "--theme-text": "#e8fff2", "--theme-muted": "#9bc4a8", "--theme-border": "#1a3a30" },
  },
  {
    id: "pure-light",
    name: "Pure Light",
    swatch: ["#f5f5f5", "#3b82f6", "#1f2937"],
    vars: { "--theme-bg": "#ededed", "--theme-surface": "#fafafa", "--theme-card": "#fff", "--theme-text": "#1a1a1a", "--theme-muted": "#666", "--theme-border": "#d4d4d4" },
  },
];

const DEFAULT_CUSTOM_THEME = {
  bg: "#1a0a2a", surface: "#2a1a3a", card: "#3a2a4a",
  text: "#ffffff", muted: "#a89bb8", border: "#3a2a4a",
};

function customThemeVars(t) {
  return {
    "--theme-bg": t.bg, "--theme-surface": t.surface, "--theme-card": t.card,
    "--theme-text": t.text, "--theme-muted": t.muted, "--theme-border": t.border,
  };
}

function useClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// v0.8.51: invokeTimeout + validRomExtension + ALLOWED_ROM_EXTS movidos pra ludexUtils.js

// ---------- Web Audio: sons procedurais ----------
let _audioCtx = null;
function audioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  // Browser autoplay policy: contexto pode estar "suspended" até primeira interação
  if (_audioCtx && _audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

function unlockAudio() {
  // Garante que o contexto está rodando — chamar em qualquer user gesture
  const ctx = audioCtx();
  if (ctx && ctx.state !== "running") {
    ctx.resume().catch(() => {});
  }
}

function playTone(freq, duration, type = "sine", volume = 0.05, when = 0) {
  const ctx = audioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const start = ctx.currentTime + when;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    gain.gain.exponentialRampToValueAtTime(0.0005, start + duration);
    osc.stop(start + duration + 0.02);
  } catch {}
}

// Toca uma nota com vibrato leve (mais "musical" que tom puro)
function playNote(freq, duration, volume = 0.06, when = 0) {
  const ctx = audioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const gain = ctx.createGain();
    const subGain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    sub.type = "sine";
    sub.frequency.value = freq * 2; // harmônico
    subGain.gain.value = volume * 0.25;
    const start = ctx.currentTime + when;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0005, start + duration);
    osc.connect(gain);
    sub.connect(subGain);
    subGain.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start); sub.start(start);
    osc.stop(start + duration + 0.05);
    sub.stop(start + duration + 0.05);
  } catch {}
}

const sfx = {
  nav: () => playTone(520, 0.04, "sine", 0.035),
  switchSys: () => playTone(380, 0.06, "sine", 0.04),
  confirm: () => { playTone(660, 0.06, "triangle", 0.05); setTimeout(() => playTone(880, 0.08, "triangle", 0.05), 50); },
  back: () => playTone(220, 0.08, "sine", 0.04),
  fav: () => { playTone(700, 0.05, "triangle", 0.05); setTimeout(() => playTone(1100, 0.08, "triangle", 0.05), 60); },
  click: () => playTone(880, 0.025, "square", 0.025),
  toggle: () => { playTone(440, 0.03, "triangle", 0.04); setTimeout(() => playTone(660, 0.04, "triangle", 0.04), 30); },
  open: () => { playTone(330, 0.05, "sine", 0.04); setTimeout(() => playTone(495, 0.07, "sine", 0.04), 40); },
  achievement: () => {
    playTone(523, 0.1, "triangle", 0.06);
    setTimeout(() => playTone(659, 0.1, "triangle", 0.06), 90);
    setTimeout(() => playTone(784, 0.18, "triangle", 0.06), 180);
  },
  // Intro melódica — arpejo ascendente C major + acorde final (~1.4s)
  intro: () => {
    unlockAudio();
    // Arpejo: C5 E5 G5 C6
    playNote(523.25, 0.18, 0.07, 0.00);   // C5
    playNote(659.25, 0.18, 0.07, 0.12);   // E5
    playNote(783.99, 0.18, 0.07, 0.24);   // G5
    playNote(1046.50, 0.45, 0.08, 0.36);  // C6 (sustain)
    // Acorde final empilhado em cima
    playNote(523.25, 0.55, 0.05, 0.36);
    playNote(659.25, 0.55, 0.05, 0.36);
    playNote(783.99, 0.55, 0.05, 0.36);
    // Brilho — quinta acima no fim
    playNote(1318.51, 0.30, 0.04, 0.55);  // E6
  },
  // Shutdown CRT: queda ~600ms + thump de descarga eletrica no fim
  shutdown: () => {
    // varredura descendente (tubo se descarregando)
    playTone(880, 0.08, "sine",    0.05, 0.00);
    playTone(523, 0.10, "sine",    0.06, 0.05);
    playTone(330, 0.12, "sine",    0.06, 0.13);
    playTone(220, 0.14, "sine",    0.06, 0.22);
    // pop seco no momento do colapso pra linha (~350ms = 45% da animacao)
    playTone(80,  0.06, "square",  0.10, 0.36);
    // zumbido grave do CRT residual (afterglow)
    playTone(60,  0.30, "triangle", 0.05, 0.45);
    // tick final do ponto sumindo
    playTone(2400, 0.04, "square", 0.04, 0.78);
  },
};

// Jingles por plataforma — 2-3 notas curtas (~250-400ms cada)
const PLATFORM_JINGLES = {
  switch:     () => { playNote(659.25, 0.12, 0.06); playNote(987.77, 0.22, 0.06, 0.10); }, // E-B (Switch click)
  snes:       () => { playNote(523.25, 0.10, 0.05); playNote(659.25, 0.10, 0.05, 0.08); playNote(783.99, 0.10, 0.05, 0.16); playNote(1046.50, 0.20, 0.06, 0.24); }, // arpejo C-E-G-C (Mario chime)
  wiiu:       () => { playNote(440.00, 0.10, 0.05); playNote(554.37, 0.10, 0.05, 0.08); playNote(659.25, 0.20, 0.06, 0.16); }, // A-C#-E
  wii:        () => { playNote(880.00, 0.10, 0.05); playNote(587.33, 0.20, 0.06, 0.10); }, // A-D (Wii Remote chime)
  gc:         () => { playNote(523.25, 0.08, 0.05); playNote(659.25, 0.08, 0.05, 0.08); playNote(783.99, 0.18, 0.06, 0.16); }, // C-E-G
  n64:        () => { playNote(739.99, 0.08, 0.05); playNote(523.25, 0.08, 0.05, 0.08); playNote(415.30, 0.20, 0.06, 0.16); }, // F#-C-G# (N64 startup vibe)
  gba:        () => { playTone(987.77, 0.08, "square", 0.04, 0.00); playTone(1318.51, 0.18, "square", 0.04, 0.08); }, // chiptune
  ps3:        () => { playNote(329.63, 0.10, 0.05); playNote(440.00, 0.10, 0.05, 0.10); playNote(587.33, 0.22, 0.06, 0.20); }, // E-A-D (PS3 wave)
  ps2:        () => { playNote(196.00, 0.20, 0.07); playNote(293.66, 0.25, 0.05, 0.08); }, // G-D (PS2 brap baixo)
  ps1:        () => { playNote(174.61, 0.28, 0.07); playNote(220.00, 0.28, 0.05, 0.04); playNote(261.63, 0.28, 0.05, 0.08); }, // F-A-C (PS1 chord)
  ps4:        () => { playNote(246.94, 0.10, 0.05); playNote(329.63, 0.10, 0.05, 0.08); playNote(493.88, 0.22, 0.06, 0.16); }, // B-E-B
  xbox:       () => { playTone(329.63, 0.20, "sine", 0.06, 0.00); playTone(246.94, 0.28, "sine", 0.05, 0.12); }, // E-B (Xbox sphere)
  nes:        () => { playTone(659.25, 0.06, "square", 0.05, 0.00); playTone(523.25, 0.06, "square", 0.05, 0.06); playTone(659.25, 0.16, "square", 0.05, 0.12); }, // E-C-E (Mario lite)
  gb:         () => { playTone(587.33, 0.10, "square", 0.04, 0.00); playTone(880.00, 0.18, "square", 0.04, 0.10); }, // D-A (boot beep)
  gbc:        () => { playTone(587.33, 0.08, "square", 0.04, 0.00); playTone(880.00, 0.10, "square", 0.04, 0.08); playTone(1108.73, 0.18, "square", 0.04, 0.18); }, // D-A-C# (boot color)
  md:         () => { playTone(440.00, 0.12, "sawtooth", 0.05, 0.00); playTone(330.00, 0.20, "sawtooth", 0.05, 0.12); }, // A-E (Sega-ish)
  retro:      () => { playTone(880, 0.04, "square", 0.04, 0.00); playTone(1318, 0.06, "square", 0.04, 0.04); playTone(1760, 0.12, "square", 0.04, 0.10); }, // arpejo chiptune
  // ===== Novos sistemas v0.7.0 =====
  dreamcast:  () => { playNote(523.25, 0.10, 0.05); playNote(659.25, 0.10, 0.05, 0.08); playNote(739.99, 0.10, 0.05, 0.16); playNote(987.77, 0.22, 0.06, 0.24); }, // C-E-F#-B (DC boot)
  psp:        () => { playNote(392.00, 0.10, 0.05); playNote(523.25, 0.10, 0.05, 0.08); playNote(659.25, 0.22, 0.06, 0.16); }, // G-C-E (PSP startup wave)
  ds:         () => { playTone(880.00, 0.06, "triangle", 0.05, 0.00); playTone(1318.51, 0.06, "triangle", 0.05, 0.06); playTone(1760.00, 0.14, "triangle", 0.05, 0.12); }, // chip duplo (2 telas)
  saturn:     () => { playNote(349.23, 0.12, 0.06); playNote(440.00, 0.12, 0.05, 0.10); playNote(523.25, 0.22, 0.06, 0.20); }, // F-A-C (Sega-ish)
  sms:        () => { playTone(440.00, 0.10, "sawtooth", 0.05, 0.00); playTone(587.33, 0.18, "sawtooth", 0.05, 0.10); }, // A-D (Sega 8-bit)
  gg:         () => { playTone(659.25, 0.08, "square", 0.04, 0.00); playTone(523.25, 0.10, "square", 0.04, 0.08); }, // E-C
  segacd:     () => { playNote(349.23, 0.14, 0.06); playNote(523.25, 0.20, 0.06, 0.12); }, // F-C (CD wave)
  arcade:     () => { playTone(1318.51, 0.04, "square", 0.05, 0.00); playTone(1760.00, 0.04, "square", 0.05, 0.04); playTone(2093.00, 0.10, "square", 0.05, 0.08); }, // arpejo arcade alto
  tg16:       () => { playTone(523.25, 0.10, "square", 0.05, 0.00); playTone(659.25, 0.16, "square", 0.05, 0.10); }, // C-E (PC Engine)
  a2600:      () => { playTone(220.00, 0.18, "square", 0.06, 0.00); playTone(165.00, 0.18, "square", 0.06, 0.10); }, // A-E (Atari low)
  lynx:       () => { playTone(659.25, 0.08, "triangle", 0.05, 0.00); playTone(523.25, 0.10, "triangle", 0.05, 0.08); }, // E-C
  ws:         () => { playTone(440.00, 0.08, "square", 0.04, 0.00); playTone(587.33, 0.10, "square", 0.04, 0.08); }, // A-D (WS beep)
  vb:         () => { playTone(523.25, 0.12, "sawtooth", 0.05, 0.00); playTone(392.00, 0.18, "sawtooth", 0.05, 0.10); }, // C-G (VB red)
  ngpc:       () => { playTone(659.25, 0.06, "triangle", 0.04, 0.00); playTone(880.00, 0.10, "triangle", 0.04, 0.06); }, // E-A
  msx:        () => { playTone(523.25, 0.06, "square", 0.04, 0.00); playTone(659.25, 0.06, "square", 0.04, 0.06); playTone(783.99, 0.10, "square", 0.04, 0.12); }, // C-E-G
  c64:        () => { playTone(261.63, 0.10, "sawtooth", 0.06, 0.00); playTone(196.00, 0.14, "sawtooth", 0.06, 0.10); }, // C-G (SID-ish)
  zx:         () => { playTone(880.00, 0.04, "square", 0.04, 0.00); playTone(1318.51, 0.06, "square", 0.04, 0.04); }, // beep curto Spectrum
  amiga:      () => { playNote(440.00, 0.10, 0.05); playNote(659.25, 0.10, 0.05, 0.08); playNote(880.00, 0.18, 0.06, 0.16); }, // A-E-A
  threedo:    () => { playNote(392.00, 0.12, 0.05); playNote(523.25, 0.12, 0.05, 0.10); playNote(659.25, 0.22, 0.06, 0.20); }, // G-C-E (3DO startup)
  jaguar:     () => { playTone(165.00, 0.20, "sawtooth", 0.07, 0.00); playTone(220.00, 0.20, "sawtooth", 0.05, 0.10); }, // E-A grave (Jaguar growl)
  xbox360:    () => { playTone(329.63, 0.18, "sine", 0.06, 0.00); playTone(246.94, 0.18, "sine", 0.05, 0.10); playTone(196.00, 0.24, "sine", 0.05, 0.18); }, // E-B-G (Xbox 360 startup)
  vita:       () => { playNote(329.63, 0.10, 0.05); playNote(440.00, 0.10, 0.05, 0.08); playNote(523.25, 0.10, 0.05, 0.16); playNote(659.25, 0.20, 0.06, 0.24); }, // E-A-C-E (PS Vita wave)
  _favorites: () => { playNote(880.00, 0.08, 0.05); playNote(1108.73, 0.16, 0.06, 0.06); }, // A-C#
};

function playPlatformJingle(systemId) {
  const fn = PLATFORM_JINGLES[systemId];
  if (fn) fn();
  else sfx.switchSys();
}

// ---------- Música ambiente: playlist MP3 com shuffle + crossfade ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ambientMusic = {
  audio: null,            // HTMLAudioElement atual
  audioListeners: null,   // { onEnded, onError } pra removeEventListener depois
  playlist: [],           // array de file paths
  queue: [],              // ordem shufflada atual
  current: 0,
  targetVolume: 0.3,
  fadeInterval: null,
  fadeOutInterval: null,  // fade-out tem interval separado pra nao colidir com fade-in
  /**
   * Generation counter pra invalidar callbacks pendentes. Cada start()/stop()
   * incrementa. Listeners (ended/error) so disparam _next() se sua geracao
   * ainda for a atual. Resolve race quando user desativa musica e o ended
   * listener dispara depois — bug que fazia musica nova tocar sozinha apos
   * desativar.
   */
  generation: 0,

  async load() {
    try {
      const tracks = await invoke("list_music_tracks");
      this.playlist = Array.isArray(tracks) ? tracks : [];
      this.queue = shuffle(this.playlist);
      this.current = 0;
      return this.playlist.length;
    } catch (e) {
      console.error("list_music_tracks", e);
      return 0;
    }
  },

  start(volume = 0.3) {
    // Hard stop antes (sem fade-out, sem propagar listeners) pra eliminar audio
    // antigo COMPLETAMENTE antes do novo. Evita 2 musicas tocando ao mesmo tempo.
    this.stop({ immediate: true });
    if (!this.playlist.length) return;
    this.targetVolume = Math.max(0, Math.min(1, volume));
    this._playCurrent();
  },

  _playCurrent() {
    if (!this.queue.length) this.queue = shuffle(this.playlist);
    const path = this.queue[this.current % this.queue.length];
    if (!path) return;
    try {
      const url = convertFileSrc(path);
      const audio = new Audio(url);
      audio.volume = 0;
      audio.preload = "auto";
      // Captura geracao atual; listener so age se geracao nao mudou (ou seja,
      // se ninguem chamou stop ou start nesse meio tempo).
      const myGen = ++this.generation;
      const onEnded = () => {
        if (myGen !== this.generation) return; // foi parado, ignora
        if (this.audio !== audio) return;       // outro audio assumiu
        this._next();
      };
      const onError = (e) => {
        if (myGen !== this.generation) return;
        if (this.audio !== audio) return;
        console.error("audio error", e);
        this._next();
      };
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      audio.play().catch((e) => console.error("audio play", e));
      this.audio = audio;
      this.audioListeners = { onEnded, onError };
      this._fadeTo(this.targetVolume, 1500);
    } catch (e) {
      console.error("play track", e);
    }
  },

  _next() {
    this.current = (this.current + 1) % (this.queue.length || 1);
    if (this.current === 0) this.queue = shuffle(this.playlist);
    this._playCurrent();
  },

  _fadeTo(target, durationMs) {
    if (!this.audio) return;
    if (this.fadeInterval) clearInterval(this.fadeInterval);
    const start = this.audio.volume;
    const startTime = performance.now();
    this.fadeInterval = setInterval(() => {
      if (!this.audio) { clearInterval(this.fadeInterval); return; }
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      this.audio.volume = start + (target - start) * t;
      if (t >= 1) { clearInterval(this.fadeInterval); this.fadeInterval = null; }
    }, 50);
  },

  setVolume(volume) {
    this.targetVolume = Math.max(0, Math.min(1, volume));
    if (this.audio) this._fadeTo(this.targetVolume, 300);
  },

  /**
   * Para a musica.
   * - Sempre incrementa generation (invalida listeners pendentes).
   * - Sempre remove os listeners do audio atual (defensa dupla).
   * - Sempre pause() imediato.
   * - Se opts.immediate=false, faz fade-out visual de 400ms ANTES do null,
   *   mas o audio ja foi efetivamente desligado (sem chance de ended disparar).
   */
  stop(opts = {}) {
    const immediate = !!opts.immediate;
    // Invalida qualquer callback pendente (gen check)
    this.generation++;
    if (this.fadeInterval) { clearInterval(this.fadeInterval); this.fadeInterval = null; }
    if (this.fadeOutInterval) { clearInterval(this.fadeOutInterval); this.fadeOutInterval = null; }
    if (!this.audio) return;
    const a = this.audio;
    const ls = this.audioListeners;
    this.audio = null;
    this.audioListeners = null;
    // Remove listeners DEFINITIVAMENTE — defesa dupla contra ended/error
    if (ls) {
      try { a.removeEventListener("ended", ls.onEnded); } catch {}
      try { a.removeEventListener("error", ls.onError); } catch {}
    }
    if (immediate) {
      try { a.pause(); a.volume = 0; a.src = ""; a.load(); } catch {}
      return;
    }
    // Fade-out cosmetico: audio ja sem listeners, ended/error nao disparam nada
    try {
      const start = a.volume;
      const startTime = performance.now();
      const dur = 400;
      this.fadeOutInterval = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / dur);
        a.volume = start * (1 - t);
        if (t >= 1) {
          clearInterval(this.fadeOutInterval);
          this.fadeOutInterval = null;
          try { a.pause(); a.src = ""; a.load(); } catch {}
        }
      }, 40);
    } catch {}
  },

  skip() {
    // Para o audio atual com cleanup completo, depois toca proxima.
    // Sem isso, o audio antigo poderia continuar tocando 1-2s ate o GC pegar
    // (e listeners ainda ativos disparariam _next em loop infinito).
    this.stop({ immediate: true });
    if (!this.playlist.length) return;
    this._next();
  },

  get isPlaying() { return !!this.audio; },
};

// ---------- Achievements ----------
const ACHIEVEMENTS = [
  { id: "first_launch",   name: "Primeiro Jogo",   desc: "Lancou seu primeiro jogo",      check: (p) => p.total_launches >= 1 },
  { id: "ten_launches",   name: "Aquecendo",       desc: "Lancou 10 jogos",                check: (p) => p.total_launches >= 10 },
  { id: "fifty_launches", name: "Veterano",        desc: "Lancou 50 jogos",                check: (p) => p.total_launches >= 50 },
  { id: "multi_console",  name: "Multi-Console",   desc: "Jogou em 3+ sistemas diferentes", check: (p) => {
      const s = new Set();
      for (const k of Object.keys(p.play_time || {})) s.add(k.includes("::") ? k.split("::")[0] : k);
      return s.size >= 3;
    } },
  { id: "five_systems",   name: "Polimata",        desc: "Jogou em 5+ sistemas diferentes", check: (p) => {
      const s = new Set();
      for (const k of Object.keys(p.play_time || {})) s.add(k.includes("::") ? k.split("::")[0] : k);
      return s.size >= 5;
    } },
  { id: "ten_favorites",  name: "Curador",         desc: "Marcou 10 favoritos",            check: (p) => (p.favorites || []).length >= 10 },
  { id: "marathon",       name: "Maratona",        desc: "Acumulou 1 hora de jogo total",  check: (p) => Object.values(p.play_time || {}).reduce((a, b) => a + b, 0) >= 3600 },
];

// v0.9.0: formatPlayTime movido pra ludexUtils.js
function formatRelativeDays(unixSec) {
  if (!unixSec) return "";
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 3600) return "agora ha pouco";
  if (diff < 86400) return `ha ${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `ha ${Math.floor(diff / 86400)}d`;
  if (diff < 86400 * 30) return `ha ${Math.floor(diff / (86400 * 7))}sem`;
  if (diff < 86400 * 365) return `ha ${Math.floor(diff / (86400 * 30))}m`;
  return `ha ${Math.floor(diff / (86400 * 365))}a`;
}

// v0.8.50: Icones extraidos pra ludexIcons.jsx (230L removidas daqui).
// SystemIcon tambem extraido (era ~100L com switch de 30 sistemas).

function ContinueBanner({ lastPlayed, system, coverSrc, onResume }) {
  return (
    <div className="pb-continue" onClick={onResume}>
      {coverSrc && <img className="pb-continue-cover" src={coverSrc} alt="" aria-hidden />}
      <div className="pb-continue-overlay" />
      <div className="pb-continue-content">
        <div className="pb-continue-label">
          <PlayIcon /> CONTINUAR ONDE PAROU
        </div>
        <div className="pb-continue-title">{lastPlayed.rom_name}</div>
        <div className="pb-continue-system">
          <span className="pb-continue-sys-icon" style={{ color: system?.color }}>
            <SystemIcon id={lastPlayed.system_id} />
          </span>
          {system?.name || lastPlayed.system_id}
        </div>
      </div>
    </div>
  );
}


/**
 * Section "Licença" no Settings. Mostra info da license atual e botoes de
 * gerenciamento (revalidar online + desativar este PC).
 */
function LicenseSettingsSection() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  async function refresh() {
    try {
      const local = await invoke("license_get_local_info");
      setInfo(local);
    } catch (e) {
      setInfo(null);
    }
    // is_admin nao vem do cache local — precisa consultar Gumroad
    try {
      const adm = await invoke("admin_check_status");
      setIsAdmin(!!adm);
    } catch (_) {
      setIsAdmin(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function revalidate() {
    setBusy(true); setMsg(null);
    try {
      const remote = await invoke("license_validate");
      setInfo(remote);
      setMsg({ kind: "ok", text: "Licença revalidada com sucesso" });
    } catch (e) {
      setMsg({ kind: "error", text: String(e) });
    } finally { setBusy(false); }
  }

  async function deactivate() {
    if (!confirm("Desativar este PC libera 1 slot da sua license. Você precisará colar a key de novo se quiser usar o Ludex aqui. Confirmar?")) return;
    setBusy(true); setMsg(null);
    try {
      await invoke("license_deactivate");
      setMsg({ kind: "ok", text: "PC desativado. Recarregando..." });
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      setMsg({ kind: "error", text: String(e) });
    } finally { setBusy(false); }
  }

  if (!info) {
    return (
      <div className="pb-settings-section">
        <h3>Licença</h3>
        <p className="pb-settings-hint">Build de desenvolvimento — sistema de licença desabilitado.</p>
      </div>
    );
  }

  const ageDays = info.validated_at > 0
    ? Math.floor((Date.now() / 1000 - info.validated_at) / 86400)
    : "—";

  return (
    <div className="pb-settings-section">
      <h3>Licença</h3>
      <div className="pb-version-line">
        <span className="pb-version-label">Status:</span>
        <strong style={{ color: info.valid ? "#86efac" : "#fca5a5" }}>
          {info.valid ? "Ativa" : "Expirada"}
        </strong>
      </div>
      <div className="pb-version-line">
        <span className="pb-version-label">PCs ativados:</span>
        <strong>{info.uses} de {info.max_uses}</strong>
      </div>
      <div className="pb-version-line">
        <span className="pb-version-label">Última validação:</span>
        <strong>{ageDays === "—" ? "—" : `há ${ageDays} dias`}</strong>
      </div>
      {info.buyer_email && (
        <div className="pb-version-line">
          <span className="pb-version-label">Comprado por:</span>
          <strong style={{ fontSize: 12 }}>{info.buyer_email}</strong>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="pb-settings-btn" onClick={revalidate} disabled={busy}>
          {busy ? "..." : "Revalidar agora"}
        </button>
        <button
          className="pb-settings-btn pb-settings-btn-danger"
          onClick={deactivate}
          disabled={busy}
        >
          Desativar este PC
        </button>
        {isAdmin && (
          <button
            className="pb-settings-btn"
            style={{ background: "linear-gradient(135deg, #c4b5fd 0%, #ec4899 100%)", color: "#0a0814", fontWeight: 700 }}
            onClick={() => setShowAdmin(true)}
          >
            Painel Admin
          </button>
        )}
      </div>
      {showAdmin && <LudexAdminPanel onClose={() => setShowAdmin(false)} />}
      {msg && (
        <p className="pb-settings-hint" style={{ marginTop: 8, color: msg.kind === "error" ? "#fca5a5" : "#86efac" }}>
          {msg.text}
        </p>
      )}
      <p className="pb-settings-hint" style={{ marginTop: 6 }}>
        License vitalícia, funciona em até {info.max_uses} PCs. Re-validação automática 1x por semana. Modo offline funciona até 30 dias sem internet.
      </p>
    </div>
  );
}

// v0.8.51: parse do id W3C Gamepad em nome amigavel.
// Ex: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02e0)"
//   -> "Xbox Wireless Controller"
function friendlyPadName(id) {
  if (!id) return "Controle";
  // Remove sufixos tipicos do Windows W3C Gamepad
  let s = String(id);
  // Remove "(STANDARD GAMEPAD ...)" / "(Vendor: ... Product: ...)" / "(XInput STANDARD ...)"
  s = s.replace(/\s*\((?:STANDARD\s+GAMEPAD|Vendor:|XInput\s+STANDARD).*$/i, "");
  s = s.trim();
  if (!s) return "Controle";
  // Conhecidos: encurta strings longas
  const lower = s.toLowerCase();
  if (lower.includes("xbox")) return "Xbox Controller";
  if (lower.includes("dualshock") || lower.includes("dualsense")) return "PlayStation Controller";
  if (lower.includes("pro controller") || lower.includes("switch")) return "Switch Pro Controller";
  if (lower.includes("8bitdo")) return "8BitDo Controller";
  return s.length > 40 ? s.slice(0, 38) + "..." : s;
}

// v0.8.51: Toast pra conexao/desconexao de controle. Auto-fecha em 3.5s.
function GamepadStatusToast({ event, onDone }) {
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const t = setTimeout(() => { doneRef.current && doneRef.current(); }, 3500);
    return () => clearTimeout(t);
  }, [event]); // re-arma se chegar event novo
  const connected = event.kind === "connected";
  return (
    <div className={`pb-gamepad-toast ${connected ? "connected" : "disconnected"}`}>
      <div className="pb-gamepad-toast-icon"><GamepadIcon /></div>
      <div className="pb-gamepad-toast-text">
        <div className="pb-gamepad-toast-label">
          {connected ? "CONTROLE CONECTADO" : "CONTROLE DESCONECTADO"}
        </div>
        <div className="pb-gamepad-toast-name">{event.name}</div>
        {!connected && (
          <div className="pb-gamepad-toast-hint">
            Verifique cabo USB ou bateria do Bluetooth
          </div>
        )}
      </div>
    </div>
  );
}

function AchievementToast({ achievement, onDone }) {
  // Capture onDone na ref pra timer disparar uma unica vez na vida do component
  // (deps [onDone] no useEffect fazia o parent re-render cancelar e reagendar
  // o timer infinitamente, e a conquista nunca sumia).
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const t = setTimeout(() => { doneRef.current && doneRef.current(); }, 4500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="pb-achievement">
      <div className="pb-achievement-icon"><StarIcon filled /></div>
      <div className="pb-achievement-text">
        <div className="pb-achievement-label">CONQUISTA DESBLOQUEADA</div>
        <div className="pb-achievement-name">{achievement.name}</div>
        <div className="pb-achievement-desc">{achievement.desc}</div>
      </div>
    </div>
  );
}

function SplashScreen({ profileName }) {
  // Constelacao de botoes de controle. Pontos representam A/B/X/Y, D-pad,
  // sticks, ombros e start/select/home; linhas finas conectam num padrao
  // de constelacao. Pulsa staggered, vibe astronomia + gaming.
  // Coordenadas em viewBox 800x600.
  const POINTS = [
    // Botoes frontais (losango direita)
    { id: "y",  x: 580, y: 200, label: "Y", color: "#fbbf24", r: 7 },
    { id: "b",  x: 660, y: 280, label: "B", color: "#ef4444", r: 7 },
    { id: "a",  x: 580, y: 360, label: "A", color: "#22c55e", r: 7 },
    { id: "x",  x: 500, y: 280, label: "X", color: "#3b82f6", r: 7 },
    // D-pad (losango esquerda)
    { id: "du", x: 200, y: 200, r: 5 },
    { id: "dr", x: 280, y: 280, r: 5 },
    { id: "dd", x: 200, y: 360, r: 5 },
    { id: "dl", x: 120, y: 280, r: 5 },
    // Ombros
    { id: "lb", x: 180, y: 110, r: 6 },
    { id: "rb", x: 620, y: 110, r: 6 },
    // Sticks analogicos
    { id: "ls", x: 320, y: 440, r: 9 },
    { id: "rs", x: 480, y: 440, r: 9 },
    // Centro (select/home/start)
    { id: "se", x: 360, y: 240, r: 4 },
    { id: "ho", x: 400, y: 215, r: 5 },
    { id: "st", x: 440, y: 240, r: 4 },
  ];
  const LINES = [
    // losango ABXY
    ["y","b"], ["b","a"], ["a","x"], ["x","y"],
    // losango D-pad
    ["du","dr"], ["dr","dd"], ["dd","dl"], ["dl","du"],
    // ombros conectando
    ["lb","du"], ["rb","y"], ["lb","rb"],
    // sticks ligando aos D-pad/botoes
    ["ls","dl"], ["ls","dd"], ["rs","a"], ["rs","b"],
    // centro
    ["se","ho"], ["ho","st"], ["se","st"],
    // linhas longas conectando os clusters (constelacao)
    ["du","ho"], ["y","ho"],
  ];
  const ptMap = Object.fromEntries(POINTS.map(p => [p.id, p]));

  return (
    <div className="pb-splash lx-splash-v3">
      {/* Background: gradient roxo profundo + 3 orbs grandes flutuando + grain */}
      <div className="lx-splash-bg">
        <span className="lx-splash-orb lx-splash-orb-a" />
        <span className="lx-splash-orb lx-splash-orb-b" />
        <span className="lx-splash-orb lx-splash-orb-c" />
        <div className="lx-splash-grain" aria-hidden />
      </div>

      {/* Constelacao SVG */}
      <svg
        className="lx-splash-const"
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <g className="lx-const-lines">
          {LINES.map(([a, b], i) => {
            const pa = ptMap[a]; const pb = ptMap[b];
            return (
              <line
                key={`l-${i}`}
                x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke="rgba(196, 181, 253, 0.22)"
                strokeWidth="1"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            );
          })}
        </g>
        <g className="lx-const-points">
          {POINTS.map((p, i) => (
            <g key={p.id} style={{ animationDelay: `${i * 80}ms` }}>
              <circle cx={p.x} cy={p.y} r={p.r * 2.6} className="lx-const-glow" fill={p.color || "#c4b5fd"} />
              <circle cx={p.x} cy={p.y} r={p.r} fill={p.color || "#c4b5fd"} />
              {p.label && (
                <text
                  x={p.x} y={p.y + 3} textAnchor="middle"
                  fontSize="10" fontWeight="700"
                  fill="#0a0420" pointerEvents="none"
                >{p.label}</text>
              )}
            </g>
          ))}
        </g>
      </svg>

      {/* Conteudo central: logo + tagline + barra. Mais respiro entre eles. */}
      <div className="pb-splash-content lx-splash-content-v3">
        <div className="pb-splash-logo lx-splash-logo-v2">L U D E X</div>
        <div className="pb-splash-tagline">SUA BIBLIOTECA RETRO EM UM LUGAR SO</div>
        {profileName && <div className="pb-splash-welcome">Bem-vindo, {profileName}</div>}
        <div className="pb-splash-bar"><div className="pb-splash-bar-fill" /></div>
      </div>
    </div>
  );
}

function ProfileSelector({ profiles, activeId, onSelect, onCreate, onDelete, onUpdate, onClose, closing, modalGamepadRef }) {
  // mode: "list" | "create" | { mode: "edit", id }
  const [mode, setMode] = useState("list");
  const [name, setName] = useState("");
  const [photoPath, setPhotoPath] = useState(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [photoErr, setPhotoErr] = useState(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  // avatarId: usado quando user nao tem foto custom. Default = primeiro avatar.
  const [avatarId, setAvatarId] = useState(DEFAULT_AVATARS[0].id);

  // Total na lista = perfis + botao "Novo Perfil"
  const totalCells = profiles.length + 1;
  useEffect(() => {
    if (focusedIdx >= totalCells) setFocusedIdx(0);
  }, [totalCells, focusedIdx]);

  const editingProfile = mode?.mode === "edit"
    ? profiles.find((p) => p.id === mode.id)
    : null;

  function startEdit(profile) {
    setMode({ mode: "edit", id: profile.id });
    setName(profile.name);
    setPhotoPath(null);
    setClearPhoto(false);
    setPhotoErr(null);
    setAvatarId(profile.avatar_id || DEFAULT_AVATARS[0].id);
  }

  function startCreate() {
    setMode("create");
    setName("");
    setPhotoPath(null);
    setClearPhoto(false);
    setPhotoErr(null);
    setAvatarId(DEFAULT_AVATARS[0].id);
  }

  function backToList() {
    setMode("list");
    setName("");
    setPhotoPath(null);
    setClearPhoto(false);
  }

  async function pickPhoto() {
    setPhotoErr(null);
    const path = await pickImageFile();
    if (!path) return;
    setPhotoPath(path);
    setClearPhoto(false);
  }

  async function submit() {
    if (!name.trim()) return;
    // Se nao tem foto custom (nem nova nem antiga preservada), usa avatar default
    const usesAvatar = !photoPath && (clearPhoto || !editingProfile?.photo_path);
    if (mode === "create") {
      await onCreate({
        name: name.trim(),
        photoSourcePath: photoPath,
        avatarId: usesAvatar ? avatarId : null,
      });
    } else if (editingProfile) {
      await onUpdate({
        id: editingProfile.id,
        name: name.trim(),
        photoSourcePath: photoPath,
        clearPhoto,
        avatarId: usesAvatar ? avatarId : null,
      });
    }
    backToList();
  }

  const isFormMode = mode === "create" || mode?.mode === "edit";
  const headerTitle = mode === "create"
    ? "Novo Perfil"
    : mode?.mode === "edit"
      ? "Editar Perfil"
      : "Quem está jogando?";

  // Preview da foto atual no modo edit (se nao escolheu nova e nao marcou pra remover)
  const currentPhotoSrc = editingProfile && !clearPhoto && !photoPath && editingProfile.photo_path
    ? convertFileSrc(editingProfile.photo_path)
    : null;

  // Gamepad nav: so na lista. Form mode requer teclado pra digitar nome.
  useEffect(() => {
    if (!modalGamepadRef) return;
    const handler = (action) => {
      if (isFormMode) {
        if (action === "b") { backToList(); return true; }
        return false; // form precisa teclado, ignora resto
      }
      if (action === "left") {
        setFocusedIdx((i) => i > 0 ? i - 1 : totalCells - 1);
        return true;
      }
      if (action === "right") {
        setFocusedIdx((i) => i < totalCells - 1 ? i + 1 : 0);
        return true;
      }
      if (action === "down" || action === "up") {
        // se houver mais de 1 linha visualmente, +/- 4 (mesmo padrao do CSS grid)
        setFocusedIdx((i) => {
          const cols = 4;
          const next = action === "down" ? i + cols : i - cols;
          return Math.max(0, Math.min(totalCells - 1, next));
        });
        return true;
      }
      if (action === "a") {
        if (focusedIdx >= profiles.length) {
          // botao "Novo Perfil"
          startCreate();
        } else {
          const p = profiles[focusedIdx];
          if (p) onSelect(p.id);
        }
        return true;
      }
      if (action === "y" && focusedIdx < profiles.length) {
        // Y = editar perfil focado
        const p = profiles[focusedIdx];
        if (p) startEdit(p);
        return true;
      }
      if (action === "b") { onClose(); return true; }
      return false;
    };
    modalGamepadRef.current = handler;
    return () => { if (modalGamepadRef.current === handler) modalGamepadRef.current = null; };
  }, [modalGamepadRef, isFormMode, focusedIdx, profiles, totalCells, onSelect, onClose]);

  return (
    <div className={`pb-modal-backdrop ${closing ? "closing" : ""}`} onClick={onClose}>
      <div className={`pb-modal pb-profile-modal ${closing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <header className="pb-modal-header">
          <h2>{headerTitle}</h2>
          <button className="pb-icon-btn" onClick={() => { sfx.back(); onClose(); }}><CloseIcon /></button>
        </header>

        {!isFormMode ? (
          <div className="pb-profile-grid">
            {profiles.map((p, i) => (
              <div key={p.id} className={`pb-profile-card ${p.id === activeId ? "active" : ""} ${focusedIdx === i ? "focused" : ""}`}>
                <button className="pb-profile-pick" onClick={() => { sfx.confirm(); setFocusedIdx(i); onSelect(p.id); }}>
                  <div className="pb-profile-avatar">
                    {(() => {
                      const src = getProfileAvatarUrl(p, convertFileSrc);
                      return src ? <img src={src} alt={p.name} /> : <UserIcon />;
                    })()}
                  </div>
                  <div className="pb-profile-name">{p.name}</div>
                </button>
                <button
                  className="pb-profile-edit"
                  onClick={() => { sfx.click(); startEdit(p); }}
                  title="Editar perfil"
                >
                  <EditIcon />
                </button>
                {profiles.length > 1 && (
                  <button className="pb-profile-del" onClick={() => { sfx.back(); onDelete(p.id); }} title="Deletar perfil">
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}
            <button className={`pb-profile-card pb-profile-add ${focusedIdx === profiles.length ? "focused" : ""}`} onClick={() => { sfx.click(); startCreate(); }}>
              <div className="pb-profile-avatar pb-profile-avatar-add"><PlusIcon /></div>
              <div className="pb-profile-name">Novo Perfil</div>
            </button>
          </div>
        ) : (
          <div className="pb-profile-create">
            <button type="button" className="pb-profile-photo-picker" onClick={pickPhoto}>
              {photoPath
                ? <img src={convertFileSrc(photoPath)} alt="preview" />
                : currentPhotoSrc
                  ? <img src={currentPhotoSrc} alt="atual" />
                  : <img src={avatarUrl(DEFAULT_AVATARS.find(a => a.id === avatarId))} alt="avatar" />}
            </button>
            {(photoPath || currentPhotoSrc) && (
              <button
                type="button"
                className="pb-btn pb-btn-ghost pb-btn-sm"
                onClick={() => { setPhotoPath(null); setClearPhoto(true); }}
              >
                Remover foto e usar avatar
              </button>
            )}
            {photoErr && <div className="pb-warn">{photoErr}</div>}

            {/* Grid de avatares default - so visivel quando nao tem foto custom */}
            {!photoPath && !currentPhotoSrc && (
              <div className="lx-avatar-grid" style={{ marginTop: 8 }}>
                {DEFAULT_AVATARS.map((av) => {
                  const selected = av.id === avatarId;
                  return (
                    <button
                      key={av.id}
                      type="button"
                      className={`lx-avatar-tile ${selected ? "selected" : ""}`}
                      title={av.label}
                      onClick={() => { sfx.click(); setAvatarId(av.id); }}
                    >
                      <img src={avatarUrl(av)} alt={av.label} />
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="lx-avatar-tile lx-avatar-custom"
                  onClick={pickPhoto}
                  title="Usar foto do PC"
                >
                  <span>+ Foto</span>
                </button>
              </div>
            )}

            <input
              type="text"
              className="pb-input"
              placeholder="Nome do perfil"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              autoFocus
            />
            <div className="pb-modal-actions">
              <button className="pb-btn pb-btn-ghost" onClick={() => { sfx.back(); backToList(); }}>
                Cancelar
              </button>
              <button className="pb-btn pb-btn-primary" disabled={!name.trim()} onClick={() => { sfx.confirm(); submit(); }}>
                {mode === "create" ? "Criar" : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function GamepadDebugOverlay({ onClose }) {
  const [snap, setSnap] = useState(null);
  useEffect(() => {
    let raf;
    function tick() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const list = [];
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (!p) continue;
        list.push({
          index: i,
          id: p.id,
          mapping: p.mapping || "(none)",
          connected: p.connected,
          buttons: p.buttons.map((b, bi) => ({ i: bi, p: b.pressed, v: b.value })),
          axes: p.axes.map((a, ai) => ({ i: ai, v: a })),
        });
      }
      setSnap({ pads: list, ts: Date.now() });
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pb-gamepad-debug" onClick={(e) => e.stopPropagation()}>
      <header className="pb-gamepad-debug-header">
        <strong>Diagnostico de Controle</strong>
        <button className="pb-icon-btn" onClick={onClose} title="Fechar (F2)"><CloseIcon /></button>
      </header>
      <div className="pb-gamepad-debug-body">
        {!snap || snap.pads.length === 0 ? (
          <div className="pb-gamepad-debug-empty">
            Nenhum controle detectado. Aperte qualquer botao do controle pra acordar.
          </div>
        ) : snap.pads.map((p) => (
          <div key={p.index} className="pb-gamepad-debug-pad">
            <div className="pb-gamepad-debug-id">
              <strong>Slot {p.index}:</strong> {p.id}
            </div>
            <div className="pb-gamepad-debug-meta">
              mapping: <code>{p.mapping}</code> {p.mapping !== "standard" && <span style={{color:"#f87171"}}>(NAO PADRAO — use modo XInput)</span>}
              {" · "}botoes: {p.buttons.length} · eixos: {p.axes.length}
            </div>
            <div className="pb-gamepad-debug-section">
              <div className="pb-gamepad-debug-label">Botoes pressionados:</div>
              <div className="pb-gamepad-debug-buttons">
                {p.buttons.filter((b) => b.p).length === 0 && <span style={{color:"#6b7280"}}>(nenhum)</span>}
                {p.buttons.filter((b) => b.p).map((b) => (
                  <span key={b.i} className="pb-gamepad-debug-btn-on">btn{b.i}</span>
                ))}
              </div>
            </div>
            <div className="pb-gamepad-debug-section">
              <div className="pb-gamepad-debug-label">Eixos:</div>
              <div className="pb-gamepad-debug-axes">
                {p.axes.map((a) => (
                  <div key={a.i} className={`pb-gamepad-debug-axis ${Math.abs(a.v) > 0.2 ? "active" : ""}`}>
                    <span>ax{a.i}:</span>
                    <span>{a.v.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        <div className="pb-gamepad-debug-help">
          <strong>GameSir T4n Lite:</strong> aperte <kbd>HOME + Y</kbd> por 3s pra entrar em modo XInput (Windows).<br />
          Outros modos: HOME+A=Android · HOME+B=iOS · HOME+X=Switch · <strong>HOME+Y=Windows/XInput</strong>
        </div>
      </div>
    </div>
  );
}

function HealthCheckModal({ onClose }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke("system_health_check");
      setItems(res);
    } catch (e) {
      console.error("system_health_check", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const summary = items ? {
    ok: items.filter((x) => x.status === "ok").length,
    warn: items.filter((x) => x.status === "warn").length,
    error: items.filter((x) => x.status === "error").length,
  } : null;

  return (
    <div className="pb-modal-backdrop" onClick={onClose}>
      <div className="pb-modal pb-health-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pb-modal-header">
          <h2><ShieldIcon /> Health Check dos Emuladores</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pb-icon-btn" onClick={load} title="Re-verificar" disabled={loading}><RefreshIcon /></button>
            <button className="pb-icon-btn" onClick={onClose}><CloseIcon /></button>
          </div>
        </header>

        {summary && (
          <div className="pb-health-summary">
            <span className="pb-health-badge pb-health-ok">{summary.ok} OK</span>
            <span className="pb-health-badge pb-health-warn">{summary.warn} avisos</span>
            <span className="pb-health-badge pb-health-error">{summary.error} erros</span>
          </div>
        )}

        <div className="pb-health-list">
          {loading && <div className="pb-health-loading">Verificando todos os emuladores...</div>}
          {items && items.map((s) => (
            <div key={s.system_id} className={`pb-health-item pb-health-${s.status}`}>
              <div className="pb-health-head">
                <span className="pb-health-status-icon">
                  {s.status === "ok" ? "✓" : s.status === "warn" ? "⚠" : "✕"}
                </span>
                <strong className="pb-health-name">{s.system_name}</strong>
                <span className="pb-health-rom-count">{s.rom_count} ROMs</span>
              </div>
              {s.checks_ok.length > 0 && (
                <ul className="pb-health-checks pb-health-checks-ok">
                  {s.checks_ok.map((c, i) => <li key={i}>✓ {c}</li>)}
                </ul>
              )}
              {s.issues.length > 0 && (
                <ul className="pb-health-checks pb-health-checks-issue">
                  {s.issues.map((c, i) => <li key={i}>✕ {c}</li>)}
                </ul>
              )}
              <div className="pb-health-path"><code>{s.emulator_path}</code></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LogsViewerModal({ onClose }) {
  const [text, setText] = useState("Carregando...");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all"); // all | error | warn | info
  const [autoRefresh, setAutoRefresh] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const t = await invoke("read_app_logs", { maxLines: 500 });
      setText(t || "(vazio)");
    } catch (e) {
      setText(`Erro ao ler log: ${e}`);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const filtered = useMemo(() => {
    if (filter === "all") return text;
    const want = filter.toUpperCase();
    return text.split("\n").filter((l) => l.includes(`[${want}]`) || l.toUpperCase().includes(` ${want} `)).join("\n") || "(nada com este filtro)";
  }, [text, filter]);

  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0 };
    for (const line of text.split("\n")) {
      if (line.includes("[ERROR]")) c.error++;
      else if (line.includes("[WARN]")) c.warn++;
      else if (line.includes("[INFO]")) c.info++;
    }
    return c;
  }, [text]);

  const openLogDir = useCallback(async () => {
    try {
      const dir = await invoke("get_app_log_dir");
      await invoke("open_in_explorer", { path: dir });
    } catch (e) {
      console.error("open log dir", e);
    }
  }, []);

  const clearLogs = useCallback(async () => {
    if (!confirm("Apagar todos os arquivos de log?")) return;
    try {
      await invoke("clear_app_logs");
      load();
    } catch (e) {
      console.error("clear logs", e);
    }
  }, [load]);

  return (
    <div className="pb-modal-backdrop" onClick={onClose}>
      <div className="pb-modal pb-logs-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pb-modal-header">
          <h2>Logs do Ludex</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pb-icon-btn" onClick={load} title="Recarregar" disabled={busy}><RefreshIcon /></button>
            <button className="pb-icon-btn" onClick={onClose}><CloseIcon /></button>
          </div>
        </header>
        <div className="pb-logs-toolbar">
          <div className="pb-logs-filters">
            {[
              { id: "all",   label: `Todos (${text.split("\n").length})` },
              { id: "error", label: `Erros (${counts.error})` },
              { id: "warn",  label: `Avisos (${counts.warn})` },
              { id: "info",  label: `Info (${counts.info})` },
            ].map((f) => (
              <button
                key={f.id}
                className={`pb-logs-filter ${filter === f.id ? "active" : ""}`}
                onClick={() => setFilter(f.id)}
              >{f.label}</button>
            ))}
          </div>
          <div className="pb-logs-actions">
            <label className="pb-logs-toggle">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refresh 2s
            </label>
            <button className="pb-btn pb-btn-small" onClick={openLogDir}>Abrir pasta</button>
            <button className="pb-btn pb-btn-small pb-btn-danger" onClick={clearLogs}>Limpar</button>
          </div>
        </div>
        <pre className="pb-logs-content">{filtered}</pre>
      </div>
    </div>
  );
}

function TopPlayedList({ playTime, sessions, systems }) {
  // Resolve rom_name a partir das sessions (mais recente) ou do scan de systems
  const nameByKey = useMemo(() => {
    const map = {};
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      const key = `${s.system_id}::${s.rom_path}`;
      if (!map[key]) map[key] = { name: s.rom_name, system_id: s.system_id };
    }
    for (const sys of systems) {
      for (const g of sys.games || []) {
        const key = `${sys.id}::${g.path}`;
        if (!map[key]) map[key] = { name: g.name, system_id: sys.id };
      }
    }
    return map;
  }, [sessions, systems]);

  const top = useMemo(() => {
    const entries = Object.entries(playTime || {})
      .filter(([_, sec]) => sec > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return entries.map(([key, seconds]) => {
      const info = nameByKey[key] || {};
      const fallbackName = (key.split("::")[1] || key).split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
      return {
        key,
        seconds,
        name: info.name || fallbackName,
        system_id: info.system_id || (key.split("::")[0] || ""),
      };
    });
  }, [playTime, nameByKey]);

  if (top.length === 0) return null;
  const max = top[0].seconds || 1;

  return (
    <div className="pb-top-played" style={{ marginTop: 14 }}>
      <h4 style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.7, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Top jogos por tempo
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {top.map((g, i) => {
          const sys = systems.find((s) => s.id === g.system_id);
          const pct = Math.max(6, Math.round((g.seconds / max) * 100));
          return (
            <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ minWidth: 18, textAlign: "right", opacity: 0.5, fontSize: 12 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 4 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sys && <span style={{ opacity: 0.5, marginRight: 6, fontSize: 11 }}>{sys.name}</span>}
                    {g.name}
                  </span>
                  <strong style={{ flexShrink: 0 }}>{formatPlayTime(g.seconds)}</strong>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: sys?.color || "#8b5cf6", borderRadius: 2, transition: "width 280ms cubic-bezier(0.4,0,0.2,1)" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollectionStats({ gameMeta, systems }) {
  // Conta total de jogos disponiveis na coleção
  const totalGames = systems.reduce((sum, s) => sum + (s.games?.length || 0), 0);

  // Conta por status
  const counts = { wishlist: 0, playing: 0, beat: 0, mastered: 0, abandoned: 0 };
  let ratedCount = 0;
  let ratingSum = 0;
  for (const key of Object.keys(gameMeta)) {
    const m = gameMeta[key];
    if (m.status && counts[m.status] !== undefined) counts[m.status]++;
    if (m.rating > 0) {
      ratedCount++;
      ratingSum += m.rating;
    }
  }
  const completed = counts.beat + counts.mastered;
  const completionRate = totalGames > 0 ? Math.round((completed / totalGames) * 100) : 0;
  const avgRating = ratedCount > 0 ? (ratingSum / ratedCount) : 0;

  return (
    <div className="pb-collection-stats">
      <div className="pb-coll-row">
        <div className="pb-coll-card pb-coll-card-total">
          <strong>{totalGames}</strong>
          <span>jogos na coleção</span>
        </div>
        <div className="pb-coll-card">
          <strong>{completionRate}%</strong>
          <span>completion rate</span>
        </div>
        <div className="pb-coll-card">
          <strong>{avgRating > 0 ? avgRating.toFixed(1) : "—"}<small>{avgRating > 0 ? " ★" : ""}</small></strong>
          <span>nota média ({ratedCount} avaliados)</span>
        </div>
      </div>
      <div className="pb-coll-status-grid">
        <div className="pb-coll-status pb-coll-status-wishlist">
          <span className="pb-coll-status-icon">{GAME_STATUS_EMOJI.wishlist}</span>
          <strong>{counts.wishlist}</strong>
          <span>quero jogar</span>
        </div>
        <div className="pb-coll-status pb-coll-status-playing">
          <span className="pb-coll-status-icon">{GAME_STATUS_EMOJI.playing}</span>
          <strong>{counts.playing}</strong>
          <span>jogando</span>
        </div>
        <div className="pb-coll-status pb-coll-status-beat">
          <span className="pb-coll-status-icon">{GAME_STATUS_EMOJI.beat}</span>
          <strong>{counts.beat}</strong>
          <span>zerei</span>
        </div>
        <div className="pb-coll-status pb-coll-status-mastered">
          <span className="pb-coll-status-icon">{GAME_STATUS_EMOJI.mastered}</span>
          <strong>{counts.mastered}</strong>
          <span>platinei</span>
        </div>
        <div className="pb-coll-status pb-coll-status-abandoned">
          <span className="pb-coll-status-icon">{GAME_STATUS_EMOJI.abandoned}</span>
          <strong>{counts.abandoned}</strong>
          <span>abandonei</span>
        </div>
      </div>
    </div>
  );
}

function SessionsGraph({ sessions }) {
  // Agrupa sessoes por dia (ultimos 7 dias)
  const days = useMemo(() => {
    const out = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const label = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
      out.push({ date: d, label, total: 0 });
    }
    for (const s of sessions || []) {
      const sDate = new Date(s.started_at * 1000);
      sDate.setHours(0, 0, 0, 0);
      const day = out.find((d) => d.date.getTime() === sDate.getTime());
      if (day) day.total += s.duration_sec;
    }
    return out;
  }, [sessions]);

  const maxTotal = Math.max(...days.map((d) => d.total), 600); // pelo menos 10min de escala
  const totalWeek = days.reduce((acc, d) => acc + d.total, 0);

  return (
    <div className="pb-sessions-graph">
      <div className="pb-sessions-summary">
        <strong>{formatPlayTime(totalWeek)}</strong>
        <span>nos últimos 7 dias</span>
      </div>
      <div className="pb-sessions-bars">
        {days.map((d, i) => {
          const pct = (d.total / maxTotal) * 100;
          return (
            <div key={i} className="pb-sessions-bar-col" title={`${d.label}: ${formatPlayTime(d.total)}`}>
              <div className="pb-sessions-bar-wrap">
                <div
                  className={`pb-sessions-bar ${d.total > 0 ? "filled" : ""}`}
                  style={{ height: `${pct}%` }}
                />
                {d.total > 0 && (
                  <div className="pb-sessions-bar-label">{formatPlayTime(d.total)}</div>
                )}
              </div>
              <span className="pb-sessions-day">{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function CustomThemeEditor({ theme, onChange }) {
  const fields = [
    { key: "bg",      label: "Fundo" },
    { key: "surface", label: "Superfície" },
    { key: "card",    label: "Card" },
    { key: "text",    label: "Texto" },
    { key: "muted",   label: "Texto Secundário" },
    { key: "border",  label: "Borda" },
  ];
  return (
    <div className="pb-custom-theme">
      {fields.map((f) => (
        <label key={f.key} className="pb-custom-theme-row">
          <span className="pb-custom-theme-label">{f.label}</span>
          <input
            type="color"
            value={theme[f.key] || "#000000"}
            onChange={(e) => onChange({ ...theme, [f.key]: e.target.value })}
            className="pb-custom-theme-input"
          />
          <code className="pb-custom-theme-code">{theme[f.key]}</code>
        </label>
      ))}
      <p className="pb-settings-hint">Aplica em tempo real. Salvo automaticamente.</p>
    </div>
  );
}

function DiscPickerModal({ system, game, onCancel, onPick }) {
  return (
    <div className="pb-modal-backdrop" onClick={onCancel}>
      <div className="pb-modal pb-disc-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pb-modal-header">
          <h2>Escolher disco</h2>
          <button className="pb-icon-btn" onClick={onCancel}><CloseIcon /></button>
        </header>
        <div className="pb-disc-body">
          <p className="pb-disc-game">
            <span className="pb-disc-sys" style={{ color: system.color }}><SystemIcon id={system.id} /></span>
            <strong>{game.name}</strong>
          </p>
          <div className="pb-disc-grid">
            {(game.discs || []).map((d) => (
              <button key={d.path} className="pb-disc-card" onClick={() => onPick(d.path)}>
                <span className="pb-disc-icon">💿</span>
                <span className="pb-disc-label">{d.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * Preview popup compacto: aparece quando o usuario clica num card de jogo
 * (single click). Mostra cover + nome + sistema + screenshot rotativo + summary
 * curto + acoes (Jogar / Detalhes / Fechar). Pra ver tudo, o botao "Detalhes"
 * abre o GameDetailPanel fullscreen.
 *
 * Double-click no card pula o popup e lanca direto (atalho power-user).
 */
function GamePreviewPopup({ system, game, playTimeSec, isFavorite, onClose, onLaunch, onOpenDetails, closing, modalGamepadRef, detailsCache }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeShot, setActiveShot] = useState(0);
  const [videoMuted, setVideoMuted] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef(null);

  const toggleMute = useCallback(() => {
    if (!videoRef.current?.contentWindow) return;
    const next = !videoMuted;
    setVideoMuted(next);
    // YouTube IFrame API: postMessage pra mutar/desmutar sem reload
    const cmd = next ? "mute" : "unMute";
    try {
      videoRef.current.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: cmd, args: [] }),
        "*"
      );
    } catch {}
  }, [videoMuted]);

  // Fetch details (com cache em memoria pra reabrir instantaneo)
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${system.id}::${game.path}`;
    const cached = detailsCache?.current?.get(cacheKey);
    if (cached) {
      // Cache hit em memoria: zero delay
      setDetails(cached);
      setLoading(false);
      setActiveShot(0);
      setVideoMuted(true);
      setVideoFailed(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setDetails(null);
    setActiveShot(0);
    setVideoMuted(true);
    setVideoFailed(false);
    (async () => {
      try {
        const d = await invoke("fetch_game_details", { systemId: system.id, gameName: game.name });
        if (cancelled) return;
        setDetails(d);
        if (d && detailsCache?.current) {
          detailsCache.current.set(cacheKey, d);
        }
      } catch (e) {
        console.error("preview fetch_game_details", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [system.id, game.path, game.name, detailsCache]);

  const youtubeId = !videoFailed && details?.videos?.[0]?.youtube_id ? details.videos[0].youtube_id : null;

  // Rotaciona screenshots a cada 3.5s (somente quando NAO tem video)
  useEffect(() => {
    if (youtubeId) return;
    if (!details?.screenshot_paths?.length) return;
    const id = setInterval(() => {
      setActiveShot((i) => (i + 1) % details.screenshot_paths.length);
    }, 3500);
    return () => clearInterval(id);
  }, [details, youtubeId]);

  // Hotkeys teclado: Esc fecha, Enter lanca
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "Enter") { e.preventDefault(); onLaunch(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onLaunch]);

  // Gamepad: registra como modal handler. A=lanca, B/X=fecha, Y=detalhes
  useEffect(() => {
    if (!modalGamepadRef) return;
    const handler = (action) => {
      if (action === "a") { onLaunch(); return true; }
      if (action === "b" || action === "x") { onClose(); return true; }
      if (action === "y") { onOpenDetails(); return true; }
      return false;
    };
    modalGamepadRef.current = handler;
    return () => { if (modalGamepadRef.current === handler) modalGamepadRef.current = null; };
  }, [modalGamepadRef, onClose, onLaunch, onOpenDetails]);

  const coverSrc = details?.cover_path ? convertFileSrc(details.cover_path) : null;
  const shotSrc = details?.screenshot_paths?.[activeShot] ? convertFileSrc(details.screenshot_paths[activeShot]) : null;
  const summaryShort = details?.summary
    ? (details.summary.length > 220 ? details.summary.slice(0, 220).trim() + "..." : details.summary)
    : null;

  return (
    <div className={`pb-preview-backdrop ${closing ? "closing" : ""}`} onClick={onClose}>
      <div
        className={`pb-preview ${closing ? "closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        style={{ "--sys-color": system.color }}
      >
        <div className="pb-preview-shot">
          {youtubeId ? (
            <iframe
              key={youtubeId}
              ref={videoRef}
              className="pb-preview-video"
              src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${youtubeId}&enablejsapi=1`}
              title="Game trailer"
              frameBorder="0"
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              onError={() => setVideoFailed(true)}
              allowFullScreen
            />
          ) : shotSrc ? (
            <img key={shotSrc} className="pb-preview-shot-img" src={shotSrc} alt="" aria-hidden />
          ) : (
            <div className="pb-preview-shot-fallback" style={{ background: system.color }} />
          )}
          {loading && (
            <div className="pb-preview-shot-loading">
              <div className="pb-preview-spinner" aria-hidden />
              <span>Carregando preview...</span>
            </div>
          )}
          <div className="pb-preview-shot-overlay" />
          {youtubeId && (
            <button
              className="pb-preview-mute"
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
              title={videoMuted ? "Ativar som" : "Mutar"}
            >
              {videoMuted ? <SpeakerMuteIcon /> : <SpeakerIcon />}
            </button>
          )}
          <button className="pb-preview-close" onClick={onClose} title="Fechar (Esc)">
            <CloseIcon />
          </button>
        </div>

        <div className="pb-preview-body">
          <div className="pb-preview-cover-wrap">
            {coverSrc ? (
              <img className="pb-preview-cover" src={coverSrc} alt={game.name} />
            ) : (
              <div className="pb-preview-cover pb-preview-cover-fallback" style={{ background: system.color }}>
                <SystemIcon id={system.id} />
              </div>
            )}
            {isFavorite && <span className="pb-preview-fav"><StarIcon filled /></span>}
          </div>

          <div className="pb-preview-info">
            <div className="pb-preview-tag">
              <span className="pb-preview-tag-icon" style={{ color: system.color }}>
                <SystemIcon id={system.id} />
              </span>
              <span>{system.name}</span>
            </div>
            <h2 className="pb-preview-title">{details?.name || game.name}</h2>
            <div className="pb-preview-meta">
              {details?.first_release_year && <span>{details.first_release_year}</span>}
              {details?.developer && <span>· {details.developer}</span>}
              {playTimeSec > 0 && <span>· {formatPlayTime(playTimeSec)} jogado</span>}
              {!details?.first_release_year && !details?.developer && playTimeSec === 0 && game.size_mb && (
                <span>{game.size_mb} MB</span>
              )}
            </div>
            {details?.genres?.length > 0 && (
              <div className="pb-preview-genres">
                {details.genres.slice(0, 3).map((g) => <span key={g} className="pb-preview-genre">{g}</span>)}
              </div>
            )}
            {summaryShort && <p className="pb-preview-summary">{summaryShort}</p>}
          </div>
        </div>

        <div className="pb-preview-actions">
          <button className="pb-preview-btn pb-preview-btn-primary" onClick={onLaunch}>
            <PlayIcon /> <span>Jogar</span>
          </button>
          <button className="pb-preview-btn" onClick={onOpenDetails}>
            <InfoIcon /> <span>Detalhes</span>
          </button>
          <button className="pb-preview-btn pb-preview-btn-ghost" onClick={onClose}>
            <span>Fechar</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function GameContextMenu({ x, y, system, game, isFavorite, onClose, onLaunch, onResyncCover, onPickCover, onOpenLocation, onDelete, onToggleFavorite, onShowDetails }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    // Ajusta pra nao sair da tela
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onAny = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onAny);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onAny);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="pb-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="pb-ctx-header">
        <span className="pb-ctx-header-icon" style={{ color: system.color }}>
          <SystemIcon id={system.id} />
        </span>
        <span className="pb-ctx-header-name">{game.name}</span>
      </div>
      <div className="pb-ctx-divider" />
      <button className="pb-ctx-item pb-ctx-primary" onClick={onLaunch}>
        <PlayIcon /> <span>Jogar</span>
      </button>
      <button className="pb-ctx-item" onClick={onShowDetails}>
        <InfoIcon /> <span>Ver detalhes</span>
      </button>
      <button className="pb-ctx-item" onClick={onToggleFavorite}>
        <StarIcon filled={isFavorite} />
        <span>{isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}</span>
      </button>
      <div className="pb-ctx-divider" />
      <button className="pb-ctx-item" onClick={onPickCover}>
        <ImageIcon /> <span>Escolher capa do PC...</span>
      </button>
      <button className="pb-ctx-item" onClick={onResyncCover}>
        <RotateIcon /> <span>Re-sincronizar capa (IGDB)</span>
      </button>
      <button className="pb-ctx-item" onClick={onOpenLocation}>
        <FolderIcon /> <span>Abrir local do arquivo</span>
      </button>
      <div className="pb-ctx-divider" />
      <button className="pb-ctx-item pb-ctx-danger" onClick={onDelete}>
        <TrashIcon /> <span>Excluir do PC (Lixeira)</span>
      </button>
    </div>
  );
}

function DeleteConfirmModal({ game, system, onCancel, onConfirm }) {
  return (
    <div className="pb-modal-backdrop" onClick={onCancel}>
      <div className="pb-modal pb-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pb-modal-header">
          <h2>Excluir do PC</h2>
          <button className="pb-icon-btn" onClick={onCancel}><CloseIcon /></button>
        </header>
        <div className="pb-confirm-body">
          <p className="pb-confirm-question">
            Tem certeza que quer enviar este jogo pra Lixeira do Windows?
          </p>
          <div className="pb-confirm-game">
            <span className="pb-confirm-game-sys" style={{ background: system.color }}>
              <SystemIcon id={system.id} />
            </span>
            <div className="pb-confirm-game-info">
              <strong>{game.name}</strong>
              <code>{game.path}</code>
            </div>
          </div>
          <p className="pb-confirm-hint">
            O arquivo (ou pasta-jogo, se for PS3/PS4/Wii U) vai pra Lixeira. Você pode restaurar de lá se mudar de ideia.
          </p>
          <div className="pb-modal-actions">
            <button className="pb-btn pb-btn-ghost" onClick={onCancel}>Cancelar</button>
            <button className="pb-btn pb-btn-danger" onClick={onConfirm}>Excluir</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tela mostrada quando a demo Android expirou (apos 7 dias de uso).
 * Tem botao "Tenho license admin" pra Paulo destravar uso permanente.
 * Usuario comum NAO consegue destravar (only admin email vale).
 */
function AndroidDemoExpired({ demo, onUnlock }) {
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function tryUnlock() {
    const k = keyInput.trim();
    if (!k) return;
    setBusy(true); setMsg(null);
    try {
      const ok = await invoke("android_demo_admin_unlock", { licenseKey: k });
      if (ok) {
        const newDemo = await invoke("android_demo_status");
        setMsg({ kind: "ok", text: "Destravado! Carregando..." });
        setTimeout(() => onUnlock(newDemo), 800);
      } else {
        setMsg({ kind: "error", text: "License nao destravou (nao e admin)" });
      }
    } catch (e) {
      setMsg({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-demo-expired">
      <div className="pb-demo-expired-card">
        <div className="pb-demo-expired-icon">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="32" cy="36" r="22" />
            <line x1="32" y1="36" x2="32" y2="22" />
            <line x1="32" y1="36" x2="42" y2="36" />
            <line x1="26" y1="6" x2="38" y2="6" />
            <line x1="32" y1="6" x2="32" y2="14" />
          </svg>
        </div>
        <h1>Demo expirou</h1>
        <p className="pb-demo-expired-sub">
          Voce usou {demo.demo_days_total} dias da versao Android gratuita.
        </p>
        <p className="pb-demo-expired-pitch">
          Pra continuar sem limite, compra a versao <strong>Windows</strong> com mais features
          (auto-update, todos os sistemas embedded, license vitalicia, etc).
        </p>

        <a
          className="pb-demo-expired-btn pb-demo-expired-btn-primary"
          href="https://pauloadriel98.gumroad.com/l/ludex"
          target="_blank"
          rel="noopener noreferrer"
        >
          Comprar Windows (R$ 49,90)
        </a>

        {!showKeyInput ? (
          <button
            className="pb-demo-expired-btn pb-demo-expired-btn-ghost"
            onClick={() => setShowKeyInput(true)}
          >
            Sou admin / tenho license
          </button>
        ) : (
          <div className="pb-demo-expired-input-wrap">
            <input
              className="pb-demo-expired-input"
              type="text"
              placeholder="Cole sua license key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoFocus
              disabled={busy}
            />
            <button
              className="pb-demo-expired-btn pb-demo-expired-btn-primary"
              onClick={tryUnlock}
              disabled={busy || !keyInput.trim()}
            >
              {busy ? "Verificando..." : "Destravar"}
            </button>
            {msg && (
              <p className={`pb-demo-expired-msg pb-demo-expired-msg-${msg.kind}`}>{msg.text}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LudexLauncher() {
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState(null);
  const [selectedSystemIdx, setSelectedSystemIdx] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);  // mobile bottom sheet
  // focusZone: "games" (default, navega jogos) | "systems" (navega barra de sistemas)
  // D-pad DOWN em games -> systems. D-pad UP em systems -> games. A em systems -> entra (volta pra games).
  const [focusZone, setFocusZone] = useState("games");
  const [selectedGameIdx, setSelectedGameIdx] = useState(0);
  const [launchMsg, setLaunchMsg] = useState(null);
  const [covers, setCovers] = useState({});
  const [splashDone, setSplashDone] = useState(false);
  // v0.8.21: update banner (desktop nao bloqueia, user pode adiar)
  const [updateBanner, setUpdateBanner] = useState(null); // { version, update } | null
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [profilesClosing, setProfilesClosing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [welcomeBack, setWelcomeBack] = useState(false);
  const [systemEnter, setSystemEnter] = useState({ id: null, key: 0 });
  const [quitting, setQuitting] = useState(false);
  // License gate — bloqueia o app antes de qualquer outra coisa se sem license valida
  // null = ainda checando; true = licenciado, deixa entrar; false = sem license, mostra gate
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [androidDemo, setAndroidDemo] = useState(null);  // { expired, days_left, is_admin_unlocked, ... }
  // First-run onboarding + utilitarios novos do v0.4
  const [firstRunActive, setFirstRunActive] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsTab, setSuggestionsTab] = useState("roms");
  const [controlsTip, setControlsTip] = useState(null); // { system } | null
  const [settingsModal, setSettingsModal] = useState(null); // { systemId } | null — v0.8.37
  // Bottom-bar acessivel por D-pad direito ao final dos sistemas. -1 = inativo,
  // 0 = botao Configuracoes, 1 = botao Sair. Quando >= 0, focusZone vira "util".
  const [utilIdx, setUtilIdx] = useState(-1);
  const [romsRoot, setRomsRoot] = useState("");
  const [emulatorsRoot, setEmulatorsRoot] = useState("");
  // Menu de contexto: { x, y, system, game } | null
  const [ctxMenu, setCtxMenu] = useState(null);
  // Confirmacao de delete: { system, game } | null
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  // Ficha do jogo: { system, game } | null
  const [detailPanel, setDetailPanel] = useState(null);
  const [detailClosing, setDetailClosing] = useState(false);
  // Preview popup compacto: { system, game } | null
  const [previewPopup, setPreviewPopup] = useState(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  // Cache em memoria de GameDetails (chave = `${system.id}::${game.path}`)
  // Sobrevive enquanto o app esta aberto. Backend continua tendo cache em disco.
  const detailsCacheRef = useRef(new Map());
  // Selector de disco: { system, game } | null
  const [discPicker, setDiscPicker] = useState(null);
  // Logs viewer modal
  const [logsOpen, setLogsOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  // Emulator embarcado: { system, game } | null
  const [emulator, setEmulator] = useState(null);
  const [resumePrompt, setResumePrompt] = useState(null);
  // Ordenacao do grid de jogos: "default" | "az" | "playtime" | "recent" | "fav"
  const [sortMode, setSortMode] = useState("default");
  const [rescanBusy, setRescanBusy] = useState(false);
  const [achievementToast, setAchievementToast] = useState(null);
  // v0.8.51: notificacao de gamepad conectado/desconectado (Windows API gamepadcontroller events)
  const [gamepadEvent, setGamepadEvent] = useState(null);
  const [screenshots, setScreenshots] = useState({});
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [gamepadDebug, setGamepadDebug] = useState(false);

  // Wrappers que disparam animação de saída antes de desmontar
  const closeSettings = useCallback(() => {
    setSettingsClosing(true);
    setTimeout(() => { setSettingsOpen(false); setSettingsClosing(false); }, MODAL_EXIT_MS);
  }, []);
  const closeProfiles = useCallback(() => {
    setProfilesClosing(true);
    setTimeout(() => { setProfilesOpen(false); setProfilesClosing(false); }, MODAL_EXIT_MS);
  }, []);
  const closeSearch = useCallback(() => {
    setSearchClosing(true);
    setTimeout(() => { setSearchOpen(false); setSearchClosing(false); }, MODAL_EXIT_MS);
  }, []);
  const [config, setConfig] = useState({
    profiles: [],
    active_profile_id: null,
    theme_id: "switch-dark",
    wallpaper_path: null,
    last_system_id: null,
  });
  const [syncStatus, setSyncStatus] = useState({ busy: false, text: "" });
  const [switchKeysStatus, setSwitchKeysStatus] = useState({ busy: false, message: null, kind: null });
  const [savesStatus, setSavesStatus] = useState({ busy: false, enabled: false, message: null, kind: null });
  const time = useClock();
  const activeCardRef = useRef(null);
  const fetchedSystems = useRef(new Set());
  const fetchedShots = useRef(new Set());
  const launchStartRef = useRef(null);

  const favoriteSet = useMemo(
    () => new Set((config.profiles.find((p) => p.id === config.active_profile_id)?.favorites) || []),
    [config.profiles, config.active_profile_id]
  );

  // Map de game_meta do profile ativo: chave = "system_id::rom_path"
  const gameMetaMap = useMemo(
    () => (config.profiles.find((p) => p.id === config.active_profile_id)?.game_meta) || {},
    [config.profiles, config.active_profile_id]
  );

  const updateGameMetaLocal = (systemId, romPath, patch) => {
    const key = `${systemId}::${romPath}`;
    setConfig((prev) => {
      const profiles = prev.profiles.map((p) => {
        if (p.id !== prev.active_profile_id) return p;
        const game_meta = { ...(p.game_meta || {}) };
        const entry = { rating: 0, status: "", notes: "", completed_at: 0, ...(game_meta[key] || {}), ...patch };
        // Set completed_at se virou completed
        if (patch.status !== undefined) {
          const wasCompleted = (game_meta[key]?.status === "beat" || game_meta[key]?.status === "mastered");
          const willBeCompleted = patch.status === "beat" || patch.status === "mastered";
          if (willBeCompleted && !wasCompleted) entry.completed_at = Math.floor(Date.now() / 1000);
          else if (!willBeCompleted) entry.completed_at = 0;
        }
        game_meta[key] = entry;
        return { ...p, game_meta };
      });
      return { ...prev, profiles };
    });
  };

  const setGameRating = (systemId, romPath, rating) => {
    updateGameMetaLocal(systemId, romPath, { rating });
    invoke("set_game_rating", { systemId, romPath, rating }).catch((e) => console.error("set_game_rating", e));
  };
  const setGameStatus = (systemId, romPath, status) => {
    updateGameMetaLocal(systemId, romPath, { status });
    invoke("set_game_status", { systemId, romPath, status }).catch((e) => console.error("set_game_status", e));
  };
  const setGameNotes = (systemId, romPath, notes) => {
    updateGameMetaLocal(systemId, romPath, { notes });
    invoke("set_game_notes", { systemId, romPath, notes }).catch((e) => console.error("set_game_notes", e));
  };

  const pickRandomGame = async () => {
    try {
      const pick = await invoke("pick_random_game", { romsRoot: config.roms_root || null });
      if (!pick) {
        sfx.back();
        return;
      }
      sfx.confirm();
      const sys = systems.find((s) => s.id === pick.system_id);
      const game = sys?.games.find((g) => g.path === pick.rom_path);
      if (sys && game) {
        setSelectedSystemIdx(systems.indexOf(sys));
        setDetailPanel({ system: sys, game });
      }
    } catch (e) { console.error("pick_random_game", e); }
  };

  const favoritesSystem = useMemo(() => {
    if (favoriteSet.size === 0) return null;
    const favs = [];
    for (const sys of systems) {
      for (const g of sys.games) {
        if (favoriteSet.has(g.path)) {
          favs.push({ ...g, _origin_system_id: sys.id });
        }
      }
    }
    if (favs.length === 0) return null;
    return {
      id: "_favorites",
      name: "FAVORITOS",
      color: "#fcd34d",
      folder_name: "_favorites",
      emulator_path: "",
      emulator_exists: true,
      folder_exists: true,
      games: favs,
    };
  }, [favoriteSet, systems]);

  const displayedSystems = useMemo(() => {
    const all = favoritesSystem ? [favoritesSystem, ...systems] : systems;
    // Favoritos sempre visivel, mesmo quando filtrando por categoria
    return all.filter(s => s.id === "_favorites" || systemMatchesCategory(s.id, selectedCategoryId));
  }, [favoritesSystem, systems, selectedCategoryId]);

  const selected = displayedSystems[selectedSystemIdx];

  // v0.8.49: dividi em 2 memos pra evitar re-sort em mudancas de perfil/favoritos.
  // Sort soh refaz quando selected ou sortMode muda; filtros aplicam por cima.
  const activeProfilePlayData = useMemo(() => {
    const profile = config.profiles.find((p) => p.id === config.active_profile_id);
    const playTime = profile?.play_time || {};
    const sessions = profile?.sessions || [];
    const lastByRom = {};
    for (const s of sessions) {
      const cur = lastByRom[s.rom_path] || 0;
      const end = (s.started_at || 0) + (s.duration_sec || 0);
      if (end > cur) lastByRom[s.rom_path] = end;
    }
    return { playTime, lastByRom };
  }, [config.profiles, config.active_profile_id]);

  const sortedGames = useMemo(() => {
    if (!selected) return [];
    const { playTime, lastByRom } = activeProfilePlayData;
    const ptKey = (g) => `${g._origin_system_id || selected.id}::${g.path}`;
    const games = [...selected.games];
    switch (sortMode) {
      case "az":
        games.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        break;
      case "playtime":
        games.sort((a, b) => (playTime[ptKey(b)] || 0) - (playTime[ptKey(a)] || 0));
        break;
      case "recent":
        games.sort((a, b) => (lastByRom[b.path] || 0) - (lastByRom[a.path] || 0));
        break;
      default: break;
    }
    return games;
  }, [selected, sortMode, activeProfilePlayData]);

  const visibleGames = useMemo(() => {
    if (sortMode === "fav") return sortedGames.filter((g) => favoriteSet.has(g.path));
    return sortedGames;
  }, [sortedGames, sortMode, favoriteSet]);

  const selectedGame = visibleGames[selectedGameIdx];
  const launchSystemId = selectedGame?._origin_system_id || selected?.id;
  const accentColor = selected?.color || "#666";
  const selectedCoverSrc = selectedGame ? covers[selectedGame.path] : null;
  const selectedShotSrc = selectedGame ? screenshots[selectedGame.path] : null;
  const selectedBgSrc = selectedShotSrc || selectedCoverSrc;
  // v0.8.49: deps granular — antes [config] re-calculava em qualquer mudanca
  const activeProfile = useMemo(
    () => config.profiles.find((p) => p.id === config.active_profile_id),
    [config.profiles, config.active_profile_id]
  );

  // v0.8.21: auto-check de update no startup desktop (background, banner se houver)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const update = await checkUpdate();
        if (update) setUpdateBanner({ version: update.version, update });
      } catch (e) { console.warn("update check", e); }
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  // splash boot + intro music
  useEffect(() => {
    sfx.intro();
    const t = setTimeout(() => setSplashDone(true), 3500);
    return () => clearTimeout(t);
  }, []);

  // Música ambiente: carrega playlist no startup, liga/desliga conforme config
  useEffect(() => {
    ambientMusic.load();
  }, []);

  useEffect(() => {
    if (config.music_enabled && splashDone && !launching && !quitting && !emulator) {
      if (!ambientMusic.isPlaying) {
        ambientMusic.start(config.music_volume ?? 0.3);
      } else {
        ambientMusic.setVolume(config.music_volume ?? 0.3);
      }
    } else {
      // Quando jogo abre ou emulador embarcado roda: para IMEDIATAMENTE (sem fade-out residual)
      ambientMusic.stop({ immediate: !!(launching || emulator) });
    }
    return () => {};
  }, [config.music_enabled, config.music_volume, splashDone, launching, quitting, emulator]);

  // Unlock audio context na primeira interação (autoplay policy)
  // v0.8.49: once:true — listener auto-removido após primeira interacao.
  // Antes ficava ouvindo todo pointerdown/keydown da vida = overhead.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // v0.8.51: Toast de gamepad conectado/desconectado.
  // Web Gamepad API expoe gamepadconnected/gamepaddisconnected. Windows dispara
  // esses eventos quando user pluga USB, desliga BT, bateria acaba, etc.
  useEffect(() => {
    const onConnect = (e) => {
      const name = friendlyPadName(e.gamepad?.id);
      console.log("[gamepad] connected:", e.gamepad?.id, "mapping:", e.gamepad?.mapping);
      setGamepadEvent({ kind: "connected", name, ts: Date.now() });
      try { sfx.confirm(); } catch {}
    };
    const onDisconnect = (e) => {
      const name = friendlyPadName(e.gamepad?.id);
      console.log("[gamepad] disconnected:", e.gamepad?.id);
      setGamepadEvent({ kind: "disconnected", name, ts: Date.now() });
      try { sfx.back(); } catch {}
    };
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, []);

  // License check no startup. Roda ANTES do load_config completar pra evitar
  // mostrar a home brevemente. Se license existe local, tenta re-validar online;
  // se valido (ou cache no grace period), libera. Se nao, mostra LicenseGate.
  // Em build de desenvolvimento (PLACEHOLDER token), pula gate (libera tudo).
  // Em Android (APK): pula license gate (Paulo, 2026-05-17) MAS aplica demo time limit (7 dias).
  useEffect(() => {
    if (IS_ANDROID) {
      (async () => {
        try {
          const demo = await invoke("android_demo_status");
          setAndroidDemo(demo);
          if (demo.expired) {
            // Demo expirou - bloqueia entrada
            setLicenseStatus(false);
          } else {
            setLicenseStatus(true);
          }
        } catch (e) {
          console.warn("android_demo_status falhou:", e);
          setLicenseStatus(true);  // fallback: nao bloqueia
        }
      })();
      return;
    }
    (async () => {
      try {
        const localInfo = await invoke("license_get_local_info");
        if (!localInfo) { setLicenseStatus(false); return; }
        if (localInfo.valid) { setLicenseStatus(true); return; }
        // Tem license mas precisa re-validar
        try {
          const remote = await invoke("license_validate");
          setLicenseStatus(!!remote?.valid);
        } catch (e) {
          // grace period esgotou e nao conseguiu validar
          console.warn("license_validate falhou:", e);
          setLicenseStatus(false);
        }
      } catch (e) {
        // Build de dev (PLACEHOLDER): backend retorna erro = pula gate
        if (String(e).includes("nao configurado")) {
          console.info("License gate desabilitado (PLACEHOLDER token)");
          setLicenseStatus(true);
        } else {
          setLicenseStatus(false);
        }
      }
    })();
  }, []);

  // Re-validacao em background: 1x por semana enquanto app aberto
  useEffect(() => {
    if (licenseStatus !== true) return;
    const id = setInterval(() => {
      invoke("license_validate").then((info) => {
        if (info && !info.valid) setLicenseStatus(false);
      }).catch(() => {/* silent — grace period cuida */});
    }, 7 * 24 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [licenseStatus]);

  // load config no startup
  useEffect(() => {
    (async () => {
      try {
        const c = await invoke("load_config");
        if (c) setConfig(c);
        // First-run: ativa onboarding se nao tem profile ativo E nao tem first_run_done.
        // Configs migradas do Playbox (que ja tem profile) sao tratadas como done.
        // Em Android: skip onboarding completo (UX desktop com tour de controle nao serve mobile).
        const hasProfile = (c?.profiles || []).length > 0 && !!c?.active_profile_id;
        if (IS_ANDROID) {
          // Auto-cria profile default no primeiro launch em Android (skip tour completo)
          if (!hasProfile) {
            const defaultId = `p${Math.random().toString(36).slice(2, 10)}`;
            const newProfile = {
              id: defaultId,
              name: "Player",
              avatar_id: "controller",
              photo_path: null,
              created_at: Math.floor(Date.now() / 1000),
            };
            setConfig((prev) => ({
              ...(c || prev),
              profiles: [newProfile],
              active_profile_id: defaultId,
              first_run_done: true,
            }));
            try { await invoke("complete_first_run"); } catch (e) { console.warn("complete_first_run", e); }
          }
        } else if (!hasProfile && !c?.first_run_done) {
          setFirstRunActive(true);
        } else if ((c?.profiles || []).length === 0) {
          setProfilesOpen(true);
        }
      } catch (e) {
        console.error("load_config", e);
      }
      // Resolve paths default (autodetect: bundled emulators ao lado do .exe ou Documents)
      try {
        const [r, e] = await Promise.all([
          invoke("get_default_roms_root"),
          invoke("get_default_emulators_root"),
        ]);
        setRomsRoot(r || "");
        setEmulatorsRoot(e || "");
      } catch (err) {
        console.error("paths defaults", err);
      }
    })();
  }, []);

  // persist config quando muda
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    invoke("save_config", { config }).catch((e) => console.error("save_config", e));
  }, [config]);

  // aplicar tema
  useEffect(() => {
    const root = document.documentElement;
    let vars;
    if (config.theme_id === "custom" && config.custom_theme) {
      vars = customThemeVars(config.custom_theme);
    } else {
      const theme = THEMES.find((t) => t.id === config.theme_id) || THEMES[0];
      vars = theme.vars;
    }
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [config.theme_id, config.custom_theme]);

  // fullscreen state inicial
  useEffect(() => {
    (async () => {
      try {
        const w = getCurrentWindow();
        const fs = await w.isFullscreen();
        setIsFullscreen(fs);
      } catch {}
    })();
  }, []);

  // scan ROMs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await invoke("scan_roms", {});
        if (!cancelled) {
          setSystems(data);
          const firstWithGames = data.findIndex((s) => s.games.length > 0);
          if (firstWithGames >= 0) setSelectedSystemIdx(firstWithGames);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setScanError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setSelectedGameIdx(0); }, [selectedSystemIdx, sortMode]);
  // v0.8.49: auto-clamp se visibleGames encolheu (favoritos removidos, profile trocado etc)
  useEffect(() => {
    if (visibleGames.length === 0) {
      if (selectedGameIdx !== 0) setSelectedGameIdx(0);
    } else if (selectedGameIdx >= visibleGames.length) {
      setSelectedGameIdx(visibleGames.length - 1);
    }
  }, [visibleGames.length, selectedGameIdx]);
  // Quando trocar categoria, volta pro primeiro sistema (evita idx fora de range)
  useEffect(() => { setSelectedSystemIdx(0); }, [selectedCategoryId]);

  useEffect(() => {
    if (activeCardRef.current) {
      activeCardRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [selectedGameIdx, selectedSystemIdx]);

  // fetch covers do sistema atual
  useEffect(() => {
    if (!selected || selected.games.length === 0) return;
    if (selected.id === "_favorites") return; // virtual: usa cache dos sistemas originais
    if (fetchedSystems.current.has(selected.id)) return;
    fetchedSystems.current.add(selected.id);

    let cancelled = false;
    const queue = [...selected.games];
    async function worker() {
      while (queue.length > 0 && !cancelled) {
        const game = queue.shift();
        if (!game) break;
        try {
          const localPath = await invoke("fetch_cover", { systemId: selected.id, gameName: game.name });
          if (cancelled) return;
          setCovers((prev) => ({ ...prev, [game.path]: localPath ? convertFileSrc(localPath) : null }));
        } catch {
          setCovers((prev) => ({ ...prev, [game.path]: null }));
        }
      }
    }
    Promise.all(Array.from({ length: 4 }, worker)).catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  const updateActiveProfile = useCallback((updater) => {
    setConfig((prev) => {
      const idx = prev.profiles.findIndex((p) => p.id === prev.active_profile_id);
      if (idx < 0) return prev;
      const newProfiles = [...prev.profiles];
      newProfiles[idx] = updater(newProfiles[idx]);
      return { ...prev, profiles: newProfiles };
    });
  }, []);

  const checkAchievements = useCallback((profile) => {
    const current = new Set(profile.achievements || []);
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (!current.has(a.id) && a.check(profile)) {
        current.add(a.id);
        newly.push(a);
      }
    }
    return { achievements: Array.from(current), newly };
  }, []);

  const launchGameWithPath = useCallback(async (romPath) => {
    if (!selected || !selectedGame) return;
    sfx.confirm();
    setLaunching(true);
    setLaunchMsg({ kind: "launching", text: `Iniciando ${selectedGame.name}...` });
    // CRITICO: minimiza/oculta o launcher ANTES de spawn do emulador.
    // Se spawnar primeiro, o launcher continua em fullscreen exclusive segurando foco
    // -> emulador abre por baixo, Windows trata launcher como prioridade, qualquer
    //    botao do controle no emulador tambem chega no launcher e fecha o jogo.
    try {
      const w = getCurrentWindow();
      try { await w.setFullscreen(false); } catch {}
      try { await w.minimize(); } catch {}
      try { await w.hide(); } catch {}
    } catch (err) {
      console.warn("pre-launch hide", err);
    }
    try {
      await invoke("launch_game", { systemId: launchSystemId, romPath });
      setLaunchMsg({ kind: "ok", text: `${selectedGame.name} iniciado` });
      launchStartRef.current = {
        rom_path: selectedGame.path,
        rom_name: selectedGame.name,
        system_id: launchSystemId,
        started_at: Date.now(),
      };
      // Discord Rich Presence (silent no-op se nao configurado)
      const sysName = selected?.name || launchSystemId;
      invoke("discord_set_activity", { gameName: selectedGame.name, systemName: sysName }).catch(() => {});
      // total_launches/last_played/play_time agora são escritos pelo backend (launch_game + thread de wait).
      // O front só dispara achievement toast otimisticamente para o feedback imediato do "Primeiro Jogo".
      if (activeProfile) {
        const optimistic = {
          ...activeProfile,
          total_launches: (activeProfile.total_launches || 0) + 1,
        };
        const { newly } = checkAchievements(optimistic);
        if (newly.length > 0) {
          setAchievementToast(newly[0]);
          sfx.achievement();
        }
      }
      setTimeout(() => setLaunchMsg(null), 3000);
      // launching fica true ate game-killed event chegar (combo Select+R1 ou Select+Start).
    } catch (e) {
      setLaunchMsg({ kind: "error", text: String(e) });
      setTimeout(() => setLaunchMsg(null), 8000);
      setLaunching(false);
      // Restaura janela porque o emulador falhou ao abrir
      try {
        const w = getCurrentWindow();
        try { await w.show(); } catch {}
        try { await w.unminimize(); } catch {}
        try { await w.setFullscreen(true); } catch {}
        try { await w.setFocus(); } catch {}
      } catch {}
    }
  }, [selected, selectedGame, launchSystemId, activeProfile, updateActiveProfile, checkAchievements]);

  const handleLaunch = useCallback(() => {
    if (!selectedGame) return;
    if (selectedGame.discs && selectedGame.discs.length > 1) {
      sfx.open();
      setDiscPicker({ system: selected, game: selectedGame });
      return;
    }
    // Sistema com libretro_core configurado = roda EMBARCADO no Ludex
    if (selected?.libretro_core) {
      sfx.confirm();
      // Quick resume: se ja tem save, oferece continuar
      invoke("libretro_list_states", { romPath: selectedGame.path })
        .then((list) => {
          if (Array.isArray(list) && list.length > 0) {
            const latest = list.reduce((a, b) => (a.modified_at >= b.modified_at ? a : b));
            setResumePrompt({ system: selected, game: selectedGame, slot: latest.slot, when: latest.modified_at });
          } else {
            setEmulator({ system: selected, game: selectedGame, autoLoadSlot: null });
          }
        })
        .catch(() => {
          setEmulator({ system: selected, game: selectedGame, autoLoadSlot: null });
        });
      return;
    }
    launchGameWithPath(selectedGame.path);
  }, [selected, selectedGame, launchGameWithPath]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const w = getCurrentWindow();
      const fs = await w.isFullscreen();
      await w.setFullscreen(!fs);
      setIsFullscreen(!fs);
    } catch (e) { console.error(e); }
  }, []);

  const handleQuit = useCallback(async () => {
    if (quitting) return;
    setQuitting(true);
    sfx.shutdown();
    invoke("discord_clear_activity").catch(() => {});
    setTimeout(async () => {
      try {
        await invoke("quit_app");
      } catch (e) {
        console.error("quit_app", e);
        try { await getCurrentWindow().close(); } catch {}
      }
    }, 850);
  }, [quitting]);

  // Dispara animação + jingle ao trocar de plataforma (apenas após splash)
  useEffect(() => {
    if (!splashDone) return;
    if (!selected?.id) return;
    setSystemEnter({ id: selected.id, key: Date.now() });
    playPlatformJingle(selected.id);
  }, [selected?.id, splashDone]);

  // -------- Profiles --------
  const createProfile = useCallback(async ({ name, photoSourcePath, avatarId }) => {
    const id = genId();
    let photo_path = null;
    if (photoSourcePath) {
      try {
        photo_path = await invoke("save_profile_photo_from_path", {
          profileId: id,
          sourcePath: photoSourcePath,
        });
      } catch (e) { console.error("photo save", e); }
    }
    setConfig((prev) => ({
      ...prev,
      profiles: [...prev.profiles, {
        id, name, photo_path,
        avatar_id: photo_path ? null : (avatarId || null),
        created_at: Math.floor(Date.now() / 1000),
      }],
      active_profile_id: prev.active_profile_id || id,
    }));
    closeProfiles();
  }, [closeProfiles]);

  // Conclui o onboarding: cria profile, persiste, marca first_run_done no backend.
  const handleFirstRunComplete = useCallback(async ({ name, avatar, customPhotoPath }) => {
    await createProfile({
      name,
      avatarId: avatar?.id,
      photoSourcePath: customPhotoPath || null,
    });
    try { await invoke("complete_first_run"); } catch (e) { console.error("complete_first_run", e); }
    setFirstRunActive(false);
    sfx.confirm();
  }, [createProfile]);

  const selectProfile = useCallback((id) => {
    setConfig((prev) => ({ ...prev, active_profile_id: id }));
    closeProfiles();
  }, [closeProfiles]);

  const toggleFavorite = useCallback(() => {
    if (!selected || !selectedGame || !activeProfile) return;
    const path = selectedGame.path;
    const list = activeProfile.favorites || [];
    const has = list.includes(path);
    sfx.fav();
    updateActiveProfile((p) => {
      const newList = has ? list.filter((x) => x !== path) : [...list, path];
      const updated = { ...p, favorites: newList };
      const { achievements, newly } = checkAchievements(updated);
      if (newly.length > 0) {
        setAchievementToast(newly[0]);
        sfx.achievement();
      }
      return { ...updated, achievements };
    });
  }, [selected, selectedGame, activeProfile, updateActiveProfile, checkAchievements]);

  const deleteProfile = useCallback((id) => {
    setConfig((prev) => {
      const newProfiles = prev.profiles.filter((p) => p.id !== id);
      return {
        ...prev,
        profiles: newProfiles,
        active_profile_id: prev.active_profile_id === id
          ? (newProfiles[0]?.id || null)
          : prev.active_profile_id,
      };
    });
    invoke("delete_profile_photo", { profileId: id }).catch(() => {});
  }, []);

  const updateProfile = useCallback(async ({ id, name, photoSourcePath, clearPhoto, avatarId }) => {
    let nextPhotoPath = undefined; // undefined = nao mexer
    if (clearPhoto) {
      try { await invoke("delete_profile_photo", { profileId: id }); } catch (e) { console.error(e); }
      nextPhotoPath = null;
    } else if (photoSourcePath) {
      try {
        nextPhotoPath = await invoke("save_profile_photo_from_path", {
          profileId: id,
          sourcePath: photoSourcePath,
        });
      } catch (e) { console.error("photo save", e); }
    }
    setConfig((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => {
        if (p.id !== id) return p;
        const updated = { ...p, name };
        if (nextPhotoPath !== undefined) updated.photo_path = nextPhotoPath;
        // avatar_id so eh aplicado quando nao tem foto custom (avatarId vem null
        // do form quando a foto vence). Quando tem foto, avatar_id zera pra evitar
        // ambiguidade no display.
        if (avatarId !== undefined) {
          updated.avatar_id = avatarId; // pode ser null tambem (limpar)
        }
        return updated;
      }),
    }));
  }, []);

  // -------- Theme / Wallpaper --------
  const setTheme = useCallback((themeId) => {
    setConfig((prev) => ({
      ...prev,
      theme_id: themeId,
      // Inicializa custom_theme com default se ainda nao existe
      custom_theme: themeId === "custom" && !prev.custom_theme ? DEFAULT_CUSTOM_THEME : prev.custom_theme,
    }));
  }, []);

  const setCustomTheme = useCallback((customTheme) => {
    setConfig((prev) => ({ ...prev, custom_theme: customTheme }));
  }, []);

  const toggleMusic = useCallback(() => {
    setConfig((prev) => ({ ...prev, music_enabled: !prev.music_enabled }));
  }, []);

  const setMusicVolume = useCallback((vol) => {
    setConfig((prev) => ({ ...prev, music_volume: vol }));
  }, []);

  const pickWallpaper = useCallback(async () => {
    const sourcePath = await pickImageFile();
    if (!sourcePath) return;
    try {
      const path = await invoke("save_wallpaper_from_path", {
        imageId: genId(),
        sourcePath,
      });
      setConfig((prev) => ({ ...prev, wallpaper_path: path }));
    } catch (e) { console.error("wallpaper save", e); }
  }, []);

  const clearWallpaper = useCallback(() => {
    setConfig((prev) => ({ ...prev, wallpaper_path: null }));
  }, []);

  // (Antes: tracking de playtime via "focus" da janela. Agora o backend faz isso
  //  via thread.wait() do Child no launch_game e emite "game-ended" quando termina.)

  // -------- Re-escanear ROMs --------
  const rescanRoms = useCallback(async () => {
    setRescanBusy(true);
    try {
      const data = await invoke("scan_roms", {});
      setSystems(data);
      // limpa cache de fetched pra re-tentar capas/screens dos novos
      fetchedSystems.current.clear();
      fetchedShots.current.clear();
    } catch (e) { console.error("rescan", e); }
    setRescanBusy(false);
  }, []);

  // -------- Setup keys do Switch --------
  const setupSwitchKeys = useCallback(async () => {
    setSwitchKeysStatus({ busy: true, message: null, kind: null });
    try {
      const res = await invoke("setup_switch_keys", { romsRoot });
      const msg = `OK · keys: ${res.keys_copied ? "copiadas" : "nao encontradas"} · firmware: ${res.firmware_files} arquivos\n${res.yuzu_dir}`;
      setSwitchKeysStatus({ busy: false, message: msg, kind: "ok" });
    } catch (e) {
      setSwitchKeysStatus({ busy: false, message: String(e), kind: "error" });
    }
  }, []);

  // -------- Saves separados por perfil --------
  const refreshSavesStatus = useCallback(async () => {
    try {
      const slots = await invoke("list_save_slots");
      const enabled = (slots || []).some((s) => s.is_junction);
      setSavesStatus((prev) => ({ ...prev, enabled }));
    } catch {}
  }, []);
  useEffect(() => { refreshSavesStatus(); }, [refreshSavesStatus]);

  const toggleSavesIsolation = useCallback(async () => {
    if (!activeProfile) return;
    setSavesStatus({ busy: true, enabled: savesStatus.enabled, message: null, kind: null });
    try {
      let log;
      if (savesStatus.enabled) {
        log = await invoke("unlink_profile_saves");
        setSavesStatus({ busy: false, enabled: false, message: log.join("\n"), kind: "ok" });
      } else {
        log = await invoke("swap_profile_saves", { profileId: activeProfile.id, previousProfileId: null });
        setSavesStatus({ busy: false, enabled: true, message: log.join("\n"), kind: "ok" });
      }
    } catch (e) {
      setSavesStatus({ busy: false, enabled: savesStatus.enabled, message: String(e), kind: "error" });
    }
  }, [activeProfile, savesStatus.enabled]);

  // Auto-swap ao trocar de perfil ativo (se ja estava em modo isolado)
  const previousProfileIdRef = useRef(null);
  useEffect(() => {
    const prev = previousProfileIdRef.current;
    previousProfileIdRef.current = config.active_profile_id;
    if (!prev || prev === config.active_profile_id) return;
    if (!savesStatus.enabled) return;
    if (!config.active_profile_id) return;
    (async () => {
      try {
        await invoke("swap_profile_saves", {
          profileId: config.active_profile_id,
          previousProfileId: prev,
        });
      } catch (e) { console.error("auto swap saves", e); }
    })();
  }, [config.active_profile_id, savesStatus.enabled]);

  // -------- Helper pra selecionar jogo (usado pelo banner Continuar) --------
  const selectGameByPath = useCallback((systemId, romPath) => {
    const sysIdx = displayedSystems.findIndex((s) => s.id === systemId);
    if (sysIdx < 0) return;
    const gameIdx = displayedSystems[sysIdx].games.findIndex((g) => g.path === romPath);
    if (gameIdx < 0) return;
    setSelectedSystemIdx(sysIdx);
    setSelectedGameIdx(gameIdx);
    sfx.confirm();
  }, [displayedSystems]);

  // -------- Sync covers --------
  const openDetailPanel = useCallback((system, game) => {
    sfx.open();
    setDetailPanel({ system, game });
    setDetailClosing(false);
  }, []);

  const closeDetailPanel = useCallback(() => {
    if (!detailPanel) return;
    setDetailClosing(true);
    setTimeout(() => {
      setDetailPanel(null);
      setDetailClosing(false);
    }, MODAL_EXIT_MS);
  }, [detailPanel]);

  const openPreviewPopup = useCallback((system, game) => {
    sfx.open();
    setPreviewPopup({ system, game });
    setPreviewClosing(false);
  }, []);

  const closePreviewPopup = useCallback(() => {
    if (!previewPopup) return;
    setPreviewClosing(true);
    setTimeout(() => {
      setPreviewPopup(null);
      setPreviewClosing(false);
    }, MODAL_EXIT_MS);
  }, [previewPopup]);

  const openGameLocation = useCallback(async (game) => {
    try {
      sfx.confirm();
      await invoke("open_in_explorer", { path: game.path });
    } catch (e) {
      console.error("open_in_explorer", e);
      setLaunchMsg({ kind: "error", text: `Falha ao abrir local: ${e}` });
      setTimeout(() => setLaunchMsg(null), 2200);
    }
  }, []);

  const pickCustomCover = useCallback(async (systemId, game) => {
    try {
      const sourcePath = await pickImageFile();
      if (!sourcePath) return;
      sfx.confirm();
      const localPath = await invoke("set_custom_cover", {
        systemId,
        gameName: game.name,
        sourcePath,
      });
      setCovers((prev) => ({ ...prev, [game.path]: localPath ? convertFileSrc(localPath) : null }));
      setScreenshots((prev) => {
        const next = { ...prev };
        delete next[game.path];
        return next;
      });
      setLaunchMsg({ kind: "ok", text: `Capa atualizada: ${game.name}` });
      setTimeout(() => setLaunchMsg(null), 2200);
    } catch (e) {
      console.error("set_custom_cover", e);
      setLaunchMsg({ kind: "error", text: `Falha ao trocar capa: ${e}` });
      setTimeout(() => setLaunchMsg(null), 2200);
    }
  }, []);

  const confirmDeleteGame = useCallback((system, game) => {
    sfx.click();
    setDeleteConfirm({ system, game });
  }, []);

  const performDeleteGame = useCallback(async () => {
    if (!deleteConfirm) return;
    const { system, game } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      sfx.back();
      await invoke("delete_game_to_trash", {
        systemId: system.id,
        gameName: game.name,
        gamePath: game.path,
      });
      setLaunchMsg({ kind: "ok", text: `${game.name} enviado pra Lixeira` });
      setTimeout(() => setLaunchMsg(null), 2200);
      // Re-escaneia pra refletir
      try {
        const data = await invoke("scan_roms", { romsRoot: null });
        setSystems(data);
      } catch {}
    } catch (e) {
      console.error("delete_game_to_trash", e);
      setLaunchMsg({ kind: "error", text: `Falha ao excluir: ${e}` });
      setTimeout(() => setLaunchMsg(null), 2800);
    }
  }, [deleteConfirm]);

  const resyncSingleCover = useCallback(async (systemId, game) => {
    try {
      sfx.confirm();
      await invoke("clear_single_cover", { systemId, gameName: game.name });
      setCovers((prev) => {
        const next = { ...prev };
        delete next[game.path];
        return next;
      });
      setScreenshots((prev) => {
        const next = { ...prev };
        delete next[game.path];
        return next;
      });
      const localPath = await invoke("fetch_cover", { systemId, gameName: game.name });
      setCovers((prev) => ({ ...prev, [game.path]: localPath ? convertFileSrc(localPath) : null }));
      setLaunchMsg({
        kind: localPath ? "ok" : "error",
        text: localPath ? `Capa atualizada: ${game.name}` : `Sem capa encontrada pra ${game.name}`,
      });
      setTimeout(() => setLaunchMsg(null), 2200);
    } catch (e) {
      console.error("resyncSingleCover", e);
    }
  }, []);

  const syncCovers = useCallback(async () => {
    setSyncStatus({ busy: true, text: "limpando cache" });
    try {
      await invoke("clear_covers_cache", { systemId: null });
      fetchedSystems.current.clear();
      setCovers({});
      // re-disparar pro sistema atual
      if (selected) fetchedSystems.current.delete(selected.id);
      setSyncStatus({ busy: false, text: "" });
      // força reseleção pra triggerar fetch effect
      setSelectedSystemIdx((i) => i);
    } catch (e) {
      console.error(e);
      setSyncStatus({ busy: false, text: "" });
    }
  }, [selected]);

  // -------- Screenshot do jogo selecionado em background --------
  useEffect(() => {
    if (!selected || !selectedGame) return;
    const sysForFetch = launchSystemId;
    const key = `${sysForFetch}::${selectedGame.path}`;
    if (fetchedShots.current.has(key)) return;
    if (screenshots[selectedGame.path] !== undefined) return;
    fetchedShots.current.add(key);
    let cancelled = false;
    (async () => {
      try {
        const path = await invoke("fetch_screenshot", {
          systemId: sysForFetch,
          gameName: selectedGame.name,
        });
        if (cancelled) return;
        setScreenshots((prev) => ({ ...prev, [selectedGame.path]: path ? convertFileSrc(path) : null }));
      } catch {
        setScreenshots((prev) => ({ ...prev, [selectedGame.path]: null }));
      }
    })();
    return () => { cancelled = true; };
  }, [selected, selectedGame, launchSystemId, screenshots]);

  // -------- Listener: emulador foi morto pelo combo Select+Start --------
  useEffect(() => {
    let unlisten;
    listen("game-killed", async () => {
      setLaunching(false);
      setWelcomeBack(true);
      sfx.open();
      setTimeout(() => setWelcomeBack(false), 700);
      setLaunchMsg({ kind: "ok", text: "Jogo encerrado" });
      setTimeout(() => setLaunchMsg(null), 2200);
      invoke("discord_clear_activity").catch(() => {});
      // Restaura janela do launcher (foi escondida + minimizada ao iniciar jogo externo)
      try {
        const w = getCurrentWindow();
        try { await w.show(); } catch {}
        try { await w.unminimize(); } catch {}
        try { await w.setFullscreen(true); } catch {}
        try { await w.setFocus(); } catch {}
      } catch (err) {
        console.warn("restore on game-killed", err);
      }
    }).then((u) => { unlisten = u; });
    return () => { try { unlisten && unlisten(); } catch {} };
  }, []);

  // -------- Listener: emulador externo terminou (thread de wait registrou sessao) --------
  // Refetch config do disco pra atualizar play_time/sessions/last_played + dispara achievements.
  useEffect(() => {
    let unlisten;
    listen("game-ended", async () => {
      try {
        const c = await invoke("load_config");
        if (c) {
          setConfig(c);
          const profile = c.profiles?.find((p) => p.id === c.active_profile_id);
          if (profile) {
            const { achievements, newly } = checkAchievements(profile);
            if (newly.length > 0) {
              // Persist novos achievements no profile
              updateActiveProfile((p) => ({ ...p, achievements }));
              setAchievementToast(newly[0]);
              sfx.achievement();
            }
          }
        }
      } catch (e) {
        console.warn("game-ended refetch", e);
      }
    }).then((u) => { unlisten = u; });
    return () => { try { unlisten && unlisten(); } catch {} };
  }, [checkAchievements, updateActiveProfile]);

  // -------- Gamepad polling --------
  // Refs pra valores que mudam a cada navegacao. Sem isso o useEffect re-cria
  // o RAF e zera o cooldown -> 1 toque pula varios itens.
  const padCtxRef = useRef({
    selected: null,
    selectedGame: null,
    visibleGames: [],
    displayedSystems: [],
    handleLaunch: () => {},
    toggleFavorite: () => {},
    settingsOpen: false,
    profilesOpen: false,
    searchOpen: false,
    previewOpen: false,
    launching: false,
    emulatorOpen: false,
    focusZone: "games",
    setFocusZone: () => {},
    closeSettings: () => {},
    closeProfiles: () => {},
    closeSearch: () => {},
    openPreviewPopup: () => {},
  });
  // Handler de input de modal (cada modal seta o seu via useEffect ao montar).
  // Recebe action: "left"|"right"|"up"|"down"|"a"|"b"|"y"|"x"|"start"|"select"
  const modalGamepadRef = useRef(null);
  useEffect(() => {
    padCtxRef.current.selected = selected;
    padCtxRef.current.selectedGame = selectedGame;
    padCtxRef.current.visibleGames = visibleGames;
    padCtxRef.current.displayedSystems = displayedSystems;
    padCtxRef.current.handleLaunch = handleLaunch;
    padCtxRef.current.toggleFavorite = toggleFavorite;
    padCtxRef.current.settingsOpen = settingsOpen;
    padCtxRef.current.profilesOpen = profilesOpen;
    padCtxRef.current.searchOpen = searchOpen;
    padCtxRef.current.launching = launching;
    padCtxRef.current.emulatorOpen = !!emulator;
    padCtxRef.current.focusZone = focusZone;
    padCtxRef.current.setFocusZone = setFocusZone;
    padCtxRef.current.closeSettings = closeSettings;
    padCtxRef.current.closeProfiles = closeProfiles;
    padCtxRef.current.closeSearch = closeSearch;
    padCtxRef.current.previewOpen = !!previewPopup;
    padCtxRef.current.openPreviewPopup = openPreviewPopup;
    padCtxRef.current.systemSettingsOpen = !!settingsModal; // v0.8.39
    padCtxRef.current.closeSystemSettings = () => setSettingsModal(null); // v0.8.39
    padCtxRef.current.selectedCategoryId = selectedCategoryId; // v0.8.41
    padCtxRef.current.setSelectedCategoryId = setSelectedCategoryId; // v0.8.41
  });

  useEffect(() => {
    if (!splashDone) return;
    let raf;
    // estado de input persistente entre frames
    const st = {
      // edge detection: guarda se direcao estava pressionada no frame anterior
      prevLeft: false, prevRight: false, prevUp: false, prevDown: false,
      prevA: false, prevB: false, prevX: false, prevY: false,
      prevLB: false, prevRB: false, prevStart: false, prevSelect: false,
      prevLT: false, prevRT: false, // v0.8.41: triggers pra categoria
      // auto-repeat
      heldDir: null, heldSince: 0, lastRepeat: 0,
      // identificacao do controle ja anunciada
      announcedId: null,
    };
    const DEADZONE = 0.7;
    const REPEAT_DELAY = 380;   // tempo segurando antes de comecar a repetir
    const REPEAT_RATE = 110;    // intervalo entre repeticoes

    function navGame(delta) {
      const ctx = padCtxRef.current;
      if (!ctx.selected || ctx.visibleGames.length === 0) return;
      sfx.nav();
      setSelectedGameIdx((g) => Math.max(0, Math.min(ctx.visibleGames.length - 1, g + delta)));
    }
    function navSys(delta) {
      const ctx = padCtxRef.current;
      sfx.nav();
      setSelectedSystemIdx((i) => Math.max(0, Math.min(ctx.displayedSystems.length - 1, i + delta)));
    }
    // v0.8.41: navega categorias com LT/RT (L2/R2/ZL/ZR — botoes [6]/[7])
    function navCategory(delta) {
      const ctx = padCtxRef.current;
      const cats = SYSTEM_CATEGORIES;
      const cur = cats.findIndex(c => c.id === ctx.selectedCategoryId);
      if (cur < 0) return;
      const next = Math.max(0, Math.min(cats.length - 1, cur + delta));
      if (next !== cur) {
        sfx.nav();
        ctx.setSelectedCategoryId(cats[next].id);
      }
    }
    // Roteamento por zona: na zona "games", LEFT/RIGHT navega jogos, DOWN vai pra systems.
    // Na zona "systems", LEFT/RIGHT navega sistemas, UP volta pra games.
    // LB/RB sempre trocam sistema (atalho rapido independente da zona).
    function fireDir(dir) {
      const ctx = padCtxRef.current;
      if (dir === "lb") { navSys(-1); return; }
      if (dir === "rb") { navSys(1); return; }
      if (ctx.focusZone === "systems") {
        if (dir === "right") navSys(1);
        else if (dir === "left") navSys(-1);
        else if (dir === "up") { sfx.nav(); ctx.setFocusZone("games"); }
        // down em systems: nada (ja esta no fundo)
      } else { // games
        if (dir === "right") navGame(1);
        else if (dir === "left") navGame(-1);
        else if (dir === "down") { sfx.nav(); ctx.setFocusZone("systems"); }
        // up em games: nada (ja esta no topo)
      }
    }

    function poll() {
      try {
        // Se o launcher esta oculto/minimizado, NAO processa input.
        // Senao apertar botao no emulador externo (ex: B no Yuzu pra acao do jogo)
        // o launcher ve e dispara kill_running_game — fechando o jogo do nada.
        if (document.hidden || document.visibilityState !== "visible") {
          raf = requestAnimationFrame(poll);
          return;
        }
        const ctx = padCtxRef.current;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        // v0.8.40: Selecao inteligente de pad — Steam Input cria controle virtual
        // que aparece primeiro mas sem mapping "standard" ou sem botoes. Antes
        // pegavamos o primeiro pad nao-null e ja era. Agora:
        //   1) Prioriza pads com mapping="standard" (Xbox/DS4 via XInput)
        //   2) Se ja temos um "ativo" (teve input recente), mantem ele
        //   3) Senao pega primeiro standard, fallback pra primeiro qualquer
        let pad = null;
        const allConnected = [];
        for (const p of pads) { if (p) allConnected.push(p); }
        // Tenta primeiro standard
        for (const p of allConnected) {
          if (p.mapping === "standard") { pad = p; break; }
        }
        // Fallback: primeiro qualquer
        if (!pad && allConnected.length > 0) pad = allConnected[0];
        // Log uma vez quando aparece um pad novo (debug)
        if (pad && st.announcedId !== pad.id) {
          console.log("[gamepad]", pad.id, "mapping=", pad.mapping,
            "buttons=", pad.buttons.length, "axes=", pad.axes.length,
            "(", allConnected.length, "total connected)");
          st.announcedId = pad.id;
        }
        setGamepadConnected(!!pad);
        window.__pbGamepad = pad;
        // Pausa polling quando emulador embarcado roda (input deve ir pro libretro).
        if (!pad || ctx.emulatorOpen) {
          raf = requestAnimationFrame(poll);
          return;
        }
        // Quando ha modal aberto: input vai pro modal handler.
        // Modal handler retorna true se consumiu o input.
        // v0.8.39: inclui systemSettingsOpen — sem isso o gamepad navegava o
        // launcher por tras do modal de Opcoes do emulador, dando bug visual.
        const modalActive = ctx.settingsOpen || ctx.profilesOpen || ctx.searchOpen || ctx.previewOpen || ctx.systemSettingsOpen;
        if (modalActive) {
          const isStandardM = pad.mapping === "standard";
          const ax = pad.axes[0] || 0;
          const ay = pad.axes[1] || 0;
          const right = (isStandardM && !!pad.buttons[15]?.pressed) || ax > DEADZONE || (pad.axes[6] || 0) > 0.5;
          const left  = (isStandardM && !!pad.buttons[14]?.pressed) || ax < -DEADZONE || (pad.axes[6] || 0) < -0.5;
          const down  = (isStandardM && !!pad.buttons[13]?.pressed) || ay > DEADZONE || (pad.axes[7] || 0) > 0.5;
          const up    = (isStandardM && !!pad.buttons[12]?.pressed) || ay < -DEADZONE || (pad.axes[7] || 0) < -0.5;
          const aBtn  = isStandardM && !!pad.buttons[0]?.pressed;
          const bBtn  = isStandardM && !!pad.buttons[1]?.pressed;
          const xBtn  = isStandardM && !!pad.buttons[2]?.pressed;
          const yBtn  = isStandardM && !!pad.buttons[3]?.pressed;
          const startBtn  = isStandardM && !!pad.buttons[9]?.pressed;
          const selectBtn = isStandardM && !!pad.buttons[8]?.pressed;
          const now = performance.now();
          // direcao com edge + repeat
          let firedNow = null;
          if (right && !st.prevRight) firedNow = "right";
          else if (left && !st.prevLeft) firedNow = "left";
          else if (down && !st.prevDown) firedNow = "down";
          else if (up && !st.prevUp) firedNow = "up";
          if (firedNow) {
            modalGamepadRef.current?.(firedNow);
            st.heldDir = firedNow;
            st.heldSince = now;
            st.lastRepeat = now;
          } else {
            const stillHeld =
              (st.heldDir === "right" && right) ||
              (st.heldDir === "left" && left) ||
              (st.heldDir === "down" && down) ||
              (st.heldDir === "up" && up);
            if (stillHeld && now - st.heldSince > REPEAT_DELAY && now - st.lastRepeat > REPEAT_RATE) {
              modalGamepadRef.current?.(st.heldDir);
              st.lastRepeat = now;
            } else if (!stillHeld) {
              st.heldDir = null;
            }
          }
          st.prevRight = right; st.prevLeft = left; st.prevDown = down; st.prevUp = up;
          // botoes: edge detection
          if (aBtn && !st.prevA) modalGamepadRef.current?.("a");
          if (bBtn && !st.prevB) {
            // B fecha modal sempre (fallback se modal nao consumir)
            const consumed = modalGamepadRef.current?.("b");
            if (!consumed) {
              sfx.back();
              if (ctx.searchOpen) ctx.closeSearch();
              else if (ctx.profilesOpen) ctx.closeProfiles();
              else if (ctx.settingsOpen) ctx.closeSettings();
              else if (ctx.systemSettingsOpen) ctx.closeSystemSettings(); // v0.8.39
            }
          }
          if (xBtn && !st.prevX) modalGamepadRef.current?.("x");
          if (yBtn && !st.prevY) modalGamepadRef.current?.("y");
          if (startBtn && !st.prevStart) modalGamepadRef.current?.("start");
          if (selectBtn && !st.prevSelect) modalGamepadRef.current?.("select");
          st.prevA = aBtn; st.prevB = bBtn; st.prevX = xBtn; st.prevY = yBtn;
          st.prevStart = startBtn; st.prevSelect = selectBtn;
          raf = requestAnimationFrame(poll);
          return;
        }
        // Quando launching: SO processa combo Select+R1 pra cancelar (combo dificil de
        // disparar acidentalmente durante gameplay). Botao unico apertado no emulador
        // externo nao deve fechar o jogo via launcher.
        if (ctx.launching) {
          const isStandard2 = pad.mapping === "standard";
          const selectHeld = isStandard2 && !!pad.buttons[8]?.pressed; // Select / Back
          const r1Held = isStandard2 && !!pad.buttons[5]?.pressed;     // RB / R1
          const comboCancel = selectHeld && r1Held;
          if (comboCancel && !st.prevCancelCombo) {
            st.prevCancelCombo = true;
            sfx.back();
            invoke("kill_running_game").catch(() => {});
            setLaunching(false);
            setLaunchMsg(null);
            (async () => {
              try {
                const w = getCurrentWindow();
                try { await w.show(); } catch {}
                try { await w.unminimize(); } catch {}
                try { await w.setFullscreen(true); } catch {}
                try { await w.setFocus(); } catch {}
              } catch {}
            })();
          } else if (!comboCancel) {
            st.prevCancelCombo = false;
          }
          raf = requestAnimationFrame(poll);
          return;
        }
        // Anuncia controle quando muda
        if (st.announcedId !== pad.id) {
          st.announcedId = pad.id;
          // eslint-disable-next-line no-console
          console.warn(`[gamepad] conectado: "${pad.id}" mapping=${pad.mapping || "(none)"} buttons=${pad.buttons.length} axes=${pad.axes.length}`);
        }
        const isStandard = pad.mapping === "standard";
        const now = performance.now();
        const ax = pad.axes[0] || 0;
        const ay = pad.axes[1] || 0;
        // v0.8.40: D-pad/shoulder buttons tentam standard indices em QUALQUER pad
        // (era so isStandard). Indices 12-15 sao convencao quase universal.
        const dpRight = !!pad.buttons[15]?.pressed;
        const dpLeft  = !!pad.buttons[14]?.pressed;
        const dpDown  = !!pad.buttons[13]?.pressed;
        const dpUp    = !!pad.buttons[12]?.pressed;
        // Em controles non-standard, alguns mapeiam D-pad como axes[6]/axes[7] (HAT)
        const hatX = pad.axes[6] || 0;
        const hatY = pad.axes[7] || 0;
        const right = dpRight || ax > DEADZONE || hatX > 0.5;
        const left  = dpLeft  || ax < -DEADZONE || hatX < -0.5;
        const down  = dpDown  || ay > DEADZONE || hatY > 0.5;
        const up    = dpUp    || ay < -DEADZONE || hatY < -0.5;
        const lb    = !!pad.buttons[4]?.pressed;
        const rb    = !!pad.buttons[5]?.pressed;

        // edge: dispara so na transicao false->true
        let firedNow = null;
        if (right && !st.prevRight) firedNow = "right";
        else if (left && !st.prevLeft) firedNow = "left";
        else if (down && !st.prevDown) firedNow = "down";
        else if (up && !st.prevUp) firedNow = "up";
        else if (rb && !st.prevRB) firedNow = "rb";
        else if (lb && !st.prevLB) firedNow = "lb";

        if (firedNow) {
          fireDir(firedNow);
          st.heldDir = firedNow;
          st.heldSince = now;
          st.lastRepeat = now;
        } else {
          // auto-repeat se a direcao continua segurada
          const stillHeld =
            (st.heldDir === "right" && right) ||
            (st.heldDir === "left" && left) ||
            (st.heldDir === "down" && down) ||
            (st.heldDir === "up" && up) ||
            (st.heldDir === "rb" && rb) ||
            (st.heldDir === "lb" && lb);
          if (stillHeld && now - st.heldSince > REPEAT_DELAY && now - st.lastRepeat > REPEAT_RATE) {
            fireDir(st.heldDir);
            st.lastRepeat = now;
          } else if (!stillHeld) {
            st.heldDir = null;
          }
        }

        st.prevRight = right; st.prevLeft = left; st.prevDown = down; st.prevUp = up;
        st.prevLB = lb; st.prevRB = rb;

        // v0.8.41: triggers LT/RT (L2/R2/ZL/ZR) navegam CATEGORIAS (TODOS/NINTENDO/SONY/SEGA/etc).
        // No standard W3C gamepad: [6]=LT/L2/ZL, [7]=RT/R2/ZR. Detecta tanto digital
        // (pressed) quanto analogico (value>0.5) pra cobrir pads que so reportam value.
        const ltVal = pad.buttons[6]?.value || 0;
        const rtVal = pad.buttons[7]?.value || 0;
        const lt = !!pad.buttons[6]?.pressed || ltVal > 0.5;
        const rt = !!pad.buttons[7]?.pressed || rtVal > 0.5;
        if (lt && !st.prevLT) navCategory(-1);
        if (rt && !st.prevRT) navCategory(1);
        st.prevLT = lt; st.prevRT = rt;

        // v0.8.40: Aceita botoes em QUALQUER pad (era so standard). Steam Input,
        // DInput, e alguns pads BT reportam mapping="" mas seguem convencao
        // [0]=A/X, [1]=B/O, [9]=Start. Se errado, user adapta — melhor que dead.
        {
          const a = !!pad.buttons[0]?.pressed;
          const b = !!pad.buttons[1]?.pressed;
          const x = !!pad.buttons[2]?.pressed;
          const y = !!pad.buttons[3]?.pressed;
          const start = !!pad.buttons[9]?.pressed;
          const select = !!pad.buttons[8]?.pressed;

          // A: contextual conforme zona
          if (a && !st.prevA) {
            if (ctx.focusZone === "systems") {
              // confirmar sistema selecionado e voltar pra zona de jogos
              sfx.confirm();
              ctx.setFocusZone("games");
            } else if (ctx.selectedGame) {
              ctx.handleLaunch();
            }
          }
          // B: voltar pra zona systems (ou nada se ja la)
          if (b && !st.prevB && ctx.focusZone === "games") {
            sfx.back();
            ctx.setFocusZone("systems");
          }
          if (y && !st.prevY) { sfx.confirm(); setSettingsOpen(true); }
          // X = abre preview popup do jogo selecionado (Profiles agora via Y -> Settings -> Trocar perfil)
          if (x && !st.prevX) {
            if (ctx.focusZone === "games" && ctx.selectedGame) {
              ctx.openPreviewPopup(ctx.selected, ctx.selectedGame);
            }
          }
          if (start && !st.prevStart) { sfx.confirm(); setSearchOpen(true); }
          if (select && !st.prevSelect) ctx.toggleFavorite();

          st.prevA = a; st.prevB = b; st.prevX = x; st.prevY = y;
          st.prevStart = start; st.prevSelect = select;
        }
      } catch (err) {
        console.error("gamepad poll error", err);
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [splashDone]);

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (!splashDone) return;
      if (e.key === "F11") { e.preventDefault(); toggleFullscreen(); return; }
      if (e.key === "F2") { e.preventDefault(); setGamepadDebug((v) => !v); return; }

      // Cancelar tela "Iniciando..." se travada (emulador externo bugou)
      if (launching && (e.key === "Escape" || e.key === "Backspace")) {
        e.preventDefault();
        sfx.back();
        invoke("kill_running_game").catch(() => {});
        setLaunching(false);
        setLaunchMsg(null);
        (async () => {
          try {
            const w = getCurrentWindow();
            try { await w.show(); } catch {}
            try { await w.unminimize(); } catch {}
            try { await w.setFullscreen(true); } catch {}
            try { await w.setFocus(); } catch {}
          } catch {}
        })();
        return;
      }

      if (searchOpen) {
        // search lida com Escape internamente
        return;
      }
      if (profilesOpen) {
        if (e.key === "Escape") { e.preventDefault(); closeProfiles(); sfx.back(); }
        return;
      }
      if (settingsOpen) {
        if (e.key === "Escape") { e.preventDefault(); closeSettings(); sfx.back(); }
        return;
      }

      if (e.key === "/" ) { e.preventDefault(); sfx.confirm(); setSearchOpen(true); return; }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); sfx.confirm(); setSettingsOpen(true); return; }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); pickRandomGame(); return; }
      if (e.key === "p" || e.key === "P") { e.preventDefault(); sfx.confirm(); setProfilesOpen(true); return; }
      if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFavorite(); return; }
      if ((e.key === "d" || e.key === "D") && selected && selectedGame) { e.preventDefault(); openDetailPanel(selected, selectedGame); return; }
      if (e.key === "Escape") { e.preventDefault(); sfx.confirm(); setSettingsOpen(true); return; }

      if (loading || displayedSystems.length === 0) return;
      // Navegacao por zona (mesma logica do gamepad)
      if (e.key === "ArrowRight") {
        e.preventDefault(); sfx.nav();
        if (focusZone === "util") {
          setUtilIdx((i) => Math.min(1, i + 1));
        } else if (focusZone === "systems") {
          if (selectedSystemIdx >= displayedSystems.length - 1) {
            // Passa pra bottom bar (Configuracoes / Sair)
            setFocusZone("util"); setUtilIdx(0);
          } else {
            setSelectedSystemIdx((i) => i + 1);
          }
        } else if (visibleGames.length > 0) {
          setSelectedGameIdx((g) => Math.min(visibleGames.length - 1, g + 1));
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault(); sfx.nav();
        if (focusZone === "util") {
          if (utilIdx <= 0) {
            setFocusZone("systems"); setUtilIdx(-1);
          } else {
            setUtilIdx((i) => i - 1);
          }
        } else if (focusZone === "systems") {
          setSelectedSystemIdx((i) => Math.max(0, i - 1));
        } else if (visibleGames.length > 0) {
          setSelectedGameIdx((g) => Math.max(0, g - 1));
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (focusZone === "games") { sfx.nav(); setFocusZone("systems"); }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (focusZone === "systems") { sfx.nav(); setFocusZone("games"); }
        else if (focusZone === "util") { sfx.nav(); setFocusZone("systems"); setUtilIdx(-1); }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (focusZone === "util") {
          sfx.confirm();
          if (utilIdx === 0) { setSettingsOpen(true); }
          else if (utilIdx === 1) { handleQuit(); }
        } else if (focusZone === "systems") { sfx.confirm(); setFocusZone("games"); }
        else if (selectedGame) handleLaunch();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        if (focusZone === "util") { sfx.back(); setFocusZone("systems"); setUtilIdx(-1); }
        else if (focusZone === "games") { sfx.back(); setFocusZone("systems"); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [splashDone, settingsOpen, profilesOpen, searchOpen, loading, displayedSystems, selected, selectedGame, handleLaunch, toggleFullscreen, toggleFavorite, launching, focusZone, visibleGames.length]);

  // License gate: bloqueia o app antes de qualquer outra coisa
  if (licenseStatus === null) {
    // Ainda checando — render minimo (preto), evita flash
    return <div style={{ position: "fixed", inset: 0, background: "#04020c" }} />;
  }
  // Android: demo expirada bloqueia com tela propria (em vez do LudexLicenseGate desktop)
  if (IS_ANDROID && androidDemo?.expired) {
    return <AndroidDemoExpired demo={androidDemo} onUnlock={(newDemo) => { setAndroidDemo(newDemo); setLicenseStatus(true); }} />;
  }
  if (licenseStatus === false) {
    return <LudexLicenseGate onLicensed={() => setLicenseStatus(true)} />;
  }

  // ANDROID: layout mobile dedicado (touch-first, sem hints/topbar desktop).
  // Reusa todo state via closure — todos os modais (settings, preview, detail)
  // continuam disponiveis pela closure tambem.
  if (IS_ANDROID) {
    return (
      <div className="lx-mobile">
        {!splashDone && <SplashScreen profileName={activeProfile?.name} />}

        {/* Header mobile compacto */}
        <header className="lx-mobile-header">
          <button
            className="lx-mobile-btn-icon"
            onClick={() => { sfx.open(); setSystemPickerOpen(true); }}
            aria-label="Trocar sistema"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>

          <div className="lx-mobile-title-wrap">
            <div className="lx-mobile-brand">LUDEX</div>
            {selected && (
              <button
                className="lx-mobile-system-chip"
                style={{ "--sys-color": selected.color }}
                onClick={() => { sfx.open(); setSystemPickerOpen(true); }}
              >
                <span className="lx-mobile-system-icon"><SystemIcon id={selected.id} /></span>
                <span className="lx-mobile-system-name">{selected.name}</span>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>

          {androidDemo && !androidDemo.is_admin_unlocked && androidDemo.days_left > 0 && (
            <div className={`lx-mobile-demo ${androidDemo.days_left <= 2 ? "warn" : ""}`}>
              {androidDemo.days_left}d
            </div>
          )}

          <button
            className="lx-mobile-btn-icon"
            onClick={() => { sfx.confirm(); setSettingsOpen(true); }}
            aria-label="Configuracoes"
          >
            <GearIcon />
          </button>
        </header>

        {/* Busca compacta */}
        <div className="lx-mobile-search">
          <button
            className="lx-mobile-search-btn"
            onClick={() => { sfx.confirm(); setSearchOpen(true); }}
          >
            <SearchIcon />
            <span>Buscar jogo</span>
          </button>
        </div>

        {/* Grid de jogos */}
        <main className="lx-mobile-main">
          {loading && <div className="lx-mobile-msg">Carregando...</div>}
          {scanError && (
            <div className="lx-mobile-msg lx-mobile-msg-error">
              <strong>Falha no scan</strong>
              <span>{scanError}</span>
            </div>
          )}

          {!loading && !scanError && selected && visibleGames.length === 0 && (
            <div className="lx-mobile-empty">
              <h2>Sem jogos de {selected.name} ainda</h2>
              <p>
                Coloque suas ROMs em <code>/storage/emulated/0/Ludex/roms/{selected.folder_name}/</code> e
                volte aqui — o Ludex detecta automaticamente.
              </p>
            </div>
          )}

          {!loading && visibleGames.length > 0 && (
            <div className="lx-mobile-grid">
              {visibleGames.map((g, i) => {
                const cover = covers[g.path];
                const hasCover = typeof cover === "string" && cover.length > 0;
                const isFav = favoriteSet.has(g.path);
                return (
                  <button
                    key={g.path}
                    className={`lx-mobile-card ${hasCover ? "has-cover" : ""}`}
                    style={{ "--card-color": selected.color, animationDelay: `${i * 30}ms` }}
                    onClick={() => { sfx.click(); setSelectedGameIdx(i); openPreviewPopup(selected, g); }}
                  >
                    {hasCover ? (
                      <img className="lx-mobile-card-cover" src={cover} alt={g.name} loading="lazy" />
                    ) : (
                      <div className="lx-mobile-card-fallback" style={{ background: selected.color }}>
                        <div className="lx-mobile-card-icon"><SystemIcon id={selected.id} /></div>
                        <div className="lx-mobile-card-title">{g.name}</div>
                      </div>
                    )}
                    {isFav && <span className="lx-mobile-card-fav"><StarIcon filled /></span>}
                  </button>
                );
              })}
            </div>
          )}
        </main>

        {/* Bottom sheet: system picker (categorias + sistemas) */}
        {systemPickerOpen && (
          <div className="lx-mobile-sheet-backdrop" onClick={() => setSystemPickerOpen(false)}>
            <div className="lx-mobile-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="lx-mobile-sheet-handle" />
              <div className="lx-mobile-sheet-header">
                <h3>Sistemas</h3>
                <button className="lx-mobile-btn-icon" onClick={() => setSystemPickerOpen(false)}>
                  <CloseIcon />
                </button>
              </div>
              <div className="lx-mobile-sheet-cats">
                {SYSTEM_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    className={`lx-mobile-cat ${selectedCategoryId === cat.id ? "active" : ""}`}
                    onClick={() => { sfx.switchSys(); setSelectedCategoryId(cat.id); }}
                  >
                    <CategoryIcon id={cat.id} />
                    <span>{cat.name}</span>
                  </button>
                ))}
              </div>
              <div className="lx-mobile-sheet-systems">
                {displayedSystems.map((sys, i) => {
                  const isActive = i === selectedSystemIdx;
                  return (
                    <button
                      key={`${selectedCategoryId}-${sys.id}`}
                      className={`lx-mobile-sheet-sys ${isActive ? "active" : ""}`}
                      style={{ "--sys-color": sys.color }}
                      onClick={() => {
                        sfx.confirm();
                        setSelectedSystemIdx(i);
                        setSystemPickerOpen(false);
                      }}
                    >
                      <span className="lx-mobile-sheet-sys-icon"><SystemIcon id={sys.id} /></span>
                      <span className="lx-mobile-sheet-sys-name">{sys.name}</span>
                      <span className="lx-mobile-sheet-sys-count">
                        {sys.games.length > 0 ? `${sys.games.length} jogos` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Reuso dos modais existentes (preview, detail, settings, etc) */}
        {previewPopup && (
          <GamePreviewPopup
            closing={previewClosing}
            system={previewPopup.system}
            game={previewPopup.game}
            playTimeSec={(activeProfile?.play_time?.[`${previewPopup.system.id}::${previewPopup.game.path}`]) || 0}
            isFavorite={favoriteSet.has(previewPopup.game.path)}
            onClose={closePreviewPopup}
            onLaunch={() => { closePreviewPopup(); setTimeout(() => handleLaunch(), MODAL_EXIT_MS); }}
            onOpenDetails={() => { const p = previewPopup; closePreviewPopup(); setTimeout(() => openDetailPanel(p.system, p.game), MODAL_EXIT_MS); }}
            modalGamepadRef={modalGamepadRef}
            detailsCache={detailsCacheRef}
          />
        )}

        {detailPanel && (
          <GameDetailPanel
            closing={detailClosing}
            system={detailPanel.system}
            game={detailPanel.game}
            playTimeSec={(activeProfile?.play_time?.[`${detailPanel.system.id}::${detailPanel.game.path}`]) || 0}
            isFavorite={favoriteSet.has(detailPanel.game.path)}
            gameMeta={gameMetaMap[`${detailPanel.system.id}::${detailPanel.game.path}`]}
            onClose={closeDetailPanel}
            onLaunch={() => { closeDetailPanel(); setTimeout(() => handleLaunch(), MODAL_EXIT_MS); }}
            onPickCover={() => pickCustomCover(detailPanel.system.id, detailPanel.game)}
            onResyncCover={() => resyncSingleCover(detailPanel.system.id, detailPanel.game)}
            onOpenLocation={() => openGameLocation(detailPanel.game)}
            onToggleFavorite={() => toggleFavorite()}
            onSetRating={(rating) => setGameRating(detailPanel.system.id, detailPanel.game.path, rating)}
            onSetStatus={(status) => setGameStatus(detailPanel.system.id, detailPanel.game.path, status)}
            onSetNotes={(notes) => setGameNotes(detailPanel.system.id, detailPanel.game.path, notes)}
          />
        )}

        {settingsOpen && (
          <SettingsPanel
            closing={settingsClosing}
            onClose={closeSettings}
            modalGamepadRef={modalGamepadRef}
            systems={systems}
            romsRoot={romsRoot}
            emulatorsRoot={emulatorsRoot}
            onToggleFullscreen={toggleFullscreen}
            onQuit={handleQuit}
            isFullscreen={isFullscreen}
            config={config}
            onSetTheme={(id) => { sfx.confirm(); setTheme(id); }}
            onSetCustomTheme={setCustomTheme}
            onPickWallpaper={pickWallpaper}
            onClearWallpaper={clearWallpaper}
            onSyncCovers={syncCovers}
            syncStatus={syncStatus}
            onRescan={rescanRoms}
            rescanBusy={rescanBusy}
            onOpenProfiles={() => { closeSettings(); setTimeout(() => setProfilesOpen(true), MODAL_EXIT_MS); }}
            activeProfile={activeProfile}
            onSetupSwitchKeys={setupSwitchKeys}
            switchKeysStatus={switchKeysStatus}
            onToggleSavesIsolation={toggleSavesIsolation}
            savesStatus={savesStatus}
            onToggleMusic={toggleMusic}
            onSetMusicVolume={setMusicVolume}
            onShowLogs={() => { closeSettings(); setTimeout(() => setLogsOpen(true), MODAL_EXIT_MS); }}
            onShowHealth={() => { closeSettings(); setTimeout(() => setHealthOpen(true), MODAL_EXIT_MS); }}
            onOpenSuggestions={() => { closeSettings(); setTimeout(() => { setSuggestionsTab("roms"); setSuggestionsOpen(true); }, MODAL_EXIT_MS); }}
            sfx={sfx}
            ambientMusic={ambientMusic}
            THEMES={THEMES}
            DEFAULT_CUSTOM_THEME={DEFAULT_CUSTOM_THEME}
            ACHIEVEMENTS={ACHIEVEMENTS}
            CustomThemeEditor={CustomThemeEditor}
            CollectionStats={CollectionStats}
            TopPlayedList={TopPlayedList}
            SessionsGraph={SessionsGraph}
            LicenseSettingsSection={LicenseSettingsSection}
          />
        )}

        {searchOpen && (
          <SearchPanel
            closing={searchClosing}
            onClose={closeSearch}
            systems={systems}
            covers={covers}
            modalGamepadRef={modalGamepadRef}
            onPick={({ system, game }) => {
              closeSearch();
              const sysIdx = displayedSystems.findIndex(s => s.id === system.id);
              if (sysIdx >= 0) setSelectedSystemIdx(sysIdx);
              setTimeout(() => openPreviewPopup(system, game), MODAL_EXIT_MS);
            }}
          />
        )}

        {launching && (
          <div className="lx-mobile-launching">
            <div className="lx-mobile-spinner" />
            <div>{launchMsg?.text || "Iniciando..."}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`pb ${quitting ? "quitting" : ""}`} style={{ "--accent": accentColor }}>
      {/* wallpaper customizado */}
      {config.wallpaper_path && (
        <img className="pb-wallpaper" src={convertFileSrc(config.wallpaper_path)} alt="" aria-hidden />
      )}

      {/* fundo: screenshot (preferido) ou capa em blur */}
      {selectedBgSrc && (
        <img key={selectedBgSrc} className="pb-bg-cover" src={selectedBgSrc} alt="" aria-hidden />
      )}

      {/* fundo: tinta sutil de cor do sistema (suprime se tem wallpaper) */}
      {!config.wallpaper_path && (
        <div className="pb-bg" aria-hidden>
          <div className="pb-bg-blob pb-bg-blob-1" />
        </div>
      )}

      {!splashDone && <SplashScreen profileName={activeProfile?.name} />}

      {/* v0.8.21: update banner (nao bloqueia, user adia se quiser) */}
      {updateBanner && !updateInstalling && (
        <div className="pb-update-banner">
          <div className="pb-update-banner-text">
            <strong>Atualizacao disponivel: v{updateBanner.version}</strong>
            <span>Reinicie depois da instalacao pra usar a versao nova.</span>
          </div>
          <button className="pb-btn pb-btn-primary" onClick={async () => {
            setUpdateInstalling(true);
            try {
              let downloaded = 0; let total = 0;
              await updateBanner.update.downloadAndInstall((ev) => {
                if (ev.event === "Started") total = ev.data.contentLength || 0;
                if (ev.event === "Progress") {
                  downloaded += ev.data.chunkLength || 0;
                  setUpdateProgress(total ? Math.round((downloaded / total) * 100) : 0);
                }
              });
              await relaunch();
            } catch (e) { alert("Falha update: " + e); setUpdateInstalling(false); }
          }}>Atualizar</button>
          <button className="pb-btn" onClick={() => setUpdateBanner(null)}>Depois</button>
        </div>
      )}
      {updateInstalling && (
        <div className="pb-update-banner pb-update-installing">
          <strong>Baixando atualizacao... {updateProgress}%</strong>
        </div>
      )}

      <header className="pb-top" data-tour="topbar">
        <div className="pb-top-left">
          {activeProfile ? (
            <button className="pb-top-avatar" onClick={() => { sfx.open(); setProfilesOpen(true); }} title="Trocar perfil (P)">
              <div className="pb-profile-avatar pb-profile-avatar-sm">
                {(() => {
                  const src = getProfileAvatarUrl(activeProfile, convertFileSrc);
                  return src ? <img src={src} alt="" /> : <UserIcon />;
                })()}
              </div>
            </button>
          ) : (
            <button className="pb-top-avatar" onClick={() => { sfx.open(); setProfilesOpen(true); }} title="Criar perfil (P)">
              <div className="pb-profile-avatar pb-profile-avatar-sm"><UserIcon /></div>
            </button>
          )}
          {selected && (
            <div className="pb-top-system" key={`top-sys-${selected.id}`}>
              <span className="pb-top-system-icon" style={{ color: selected.color }}>
                <SystemIcon id={selected.id} />
              </span>
              <span className="pb-top-system-name">{selected.name}</span>
            </div>
          )}
          {/* Demo Android: contador de dias restantes */}
          {IS_ANDROID && androidDemo && !androidDemo.is_admin_unlocked && androidDemo.days_left > 0 && (
            <div className={`pb-android-demo-pill ${androidDemo.days_left <= 2 ? "warn" : ""}`} title="Demo gratuita Android">
              DEMO · {androidDemo.days_left} dia{androidDemo.days_left === 1 ? "" : "s"}
            </div>
          )}
          {selected && (
            <div className="lx-top-sys-actions">
              <button
                className="lx-top-sys-btn"
                title="Abrir pasta de ROMs"
                onClick={async () => {
                  sfx.click();
                  try {
                    const f = await invoke("get_system_folders", { systemId: selected.id });
                    await invoke("open_folder", { path: f.roms_path });
                  } catch (e) { console.error(e); }
                }}
              >
                <LxFolderIcon /><span>ROMs</span>
              </button>
              <button
                className="lx-top-sys-btn"
                title="Abrir pasta de DLCs"
                onClick={async () => {
                  sfx.click();
                  try {
                    const f = await invoke("get_system_folders", { systemId: selected.id });
                    await invoke("open_folder", { path: f.dlc_path });
                  } catch (e) { console.error(e); }
                }}
              >
                <LxGiftIcon /><span>DLCs</span>
              </button>
              <button
                className="lx-top-sys-btn"
                title="Abrir pasta de Mods/Patches"
                onClick={async () => {
                  sfx.click();
                  try {
                    const f = await invoke("get_system_folders", { systemId: selected.id });
                    await invoke("open_folder", { path: f.mods_path });
                  } catch (e) { console.error(e); }
                }}
              >
                <LxToolsIcon /><span>Mods</span>
              </button>
              <button
                className="lx-top-sys-btn"
                title="Onde baixar (guia de fontes)"
                onClick={() => { sfx.open(); setSuggestionsTab("roms"); setSuggestionsOpen(true); }}
              >
                <LxGlobeIcon /><span>Sites</span>
              </button>
              {hasOptionsForSystem(selected.id) && (
                <button
                  className="lx-top-sys-btn"
                  title="Configurar opções do emulador (resolução, performance, etc)"
                  onClick={() => { sfx.open(); setSettingsModal({ systemId: selected.id }); }}
                >
                  <LxToolsIcon /><span>Opções</span>
                </button>
              )}
              <button
                className="lx-top-sys-btn"
                title="Configurar controle deste emulador"
                onClick={() => { sfx.open(); setControlsTip({ system: selected }); }}
              >
                <LxGamepadIcon /><span>Controle</span>
              </button>
            </div>
          )}
        </div>
        <div className="pb-top-right">
          <button
            className="pb-search-pill"
            onClick={() => { sfx.confirm(); setSearchOpen(true); }}
            title="Buscar jogo (/)"
          >
            <SearchIcon />
            <span className="pb-search-pill-label">Buscar jogo</span>
            <kbd className="pb-search-pill-kbd">/</kbd>
          </button>
          <button className="pb-icon-btn" onClick={pickRandomGame} title="Surpresa! (R) — escolhe jogo aleatorio">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2.5" />
              <circle cx="8" cy="8" r="1.4" fill="currentColor" />
              <circle cx="16" cy="8" r="1.4" fill="currentColor" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" />
              <circle cx="8" cy="16" r="1.4" fill="currentColor" />
              <circle cx="16" cy="16" r="1.4" fill="currentColor" />
            </svg>
          </button>
          <button className="pb-icon-btn" data-tour="settings" onClick={() => { sfx.confirm(); setSettingsOpen(true); }} title="Configuracoes (S)"><GearIcon /></button>
          {gamepadConnected && <span className="pb-gamepad-indicator" title="Controle conectado"><GamepadIcon /></span>}
          <span className="pb-clock">{time}</span>
        </div>
      </header>

      <main className="pb-stage">
        {loading && <div className="pb-stage-msg">Carregando...</div>}
        {scanError && (
          <div className="pb-stage-msg pb-stage-error">
            <strong>Falha no scan</strong>
            <span>{scanError}</span>
          </div>
        )}

        {!loading && !scanError && activeProfile?.last_played && (() => {
          const lp = activeProfile.last_played;
          const cover = covers[lp.rom_path];
          const lpSystem = systems.find((s) => s.id === lp.system_id);
          if (!lpSystem) return null;
          if (!lpSystem.games.find((g) => g.path === lp.rom_path)) return null;
          return (
            <ContinueBanner
              lastPlayed={lp}
              system={lpSystem}
              coverSrc={cover}
              onResume={() => selectGameByPath(lp.system_id, lp.rom_path)}
            />
          );
        })()}

        {!loading && !scanError && selected && (
          <>
            <div className="pb-stage-header" key={`hdr-${selected.id}-${selectedGameIdx}`}>
              <div className="pb-game-tag">
                <span className="pb-game-tag-icon" style={{ color: selected.color }}>
                  <SystemIcon id={selected.id} />
                </span>
                {visibleGames.length > 0 ? (
                  <span className="pb-game-tag-name">{selectedGame?.name}</span>
                ) : selected.games.length > 0 ? (
                  <span className="pb-game-tag-name pb-game-tag-name-muted">
                    {selected.name} · nenhum jogo no filtro "{sortMode}"
                  </span>
                ) : (
                  <span className="pb-game-tag-name pb-game-tag-name-muted">
                    {selected.folder_exists ? `${selected.name} · pasta vazia` : `${selected.name} · pasta /${selected.folder_name} nao existe`}
                  </span>
                )}
              </div>
              {selected.games.length > 0 && (
                <div className="pb-sort-pills" data-tour="sort">
                  {[
                    { id: "default", label: "Padrão" },
                    { id: "az",       label: "A-Z" },
                    { id: "recent",   label: "Recentes" },
                    { id: "playtime", label: "Mais jogados" },
                    { id: "fav",      label: "★ Favoritos" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      className={`pb-sort-pill ${sortMode === opt.id ? "active" : ""}`}
                      onClick={() => { sfx.click(); setSortMode(opt.id); }}
                    >{opt.label}</button>
                  ))}
                </div>
              )}
            </div>

            {visibleGames.length > 0 && (
              <div className="pb-grid-wrap" key={`grid-${selected.id}-${sortMode}`} data-tour="grid">
                <div className="pb-grid">
                  {visibleGames.map((g, i) => {
                    const cover = covers[g.path];
                    const hasCover = typeof cover === "string" && cover.length > 0;
                    const isFav = favoriteSet.has(g.path);
                    const sysId = g._origin_system_id || selected.id;
                    const ptKey = `${sysId}::${g.path}`;
                    const playSec = activeProfile?.play_time?.[ptKey] || 0;
                    const meta = gameMetaMap[ptKey];
                    const metaStatus = meta?.status || "";
                    const metaRating = meta?.rating || 0;
                    return (
                      <div key={g.path} className="pb-card-wrap">
                        <button
                          ref={i === selectedGameIdx ? activeCardRef : null}
                          className={`pb-card ${i === selectedGameIdx ? (focusZone === "games" ? "active focused" : "active") : ""} ${hasCover ? "has-cover" : ""}`}
                          style={{ "--card-color": selected.color, animationDelay: `${i * 40}ms` }}
                          onClick={() => { sfx.click(); setSelectedGameIdx(i); openPreviewPopup(selected, g); }}
                          onDoubleClick={() => { if (previewPopup) closePreviewPopup(); handleLaunch(); }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            sfx.click();
                            setSelectedGameIdx(i);
                            setCtxMenu({ x: e.clientX, y: e.clientY, system: selected, game: g });
                          }}
                        >
                          {hasCover ? (
                            <img className="pb-card-cover" src={cover} alt={g.name} loading="lazy" />
                          ) : (
                            <>
                              <div className="pb-card-bg" />
                              <div className="pb-card-icon"><SystemIcon id={selected.id} /></div>
                              <div className="pb-card-title">{g.name}</div>
                            </>
                          )}
                          {isFav && <span className="pb-card-fav"><StarIcon filled /></span>}
                          {g.discs && g.discs.length > 1 && (
                            <span className="pb-card-discs" title={`${g.discs.length} discos`}>💿×{g.discs.length}</span>
                          )}
                          {metaStatus && (
                            <span className={`pb-card-status pb-card-status-${metaStatus}`} title={GAME_STATUS_LABELS[metaStatus]}>
                              {GAME_STATUS_EMOJI[metaStatus]}
                            </span>
                          )}
                          {metaRating > 0 && (
                            <span className="pb-card-rating" title={`${metaRating}/5 estrelas`}>
                              {"★".repeat(metaRating)}
                            </span>
                          )}
                          {playSec > 0 && (
                            <div className="pb-card-stats">
                              <span className="pb-card-stat-time">{formatPlayTime(playSec)}</span>
                            </div>
                          )}
                        </button>
                        <button
                          className="pb-card-resync"
                          onClick={(e) => { e.stopPropagation(); resyncSingleCover(selected.id, g); }}
                          title="Re-sincronizar capa deste jogo"
                        >
                          <RotateIcon />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selected.games.length === 0 && !selected.emulator_exists && (
              <div className="pb-warn">Emulador nao encontrado em disco</div>
            )}

            {selected.games.length === 0 && (
              <EmptyStateSystem
                system={selected}
                onOpenSuggestions={() => { sfx.open(); setSuggestionsTab("roms"); setSuggestionsOpen(true); }}
                onOpenControls={() => { sfx.open(); setControlsTip({ system: selected }); }}
              />
            )}
          </>
        )}

        {launchMsg && (
          <div className={`pb-toast pb-toast-${launchMsg.kind}`}>{launchMsg.text}</div>
        )}
      </main>

      <nav className="pb-categories">
        <div className="pb-categories-list">
          {SYSTEM_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`pb-category ${selectedCategoryId === cat.id ? "active" : ""}`}
              onClick={() => { sfx.switchSys(); setSelectedCategoryId(cat.id); }}
              title={cat.name}
            >
              <span className="pb-category-icon"><CategoryIcon id={cat.id} /></span>
              <span className="pb-category-name">{cat.name}</span>
            </button>
          ))}
        </div>
      </nav>

      <nav className={`pb-systems ${focusZone === "systems" ? "focused" : ""}`}>
        <div className="pb-systems-list" data-tour="systems">
          {displayedSystems.map((sys, i) => {
            const isActive = i === selectedSystemIdx;
            const isEmpty = sys.games.length === 0;
            const isFav = sys.id === "_favorites";
            return (
              <button
                key={`${selectedCategoryId}-${sys.id}`}  // forca re-mount na troca de categoria pra rodar a animacao de entrada
                className={`pb-sys ${isActive ? (focusZone === "systems" ? "active focused" : "active") : ""} ${isEmpty ? "empty" : ""} ${isFav ? "pb-sys-favorites" : ""}`}
                style={{ "--sys-color": sys.color, animationDelay: `${i * 26}ms` }}
                onClick={() => setSelectedSystemIdx(i)}
                title={`${sys.name}${sys.games.length ? ` · ${sys.games.length} jogos` : ""}`}
              >
                <span className="pb-sys-icon">
                  {isFav ? <StarIcon filled /> : <SystemIcon id={sys.id} />}
                </span>
              </button>
            );
          })}
          <div className="pb-sys-divider" />
          <button
            className={`pb-sys pb-sys-util ${focusZone === "util" && utilIdx === 0 ? "active focused" : ""}`}
            onClick={() => { sfx.open(); setSettingsOpen(true); }}
            title="Configuracoes (S / Y no controle)"
          >
            <span className="pb-sys-icon"><GearIcon /></span>
          </button>
          <button
            className={`pb-sys pb-sys-util pb-sys-power ${focusZone === "util" && utilIdx === 1 ? "active focused" : ""}`}
            onClick={() => { sfx.back(); handleQuit(); }}
            title="Sair"
          >
            <span className="pb-sys-icon"><PowerIcon /></span>
          </button>
        </div>
      </nav>

      {!IS_ANDROID && <div className="pb-hints">
        {previewPopup ? (
          <>
            <span className="pb-hint-key">A</span> Jogar
            <span className="pb-hint-divider" />
            <span className="pb-hint-key">Y</span> Detalhes
            <span className="pb-hint-divider" />
            <span className="pb-hint-key">B</span> Fechar
          </>
        ) : focusZone === "games" ? (
          <>
            <span className="pb-hint-key">A</span> Iniciar
            <span className="pb-hint-divider" />
            <span className="pb-hint-key">X</span> Preview
            <span className="pb-hint-divider" />
            <span className="pb-hint-key">B</span> Sistemas
            <span className="pb-hint-divider" />
            <span className="pb-hint-key">Y</span> Opcoes
          </>
        ) : (
          <>
            <span className="pb-hint-key">A</span> Entrar
            <span className="pb-hint-divider" />
            <span className="pb-hint-key">↑</span> Voltar
            <span className="pb-hint-divider" />
            <span className="pb-hint-key">Y</span> Opcoes
          </>
        )}
        <span className="pb-hint-divider" />
        <span className="pb-hint-key">F2</span> Diagnostico
      </div>}

      {gamepadDebug && <GamepadDebugOverlay onClose={() => setGamepadDebug(false)} />}

      {settingsOpen && (
        <SettingsPanel
          closing={settingsClosing}
          onClose={closeSettings}
          modalGamepadRef={modalGamepadRef}
          systems={systems}
          romsRoot={romsRoot}
          emulatorsRoot={emulatorsRoot}
          onToggleFullscreen={toggleFullscreen}
          onQuit={handleQuit}
          isFullscreen={isFullscreen}
          config={config}
          onSetTheme={(id) => { sfx.confirm(); setTheme(id); }}
          onSetCustomTheme={setCustomTheme}
          onPickWallpaper={pickWallpaper}
          onClearWallpaper={clearWallpaper}
          onSyncCovers={syncCovers}
          syncStatus={syncStatus}
          onRescan={rescanRoms}
          rescanBusy={rescanBusy}
          onOpenProfiles={() => { closeSettings(); setTimeout(() => setProfilesOpen(true), MODAL_EXIT_MS); }}
          activeProfile={activeProfile}
          onSetupSwitchKeys={setupSwitchKeys}
          switchKeysStatus={switchKeysStatus}
          onToggleSavesIsolation={toggleSavesIsolation}
          savesStatus={savesStatus}
          onToggleMusic={toggleMusic}
          onSetMusicVolume={setMusicVolume}
          onShowLogs={() => { closeSettings(); setTimeout(() => setLogsOpen(true), MODAL_EXIT_MS); }}
          onShowHealth={() => { closeSettings(); setTimeout(() => setHealthOpen(true), MODAL_EXIT_MS); }}
          onOpenSuggestions={() => { closeSettings(); setTimeout(() => { setSuggestionsTab("roms"); setSuggestionsOpen(true); }, MODAL_EXIT_MS); }}
          sfx={sfx}
          ambientMusic={ambientMusic}
          THEMES={THEMES}
          DEFAULT_CUSTOM_THEME={DEFAULT_CUSTOM_THEME}
          ACHIEVEMENTS={ACHIEVEMENTS}
          CustomThemeEditor={CustomThemeEditor}
          CollectionStats={CollectionStats}
          TopPlayedList={TopPlayedList}
          SessionsGraph={SessionsGraph}
          LicenseSettingsSection={LicenseSettingsSection}
        />
      )}

      {searchOpen && (
        <SearchOverlay
          closing={searchClosing}
          systems={systems}
          onClose={closeSearch}
          modalGamepadRef={modalGamepadRef}
          onPick={({ system, game }) => {
            selectGameByPath(system.id, game.path);
            closeSearch();
          }}
        />
      )}

      {achievementToast && (
        <AchievementToast achievement={achievementToast} onDone={() => setAchievementToast(null)} />
      )}
      {gamepadEvent && (
        <GamepadStatusToast event={gamepadEvent} onDone={() => setGamepadEvent(null)} />
      )}

      {profilesOpen && (
        <ProfileSelector
          closing={profilesClosing}
          profiles={config.profiles}
          activeId={config.active_profile_id}
          onSelect={selectProfile}
          onCreate={createProfile}
          onUpdate={updateProfile}
          onDelete={deleteProfile}
          onClose={closeProfiles}
          modalGamepadRef={modalGamepadRef}
        />
      )}

      {welcomeBack && (
        <div className="pb-welcome-back" aria-hidden>
          <div className="pb-welcome-back-flash" />
        </div>
      )}

      {systemEnter.id && (() => {
        const sysObj = systems.find((s) => s.id === systemEnter.id);
        if (!sysObj) return null;
        return (
          <div
            key={systemEnter.key}
            className={`pb-system-enter pb-system-enter-${systemEnter.id}`}
            style={{ "--sys-color": sysObj.color }}
            aria-hidden
          >
            <div className="pb-system-enter-flash" />
            <div className="pb-system-enter-sweep" />
            <div className="pb-system-enter-stage">
              <div className="pb-system-enter-icon" style={{ color: sysObj.color }}>
                <SystemIcon id={systemEnter.id} />
              </div>
              <div className="pb-system-enter-name">{sysObj.name}</div>
            </div>
          </div>
        );
      })()}

      {quitting && (
        <div className="pb-shutdown" aria-hidden>
          <div className="pb-shutdown-vignette" />
          <div className="pb-shutdown-line" />
          <div className="pb-shutdown-dot" />
        </div>
      )}

      {ctxMenu && (
        <GameContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          system={ctxMenu.system}
          game={ctxMenu.game}
          onClose={() => setCtxMenu(null)}
          onLaunch={() => { setCtxMenu(null); handleLaunch(); }}
          onShowDetails={() => { const c = ctxMenu; setCtxMenu(null); openDetailPanel(c.system, c.game); }}
          onResyncCover={() => { setCtxMenu(null); resyncSingleCover(ctxMenu.system.id, ctxMenu.game); }}
          onPickCover={() => { setCtxMenu(null); pickCustomCover(ctxMenu.system.id, ctxMenu.game); }}
          onOpenLocation={() => { setCtxMenu(null); openGameLocation(ctxMenu.game); }}
          onDelete={() => { const c = ctxMenu; setCtxMenu(null); confirmDeleteGame(c.system, c.game); }}
          onToggleFavorite={() => { setCtxMenu(null); toggleFavorite(); }}
          isFavorite={favoriteSet.has(ctxMenu.game.path)}
        />
      )}

      {previewPopup && (
        <GamePreviewPopup
          closing={previewClosing}
          system={previewPopup.system}
          game={previewPopup.game}
          playTimeSec={(activeProfile?.play_time?.[`${previewPopup.system.id}::${previewPopup.game.path}`]) || 0}
          isFavorite={favoriteSet.has(previewPopup.game.path)}
          onClose={closePreviewPopup}
          onLaunch={() => { closePreviewPopup(); setTimeout(() => handleLaunch(), MODAL_EXIT_MS); }}
          onOpenDetails={() => { const p = previewPopup; closePreviewPopup(); setTimeout(() => openDetailPanel(p.system, p.game), MODAL_EXIT_MS); }}
          modalGamepadRef={modalGamepadRef}
          detailsCache={detailsCacheRef}
        />
      )}

      {detailPanel && (
        <GameDetailPanel
          closing={detailClosing}
          system={detailPanel.system}
          game={detailPanel.game}
          playTimeSec={(activeProfile?.play_time?.[`${detailPanel.system.id}::${detailPanel.game.path}`]) || 0}
          isFavorite={favoriteSet.has(detailPanel.game.path)}
          gameMeta={gameMetaMap[`${detailPanel.system.id}::${detailPanel.game.path}`]}
          onClose={closeDetailPanel}
          onLaunch={() => { closeDetailPanel(); setTimeout(() => handleLaunch(), MODAL_EXIT_MS); }}
          onPickCover={() => pickCustomCover(detailPanel.system.id, detailPanel.game)}
          onResyncCover={() => resyncSingleCover(detailPanel.system.id, detailPanel.game)}
          onOpenLocation={() => openGameLocation(detailPanel.game)}
          onToggleFavorite={() => toggleFavorite()}
          onSetRating={(rating) => setGameRating(detailPanel.system.id, detailPanel.game.path, rating)}
          onSetStatus={(status) => setGameStatus(detailPanel.system.id, detailPanel.game.path, status)}
          onSetNotes={(notes) => setGameNotes(detailPanel.system.id, detailPanel.game.path, notes)}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmModal
          game={deleteConfirm.game}
          system={deleteConfirm.system}
          onCancel={() => { sfx.back(); setDeleteConfirm(null); }}
          onConfirm={performDeleteGame}
        />
      )}

      {discPicker && (
        <DiscPickerModal
          system={discPicker.system}
          game={discPicker.game}
          onCancel={() => { sfx.back(); setDiscPicker(null); }}
          onPick={(path) => { setDiscPicker(null); launchGameWithPath(path); }}
        />
      )}

      {logsOpen && (
        <LogsViewerModal onClose={() => { sfx.back(); setLogsOpen(false); }} />
      )}

      {healthOpen && (
        <HealthCheckModal onClose={() => { sfx.back(); setHealthOpen(false); }} />
      )}

      {emulator && (
        <EmulatorView
          system={emulator.system}
          game={emulator.game}
          autoLoadSlot={emulator.autoLoadSlot}
          onClose={() => { sfx.back(); setEmulator(null); }}
        />
      )}

      {resumePrompt && (
        <ResumePromptModal
          info={resumePrompt}
          onContinue={() => {
            const r = resumePrompt;
            setResumePrompt(null);
            setEmulator({ system: r.system, game: r.game, autoLoadSlot: r.slot });
          }}
          onFresh={() => {
            const r = resumePrompt;
            setResumePrompt(null);
            setEmulator({ system: r.system, game: r.game, autoLoadSlot: null });
          }}
          onCancel={() => { sfx.back(); setResumePrompt(null); }}
        />
      )}

      {launching && selectedBgSrc && (
        <div className="pb-launching">
          <img className="pb-launching-bg" src={selectedBgSrc} alt="" aria-hidden />
          <div className="pb-launching-content">
            <div className="pb-launching-label">INICIANDO</div>
            <div className="pb-launching-title">{selectedGame?.name}</div>
            <div className="pb-launching-system">{selected?.name}</div>
            <button
              className="pb-launching-cancel"
              onClick={async () => {
                sfx.back();
                try { await invoke("kill_running_game"); } catch {}
                setLaunching(false);
                setLaunchMsg(null);
                try {
                  const w = getCurrentWindow();
                  try { await w.show(); } catch {}
                  try { await w.unminimize(); } catch {}
                  try { await w.setFullscreen(true); } catch {}
                  try { await w.setFocus(); } catch {}
                } catch {}
              }}
            >Cancelar (Esc / Select+R1)</button>
          </div>
        </div>
      )}

      {/* Modais novos do v0.4 (sugestoes de jogos + dicas de controle) */}
      <SuggestionsModal
        open={suggestionsOpen}
        defaultTab={suggestionsTab}
        onClose={() => setSuggestionsOpen(false)}
      />
      <ControlsTipModal
        open={!!controlsTip}
        system={controlsTip?.system}
        onClose={() => setControlsTip(null)}
      />
      <SystemSettingsModal
        open={!!settingsModal}
        systemId={settingsModal?.systemId}
        systemName={settingsModal ? (displayedSystems.find(s => s.id === settingsModal.systemId)?.name || settingsModal.systemId) : ""}
        onClose={() => setSettingsModal(null)}
      />

      {/* First-run onboarding: tour spotlight + criacao de perfil. Fica em
       * cima de tudo (z-index 9000) ate o user concluir. Skip em Android. */}
      {firstRunActive && splashDone && !IS_ANDROID && (
        <LudexOnboarding onComplete={handleFirstRunComplete} />
      )}
    </div>
  );
}
