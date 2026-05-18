/**
 * LudexMobile.jsx -- App SEPARADO pra Android (smartphone)
 *
 * Design mobile-first: bottom nav, carrosseis horizontais, hero,
 * detail full-screen. NAO compartilha JSX com LudexLauncher (desktop)
 * -- so reusa os tauri commands do backend.
 *
 * 4 telas principais:
 *  - Home: biblioteca recente + carrossel por sistema (top 5 sistemas)
 *  - Sistemas: lista vertical agrupada por categoria
 *  - Buscar: search + resultados
 *  - Settings: perfil, demo, sobre
 *
 * + GameDetail full-screen modal quando clica num jogo.
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { sfx, playPlatformJingle, unlockAudio, haptic, setMuted as setSfxMuted, isMutedNow } from "./ludexMobileAudio";
import {
  loadRecents, pushRecent, trackSession, statsFor, totalPlayTime,
  ACHIEVEMENTS, loadAchievements, checkAchievements, markTabVisited, unlockAchievement,
  isChildModeOn, setChildMode as setChildModeStore, verifyChildPin, filterChildSafe,
  exportConfig, importConfig,
  saveThumbnail, loadThumbnail,
  loadCustomCovers, setCustomCover,
  loadCheats, setCheats as setCheatsStore,
  addScreenshot, loadScreenshots,
  isFirstRunDone, markFirstRunDone,
  isAmbientOn, setAmbientOn,
  formatPlayTime, formatRelative,
} from "./ludexMobileFeatures";

// ============================================================
// === ICONES SVG (sem emojis, regra Paulo) ===================
// ============================================================
const IconHome = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 9.5L12 3l9 6.5V20a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2V9.5z" /></svg>);
const IconGrid = () => (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>);
const IconSearch = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>);
const IconSettings = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>);
const IconArrowLeft = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>);
const IconPlay = () => (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="6 4 20 12 6 20 6 4" /></svg>);
const IconStar = ({ filled }) => (<svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" /></svg>);
const IconClose = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>);
const IconClock = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>);

// ============================================================
// === ICONES DE SISTEMAS (compactos pra mobile) ==============
// ============================================================
function SysGlyph({ id }) {
  const f = "currentColor";
  switch (id) {
    case "switch":    return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="3" y="3" width="7" height="18" rx="3" /><rect x="14" y="3" width="7" height="18" rx="3" /></svg>);
    case "wiiu":      return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="2" y="6" width="20" height="12" rx="2" /></svg>);
    case "3ds":       return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="5" y="3" width="14" height="8" rx="1" /><rect x="5" y="13" width="14" height="8" rx="1" /></svg>);
    case "wii":       return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="9" y="3" width="6" height="18" rx="1" /></svg>);
    case "gc":        return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><polygon points="12 2 22 8 22 16 12 22 2 16 2 8" /></svg>);
    case "n64":       return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><path d="M12 3l5 5h-3v8h3l-5 5-5-5h3V8H7l5-5z" /></svg>);
    case "ds":        return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="4" y="3" width="16" height="8" rx="1" /><rect x="4" y="13" width="16" height="8" rx="1" /></svg>);
    case "gba":       return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="2" y="7" width="20" height="10" rx="2" /></svg>);
    case "gb":
    case "gbc":       return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="6" y="2" width="12" height="20" rx="2" /></svg>);
    case "snes":
    case "nes":       return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="2" y="8" width="20" height="8" rx="1.5" /></svg>);
    case "vb":        return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><circle cx="8" cy="12" r="4" /><circle cx="16" cy="12" r="4" /></svg>);
    case "ps1":
    case "ps2":
    case "ps3":
    case "ps4":       return (<svg viewBox="0 0 24 24" aria-hidden><text x="12" y="17" textAnchor="middle" fill={f} fontSize="11" fontWeight="900" fontStyle="italic" fontFamily="Impact, sans-serif">PS</text></svg>);
    case "psp":
    case "vita":      return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="2" y="6" width="20" height="12" rx="2" /></svg>);
    case "dreamcast": return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><circle cx="12" cy="12" r="9" /></svg>);
    case "saturn":    return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><circle cx="12" cy="12" r="6" /><ellipse cx="12" cy="12" rx="11" ry="3" fill="none" stroke={f} strokeWidth="1.5" /></svg>);
    case "md":
    case "sms":
    case "gg":
    case "segacd":    return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="2" y="8" width="20" height="8" rx="1" /></svg>);
    case "xbox":
    case "xbox360":   return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><circle cx="12" cy="12" r="10" /></svg>);
    case "arcade":    return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="7" y="14" width="10" height="3" rx="1" /><circle cx="12" cy="7" r="3" /><line x1="12" y1="10" x2="12" y2="14" stroke={f} strokeWidth="2" /></svg>);
    case "tg16":      return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="3" y="9" width="18" height="6" rx="1" /></svg>);
    case "a2600":     return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="3" y="6" width="18" height="12" rx="1" /></svg>);
    case "lynx":
    case "ws":
    case "ngpc":      return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="3" y="6" width="18" height="12" rx="3" /></svg>);
    case "msx":
    case "c64":
    case "zx":
    case "amiga":     return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><rect x="2" y="9" width="20" height="6" rx="1" /><rect x="6" y="15" width="12" height="2" /></svg>);
    case "threedo":   return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><circle cx="12" cy="12" r="10" /></svg>);
    case "jaguar":    return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><polygon points="12 3 21 9 21 15 12 21 3 15 3 9" /></svg>);
    default:          return (<svg viewBox="0 0 24 24" fill={f} aria-hidden><circle cx="12" cy="12" r="9" /></svg>);
  }
}

// ============================================================
// === SISTEMAS SUPORTADOS NO ANDROID =========================
// Whitelist dos sistemas com core libretro .so ARM disponivel
// (autenticos Ludex embedded). Todos os outros (Switch/PS3/Xbox/etc)
// nao funcionam em Android e SAO OCULTOS na UI mobile.
// ============================================================
const ANDROID_SUPPORTED = new Set([
  // Nintendo (embedded via libretro ARM)
  "snes", "nes", "gb", "gbc", "n64", "gba", "ds", "wii", "gc", "vb",
  // Sony — so PS1 e PSP tem core libretro ARM. PS2/PS3/PS4/Vita: nao suportado.
  "ps1", "psp",
  // Sega
  "dreamcast", "saturn", "md", "sms", "gg", "segacd",
  // Atari
  "a2600", "lynx", "jaguar",
  // Arcade (MAME via mame2003_plus ARM)
  "arcade",
  // Handhelds (Bandai/SNK)
  "ws", "ngpc",
  // Outros (NEC/3DO/computer retro)
  "tg16", "threedo", "msx", "c64", "zx", "amiga",
  // EXCLUIDOS (sem core ARM): switch, wiiu, 3ds, ps2, ps3, ps4,
  // xbox, xbox360, vita, retro (RetroArch generico desnecessario)
]);

// ============================================================
// === CATEGORIAS (filtradas pra mostrar so sistemas Android) ==
// ============================================================
const CATEGORIES = [
  { id: "nintendo",  name: "Nintendo",   systems: ["wii","gc","n64","gba","ds","gb","gbc","snes","nes","vb"] },
  { id: "sony",      name: "Sony",       systems: ["ps1","psp"] },
  { id: "sega",      name: "Sega",       systems: ["dreamcast","saturn","md","sms","gg","segacd"] },
  { id: "atari",     name: "Atari",      systems: ["a2600","lynx","jaguar"] },
  { id: "arcade",    name: "Arcade",     systems: ["arcade"] },
  { id: "handheld",  name: "Portateis",  systems: ["ws","ngpc"] },
  { id: "outros",    name: "Outros",     systems: ["tg16","threedo","msx","c64","zx","amiga"] },
];

function categoryOfSystem(systemId) {
  for (const cat of CATEGORIES) {
    if (cat.systems.includes(systemId)) return cat;
  }
  return CATEGORIES[CATEGORIES.length - 1];
}

// ============================================================
// === COMPONENTE PRINCIPAL ===================================
// ============================================================
export default function LudexMobile() {
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({ profiles: [], active_profile_id: null });
  const [covers, setCovers] = useState({});
  const [activeTab, setActiveTab] = useState("home"); // home | systems | search | settings
  const [openSystem, setOpenSystem] = useState(null); // sistema selecionado (mostra grid)
  const [openGame, setOpenGame] = useState(null); // jogo selecionado (mostra detail)
  const [search, setSearch] = useState("");
  const [androidDemo, setAndroidDemo] = useState(null);
  const [launching, setLaunching] = useState(false);
  // v0.8.21: auto-update Android (banner obrigatorio quando ha versao nova)
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateState, setUpdateState] = useState({ stage: "idle", msg: "" }); // idle | downloading | installing | error
  // v0.8.22: achievement toast + telemetria local
  const [achievementToast, setAchievementToast] = useState(null);
  const [recents, setRecents] = useState(() => loadRecents()); // [{ systemId, systemName, systemColor, gameName, gamePath, timestamp, playTime }]
  const [childMode, setChildMode] = useState(() => {
    try { return localStorage.getItem("ludex.childMode") === "1"; } catch { return false; }
  });
  // Wallpaper dinamico baseado no ultimo jogo aberto
  const lastGameCover = recents[0] ? covers[recents[0].gamePath] : null;
  // v0.8.14: rastreia se app ja tem acesso a todos os arquivos (Android)
  const [hasFilesAccess, setHasFilesAccess] = useState(true);
  const requestFilesAccess = useCallback(async () => {
    try {
      await invoke("android_open_all_files_settings");
    } catch (e) { alert("Nao consegui abrir Configuracoes: " + e); }
  }, []);
  // Quando user volta de Settings, re-checa
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const has = await invoke("android_has_all_files_access");
        setHasFilesAccess(has);
      } catch {}
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const activeProfile = useMemo(
    () => config.profiles?.find((p) => p.id === config.active_profile_id) || null,
    [config]
  );

  // ============ STARTUP ============
  useEffect(() => {
    (async () => {
      try {
        const c = await invoke("load_config");
        if (c) setConfig(c);
        // Auto-cria profile se nao tem
        if (!c?.profiles?.length) {
          const id = `p${Math.random().toString(36).slice(2, 10)}`;
          setConfig((prev) => ({
            ...prev,
            profiles: [{ id, name: "Player", avatar_id: "controller", photo_path: null, created_at: Math.floor(Date.now() / 1000) }],
            active_profile_id: id,
            first_run_done: true,
          }));
          try { await invoke("complete_first_run"); } catch {}
        }
      } catch (e) { console.error("load_config", e); }

      try {
        const demo = await invoke("android_demo_status");
        setAndroidDemo(demo);
      } catch (e) { /* desktop ou erro -- ignora */ }

      // v0.8.14: checa permissao logo no startup (sem esperar scan retornar 0)
      try {
        const has = await invoke("android_has_all_files_access");
        setHasFilesAccess(has);
      } catch { setHasFilesAccess(true); /* desktop = sempre true */ }

      // v0.8.21: auto-check de update no startup (background, nao bloqueia UI)
      setTimeout(() => {
        invoke("check_update_info")
          .then((info) => { if (info?.available) setUpdateInfo(info); })
          .catch((e) => console.warn("update check", e));
      }, 1500);

      try {
        const sys = await invoke("scan_roms", { romsRoot: null });
        // Filtra: APK so mostra sistemas com core libretro ARM (autenticos embedded).
        // Switch/Wii U/PS3/Xbox/etc nao tem core ARM = nao funcionam em Android.
        // v0.8.22: child mode filtra ROMs adultas por keyword no nome
        const filtered = (sys || [])
          .filter((s) => ANDROID_SUPPORTED.has(s.id))
          .map(s => ({ ...s, games: filterChildSafe(s.games || []) }));
        setSystems(filtered);
      } catch (e) { console.error("scan_roms", e); }
      setLoading(false);
    })();
  }, []);

  // ============ AUDIO: unlock no primeiro toque (autoplay policy) ============
  useEffect(() => {
    const onFirstTouch = () => { unlockAudio(); };
    window.addEventListener("touchstart", onFirstTouch, { passive: true, once: true });
    window.addEventListener("click", onFirstTouch, { once: true });
    return () => {
      window.removeEventListener("touchstart", onFirstTouch);
      window.removeEventListener("click", onFirstTouch);
    };
  }, []);

  // Achievement unlock callback (toast)
  const onUnlockAch = useCallback((ach) => {
    setAchievementToast(ach);
    sfx.achievement(); haptic([20, 40, 20]);
    setTimeout(() => setAchievementToast(null), 4200);
  }, []);

  // Run achievement engine on mount + a cada mudanca em recents/stats
  useEffect(() => { checkAchievements(onUnlockAch); }, [onUnlockAch, recents]);

  // Helper sons + haptic juntos + tracking tabs (achievement all_categories)
  const changeTab = useCallback((newTab) => {
    if (newTab === activeTab) return;
    sfx.nav(); haptic(8);
    setActiveTab(newTab);
    if (markTabVisited(newTab)) {
      unlockAchievement("all_categories", onUnlockAch);
    }
  }, [activeTab, onUnlockAch]);

  // ============ FETCH COVERS PRO SISTEMA ABERTO ============
  useEffect(() => {
    if (!openSystem) return;
    let cancelled = false;
    const queue = [...openSystem.games].filter((g) => covers[g.path] === undefined);
    if (queue.length === 0) return;
    async function worker() {
      while (queue.length > 0 && !cancelled) {
        const game = queue.shift();
        if (!game) break;
        try {
          const localPath = await invoke("fetch_cover", { systemId: openSystem.id, gameName: game.name });
          if (cancelled) return;
          setCovers((prev) => ({ ...prev, [game.path]: localPath ? convertFileSrc(localPath) : null }));
        } catch {
          setCovers((prev) => ({ ...prev, [game.path]: null }));
        }
      }
    }
    Promise.all(Array.from({ length: 3 }, worker)).catch(() => {});
    return () => { cancelled = true; };
  }, [openSystem]);

  // ============ FETCH COVERS PRA HOME (top sistemas) ============
  useEffect(() => {
    if (!systems.length) return;
    const topSystems = systems.filter((s) => s.games.length > 0).slice(0, 5);
    let cancelled = false;
    const queue = [];
    for (const sys of topSystems) {
      for (const g of sys.games.slice(0, 6)) {
        if (covers[g.path] === undefined) queue.push({ sysId: sys.id, game: g });
      }
    }
    if (queue.length === 0) return;
    async function worker() {
      while (queue.length > 0 && !cancelled) {
        const { sysId, game } = queue.shift();
        if (!game) break;
        try {
          const localPath = await invoke("fetch_cover", { systemId: sysId, gameName: game.name });
          if (cancelled) return;
          setCovers((prev) => ({ ...prev, [game.path]: localPath ? convertFileSrc(localPath) : null }));
        } catch {
          setCovers((prev) => ({ ...prev, [game.path]: null }));
        }
      }
    }
    Promise.all(Array.from({ length: 2 }, worker)).catch(() => {});
    return () => { cancelled = true; };
  }, [systems]);

  // ============ LANCAR JOGO ============
  // Android: so libretro embedded. Sistemas sem core ARM nao aparecem na lista
  // (filtrados por ANDROID_SUPPORTED). PS2/PS3/PS4/Vita/Xbox/Switch: nao suportados.
  const [playingGame, setPlayingGame] = useState(null);
  const sessionStartRef = useRef(null);
  const launchGame = useCallback((system, game) => {
    if (!system.libretro_core) {
      alert(`Sistema "${system.name}" nao tem core libretro embedded pra Android.`);
      return;
    }
    playPlatformJingle(system.id);
    haptic(20);
    sessionStartRef.current = Date.now();
    pushRecent({
      systemId: system.id, systemName: system.name, systemColor: system.color,
      gameName: game.name, gamePath: game.path,
    });
    setRecents(loadRecents());
    setPlayingGame({ system, game });
  }, []);
  const closeEmulator = useCallback(() => {
    // Trackeia tempo de jogo + atualiza recents/achievements
    if (sessionStartRef.current && playingGame) {
      const dur = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      if (dur > 5) trackSession(playingGame.game.path, dur);
      sessionStartRef.current = null;
    }
    setRecents(loadRecents());
    checkAchievements(onUnlockAch);
    sfx.shutdown(); haptic(30);
    setPlayingGame(null);
  }, [playingGame, onUnlockAch]);

  // ============ PICKER DE PASTA ROMS ============
  // tauri-plugin-dialog NAO suporta directory picker em Android.
  // LudexMobile so roda em Android (App.jsx faz routing) -> sempre modal custom.
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const dbg = useCallback((msg) => {
    // v0.8.12 debug: WebView release nao loga console no logcat,
    // entao usa frontend_log (Tauri tauri_plugin_log -> LogDir).
    try { invoke("frontend_log", { level: "info", message: `[picker] ${msg}` }); } catch {}
    try { console.log(`[Ludex] ${msg}`); } catch {}
  }, []);

  const pickRomsFolder = useCallback(() => {
    dbg("pickRomsFolder() chamado");
    // Fecha overlays/sub-telas pra o modal ficar visivel
    // (modal e renderizado so na tela principal — early return de openSystem/openGame
    //  fazia o modal nao aparecer ate user voltar, causando o "trava o celular")
    setOpenSystem(null);
    setOpenGame(null);
    setPlayingGame(null);
    setFolderPickerOpen(true);
  }, [dbg]);

  const setRomsFolder = useCallback(async (path) => {
    dbg(`setRomsFolder path=${path}`);
    if (!path) {
      dbg("setRomsFolder: path vazio, ignorando");
      return;
    }
    sfx.confirm(); haptic(15);
    try {
      await invoke("set_paths_config", { emulatorsRoot: null, romsRoot: path });
      dbg("set_paths_config OK");
      const sys = await invoke("scan_roms", { romsRoot: path });
      dbg(`scan_roms retornou ${sys?.length || 0} sistemas`);
      const filtered = (sys || []).filter((s) => ANDROID_SUPPORTED.has(s.id));
      const totalGames = filtered.reduce((acc, s) => acc + (s.games?.length || 0), 0);
      dbg(`filtrado=${filtered.length} sistemas totalGames=${totalGames}`);
      setSystems(filtered);
      setFolderPickerOpen(false);
      try {
        const c = await invoke("load_config");
        if (c) setConfig(c);
      } catch {}
      if (totalGames === 0) {
        // Checa permissao de acesso a todos os arquivos
        let hasAccess = true;
        try { hasAccess = await invoke("android_has_all_files_access"); } catch {}
        if (!hasAccess) {
          const ok = window.confirm(
            "O Ludex precisa de permissao para acessar seus arquivos.\n\n" +
            "Vou abrir Configuracoes -- ative 'Permitir gerenciar todos os arquivos' e volte aqui.\n\n" +
            "Abrir agora?"
          );
          if (ok) {
            try { await invoke("android_open_all_files_settings"); } catch (err) {
              alert("Nao consegui abrir Configuracoes: " + err);
            }
          }
        } else {
          alert(
            "Nenhum jogo encontrado em:\n" + path + "\n\n" +
            "ROMs supported: .nes .smc .sfc .gba .gb .gbc .iso .bin .cue .z64 .n64 .md .smd .gen .sms .gg .pce .ws .ngc .lnx .a26 .j64 .zip .7z e outras."
          );
        }
      }
    } catch (e) {
      dbg(`setRomsFolder falhou: ${e}`);
      alert(`Falha: ${e}`);
    }
  }, [dbg]);

  // ============ UPDATE OBRIGATORIO (bloqueia tudo) ============
  // v0.8.21: nao deixa user usar app desatualizado em mobile
  if (updateInfo?.available) {
    return (
      <UpdateRequiredScreen
        info={updateInfo}
        state={updateState}
        onInstall={async () => {
          setUpdateState({ stage: "downloading", msg: "Baixando atualizacao..." });
          try {
            const path = await invoke("android_download_apk", { apkUrl: updateInfo.apk_url });
            setUpdateState({ stage: "installing", msg: "Abrindo instalador..." });
            const ok = await invoke("android_install_apk", { apkPath: path });
            if (!ok) setUpdateState({ stage: "error", msg: "Falha ao abrir instalador. Habilita 'Instalar de fontes desconhecidas' nas Configuracoes." });
          } catch (e) {
            setUpdateState({ stage: "error", msg: `Falha: ${e}` });
          }
        }}
      />
    );
  }

  // ============ DEMO EXPIRED (bloqueia) ============
  if (androidDemo?.expired && !androidDemo?.is_admin_unlocked) {
    return <DemoExpiredScreen demo={androidDemo} onUnlock={setAndroidDemo} />;
  }

  // ============ EMULADOR RODANDO (full screen libretro) ============
  if (playingGame) {
    return (
      <MobileEmulatorView
        system={playingGame.system}
        game={playingGame.game}
        onClose={closeEmulator}
      />
    );
  }

  // ============ GAME DETAIL (full screen modal) ============
  if (openGame) {
    return (
      <GameDetailScreen
        system={openGame.system}
        game={openGame.game}
        coverSrc={covers[openGame.game.path]}
        onClose={() => { sfx.back(); haptic(8); setOpenGame(null); }}
        onLaunch={() => { launchGame(openGame.system, openGame.game); setOpenGame(null); }}
      />
    );
  }

  // ============ SISTEMA ABERTO (grid de jogos do sistema) ============
  if (openSystem) {
    return (
      <SystemScreen
        system={openSystem}
        covers={covers}
        onBack={() => { sfx.back(); haptic(8); setOpenSystem(null); }}
        onPickGame={(game) => { sfx.open(); haptic(10); setOpenGame({ system: openSystem, game }); }}
        onPickFolder={pickRomsFolder}
      />
    );
  }

  // ============ APP NORMAL: tab bar + conteudo ============
  return (
    <div className="lmx" style={lastGameCover ? { backgroundImage: `linear-gradient(180deg, rgba(10,2,32,0.85) 0%, rgba(10,2,32,0.98) 70%), url(${lastGameCover})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {!loading && launching && (
        <div className="lmx-loading-overlay">
          <div className="lmx-spinner" />
          <div>Abrindo jogo...</div>
        </div>
      )}

      <main className="lmx-content">
        {activeTab === "home" && (
          <HomeTab
            systems={systems}
            covers={covers}
            activeProfile={activeProfile}
            androidDemo={androidDemo}
            loading={loading}
            recents={recents}
            onPickSystem={(sys) => { playPlatformJingle(sys.id); haptic(12); setOpenSystem(sys); }}
            onPickGame={(system, game) => { sfx.open(); haptic(10); setOpenGame({ system, game }); }}
            onResume={(rec) => {
              const sys = systems.find(s => s.id === rec.systemId);
              const game = sys?.games?.find(g => g.path === rec.gamePath);
              if (sys && game) launchGame(sys, game);
            }}
            onPickFolder={pickRomsFolder}
            hasFilesAccess={hasFilesAccess}
            onRequestAccess={requestFilesAccess}
          />
        )}
        {activeTab === "systems" && (
          <SystemsTab
            systems={systems}
            onPickSystem={(sys) => { playPlatformJingle(sys.id); haptic(12); setOpenSystem(sys); }}
          />
        )}
        {activeTab === "search" && (
          <SearchTab
            systems={systems}
            covers={covers}
            search={search}
            setSearch={setSearch}
            onPickGame={(system, game) => { sfx.open(); haptic(10); setOpenGame({ system, game }); }}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            activeProfile={activeProfile}
            androidDemo={androidDemo}
            onAdminUnlock={setAndroidDemo}
            onPickFolder={pickRomsFolder}
            currentRomsRoot={config?.roms_root}
          />
        )}
      </main>

      {/* Folder picker modal (Android nao tem SAF nativo no Tauri ainda) */}
      {folderPickerOpen && (
        <FolderPickerModal
          onClose={() => setFolderPickerOpen(false)}
          onPick={(path) => setRomsFolder(path)}
        />
      )}

      {/* Achievement toast global */}
      {achievementToast && (
        <div className="lmx-ach-toast">
          <div className="lmx-ach-toast-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={achievementToast.icon} />
            </svg>
          </div>
          <div className="lmx-ach-toast-body">
            <div className="lmx-ach-toast-label">Conquista desbloqueada</div>
            <div className="lmx-ach-toast-name">{achievementToast.name}</div>
            <div className="lmx-ach-toast-desc">{achievementToast.desc}</div>
          </div>
        </div>
      )}

      {/* Tutorial first run */}
      {!isFirstRunDone() && (
        <TutorialOverlay onDone={() => { markFirstRunDone(); setActiveTab((t) => t); /* force rerender */ }} />
      )}

      {/* Bottom tab bar (estilo iOS/Android nativo) */}
      <nav className="lmx-tabs">
        <TabBtn icon={<IconHome />} label="Inicio" active={activeTab === "home"} onClick={() => changeTab("home")} />
        <TabBtn icon={<IconGrid />} label="Sistemas" active={activeTab === "systems"} onClick={() => changeTab("systems")} />
        <TabBtn icon={<IconSearch />} label="Buscar" active={activeTab === "search"} onClick={() => changeTab("search")} />
        <TabBtn icon={<IconSettings />} label="Ajustes" active={activeTab === "settings"} onClick={() => changeTab("settings")} />
      </nav>
    </div>
  );
}

// ============================================================
// === TAB BUTTON =============================================
// ============================================================
function TabBtn({ icon, label, active, onClick }) {
  return (
    <button className={`lmx-tab ${active ? "active" : ""}`} onClick={onClick}>
      <span className="lmx-tab-icon">{icon}</span>
      <span className="lmx-tab-label">{label}</span>
    </button>
  );
}

// ============================================================
// === HOME TAB ===============================================
// Hero (perfil + DEMO) + Recentes + Carrossel por sistema
// ============================================================
function HomeTab({ systems, covers, activeProfile, androidDemo, loading, recents, onPickSystem, onPickGame, onResume, onPickFolder, hasFilesAccess, onRequestAccess }) {
  const nonEmptySystems = systems.filter((s) => s.games.length > 0);
  const topSystems = nonEmptySystems.slice(0, 6);

  // Internal: jogos por modified_at (usado por carrosseis), distinto de recents (props - last played)
  const recentByMtime = useMemo(() => {
    const all = [];
    for (const sys of systems) {
      for (const g of sys.games) {
        all.push({ system: sys, game: g });
      }
    }
    all.sort((a, b) => (b.game.modified_at || 0) - (a.game.modified_at || 0));
    return all.slice(0, 8);
  }, [systems]);

  return (
    <div className="lmx-home">
      {/* Hero header */}
      <header className="lmx-home-hero">
        <div className="lmx-home-greeting">
          <div className="lmx-home-hello">Ola</div>
          <div className="lmx-home-name">{activeProfile?.name || "Player"}</div>
        </div>
        {androidDemo && !androidDemo.is_admin_unlocked && androidDemo.days_left > 0 && (
          <div className={`lmx-home-demo ${androidDemo.days_left <= 2 ? "warn" : ""}`}>
            <IconClock />
            <span>{androidDemo.days_left}d demo</span>
          </div>
        )}
      </header>

      {loading && (
        <div className="lmx-msg">
          <div className="lmx-spinner-small" />
          Procurando seus jogos...
        </div>
      )}

      {/* v0.8.22: Continue onde parou (recents) */}
      {recents && recents.length > 0 && (
        <RecentsBanner recents={recents} covers={covers} onResume={onResume} />
      )}

      {!loading && nonEmptySystems.length === 0 && (
        <div className="lmx-empty-state">
          <div className="lmx-empty-icon"><IconGrid /></div>
          <h2>Nenhum jogo ainda</h2>
          {!hasFilesAccess ? (
            <>
              <p>
                O Ludex precisa de permissao pra acessar suas ROMs no celular.
                <br /><br />
                Apos clicar, ative o switch do <b>Ludex</b> em <b>"Acesso a todos os arquivos"</b> e volte aqui.
              </p>
              <button className="lmx-settings-btn primary" onClick={onRequestAccess} style={{ maxWidth: 280, margin: "16px auto 0" }}>
                Permitir acesso aos arquivos
              </button>
            </>
          ) : (
            <>
              <p>
                Escolha a pasta no seu celular onde tem as ROMs.
                Pode ser <code>/Download</code>, <code>/Ludex/roms</code>,
                ou qualquer outra que voce ja tenha jogos.
              </p>
              <button className="lmx-settings-btn primary" onClick={onPickFolder} style={{ maxWidth: 280, margin: "16px auto 0" }}>
                Escolher pasta de ROMs
              </button>
            </>
          )}
        </div>
      )}

      {/* Adicionados recentemente (por modified_at do filesystem) */}
      {recentByMtime.length > 0 && (
        <section className="lmx-section">
          <h3 className="lmx-section-title">Adicionados recentemente</h3>
          <div className="lmx-carousel">
            {recentByMtime.map(({ system, game }) => (
              <GameCard
                key={game.path}
                system={system}
                game={game}
                coverSrc={covers[game.path]}
                onClick={() => onPickGame(system, game)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Carrossel por sistema (top 6) */}
      {topSystems.map((sys) => (
        <section className="lmx-section" key={sys.id}>
          <button className="lmx-section-title-link" onClick={() => onPickSystem(sys)}>
            <span className="lmx-section-sys-icon" style={{ color: sys.color }}><SysGlyph id={sys.id} /></span>
            <h3 className="lmx-section-title">{sys.name}</h3>
            <span className="lmx-section-count">{sys.games.length}</span>
            <span className="lmx-section-arrow">›</span>
          </button>
          <div className="lmx-carousel">
            {sys.games.slice(0, 12).map((g) => (
              <GameCard
                key={g.path}
                system={sys}
                game={g}
                coverSrc={covers[g.path]}
                onClick={() => onPickGame(sys, g)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ============================================================
// === GAME CARD (usado em carrosseis e grids) ================
// ============================================================
function GameCard({ system, game, coverSrc, onClick }) {
  const hasCover = typeof coverSrc === "string" && coverSrc.length > 0;
  return (
    <button className="lmx-card" onClick={onClick} style={{ "--sys-color": system.color }}>
      {hasCover ? (
        <img className="lmx-card-cover" src={coverSrc} alt={game.name} loading="lazy" />
      ) : (
        <div className="lmx-card-fallback">
          <div className="lmx-card-icon" style={{ color: system.color }}><SysGlyph id={system.id} /></div>
          <div className="lmx-card-name">{game.name}</div>
        </div>
      )}
    </button>
  );
}

// ============================================================
// === SYSTEMS TAB ============================================
// Lista vertical agrupada por categoria
// ============================================================
function SystemsTab({ systems, onPickSystem }) {
  // Agrupa systems por categoria
  const grouped = useMemo(() => {
    const byCategoryId = {};
    for (const sys of systems) {
      const cat = categoryOfSystem(sys.id);
      if (!byCategoryId[cat.id]) byCategoryId[cat.id] = { cat, systems: [] };
      byCategoryId[cat.id].systems.push(sys);
    }
    return CATEGORIES.map((c) => byCategoryId[c.id]).filter(Boolean);
  }, [systems]);

  return (
    <div className="lmx-systems">
      <header className="lmx-page-header">
        <h1>Sistemas</h1>
      </header>
      {grouped.map(({ cat, systems: sysList }) => (
        <section className="lmx-systems-group" key={cat.id}>
          <h3 className="lmx-systems-cat">{cat.name}</h3>
          <div className="lmx-systems-list">
            {sysList.map((sys) => (
              <button
                key={sys.id}
                className="lmx-systems-row"
                onClick={() => onPickSystem(sys)}
              >
                <div className="lmx-systems-row-icon" style={{ background: sys.color }}>
                  <SysGlyph id={sys.id} />
                </div>
                <div className="lmx-systems-row-text">
                  <div className="lmx-systems-row-name">{sys.name}</div>
                  <div className="lmx-systems-row-count">
                    {sys.games.length === 0 ? "Sem jogos" : `${sys.games.length} jogo${sys.games.length === 1 ? "" : "s"}`}
                  </div>
                </div>
                <div className="lmx-systems-row-arrow">›</div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ============================================================
// === SEARCH TAB =============================================
// ============================================================
function SearchTab({ systems, covers, search, setSearch, onPickGame }) {
  const trimmed = search.trim().toLowerCase();
  const results = useMemo(() => {
    if (trimmed.length < 2) return [];
    const out = [];
    for (const sys of systems) {
      for (const g of sys.games) {
        if (g.name.toLowerCase().includes(trimmed)) {
          out.push({ system: sys, game: g });
          if (out.length > 60) break;
        }
      }
      if (out.length > 60) break;
    }
    return out;
  }, [systems, trimmed]);

  return (
    <div className="lmx-search">
      <header className="lmx-page-header">
        <h1>Buscar</h1>
      </header>
      <div className="lmx-search-input-wrap">
        <IconSearch />
        <input
          type="text"
          className="lmx-search-input"
          placeholder="Nome do jogo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {search && (
          <button className="lmx-search-clear" onClick={() => setSearch("")}>
            <IconClose />
          </button>
        )}
      </div>
      {trimmed.length < 2 && (
        <div className="lmx-search-hint">Digite pelo menos 2 letras pra buscar</div>
      )}
      {trimmed.length >= 2 && results.length === 0 && (
        <div className="lmx-search-hint">Nenhum jogo encontrado</div>
      )}
      <div className="lmx-search-results">
        {results.map(({ system, game }) => (
          <button
            key={game.path}
            className="lmx-search-result"
            onClick={() => onPickGame(system, game)}
          >
            <div className="lmx-search-result-cover">
              {covers[game.path] ? (
                <img src={covers[game.path]} alt="" />
              ) : (
                <div className="lmx-search-result-fallback" style={{ background: system.color }}>
                  <SysGlyph id={system.id} />
                </div>
              )}
            </div>
            <div className="lmx-search-result-text">
              <div className="lmx-search-result-name">{game.name}</div>
              <div className="lmx-search-result-sys" style={{ color: system.color }}>{system.name}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// === SETTINGS TAB ===========================================
// ============================================================
// ============================================================
// === UPDATE REQUIRED SCREEN (bloqueio total)
// ============================================================
function UpdateRequiredScreen({ info, state, onInstall }) {
  return (
    <div className="lmx-update-required">
      <div className="lmx-update-card">
        <div className="lmx-update-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="3 17 9 11 13 15 21 7" />
            <polyline points="14 7 21 7 21 14" />
          </svg>
        </div>
        <h1>Atualizacao disponivel</h1>
        <div className="lmx-update-version">
          <span>v{info.current}</span>
          <span className="lmx-update-arrow">→</span>
          <span className="lmx-update-target">v{info.latest}</span>
        </div>
        <p className="lmx-update-notes">{info.notes}</p>
        <p className="lmx-update-required-text">
          Atualizacao obrigatoria pra usar o Ludex.<br />
          A versao Windows e gratuita pra quem comprou.
        </p>
        {state.stage === "downloading" && (
          <div className="lmx-update-loading">
            <div className="lmx-spinner" />
            <span>{state.msg}</span>
          </div>
        )}
        {state.stage === "installing" && (
          <div className="lmx-update-loading">
            <div className="lmx-spinner" />
            <span>{state.msg}</span>
          </div>
        )}
        {state.stage === "error" && (
          <p className="lmx-settings-msg error">{state.msg}</p>
        )}
        {state.stage !== "downloading" && state.stage !== "installing" && (
          <button className="lmx-settings-btn primary" onClick={onInstall}>
            Atualizar agora
          </button>
        )}
      </div>
    </div>
  );
}

function UpdateChecker() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const check = async () => {
    setBusy(true); setMsg(null);
    try {
      const info = await invoke("check_update_info");
      if (info?.available) {
        setMsg({ kind: "info", text: `Nova versao v${info.latest} disponivel! Reinicie o app pra ver o prompt de atualizacao.` });
      } else {
        setMsg({ kind: "ok", text: `Voce ja esta na versao mais recente (v${info?.current || "?"}).` });
      }
    } catch (e) {
      setMsg({ kind: "error", text: `Erro: ${e}` });
    } finally { setBusy(false); }
  };
  return (
    <>
      <p className="lmx-settings-hint">
        O Ludex verifica automaticamente no inicio. Se houver versao nova, aparece
        prompt obrigatorio pra atualizar.
      </p>
      <button className="lmx-settings-btn primary" onClick={check} disabled={busy}>
        {busy ? "Verificando..." : "Verificar atualizacao"}
      </button>
      {msg && <p className={`lmx-settings-msg ${msg.kind}`}>{msg.text}</p>}
    </>
  );
}

function SoundToggle() {
  const [muted, setMutedState] = useState(() => isMutedNow());
  return (
    <>
      <p className="lmx-settings-hint">
        Sons curtos ao trocar de aba, abrir jogo, jingles por sistema. Som do
        emulador (audio do jogo) e independente.
      </p>
      <button className="lmx-settings-btn primary" onClick={() => {
        const next = !muted;
        setSfxMuted(next);
        setMutedState(next);
        if (!next) sfx.confirm();
      }}>
        {muted ? "Ativar sons UI" : "Desativar sons UI"}
      </button>
    </>
  );
}

function SettingsTab({ activeProfile, androidDemo, onAdminUnlock, onPickFolder, currentRomsRoot }) {
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
        onAdminUnlock(newDemo);
        setMsg({ kind: "ok", text: "Destravado! Demo removida." });
        setShowKeyInput(false);
        setKeyInput("");
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
    <div className="lmx-settings">
      <header className="lmx-page-header">
        <h1>Ajustes</h1>
      </header>

      <section className="lmx-settings-card">
        <div className="lmx-settings-row">
          <div>
            <div className="lmx-settings-label">Perfil ativo</div>
            <div className="lmx-settings-value">{activeProfile?.name || "—"}</div>
          </div>
        </div>
      </section>

      {androidDemo && (
        <section className="lmx-settings-card">
          <div className="lmx-settings-row">
            <div>
              <div className="lmx-settings-label">Status da licenca</div>
              <div className="lmx-settings-value">
                {androidDemo.is_admin_unlocked
                  ? "Admin desbloqueado (vitalicio)"
                  : androidDemo.days_left > 0
                    ? `Demo: ${androidDemo.days_left} dia${androidDemo.days_left === 1 ? "" : "s"} restantes`
                    : "Demo expirada"}
              </div>
            </div>
          </div>
          {!androidDemo.is_admin_unlocked && (
            <>
              <a className="lmx-settings-btn primary" href="https://pauloadriel98.gumroad.com/l/ludex" target="_blank" rel="noopener">
                Comprar versao Windows (R$ 49,90)
              </a>
              {!showKeyInput ? (
                <button className="lmx-settings-btn ghost" onClick={() => setShowKeyInput(true)}>
                  Sou admin / tenho license
                </button>
              ) : (
                <div className="lmx-settings-key">
                  <input
                    type="text"
                    placeholder="Cole sua license key"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    autoFocus
                    disabled={busy}
                  />
                  <button className="lmx-settings-btn primary" onClick={tryUnlock} disabled={busy || !keyInput.trim()}>
                    {busy ? "Verificando..." : "Destravar"}
                  </button>
                  {msg && (
                    <p className={`lmx-settings-msg ${msg.kind}`}>{msg.text}</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">Pasta de ROMs</div>
        <div className="lmx-settings-paths">
          <code>{currentRomsRoot || "(padrao: /storage/emulated/0/Ludex/roms/)"}</code>
        </div>
        <button className="lmx-settings-btn primary" onClick={onPickFolder}>
          Escolher pasta no celular
        </button>
        <p className="lmx-settings-hint">
          Apos escolher, o Ludex varre subpastas automaticamente. Cada sistema
          aparece quando voce tem ROMs com extensao reconhecida (snes, gba, gb, iso, etc).
        </p>
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">BIOS, Mods e Traducoes</div>
        <div className="lmx-settings-paths">
          <div><strong>BIOS:</strong> <code>Ludex/system/</code> (Saturn/PSP/PS1/Dreamcast)</div>
          <div><strong>Saves:</strong> <code>Ludex/saves-libretro/</code></div>
          <div><strong>Mods/traducoes:</strong> <code>Ludex/mods/&lt;sistema&gt;/</code></div>
        </div>
        <button className="lmx-settings-btn primary" onClick={async () => {
          try {
            const base = await invoke("android_ludex_base_path");
            await invoke("android_open_folder", { absPath: base });
          } catch (e) { alert("Nao consegui abrir Files Manager: " + e); }
        }}>
          Abrir pasta Ludex no Files
        </button>
        <p className="lmx-settings-hint">
          Coloca BIOS na pasta <code>system/</code>. Mods/traducoes do mesmo jeito que no Windows:
          renomeia o ROM ou patcha antes de colocar em <code>roms/</code>.
        </p>
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">Atualizacao</div>
        <UpdateChecker />
      </section>

      <WhyWindowsCard />
      <AchievementsCard />
      <ChildModeCard />
      <AmbientMusicToggle />
      <BackupRestoreCard />

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">Sons</div>
        <SoundToggle />
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">Sobre</div>
        <div className="lmx-settings-value">Ludex Android v0.8.22</div>
        <p className="lmx-settings-hint">
          A versao Windows tem auto-update, gamepad nativo, todos os sistemas embedded + Switch/Wii U/PS3/Xbox 360/PS Vita via emulador externo.
        </p>
      </section>
    </div>
  );
}

// ============================================================
// === SYSTEM SCREEN (grid de jogos do sistema selecionado) ===
// ============================================================
function SystemScreen({ system, covers, onBack, onPickGame, onPickFolder }) {
  return (
    <div className="lmx-systemview">
      <header className="lmx-page-header has-back">
        <button className="lmx-back-btn" onClick={onBack}><IconArrowLeft /></button>
        <div className="lmx-systemview-title-wrap">
          <div className="lmx-systemview-icon" style={{ background: system.color }}><SysGlyph id={system.id} /></div>
          <div>
            <h1>{system.name}</h1>
            <div className="lmx-systemview-count">{system.games.length} jogo{system.games.length === 1 ? "" : "s"}</div>
          </div>
        </div>
      </header>
      {system.games.length === 0 ? (
        <div className="lmx-empty-state">
          <div className="lmx-empty-icon"><IconGrid /></div>
          <h2>Sem jogos de {system.name}</h2>
          <p>
            Escolha onde estao suas ROMs de {system.name} no celular.
            Pode ser qualquer pasta -- o Ludex vai detectar pela extensao.
          </p>
          {onPickFolder && (
            <button className="lmx-settings-btn primary" onClick={onPickFolder} style={{ maxWidth: 280, margin: "16px auto 0" }}>
              Escolher pasta de ROMs
            </button>
          )}
        </div>
      ) : (
        <div className="lmx-systemview-grid">
          {system.games.map((g) => (
            <GameCard
              key={g.path}
              system={system}
              game={g}
              coverSrc={covers[g.path]}
              onClick={() => onPickGame(g)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// === GAME DETAIL SCREEN (full screen) =======================
// ============================================================
function GameDetailScreen({ system, game, coverSrc, onClose, onLaunch }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    (async () => {
      try {
        const d = await invoke("fetch_game_details", { systemId: system.id, gameName: game.name });
        if (!cancelled) setDetails(d);
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [system.id, game.path, game.name]);

  const heroSrc = details?.cover_path ? convertFileSrc(details.cover_path) : coverSrc;
  const youtubeId = details?.videos?.[0]?.youtube_id;
  const summary = details?.summary || details?.storyline || "";

  return (
    <div className="lmx-detail">
      <button className="lmx-detail-close" onClick={onClose}><IconArrowLeft /></button>

      <div className="lmx-detail-hero">
        {youtubeId ? (
          <iframe
            className="lmx-detail-video"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${youtubeId}&modestbranding=1&rel=0`}
            title="Trailer"
            frameBorder="0"
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : heroSrc ? (
          <img className="lmx-detail-hero-img" src={heroSrc} alt="" />
        ) : (
          <div className="lmx-detail-hero-fallback" style={{ background: system.color }}>
            <SysGlyph id={system.id} />
          </div>
        )}
        <div className="lmx-detail-hero-shade" />
      </div>

      <div className="lmx-detail-body">
        <div className="lmx-detail-sys-pill" style={{ "--sys-color": system.color }}>
          <SysGlyph id={system.id} /> <span>{system.name}</span>
        </div>
        <h1 className="lmx-detail-name">{details?.name || game.name}</h1>
        <div className="lmx-detail-meta">
          {details?.first_release_year && <span>{details.first_release_year}</span>}
          {details?.developer && <span>· {details.developer}</span>}
          {game.size_mb && <span>· {game.size_mb} MB</span>}
        </div>

        <button className="lmx-detail-play" onClick={onLaunch}>
          <IconPlay /> JOGAR
        </button>

        {loading && <div className="lmx-detail-loading">Buscando info...</div>}
        {summary && <p className="lmx-detail-summary">{summary}</p>}

        {details?.genres?.length > 0 && (
          <div className="lmx-detail-genres">
            {details.genres.slice(0, 5).map((g) => (
              <span className="lmx-detail-genre" key={g}>{g}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// === FOLDER PICKER MODAL (Android, sem SAF nativo no Tauri) =
// ============================================================
const COMMON_ANDROID_FOLDERS = [
  { path: "/storage/emulated/0/Download", label: "Download", hint: "Pasta padrao de downloads" },
  { path: "/storage/emulated/0/Ludex/roms", label: "Ludex/roms", hint: "Pasta padrao do Ludex" },
  { path: "/storage/emulated/0/RetroArch/roms", label: "RetroArch/roms", hint: "Se ja usa RetroArch" },
  { path: "/storage/emulated/0/Roms", label: "Roms", hint: "Pasta generica de ROMs" },
  { path: "/storage/emulated/0/Games", label: "Games", hint: "Pasta de jogos" },
  { path: "/storage/emulated/0/Documents/ROMs", label: "Documents/ROMs", hint: "Em Documents" },
];

function FolderPickerModal({ onClose, onPick }) {
  const [custom, setCustom] = useState("");

  return (
    <div className="lmx-sheet-backdrop" onClick={onClose}>
      <div className="lmx-folder-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="lmx-sheet-handle" />
        <div className="lmx-sheet-header">
          <h3>Onde estao suas ROMs?</h3>
          <button className="lmx-back-btn" onClick={onClose} aria-label="Fechar"><IconClose /></button>
        </div>
        <p className="lmx-folder-hint">
          Escolha uma pasta comum ou digite o caminho exato no seu celular.
          O Ludex varre as subpastas automaticamente.
        </p>

        <div className="lmx-folder-list">
          {COMMON_ANDROID_FOLDERS.map((f) => (
            <button
              key={f.path}
              className="lmx-folder-item"
              onClick={() => onPick(f.path)}
            >
              <div className="lmx-folder-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="lmx-folder-item-text">
                <div className="lmx-folder-item-label">{f.label}</div>
                <div className="lmx-folder-item-path">{f.path}</div>
                <div className="lmx-folder-item-hint">{f.hint}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="lmx-folder-custom">
          <label className="lmx-folder-custom-label">Caminho custom:</label>
          <input
            type="text"
            placeholder="/storage/emulated/0/MinhaPasta"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="lmx-folder-custom-input"
          />
          <button
            className="lmx-settings-btn primary"
            disabled={!custom.trim()}
            onClick={() => onPick(custom.trim())}
          >
            Usar este caminho
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// === DEMO EXPIRED SCREEN ====================================
// ============================================================
function DemoExpiredScreen({ demo, onUnlock }) {
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
        onUnlock(newDemo);
      } else {
        setMsg({ kind: "error", text: "License nao e admin" });
      }
    } catch (e) {
      setMsg({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lmx-demo-expired">
      <div className="lmx-demo-expired-card">
        <div className="lmx-demo-expired-icon"><IconClock /></div>
        <h1>Demo expirou</h1>
        <p>
          Voce usou os {demo.demo_days_total} dias da versao Android gratuita.
          Pra continuar, compre a versao Windows.
        </p>
        <a className="lmx-settings-btn primary" href="https://pauloadriel98.gumroad.com/l/ludex" target="_blank" rel="noopener">
          Comprar Windows (R$ 49,90)
        </a>
        {!showKeyInput ? (
          <button className="lmx-settings-btn ghost" onClick={() => setShowKeyInput(true)}>
            Sou admin / tenho license
          </button>
        ) : (
          <div className="lmx-settings-key">
            <input
              type="text"
              placeholder="Cole sua license key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoFocus
              disabled={busy}
            />
            <button className="lmx-settings-btn primary" onClick={tryUnlock} disabled={busy || !keyInput.trim()}>
              {busy ? "Verificando..." : "Destravar"}
            </button>
            {msg && <p className={`lmx-settings-msg ${msg.kind}`}>{msg.text}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// === LAYOUTS DE CONTROLE POR SISTEMA ========================
// libretro RetroPad IDs:
//   0=B, 1=Y, 2=SELECT, 3=START, 4=UP, 5=DOWN, 6=LEFT, 7=RIGHT,
//   8=A, 9=X, 10=L, 11=R, 12=L2, 13=R2, 14=L3, 15=R3
// Cada sistema mostra SO os botoes que ele realmente usa, com label correto.
// ============================================================
const SYSTEM_LAYOUTS = {
  // ---- Nintendo handhelds + clasicos sem X/Y/L/R ----
  nes:  { face: [{id:0,label:"B",color:"r"},{id:8,label:"A",color:"r"}], shoulders: false, selectStart: true },
  gb:   { face: [{id:0,label:"B",color:"r"},{id:8,label:"A",color:"r"}], shoulders: false, selectStart: true },
  gbc:  { face: [{id:0,label:"B",color:"r"},{id:8,label:"A",color:"r"}], shoulders: false, selectStart: true },
  gba:  { face: [{id:0,label:"B",color:"r"},{id:8,label:"A",color:"r"}], shoulders: ["L","R"], selectStart: true },
  // ---- SNES classico: A B X Y + L R ----
  snes: { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"}], shoulders: ["L","R"], selectStart: true },
  // ---- N64: A B + C-buttons (mapeados em Y/X/L2/R2 do RetroPad) + Z(L) Start ----
  n64:  { face: [{id:9,label:"C↑",color:"y"},{id:1,label:"C←",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:13,label:"C↓",color:"y"},{id:14,label:"C→",color:"y"}], shoulders: ["Z","R"], selectStart: ["", "START"] },
  // ---- Sega Genesis / Master System / GG ----
  md:     { face: [{id:1,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:8,label:"C",color:"y"},{id:9,label:"X",color:"x"},{id:10,label:"Y",color:"y"},{id:11,label:"Z",color:"y"}], shoulders: false, selectStart: ["MODE","START"] },
  sms:    { face: [{id:0,label:"1",color:"b"},{id:8,label:"2",color:"a"}], shoulders: false, selectStart: ["","START"] },
  gg:     { face: [{id:0,label:"1",color:"b"},{id:8,label:"2",color:"a"}], shoulders: false, selectStart: ["","START"] },
  segacd: { face: [{id:1,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:8,label:"C",color:"y"}], shoulders: false, selectStart: ["MODE","START"] },
  // ---- Sega Dreamcast / Saturn ----
  dreamcast: { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"}], shoulders: ["L","R"], selectStart: ["","START"] },
  saturn:    { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:11,label:"Z",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:10,label:"C",color:"y"}], shoulders: false, selectStart: ["","START"] },
  // ---- Sony PS1/PS2: triangle/square/circle/cross ----
  ps1: { face: [{id:9,label:"△",color:"y"},{id:1,label:"□",color:"x"},{id:8,label:"◯",color:"a"},{id:0,label:"✕",color:"b"}], shoulders: ["L1","R1","L2","R2"], selectStart: true },
  ps2: { face: [{id:9,label:"△",color:"y"},{id:1,label:"□",color:"x"},{id:8,label:"◯",color:"a"},{id:0,label:"✕",color:"b"}], shoulders: ["L1","R1","L2","R2"], selectStart: true },
  // ---- Nintendo GameCube / Wii ----
  gc:  { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:13,label:"Z",color:"y"}], shoulders: ["L","R"], selectStart: ["","START"] },
  wii: { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:13,label:"Z",color:"y"}], shoulders: ["L","R"], selectStart: true },
  // ---- 3DS / DS ----
  ds:  { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"}], shoulders: ["L","R"], selectStart: true },
  // ---- TG-16/PCE: 2 botoes ----
  tg16: { face: [{id:0,label:"II",color:"b"},{id:8,label:"I",color:"a"}], shoulders: false, selectStart: ["SEL","RUN"] },
  // ---- Atari 2600/Lynx/Jaguar ----
  a2600:  { face: [{id:8,label:"FIRE",color:"a"}], shoulders: false, selectStart: ["RST","SEL"] },
  lynx:   { face: [{id:0,label:"B",color:"b"},{id:8,label:"A",color:"a"}], shoulders: false, selectStart: ["OPT2","OPT1"] },
  jaguar: { face: [{id:0,label:"B",color:"b"},{id:8,label:"A",color:"a"},{id:9,label:"C",color:"y"}], shoulders: false, selectStart: ["","#"] },
  // ---- Outros (WS/NGPC/MSX/C64/ZX/Amiga/Arcade/VB/3DO): default minimal ----
  ws:      { face: [{id:0,label:"B",color:"b"},{id:8,label:"A",color:"a"}], shoulders: false, selectStart: ["SEL","START"] },
  ngpc:    { face: [{id:0,label:"B",color:"b"},{id:8,label:"A",color:"a"}], shoulders: false, selectStart: ["","OPT"] },
  vb:      { face: [{id:0,label:"B",color:"b"},{id:8,label:"A",color:"a"}], shoulders: ["L","R"], selectStart: true },
  msx:     { face: [{id:0,label:"B",color:"b"},{id:8,label:"A",color:"a"}], shoulders: false, selectStart: true },
  c64:     { face: [{id:8,label:"FIRE",color:"a"}], shoulders: false, selectStart: true },
  zx:      { face: [{id:8,label:"FIRE",color:"a"}], shoulders: false, selectStart: true },
  amiga:   { face: [{id:0,label:"B",color:"b"},{id:8,label:"A",color:"a"}], shoulders: false, selectStart: true },
  arcade:  { face: [{id:9,label:"4",color:"x"},{id:1,label:"3",color:"y"},{id:8,label:"2",color:"a"},{id:0,label:"1",color:"b"},{id:11,label:"6",color:"y"},{id:10,label:"5",color:"y"}], shoulders: false, selectStart: ["COIN","START"] },
  threedo: { face: [{id:0,label:"B",color:"b"},{id:8,label:"A",color:"a"},{id:9,label:"C",color:"y"}], shoulders: ["L","R"], selectStart: ["","P"] },
};
// Default: SNES-like (A/B/X/Y + L/R + Start/Select)
const DEFAULT_LAYOUT = SYSTEM_LAYOUTS.snes;

// ============================================================
// === MOBILE EMULATOR VIEW (canvas libretro + touch controls)
// Versao mobile do EmulatorView do desktop. Frame loop, audio,
// touch controls customizados por sistema (cada console tem layout proprio).
// ============================================================
// localStorage key pra layout custom per-system
const LAYOUT_STORAGE_KEY = "ludex.controlLayout.v1";
function loadCustomLayout(systemId) {
  try {
    const all = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || "{}");
    return all[systemId] || null;
  } catch { return null; }
}
function saveCustomLayout(systemId, offsets) {
  try {
    const all = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || "{}");
    all[systemId] = offsets;
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

function MobileEmulatorView({ system, game, onClose }) {
  const layout = SYSTEM_LAYOUTS[system.id] || DEFAULT_LAYOUT;
  const [menuOpen, setMenuOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const [scaleMode, setScaleMode] = useState(() => {
    try { return localStorage.getItem(`ludex.scale.${system.id}`) || "contain"; }
    catch { return "contain"; }
  });
  useEffect(() => {
    try { localStorage.setItem(`ludex.scale.${system.id}`, scaleMode); } catch {}
  }, [scaleMode, system.id]);
  const [stateMsg, setStateMsg] = useState(null);
  // Edit mode + offsets custom dos grupos de botoes (dpad, face, system, shoulders)
  const [editMode, setEditMode] = useState(false);
  const [offsets, setOffsets] = useState(() => loadCustomLayout(system.id) || {});
  const dragState = useRef(null);
  // Sleep timer: pausa core se sem input por X min (v0.8.22)
  const lastInputRef = useRef(Date.now());
  const [autoPaused, setAutoPaused] = useState(false);
  // Quick save/load via tap duplo no canto (v0.8.22)
  const cornerTapRef = useRef({ tl: 0, tr: 0 });

  const startDrag = useCallback((groupKey) => (e) => {
    if (!editMode) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const cur = offsets[groupKey] || { x: 0, y: 0 };
    dragState.current = {
      groupKey,
      startX: touch.clientX,
      startY: touch.clientY,
      baseX: cur.x,
      baseY: cur.y,
    };
  }, [editMode, offsets]);
  const moveDrag = useCallback((e) => {
    const st = dragState.current;
    if (!st) return;
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - st.startX;
    const dy = touch.clientY - st.startY;
    setOffsets((prev) => ({ ...prev, [st.groupKey]: { x: st.baseX + dx, y: st.baseY + dy } }));
  }, []);
  const endDrag = useCallback(() => {
    if (dragState.current) {
      dragState.current = null;
      // persist
      setOffsets((cur) => { saveCustomLayout(system.id, cur); return cur; });
    }
  }, [system.id]);
  useEffect(() => {
    if (!editMode) return;
    window.addEventListener("touchmove", moveDrag, { passive: false });
    window.addEventListener("touchend", endDrag);
    window.addEventListener("mousemove", moveDrag);
    window.addEventListener("mouseup", endDrag);
    return () => {
      window.removeEventListener("touchmove", moveDrag);
      window.removeEventListener("touchend", endDrag);
      window.removeEventListener("mousemove", moveDrag);
      window.removeEventListener("mouseup", endDrag);
    };
  }, [editMode, moveDrag, endDrag]);
  const groupStyle = useCallback((key) => {
    const o = offsets[key];
    if (!o) return undefined;
    return { transform: `translate(${o.x}px, ${o.y}px)` };
  }, [offsets]);
  const resetLayout = useCallback(() => {
    setOffsets({});
    saveCustomLayout(system.id, {});
  }, [system.id]);
  const canvasRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const audioCtxRef = useRef(null);
  const audioNextTimeRef = useRef(0);
  const audioRateRef = useRef(32040);
  const stoppedRef = useRef(false);

  // Carrega core + ROM
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const coreFile = system.libretro_core;
        if (!coreFile) { setError(`Sistema "${system.name}" sem core libretro`); return; }
        const result = await invoke("libretro_load_game", { coreFilename: coreFile, romPath: game.path });
        if (cancelled) return;
        setInfo(result);
        audioRateRef.current = result.sample_rate || 32040;
        if (canvasRef.current) {
          canvasRef.current.width = result.base_width;
          canvasRef.current.height = result.base_height;
        }
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: result.sample_rate });
          await ctx.resume();
          audioCtxRef.current = ctx;
          audioNextTimeRef.current = ctx.currentTime + 0.05;
        } catch (e) { console.warn("AudioContext", e); }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      stoppedRef.current = true;
      invoke("libretro_unload").catch(() => {});
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
    };
  }, [system.id, game.path, system.libretro_core]);

  // Loop de frames + audio
  useEffect(() => {
    if (!info) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let lastTime = performance.now();
    const targetFrameMs = 1000 / (info.fps || 60);
    let raf = null;

    async function tick() {
      if (stoppedRef.current) return;
      const now = performance.now();
      if (now - lastTime >= targetFrameMs - 1) {
        lastTime = now;
        try {
          const buf = await invoke("libretro_run_frame");
          if (buf && buf.byteLength >= 8) {
            const view = new DataView(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength);
            const w = view.getUint32(0, true);
            const h = view.getUint32(4, true);
            const rgba = new Uint8ClampedArray(buf.buffer ? buf.buffer : buf, (buf.byteOffset || 0) + 8, w * h * 4);
            if (w !== ctx.canvas.width || h !== ctx.canvas.height) {
              ctx.canvas.width = w; ctx.canvas.height = h;
            }
            ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
          }
          const audioBuf = await invoke("libretro_take_audio");
          const actx = audioCtxRef.current;
          if (audioBuf && audioBuf.byteLength > 0 && actx && !mutedRef.current) {
            const i16 = new Int16Array(audioBuf.buffer ? audioBuf.buffer : audioBuf, audioBuf.byteOffset || 0, audioBuf.byteLength / 2);
            const frames = i16.length / 2;
            if (frames > 0) {
              const sampleRate = audioRateRef.current;
              const node = actx.createBuffer(2, frames, sampleRate);
              const L = node.getChannelData(0); const R = node.getChannelData(1);
              for (let i = 0; i < frames; i++) { L[i] = i16[i*2]/32768; R[i] = i16[i*2+1]/32768; }
              const src = actx.createBufferSource(); src.buffer = node; src.connect(actx.destination);
              if (audioNextTimeRef.current < actx.currentTime + 0.02) audioNextTimeRef.current = actx.currentTime + 0.05;
              src.start(audioNextTimeRef.current);
              audioNextTimeRef.current += frames / sampleRate;
            }
          }
        } catch (e) { console.error("frame tick", e); }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [info]);

  // Touch handlers: button id libretro (joypad)
  const press = useCallback((id, pressed) => {
    lastInputRef.current = Date.now(); // reset sleep timer
    if (autoPaused) setAutoPaused(false);
    invoke("libretro_set_input", { buttonId: id, pressed }).catch(() => {});
  }, [autoPaused]);
  const btnProps = (id) => ({
    onTouchStart: (e) => { e.preventDefault(); press(id, true); },
    onTouchEnd:   (e) => { e.preventDefault(); press(id, false); },
    onTouchCancel:(e) => { e.preventDefault(); press(id, false); },
    onMouseDown:  () => press(id, true),
    onMouseUp:    () => press(id, false),
    onMouseLeave: () => press(id, false),
  });

  if (error) {
    return (
      <div className="lmx-emu-root">
        <div className="lmx-emu-error">
          <h2>Erro ao carregar jogo</h2>
          <pre>{error}</pre>
          <button className="lmx-settings-btn primary" onClick={onClose}>Voltar</button>
        </div>
      </div>
    );
  }

  // Save / Load state (com thumbnail v0.8.22)
  const saveState = useCallback(async (slot) => {
    try {
      await invoke("libretro_save_state", { slot });
      // Captura thumbnail do canvas atual (data URL)
      try {
        if (canvasRef.current) {
          const thumb = canvasRef.current.toDataURL("image/jpeg", 0.6);
          saveThumbnail(system.id, slot, thumb);
        }
      } catch {}
      try { unlockAchievement("first_save", () => {}); } catch {}
      setStateMsg(`Salvo no slot ${slot}`);
    } catch (e) { setStateMsg(`Falha ao salvar: ${e}`); }
    setTimeout(() => setStateMsg(null), 2500);
  }, [system.id]);
  const loadState = useCallback(async (slot) => {
    try {
      await invoke("libretro_load_state", { slot });
      setStateMsg(`Carregado slot ${slot}`);
    } catch (e) { setStateMsg(`Falha ao carregar: ${e}`); }
    setTimeout(() => setStateMsg(null), 2500);
  }, []);

  // Sleep timer: a cada 60s, checa idle > 30min e auto-pause (v0.8.22)
  useEffect(() => {
    const t = setInterval(() => {
      const idleMs = Date.now() - lastInputRef.current;
      if (idleMs > 30 * 60 * 1000 && !autoPaused) {
        setAutoPaused(true);
        setStateMsg("Pausado (30min sem input). Toque pra retomar.");
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [autoPaused]);

  // Quick save/load via tap duplo no canto (v0.8.22)
  const cornerTap = useCallback((corner) => () => {
    const now = Date.now();
    const last = cornerTapRef.current[corner];
    cornerTapRef.current[corner] = now;
    lastInputRef.current = now;
    if (autoPaused) setAutoPaused(false);
    if (now - last < 400) {
      // double-tap
      if (corner === "tl") { saveState(0); haptic(15); }
      else { loadState(0); haptic(15); }
    }
  }, [autoPaused, saveState, loadState]);

  // Screenshot (captura canvas + salva em galeria local)
  const takeScreenshot = useCallback(() => {
    try {
      if (!canvasRef.current) return;
      const data = canvasRef.current.toDataURL("image/jpeg", 0.7);
      addScreenshot(system.id, game.name, data);
      setStateMsg("Screenshot salva (Ajustes -> Galeria)");
      sfx.confirm(); haptic(15);
      setTimeout(() => setStateMsg(null), 2500);
    } catch {}
  }, [system.id, game.name]);

  return (
    <div className="lmx-emu-root">
      <button className="lmx-emu-back" onClick={onClose} aria-label="Voltar"><IconArrowLeft /></button>
      <button className="lmx-emu-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">⚙</button>
      <div className={`lmx-emu-canvas-wrap lmx-emu-scale-${scaleMode}`}>
        <canvas ref={canvasRef} className="lmx-emu-canvas" />
        {/* Corner tap zones: TL=quick save, TR=quick load (double tap) */}
        <div className="lmx-emu-corner lmx-emu-corner-tl" onTouchEnd={cornerTap("tl")} onClick={cornerTap("tl")} aria-label="Tap duplo: save state 0" />
        <div className="lmx-emu-corner lmx-emu-corner-tr" onTouchEnd={cornerTap("tr")} onClick={cornerTap("tr")} aria-label="Tap duplo: load state 0" />
        {/* Watermark "Ludex Desktop" (paywall hint) */}
        <div className="lmx-emu-watermark">Versao previa - Ludex Desktop tem mais</div>
        {autoPaused && (
          <div className="lmx-emu-autopause">
            <h3>Pausado</h3>
            <p>30min sem input. Toque pra retomar.</p>
          </div>
        )}
      </div>
      {stateMsg && <div className="lmx-emu-toast">{stateMsg}</div>}
      {menuOpen && (
        <div className="lmx-emu-menu-overlay" onClick={() => setMenuOpen(false)}>
          <div className="lmx-emu-menu" onClick={(e) => e.stopPropagation()}>
            <h3>Opcoes</h3>

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">Escala da tela</div>
              <div className="lmx-emu-menu-row">
                {[
                  ["contain", "Encaixar"],
                  ["cover",   "Preencher"],
                  ["integer", "Integer (pixel-perfect)"],
                ].map(([k, lbl]) => (
                  <button
                    key={k}
                    className={`lmx-emu-menu-pill ${scaleMode === k ? "on" : ""}`}
                    onClick={() => setScaleMode(k)}
                  >{lbl}</button>
                ))}
              </div>
            </div>

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">Save states</div>
              <div className="lmx-emu-menu-row">
                {[1,2,3].map(s => (
                  <button key={`s${s}`} className="lmx-emu-menu-pill" onClick={() => { saveState(s); setMenuOpen(false); }}>Salvar {s}</button>
                ))}
              </div>
              <div className="lmx-emu-menu-row">
                {[1,2,3].map(s => (
                  <button key={`l${s}`} className="lmx-emu-menu-pill" onClick={() => { loadState(s); setMenuOpen(false); }}>Carregar {s}</button>
                ))}
              </div>
            </div>

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">Controles</div>
              <button className="lmx-emu-menu-pill" onClick={() => { setEditMode(true); setMenuOpen(false); }}>
                Editar layout (arrastar botoes)
              </button>
              <button className="lmx-emu-menu-pill" onClick={resetLayout} style={{marginTop:6}}>
                Resetar posicoes
              </button>
            </div>

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">Captura</div>
              <button className="lmx-emu-menu-pill" onClick={() => { takeScreenshot(); setMenuOpen(false); }}>
                Tirar screenshot
              </button>
            </div>

            <div className="lmx-emu-menu-section">
              <button className="lmx-emu-menu-pill" onClick={() => setMuted(m => !m)}>
                {muted ? "Ativar som" : "Mutar som"}
              </button>
            </div>

            <button className="lmx-settings-btn primary" onClick={() => setMenuOpen(false)}>Fechar</button>
            <button className="lmx-settings-btn ghost" onClick={() => { onClose(); }} style={{marginTop: 8}}>Sair do jogo</button>
          </div>
        </div>
      )}
      {!info && (
        <div className="lmx-emu-loading">
          <div className="lmx-spinner" />
          <div>Carregando emulador...</div>
        </div>
      )}
      {/* Touch controls — layout customizado por sistema */}
      <div className={`lmx-emu-controls ${editMode ? "lmx-emu-edit" : ""}`} data-face-count={layout.face.length}>
        {/* D-pad esquerda (todos os sistemas tem D-pad) */}
        <div className="lmx-emu-dpad" style={groupStyle("dpad")}
             onTouchStart={editMode ? startDrag("dpad") : undefined}
             onMouseDown={editMode ? startDrag("dpad") : undefined}>
          <button className="lmx-emu-dpad-up"    {...(editMode ? {} : btnProps(4))}>▲</button>
          <button className="lmx-emu-dpad-left"  {...(editMode ? {} : btnProps(6))}>◀</button>
          <button className="lmx-emu-dpad-right" {...(editMode ? {} : btnProps(7))}>▶</button>
          <button className="lmx-emu-dpad-down"  {...(editMode ? {} : btnProps(5))}>▼</button>
        </div>
        {/* Face buttons (A/B/X/Y/C/etc — varia por sistema) */}
        <div className={`lmx-emu-face lmx-emu-face-${layout.face.length}`}
             style={groupStyle("face")}
             onTouchStart={editMode ? startDrag("face") : undefined}
             onMouseDown={editMode ? startDrag("face") : undefined}>
          {layout.face.map((btn, i) => (
            <button
              key={btn.id}
              className={`lmx-emu-btn lmx-emu-face-pos-${i} lmx-emu-color-${btn.color}`}
              {...(editMode ? {} : btnProps(btn.id))}
            >{btn.label}</button>
          ))}
        </div>
        {/* Start / Select topo (libretro: 2=SELECT, 3=START) */}
        {layout.selectStart && (() => {
          const labels = Array.isArray(layout.selectStart) ? layout.selectStart : ["SELECT", "START"];
          return (
            <div className="lmx-emu-system" style={groupStyle("system")}
                 onTouchStart={editMode ? startDrag("system") : undefined}
                 onMouseDown={editMode ? startDrag("system") : undefined}>
              {labels[0] && <button className="lmx-emu-btn lmx-emu-btn-select" {...(editMode ? {} : btnProps(2))}>{labels[0]}</button>}
              {labels[1] && <button className="lmx-emu-btn lmx-emu-btn-start"  {...(editMode ? {} : btnProps(3))}>{labels[1]}</button>}
            </div>
          );
        })()}
        {/* Shoulders */}
        {layout.shoulders && (() => {
          const sh = layout.shoulders;
          const map = { L: 10, R: 11, L1: 10, R1: 11, L2: 12, R2: 13, Z: 10 };
          return (
            <div className="lmx-emu-shoulders" style={groupStyle("shoulders")}
                 onTouchStart={editMode ? startDrag("shoulders") : undefined}
                 onMouseDown={editMode ? startDrag("shoulders") : undefined}>
              <div className="lmx-emu-shoulders-l">
                {sh.filter(l => /^L|^Z/.test(l)).map(l => (
                  <button key={l} className="lmx-emu-btn lmx-emu-btn-l" {...(editMode ? {} : btnProps(map[l]))}>{l}</button>
                ))}
              </div>
              <div className="lmx-emu-shoulders-r">
                {sh.filter(l => /^R/.test(l)).map(l => (
                  <button key={l} className="lmx-emu-btn lmx-emu-btn-r" {...(editMode ? {} : btnProps(map[l]))}>{l}</button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
      {/* Banner edit mode */}
      {editMode && (
        <div className="lmx-emu-edit-banner">
          <span>Arraste cada grupo de botoes pra reposicionar</span>
          <button className="lmx-settings-btn ghost" onClick={resetLayout}>Resetar</button>
          <button className="lmx-settings-btn primary" onClick={() => setEditMode(false)}>OK</button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// === RECENTS BANNER (continue onde parou) ===================
// ============================================================
function RecentsBanner({ recents, covers, onResume }) {
  const top = recents[0];
  if (!top) return null;
  const cover = covers[top.gamePath];
  const stats = statsFor(top.gamePath);
  return (
    <section className="lmx-recents">
      <h3 className="lmx-section-title">Continue onde parou</h3>
      <button className="lmx-recents-card" onClick={() => onResume(top)} style={{ "--sys-color": top.systemColor }}>
        {cover && <img className="lmx-recents-bg" src={cover} alt="" aria-hidden />}
        <div className="lmx-recents-overlay" />
        <div className="lmx-recents-body">
          <span className="lmx-recents-sys">{top.systemName}</span>
          <h2 className="lmx-recents-name">{top.gameName}</h2>
          <div className="lmx-recents-meta">
            {stats.totalSec > 0 && <span>{formatPlayTime(stats.totalSec)} jogado</span>}
            <span>{formatRelative(top.timestamp)}</span>
          </div>
          <span className="lmx-recents-cta">Continuar</span>
        </div>
      </button>
      {recents.length > 1 && (
        <div className="lmx-recents-others">
          {recents.slice(1, 6).map(r => (
            <button key={r.gamePath} className="lmx-recents-mini" onClick={() => onResume(r)}>
              {covers[r.gamePath] ? <img src={covers[r.gamePath]} alt="" /> : <span>{r.systemName && r.systemName[0]}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// === TUTORIAL OVERLAY (3 cards primeira vez) ================
// ============================================================
function TutorialOverlay({ onDone }) {
  const steps = [
    { title: "Bem-vindo ao Ludex Mobile", body: "Esta e a versao previa do Ludex. Joga retro/clasicos direto no celular.", icon: "M5 4a2 2 0 012-2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2zM12 18h.01" },
    { title: "Adiciona ROMs", body: "Em Ajustes, clica 'Escolher pasta no celular' e aponta pra pasta com suas ROMs (.gba/.nes/.iso/etc).", icon: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" },
    { title: "Quer tudo? Pega o Windows", body: "A versao Windows (paga) tem Switch, PS3, Xbox 360, gamepad nativo, musica ambiente, Discord rich presence e mais.", icon: "M21 9V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-4" },
  ];
  const [idx, setIdx] = useState(0);
  const cur = steps[idx];
  const next = () => {
    if (idx + 1 >= steps.length) { onDone(); return; }
    setIdx(idx + 1);
  };
  return (
    <div className="lmx-tutorial-overlay" onClick={next}>
      <div className="lmx-tutorial-card" onClick={(e) => e.stopPropagation()}>
        <div className="lmx-tutorial-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={cur.icon} />
          </svg>
        </div>
        <h2>{cur.title}</h2>
        <p>{cur.body}</p>
        <div className="lmx-tutorial-dots">
          {steps.map((_, i) => <span key={i} className={i === idx ? "active" : ""} />)}
        </div>
        <button className="lmx-settings-btn primary" onClick={next}>
          {idx + 1 >= steps.length ? "Comecar" : "Proximo"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// === WHY WINDOWS CARD (paywall sutil) =======================
// ============================================================
function WhyWindowsCard() {
  return (
    <section className="lmx-settings-card lmx-why-windows">
      <div className="lmx-settings-label">Por que comprar a versao Windows?</div>
      <ul className="lmx-why-list">
        <li>Switch, PS3, Xbox 360, PS Vita, Wii U via emuladores nativos</li>
        <li>RetroAchievements (conquistas reais por jogo)</li>
        <li>Discord Rich Presence</li>
        <li>Musica ambiente com playlist + crossfade</li>
        <li>Wallpapers customizados, perfis ilimitados</li>
        <li>Gamepad nativo sem latencia</li>
        <li>Auto-update do app + cores libretro</li>
      </ul>
      <a className="lmx-settings-btn primary" href="https://pauloadriel98.gumroad.com/l/ludex" target="_blank" rel="noopener">
        Comprar Windows (R$ 49,90)
      </a>
    </section>
  );
}

// ============================================================
// === ACHIEVEMENTS LIST CARD =================================
// ============================================================
function AchievementsCard() {
  const unlocked = loadAchievements();
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">Conquistas Ludex ({unlocked.length}/{ACHIEVEMENTS.length})</div>
      <div className="lmx-ach-grid">
        {ACHIEVEMENTS.map(a => {
          const got = unlocked.includes(a.id);
          return (
            <div key={a.id} className={`lmx-ach-item ${got ? "got" : "locked"}`}>
              <div className="lmx-ach-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={a.icon} />
                </svg>
              </div>
              <div className="lmx-ach-info">
                <div className="lmx-ach-name">{a.name}</div>
                <div className="lmx-ach-desc">{a.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================
// === CHILD MODE TOGGLE (PIN) ================================
// ============================================================
function ChildModeCard() {
  const [on, setOnState] = useState(isChildModeOn());
  const [pinInput, setPinInput] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const enable = () => {
    if (pinInput.length !== 4) { alert("PIN deve ter 4 digitos"); return; }
    setChildModeStore(true, pinInput);
    setOnState(true);
    setPinInput("");
    setSetupOpen(false);
    sfx.confirm();
  };
  const disable = () => {
    const pin = window.prompt("Digite o PIN pra desativar:");
    if (!pin) return;
    if (!verifyChildPin(pin)) { alert("PIN incorreto"); return; }
    setChildModeStore(false);
    setOnState(false);
    sfx.confirm();
  };
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">Modo crianca</div>
      <p className="lmx-settings-hint">
        Esconde ROMs com nomes contendo palavras-chave adultas (GTA, Resident Evil, Doom, etc).
        Precisa PIN de 4 digitos pra desativar.
      </p>
      {on ? (
        <button className="lmx-settings-btn ghost" onClick={disable}>Desativar Modo crianca</button>
      ) : !setupOpen ? (
        <button className="lmx-settings-btn primary" onClick={() => setSetupOpen(true)}>Ativar Modo crianca</button>
      ) : (
        <div className="lmx-settings-key">
          <input
            type="tel" inputMode="numeric" maxLength={4} placeholder="PIN 4 digitos"
            value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <button className="lmx-settings-btn primary" onClick={enable} disabled={pinInput.length !== 4}>Confirmar</button>
        </div>
      )}
    </section>
  );
}

// ============================================================
// === BACKUP / RESTORE CARD ==================================
// ============================================================
function BackupRestoreCard() {
  const [msg, setMsg] = useState(null);
  const doExport = () => {
    const json = exportConfig();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).then(() => {
        setMsg({ kind: "ok", text: "Config copiada pro clipboard." });
      }).catch(() => setMsg({ kind: "info", text: json.slice(0, 200) + "..." }));
    }
    sfx.confirm();
    setTimeout(() => setMsg(null), 4000);
  };
  const doImport = () => {
    const json = window.prompt("Cola o JSON da config exportada:");
    if (!json) return;
    if (importConfig(json)) {
      setMsg({ kind: "ok", text: "Config importada. Reabra o app pra aplicar." });
    } else {
      setMsg({ kind: "error", text: "Falha ao importar." });
    }
    setTimeout(() => setMsg(null), 4000);
  };
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">Backup / restore</div>
      <p className="lmx-settings-hint">
        Exporta recents, conquistas, stats, cheats e capas custom em JSON.
      </p>
      <button className="lmx-settings-btn primary" onClick={doExport}>Exportar config</button>
      <button className="lmx-settings-btn ghost" onClick={doImport} style={{ marginTop: 8 }}>Importar config</button>
      {msg && <p className={`lmx-settings-msg ${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}

// ============================================================
// === AMBIENT MUSIC TOGGLE ===================================
// ============================================================
function AmbientMusicToggle() {
  const [on, setOnState] = useState(isAmbientOn());
  useEffect(() => { if (on) setAmbientOn(true); /* eslint-disable-next-line */ }, []);
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">Musica ambiente (chiptune)</div>
      <p className="lmx-settings-hint">
        Loop chiptune gerado in-app (Web Audio API), entre menus.
      </p>
      <button className="lmx-settings-btn primary" onClick={() => {
        const next = !on;
        setAmbientOn(next);
        setOnState(next);
      }}>
        {on ? "Desligar musica" : "Ligar musica"}
      </button>
    </section>
  );
}
