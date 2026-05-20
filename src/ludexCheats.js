// v0.9.2: Cheats. Aplica via libretro (retro_cheat_set) e busca aberta no
// libretro-database (GitHub) por sistema+jogo. Codigos manuais sempre funcionam;
// busca online so pros sistemas com pasta no DB (mapa abaixo).
//
// Persistencia: localStorage 'ludex.cheats.<gameKey>' = [{desc, code, enabled}]

import { invoke } from "@tauri-apps/api/core";

// system.id -> nome da pasta em libretro-database/cht/.
// HD systems (ps2, gc, wii, 3ds, switch...) nao tem .cht no DB (usam pnach/gct),
// entao ficam de fora -> UI cai pra cheats manuais.
export const CHEAT_DB_FOLDER = {
  nes: "Nintendo - Nintendo Entertainment System",
  snes: "Nintendo - Super Nintendo Entertainment System",
  gb: "Nintendo - Game Boy",
  gbc: "Nintendo - Game Boy Color",
  gba: "Nintendo - Game Boy Advance",
  n64: "Nintendo - Nintendo 64",
  ds: "Nintendo - Nintendo DS (Decrypted)",
  vb: "Nintendo - Virtual Boy",
  md: "Sega - Mega Drive - Genesis",
  sms: "Sega - Master System - Mark III",
  gg: "Sega - Game Gear",
  segacd: "Sega - Mega-CD - Sega CD",
  saturn: "Sega - Saturn",
  dreamcast: "Sega - Dreamcast",
  ps1: "Sony - PlayStation",
  psp: "Sony - PlayStation Portable",
  pce: "NEC - PC Engine - TurboGrafx 16",
  ws: "Bandai - WonderSwan",
  wsc: "Bandai - WonderSwan Color",
  ngp: "SNK - Neo Geo Pocket",
  ngc: "SNK - Neo Geo Pocket Color",
};

export function cheatDbFolder(systemId) {
  return CHEAT_DB_FOLDER[systemId] || null;
}

export function supportsOnlineCheats(systemId) {
  return !!CHEAT_DB_FOLDER[systemId];
}

function gameKey(systemId, gamePath) {
  const base = String(gamePath || "").split(/[\\/]/).pop() || gamePath;
  return `ludex.cheats.${systemId}.${base}`;
}

export function loadCheats(systemId, gamePath) {
  try {
    const raw = localStorage.getItem(gameKey(systemId, gamePath));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveCheats(systemId, gamePath, cheats) {
  try { localStorage.setItem(gameKey(systemId, gamePath), JSON.stringify(cheats)); } catch {}
}

// Limpa o nome do arquivo pra busca (tira extensao + tags entre () e [])
export function cleanGameName(gamePath) {
  let n = String(gamePath || "").split(/[\\/]/).pop() || "";
  n = n.replace(/\.[^.]+$/, "");        // tira extensao
  n = n.replace(/[([].*?[)\]]/g, "");   // tira (USA), [!], etc
  return n.trim();
}

// Busca online via Rust (evita CORS + parseia .cht). Retorna [{desc, code}].
export async function fetchOnlineCheats(systemId, gamePath) {
  const folder = cheatDbFolder(systemId);
  if (!folder) throw new Error("Sistema sem base de cheats online — adicione manualmente.");
  const name = cleanGameName(gamePath);
  return await invoke("fetch_cheats", { dbFolder: folder, gameName: name });
}

// Aplica os cheats habilitados no core rodando. Retorna qtd aplicada.
export async function applyCheats(cheats) {
  const payload = (cheats || []).map((c) => ({ code: c.code, enabled: !!c.enabled }));
  return await invoke("libretro_apply_cheats", { cheats: payload });
}
