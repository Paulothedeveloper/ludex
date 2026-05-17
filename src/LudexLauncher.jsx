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
  FolderIcon as LxFolderIcon,
  GiftIcon as LxGiftIcon,
  ToolsIcon as LxToolsIcon,
  GlobeIcon as LxGlobeIcon,
  GamepadIcon as LxGamepadIcon,
} from "./LudexExtras";

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
const SYSTEM_CATEGORIES = [
  { id: "all",       name: "TODOS",       icon: "🎮", systems: null /* = mostra tudo */ },
  { id: "nintendo",  name: "NINTENDO",    icon: "N",  systems: ["switch","wiiu","3ds","wii","gc","n64","gba","ds","gb","gbc","snes","nes","vb"] },
  { id: "sony",      name: "SONY",        icon: "PS", systems: ["ps3","ps4","ps2","ps1","psp","vita"] },
  { id: "sega",      name: "SEGA",        icon: "S",  systems: ["dreamcast","saturn","md","sms","gg","segacd"] },
  { id: "microsoft", name: "MICROSOFT",   icon: "X",  systems: ["xbox","xbox360"] },
  { id: "atari",     name: "ATARI",       icon: "A",  systems: ["a2600","lynx","jaguar"] },
  { id: "arcade",    name: "ARCADE",      icon: "★",  systems: ["arcade"] },
  { id: "handheld",  name: "PORTATEIS",   icon: "H",  systems: ["ws","ngpc"] },
  { id: "outros",    name: "OUTROS",      icon: "+",  systems: ["tg16","threedo","msx","c64","zx","amiga","retro"] },
];

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

function formatPlayTime(seconds) {
  if (!seconds || seconds < 60) return `${Math.floor(seconds || 0)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

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

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function CloseIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>); }
function PowerIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>); }
function FullscreenIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /></svg>); }
function RefreshIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-3.51-7.13" /><polyline points="21 4 21 10 15 10" /></svg>); }
function PlusIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>); }
function TrashIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>); }
function EditIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>); }
function RotateIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>); }
function UserIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>); }
function SearchIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>); }
function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function PlayIcon() { return (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="6 4 20 12 6 20 6 4" /></svg>); }
function FolderIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>); }
function InfoIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>); }
function SpeakerIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>); }
function SpeakerMuteIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>); }
function CheckIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>); }
function ShieldIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>); }
function SortIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="9" y2="18" /></svg>); }
function ImageIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>); }
function GamepadIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="6" y1="11" x2="10" y2="11" /><line x1="8" y1="9" x2="8" y2="13" /><line x1="15" y1="12" x2="15.01" y2="12" /><line x1="18" y1="10" x2="18.01" y2="10" /><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z" /></svg>); }

function SystemIcon({ id }) {
  const fill = "currentColor";
  switch (id) {
    case "switch":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="8" width="20" height="48" rx="9" fill={fill} /><rect x="38" y="8" width="20" height="48" rx="9" fill={fill} /><circle cx="16" cy="20" r="3" fill="#1c1c1c" /><circle cx="48" cy="44" r="3" fill="#1c1c1c" /><circle cx="16" cy="36" r="1.6" fill="#1c1c1c" /><circle cx="13" cy="40" r="1.2" fill="#1c1c1c" /><circle cx="19" cy="40" r="1.2" fill="#1c1c1c" /><circle cx="16" cy="44" r="1.2" fill="#1c1c1c" /><circle cx="48" cy="20" r="1.2" fill="#1c1c1c" /><circle cx="44" cy="24" r="1.2" fill="#1c1c1c" /><circle cx="52" cy="24" r="1.2" fill="#1c1c1c" /><circle cx="48" cy="28" r="1.2" fill="#1c1c1c" /></svg>);
    case "wiiu":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="14" width="56" height="36" rx="8" fill={fill} /><rect x="14" y="22" width="36" height="20" rx="2" fill="#1c1c1c" /><circle cx="9" cy="32" r="2" fill="#1c1c1c" /><circle cx="55" cy="32" r="2" fill="#1c1c1c" /></svg>);
    case "3ds":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="10" y="6" width="44" height="22" rx="3" fill={fill} /><rect x="14" y="10" width="36" height="14" rx="1" fill="#1c1c1c" /><rect x="10" y="32" width="44" height="26" rx="3" fill={fill} /><rect x="14" y="36" width="22" height="16" rx="1" fill="#1c1c1c" /><circle cx="44" cy="40" r="2" fill="#1c1c1c" /><circle cx="50" cy="40" r="2" fill="#1c1c1c" /><circle cx="44" cy="46" r="2" fill="#1c1c1c" /><circle cx="50" cy="46" r="2" fill="#1c1c1c" /><text x="32" y="55" textAnchor="middle" fill={fill} fontSize="6" fontWeight="700" fontFamily="system-ui">3DS</text></svg>);
    case "wii":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="24" y="6" width="16" height="52" rx="4" fill={fill} /><circle cx="32" cy="14" r="3" fill="#1c1c1c" /><rect x="28" y="22" width="8" height="2" fill="#1c1c1c" /><rect x="31" y="19" width="2" height="8" fill="#1c1c1c" /><circle cx="32" cy="34" r="2.5" fill="#1c1c1c" /><circle cx="32" cy="42" r="1.5" fill="#1c1c1c" /><rect x="28" y="48" width="8" height="2" fill="#1c1c1c" /></svg>);
    case "gc":
      return (<svg viewBox="0 0 64 64" aria-hidden><path d="M32 6 L56 18 L56 44 L32 56 L8 44 L8 18 Z" fill={fill} /><path d="M32 6 L56 18 L32 30 L8 18 Z" fill="#1c1c1c" opacity="0.25" /><path d="M32 30 L32 56 L8 44 L8 18 Z" fill="#1c1c1c" opacity="0.4" /><text x="32" y="40" textAnchor="middle" fill="#1c1c1c" fontSize="14" fontWeight="900" fontFamily="system-ui">G</text></svg>);
    case "n64":
      return (<svg viewBox="0 0 64 64" aria-hidden><path d="M32 8 L48 24 L32 24 Z" fill={fill} /><path d="M32 8 L16 24 L32 24 Z" fill={fill} opacity="0.7" /><path d="M32 56 L48 40 L32 40 Z" fill={fill} opacity="0.5" /><path d="M32 56 L16 40 L32 40 Z" fill={fill} opacity="0.85" /><rect x="14" y="22" width="36" height="20" rx="2" fill="none" stroke={fill} strokeWidth="3" /></svg>);
    case "ps3": case "ps2": case "ps1":
      return (<svg viewBox="0 0 64 64" aria-hidden><text x="32" y="48" textAnchor="middle" fill={fill} fontSize="44" fontWeight="900" fontStyle="italic" fontFamily="Impact, system-ui">PS</text></svg>);
    case "snes":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="22" width="52" height="22" rx="6" fill={fill} /><circle cx="20" cy="33" r="3" fill="#1c1c1c" /><circle cx="44" cy="29" r="2.4" fill="#1c1c1c" /><circle cx="49" cy="33" r="2.4" fill="#1c1c1c" /><circle cx="44" cy="37" r="2.4" fill="#1c1c1c" /><circle cx="39" cy="33" r="2.4" fill="#1c1c1c" /><rect x="14" y="32" width="12" height="2" fill="#1c1c1c" /><rect x="19" y="27" width="2" height="12" fill="#1c1c1c" /><text x="32" y="56" textAnchor="middle" fill={fill} fontSize="9" fontWeight="700" fontFamily="system-ui">SNES</text></svg>);
    case "ps4":
      return (<svg viewBox="0 0 64 64" aria-hidden><text x="20" y="46" textAnchor="middle" fill={fill} fontSize="36" fontWeight="900" fontStyle="italic" fontFamily="Impact, system-ui">PS</text><text x="46" y="46" textAnchor="middle" fill={fill} fontSize="36" fontWeight="900" fontFamily="Impact, system-ui">4</text></svg>);
    case "gba":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="18" width="56" height="28" rx="6" fill={fill} /><rect x="20" y="22" width="24" height="20" rx="2" fill="#1c1c1c" /><circle cx="11" cy="32" r="2.4" fill="#1c1c1c" /><rect x="9" y="30" width="4" height="1.5" fill={fill} /><rect x="10" y="29" width="2" height="6" fill={fill} /><circle cx="50" cy="29" r="2.2" fill="#1c1c1c" /><circle cx="55" cy="34" r="2.2" fill="#1c1c1c" /></svg>);
    case "xbox":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          {/* Xbox sphere com X */}
          <circle cx="32" cy="32" r="26" fill={fill} />
          <path d="M16 14 Q32 32 48 14" stroke="#1c1c1c" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M16 50 Q32 32 48 50" stroke="#1c1c1c" strokeWidth="5" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "nes":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="36" rx="3" fill={fill} /><rect x="10" y="20" width="44" height="16" fill="#1c1c1c" /><rect x="14" y="40" width="14" height="6" rx="1" fill="#1c1c1c" /><rect x="36" y="40" width="14" height="6" rx="1" fill="#1c1c1c" /><text x="32" y="32" textAnchor="middle" fill={fill} fontSize="9" fontWeight="700" fontFamily="system-ui">NES</text></svg>);
    case "gb":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="14" y="6" width="36" height="52" rx="6" fill={fill} /><rect x="20" y="12" width="24" height="20" rx="2" fill="#1c1c1c" /><circle cx="42" cy="40" r="3" fill="#1c1c1c" /><circle cx="48" cy="44" r="3" fill="#1c1c1c" /><rect x="18" y="42" width="8" height="2" fill="#1c1c1c" /><rect x="21" y="39" width="2" height="8" fill="#1c1c1c" /></svg>);
    case "gbc":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="14" y="6" width="36" height="52" rx="6" fill={fill} /><rect x="20" y="12" width="24" height="20" rx="2" fill="#1c1c1c" /><circle cx="42" cy="40" r="3" fill="#1c1c1c" /><circle cx="48" cy="44" r="3" fill="#1c1c1c" /><rect x="18" y="42" width="8" height="2" fill="#1c1c1c" /><rect x="21" y="39" width="2" height="8" fill="#1c1c1c" /><text x="32" y="56" textAnchor="middle" fill="#1c1c1c" fontSize="6" fontWeight="700" fontFamily="system-ui">COLOR</text></svg>);
    case "md":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="20" width="52" height="24" rx="4" fill={fill} /><rect x="10" y="24" width="44" height="6" fill="#1c1c1c" /><circle cx="14" cy="38" r="2" fill="#1c1c1c" /><circle cx="20" cy="38" r="2" fill="#1c1c1c" /><circle cx="50" cy="38" r="2" fill="#1c1c1c" /><text x="32" y="40" textAnchor="middle" fill="#1c1c1c" fontSize="7" fontWeight="700" fontFamily="system-ui">MD</text></svg>);
    case "retro":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="28" y="10" width="8" height="22" rx="3" fill={fill} /><circle cx="32" cy="12" r="6" fill={fill} /><ellipse cx="32" cy="44" rx="20" ry="14" fill={fill} /><circle cx="22" cy="44" r="3" fill="#1c1c1c" /><circle cx="32" cy="44" r="3" fill="#1c1c1c" /><circle cx="42" cy="44" r="3" fill="#1c1c1c" /></svg>);
    // ===== Novos sistemas v0.7.0 =====
    case "dreamcast":
      return (<svg viewBox="0 0 64 64" aria-hidden><circle cx="32" cy="32" r="22" fill="none" stroke={fill} strokeWidth="3" /><path d="M24 22 Q32 14 40 22 Q44 32 38 40 Q30 44 24 38 Q20 30 24 22 Z" fill={fill} /><text x="32" y="56" textAnchor="middle" fill={fill} fontSize="7" fontWeight="800" fontFamily="system-ui">DC</text></svg>);
    case "psp":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="18" width="56" height="28" rx="4" fill={fill} /><rect x="18" y="22" width="28" height="20" rx="1" fill="#1c1c1c" /><circle cx="11" cy="28" r="2" fill="#1c1c1c" /><rect x="9" y="27" width="4" height="2" fill={fill} /><rect x="10" y="26" width="2" height="4" fill={fill} /><circle cx="50" cy="26" r="1.6" fill="#1c1c1c" /><circle cx="54" cy="30" r="1.6" fill="#1c1c1c" /><circle cx="54" cy="38" r="1.6" fill="#1c1c1c" /><circle cx="50" cy="42" r="1.6" fill="#1c1c1c" /><text x="32" y="58" textAnchor="middle" fill={fill} fontSize="7" fontWeight="800" fontFamily="system-ui">PSP</text></svg>);
    case "ds":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="10" y="6" width="44" height="22" rx="3" fill={fill} /><rect x="14" y="10" width="36" height="14" rx="1" fill="#1c1c1c" /><rect x="10" y="32" width="44" height="26" rx="3" fill={fill} /><rect x="14" y="36" width="36" height="16" rx="1" fill="#1c1c1c" /><circle cx="22" cy="44" r="1.5" fill={fill} /><text x="32" y="56" textAnchor="middle" fill={fill} fontSize="6" fontWeight="700" fontFamily="system-ui">DS</text></svg>);
    case "saturn":
      return (<svg viewBox="0 0 64 64" aria-hidden><circle cx="32" cy="32" r="20" fill={fill} /><ellipse cx="32" cy="32" rx="28" ry="6" fill="none" stroke={fill} strokeWidth="2.4" opacity="0.7" /><circle cx="32" cy="32" r="6" fill="#1c1c1c" /></svg>);
    case "sms":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="36" rx="3" fill={fill} /><rect x="10" y="20" width="44" height="14" fill="#1c1c1c" /><circle cx="22" cy="42" r="3" fill="#1c1c1c" /><circle cx="42" cy="42" r="3" fill="#1c1c1c" /><text x="32" y="29" textAnchor="middle" fill={fill} fontSize="6" fontWeight="700" fontFamily="system-ui">MASTER</text></svg>);
    case "gg":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="36" rx="8" fill={fill} /><rect x="22" y="20" width="20" height="14" rx="1" fill="#1c1c1c" /><circle cx="13" cy="32" r="2.5" fill="#1c1c1c" /><rect x="11" y="30" width="5" height="1.6" fill={fill} /><rect x="12" y="29" width="2" height="6" fill={fill} /><circle cx="48" cy="29" r="1.6" fill="#1c1c1c" /><circle cx="54" cy="33" r="1.6" fill="#1c1c1c" /></svg>);
    case "segacd":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="20" width="52" height="24" rx="4" fill={fill} /><circle cx="20" cy="32" r="9" fill="none" stroke="#1c1c1c" strokeWidth="2" /><circle cx="20" cy="32" r="2.5" fill="#1c1c1c" /><text x="42" y="36" textAnchor="middle" fill="#1c1c1c" fontSize="9" fontWeight="800" fontFamily="system-ui">CD</text></svg>);
    case "arcade":
      return (<svg viewBox="0 0 64 64" aria-hidden><path d="M16 6 L48 6 L52 14 L52 50 L46 58 L18 58 L12 50 L12 14 Z" fill={fill} /><rect x="18" y="14" width="28" height="20" rx="1" fill="#1c1c1c" /><circle cx="24" cy="42" r="3" fill="#1c1c1c" /><circle cx="34" cy="42" r="3" fill="#1c1c1c" /><circle cx="40" cy="48" r="2" fill="#1c1c1c" /></svg>);
    case "tg16":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="20" width="52" height="22" rx="3" fill={fill} /><rect x="10" y="24" width="44" height="6" fill="#1c1c1c" /><text x="32" y="40" textAnchor="middle" fill="#1c1c1c" fontSize="8" fontWeight="800" fontFamily="system-ui">PCE</text></svg>);
    case "a2600":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="36" rx="3" fill={fill} /><rect x="10" y="18" width="44" height="12" fill="#1c1c1c" /><text x="32" y="27" textAnchor="middle" fill={fill} fontSize="6" fontWeight="800" fontFamily="system-ui">ATARI</text><rect x="14" y="36" width="36" height="3" fill="#1c1c1c" /><rect x="14" y="42" width="14" height="4" rx="1" fill="#1c1c1c" /><rect x="36" y="42" width="14" height="4" rx="1" fill="#1c1c1c" /></svg>);
    case "lynx":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="20" width="56" height="24" rx="6" fill={fill} /><rect x="20" y="24" width="24" height="16" rx="1" fill="#1c1c1c" /><circle cx="11" cy="32" r="2" fill="#1c1c1c" /><circle cx="52" cy="29" r="1.6" fill="#1c1c1c" /><circle cx="56" cy="33" r="1.6" fill="#1c1c1c" /></svg>);
    case "ws":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="12" y="8" width="40" height="48" rx="6" fill={fill} /><rect x="18" y="14" width="28" height="20" rx="1" fill="#1c1c1c" /><circle cx="22" cy="42" r="2" fill="#1c1c1c" /><circle cx="22" cy="48" r="2" fill="#1c1c1c" /><circle cx="42" cy="44" r="2" fill="#1c1c1c" /><circle cx="42" cy="50" r="2" fill="#1c1c1c" /></svg>);
    case "vb":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="8" y="22" width="48" height="20" rx="6" fill={fill} /><circle cx="22" cy="32" r="6" fill="#1c1c1c" /><circle cx="42" cy="32" r="6" fill="#1c1c1c" /><rect x="28" y="30" width="8" height="4" fill={fill} /></svg>);
    case "ngpc":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="14" y="6" width="36" height="52" rx="6" fill={fill} /><rect x="20" y="12" width="24" height="20" rx="2" fill="#1c1c1c" /><circle cx="24" cy="42" r="2" fill="#1c1c1c" /><rect x="22" y="40" width="4" height="1.6" fill={fill} /><rect x="23" y="39" width="2" height="6" fill={fill} /><circle cx="40" cy="44" r="2.5" fill="#1c1c1c" /></svg>);
    case "msx":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="22" width="52" height="20" rx="2" fill={fill} /><rect x="10" y="26" width="44" height="12" fill="#1c1c1c" /><text x="32" y="36" textAnchor="middle" fill={fill} fontSize="8" fontWeight="800" fontFamily="system-ui">MSX</text></svg>);
    case "c64":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="18" width="52" height="28" rx="3" fill={fill} /><rect x="10" y="22" width="44" height="14" fill="#1c1c1c" /><circle cx="14" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="20" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="26" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="32" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="38" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="44" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="50" cy="40" r="1.4" fill="#1c1c1c" /><text x="32" y="32" textAnchor="middle" fill={fill} fontSize="8" fontWeight="800" fontFamily="system-ui">C64</text></svg>);
    case "zx":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="34" rx="3" fill={fill} /><rect x="10" y="18" width="44" height="20" fill="#1c1c1c" /><rect x="10" y="40" width="6" height="3" fill="#dc2626" /><rect x="18" y="40" width="6" height="3" fill="#f59e0b" /><rect x="26" y="40" width="6" height="3" fill="#fbbf24" /><rect x="34" y="40" width="6" height="3" fill="#22c55e" /><rect x="42" y="40" width="6" height="3" fill="#3b82f6" /><rect x="50" y="40" width="6" height="3" fill="#7c3aed" /></svg>);
    case "amiga":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="22" width="56" height="22" rx="2" fill={fill} /><rect x="8" y="26" width="48" height="14" fill="#1c1c1c" /><text x="32" y="36" textAnchor="middle" fill={fill} fontSize="8" fontWeight="800" fontFamily="system-ui">AMIGA</text></svg>);
    case "threedo":
      return (<svg viewBox="0 0 64 64" aria-hidden><circle cx="32" cy="32" r="22" fill={fill} /><text x="32" y="40" textAnchor="middle" fill="#1c1c1c" fontSize="20" fontWeight="900" fontFamily="system-ui">3DO</text></svg>);
    case "jaguar":
      return (<svg viewBox="0 0 64 64" aria-hidden><polygon points="32 8 56 22 56 42 32 56 8 42 8 22" fill={fill} /><text x="32" y="38" textAnchor="middle" fill="#1c1c1c" fontSize="10" fontWeight="900" fontFamily="system-ui">JAG</text></svg>);
    case "xbox360":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <circle cx="32" cy="32" r="26" fill={fill} />
          <path d="M16 14 Q32 32 48 14" stroke="#1c1c1c" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M16 50 Q32 32 48 50" stroke="#1c1c1c" strokeWidth="5" fill="none" strokeLinecap="round" />
          <text x="32" y="60" textAnchor="middle" fill={fill} fontSize="7" fontWeight="800" fontFamily="system-ui">360</text>
        </svg>
      );
    case "vita":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="16" width="56" height="32" rx="4" fill={fill} /><rect x="16" y="20" width="32" height="24" rx="1" fill="#1c1c1c" /><circle cx="11" cy="26" r="2" fill="#1c1c1c" /><rect x="9" y="25" width="4" height="2" fill={fill} /><rect x="10" y="24" width="2" height="4" fill={fill} /><circle cx="51" cy="24" r="1.4" fill="#1c1c1c" /><circle cx="55" cy="28" r="1.4" fill="#1c1c1c" /><circle cx="55" cy="36" r="1.4" fill="#1c1c1c" /><circle cx="51" cy="40" r="1.4" fill="#1c1c1c" /><text x="32" y="60" textAnchor="middle" fill={fill} fontSize="7" fontWeight="800" fontFamily="system-ui">VITA</text></svg>);
    default: return null;
  }
}

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

// Layout do teclado virtual (linhas de teclas). Linha 0..3 = chars, linha 4 = acoes.
const VK_ROWS = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L","-"],
  ["Z","X","C","V","B","N","M",".","'"," "],
];
const VK_ACTIONS = ["⌫","CLEAR","BUSCAR"];

function SearchOverlay({ systems, onPick, onClose, closing, modalGamepadRef }) {
  const [query, setQuery] = useState("");
  // zone: "keyboard" (default) | "results"
  const [zone, setZone] = useState("keyboard");
  // teclado: row 0..4 (4 = actions), col 0..9 (ou 0..2 nas actions)
  const [kbRow, setKbRow] = useState(1);
  const [kbCol, setKbCol] = useState(0);
  const [resIdx, setResIdx] = useState(0);

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmed) return [];
    const out = [];
    for (const s of systems) {
      for (const g of s.games) {
        if (g.name.toLowerCase().includes(trimmed)) {
          out.push({ system: s, game: g });
          if (out.length >= 60) return out;
        }
      }
    }
    return out;
  }, [trimmed, systems]);

  const appendChar = useCallback((c) => setQuery((q) => q + c), []);
  const backspace = useCallback(() => setQuery((q) => q.slice(0, -1)), []);
  const clearAll = useCallback(() => setQuery(""), []);

  // Confirma a tecla atualmente focada
  const confirmKey = useCallback(() => {
    if (kbRow < 4) {
      const c = VK_ROWS[kbRow][kbCol];
      if (c) appendChar(c);
    } else {
      const action = VK_ACTIONS[kbCol] || VK_ACTIONS[0];
      if (action === "⌫") backspace();
      else if (action === "CLEAR") clearAll();
      else if (action === "BUSCAR" && results[0]) onPick(results[0]);
    }
  }, [kbRow, kbCol, appendChar, backspace, clearAll, results, onPick]);

  // Registra handler de gamepad
  useEffect(() => {
    if (!modalGamepadRef) return;
    const handler = (action) => {
      if (zone === "keyboard") {
        if (action === "left") {
          setKbCol((c) => {
            const max = kbRow === 4 ? VK_ACTIONS.length - 1 : VK_ROWS[kbRow].length - 1;
            return c > 0 ? c - 1 : max;
          });
          return true;
        }
        if (action === "right") {
          setKbCol((c) => {
            const max = kbRow === 4 ? VK_ACTIONS.length - 1 : VK_ROWS[kbRow].length - 1;
            return c < max ? c + 1 : 0;
          });
          return true;
        }
        if (action === "up") {
          setKbRow((r) => {
            if (r === 0) {
              // sobe pra results se houver
              if (results.length > 0) { setZone("results"); return r; }
              return r;
            }
            const newR = r - 1;
            const newMax = newR === 4 ? VK_ACTIONS.length - 1 : VK_ROWS[newR].length - 1;
            setKbCol((c) => Math.min(c, newMax));
            return newR;
          });
          return true;
        }
        if (action === "down") {
          setKbRow((r) => {
            if (r >= 4) return r;
            const newR = r + 1;
            const newMax = newR === 4 ? VK_ACTIONS.length - 1 : VK_ROWS[newR].length - 1;
            setKbCol((c) => Math.min(c, newMax));
            return newR;
          });
          return true;
        }
        if (action === "a") { confirmKey(); return true; }
        if (action === "y") { backspace(); return true; }
        if (action === "x") { appendChar(" "); return true; }
        if (action === "start") { if (results[0]) onPick(results[0]); return true; }
        if (action === "b") { onClose(); return true; }
      } else if (zone === "results") {
        if (action === "down") {
          setResIdx((i) => {
            if (i + 1 >= results.length) { setZone("keyboard"); return i; }
            return i + 1;
          });
          return true;
        }
        if (action === "up") {
          setResIdx((i) => i > 0 ? i - 1 : 0);
          return true;
        }
        if (action === "a" && results[resIdx]) { onPick(results[resIdx]); return true; }
        if (action === "b") { setZone("keyboard"); return true; }
      }
      return false;
    };
    modalGamepadRef.current = handler;
    return () => { if (modalGamepadRef.current === handler) modalGamepadRef.current = null; };
  }, [modalGamepadRef, zone, kbRow, kbCol, resIdx, results, confirmKey, backspace, appendChar, onClose, onPick]);

  // Reset resIdx ao mudar query
  useEffect(() => { setResIdx(0); }, [trimmed]);

  return (
    <div className={`pb-search-backdrop ${closing ? "closing" : ""}`} onClick={onClose}>
      <div className={`pb-search-box ${closing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="pb-search-input-wrap">
          <SearchIcon />
          <input
            autoFocus
            type="text"
            className="pb-search-input"
            placeholder="Use o controle: D-pad/Stick navega · A confirma · Y apaga · X espaco · Start busca · B sai"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              if (e.key === "Enter" && results[0]) { e.preventDefault(); onPick(results[0]); }
            }}
          />
          <span className="pb-search-count">{trimmed ? `${results.length}` : ""}</span>
        </div>

        {/* OSK escondido em Android (user usa teclado nativo) e em desktop sem gamepad */}
        {!IS_ANDROID && (
          <div className={`pb-vk ${zone === "keyboard" ? "focused" : ""}`}>
            {VK_ROWS.map((row, r) => (
              <div key={r} className="pb-vk-row">
                {row.map((c, ci) => (
                  <button
                    key={ci}
                    className={`pb-vk-key ${zone === "keyboard" && kbRow === r && kbCol === ci ? "focused" : ""}`}
                    onClick={() => { setZone("keyboard"); setKbRow(r); setKbCol(ci); appendChar(c); }}
                  >{c === " " ? "␣" : c}</button>
                ))}
              </div>
            ))}
            <div className="pb-vk-row pb-vk-actions">
              {VK_ACTIONS.map((a, ai) => (
                <button
                  key={ai}
                  className={`pb-vk-key pb-vk-action ${zone === "keyboard" && kbRow === 4 && kbCol === ai ? "focused" : ""}`}
                  onClick={() => {
                    setZone("keyboard"); setKbRow(4); setKbCol(ai);
                    if (a === "⌫") backspace();
                    else if (a === "CLEAR") clearAll();
                    else if (a === "BUSCAR" && results[0]) onPick(results[0]);
                  }}
                >{a}</button>
              ))}
            </div>
          </div>
        )}

        <div className={`pb-search-results ${zone === "results" ? "focused" : ""}`}>
          {results.map(({ system, game }, i) => (
            <button
              key={game.path}
              className={`pb-search-item ${zone === "results" && i === resIdx ? "focused" : ""}`}
              onClick={() => onPick({ system, game })}
            >
              <span className="pb-search-item-sys" style={{ background: system.color }}>
                <SystemIcon id={system.id} />
              </span>
              <span className="pb-search-item-name">{game.name}</span>
              <span className="pb-search-item-meta">{system.name}</span>
            </button>
          ))}
          {trimmed && results.length === 0 && (
            <div className="pb-search-empty">Nenhum jogo encontrado</div>
          )}
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

function SettingsPanel({
  closing, onClose, systems, romsRoot, emulatorsRoot,
  onToggleFullscreen, onQuit, isFullscreen,
  config, onSetTheme, onSetCustomTheme, onPickWallpaper, onClearWallpaper,
  onSyncCovers, syncStatus, onRescan, rescanBusy,
  onOpenProfiles, activeProfile,
  onSetupSwitchKeys, switchKeysStatus,
  onToggleSavesIsolation, savesStatus,
  onToggleMusic, onSetMusicVolume,
  onShowLogs, onShowHealth,
  onOpenSuggestions,
  modalGamepadRef,
}) {
  const [discordId, setDiscordId] = useState(config.discord_app_id || "");
  const [discordStatus, setDiscordStatus] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);
  // RetroAchievements
  const [raUser, setRaUser] = useState(config.ra_username || "");
  const [raKey, setRaKey] = useState(config.ra_api_key || "");
  const [raSummary, setRaSummary] = useState(null);
  const [raStatus, setRaStatus] = useState(null);
  const [raBusy, setRaBusy] = useState(false);
  const panelRef = useRef(null);
  const [focusIdx, setFocusIdx] = useState(0);
  useEffect(() => { setDiscordId(config.discord_app_id || ""); }, [config.discord_app_id]);
  useEffect(() => { setRaUser(config.ra_username || ""); setRaKey(config.ra_api_key || ""); }, [config.ra_username, config.ra_api_key]);

  // Carrega summary RA on mount se já configurado
  useEffect(() => {
    if (!config.ra_username || !config.ra_api_key) { setRaSummary(null); return; }
    let cancelled = false;
    invoke("ra_get_summary").then((s) => { if (!cancelled) setRaSummary(s); })
      .catch((e) => { if (!cancelled) setRaStatus({ kind: "warn", text: "Falha ao buscar RA: " + String(e).slice(0, 120) }); });
    return () => { cancelled = true; };
  }, [config.ra_username, config.ra_api_key]);

  async function saveRa() {
    if (!raUser.trim() || !raKey.trim()) {
      setRaStatus({ kind: "error", text: "Informe usuario e Web API Key." });
      return;
    }
    setRaBusy(true);
    setRaStatus({ kind: "info", text: "Validando credenciais..." });
    try {
      const summary = await invoke("ra_save_credentials", { username: raUser.trim(), apiKey: raKey.trim() });
      setRaSummary(summary);
      setRaStatus({ kind: "ok", text: `Conectado como ${summary.username}!` });
    } catch (e) {
      setRaStatus({ kind: "error", text: String(e).slice(0, 200) });
    } finally {
      setRaBusy(false);
    }
  }

  async function clearRa() {
    try {
      await invoke("ra_clear_credentials");
      setRaSummary(null);
      setRaUser("");
      setRaKey("");
      setRaStatus({ kind: "ok", text: "RetroAchievements desconectado." });
      setTimeout(() => setRaStatus(null), 2500);
    } catch (e) {
      setRaStatus({ kind: "error", text: String(e) });
    }
  }

  async function refreshRa() {
    setRaBusy(true);
    try {
      const s = await invoke("ra_get_summary");
      setRaSummary(s);
      setRaStatus({ kind: "ok", text: "Atualizado." });
      setTimeout(() => setRaStatus(null), 2000);
    } catch (e) {
      setRaStatus({ kind: "error", text: String(e).slice(0, 200) });
    } finally {
      setRaBusy(false);
    }
  }

  // Coleta elementos focaveis dentro do painel pra navegar com gamepad
  const getFocusables = useCallback(() => {
    if (!panelRef.current) return [];
    return Array.from(panelRef.current.querySelectorAll(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null); // visiveis
  }, []);

  const focusByIdx = useCallback((idx) => {
    const items = getFocusables();
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    setFocusIdx(clamped);
    items.forEach((el, i) => {
      if (i === clamped) {
        el.classList.add("pb-gp-focus");
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      } else {
        el.classList.remove("pb-gp-focus");
      }
    });
  }, [getFocusables]);

  // Foca primeiro item ao montar
  useEffect(() => {
    const t = setTimeout(() => focusByIdx(0), 50);
    return () => clearTimeout(t);
  }, [focusByIdx]);

  // Handler de gamepad
  useEffect(() => {
    if (!modalGamepadRef) return;
    const handler = (action) => {
      if (action === "down") {
        focusByIdx(focusIdx + 1);
        return true;
      }
      if (action === "up") {
        focusByIdx(focusIdx - 1);
        return true;
      }
      if (action === "right" || action === "left") {
        const items = getFocusables();
        const cur = items[focusIdx];
        if (cur) {
          // Se o foco atual eh um botao em sequencia horizontal (theme card, etc), pula 1.
          // Detecta pela proximidade do bounding rect (mesma linha)
          const curRect = cur.getBoundingClientRect();
          const dir = action === "right" ? 1 : -1;
          let target = focusIdx + dir;
          while (target >= 0 && target < items.length) {
            const next = items[target];
            const nextRect = next.getBoundingClientRect();
            if (Math.abs(nextRect.top - curRect.top) < 8) {
              focusByIdx(target);
              return true;
            }
            target += dir;
          }
        }
        focusByIdx(focusIdx + (action === "right" ? 1 : -1));
        return true;
      }
      if (action === "a") {
        const items = getFocusables();
        const cur = items[focusIdx];
        if (cur) cur.click();
        return true;
      }
      if (action === "b") { onClose(); return true; }
      return false;
    };
    modalGamepadRef.current = handler;
    return () => { if (modalGamepadRef.current === handler) modalGamepadRef.current = null; };
  }, [modalGamepadRef, focusIdx, focusByIdx, getFocusables, onClose]);

  async function doCheckUpdate() {
    if (updateBusy) return;
    setUpdateBusy(true);
    setUpdateStatus({ kind: "info", text: "Procurando atualização..." });
    try {
      const update = await checkUpdate();
      if (!update) {
        setUpdateStatus({ kind: "ok", text: "Você já está na versão mais recente!" });
        return;
      }
      setUpdateStatus({ kind: "info", text: `Versão ${update.version} disponível. Baixando...` });
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength || 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength || 0;
          const pct = total ? Math.round((downloaded / total) * 100) : 0;
          setUpdateStatus({ kind: "info", text: `Baixando v${update.version}: ${pct}%` });
        }
        if (event.event === "Finished") setUpdateStatus({ kind: "ok", text: "Download OK. Reiniciando..." });
      });
      await relaunch();
    } catch (e) {
      console.error("update check", e);
      setUpdateStatus({ kind: "error", text: `Erro: ${e}` });
    } finally {
      setUpdateBusy(false);
    }
  }
  async function saveDiscord() {
    try {
      const ok = await invoke("discord_set_app_id", { appId: discordId.trim() || null });
      setDiscordStatus(ok ? { kind: "ok", text: "Conectado ao Discord!" } : { kind: "warn", text: "Salvo. Discord pode não estar rodando — abre o Discord e tenta de novo." });
    } catch (e) {
      setDiscordStatus({ kind: "error", text: String(e) });
    }
    setTimeout(() => setDiscordStatus(null), 4000);
  }
  const totalPlayTime = activeProfile
    ? Object.values(activeProfile.play_time || {}).reduce((a, b) => a + b, 0)
    : 0;
  const unlocked = activeProfile
    ? ACHIEVEMENTS.filter((a) => (activeProfile.achievements || []).includes(a.id))
    : [];
  const locked = activeProfile
    ? ACHIEVEMENTS.filter((a) => !(activeProfile.achievements || []).includes(a.id))
    : ACHIEVEMENTS;
  return (
    <>
      <div className={`pb-settings-backdrop ${closing ? "closing" : ""}`} onClick={() => { sfx.back(); onClose(); }} />
      <aside ref={panelRef} className={`pb-settings ${closing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <header className="pb-settings-header">
          <h2>Configuracoes</h2>
          <button className="pb-icon-btn" onClick={() => { sfx.back(); onClose(); }} title="Fechar (Esc)"><CloseIcon /></button>
        </header>

        <div className="pb-settings-section">
          <h3>Perfil ativo</h3>
          {activeProfile ? (
            <button className="pb-active-profile" onClick={() => { sfx.open(); onOpenProfiles(); }}>
              <div className="pb-profile-avatar pb-profile-avatar-sm">
                {(() => {
                  const src = getProfileAvatarUrl(activeProfile, convertFileSrc);
                  return src ? <img src={src} alt="" /> : <UserIcon />;
                })()}
              </div>
              <span>{activeProfile.name}</span>
              <span className="pb-active-profile-action">Trocar</span>
            </button>
          ) : (
            <button className="pb-settings-btn" onClick={() => { sfx.open(); onOpenProfiles(); }}>
              <UserIcon /> Criar perfil
            </button>
          )}
        </div>

        <div className="pb-settings-section">
          <h3>Tema</h3>
          <div className="pb-theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`pb-theme-card ${config.theme_id === t.id ? "active" : ""}`}
                onClick={() => onSetTheme(t.id)}
              >
                <div className="pb-theme-swatch">
                  {t.swatch.map((c, i) => <span key={i} style={{ background: c }} />)}
                </div>
                <span>{t.name}</span>
              </button>
            ))}
            <button
              className={`pb-theme-card ${config.theme_id === "custom" ? "active" : ""}`}
              onClick={() => onSetTheme("custom")}
              title="Tema customizado"
            >
              <div className="pb-theme-swatch">
                {(config.custom_theme ? [config.custom_theme.bg, config.custom_theme.card, config.custom_theme.text] : [DEFAULT_CUSTOM_THEME.bg, DEFAULT_CUSTOM_THEME.card, DEFAULT_CUSTOM_THEME.text]).map((c, i) => <span key={i} style={{ background: c }} />)}
              </div>
              <span>Custom</span>
            </button>
          </div>
          {config.theme_id === "custom" && (
            <CustomThemeEditor
              theme={config.custom_theme || DEFAULT_CUSTOM_THEME}
              onChange={onSetCustomTheme}
            />
          )}
        </div>

        <div className="pb-settings-section">
          <h3>Música ambiente</h3>
          <button
            className={`pb-settings-btn ${config.music_enabled ? "pb-settings-btn-danger" : ""}`}
            onClick={() => { sfx.toggle(); onToggleMusic(); }}
          >
            <PowerIcon />
            {config.music_enabled ? "Desativar música" : "Ativar música"}
          </button>
          {config.music_enabled && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <label className="pb-settings-hint" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ minWidth: 60 }}>Volume</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.music_volume ?? 0.3}
                  onChange={(e) => onSetMusicVolume(parseFloat(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ minWidth: 30, textAlign: "right" }}>{Math.round((config.music_volume ?? 0.3) * 100)}%</span>
              </label>
              <button className="pb-settings-btn" onClick={() => { sfx.click(); ambientMusic.skip(); }}>
                <RotateIcon /> Próxima música
              </button>
            </div>
          )}
          <p className="pb-settings-hint">Playlist embaralhada da pasta <code>music/</code>. Pausa enquanto jogo está aberto.</p>
        </div>

        <div className="pb-settings-section">
          <h3>Papel de parede</h3>
          {config.wallpaper_path && (
            <div className="pb-wallpaper-preview">
              <img src={convertFileSrc(config.wallpaper_path)} alt="" />
              <button className="pb-wallpaper-clear" onClick={onClearWallpaper} title="Remover">
                <CloseIcon />
              </button>
            </div>
          )}
          <button className="pb-settings-btn" style={{ justifyContent: "center" }} onClick={() => { sfx.click(); onPickWallpaper(); }}>
            <PlusIcon />
            {config.wallpaper_path ? "Trocar imagem" : "Escolher imagem"}
          </button>
        </div>

        <div className="pb-settings-section">
          <h3>Capas dos jogos</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onSyncCovers(); }} disabled={syncStatus.busy}>
            <RefreshIcon />
            {syncStatus.busy ? `Sincronizando ${syncStatus.text}...` : "Sincronizar capas (limpa cache)"}
          </button>
          <p className="pb-settings-hint">
            Apaga capas em cache e re-busca pelo IGDB. Use se alguma capa veio errada.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Biblioteca</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onRescan(); }} disabled={rescanBusy}>
            <RefreshIcon />
            {rescanBusy ? "Re-escaneando..." : "Re-escanear pasta de ROMs"}
          </button>
          <p className="pb-settings-hint">
            Detecta jogos novos sem precisar reabrir o app.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Switch — Yuzu</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onSetupSwitchKeys(); }} disabled={switchKeysStatus.busy}>
            <RefreshIcon />
            {switchKeysStatus.busy ? "Copiando..." : "Instalar keys + firmware (Yuzu)"}
          </button>
          {switchKeysStatus.message && (
            <p className="pb-settings-hint" style={{ color: switchKeysStatus.kind === "error" ? "#fca5a5" : "#86efac" }}>
              {switchKeysStatus.message}
            </p>
          )}
          <p className="pb-settings-hint">
            Copia <code>prod.keys</code>, <code>title.keys</code> e firmware NCA da pasta KEYS pra <code>%APPDATA%\yuzu\</code>.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Saves separados por perfil</h3>
          <button
            className={`pb-settings-btn ${savesStatus.enabled ? "pb-settings-btn-danger" : ""}`}
            onClick={() => { sfx.toggle(); onToggleSavesIsolation(); }}
            disabled={savesStatus.busy || !activeProfile}
          >
            <PowerIcon />
            {savesStatus.busy ? "Aplicando..." : (savesStatus.enabled ? "Desativar (restaurar pasta unica)" : "Ativar (saves separados)")}
          </button>
          {savesStatus.message && (
            <p className="pb-settings-hint" style={{ color: savesStatus.kind === "error" ? "#fca5a5" : "#86efac", whiteSpace: "pre-wrap" }}>
              {savesStatus.message}
            </p>
          )}
          <p className="pb-settings-hint">
            Quando ativo, cada perfil tem saves proprios (Yuzu, PCSX2, Dolphin, DuckStation, RPCS3, Project64). Trocar perfil = troca os saves automaticamente. Funciona via junctions Windows (NTFS).
          </p>
        </div>

        {activeProfile && (
          <div className="pb-settings-section">
            <h3>Estatisticas — {activeProfile.name}</h3>
            <div className="pb-stats">
              <div className="pb-stat"><strong>{activeProfile.total_launches || 0}</strong><span>jogos lancados</span></div>
              <div className="pb-stat"><strong>{(activeProfile.favorites || []).length}</strong><span>favoritos</span></div>
              <div className="pb-stat"><strong>{formatPlayTime(totalPlayTime)}</strong><span>tempo total</span></div>
              <div className="pb-stat"><strong>{Object.keys(activeProfile.play_time || {}).length}</strong><span>jogos abertos</span></div>
            </div>
            <CollectionStats gameMeta={activeProfile.game_meta || {}} systems={systems} />
            <TopPlayedList playTime={activeProfile.play_time || {}} sessions={activeProfile.sessions || []} systems={systems} />
            <SessionsGraph sessions={activeProfile.sessions} />
          </div>
        )}

        {activeProfile && (
          <div className="pb-settings-section">
            <h3>Conquistas ({unlocked.length}/{ACHIEVEMENTS.length})</h3>
            <ul className="pb-achievement-list">
              {[...unlocked, ...locked].map((a) => {
                const isUnlocked = unlocked.includes(a);
                return (
                  <li key={a.id} className={isUnlocked ? "unlocked" : "locked"}>
                    <span className="pb-achievement-list-icon"><StarIcon filled={isUnlocked} /></span>
                    <div>
                      <strong>{a.name}</strong>
                      <span>{a.desc}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <LicenseSettingsSection />

        <div className="pb-settings-section">
          <h3>Atualizações</h3>
          <div className="pb-version-line">
            <span className="pb-version-label">Versão instalada:</span>
            <strong className="pb-version-current">v{appVersion || "?"}</strong>
          </div>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); doCheckUpdate(); }} disabled={updateBusy}>
            <RefreshIcon /> {updateBusy ? "Verificando..." : "Verificar atualização"}
          </button>
          {updateStatus && (
            <p className="pb-settings-hint" style={{ color: updateStatus.kind === "error" ? "#fca5a5" : updateStatus.kind === "ok" ? "#86efac" : "#fcd34d" }}>
              {updateStatus.text}
            </p>
          )}
          <p className="pb-settings-hint" style={{ marginTop: 6 }}>
            Verifica novas versões em <code>github.com/EllaeMyApp/ludex</code>. Baixa e reinicia automaticamente.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Onde baixar jogos / DLCs / mods</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onOpenSuggestions && onOpenSuggestions(); }}>
            <PlusIcon /> Abrir guia de fontes
          </button>
          <p className="pb-settings-hint" style={{ marginTop: 6 }}>
            Lista de sites populares por categoria (ROMs, traduções PT-BR, mods de FPS/resolução, DLCs). Aviso legal e dicas pra evitar quebrar saves.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Discord Rich Presence</h3>
          <p className="pb-settings-hint" style={{ marginBottom: 10 }}>
            Mostra o jogo que você tá jogando no seu perfil do Discord.
            Crie uma "Application" em <code>discord.com/developers/applications</code> e cole o <strong>Client ID</strong> abaixo.
          </p>
          <input
            type="text"
            className="pb-input"
            placeholder="Discord Application ID (ex: 1234567890123456789)"
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <button className="pb-settings-btn" onClick={() => { sfx.click(); saveDiscord(); }}>
            <RefreshIcon /> Salvar e conectar
          </button>
          {discordStatus && (
            <p className="pb-settings-hint" style={{ color: discordStatus.kind === "error" ? "#fca5a5" : discordStatus.kind === "warn" ? "#fcd34d" : "#86efac" }}>
              {discordStatus.text}
            </p>
          )}
        </div>

        <div className="pb-settings-section">
          <h3>RetroAchievements</h3>
          {raSummary ? (
            <div className="pb-ra-card">
              <div className="pb-ra-header">
                <img className="pb-ra-avatar" src={raSummary.avatar_url} alt={raSummary.username} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <div className="pb-ra-meta">
                  <strong className="pb-ra-username">{raSummary.username}</strong>
                  <span className="pb-ra-points">{raSummary.total_points.toLocaleString()} pts</span>
                  {raSummary.rank > 0 && <span className="pb-ra-rank">Rank #{raSummary.rank.toLocaleString()}{raSummary.total_ranked > 0 ? ` / ${raSummary.total_ranked.toLocaleString()}` : ""}</span>}
                </div>
              </div>
              {raSummary.last_game_title && (
                <div className="pb-ra-last">
                  {raSummary.last_game_image_url && <img src={raSummary.last_game_image_url} alt="" />}
                  <div>
                    <span className="pb-ra-last-label">Último jogo</span>
                    <strong>{raSummary.last_game_title}</strong>
                    {raSummary.rich_presence_msg && <em>{raSummary.rich_presence_msg}</em>}
                  </div>
                </div>
              )}
              {raSummary.recent_achievements.length > 0 && (
                <>
                  <h4 className="pb-ra-sub">Conquistas recentes ({raSummary.recent_achievements.length})</h4>
                  <ul className="pb-ra-ach-list">
                    {raSummary.recent_achievements.slice(0, 8).map((a, i) => (
                      <li key={i} className={`pb-ra-ach ${a.hardcore ? "hardcore" : ""}`}>
                        {a.badge_url && <img className="pb-ra-ach-badge" src={a.badge_url} alt="" />}
                        <div className="pb-ra-ach-body">
                          <div className="pb-ra-ach-row">
                            <strong>{a.title}</strong>
                            <span className="pb-ra-ach-points">{a.points} pts{a.hardcore ? " · 🔥" : ""}</span>
                          </div>
                          <span className="pb-ra-ach-desc">{a.description}</span>
                          <span className="pb-ra-ach-game">{a.game_title} · {a.console_name}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="pb-settings-btn" onClick={() => { sfx.click(); refreshRa(); }} disabled={raBusy}>
                  <RefreshIcon /> {raBusy ? "..." : "Atualizar"}
                </button>
                <button className="pb-settings-btn pb-settings-btn-danger" onClick={() => { sfx.back(); clearRa(); }}>
                  <PowerIcon /> Desconectar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="pb-settings-hint" style={{ marginBottom: 10 }}>
                Mostra suas conquistas, pontos e ranking do <code>retroachievements.org</code>.
                Pegue sua <strong>Web API Key</strong> em <code>retroachievements.org/controlpanel.php</code>.
              </p>
              <input
                type="text"
                className="pb-input"
                placeholder="Username RA"
                value={raUser}
                onChange={(e) => setRaUser(e.target.value)}
                style={{ marginBottom: 8 }}
                autoComplete="off"
                spellCheck={false}
              />
              <input
                type="password"
                className="pb-input"
                placeholder="Web API Key (32 caracteres)"
                value={raKey}
                onChange={(e) => setRaKey(e.target.value)}
                style={{ marginBottom: 10 }}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="pb-settings-btn" onClick={() => { sfx.click(); saveRa(); }} disabled={raBusy}>
                <RefreshIcon /> {raBusy ? "Validando..." : "Conectar"}
              </button>
            </>
          )}
          {raStatus && (
            <p className="pb-settings-hint" style={{ color: raStatus.kind === "error" ? "#fca5a5" : raStatus.kind === "warn" ? "#fcd34d" : raStatus.kind === "info" ? "#a5b4fc" : "#86efac" }}>
              {raStatus.text}
            </p>
          )}
        </div>

        <div className="pb-settings-section">
          <h3>Pasta de ROMs</h3>
          <code className="pb-settings-path">{romsRoot}</code>
        </div>

        <div className="pb-settings-section">
          <h3>Pasta dos Emuladores</h3>
          <code className="pb-settings-path">{emulatorsRoot}</code>
        </div>

        <div className="pb-settings-section">
          <h3>Emuladores</h3>
          <ul className="pb-settings-list">
            {systems.map((s) => (
              <li key={s.id}>
                <span className={`pb-status ${s.emulator_exists ? "ok" : "fail"}`} />
                <div className="pb-settings-list-info">
                  <strong>{s.name}</strong>
                  <code>{s.emulator_path}</code>
                </div>
                <span className="pb-settings-list-count">{s.games.length}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pb-settings-section">
          <h3>Atalhos</h3>
          <dl className="pb-shortcuts">
            <dt>← →</dt><dd>Navegar jogo</dd>
            <dt>↑ ↓</dt><dd>Navegar sistema</dd>
            <dt>ENTER</dt><dd>Lancar jogo</dd>
            <dt>F</dt><dd>Marcar favorito</dd>
            <dt>/</dt><dd>Buscar jogo</dd>
            <dt>S</dt><dd>Configuracoes</dd>
            <dt>P</dt><dd>Trocar perfil</dd>
            <dt>F11</dt><dd>Tela cheia</dd>
            <dt>ESC</dt><dd>Voltar / Fechar painel</dd>
          </dl>
          <p className="pb-settings-hint" style={{ marginTop: 12 }}>
            Controle: D-Pad/Stick = navegar · A = lançar · X = perfil · Y = config · Select+Start (no jogo) = sair pro launcher
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Sistema</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.toggle(); onToggleFullscreen(); }}>
            <FullscreenIcon />
            {isFullscreen ? "Sair da Tela Cheia" : "Entrar em Tela Cheia"}
          </button>
          <button className="pb-settings-btn pb-settings-btn-danger" onClick={() => { sfx.back(); onQuit(); }}>
            <PowerIcon /> Sair do Ludex
          </button>
        </div>

        <div className="pb-settings-section">
          <h3>Diagnóstico</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onShowHealth && onShowHealth(); }}>
            <CheckIcon /> Health Check dos emuladores
          </button>
          <p className="pb-settings-hint">Verifica setup de cada emulador (.exe presente, ROMs detectadas, BIOS Xbox, etc).</p>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onShowLogs(); }}>
            <InfoIcon /> Ver logs do app
          </button>
          <p className="pb-settings-hint">Útil quando algum jogo não abre — mostra as últimas 200 linhas do log.</p>
        </div>

        <footer className="pb-settings-footer">Ludex · v0.4</footer>
      </aside>
    </>
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

function EmulatorView({ system, game, onClose, autoLoadSlot = null }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [stateMsg, setStateMsg] = useState(null);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [slots, setSlots] = useState([]);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const audioCtxRef = useRef(null);
  const audioNextTimeRef = useRef(0);
  const audioRateRef = useRef(32040);
  const autoLoadDoneRef = useRef(false);

  // Mapeamento teclado -> button id libretro (joypad)
  const KEY_MAP = useMemo(() => ({
    ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7,
    "z": 0, "Z": 0,    // B
    "x": 8, "X": 8,    // A
    "a": 1, "A": 1,    // Y
    "s": 9, "S": 9,    // X
    "Enter": 3,        // START
    "Shift": 2,        // SELECT
    "q": 10, "Q": 10,  // L
    "w": 11, "W": 11,  // R
  }), []);

  // Carrega core + ROM
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const coreFile = system.libretro_core; // ex: "snes9x_libretro.dll"
        if (!coreFile) {
          setError(`Sistema "${system.name}" sem core libretro configurado`);
          return;
        }
        const result = await invoke("libretro_load_game", { coreFilename: coreFile, romPath: game.path });
        if (cancelled) return;
        setInfo(result);
        audioRateRef.current = result.sample_rate || 32040;
        // Ajusta tamanho do canvas
        if (canvasRef.current) {
          canvasRef.current.width = result.base_width;
          canvasRef.current.height = result.base_height;
        }
        // Inicializa AudioContext com a sample rate do core
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: result.sample_rate });
          await ctx.resume();
          audioCtxRef.current = ctx;
          audioNextTimeRef.current = ctx.currentTime + 0.05; // 50ms buffer inicial
        } catch (e) {
          console.warn("AudioContext init", e);
        }
      } catch (e) {
        console.error("libretro_load_game", e);
        setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      invoke("libretro_unload").catch(() => {});
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
    };
  }, [system.id, game.path, system.libretro_core]);

  // Loop de frames
  useEffect(() => {
    if (!info) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let lastTime = performance.now();
    const targetFrameMs = 1000 / (info.fps || 60);

    async function tick() {
      const now = performance.now();
      if (now - lastTime >= targetFrameMs - 1) {
        lastTime = now;
        try {
          // Response binario: 4 bytes width LE + 4 bytes height LE + rgba
          const buf = await invoke("libretro_run_frame");
          if (buf && buf.byteLength >= 8) {
            const view = new DataView(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength);
            const w = view.getUint32(0, true);
            const h = view.getUint32(4, true);
            const rgba = new Uint8ClampedArray(
              buf.buffer ? buf.buffer : buf,
              (buf.byteOffset || 0) + 8,
              w * h * 4
            );
            if (w !== ctx.canvas.width || h !== ctx.canvas.height) {
              ctx.canvas.width = w;
              ctx.canvas.height = h;
            }
            const imageData = new ImageData(rgba, w, h);
            ctx.putImageData(imageData, 0, 0);
          }
          // Drena audio e agenda no AudioContext
          const audioBuf = await invoke("libretro_take_audio");
          const actx = audioCtxRef.current;
          if (audioBuf && audioBuf.byteLength > 0 && actx) {
            const i16 = new Int16Array(
              audioBuf.buffer ? audioBuf.buffer : audioBuf,
              audioBuf.byteOffset || 0,
              audioBuf.byteLength / 2
            );
            const frames = i16.length / 2; // stereo
            if (frames > 0) {
              const sampleRate = audioRateRef.current;
              const audioBufNode = actx.createBuffer(2, frames, sampleRate);
              const left = audioBufNode.getChannelData(0);
              const right = audioBufNode.getChannelData(1);
              for (let i = 0; i < frames; i++) {
                left[i]  = i16[i * 2]     / 32768;
                right[i] = i16[i * 2 + 1] / 32768;
              }
              const source = actx.createBufferSource();
              source.buffer = audioBufNode;
              source.connect(actx.destination);
              // Anti-glitch: se atrasou, ressincroniza
              if (audioNextTimeRef.current < actx.currentTime + 0.02) {
                audioNextTimeRef.current = actx.currentTime + 0.05;
              }
              source.start(audioNextTimeRef.current);
              audioNextTimeRef.current += frames / sampleRate;
            }
          }
        } catch (e) {
          console.error("frame tick", e);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [info]);

  const showStateMsg = useCallback((kind, text) => {
    setStateMsg({ kind, text });
    setTimeout(() => setStateMsg(null), 1800);
  }, []);

  // Captura canvas atual como PNG (Uint8Array, ~tamanho do frame escalado)
  const captureThumbnail = useCallback(async () => {
    const c = canvasRef.current;
    if (!c) return null;
    try {
      // Resampleia pra 320px largura mantendo proporcao
      const targetW = 320;
      const targetH = Math.max(1, Math.round((c.height / c.width) * targetW));
      const off = document.createElement("canvas");
      off.width = targetW;
      off.height = targetH;
      const offCtx = off.getContext("2d");
      offCtx.imageSmoothingEnabled = true;
      offCtx.drawImage(c, 0, 0, targetW, targetH);
      const blob = await new Promise((res) => off.toBlob(res, "image/png"));
      if (!blob) return null;
      const arr = new Uint8Array(await blob.arrayBuffer());
      return Array.from(arr); // tauri serializa Vec<u8> a partir de array de numeros
    } catch (e) {
      console.warn("captureThumbnail", e);
      return null;
    }
  }, []);

  const refreshSlots = useCallback(async () => {
    try {
      const list = await invoke("libretro_list_states", { romPath: game.path });
      setSlots(list || []);
    } catch (e) {
      console.warn("list_states", e);
    }
  }, [game.path]);

  const saveState = useCallback(async (slot = 0) => {
    setSlotsBusy(true);
    try {
      const thumb = await captureThumbnail();
      await invoke("libretro_save_state", { romPath: game.path, slot, thumbnailPng: thumb });
      showStateMsg("ok", `Save slot ${slot} salvo`);
      refreshSlots();
    } catch (e) {
      showStateMsg("error", `Erro: ${e}`);
    } finally {
      setSlotsBusy(false);
    }
  }, [game.path, showStateMsg, captureThumbnail, refreshSlots]);

  const loadState = useCallback(async (slot = 0) => {
    try {
      await invoke("libretro_load_state", { romPath: game.path, slot });
      showStateMsg("ok", `Save slot ${slot} carregado`);
    } catch (e) {
      showStateMsg("error", `${e}`);
    }
  }, [game.path, showStateMsg]);

  const deleteState = useCallback(async (slot) => {
    setSlotsBusy(true);
    try {
      await invoke("libretro_delete_state", { romPath: game.path, slot });
      showStateMsg("ok", `Slot ${slot} apagado`);
      refreshSlots();
    } catch (e) {
      showStateMsg("error", `${e}`);
    } finally {
      setSlotsBusy(false);
    }
  }, [game.path, showStateMsg, refreshSlots]);

  // Auto-load (quick resume) + carrega lista de slots inicial
  useEffect(() => {
    if (!info) return;
    refreshSlots();
    if (autoLoadSlot != null && !autoLoadDoneRef.current) {
      autoLoadDoneRef.current = true;
      // Pequeno delay pra core estabilizar antes do unserialize
      const t = setTimeout(() => { loadState(autoLoadSlot); }, 250);
      return () => clearTimeout(t);
    }
  }, [info, autoLoadSlot, loadState, refreshSlots]);

  // Input teclado -> libretro + hotkeys F5/F8/Tab
  useEffect(() => {
    const onKey = (e, pressed) => {
      // Tab abre/fecha overlay de slots (so no keydown)
      if (pressed && (e.key === "Tab" || e.key === "F1")) {
        e.preventDefault();
        setSlotsOpen((v) => {
          if (!v) refreshSlots();
          return !v;
        });
        return;
      }
      if (slotsOpen) {
        if (pressed && e.key === "Escape") { e.preventDefault(); setSlotsOpen(false); return; }
        // Numeros 1-9 carregam slot, Shift+1-9 salvam
        if (pressed && /^[1-9]$/.test(e.key)) {
          e.preventDefault();
          const n = parseInt(e.key, 10);
          if (e.shiftKey) saveState(n); else loadState(n);
          return;
        }
        if (pressed && e.key === "0") { e.preventDefault(); if (e.shiftKey) saveState(0); else loadState(0); return; }
        // Bloqueia input do jogo enquanto overlay aberto
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      // Hotkeys: F5 save quick (slot 0), F8 load quick (slot 0)
      if (pressed) {
        if (e.key === "F5") { e.preventDefault(); saveState(0); return; }
        if (e.key === "F8") { e.preventDefault(); loadState(0); return; }
      }
      const id = KEY_MAP[e.key];
      if (id !== undefined) {
        e.preventDefault();
        invoke("libretro_set_input", { buttonId: id, pressed }).catch(() => {});
      }
    };
    const down = (e) => onKey(e, true);
    const up = (e) => onKey(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [KEY_MAP, onClose, saveState, loadState, slotsOpen, refreshSlots]);

  // Input gamepad -> libretro (poll 60fps)
  useEffect(() => {
    if (!info) return;
    let raf;
    // Mapeamento std gamepad button -> libretro id
    // Standard mapping: 0=A, 1=B, 2=X, 3=Y, 4=LB, 5=RB, 6=LT, 7=RT, 8=Back, 9=Start, 10=L3, 11=R3, 12=Up, 13=Down, 14=Left, 15=Right
    const PAD_MAP = {
      0: 0,    // A -> B(libretro)
      1: 8,    // B -> A
      2: 1,    // X -> Y
      3: 9,    // Y -> X
      4: 10,   // LB -> L
      5: 11,   // RB -> R
      6: 12,   // LT -> L2
      7: 13,   // RT -> R2
      8: 2,    // Back -> SELECT
      9: 3,    // Start -> START
      10: 14,  // L3
      11: 15,  // R3
      12: 4,   // Up
      13: 5,   // Down
      14: 6,   // Left
      15: 7,   // Right
    };
    const lastState = new Array(16).fill(false);

    function poll() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null;
      for (const p of pads) { if (p) { pad = p; break; } }
      if (pad) {
        // Combo Select+Start = sair
        if (pad.buttons[8]?.pressed && pad.buttons[9]?.pressed) {
          onClose();
          return;
        }
        // Botoes
        for (const [padIdx, libretroId] of Object.entries(PAD_MAP)) {
          const pressed = pad.buttons[parseInt(padIdx)]?.pressed || false;
          if (pressed !== lastState[libretroId]) {
            lastState[libretroId] = pressed;
            invoke("libretro_set_input", { buttonId: libretroId, pressed }).catch(() => {});
          }
        }
        // Stick analogico esquerdo -> dpad
        const ax = pad.axes[0] || 0;
        const ay = pad.axes[1] || 0;
        const left  = ax < -0.5;
        const right = ax > 0.5;
        const up    = ay < -0.5;
        const down  = ay > 0.5;
        if (left !== lastState[6]) { lastState[6] = left; invoke("libretro_set_input", { buttonId: 6, pressed: left }).catch(() => {}); }
        if (right !== lastState[7]) { lastState[7] = right; invoke("libretro_set_input", { buttonId: 7, pressed: right }).catch(() => {}); }
        if (up !== lastState[4]) { lastState[4] = up; invoke("libretro_set_input", { buttonId: 4, pressed: up }).catch(() => {}); }
        if (down !== lastState[5]) { lastState[5] = down; invoke("libretro_set_input", { buttonId: 5, pressed: down }).catch(() => {}); }
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [info, onClose]);

  return (
    <div className="pb-emulator-view" onContextMenu={(e) => e.preventDefault()}>
      <button className="pb-emulator-close" onClick={onClose} title="Sair (Esc / Select+Start)">
        <CloseIcon />
      </button>
      <div className="pb-emulator-info">
        <span className="pb-emulator-icon" style={{ color: system.color }}><SystemIcon id={system.id} /></span>
        <span className="pb-emulator-game">{game.name}</span>
        {info && <span className="pb-emulator-meta">{info.library_name} {info.library_version} · {info.base_width}×{info.base_height} · {Math.round(info.fps)}fps</span>}
      </div>
      <div className="pb-emulator-hints">
        <kbd>Tab</kbd> Slots · <kbd>F5</kbd>/<kbd>F8</kbd> Quick · <kbd>Esc</kbd> Sair
      </div>
      {stateMsg && (
        <div className={`pb-emulator-state-msg pb-emulator-state-${stateMsg.kind}`}>
          {stateMsg.text}
        </div>
      )}
      {error ? (
        <div className="pb-emulator-error">
          <strong>Erro ao carregar:</strong>
          <code>{error}</code>
          <button className="pb-btn pb-btn-primary" onClick={onClose}>Voltar</button>
        </div>
      ) : (
        <canvas ref={canvasRef} className="pb-emulator-canvas" />
      )}
      {slotsOpen && (
        <SaveStateOverlay
          slots={slots}
          busy={slotsBusy}
          onClose={() => setSlotsOpen(false)}
          onSave={(slot) => saveState(slot)}
          onLoad={(slot) => loadState(slot)}
          onDelete={(slot) => deleteState(slot)}
        />
      )}
    </div>
  );
}

function ResumePromptModal({ info, onContinue, onFresh, onCancel }) {
  function fmt(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}min atras`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atras`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d atras`;
    return d.toLocaleDateString("pt-BR");
  }
  return (
    <div className="pb-modal-backdrop" onClick={onCancel}>
      <div className="pb-modal pb-resume-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pb-modal-header">
          <h2>Continuar de onde parou?</h2>
          <button className="pb-icon-btn" onClick={onCancel}><CloseIcon /></button>
        </header>
        <div className="pb-resume-body">
          <p><strong>{info.game.name}</strong></p>
          <p className="pb-resume-meta">Slot {info.slot} · salvo {fmt(info.when)}</p>
          <div className="pb-resume-actions">
            <button className="pb-btn pb-btn-primary" autoFocus onClick={onContinue}>Continuar</button>
            <button className="pb-btn" onClick={onFresh}>Comecar do inicio</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveStateOverlay({ slots, busy, onClose, onSave, onLoad, onDelete }) {
  const slotMap = useMemo(() => {
    const m = new Map();
    for (const s of slots) m.set(s.slot, s);
    return m;
  }, [slots]);
  const cards = [];
  for (let i = 1; i <= 9; i++) cards.push(i);

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return "agora";
    if (diff < 3600) return `${Math.floor(diff / 60)}min atras`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atras`;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="pb-savestate-overlay" onClick={onClose}>
      <div className="pb-savestate-panel" onClick={(e) => e.stopPropagation()}>
        <header className="pb-savestate-header">
          <h2>Save States</h2>
          <button className="pb-icon-btn" onClick={onClose} title="Fechar (Tab/Esc)"><CloseIcon /></button>
        </header>
        <p className="pb-savestate-hint">
          <kbd>1-9</kbd> carrega · <kbd>Shift+1-9</kbd> salva · clique nos slots abaixo
        </p>
        <div className="pb-savestate-grid">
          {cards.map((n) => {
            const info = slotMap.get(n);
            const empty = !info;
            return (
              <div key={n} className={`pb-savestate-card ${empty ? "empty" : ""}`}>
                <div className="pb-savestate-thumb">
                  {info?.thumbnail_path ? (
                    <img src={convertFileSrc(info.thumbnail_path)} alt={`Slot ${n}`} />
                  ) : (
                    <span className="pb-savestate-empty-label">vazio</span>
                  )}
                  <span className="pb-savestate-slot-num">{n}</span>
                </div>
                <div className="pb-savestate-meta">
                  {info ? fmtTime(info.modified_at) : "—"}
                </div>
                <div className="pb-savestate-actions">
                  <button
                    className="pb-savestate-btn"
                    disabled={busy}
                    onClick={() => onSave(n)}
                    title="Salvar (sobrescreve)"
                  >Salvar</button>
                  <button
                    className="pb-savestate-btn pb-savestate-btn-primary"
                    disabled={busy || empty}
                    onClick={() => { onLoad(n); onClose(); }}
                    title="Carregar"
                  >Carregar</button>
                  {!empty && (
                    <button
                      className="pb-savestate-btn pb-savestate-btn-danger"
                      disabled={busy}
                      onClick={() => onDelete(n)}
                      title="Apagar"
                    >×</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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

const GAME_STATUS_LABELS = {
  "": "Sem status",
  "wishlist": "Quero jogar",
  "playing": "Jogando",
  "beat": "Zerei",
  "mastered": "Platinei",
  "abandoned": "Abandonei",
};
const GAME_STATUS_ORDER = ["", "wishlist", "playing", "beat", "mastered", "abandoned"];
const GAME_STATUS_EMOJI = {
  "": "○",
  "wishlist": "★",
  "playing": "▶",
  "beat": "✔",
  "mastered": "✦",
  "abandoned": "✕",
};

function GameDetailPanel({ system, game, playTimeSec, gameMeta, onClose, onLaunch, onPickCover, onResyncCover, onOpenLocation, onToggleFavorite, isFavorite, onSetRating, onSetStatus, onSetNotes, closing }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeShot, setActiveShot] = useState(0);
  const [notesDraft, setNotesDraft] = useState(gameMeta?.notes || "");
  const notesTimerRef = useRef(null);

  // Sincroniza draft quando muda de jogo
  useEffect(() => {
    setNotesDraft(gameMeta?.notes || "");
  }, [game.path, gameMeta?.notes]);

  // Auto-save notas (debounce 600ms)
  useEffect(() => {
    if (notesDraft === (gameMeta?.notes || "")) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      onSetNotes && onSetNotes(notesDraft);
    }, 600);
    return () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); };
  }, [notesDraft]);

  const cycleStatus = () => {
    const cur = gameMeta?.status || "";
    const idx = GAME_STATUS_ORDER.indexOf(cur);
    const next = GAME_STATUS_ORDER[(idx + 1) % GAME_STATUS_ORDER.length];
    onSetStatus && onSetStatus(next);
  };
  const curStatus = gameMeta?.status || "";
  const curRating = gameMeta?.rating || 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    setActiveShot(0);
    (async () => {
      try {
        const d = await invoke("fetch_game_details", { systemId: system.id, gameName: game.name });
        if (!cancelled) setDetails(d);
      } catch (e) {
        console.error("fetch_game_details", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [system.id, game.path, game.name]);

  // Auto-rotate screenshots a cada 4s
  useEffect(() => {
    if (!details?.screenshot_paths?.length) return;
    const id = setInterval(() => {
      setActiveShot((i) => (i + 1) % details.screenshot_paths.length);
    }, 4000);
    return () => clearInterval(id);
  }, [details]);

  // Hotkeys: ESC fecha, Enter lança, F favorita
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "Enter") { e.preventDefault(); onLaunch(); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); onToggleFavorite(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onLaunch, onToggleFavorite]);

  const heroSrc = details?.cover_path ? convertFileSrc(details.cover_path) : null;
  const shotSrc = details?.screenshot_paths?.[activeShot] ? convertFileSrc(details.screenshot_paths[activeShot]) : null;

  return (
    <div className={`pb-detail ${closing ? "closing" : ""}`} aria-hidden={closing}>
      {shotSrc && <img key={shotSrc} className="pb-detail-bg" src={shotSrc} alt="" aria-hidden />}
      <div className="pb-detail-overlay" />

      <button className="pb-detail-close" onClick={onClose} title="Fechar (Esc)"><CloseIcon /></button>

      <div className="pb-detail-stage">
        <div className="pb-detail-cover-wrap">
          {heroSrc ? (
            <img className="pb-detail-cover" src={heroSrc} alt={game.name} />
          ) : (
            <div className="pb-detail-cover pb-detail-cover-fallback" style={{ background: system.color }}>
              <div className="pb-detail-cover-icon"><SystemIcon id={system.id} /></div>
            </div>
          )}
          {isFavorite && <span className="pb-detail-fav"><StarIcon filled /></span>}
        </div>

        <div className="pb-detail-info">
          <div className="pb-detail-tag">
            <span className="pb-detail-tag-icon" style={{ color: system.color }}><SystemIcon id={system.id} /></span>
            <span className="pb-detail-tag-name">{system.name}</span>
          </div>

          <h1 className="pb-detail-title">{details?.name || game.name}</h1>

          <div className="pb-detail-meta">
            {details?.first_release_year && <span>{details.first_release_year}</span>}
            {details?.developer && <span>· {details.developer}</span>}
            {details?.publisher && details.publisher !== details.developer && <span>· {details.publisher}</span>}
            {typeof details?.rating === "number" && <span className="pb-detail-rating">{Math.round(details.rating)}<small>/100</small></span>}
          </div>

          {details?.genres?.length > 0 && (
            <div className="pb-detail-genres">
              {details.genres.slice(0, 5).map((g) => <span key={g} className="pb-detail-genre">{g}</span>)}
            </div>
          )}

          <div className="pb-detail-stats">
            <div className="pb-detail-stat">
              <strong>{formatPlayTime(playTimeSec || 0)}</strong>
              <span>tempo jogado</span>
            </div>
            <div className="pb-detail-stat">
              <strong>{game.size_mb ? `${game.size_mb} MB` : "—"}</strong>
              <span>tamanho</span>
            </div>
            <div className="pb-detail-stat">
              <strong>{game.extension?.toUpperCase() || "—"}</strong>
              <span>formato</span>
            </div>
          </div>

          {/* Personal library: status + rating + notes */}
          <div className="pb-detail-personal">
            <div className="pb-detail-personal-row">
              <button
                className={`pb-status-pill pb-status-${curStatus || "none"}`}
                onClick={cycleStatus}
                title="Clique pra ciclar entre os status (sem status → quero jogar → jogando → zerei → platinei → abandonei)"
              >
                <span className="pb-status-icon">{GAME_STATUS_EMOJI[curStatus]}</span>
                <span className="pb-status-label">{GAME_STATUS_LABELS[curStatus]}</span>
              </button>
              <div className="pb-rating" role="group" aria-label="Sua nota">
                {[1,2,3,4,5].map((n) => (
                  <button
                    key={n}
                    className={`pb-rating-star ${n <= curRating ? "filled" : ""}`}
                    onClick={() => onSetRating && onSetRating(n === curRating ? 0 : n)}
                    title={`${n} estrela${n > 1 ? "s" : ""} (clique de novo pra limpar)`}
                  >★</button>
                ))}
              </div>
            </div>
            <textarea
              className="pb-detail-notes"
              placeholder="Suas notas sobre o jogo... (auto-salva)"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              maxLength={4000}
              rows={3}
            />
          </div>

          {loading && !details && (
            <p className="pb-detail-loading">Buscando informações no IGDB...</p>
          )}

          {details?.summary && (
            <p className="pb-detail-summary">{details.summary}</p>
          )}

          {details?.screenshot_paths?.length > 0 && (
            <div className="pb-detail-shots">
              {details.screenshot_paths.map((p, i) => (
                <button
                  key={p}
                  className={`pb-detail-shot ${i === activeShot ? "active" : ""}`}
                  onClick={() => setActiveShot(i)}
                >
                  <img src={convertFileSrc(p)} alt="" />
                </button>
              ))}
            </div>
          )}

          <div className="pb-detail-actions">
            <button className="pb-btn pb-btn-primary pb-btn-large" onClick={onLaunch}>
              <PlayIcon /> Jogar
            </button>
            <button className="pb-btn pb-btn-ghost" onClick={onToggleFavorite}>
              <StarIcon filled={isFavorite} />
              {isFavorite ? "Favorito" : "Favoritar"}
            </button>
            <button className="pb-btn pb-btn-ghost" onClick={onPickCover}>
              <ImageIcon /> Trocar capa
            </button>
            <button className="pb-btn pb-btn-ghost" onClick={onResyncCover}>
              <RotateIcon /> Re-sync IGDB
            </button>
            <button className="pb-btn pb-btn-ghost" onClick={onOpenLocation}>
              <FolderIcon /> Abrir local
            </button>
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
        <div className="pb-demo-expired-icon">⏱️</div>
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
  // focusZone: "games" (default, navega jogos) | "systems" (navega barra de sistemas)
  // D-pad DOWN em games -> systems. D-pad UP em systems -> games. A em systems -> entra (volta pra games).
  const [focusZone, setFocusZone] = useState("games");
  const [selectedGameIdx, setSelectedGameIdx] = useState(0);
  const [launchMsg, setLaunchMsg] = useState(null);
  const [covers, setCovers] = useState({});
  const [splashDone, setSplashDone] = useState(false);
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

  const visibleGames = useMemo(() => {
    if (!selected) return [];
    const profile = config.profiles.find((p) => p.id === config.active_profile_id);
    const playTime = profile?.play_time || {};
    const sessions = profile?.sessions || [];
    // Mapeia rom_path -> ultimo timestamp jogado (a partir de sessions)
    const lastByRom = {};
    for (const s of sessions) {
      const cur = lastByRom[s.rom_path] || 0;
      const end = (s.started_at || 0) + (s.duration_sec || 0);
      if (end > cur) lastByRom[s.rom_path] = end;
    }
    const ptKey = (g) => `${g._origin_system_id || selected.id}::${g.path}`;
    let games = [...selected.games];
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
      case "fav":
        games = games.filter((g) => favoriteSet.has(g.path));
        break;
      default: break;
    }
    return games;
  }, [selected, sortMode, config.profiles, config.active_profile_id, favoriteSet]);

  const selectedGame = visibleGames[selectedGameIdx];
  const launchSystemId = selectedGame?._origin_system_id || selected?.id;
  const accentColor = selected?.color || "#666";
  const selectedCoverSrc = selectedGame ? covers[selectedGame.path] : null;
  const selectedShotSrc = selectedGame ? screenshots[selectedGame.path] : null;
  const selectedBgSrc = selectedShotSrc || selectedCoverSrc;
  const activeProfile = useMemo(
    () => config.profiles.find((p) => p.id === config.active_profile_id),
    [config]
  );

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
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("keydown", unlock, { once: false });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
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
        const hasProfile = (c?.profiles || []).length > 0 && !!c?.active_profile_id;
        if (!hasProfile && !c?.first_run_done) {
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
        // Pega o primeiro pad com pelo menos 1 botao OU eixo nao-zero (filtra phantoms)
        let pad = null;
        for (const p of pads) {
          if (!p) continue;
          // Se ainda nao identificou nenhum, pega esse mesmo
          pad = p;
          break;
        }
        setGamepadConnected(!!pad);
        // Publica diagnostico no window pra overlay ler
        window.__pbGamepad = pad;
        // Pausa polling quando emulador embarcado roda (input deve ir pro libretro).
        if (!pad || ctx.emulatorOpen) {
          raf = requestAnimationFrame(poll);
          return;
        }
        // Quando ha modal aberto: input vai pro modal handler.
        // Modal handler retorna true se consumiu o input.
        const modalActive = ctx.settingsOpen || ctx.profilesOpen || ctx.searchOpen || ctx.previewOpen;
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
        // D-pad como botoes SO confia se mapping for standard (Xbox via XInput)
        const dpRight = isStandard && !!pad.buttons[15]?.pressed;
        const dpLeft  = isStandard && !!pad.buttons[14]?.pressed;
        const dpDown  = isStandard && !!pad.buttons[13]?.pressed;
        const dpUp    = isStandard && !!pad.buttons[12]?.pressed;
        // Em controles non-standard, alguns mapeiam D-pad como axes[6]/axes[7] (HAT)
        // axes[9] em alguns DS4: -1=up, -0.71=up-right, etc. Detecta via valores discretos
        const hatX = pad.axes[6] || 0;
        const hatY = pad.axes[7] || 0;
        const right = dpRight || ax > DEADZONE || hatX > 0.5;
        const left  = dpLeft  || ax < -DEADZONE || hatX < -0.5;
        const down  = dpDown  || ay > DEADZONE || hatY > 0.5;
        const up    = dpUp    || ay < -DEADZONE || hatY < -0.5;
        const lb    = isStandard && !!pad.buttons[4]?.pressed;
        const rb    = isStandard && !!pad.buttons[5]?.pressed;

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

        // botoes: edge detection (1 press = 1 acao). So aceita botoes em controle standard
        // pra evitar disparar acoes erradas em controle generico mal-mapeado.
        if (isStandard) {
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
          <button className="pb-icon-btn" onClick={pickRandomGame} title="Surpresa! (R) — escolhe jogo aleatorio">🎲</button>
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
              <span className="pb-category-icon">{cat.icon}</span>
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
                key={sys.id}
                className={`pb-sys ${isActive ? (focusZone === "systems" ? "active focused" : "active") : ""} ${isEmpty ? "empty" : ""} ${isFav ? "pb-sys-favorites" : ""}`}
                style={{ "--sys-color": sys.color }}
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

      <div className="pb-hints">
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
      </div>

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

      {/* First-run onboarding: tour spotlight + criacao de perfil. Fica em
       * cima de tudo (z-index 9000) ate o user concluir. */}
      {firstRunActive && splashDone && (
        <LudexOnboarding onComplete={handleFirstRunComplete} />
      )}
    </div>
  );
}
