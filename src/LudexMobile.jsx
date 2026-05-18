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
  // Sony — PS1 e PSP embedded via libretro ARM; PS2 via AetherSX2 Intent (app externo)
  "ps1", "psp", "ps2",
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

      try {
        const sys = await invoke("scan_roms", { romsRoot: null });
        // Filtra: APK so mostra sistemas com core libretro ARM (autenticos embedded).
        // Switch/Wii U/PS3/Xbox/etc nao tem core ARM = nao funcionam em Android.
        const filtered = (sys || []).filter((s) => ANDROID_SUPPORTED.has(s.id));
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

  // Helper sons + haptic juntos (single source of truth pra interacao)
  const changeTab = useCallback((newTab) => {
    if (newTab === activeTab) return;
    sfx.nav(); haptic(8);
    setActiveTab(newTab);
  }, [activeTab]);

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
  // Em Android: libretro embedded OU fallback pra app externo via Intent (PS2 -> AetherSX2).
  const [playingGame, setPlayingGame] = useState(null);
  // Mapa system_id -> [packageName, displayName]: emuladores externos Android
  const EXTERNAL_ANDROID_EMUS = useMemo(() => ({
    ps2: { pkg: "xyz.aethersx2.android", name: "AetherSX2" },
    // futuro: gc/wii -> dolphin; n64 -> mupen; etc
  }), []);
  const launchGame = useCallback(async (system, game) => {
    // Jingle do sistema antes de carregar — feedback que o jogo tá abrindo
    playPlatformJingle(system.id);
    haptic(20);
    // Sistema tem core libretro embedded? Usa MobileEmulatorView (in-app)
    if (system.libretro_core) {
      setPlayingGame({ system, game });
      return;
    }
    // Sem core embedded -> tenta app externo Android
    const ext = EXTERNAL_ANDROID_EMUS[system.id];
    if (!ext) {
      alert(`Sistema "${system.name}" nao suportado em mobile.`);
      return;
    }
    try {
      const installed = await invoke("android_is_package_installed", { packageName: ext.pkg });
      if (!installed) {
        const wants = window.confirm(
          `${system.name} usa ${ext.name} (app separado) que voce nao tem instalado.\n\n` +
          `Quer abrir a Play Store pra instalar?`
        );
        if (wants) {
          try { await invoke("android_open_play_store", { packageName: ext.pkg }); } catch {}
        }
        return;
      }
      const ok = await invoke("android_launch_external_emu", { packageName: ext.pkg, romPath: game.path });
      if (!ok) {
        alert(`Nao consegui abrir ${ext.name} com este jogo. Abre o ${ext.name} manualmente e seleciona a ROM.`);
      }
    } catch (e) {
      alert(`Falha: ${e}`);
    }
  }, [EXTERNAL_ANDROID_EMUS]);

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
        onClose={() => { sfx.shutdown(); haptic(30); setPlayingGame(null); }}
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
    <div className="lmx">
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
            onPickSystem={(sys) => { playPlatformJingle(sys.id); haptic(12); setOpenSystem(sys); }}
            onPickGame={(system, game) => { sfx.open(); haptic(10); setOpenGame({ system, game }); }}
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
function HomeTab({ systems, covers, activeProfile, androidDemo, loading, onPickSystem, onPickGame, onPickFolder, hasFilesAccess, onRequestAccess }) {
  const nonEmptySystems = systems.filter((s) => s.games.length > 0);
  const topSystems = nonEmptySystems.slice(0, 6);

  // Recentes: jogos mais recentes (limit 8)
  const recents = useMemo(() => {
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

      {/* Recentes */}
      {recents.length > 0 && (
        <section className="lmx-section">
          <h3 className="lmx-section-title">Recentes</h3>
          <div className="lmx-carousel">
            {recents.map(({ system, game }) => (
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
        <div className="lmx-settings-label">PS2 (AetherSX2)</div>
        <p className="lmx-settings-hint">
          PS2 mobile usa AetherSX2 (app externo gratuito). Se nao tiver instalado, ao
          tentar abrir uma ROM PS2 o Ludex sugere instalar pela Play Store.
        </p>
        <button className="lmx-settings-btn ghost" onClick={async () => {
          try { await invoke("android_open_play_store", { packageName: "xyz.aethersx2.android" }); }
          catch (e) { alert("Falha: " + e); }
        }}>
          Instalar AetherSX2
        </button>
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">Sons</div>
        <SoundToggle />
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">Sobre</div>
        <div className="lmx-settings-value">Ludex Android v0.8.18</div>
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
    invoke("libretro_set_input", { buttonId: id, pressed }).catch(() => {});
  }, []);
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

  // Save / Load state
  const saveState = useCallback(async (slot) => {
    try {
      await invoke("libretro_save_state", { slot });
      setStateMsg(`Salvo no slot ${slot}`);
    } catch (e) { setStateMsg(`Falha ao salvar: ${e}`); }
    setTimeout(() => setStateMsg(null), 2500);
  }, []);
  const loadState = useCallback(async (slot) => {
    try {
      await invoke("libretro_load_state", { slot });
      setStateMsg(`Carregado slot ${slot}`);
    } catch (e) { setStateMsg(`Falha ao carregar: ${e}`); }
    setTimeout(() => setStateMsg(null), 2500);
  }, []);

  return (
    <div className="lmx-emu-root">
      <button className="lmx-emu-back" onClick={onClose} aria-label="Voltar"><IconArrowLeft /></button>
      <button className="lmx-emu-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">⚙</button>
      <div className={`lmx-emu-canvas-wrap lmx-emu-scale-${scaleMode}`}>
        <canvas ref={canvasRef} className="lmx-emu-canvas" />
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
