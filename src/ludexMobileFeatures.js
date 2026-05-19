/**
 * ludexMobileFeatures.js — engine de features locais autenticas:
 * - Recents (continue onde parou)
 * - Achievements internos (Ludex Originals)
 * - Stats por jogo (play time, sessions)
 * - Child mode (PIN + filtro keywords)
 * - Backup/restore config JSON
 * - Save state thumbnails
 *
 * Tudo via localStorage, sem servidor, sem terceiros.
 */

const KEYS = {
  recents:     "ludex.recents.v1",
  achievements:"ludex.achievements.v1",
  stats:       "ludex.stats.v1",
  childPin:    "ludex.childPin.v1",
  thumbs:      "ludex.thumbs.v1",
  customCovers:"ludex.customCovers.v1",
  cheats:      "ludex.cheats.v1",
  screenshots: "ludex.screenshots.v1",
  firstRun:    "ludex.firstRun.v1",
  ambientMusic:"ludex.ambient.v1",
};

// ============ RECENTS ============
export function loadRecents() {
  try { return JSON.parse(localStorage.getItem(KEYS.recents) || "[]"); }
  catch { return []; }
}
export function pushRecent(entry) {
  try {
    const list = loadRecents().filter(r => r.gamePath !== entry.gamePath);
    list.unshift({ ...entry, timestamp: Date.now() });
    const trimmed = list.slice(0, 12);
    localStorage.setItem(KEYS.recents, JSON.stringify(trimmed));
    return trimmed;
  } catch { return []; }
}
export function clearRecents() {
  try { localStorage.removeItem(KEYS.recents); } catch {}
}

// ============ STATS POR JOGO ============
export function loadStats() {
  try { return JSON.parse(localStorage.getItem(KEYS.stats) || "{}"); }
  catch { return {}; }
}
export function trackSession(gamePath, durationSec) {
  try {
    const stats = loadStats();
    const cur = stats[gamePath] || { totalSec: 0, sessions: 0, lastSession: 0 };
    cur.totalSec += durationSec;
    cur.sessions += 1;
    cur.lastSession = Date.now();
    stats[gamePath] = cur;
    localStorage.setItem(KEYS.stats, JSON.stringify(stats));
    return cur;
  } catch { return null; }
}
export function statsFor(gamePath) {
  const stats = loadStats();
  return stats[gamePath] || { totalSec: 0, sessions: 0, lastSession: 0 };
}
export function totalPlayTime() {
  const stats = loadStats();
  return Object.values(stats).reduce((acc, s) => acc + (s.totalSec || 0), 0);
}

// ============ ACHIEVEMENTS INTERNOS ============
// IDs simples + icon SVG path d (so 1 path por achievement, sem deps)
// v0.9.0: catalogo expandido de 10 -> 25 cobrindo milestones de tempo, ROMs,
// sistemas, sessoes longas, perfil power-user e ate dawn-player.
export const ACHIEVEMENTS = [
  // Onboarding / primeiros passos
  { id: "first_rom",       name: "Primeira ROM",          desc: "Carregou seu primeiro jogo no Ludex",                     icon: "M5 13l4 4L19 7" },
  { id: "mobile_pioneer",  name: "Pioneiro Mobile",       desc: "Abriu o app mobile do Ludex",                             icon: "M5 4a2 2 0 012-2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2zM12 18h.01" },
  { id: "all_categories",  name: "Pesquisador",           desc: "Abriu todas as abas (Inicio/Sistemas/Buscar/Ajustes)",    icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  { id: "first_save",      name: "Primeira save state",   desc: "Salvou progresso pela primeira vez",                      icon: "M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8" },
  // Variedade
  { id: "five_systems",    name: "Colecionador",          desc: "Jogou em 5 sistemas diferentes",                          icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" },
  { id: "ten_systems",     name: "Enciclopedista",        desc: "Jogou em 10 sistemas diferentes",                         icon: "M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" },
  { id: "ten_games",       name: "Variedade",             desc: "Jogou em 10 jogos diferentes",                            icon: "M6 4h12l-1 4H7zM5 8h14l1 12H4zM10 12h4M10 16h4" },
  { id: "fifty_games",     name: "Acervo",                desc: "Jogou em 50 jogos diferentes",                            icon: "M4 4h16v16H4zM4 9h16M9 4v16" },
  // Tempo total
  { id: "first_hour",      name: "Imersao",               desc: "Total de 1 hora de jogo",                                 icon: "M12 8v4l3 2M12 22a10 10 0 100-20 10 10 0 000 20z" },
  { id: "ten_hours",       name: "Dedicacao",             desc: "Total de 10 horas de jogo",                               icon: "M12 8v4l3 2M12 22a10 10 0 100-20 10 10 0 000 20z" },
  { id: "hundred_hours",   name: "Obsessao",              desc: "Total de 100 horas de jogo",                              icon: "M12 6v6l4 2M12 22A10 10 0 1112 2a10 10 0 010 20z" },
  // Sessoes
  { id: "marathon",        name: "Maratonista",           desc: "Sessao unica de 2+ horas",                                icon: "M13 2L3 14h9l-1 8 10-12h-9z" },
  { id: "epic_marathon",   name: "Resistencia Epica",     desc: "Sessao unica de 5+ horas",                                icon: "M13 2L3 14h9l-1 8 10-12h-9zM18 6l3 3" },
  // Horarios
  { id: "midnight_player", name: "Coruja",                desc: "Jogou depois das 23h",                                    icon: "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" },
  { id: "dawn_player",     name: "Madrugador",            desc: "Jogou entre 4h e 7h da manha",                            icon: "M12 2v2M4.93 4.93l1.41 1.41M2 12h2M20 12h2M17.66 6.34l1.41-1.41M12 6a6 6 0 010 12 6 6 0 010-12z" },
  { id: "weekend_warrior", name: "Guerreiro Fim-de-Semana", desc: "Jogou sabado ou domingo",                              icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" },
  // Sistemas especificos
  { id: "played_gba",      name: "Pocket Hero",           desc: "Jogou um GBA",                                            icon: "M9 2h6a2 2 0 012 2v16a2 2 0 01-2 2H9a2 2 0 01-2-2V4a2 2 0 012-2z" },
  { id: "played_nes",      name: "Bit Veterano",          desc: "Jogou um NES",                                            icon: "M6 6h12v12H6zM6 12h12" },
  { id: "played_snes",     name: "16-bit Master",         desc: "Jogou um SNES",                                           icon: "M4 8h16v8H4zM10 12h4" },
  { id: "played_md",       name: "Blast Processing",      desc: "Jogou um Mega Drive",                                     icon: "M4 8h16v8H4zM4 12h16" },
  { id: "played_ps1",      name: "Disc Spinner",          desc: "Jogou um PS1",                                            icon: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 8a4 4 0 100 8 4 4 0 000-8z" },
  // Personalizacao
  { id: "custom_cover",    name: "Designer",              desc: "Adicionou uma capa customizada",                          icon: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" },
  { id: "backup_made",     name: "Precavido",             desc: "Exportou backup do seu progresso",                        icon: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" },
  // Hidden / power-user
  { id: "speed_swap",      name: "Velocista",             desc: "Trocou de jogo 5x em menos de 1 minuto",                  icon: "M13 2L3 14h9l-1 8 10-12h-9z" },
  { id: "favorited_ten",   name: "Curador Pessoal",       desc: "Favoritou 10 jogos",                                      icon: "M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7l3-7z" },
];

export function loadAchievements() {
  try { return JSON.parse(localStorage.getItem(KEYS.achievements) || "[]"); }
  catch { return []; }
}
export function unlockAchievement(id, onUnlocked) {
  try {
    const unlocked = loadAchievements();
    if (unlocked.includes(id)) return false;
    unlocked.push(id);
    localStorage.setItem(KEYS.achievements, JSON.stringify(unlocked));
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    if (ach && onUnlocked) onUnlocked(ach);
    return true;
  } catch { return false; }
}
export function isAchievementUnlocked(id) {
  return loadAchievements().includes(id);
}

// Engine: checa achievements baseado em events do app
export function checkAchievements(onUnlocked) {
  // first_rom / ten_games / fifty_games: contador de jogos distintos com stats
  const stats = loadStats();
  const totalGames = Object.keys(stats).length;
  if (totalGames >= 1) unlockAchievement("first_rom", onUnlocked);
  if (totalGames >= 10) unlockAchievement("ten_games", onUnlocked);
  if (totalGames >= 50) unlockAchievement("fifty_games", onUnlocked);

  // Sistemas distintos (via recents.systemId)
  const recents = loadRecents();
  const sysSet = new Set(recents.map(r => r.systemId).filter(Boolean));
  if (sysSet.size >= 5) unlockAchievement("five_systems", onUnlocked);
  if (sysSet.size >= 10) unlockAchievement("ten_systems", onUnlocked);

  // Sistemas especificos
  if (sysSet.has("gba"))   unlockAchievement("played_gba", onUnlocked);
  if (sysSet.has("nes"))   unlockAchievement("played_nes", onUnlocked);
  if (sysSet.has("snes"))  unlockAchievement("played_snes", onUnlocked);
  if (sysSet.has("md") || sysSet.has("megadrive")) unlockAchievement("played_md", onUnlocked);
  if (sysSet.has("ps1"))   unlockAchievement("played_ps1", onUnlocked);

  // play time milestones
  const totalSec = totalPlayTime();
  if (totalSec >= 3600)   unlockAchievement("first_hour", onUnlocked);
  if (totalSec >= 36000)  unlockAchievement("ten_hours", onUnlocked);
  if (totalSec >= 360000) unlockAchievement("hundred_hours", onUnlocked);

  // marathon: alguma session > 2h / epic > 5h
  for (const s of Object.values(stats)) {
    if (s.totalSec > 7200  && s.sessions <= 5) unlockAchievement("marathon", onUnlocked);
    if (s.totalSec > 18000 && s.sessions <= 6) unlockAchievement("epic_marathon", onUnlocked);
  }

  // Horarios
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=domingo, 6=sabado
  if (hour >= 23 || hour < 4) unlockAchievement("midnight_player", onUnlocked);
  if (hour >= 4 && hour < 7)  unlockAchievement("dawn_player", onUnlocked);
  if (day === 0 || day === 6) unlockAchievement("weekend_warrior", onUnlocked);

  // Favoritos
  try {
    const favs = JSON.parse(localStorage.getItem("ludex.favorites.v1") || "[]");
    if (Array.isArray(favs) && favs.length >= 10) unlockAchievement("favorited_ten", onUnlocked);
  } catch {}

  // mobile_pioneer: sempre desbloqueia ao abrir app mobile
  unlockAchievement("mobile_pioneer", onUnlocked);
}

// Disparado quando user exporta backup (settings tab)
export function notifyBackupMade(onUnlocked) {
  unlockAchievement("backup_made", onUnlocked);
}

// Disparado quando user adiciona capa custom
export function notifyCustomCover(onUnlocked) {
  unlockAchievement("custom_cover", onUnlocked);
}

// Rastreia speed_swap (5 trocas em <60s)
let _swapTimes = [];
export function trackGameSwap(onUnlocked) {
  const now = Date.now();
  _swapTimes.push(now);
  // Mantem so dos ultimos 60s
  _swapTimes = _swapTimes.filter(t => now - t <= 60000);
  if (_swapTimes.length >= 5) {
    unlockAchievement("speed_swap", onUnlocked);
    _swapTimes = [];
  }
}

export function markTabVisited(tabId) {
  try {
    const k = "ludex.tabsVisited.v1";
    const set = new Set(JSON.parse(localStorage.getItem(k) || "[]"));
    set.add(tabId);
    localStorage.setItem(k, JSON.stringify([...set]));
    if (set.size >= 4) return true; // all categories
  } catch {}
  return false;
}

// ============ CHILD MODE ============
const BLOCKED_KEYWORDS = [
  "gta", "grand theft", "manhunt", "saw ", "mortal kombat", "doom",
  "resident evil", "silent hill", "postal", "carmageddon", "soldier of fortune",
  "f.e.a.r", "condemned", "outlast", "left 4 dead", "dead island",
  "dead rising", "duke nukem", "wolfenstein", "blood ", "hatred",
];

export function isChildModeOn() {
  try { return localStorage.getItem("ludex.childMode") === "1"; }
  catch { return false; }
}
export function setChildMode(on, pin) {
  try {
    localStorage.setItem("ludex.childMode", on ? "1" : "0");
    if (pin) localStorage.setItem(KEYS.childPin, pin);
  } catch {}
}
export function verifyChildPin(pin) {
  try { return localStorage.getItem(KEYS.childPin) === pin; }
  catch { return false; }
}
export function filterChildSafe(games) {
  if (!isChildModeOn()) return games;
  return games.filter(g => {
    const name = (g.name || "").toLowerCase();
    return !BLOCKED_KEYWORDS.some(k => name.includes(k));
  });
}

// ============ BACKUP / RESTORE ============
export function exportConfig() {
  const data = {
    version: "v1",
    exported: new Date().toISOString(),
    recents: loadRecents(),
    achievements: loadAchievements(),
    stats: loadStats(),
    cheats: loadCheats(),
    customCovers: loadCustomCovers(),
    childMode: isChildModeOn(),
  };
  return JSON.stringify(data, null, 2);
}
export function importConfig(json) {
  try {
    const data = JSON.parse(json);
    if (data.version !== "v1") throw new Error("Versao incompativel");
    if (data.recents) localStorage.setItem(KEYS.recents, JSON.stringify(data.recents));
    if (data.achievements) localStorage.setItem(KEYS.achievements, JSON.stringify(data.achievements));
    if (data.stats) localStorage.setItem(KEYS.stats, JSON.stringify(data.stats));
    if (data.cheats) localStorage.setItem(KEYS.cheats, JSON.stringify(data.cheats));
    if (data.customCovers) localStorage.setItem(KEYS.customCovers, JSON.stringify(data.customCovers));
    return true;
  } catch { return false; }
}

// ============ SAVE STATE THUMBNAILS ============
export function saveThumbnail(systemId, slot, dataUrl) {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS.thumbs) || "{}");
    all[`${systemId}.${slot}`] = dataUrl;
    localStorage.setItem(KEYS.thumbs, JSON.stringify(all));
  } catch {}
}
export function loadThumbnail(systemId, slot) {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS.thumbs) || "{}");
    return all[`${systemId}.${slot}`] || null;
  } catch { return null; }
}

// ============ CUSTOM COVERS (user upload via galeria) ============
export function loadCustomCovers() {
  try { return JSON.parse(localStorage.getItem(KEYS.customCovers) || "{}"); }
  catch { return {}; }
}
export function setCustomCover(gamePath, dataUrl) {
  try {
    const all = loadCustomCovers();
    all[gamePath] = dataUrl;
    localStorage.setItem(KEYS.customCovers, JSON.stringify(all));
  } catch {}
}

// ============ CHEATS POR JOGO ============
export function loadCheats() {
  try { return JSON.parse(localStorage.getItem(KEYS.cheats) || "{}"); }
  catch { return {}; }
}
export function setCheats(gamePath, codes) {
  try {
    const all = loadCheats();
    all[gamePath] = codes;
    localStorage.setItem(KEYS.cheats, JSON.stringify(all));
  } catch {}
}

// ============ SCREENSHOTS (capturas do canvas) ============
export function loadScreenshots() {
  try { return JSON.parse(localStorage.getItem(KEYS.screenshots) || "[]"); }
  catch { return []; }
}
export function addScreenshot(systemId, gameName, dataUrl) {
  try {
    const list = loadScreenshots();
    list.unshift({ systemId, gameName, dataUrl, timestamp: Date.now() });
    const trimmed = list.slice(0, 30);
    localStorage.setItem(KEYS.screenshots, JSON.stringify(trimmed));
    return trimmed;
  } catch { return []; }
}

// ============ FIRST RUN TUTORIAL ============
export function isFirstRunDone() {
  try { return localStorage.getItem(KEYS.firstRun) === "1"; }
  catch { return true; }
}
export function markFirstRunDone() {
  try { localStorage.setItem(KEYS.firstRun, "1"); } catch {}
}

// ============ MUSICA CHIPTUNE AMBIENTE (opcional, gerada via Web Audio) ============
let _ambientCtx = null;
let _ambientNodes = [];
export function isAmbientOn() {
  try { return localStorage.getItem(KEYS.ambientMusic) === "1"; }
  catch { return false; }
}
export function setAmbientOn(on) {
  try { localStorage.setItem(KEYS.ambientMusic, on ? "1" : "0"); } catch {}
  if (on) startAmbient(); else stopAmbient();
}
export function startAmbient() {
  if (_ambientCtx) return;
  try {
    _ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Loop simples C-E-G-C arpejo lento 4s
    const notes = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63];
    let i = 0;
    const playOne = () => {
      if (!_ambientCtx) return;
      const osc = _ambientCtx.createOscillator();
      const g = _ambientCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = notes[i % notes.length];
      const t = _ambientCtx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.012, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 2.2);
      osc.connect(g); g.connect(_ambientCtx.destination);
      osc.start(t); osc.stop(t + 2.3);
      _ambientNodes.push(osc);
      i++;
    };
    playOne();
    const interval = setInterval(playOne, 2200);
    _ambientNodes.push({ disconnect: () => clearInterval(interval), _interval: interval });
  } catch {}
}
export function stopAmbient() {
  _ambientNodes.forEach(n => {
    try { if (n._interval) clearInterval(n._interval); else n.stop?.(); } catch {}
  });
  _ambientNodes = [];
  try { _ambientCtx?.close(); } catch {}
  _ambientCtx = null;
}

// ============ FORMATTERS ============
export function formatPlayTime(seconds) {
  if (!seconds || seconds < 60) return `${Math.floor(seconds || 0)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}min`;
}
export function formatRelative(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atras`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atras`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d atras`;
  return new Date(timestamp).toLocaleDateString("pt-BR");
}
