// v0.8.51: helpers compartilhados entre LudexLauncher e LudexEmulatorView.
// Antes viviam dentro de LudexLauncher.jsx mas o EmulatorView extraido tb precisa.

import { invoke } from "@tauri-apps/api/core";

/**
 * Wrapper invoke com timeout — protege UI de invokes Rust que travam
 * (rede lenta, backend hang, etc). Default 30s. Rejeita com erro claro.
 */
export function invokeTimeout(cmd, args, ms = 30000) {
  return Promise.race([
    invoke(cmd, args),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`Timeout: ${cmd} demorou mais de ${ms}ms`)),
      ms,
    )),
  ]);
}

/**
 * Validacao de extensao ROM antes de mandar pro backend libretro.
 * Defesa em profundidade — backend pode ter bug que aceita path estranho.
 */
export const ALLOWED_ROM_EXTS = new Set([
  // Imagens de disco / cartucho
  "iso","cue","bin","chd","mdf","mds","img","ccd","sub","m3u","gdi","cdi",
  // Cartuchos
  "sfc","smc","nes","fds","gba","gb","gbc","gen","md","smd","32x","sms","gg",
  "n64","z64","v64","rom","ngp","ngc","ws","wsc","vb","lnx",
  // PSP / DS / 3DS
  "pbp","cso","nds","ids","3ds","cci","cxi","3dsx","app","elf","axf","cia",
  // Multi-platform
  "zip","7z","rar","sg","col","msx","msx2","cas","dsk","fdi","adf","ipf","tap",
  "z80","sna","tzx","trd","scl","mx1","mx2","ri",
  // 3DO/Jaguar/Lynx
  "j64","cof",
]);

export function validRomExtension(romPath) {
  if (!romPath || typeof romPath !== "string") return false;
  const dot = romPath.lastIndexOf(".");
  if (dot < 0 || dot === romPath.length - 1) return false;
  return ALLOWED_ROM_EXTS.has(romPath.slice(dot + 1).toLowerCase());
}

/** Formata segundos -> "Xh Ymin" / "Xmin" / "Xs" */
export function formatPlayTime(seconds) {
  if (!seconds || seconds < 60) return `${Math.floor(seconds || 0)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

/** Status do jogo na biblioteca pessoal — usado em GameDetailPanel e cards. */
export const GAME_STATUS_LABELS = {
  "": "Sem status",
  "wishlist": "Quero jogar",
  "playing": "Jogando",
  "beat": "Zerei",
  "mastered": "Platinei",
  "abandoned": "Abandonei",
};
export const GAME_STATUS_ORDER = ["", "wishlist", "playing", "beat", "mastered", "abandoned"];
export const GAME_STATUS_EMOJI = {
  "": "○",
  "wishlist": "★",
  "playing": "▶",
  "beat": "✔",
  "mastered": "✦",
  "abandoned": "✕",
};
