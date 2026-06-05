// Musica ambiente compartilhada: playlist MP3 com shuffle + crossfade.
// v0.9.9: extraido de LudexLauncher pra ser usado IGUAL no app mobile e no
// launcher do PC (Paulo: "música de fundo do app = mesma do launcher Windows").
// Le os MP3s via list_music_tracks (Rust resolve a pasta: /storage/emulated/0/
// Ludex/music no Android, <install>/music no desktop).

import { invoke, convertFileSrc } from "@tauri-apps/api/core";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const ambientMusic = {
  audio: null,            // HTMLAudioElement atual
  audioListeners: null,   // { onEnded, onError } pra removeEventListener depois
  playlist: [],           // array de file paths
  queue: [],              // ordem shufflada atual
  current: 0,
  targetVolume: 0.3,
  fadeInterval: null,
  fadeOutInterval: null,  // fade-out tem interval separado pra não colidir com fade-in
  // Generation counter pra invalidar callbacks pendentes. Cada start()/stop()
  // incrementa. Listeners (ended/error) so disparam _next() se sua geracao ainda
  // for a atual. Resolve race quando user desativa música e o ended listener
  // dispara depois — bug que fazia música nova tocar sozinha após desativar.
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
    // antigo COMPLETAMENTE antes do novo. Evita 2 músicas tocando ao mesmo tempo.
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

  // Para a música. Sempre incrementa generation (invalida listeners pendentes),
  // remove os listeners do audio atual e pausa. immediate=false faz fade-out
  // cosmetico de 400ms (o audio ja foi desligado, ended/error não disparam nada).
  stop(opts = {}) {
    const immediate = !!opts.immediate;
    this.generation++;
    if (this.fadeInterval) { clearInterval(this.fadeInterval); this.fadeInterval = null; }
    if (this.fadeOutInterval) { clearInterval(this.fadeOutInterval); this.fadeOutInterval = null; }
    if (!this.audio) return;
    const a = this.audio;
    const ls = this.audioListeners;
    this.audio = null;
    this.audioListeners = null;
    if (ls) {
      try { a.removeEventListener("ended", ls.onEnded); } catch {}
      try { a.removeEventListener("error", ls.onError); } catch {}
    }
    if (immediate) {
      try { a.pause(); a.volume = 0; a.src = ""; a.load(); } catch {}
      return;
    }
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
    this.stop({ immediate: true });
    if (!this.playlist.length) return;
    this._next();
  },

  get isPlaying() { return !!this.audio; },
};
