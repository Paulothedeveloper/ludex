/**
 * ludexMobileAudio.js — sfx + jingles por sistema (mobile-adapted).
 *
 * Adaptado do LudexLauncher.jsx (desktop) com:
 *  - volumes em ~50% (alto-falante mobile vibra alto)
 *  - durations ligeiramente menores pra feedback rapido
 *  - audio context resume no primeiro toque (autoplay policy WebView Android)
 *  - sfx muted global (window.__ludex_mute)
 */

let _audioCtx = null;

export function audioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

export function unlockAudio() {
  const ctx = audioCtx();
  if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
}

function isMuted() {
  try { return !!window.__ludex_mute || localStorage.getItem("ludex.mobile.mute") === "1"; }
  catch { return false; }
}

export function setMuted(v) {
  window.__ludex_mute = !!v;
  try { localStorage.setItem("ludex.mobile.mute", v ? "1" : "0"); } catch {}
}

export function isMutedNow() { return isMuted(); }

function playTone(freq, duration, type = "sine", volume = 0.03, when = 0) {
  if (isMuted()) return;
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

function playNote(freq, duration, volume = 0.04, when = 0) {
  if (isMuted()) return;
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
    sub.frequency.value = freq * 2;
    subGain.gain.value = volume * 0.22;
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

// Volumes mobile-tuned (50-60% do desktop)
export const sfx = {
  nav:       () => playTone(520, 0.035, "sine", 0.022),
  switchSys: () => playTone(380, 0.05, "sine", 0.025),
  confirm:   () => { playTone(660, 0.05, "triangle", 0.030); setTimeout(() => playTone(880, 0.07, "triangle", 0.030), 45); },
  back:      () => playTone(220, 0.06, "sine", 0.025),
  fav:       () => { playTone(700, 0.04, "triangle", 0.030); setTimeout(() => playTone(1100, 0.07, "triangle", 0.030), 50); },
  click:     () => playTone(880, 0.02, "square", 0.015),
  toggle:    () => { playTone(440, 0.025, "triangle", 0.025); setTimeout(() => playTone(660, 0.035, "triangle", 0.025), 28); },
  open:      () => { playTone(330, 0.04, "sine", 0.025); setTimeout(() => playTone(495, 0.06, "sine", 0.025), 35); },
  achievement: () => {
    playTone(523, 0.08, "triangle", 0.035);
    setTimeout(() => playTone(659, 0.08, "triangle", 0.035), 80);
    setTimeout(() => playTone(784, 0.15, "triangle", 0.035), 160);
  },
  // Boot/shutdown do emulador (mobile mais curto que desktop)
  shutdown: () => {
    playTone(880, 0.06, "sine",    0.030, 0.00);
    playTone(523, 0.08, "sine",    0.035, 0.04);
    playTone(330, 0.10, "sine",    0.035, 0.11);
    playTone(220, 0.12, "sine",    0.035, 0.20);
    playTone(80,  0.05, "square",  0.060, 0.32);
    playTone(60,  0.20, "triangle", 0.030, 0.40);
  },
  loading: () => playTone(660, 0.04, "triangle", 0.025),
};

// Jingles por plataforma — copiados do desktop com volume reduzido 40%
export const PLATFORM_JINGLES = {
  switch:     () => { playNote(659.25, 0.10, 0.035); playNote(987.77, 0.18, 0.035, 0.10); },
  snes:       () => { playNote(523.25, 0.08, 0.030); playNote(659.25, 0.08, 0.030, 0.08); playNote(783.99, 0.08, 0.030, 0.16); playNote(1046.50, 0.18, 0.035, 0.24); },
  wiiu:       () => { playNote(440.00, 0.08, 0.030); playNote(554.37, 0.08, 0.030, 0.08); playNote(659.25, 0.18, 0.035, 0.16); },
  wii:        () => { playNote(880.00, 0.08, 0.030); playNote(587.33, 0.18, 0.035, 0.10); },
  gc:         () => { playNote(523.25, 0.07, 0.030); playNote(659.25, 0.07, 0.030, 0.08); playNote(783.99, 0.16, 0.035, 0.16); },
  n64:        () => { playNote(739.99, 0.07, 0.030); playNote(523.25, 0.07, 0.030, 0.08); playNote(415.30, 0.18, 0.035, 0.16); },
  gba:        () => { playTone(987.77, 0.07, "square", 0.025, 0.00); playTone(1318.51, 0.16, "square", 0.025, 0.08); },
  ps3:        () => { playNote(329.63, 0.08, 0.030); playNote(440.00, 0.08, 0.030, 0.10); playNote(587.33, 0.20, 0.035, 0.20); },
  ps2:        () => { playNote(196.00, 0.18, 0.045); playNote(293.66, 0.22, 0.030, 0.08); },
  ps1:        () => { playNote(174.61, 0.24, 0.045); playNote(220.00, 0.24, 0.030, 0.04); playNote(261.63, 0.24, 0.030, 0.08); },
  ps4:        () => { playNote(246.94, 0.08, 0.030); playNote(329.63, 0.08, 0.030, 0.08); playNote(493.88, 0.20, 0.035, 0.16); },
  xbox:       () => { playTone(329.63, 0.18, "sine", 0.035, 0.00); playTone(246.94, 0.24, "sine", 0.030, 0.12); },
  nes:        () => { playTone(659.25, 0.05, "square", 0.030, 0.00); playTone(523.25, 0.05, "square", 0.030, 0.06); playTone(659.25, 0.14, "square", 0.030, 0.12); },
  gb:         () => { playTone(587.33, 0.08, "square", 0.025, 0.00); playTone(880.00, 0.16, "square", 0.025, 0.10); },
  gbc:        () => { playTone(587.33, 0.07, "square", 0.025, 0.00); playTone(880.00, 0.08, "square", 0.025, 0.08); playTone(1108.73, 0.16, "square", 0.025, 0.18); },
  md:         () => { playTone(440.00, 0.10, "sawtooth", 0.030, 0.00); playTone(330.00, 0.18, "sawtooth", 0.030, 0.12); },
  dreamcast:  () => { playNote(523.25, 0.08, 0.030); playNote(659.25, 0.08, 0.030, 0.08); playNote(739.99, 0.08, 0.030, 0.16); playNote(987.77, 0.20, 0.035, 0.24); },
  psp:        () => { playNote(392.00, 0.08, 0.030); playNote(523.25, 0.08, 0.030, 0.08); playNote(659.25, 0.20, 0.035, 0.16); },
  ds:         () => { playTone(880.00, 0.05, "triangle", 0.030, 0.00); playTone(1318.51, 0.05, "triangle", 0.030, 0.06); playTone(1760.00, 0.12, "triangle", 0.030, 0.12); },
  saturn:     () => { playNote(349.23, 0.10, 0.035); playNote(440.00, 0.10, 0.030, 0.10); playNote(523.25, 0.20, 0.035, 0.20); },
  sms:        () => { playTone(440.00, 0.08, "sawtooth", 0.030, 0.00); playTone(587.33, 0.16, "sawtooth", 0.030, 0.10); },
  gg:         () => { playTone(659.25, 0.07, "square", 0.025, 0.00); playTone(523.25, 0.08, "square", 0.025, 0.08); },
  segacd:     () => { playNote(349.23, 0.12, 0.035); playNote(523.25, 0.18, 0.035, 0.12); },
  arcade:     () => { playTone(1318.51, 0.04, "square", 0.030, 0.00); playTone(1760.00, 0.04, "square", 0.030, 0.04); playTone(2093.00, 0.10, "square", 0.030, 0.08); },
  tg16:       () => { playTone(523.25, 0.08, "square", 0.030, 0.00); playTone(659.25, 0.14, "square", 0.030, 0.10); },
  a2600:      () => { playTone(220.00, 0.16, "square", 0.035, 0.00); playTone(165.00, 0.16, "square", 0.035, 0.10); },
  lynx:       () => { playTone(659.25, 0.07, "triangle", 0.030, 0.00); playTone(523.25, 0.08, "triangle", 0.030, 0.08); },
  ws:         () => { playTone(440.00, 0.07, "square", 0.025, 0.00); playTone(587.33, 0.08, "square", 0.025, 0.08); },
  vb:         () => { playTone(523.25, 0.10, "sawtooth", 0.030, 0.00); playTone(392.00, 0.16, "sawtooth", 0.030, 0.10); },
  ngpc:       () => { playTone(659.25, 0.05, "triangle", 0.025, 0.00); playTone(880.00, 0.08, "triangle", 0.025, 0.06); },
  msx:        () => { playTone(523.25, 0.05, "square", 0.025, 0.00); playTone(659.25, 0.05, "square", 0.025, 0.06); playTone(783.99, 0.08, "square", 0.025, 0.12); },
  c64:        () => { playTone(261.63, 0.08, "sawtooth", 0.035, 0.00); playTone(196.00, 0.12, "sawtooth", 0.035, 0.10); },
  zx:         () => { playTone(880.00, 0.04, "square", 0.025, 0.00); playTone(1318.51, 0.05, "square", 0.025, 0.04); },
  amiga:      () => { playNote(440.00, 0.08, 0.030); playNote(659.25, 0.08, 0.030, 0.08); playNote(880.00, 0.16, 0.035, 0.16); },
  threedo:    () => { playNote(392.00, 0.10, 0.030); playNote(523.25, 0.10, 0.030, 0.10); playNote(659.25, 0.20, 0.035, 0.20); },
  jaguar:     () => { playTone(165.00, 0.18, "sawtooth", 0.040, 0.00); playTone(220.00, 0.18, "sawtooth", 0.030, 0.10); },
  xbox360:    () => { playTone(329.63, 0.16, "sine", 0.035, 0.00); playTone(246.94, 0.16, "sine", 0.030, 0.10); playTone(196.00, 0.22, "sine", 0.030, 0.18); },
  vita:       () => { playNote(329.63, 0.08, 0.030); playNote(440.00, 0.08, 0.030, 0.08); playNote(523.25, 0.08, 0.030, 0.16); playNote(659.25, 0.18, 0.035, 0.24); },
};

export function playPlatformJingle(systemId) {
  const fn = PLATFORM_JINGLES[systemId];
  if (fn) fn();
  else sfx.switchSys();
}

/** Vibracao haptica curta (Android) — feedback fisico no toque. */
export function haptic(ms = 12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}
