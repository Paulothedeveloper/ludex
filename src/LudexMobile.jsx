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
import { getVersion } from "@tauri-apps/api/app";
import { getWhatsNew, markVersionSeen } from "./ludexChangelog";
import { WhatsNewModal } from "./LudexWhatsNew";
import { open as openDialog, message as nativeMessage, ask as nativeAsk } from "@tauri-apps/plugin-dialog";

// v0.9.2: window.alert/confirm/prompt sao NO-OP no WebView do Android (Tauri) —
// por isso varios botões "não funcionavam" no APK. Usa os dialogs NATIVOS do
// plugin-dialog. mAlert/mConfirm sao async (await). Pra prompt (sem equivalente
// nativo) usamos input in-app (modais proprios).
const mAlert = (msg) => { try { return nativeMessage(String(msg), { title: "Ludex" }); } catch { return Promise.resolve(); } };
const mConfirm = (msg) => { try { return nativeAsk(String(msg), { title: "Ludex" }); } catch { return Promise.resolve(false); } };
import { sfx, playPlatformJingle, unlockAudio, haptic, setMuted as setSfxMuted, isMutedNow } from "./ludexMobileAudio";
import {
  loadRecents, pushRecent, trackSession, statsFor, totalPlayTime, loadStats,
  ACHIEVEMENTS, loadAchievements, checkAchievements, markTabVisited, unlockAchievement,
  isChildModeOn, setChildMode as setChildModeStore, verifyChildPin, filterChildSafe,
  exportConfig, importConfig, notifyBackupMade,
  saveThumbnail, loadThumbnail,
  loadCustomCovers, setCustomCover,
  loadCheats, setCheats as setCheatsStore,
  addScreenshot, loadScreenshots,
  isFirstRunDone, markFirstRunDone,
  isAmbientOn, setAmbientPref, startAmbient, stopAmbient,
  formatPlayTime, formatRelative,
} from "./ludexMobileFeatures";
import { ambientMusic } from "./ludexAmbientMusic"; // v0.9.9: música ambiente igual ao PC
import { SystemIcon } from "./ludexIcons"; // v0.9.12: mesmos icones de sistema do PC
import { SystemSettingsModal, SuggestionsModal } from "./LudexExtras"; // v0.9.1: + SuggestionsModal pra paridade com desktop
import { DEFAULT_AVATARS, avatarUrl } from "./LudexOnboarding"; // v0.9.1: reusa avatares SVG do desktop (regra: NUNCA emoji em UI prod)
import { hasOptionsForSystem, applySystemOptions, effectivePadMap, loadSystemOptions, saveSystemOptions, SCREEN_LAYOUTS } from "./ludexSystemOptions";
import { CheatsModal } from "./LudexCheatsModal";
import { loadCheats as loadGameCheats, applyCheats as applyGameCheats } from "./ludexCheats";
import { t, LANGUAGES, getLanguage, setLanguage, subscribeLanguage, currentLocale } from "./ludexI18n";

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
// v0.9.11: icones da nav flutuante — estilo console (PS5/Xbox), preenchidos e
// arredondados, sem texto embaixo. Sistemas = gamepad (mais "console" que grade).
const IconNavHome = () => (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M11.3 3.3a1 1 0 0 1 1.4 0l8 7.3a1 1 0 0 1 .3.74V19a2 2 0 0 1-2 2h-3.5a1 1 0 0 1-1-1v-4.5a.8.8 0 0 0-.8-.8h-3.4a.8.8 0 0 0-.8.8V20a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-7.66a1 1 0 0 1 .3-.73z" /></svg>);
const IconNavLibrary = () => (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7.5 6h9A5.5 5.5 0 0 1 22 11.5v3.2a3.3 3.3 0 0 1-6.2 1.55l-.5-.95a1.2 1.2 0 0 0-1.06-.65H9.76c-.45 0-.85.25-1.06.65l-.5.95A3.3 3.3 0 0 1 2 14.7v-3.2A5.5 5.5 0 0 1 7.5 6zM7 9.4v1.35H5.65v1.5H7v1.35h1.5v-1.35h1.35v-1.5H8.5V9.4zm9.4.35a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-1.8 2.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" /></svg>);
const IconNavSearch = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.8" y2="16.8" /></svg>);
const IconNavSettings = () => (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" /><path d="M19.4 13a7.6 7.6 0 0 0 .05-1 7.6 7.6 0 0 0-.05-1l1.7-1.3a.5.5 0 0 0 .12-.64l-1.6-2.78a.5.5 0 0 0-.6-.22l-2 .8a6.5 6.5 0 0 0-1.74-1l-.3-2.13a.5.5 0 0 0-.5-.42h-3.2a.5.5 0 0 0-.5.42l-.3 2.13a6.5 6.5 0 0 0-1.74 1l-2-.8a.5.5 0 0 0-.6.22L2.78 8.43a.5.5 0 0 0 .12.64L4.6 10.4a7.6 7.6 0 0 0 0 2L2.9 13.7a.5.5 0 0 0-.12.64l1.6 2.78a.5.5 0 0 0 .6.22l2-.8a6.5 6.5 0 0 0 1.74 1l.3 2.13a.5.5 0 0 0 .5.42h3.2a.5.5 0 0 0 .5-.42l.3-2.13a6.5 6.5 0 0 0 1.74-1l2 .8a.5.5 0 0 0 .6-.22l1.6-2.78a.5.5 0 0 0-.12-.64z" /></svg>);

// ============================================================
// === ICONES DE SISTEMAS (compactos pra mobile) ==============
// ============================================================
// v0.9.12: mesmo icone de sistema do launcher do PC (arte de console detalhada).
function SysGlyph({ id }) { return <SystemIcon id={id} />; }

// ============================================================
// === SISTEMAS SUPORTADOS NO ANDROID =========================
// Whitelist dos sistemas com core libretro .so ARM disponível
// (autenticos Ludex embedded). Todos os outros (Switch/PS3/Xbox/etc)
// não funcionam em Android e SAO OCULTOS na UI mobile.
// ============================================================
const ANDROID_SUPPORTED = new Set([
  // Nintendo (embedded via libretro ARM)
  "snes", "nes", "gb", "gbc", "n64", "gba", "ds", "wii", "gc", "vb",
  // Sony — so PS1 e PSP tem core libretro ARM. PS2/PS3/PS4/Vita: não suportado.
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

// v0.9.5: pasta POR SISTEMA. { systemId: folderPath }. Permite o user apontar
// uma pasta diferente pra cada emulador. Persistido no localStorage.
const SYSFOLDERS_KEY = "ludex.systemFolders";
function loadSystemFolders() {
  try { return JSON.parse(localStorage.getItem(SYSFOLDERS_KEY) || "{}"); } catch { return {}; }
}
function saveSystemFolder(systemId, path) {
  const m = loadSystemFolders();
  if (path) m[systemId] = path; else delete m[systemId];
  try { localStorage.setItem(SYSFOLDERS_KEY, JSON.stringify(m)); } catch {}
  return m;
}

// v0.9.7: splash de abertura minimalista (wordmark + barra, fundo sólido) —
// igual ao espírito do launcher do PC. Some sozinho via animação.
function MobileSplash() {
  return (
    <div className="lmx-splash">
      <div className="lmx-splash-word"><img src="/ludex-wordmark.png" alt="Ludex" style={{ width: "min(280px, 66vw)", height: "auto", display: "block" }} /></div>
      <div className="lmx-splash-bar"><span /></div>
    </div>
  );
}

// ============================================================
// === COMPONENTE PRINCIPAL ===================================
// ============================================================
export default function LudexMobile() {
  // v0.9.40: re-render reativo ao trocar de idioma (sem reload) — assina o i18n.
  const [, setLangTick] = useState(0);
  useEffect(() => subscribeLanguage(() => setLangTick((n) => n + 1)), []);
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({ profiles: [], active_profile_id: null });
  const [covers, setCovers] = useState({});
  const [activeTab, setActiveTab] = useState("home"); // home | systems | search | settings
  // v0.9.4: estado REAL do tutorial. Antes usava setActiveTab((t)=>t) pra "forçar
  // rerender" — mas setar o MESMO valor é no-op no React, então o overlay NUNCA
  // sumia (botão "Começar" travado). Agora é state de verdade.
  const [tutorialDone, setTutorialDone] = useState(() => isFirstRunDone());
  const [splashDone, setSplashDone] = useState(false); // v0.9.7: splash de abertura
  const [whatsNew, setWhatsNew] = useState(null); // v0.9.8: novidades pos-update
  const [profileEditorOpen, setProfileEditorOpen] = useState(false); // v0.9.4
  const [sysFolderPick, setSysFolderPick] = useState(null); // v0.9.5: systemId sendo configurado

  // v0.9.5: re-scaneia usando overrides por sistema. Retorna a lista filtrada.
  const rescanSystems = useCallback(async () => {
    try {
      const sys = await invoke("scan_roms_overrides", { romsRoot: null, overrides: loadSystemFolders() });
      const filtered = (sys || [])
        .filter((s) => ANDROID_SUPPORTED.has(s.id))
        .map(s => ({ ...s, games: filterChildSafe(s.games || []) }));
      setSystems(filtered);
      return filtered;
    } catch (e) { console.error("rescan", e); return []; }
  }, []);
  const [openSystem, setOpenSystem] = useState(null); // sistema selecionado (mostra grid)
  const [openGame, setOpenGame] = useState(null); // jogo selecionado (mostra detail)
  const [search, setSearch] = useState("");
  const [androidDemo, setAndroidDemo] = useState(null);
  const [launching, setLaunching] = useState(false);
  // v0.8.21: auto-update Android (banner obrigatorio quando ha versão nova)
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateState, setUpdateState] = useState({ stage: "idle", msg: "" }); // idle | downloading | installing | error
  // v0.8.22: achievement toast + telemetria local
  const [achievementToast, setAchievementToast] = useState(null);
  const [recents, setRecents] = useState(() => loadRecents()); // [{ systemId, systemName, systemColor, gameName, gamePath, timestamp, playTime }]
  const [appTheme, setAppThemeState] = useState(loadAppTheme); // v0.9.13: tema do app
  const setAppTheme = useCallback((id) => { setAppThemeState(id); saveAppTheme(id); }, []);
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
    } catch (e) { mAlert(t("Não consegui abrir Configurações: {e}", { e })); }
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
        // Auto-cria profile se não tem — e PERSISTE na hora. Sem o save_config o
        // profile vivia so no state do React: a cada cold start gerava um id novo,
        // entao stats e saves chaveados por profile id se perdiam silenciosamente.
        if (!c?.profiles?.length) {
          const id = `p${Math.random().toString(36).slice(2, 10)}`;
          const seeded = {
            ...(c || {}),
            profiles: [{ id, name: "Player", avatar_id: "controller", photo_path: null, created_at: Math.floor(Date.now() / 1000) }],
            active_profile_id: id,
            first_run_done: true,
          };
          setConfig(seeded);
          try { await invoke("save_config", { config: seeded }); } catch (e) { console.error("seed profile save", e); }
          try { await invoke("complete_first_run"); } catch {}
        }
      } catch (e) { console.error("load_config", e); }

      try {
        const demo = await invoke("android_demo_status");
        setAndroidDemo(demo);
        // v0.9.1: se license ativada, revalida com Gumroad (semanal, sync com desktop).
        // android_demo_status ja le cfg.android_admin_unlock + valida grace period offline.
        // Aqui pedimos check ativo se ja ativou: detecta revogacao, atualiza uses count.
        if (demo?.is_admin_unlocked) {
          try {
            const info = await invoke("license_validate");
            if (!info?.valid) {
              // License invalidada -> volta pro modo demo
              const updated = await invoke("android_demo_status");
              setAndroidDemo(updated);
            }
          } catch (e) {
            // Sem internet ou outro problema - mantem cached state (grace period 30d)
            console.warn("license_validate", e);
          }
        }
      } catch (e) { /* desktop ou erro -- ignora */ }

      // v0.8.14: checa permissão logo no startup (sem esperar scan retornar 0)
      try {
        const has = await invoke("android_has_all_files_access");
        setHasFilesAccess(has);
      } catch { setHasFilesAccess(true); /* desktop = sempre true */ }

      // v0.8.21: auto-check de update no startup (background, não bloqueia UI)
      setTimeout(() => {
        invoke("check_update_info")
          .then((info) => { if (info?.available) setUpdateInfo(info); })
          .catch((e) => console.warn("update check", e));
      }, 1500);

      try {
        const sys = await invoke("scan_roms_overrides", { romsRoot: null, overrides: loadSystemFolders() });
        // Filtra: APK so mostra sistemas com core libretro ARM (autenticos embedded).
        // Switch/Wii U/PS3/Xbox/etc não tem core ARM = não funcionam em Android.
        // v0.8.22: child mode filtra ROMs adultas por keyword no nome
        const filtered = (sys || [])
          .filter((s) => ANDROID_SUPPORTED.has(s.id))
          .map(s => ({ ...s, games: filterChildSafe(s.games || []) }));
        setSystems(filtered);
      } catch (e) { console.error("scan_roms", e); }
      setLoading(false);
    })();
  }, []);

  // v0.9.7: splash de abertura (some sozinho; entrada dos catalogos roda atras)
  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1550);
    return () => clearTimeout(t);
  }, []);

  // v0.9.8: novidades pos-update (compara versão atual com a ultima vista)
  useEffect(() => {
    (async () => {
      try {
        const v = await getVersion();
        const nw = getWhatsNew(v, isFirstRunDone());
        if (nw) setWhatsNew(nw);
      } catch {}
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
  // v0.9.36: anima entrada + saida. Antes sumia abrupto em 4.2s. Agora: visible
  // 3.5s + leaving 600ms (anima slide+fade pra baixo) + unmount.
  const [achLeaving, setAchLeaving] = useState(false);
  const onUnlockAch = useCallback((ach) => {
    setAchLeaving(false);
    setAchievementToast(ach);
    sfx.achievement(); haptic([20, 40, 20]);
    // Marca leaving aos 3.5s pra disparar CSS exit animation (lmx-ach-down 600ms)
    const tLeave = setTimeout(() => setAchLeaving(true), 3500);
    // Unmount real aos 4.1s (depois do exit acabar)
    const tHide  = setTimeout(() => { setAchievementToast(null); setAchLeaving(false); }, 4100);
    return () => { clearTimeout(tLeave); clearTimeout(tHide); };
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
    // v0.9.39: batch dos setCovers (paridade com o PC) — evita N re-renders da
    // grade no scan. Acumula e dá flush a cada 180ms + flush final.
    let pending = {}, flushTimer = null;
    const flush = () => { flushTimer = null; if (cancelled) return; const b = pending; pending = {}; if (Object.keys(b).length) setCovers((prev) => ({ ...prev, ...b })); };
    const put = (path, val) => { pending[path] = val; if (flushTimer == null) flushTimer = setTimeout(flush, 180); };
    async function worker() {
      while (queue.length > 0 && !cancelled) {
        const game = queue.shift();
        if (!game) break;
        try {
          const localPath = await invoke("fetch_cover", { systemId: openSystem.id, gameName: game.name });
          if (cancelled) return;
          put(game.path, localPath ? convertFileSrc(localPath) : null);
        } catch {
          put(game.path, null);
        }
      }
    }
    Promise.all(Array.from({ length: 4 }, worker)).then(() => { if (!cancelled) flush(); }).catch(() => {});
    return () => { cancelled = true; if (flushTimer) clearTimeout(flushTimer); };
  }, [openSystem]);

  // ============ FETCH COVERS PRA HOME (top sistemas) ============
  useEffect(() => {
    if (!systems.length) return;
    const topSystems = systems.filter((s) => s.games.length > 0).slice(0, 5);
    let cancelled = false;
    const queue = [];
    // v0.9.13: capa dos RECENTES primeiro (banner "Continua jogando" usa de fundo).
    for (const r of recents.slice(0, 6)) {
      if (covers[r.gamePath] === undefined) queue.push({ sysId: r.systemId, game: { path: r.gamePath, name: r.gameName } });
    }
    for (const sys of topSystems) {
      for (const g of sys.games.slice(0, 6)) {
        if (covers[g.path] === undefined) queue.push({ sysId: sys.id, game: g });
      }
    }
    if (queue.length === 0) return;
    // v0.9.39: batch dos setCovers (paridade com o PC).
    let pending = {}, flushTimer = null;
    const flush = () => { flushTimer = null; if (cancelled) return; const b = pending; pending = {}; if (Object.keys(b).length) setCovers((prev) => ({ ...prev, ...b })); };
    const put = (path, val) => { pending[path] = val; if (flushTimer == null) flushTimer = setTimeout(flush, 180); };
    async function worker() {
      while (queue.length > 0 && !cancelled) {
        const { sysId, game } = queue.shift();
        if (!game) break;
        try {
          const localPath = await invoke("fetch_cover", { systemId: sysId, gameName: game.name });
          if (cancelled) return;
          put(game.path, localPath ? convertFileSrc(localPath) : null);
        } catch {
          put(game.path, null);
        }
      }
    }
    // v0.9.33: 2 -> 4 workers (paridade com PC). S25 Ultra aguenta com sobra,
    // capas carregam ~2x mais rapido no scroll inicial.
    Promise.all(Array.from({ length: 4 }, worker)).then(() => { if (!cancelled) flush(); }).catch(() => {});
    return () => { cancelled = true; if (flushTimer) clearTimeout(flushTimer); };
  }, [systems, recents]);

  // v0.9.20: refresh do home REAL — antes so esvaziava o cache e o state, mas
  // o effect de fetch não re-disparava (deps inalteradas) -> capas sumiam e não
  // voltavam, e jogos novos na pasta não apareciam. Agora:
  //   1) limpa o cache em disco,
  //   2) zera o state (todos os paths viram undefined -> aptos a re-fetch),
  //   3) re-scaneia a pasta (descobre jogos novos / remove os apagados),
  //   4) o effect de cover-fetch dispara automaticamente porque systems mudou.
  const [reloadingCovers, setReloadingCovers] = useState(false);
  const reloadCovers = useCallback(async () => {
    if (reloadingCovers) return;
    setReloadingCovers(true);
    try {
      try { await invoke("clear_covers_cache", {}); } catch {}
      setCovers({});
      await rescanSystems();
    } catch (e) {
      console.error("[refresh] falhou:", e);
    } finally {
      setTimeout(() => setReloadingCovers(false), 800);
    }
  }, [reloadingCovers, rescanSystems]);

  // ============ LANCAR JOGO ============
  // Android: so libretro embedded. Sistemas sem core ARM não aparecem na lista
  // (filtrados por ANDROID_SUPPORTED). PS2/PS3/PS4/Vita/Xbox/Switch: não suportados.
  const [playingGame, setPlayingGame] = useState(null);
  const sessionStartRef = useRef(null);
  const launchGame = useCallback((system, game) => {
    if (!system.libretro_core) {
      mAlert(t("Sistema \"{name}\" não tem core libretro embedded para Android.", { name: system.name }));
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
    // v0.9.36: trava a tela em landscape ao abrir o jogo, mesmo se o user tem
    // "rotação automática" desligada no sistema (auto-lock do Android ignora
    // a preferência do sistema dentro do app via Screen Orientation API).
    try {
      if (window.screen?.orientation?.lock) {
        window.screen.orientation.lock('landscape').catch(() => {
          // Alguns devices bloqueiam .lock() fora de fullscreen — pede fullscreen primeiro.
          try {
            document.documentElement.requestFullscreen?.().then(() => {
              window.screen.orientation.lock('landscape').catch(() => {});
            }).catch(() => {});
          } catch {}
        });
      }
    } catch {}
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
    // v0.9.36: solta o lock landscape ao sair do jogo (volta pra preferência do
    // sistema/usuário). Fail-silent — se nunca travou, .unlock() é no-op.
    try {
      window.screen?.orientation?.unlock?.();
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch {}
  }, [playingGame, onUnlockAch]);

  // ============ MUSICA AMBIENTE APP-WIDE (paridade PC) ============
  // v0.9.9: toca a MESMA música ambiente do launcher do Windows (MP3 da pasta
  // Ludex/music com shuffle + crossfade, via ludexAmbientMusic). Antes so tocava
  // dentro da aba Ajustes (o AmbientMusicToggle era dono do playback). Agora o
  // playback e global: toca em qualquer tela, PAUSA dentro do emulador, e volta
  // ao sair. Sem MP3s, cai no chiptune sintetico. O toggle so liga/desliga a pref.
  useEffect(() => {
    let cancelled = false;
    const apply = async () => {
      const wantOn = isAmbientOn();
      const canPlay = wantOn && splashDone && !playingGame;
      if (!canPlay) {
        ambientMusic.stop({ immediate: !!playingGame });
        stopAmbient();
        return;
      }
      if (ambientMusic.playlist.length === 0) {
        try { await ambientMusic.load(); } catch {}
        if (cancelled) return;
      }
      if (ambientMusic.playlist.length > 0) {
        stopAmbient(); // garante chiptune off quando ha MP3
        if (!ambientMusic.isPlaying) ambientMusic.start(0.3);
      } else {
        startAmbient(); // fallback chiptune
      }
    };
    apply();
    const onChange = () => apply();
    window.addEventListener("ludex:ambient-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("ludex:ambient-changed", onChange);
    };
  }, [splashDone, playingGame]);

  // ============ PICKER DE PASTA ROMS ============
  // tauri-plugin-dialog NAO suporta directory picker em Android.
  // LudexMobile so roda em Android (App.jsx faz routing) -> sempre modal custom.
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  // v0.9.3: BACK do Android (gesto de swipe / botão) navega DENTRO do app em vez
  // de MINIMIZAR. Antes qualquer back minimizava o app em qualquer aba (bug) e o
  // user era obrigado a usar as setas. Agora usa History API: mantemos um "trap"
  // no histórico; ao voltar, desfazemos UM nível de navegação e re-armamos o
  // trap. So na raiz (Inicio, nada aberto) o próximo back sai do app.
  const navStateRef = useRef({});
  navStateRef.current = { activeTab, openSystem, openGame, playingGame, folderPickerOpen, profileEditorOpen, sysFolderPick };
  const closeEmulatorRef = useRef(closeEmulator);
  closeEmulatorRef.current = closeEmulator;
  useEffect(() => {
    try { history.pushState({ lx: 1 }, ""); } catch {}
    const onPop = () => {
      const s = navStateRef.current;
      let handled = true;
      if (s.playingGame) closeEmulatorRef.current && closeEmulatorRef.current();
      else if (s.sysFolderPick) setSysFolderPick(null);
      else if (s.profileEditorOpen) setProfileEditorOpen(false);
      else if (s.folderPickerOpen) setFolderPickerOpen(false);
      else if (s.openGame) setOpenGame(null);
      else if (s.openSystem) setOpenSystem(null);
      else if (s.activeTab && s.activeTab !== "home") setActiveTab("home");
      else handled = false; // raiz -> deixa o próximo back sair do app
      if (handled) { try { history.pushState({ lx: 1 }, ""); } catch {} }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const dbg = useCallback((msg) => {
    // v0.8.12 debug: WebView release não loga console no logcat,
    // entao usa frontend_log (Tauri tauri_plugin_log -> LogDir).
    try { invoke("frontend_log", { level: "info", message: `[picker] ${msg}` }); } catch {}
    try { console.log(`[Ludex] ${msg}`); } catch {}
  }, []);

  const pickRomsFolder = useCallback(() => {
    dbg("pickRomsFolder() chamado");
    // Fecha overlays/sub-telas pra o modal ficar visivel
    // (modal e renderizado so na tela principal — early return de openSystem/openGame
    //  fazia o modal não aparecer ate user voltar, causando o "trava o celular")
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
      const sys = await invoke("scan_roms_overrides", { romsRoot: path, overrides: loadSystemFolders() });
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
        // Checa permissão de acesso a todos os arquivos
        let hasAccess = true;
        try { hasAccess = await invoke("android_has_all_files_access"); } catch {}
        if (!hasAccess) {
          const ok = await mConfirm(
            t("O Ludex precisa de permissão para acessar seus arquivos.\n\nVou abrir Configurações — ative 'Permitir gerenciar todos os arquivos' e volte aqui.\n\nAbrir agora?")
          );
          if (ok) {
            try { await invoke("android_open_all_files_settings"); } catch (err) {
              await mAlert(t("Não consegui abrir Configurações: {e}", { e: err }));
            }
          }
        } else {
          await mAlert(
            t("Nenhum jogo encontrado em:\n{path}\n\nROMs suportadas: .nes .smc .sfc .gba .gb .gbc .iso .bin .cue .z64 .n64 .md .smd .gen .sms .gg .pce .ws .ngc .lnx .a26 .j64 .zip .7z e outras.", { path })
          );
        }
      }
    } catch (e) {
      dbg(`setRomsFolder falhou: ${e}`);
      await mAlert(t("Falha: {err}", { err: e }));
    }
  }, [dbg]);

  // ============ UPDATE OBRIGATORIO (bloqueia tudo) ============
  // v0.8.21: não deixa user usar app desatualizado em mobile
  if (updateInfo?.available) {
    return (
      <UpdateRequiredScreen
        info={updateInfo}
        state={updateState}
        onInstall={async () => {
          // v0.9.3: em vez de baixar/instalar dentro do app (instavel no WebView),
          // abre a release no GitHub no NAVEGADOR PADRAO do celular. O user baixa
          // o APK por la e instala. Mais confiavel e e o que o Paulo pediu.
          setUpdateState({ stage: "installing", msg: t("Abrindo a página da atualização no navegador...") });
          try {
            await invoke("open_url", { url: "https://github.com/EllaeMyApp/ludex/releases/latest" });
          } catch (e) {
            setUpdateState({ stage: "error", msg: t("Não consegui abrir o navegador. Acesse manualmente: github.com/EllaeMyApp/ludex/releases/latest") });
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
      <>
        <SystemScreen
          system={openSystem}
          covers={covers}
          onBack={() => { sfx.back(); haptic(8); setOpenSystem(null); }}
          onPickGame={(game) => { sfx.open(); haptic(10); setOpenGame({ system: openSystem, game }); }}
          onPickFolder={pickRomsFolder}
          onPickSystemFolder={() => { sfx.click(); setSysFolderPick(openSystem.id); }}
          currentSystemFolder={loadSystemFolders()[openSystem.id]}
        />
        {sysFolderPick && (
          <FolderPickerModal
            title={t("Pasta de {name}", { name: openSystem.name })}
            onClose={() => setSysFolderPick(null)}
            onPick={async (folder) => {
              saveSystemFolder(sysFolderPick, folder);
              setSysFolderPick(null);
              const list = await rescanSystems();
              const updated = list.find((s) => s.id === openSystem.id);
              setOpenSystem(updated || openSystem);
            }}
          />
        )}
      </>
    );
  }

  // ============ APP NORMAL: tab bar + conteudo ============
  return (
    <div className="lmx" data-theme={appTheme} style={lastGameCover ? { backgroundImage: `linear-gradient(180deg, rgba(10,2,32,0.85) 0%, rgba(10,2,32,0.98) 70%), url(${lastGameCover})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {!loading && launching && (
        <div className="lmx-loading-overlay">
          <div className="lmx-spinner" />
          <div>{t("Abrindo jogo...")}</div>
        </div>
      )}

      <main className="lmx-content">
        {/* v0.9.11: key={activeTab} remonta -> dispara animacao de entrada por aba */}
        <div className="lmx-tab-page" key={activeTab}>
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
            onOpenProfile={() => setProfileEditorOpen(true)}
            onReloadCovers={reloadCovers}
            reloadingCovers={reloadingCovers}
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
            config={config}
            onConfigChange={setConfig}
            appTheme={appTheme}
            onSetTheme={setAppTheme}
            onRestartTutorial={() => { setTutorialDone(false); setActiveTab("home"); }}
          />
        )}
        </div>
      </main>

      {/* Folder picker modal (Android não tem SAF nativo no Tauri ainda) */}
      {folderPickerOpen && (
        <FolderPickerModal
          onClose={() => setFolderPickerOpen(false)}
          onPick={(path) => setRomsFolder(path)}
        />
      )}

      {/* Achievement toast global */}
      {achievementToast && (
        <div className={`lmx-ach-toast ${achLeaving ? "leaving" : ""}`}>
          <div className="lmx-ach-toast-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={achievementToast.icon} />
            </svg>
          </div>
          <div className="lmx-ach-toast-body">
            <div className="lmx-ach-toast-label">{t("Conquista desbloqueada")}</div>
            <div className="lmx-ach-toast-name">{achievementToast.name}</div>
            <div className="lmx-ach-toast-desc">{achievementToast.desc}</div>
          </div>
        </div>
      )}

      {/* v0.9.7: splash de abertura */}
      {!splashDone && <MobileSplash />}
      {/* v0.9.8: novidades pos-update (depois do splash e do tutorial) */}
      {whatsNew && splashDone && tutorialDone && (
        <WhatsNewModal data={whatsNew} onClose={() => { markVersionSeen(whatsNew.current); setWhatsNew(null); }} />
      )}
      {/* Tutorial first run (v0.9.34: spotlight com blur cobrindo todas features) */}
      {!tutorialDone && splashDone && (
        <TutorialOverlay
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onDone={() => { markFirstRunDone(); setTutorialDone(true); }}
        />
      )}
      {/* v0.9.4: editor de perfil (foto + nome + avatar) */}
      {profileEditorOpen && activeProfile && (
        <ProfileEditorModal
          config={config}
          activeProfile={activeProfile}
          onConfigChange={setConfig}
          onClose={() => setProfileEditorOpen(false)}
        />
      )}

      {/* v0.9.11: bottom tab bar FLUTUANTE estilo console (PS5/Xbox) — sem texto,
          icones novos, pilula de destaque no ativo. */}
      <nav className="lmx-tabs lmx-tabs-float" data-tour="tabs">
        <TabBtn icon={<IconNavHome />} label={t("Início")} active={activeTab === "home"} onClick={() => changeTab("home")} />
        <TabBtn icon={<IconNavLibrary />} label={t("Sistemas")} active={activeTab === "systems"} onClick={() => changeTab("systems")} />
        <TabBtn icon={<IconNavSearch />} label={t("Buscar")} active={activeTab === "search"} onClick={() => changeTab("search")} />
        <TabBtn icon={<IconNavSettings />} label={t("Ajustes")} active={activeTab === "settings"} onClick={() => changeTab("settings")} />
      </nav>
    </div>
  );
}

// ============================================================
// === TAB BUTTON =============================================
// ============================================================
function TabBtn({ icon, label, active, onClick }) {
  // v0.9.11: sem texto embaixo — so o icone (label vira aria-label p/ acessibilidade).
  return (
    <button className={`lmx-tab ${active ? "active" : ""}`} onClick={onClick} aria-label={label}>
      <span className="lmx-tab-icon">{icon}</span>
    </button>
  );
}

// ============================================================
// === HOME TAB ===============================================
// Hero (perfil + DEMO) + Recentes + Carrossel por sistema
// ============================================================
function HomeTab({ systems, covers, activeProfile, androidDemo, loading, recents, onPickSystem, onPickGame, onResume, onPickFolder, hasFilesAccess, onRequestAccess, onOpenProfile, onReloadCovers, reloadingCovers }) {
  const nonEmptySystems = systems.filter((s) => s.games.length > 0);
  const topSystems = nonEmptySystems.slice(0, 6);
  const profileImg = profileImgSrc(activeProfile);

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

  // v0.9.14: "Mais jogados" (distinto de "Adicionados recentemente") — usa o tempo
  // de jogo. Some sozinho se ainda não ha tempo registrado.
  const mostPlayed = useMemo(() => {
    const all = [];
    for (const sys of systems) {
      for (const g of sys.games) {
        const s = statsFor(g.path);
        if (s.totalSec > 0) all.push({ system: sys, game: g, sec: s.totalSec });
      }
    }
    all.sort((a, b) => b.sec - a.sec);
    return all.slice(0, 8);
  }, [systems, recents]);

  return (
    <div className="lmx-home">
      {/* Hero header */}
      <header className="lmx-home-hero" data-tour="home-hero">
        {/* v0.9.3: avatar do perfil presente na home (toca = abre Ajustes/perfil) */}
        <button className="lmx-home-avatar" onClick={onOpenProfile} aria-label={t("Editar perfil")} data-tour="home-avatar">
          <img src={profileImg} alt={t("Perfil")} />
        </button>
        <div className="lmx-home-greeting">
          <div className="lmx-home-hello">{t("Olá")}</div>
          <div className="lmx-home-name">{activeProfile?.name || "Player"}</div>
        </div>
        {androidDemo && !androidDemo.is_admin_unlocked && androidDemo.days_left > 0 && (
          <div className={`lmx-home-demo ${androidDemo.days_left <= 2 ? "warn" : ""}`}>
            <IconClock />
            <span>{t("{n}d demo", { n: androidDemo.days_left })}</span>
          </div>
        )}
        {/* v0.9.15: recarregar capas (ao lado do badge de demo) */}
        <button
          className={`lmx-home-reload ${reloadingCovers ? "spinning" : ""}`}
          onClick={() => onReloadCovers && onReloadCovers()}
          aria-label={t("Recarregar capas")}
          title={t("Recarregar capas")}
          data-tour="home-reload"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
      </header>

      {loading && (
        <div className="lmx-msg">
          <div className="lmx-spinner-small" />
          {t("Procurando seus jogos...")}
        </div>
      )}

      {/* v0.9.14: "Mais jogados" — distinto de "Adicionados recentemente" abaixo
          (antes duplicava). Some sozinho se não ha tempo de jogo nem capa. */}
      <div data-tour="home-mais-jogados">
        <FeaturedCarousel title={t("Mais jogados")} items={mostPlayed} covers={covers} onPick={onPickGame} />
      </div>

      {/* v0.8.22: Continue onde parou (recents) */}
      {recents && recents.length > 0 && (
        <div data-tour="home-continue">
          <RecentsBanner recents={recents} covers={covers} onResume={onResume} />
        </div>
      )}

      {!loading && nonEmptySystems.length === 0 && (
        <div className="lmx-empty-state">
          <div className="lmx-empty-icon"><IconGrid /></div>
          <h2>{t("Nenhum jogo ainda")}</h2>
          {!hasFilesAccess ? (
            <>
              <p>
                {t("O Ludex precisa de permissão pra acessar suas ROMs no celular.")}
                <br /><br />
                {t("Após clicar, ative o switch do Ludex em \"Acesso a todos os arquivos\" e volte aqui.")}
              </p>
              <button className="lmx-settings-btn primary" onClick={onRequestAccess} style={{ maxWidth: 280, margin: "16px auto 0" }}>
                {t("Permitir acesso aos arquivos")}
              </button>
            </>
          ) : (
            <>
              <p>
                {t("Escolha a pasta no seu celular onde tem as ROMs. Pode ser /Download, /Ludex/roms, ou qualquer outra que você já tenha jogos.")}
              </p>
              <button className="lmx-settings-btn primary" onClick={onPickFolder} style={{ maxWidth: 280, margin: "16px auto 0" }}>
                {t("Escolher pasta de ROMs")}
              </button>
            </>
          )}
        </div>
      )}

      {/* Adicionados recentemente (por modified_at do filesystem) */}
      {recentByMtime.length > 0 && (
        <section className="lmx-section">
          <h3 className="lmx-section-title">{t("Adicionados recentemente")}</h3>
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
// === FEATURED CAROUSEL (v0.9.9 - paridade launcher PC) ======
// Carrossel horizontal de capas GRANDES no topo da home. Usa os jogos mais
// recentes que JA tem capa baixada (some inteiro enquanto não ha capa, pra não
// mostrar placeholders feios). Scroll-snap horizontal premium.
// ============================================================
function FeaturedCarousel({ items, covers, onPick, title = t("Destaques") }) {
  const withCover = (items || []).filter(
    ({ game }) => typeof covers[game.path] === "string" && covers[game.path].length > 0
  );
  if (withCover.length === 0) return null;
  const feat = withCover.slice(0, 6);
  return (
    <section className="lmx-featured">
      <h3 className="lmx-section-title">{title}</h3>
      <div className="lmx-featured-row">
        {feat.map(({ system, game }) => (
          <button
            key={game.path}
            className="lmx-featured-card"
            style={{ "--sys-color": system.color }}
            onClick={() => onPick(system, game)}
          >
            <img className="lmx-featured-cover" src={covers[game.path]} alt={game.name} loading="lazy" />
            <div className="lmx-featured-overlay">
              <span className="lmx-featured-sys" style={{ color: system.color }}><SysGlyph id={system.id} /></span>
              <span className="lmx-featured-name">{game.name}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
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
// === SYSTEMS TAB — RODA (v0.9.15) ===========================
// Em vez de lista, uma "roda" vertical com snap: o sistema no centro fica grande
// (escala via scroll-timeline CSS) e os de cima/baixo encolhem — cara de seletor
// de console. Fallback sem scroll-timeline = cards normais (sem quebrar).
// ============================================================
function SystemsTab({ systems, onPickSystem }) {
  // ordena agrupando por categoria, mas renderiza como roda unica
  const ordered = useMemo(() => {
    const byCat = {};
    for (const sys of systems) {
      const c = categoryOfSystem(sys.id);
      (byCat[c.id] ||= []).push(sys);
    }
    const out = [];
    for (const c of CATEGORIES) if (byCat[c.id]) out.push(...byCat[c.id]);
    return out;
  }, [systems]);

  return (
    <div className="lmx-systems" data-tour="tab-systems">
      <header className="lmx-page-header">
        <h1>{t("Sistemas")}</h1>
      </header>
      <div className="lmx-systems-wheel">
        {ordered.map((sys) => (
          <button
            key={sys.id}
            className="lmx-wheel-item"
            style={{ "--sys-color": sys.color }}
            onClick={() => { sfx.click(); onPickSystem(sys); }}
          >
            <div className="lmx-wheel-icon" style={{ background: sys.color }}>
              <SysGlyph id={sys.id} />
            </div>
            <div className="lmx-wheel-text">
              <div className="lmx-wheel-name">{sys.name}</div>
              <div className="lmx-wheel-count">
                {sys.games.length === 0 ? t("Sem jogos") : (sys.games.length === 1 ? t("{n} jogo", { n: sys.games.length }) : t("{n} jogos", { n: sys.games.length }))}
              </div>
            </div>
            <div className="lmx-wheel-arrow">›</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// === SEARCH TAB =============================================
// ============================================================
// v0.9.2: normaliza pra busca sem acento/maiuscula ("Pokémon" casa "pokemon")
const normSearch = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function SearchTab({ systems, covers, search, setSearch, onPickGame }) {
  const trimmed = search.trim();
  // multi-termo: cada palavra precisa aparecer (em qualquer ordem)
  const terms = useMemo(() => normSearch(trimmed).split(/\s+/).filter(Boolean), [trimmed]);
  const results = useMemo(() => {
    if (normSearch(trimmed).length < 2) return [];
    const out = [];
    for (const sys of systems) {
      for (const g of sys.games) {
        const hay = normSearch(g.name);
        if (terms.every((t) => hay.includes(t))) {
          out.push({ system: sys, game: g });
          if (out.length > 120) break;
        }
      }
      if (out.length > 120) break;
    }
    return out;
  }, [systems, terms, trimmed]);

  return (
    <div className="lmx-search" data-tour="tab-search">
      <header className="lmx-page-header">
        <h1>{t("Buscar")}</h1>
      </header>
      <div className="lmx-search-input-wrap" data-tour="search-input">
        <IconSearch />
        <input
          type="text"
          className="lmx-search-input"
          placeholder={t("Nome do jogo...")}
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
        <div className="lmx-search-hint">{t("Digite pelo menos 2 letras pra buscar")}</div>
      )}
      {trimmed.length >= 2 && results.length === 0 && (
        <div className="lmx-search-hint">{t("Nenhum jogo encontrado")}</div>
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
        <h1>{t("Atualização disponível")}</h1>
        <div className="lmx-update-version">
          <span>v{info.current}</span>
          <span className="lmx-update-arrow">→</span>
          <span className="lmx-update-target">v{info.latest}</span>
        </div>
        {info.notes && <p className="lmx-update-notes">{info.notes}</p>}
        <p className="lmx-update-required-text">
          {t("Toque em \"Atualizar agora\" para abrir a página de download no navegador.")}<br />
          {t("A versão Windows é gratuita pra quem comprou.")}
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
            {t("Atualizar agora")}
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
        setMsg({ kind: "info", text: t("Nova versão v{v} disponível! Reinicie o app pra ver o prompt de atualização.", { v: info.latest }) });
      } else {
        setMsg({ kind: "ok", text: t("Você já está na versão mais recente (v{v}).", { v: info?.current || "?" }) });
      }
    } catch (e) {
      setMsg({ kind: "error", text: t("Erro: {err}", { err: e }) });
    } finally { setBusy(false); }
  };
  return (
    <>
      <p className="lmx-settings-hint">
        {t("O Ludex verifica automaticamente no início. Se houver versão nova, aparece prompt obrigatório pra atualizar.")}
      </p>
      <button className="lmx-settings-btn primary" onClick={check} disabled={busy}>
        {busy ? t("Verificando...") : t("Verificar atualização")}
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
        {t("Sons curtos ao trocar de aba, abrir jogo, jingles por sistema. Som do emulador (áudio do jogo) é independente.")}
      </p>
      <button className="lmx-settings-btn primary" onClick={() => {
        const next = !muted;
        setSfxMuted(next);
        setMutedState(next);
        if (!next) sfx.confirm();
      }}>
        {muted ? t("Ativar sons UI") : t("Desativar sons UI")}
      </button>
    </>
  );
}

// v0.9.12: #10 — controle externo (Bluetooth/USB), paridade com o launcher do PC.
// Mostra status ao vivo da conexão. Funciona automático no jogo; remap fica na
// aba Controle das Opcoes do Emulador (por sistema, igual ao PC).
function ExternalControllerCard() {
  const [padName, setPadName] = useState(null);
  useEffect(() => {
    const tick = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let found = null;
      for (const p of pads) { if (p) { found = p; break; } }
      setPadName(found ? (found.id || t("Controle")) : null);
    };
    tick();
    const id = setInterval(tick, 900);
    const onConn = () => tick();
    window.addEventListener("gamepadconnected", onConn);
    window.addEventListener("gamepaddisconnected", onConn);
    return () => {
      clearInterval(id);
      window.removeEventListener("gamepadconnected", onConn);
      window.removeEventListener("gamepaddisconnected", onConn);
    };
  }, []);
  return (
    <section className="lmx-settings-card" data-tour="settings-controle">
      <div className="lmx-settings-label">{t("Controle externo")}</div>
      <div className="lmx-ctrl-status">
        <span className={`lmx-ctrl-dot ${padName ? "on" : ""}`} />
        <span>{padName ? t("Conectado: {name}", { name: padName.slice(0, 42) }) : t("Nenhum controle conectado")}</span>
      </div>
      <p className="lmx-settings-hint">
        {t("Controles Bluetooth/USB funcionam automaticamente dentro do jogo. Para remapear os botões, abra um jogo → menu (engrenagem) → Opções do Emulador → aba Controle (por sistema, igual ao launcher do PC).")}
      </p>
    </section>
  );
}

// v0.9.29: BIOS deep-scan no celular — varre /storage/emulated/0 inteiro atras
// de qualquer .bin com nome de BIOS conhecida e copia pra Ludex/system. Causa
// raiz provavel de "PS1 trava ao abrir" era BIOS scph5501/etc faltando.
function BiosDeepScanCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true); setMsg({ kind: "info", text: t("Varrendo storage do celular... (30s-2min)") });
    try {
      const n = await invoke("bios_deep_scan");
      if (n > 0) setMsg({ kind: "ok", text: t("Importei {n} BIOS pra Ludex/system/.", { n }) });
      else setMsg({ kind: "warn", text: t("Não achei nenhum .bin com nome de BIOS conhecida. Coloque na pasta Download ou Ludex/system/ manualmente.") });
    } catch (e) {
      setMsg({ kind: "error", text: t("Falha: {err}", { err: e }) });
    } finally {
      setBusy(false);
    }
  }, [busy]);
  return (
    <section className="lmx-settings-card" data-tour="settings-bios">
      <div className="lmx-settings-label">{t("BIOS dos emuladores")}</div>
      <p className="lmx-settings-hint">
        {t("PS1, PS2, Dreamcast, Saturn e 3DO precisam de BIOS pra rodar. Sem ela, o emulador trava ao abrir. Coloque seus .bin em Download e clique abaixo — o app varre o celular inteiro e copia tudo certinho.")}
      </p>
      <button className="lmx-settings-btn primary" onClick={run} disabled={busy} style={{ marginTop: 8 }}>
        {busy ? t("Procurando...") : t("Procurar BIOS no celular inteiro")}
      </button>
      {msg && (
        <p className={`lmx-settings-msg ${msg.kind}`} style={{ marginTop: 8 }}>{msg.text}</p>
      )}
    </section>
  );
}

function SettingsTab({ activeProfile, androidDemo, onAdminUnlock, onPickFolder, currentRomsRoot, config, onConfigChange, appTheme, onSetTheme, onRestartTutorial }) {
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
        setMsg({ kind: "ok", text: t("Destravado! Demo removida.") });
        setShowKeyInput(false);
        setKeyInput("");
      } else {
        setMsg({ kind: "error", text: t("License não destravou (não é admin)") });
      }
    } catch (e) {
      setMsg({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lmx-settings" data-tour="tab-settings">
      <header className="lmx-page-header">
        <h1>{t("Ajustes")}</h1>
      </header>

      <section className="lmx-settings-card" data-tour="settings-profile">
        <div className="lmx-settings-row">
          <div>
            <div className="lmx-settings-label">{t("Perfil ativo")}</div>
            <div className="lmx-settings-value">{activeProfile?.name || "—"}</div>
          </div>
        </div>
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">{t("Idioma")}</div>
        <div className="lmx-lang-row">
          {LANGUAGES.map((lng) => (
            <button
              key={lng.code}
              className={`lmx-lang-btn ${getLanguage() === lng.code ? "on" : ""}`}
              onClick={() => { setLanguage(lng.code); sfx.confirm(); haptic(8); }}
              aria-label={lng.label}
            >
              <span className="lmx-lang-flag">{lng.flag}</span>
              <span className="lmx-lang-name">{lng.label}</span>
            </button>
          ))}
        </div>
      </section>

      <ExternalControllerCard />

      <BiosDeepScanCard />

      <section className="lmx-settings-card" data-tour="settings-theme">
        <div className="lmx-settings-label">{t("Tema do app")}</div>
        <div className="lmx-theme-grid">
          {APP_THEMES.map(([id, lbl]) => (
            <button
              key={id}
              className={`lmx-theme-chip ${appTheme === id ? "on" : ""}`}
              data-theme={id}
              onClick={() => onSetTheme && onSetTheme(id)}
            >
              <span className="lmx-theme-swatch" />
              <span className="lmx-theme-name">{t(lbl)}</span>
            </button>
          ))}
        </div>
      </section>

      {androidDemo && (
        <section className="lmx-settings-card">
          <div className="lmx-settings-row">
            <div>
              <div className="lmx-settings-label">{t("Status da licença")}</div>
              <div className="lmx-settings-value">
                {androidDemo.is_admin_unlocked
                  ? t("Admin desbloqueado (vitalício)")
                  : androidDemo.days_left > 0
                    ? (androidDemo.days_left === 1 ? t("Demo: {n} dia restante", { n: androidDemo.days_left }) : t("Demo: {n} dias restantes", { n: androidDemo.days_left }))
                    : t("Demo expirada")}
              </div>
            </div>
          </div>
          {!androidDemo.is_admin_unlocked && (
            <>
              <button className="lmx-settings-btn primary" onClick={() => invoke("open_url", { url: "https://pauloadriel98.gumroad.com/l/ludex" }).catch(() => {})}>
                {t("Comprar versão Windows (R$ 49,90)")}
              </button>
              {!showKeyInput ? (
                <button className="lmx-settings-btn ghost" onClick={() => setShowKeyInput(true)}>
                  {t("Sou admin / tenho license")}
                </button>
              ) : (
                <div className="lmx-settings-key">
                  <input
                    type="text"
                    placeholder={t("Cole sua license key")}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    autoFocus
                    disabled={busy}
                  />
                  <button className="lmx-settings-btn primary" onClick={tryUnlock} disabled={busy || !keyInput.trim()}>
                    {busy ? t("Verificando...") : t("Destravar")}
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

      {/* v0.9.34: re-abrir tutorial */}
      <section className="lmx-settings-card" data-tour="settings-tutorial">
        <div className="lmx-settings-label">{t("Tutorial")}</div>
        <p className="lmx-settings-hint">
          {t("Ver o passo a passo de cada função do app de novo (com destaque visual em cada elemento).")}
        </p>
        <button
          className="lmx-settings-btn ghost"
          onClick={() => onRestartTutorial && onRestartTutorial()}
          style={{ marginTop: 8 }}
        >
          {t("Ver tutorial novamente")}
        </button>
      </section>

      <section className="lmx-settings-card" data-tour="settings-folder">
        <div className="lmx-settings-label">{t("Pasta de ROMs")}</div>
        <div className="lmx-settings-paths">
          <code>{currentRomsRoot || t("(padrão: /storage/emulated/0/Ludex/roms/)")}</code>
        </div>
        <button className="lmx-settings-btn primary" onClick={onPickFolder}>
          {t("Escolher pasta no celular")}
        </button>
        <p className="lmx-settings-hint">
          {t("Após escolher, o Ludex varre subpastas automaticamente. Cada sistema aparece quando você tem ROMs com extensão reconhecida (snes, gba, gb, iso, etc).")}
        </p>
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">{t("BIOS, Mods e Traduções")}</div>
        <div className="lmx-settings-paths">
          <div><strong>{t("BIOS:")}</strong> <code>Ludex/system/</code> (Saturn/PSP/PS1/Dreamcast)</div>
          <div><strong>{t("Saves:")}</strong> <code>Ludex/saves-libretro/</code></div>
          <div><strong>{t("Mods/traduções:")}</strong> <code>Ludex/mods/&lt;sistema&gt;/</code></div>
        </div>
        <button className="lmx-settings-btn primary" onClick={async () => {
          // v0.9.5: abrir uma pasta especifica e instavel entre gerenciadores de
          // arquivos do Android. Tenta abrir, mas SEMPRE mostra o caminho como
          // fallback (antes falhava em silencio = "não funciona").
          const base = await invoke("android_ludex_base_path").catch(() => "/storage/emulated/0/Ludex");
          let opened = false;
          try { await invoke("android_open_folder", { absPath: base }); opened = true; } catch {}
          if (!opened) {
            await mAlert(
              t("Abra o app de Arquivos (Meus Arquivos) do seu celular e vá até:\n\n{base}\n\nColoque BIOS em {base}/system/ e mods em {base}/mods/<sistema>/", { base })
            );
          }
        }}>
          {t("Abrir pasta Ludex no Files")}
        </button>
        <p className="lmx-settings-hint">
          {t("Coloca BIOS na pasta system/. Mods/traduções do mesmo jeito que no Windows: renomeia o ROM ou patcha antes de colocar em roms/.")}
        </p>
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">{t("Atualização")}</div>
        <UpdateChecker />
      </section>

      {/* v0.9.1: paridade com Windows - profiles + stats + sources + logs + music MP3 */}
      <ProfileSwitcherCard config={config} activeProfile={activeProfile} onConfigChange={onConfigChange} />
      <StatsDashboardCard />
      <SourcesGuideCard />
      <LogsViewerCard />
      <WhyWindowsCard />
      <AchievementsCard />
      <ChildModeCard />
      <AmbientMusicToggle />
      <BackupRestoreCard />

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">{t("Sons")}</div>
        <SoundToggle />
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">{t("Sobre")}</div>
        <div className="lmx-settings-value">{t("Ludex Android v{v}", { v: "0.8.23" })}</div>
        <p className="lmx-settings-hint">
          {t("A versão Windows tem auto-update, gamepad nativo, todos os sistemas embedded + Switch/Wii U/PS3/Xbox 360/PS Vita via emulador externo.")}
        </p>
      </section>
    </div>
  );
}

// ============================================================
// === SYSTEM SCREEN (grid de jogos do sistema selecionado) ===
// ============================================================
function SystemScreen({ system, covers, onBack, onPickGame, onPickFolder, onPickSystemFolder, currentSystemFolder }) {
  const [guideOpen, setGuideOpen] = useState(false); // v0.9.15: sites por sistema
  // v1.0: render progressivo do grid (bibliotecas grandes não pintam tudo de uma vez)
  const GRID_PAGE = 120;
  const [renderLimit, setRenderLimit] = useState(GRID_PAGE);
  const gridSentinelRef = useRef(null);
  useEffect(() => { setRenderLimit(GRID_PAGE); }, [system.id]);
  useEffect(() => {
    const el = gridSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setRenderLimit((l) => l + GRID_PAGE); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [system.games.length, renderLimit]);
  const showInstallGuide = useCallback(() => {
    mAlert(
      t("Como colocar jogos de {name} no Ludex:", { name: system.name }) + "\n\n" +
      t("1) Baixe a ROM no celular (veja 'Onde baixar' aqui embaixo).") + "\n" +
      t("2) Coloque o arquivo na pasta de ROMs (geral ou a pasta só deste sistema).") + "\n" +
      t("3) Volte aqui — o Ludex detecta pela extensão (ex: .gba, .sfc, .nes, .z64).") + "\n" +
      t("4) Traduções/hacks: aplique o patch na ROM antes (ou use a ROM já traduzida).") + "\n" +
      t("5) BIOS (Saturn/PSP/PS1/Dreamcast): pasta Ludex/system/.") + "\n\n" +
      t("Use jogos que você possui.")
    );
  }, [system.name]);
  return (
    <div className="lmx-systemview">
      <header className="lmx-page-header has-back">
        <button className="lmx-back-btn" onClick={onBack}><IconArrowLeft /></button>
        <div className="lmx-systemview-title-wrap">
          <div className="lmx-systemview-icon" style={{ background: system.color }}><SysGlyph id={system.id} /></div>
          <div>
            <h1>{system.name}</h1>
            <div className="lmx-systemview-count">{system.games.length === 1 ? t("{n} jogo", { n: system.games.length }) : t("{n} jogos", { n: system.games.length })}</div>
          </div>
        </div>
        {/* v0.9.15: guia de download (sites de ROMs/traducoes/mods) por sistema */}
        <button className="lmx-sysfolder-btn" onClick={() => { sfx.confirm(); setGuideOpen(true); }} title={t("Onde baixar jogos / traduções")} aria-label={t("Onde baixar")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </button>
        {/* v0.9.5: pasta exclusiva deste sistema */}
        {onPickSystemFolder && (
          <button className="lmx-sysfolder-btn" onClick={onPickSystemFolder} title={t("Escolher pasta só deste sistema")} aria-label={t("Pasta deste sistema")}>
            <IconFolder withRoms={!!currentSystemFolder} />
          </button>
        )}
      </header>
      {currentSystemFolder && (
        <div className="lmx-sysfolder-bar">
          <span>{t("Pasta deste sistema:")} <code>{currentSystemFolder}</code></span>
          <button onClick={onPickSystemFolder}>{t("Trocar")}</button>
        </div>
      )}
      {system.games.length === 0 ? (
        <div className="lmx-empty-state">
          <div className="lmx-empty-icon"><IconGrid /></div>
          <h2>{t("Sem jogos de {name}", { name: system.name })}</h2>
          <p>
            {t("Escolha uma pasta SÓ pra {name} — assim cada emulador pode ter a sua. O Ludex detecta as ROMs pela extensão.", { name: system.name })}
          </p>
          {onPickSystemFolder && (
            <button className="lmx-settings-btn primary" onClick={onPickSystemFolder} style={{ maxWidth: 280, margin: "16px auto 8px" }}>
              {t("Escolher pasta de {name}", { name: system.name })}
            </button>
          )}
          {onPickFolder && (
            <button className="lmx-settings-btn ghost" onClick={onPickFolder} style={{ maxWidth: 280, margin: "0 auto" }}>
              {t("Usar a pasta geral de ROMs")}
            </button>
          )}
          <div style={{ display: "flex", gap: 8, maxWidth: 280, margin: "16px auto 0" }}>
            <button className="lmx-settings-btn ghost" onClick={showInstallGuide} style={{ flex: 1, marginTop: 0 }}>
              {t("Como instalar")}
            </button>
            <button className="lmx-settings-btn primary" onClick={() => { sfx.confirm(); setGuideOpen(true); }} style={{ flex: 1, marginTop: 0 }}>
              {t("Onde baixar")}
            </button>
          </div>
        </div>
      ) : (
        <>
        <div className="lmx-systemview-grid">
          {system.games.slice(0, renderLimit).map((g) => (
            <GameCard
              key={g.path}
              system={system}
              game={g}
              coverSrc={covers[g.path]}
              onClick={() => onPickGame(g)}
            />
          ))}
        </div>
        {renderLimit < system.games.length && (
          <div ref={gridSentinelRef} aria-hidden style={{ height: 1, width: "100%" }} />
        )}
        </>
      )}
      <SuggestionsModal open={guideOpen} onClose={() => setGuideOpen(false)} defaultTab="roms" />
    </div>
  );
}

// ============================================================
// === GAME DETAIL SCREEN (full screen) =======================
// ============================================================
function GameDetailScreen({ system, game, coverSrc, onClose, onLaunch }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  // v0.9.3: nota (estrelas), acesso ao arquivo e mods (paridade com PC)
  const [rating, setRating] = useState(game.rating || 0);
  const [modCount, setModCount] = useState(null);
  const modsDir = `/storage/emulated/0/Ludex/mods/${system.id}`;
  const gameDir = String(game.path || "").replace(/[\\/][^\\/]+$/, "") || game.path;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    setRating(game.rating || 0);
    (async () => {
      try {
        const d = await invoke("fetch_game_details", { systemId: system.id, gameName: game.name });
        if (!cancelled) setDetails(d);
      } catch {}
      // conta mods do sistema (pasta Ludex/mods/<sistema>)
      try {
        const listing = await invoke("list_dir", { path: modsDir });
        if (!cancelled) setModCount((listing?.entries || []).filter(e => !e.is_dir).length);
      } catch { if (!cancelled) setModCount(0); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [system.id, game.path, game.name]);

  const setStars = async (n) => {
    setRating(n);
    sfx.confirm(); haptic(8);
    try { await invoke("set_game_rating", { systemId: system.id, romPath: game.path, rating: n }); } catch {}
  };
  const openGameFolder = async () => {
    try { await invoke("android_open_folder", { absPath: gameDir }); }
    catch (e) { mAlert(t("Não consegui abrir a pasta: {e}", { e })); }
  };
  const openModsFolder = async () => {
    try { await invoke("android_open_folder", { absPath: modsDir }); }
    catch (e) { mAlert(t("Não consegui abrir a pasta de mods: {e}", { e })); }
  };

  const heroSrc = details?.cover_path ? convertFileSrc(details.cover_path) : coverSrc;
  const youtubeId = details?.vídeos?.[0]?.youtube_id;
  const summary = details?.summary || details?.storyline || "";

  return (
    <div className="lmx-detail">
      <button className="lmx-detail-close" onClick={onClose} aria-label={t("Voltar")}><IconArrowLeft /></button>

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
        {/* v0.9.6: nota de usuários externos (IGDB, 0-100) — paridade com PC */}
        {details?.rating != null && (
          <div className="lmx-detail-webrating">
            <span className="lmx-detail-webrating-score">{Math.round(details.rating)}</span>
            <span className="lmx-detail-webrating-label">{t("Nota web")}<br />{t("(usuários IGDB)")}</span>
          </div>
        )}

        <button className="lmx-detail-play" onClick={onLaunch}>
          <IconPlay /> {t("JOGAR")}
        </button>

        {/* v0.9.3: nota do usuário (estrelas) */}
        <div className="lmx-detail-rating">
          <span className="lmx-detail-rating-label">{t("Sua nota")}</span>
          <div className="lmx-detail-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={"lmx-detail-star" + (n <= rating ? " on" : "")} onClick={() => setStars(n === rating ? 0 : n)} aria-label={t("{n} estrelas", { n })}>
                <IconStar filled={n <= rating} />
              </button>
            ))}
          </div>
        </div>

        {/* v0.9.3: arquivo + mods (acesso direto pela tela do jogo) */}
        <div className="lmx-detail-files">
          <button className="lmx-detail-filebtn" onClick={openGameFolder}>
            <IconFolder withRoms={false} />
            <span>{t("Abrir pasta do jogo")}</span>
          </button>
          <button className="lmx-detail-filebtn" onClick={openModsFolder}>
            <IconFolder withRoms={modCount > 0} />
            <span>{modCount != null ? t("Mods ({n})", { n: modCount }) : t("Mods")}</span>
          </button>
        </div>
        <p className="lmx-detail-files-hint">
          {t("Coloque traduções/hacks em Ludex/mods/{id}/ — renomeie ou aplique o patch na ROM antes de jogar.", { id: system.id })}
        </p>

        {loading && <div className="lmx-detail-loading">{t("Buscando info...")}</div>}
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
// === FOLDER BROWSER MODAL (v0.9.2) ==========================
// Navegador de arquivos REAL: o user percorre o armazenamento do celular
// (o app tem MANAGE_EXTERNAL_STORAGE, entao list_dir no Rust le tudo).
// Antes era uma lista fixa "engessada"; agora tem breadcrumb, atalhos e
// contagem de ROMs por pasta. ============================================
const QUICK_SHORTCUTS = [
  { path: "/storage/emulated/0", label: "Início" },
  { path: "/storage/emulated/0/Download", label: "Download" },
  { path: "/storage/emulated/0/Ludex/roms", label: "Ludex" },
  { path: "/storage/emulated/0/RetroArch/roms", label: "RetroArch" },
];

const IconFolder = ({ withRoms }) => (
  <svg viewBox="0 0 24 24" fill={withRoms ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);
const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const IconUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

// v0.9.4: mode="folder" (escolher pasta de ROMs) | "image" (escolher foto de perfil).
// Em image mode, arquivos de imagem ficam CLICAVEIS e onPick recebe o caminho do arquivo.
const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|heic)$/i;
const IMG_SHORTCUTS = [
  { path: "/storage/emulated/0/DCIM/Camera", label: "Câmera" },
  { path: "/storage/emulated/0/Pictures", label: "Fotos" },
  { path: "/storage/emulated/0/Download", label: "Download" },
  { path: "/storage/emulated/0", label: "Início" },
];

function FolderPickerModal({ onClose, onPick, mode = "folder", title }) {
  const isImage = mode === "image";
  const [cwd, setCwd] = useState(null);
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async (path) => {
    setLoading(true); setErr(null);
    try {
      const res = await invoke("list_dir", { path: path || null });
      setListing(res);
      setCwd(res.path);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(isImage ? "/storage/emulated/0/DCIM/Camera" : null); }, [load, isImage]);

  const folders = (listing?.entries || []).filter((e) => e.is_dir);
  const files = (listing?.entries || []).filter((e) => !e.is_dir);
  const romsHere = files.filter((f) => /\.(zip|7z|chd|iso|bin|cue|nes|sfc|smc|gba|gb|gbc|n64|z64|nds|3ds|gcm|rvz|wbfs|iso|cso|pbp|md|gen|smd|pce|ws|wsc|ngp|gg|sms)$/i.test(f.name)).length;

  // breadcrumb a partir do cwd
  const crumbs = [];
  if (cwd) {
    const parts = cwd.split("/").filter(Boolean);
    let acc = cwd.startsWith("/") ? "" : ".";
    for (const p of parts) {
      acc += "/" + p;
      crumbs.push({ label: p, path: acc });
    }
  }

  return (
    <div className="lmx-sheet-backdrop" onClick={onClose}>
      <div className="lmx-folder-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="lmx-sheet-handle" />
        <div className="lmx-sheet-header">
          <h3>{title || (isImage ? t("Escolher foto") : t("Escolher pasta de ROMs"))}</h3>
          <button className="lmx-back-btn" onClick={onClose} aria-label={t("Fechar")}><IconClose /></button>
        </div>

        {/* Atalhos rapidos */}
        <div className="lmx-fb-shortcuts">
          {(isImage ? IMG_SHORTCUTS : QUICK_SHORTCUTS).map((s) => (
            <button key={s.path} className="lmx-fb-chip" onClick={() => load(s.path)}>{t(s.label)}</button>
          ))}
        </div>

        {/* Breadcrumb + subir */}
        <div className="lmx-fb-bar">
          <button
            className="lmx-fb-up"
            disabled={!listing?.parent}
            onClick={() => listing?.parent && load(listing.parent)}
            aria-label={t("Subir um nível")}
          ><IconUp /></button>
          <div className="lmx-fb-crumbs">
            {crumbs.length === 0 ? <span className="lmx-fb-crumb">/</span> : crumbs.map((c, i) => (
              <span key={c.path} className="lmx-fb-crumb-wrap">
                {i > 0 && <span className="lmx-fb-sep">/</span>}
                <button className="lmx-fb-crumb" onClick={() => load(c.path)}>{t(c.label)}</button>
              </span>
            ))}
          </div>
        </div>

        {/* Conteudo */}
        <div className="lmx-fb-list">
          {loading && <div className="lmx-fb-status">{t("Carregando…")}</div>}
          {err && <div className="lmx-fb-status lmx-fb-err">{err}</div>}
          {!loading && !err && folders.length === 0 && files.length === 0 && (
            <div className="lmx-fb-status">{t("Pasta vazia")}</div>
          )}
          {!loading && !err && folders.map((f) => (
            <button key={f.path} className="lmx-fb-item" onClick={() => load(f.path)}>
              <span className={"lmx-fb-icon" + (f.rom_count > 0 ? " has-roms" : "")}><IconFolder withRoms={f.rom_count > 0} /></span>
              <span className="lmx-fb-name">{f.name}</span>
              {f.rom_count > 0 && <span className="lmx-fb-badge">{f.rom_count > 1 ? t("{n} ROMs", { n: f.rom_count }) : t("{n} ROM", { n: f.rom_count })}</span>}
            </button>
          ))}
          {!loading && !err && files.map((f) => {
            const pickable = isImage && IMG_RE.test(f.name);
            if (pickable) {
              return (
                <button key={f.path} className="lmx-fb-item" onClick={() => onPick(f.path)}>
                  <span className="lmx-fb-thumb"><img src={convertFileSrc(f.path)} alt="" loading="lazy" /></span>
                  <span className="lmx-fb-name">{f.name}</span>
                </button>
              );
            }
            return (
              <div key={f.path} className="lmx-fb-item lmx-fb-file">
                <span className="lmx-fb-icon"><IconFile /></span>
                <span className="lmx-fb-name">{f.name}</span>
              </div>
            );
          })}
        </div>

        {/* Acao: usar pasta atual (so no modo pasta) */}
        {isImage ? (
          <div className="lmx-fb-footer">
            <div className="lmx-fb-foundhint">{t("Toque numa imagem para usar como foto")}</div>
          </div>
        ) : (
          <div className="lmx-fb-footer">
            {romsHere > 0 && (
              <div className="lmx-fb-foundhint">{romsHere > 1 ? t("{n} ROMs nesta pasta", { n: romsHere }) : t("{n} ROM nesta pasta", { n: romsHere })}</div>
            )}
            <button
              className="lmx-settings-btn primary"
              disabled={!cwd || loading}
              onClick={() => onPick(cwd)}
            >
              {t("Usar esta pasta")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// v0.9.4: src da imagem do perfil — foto custom (photo_path) OU avatar SVG.
function profileImgSrc(profile, bust) {
  if (profile?.photo_path) {
    try { return convertFileSrc(profile.photo_path) + (bust ? "?v=" + bust : ""); } catch {}
  }
  const av = DEFAULT_AVATARS.find(a => a.id === profile?.avatar_id) || DEFAULT_AVATARS[0];
  return avatarUrl(av);
}

// ============================================================
// === PROFILE EDITOR MODAL (v0.9.4) ==========================
// Editor de perfil DIRETO (abre tocando no avatar da home): trocar FOTO de
// verdade (picker de imagem), nome e avatar. Antes não tinha como trocar foto
// nem o nome era fácil de achar — Paulo pediu varias vezes.
function ProfileEditorModal({ config, activeProfile, onConfigChange, onClose }) {
  const [name, setName] = useState(activeProfile?.name || "");
  const [avatarId, setAvatarId] = useState(activeProfile?.avatar_id || DEFAULT_AVATARS[0].id);
  const [photoPath, setPhotoPath] = useState(activeProfile?.photo_path || null);
  const [bust, setBust] = useState(0);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const onPickImage = async (srcPath) => {
    setPicking(false); setBusy(true); setMsg(null);
    try {
      const saved = await invoke("save_profile_photo_from_path", { profileId: activeProfile.id, sourcePath: srcPath });
      setPhotoPath(saved); setBust((v) => v + 1);
      setMsg({ kind: "ok", text: t("Foto pronta. Toque em Salvar.") });
    } catch (e) {
      setMsg({ kind: "error", text: t("Falha na foto: {e}", { e: String(e) }) });
    } finally { setBusy(false); }
  };

  const removePhoto = async () => {
    try { await invoke("delete_profile_photo", { profileId: activeProfile.id }); } catch {}
    setPhotoPath(null); setBust((v) => v + 1);
  };

  const save = async () => {
    const n = name.trim();
    if (n.length < 2) { setMsg({ kind: "error", text: t("Nome muito curto (mínimo 2 letras)") }); return; }
    const updated = {
      ...config,
      profiles: (config.profiles || []).map(p => p.id === activeProfile.id ? { ...p, name: n, avatar_id: avatarId, photo_path: photoPath || null } : p),
    };
    setBusy(true);
    try {
      await invoke("save_config", { config: updated });
      onConfigChange && onConfigChange(updated);
      sfx.confirm(); haptic(12);
      onClose();
    } catch (e) {
      setMsg({ kind: "error", text: t("Falha ao salvar: {e}", { e: String(e) }) });
      setBusy(false);
    }
  };

  if (picking) {
    return <FolderPickerModal mode="image" title={t("Escolher foto do perfil")} onClose={() => setPicking(false)} onPick={onPickImage} />;
  }

  const previewSrc = photoPath
    ? convertFileSrc(photoPath) + "?v=" + bust
    : avatarUrl(DEFAULT_AVATARS.find(a => a.id === avatarId) || DEFAULT_AVATARS[0]);

  return (
    <div className="lmx-sheet-backdrop" onClick={onClose}>
      <div className="lmx-folder-sheet" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "calc(24px + var(--lmx-safe-bottom))" }}>
        <div className="lmx-sheet-handle" />
        <div className="lmx-sheet-header">
          <h3>{t("Editar perfil")}</h3>
          <button className="lmx-back-btn" onClick={onClose} aria-label={t("Fechar")}><IconClose /></button>
        </div>
        <div style={{ padding: "4px 18px 0", overflowY: "auto" }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <img src={previewSrc} alt="" style={{ width: 96, height: 96, borderRadius: 26, objectFit: "cover", border: "2px solid rgba(124,92,255,0.55)", background: "rgba(0,0,0,0.3)" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
              <button className="lmx-settings-btn primary" onClick={() => setPicking(true)} disabled={busy} style={{ width: "auto", padding: "9px 18px" }}>{t("Escolher foto")}</button>
              {photoPath && <button className="lmx-settings-btn ghost" onClick={removePhoto} style={{ width: "auto", padding: "9px 18px" }}>{t("Remover")}</button>}
            </div>
          </div>
          <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>{t("Nome")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={28} placeholder={t("Seu nome")} autoFocus
            style={{ width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(124,92,255,0.4)", color: "#fff", padding: "11px 13px", borderRadius: 9, fontSize: 15, boxSizing: "border-box", marginBottom: 14 }} />
          {!photoPath && (
            <>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>{t("Ou um avatar")}</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, marginBottom: 14 }}>
                {DEFAULT_AVATARS.map(a => (
                  <button key={a.id} onClick={() => setAvatarId(a.id)} style={{ aspectRatio: "1/1", borderRadius: 8, border: `2px solid ${avatarId === a.id ? "#fff" : "transparent"}`, padding: 0, overflow: "hidden", background: "rgba(0,0,0,0.3)" }}>
                    <img src={avatarUrl(a)} alt="" style={{ width: "100%", height: "100%", display: "block" }} />
                  </button>
                ))}
              </div>
            </>
          )}
          {msg && <p className={`lmx-settings-msg ${msg.kind}`}>{msg.text}</p>}
          <button className="lmx-settings-btn primary" onClick={save} disabled={busy} style={{ marginTop: 4 }}>{busy ? t("Salvando...") : t("Salvar")}</button>
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
        setMsg({ kind: "error", text: t("License não é admin") });
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
        <h1>{t("Demo expirou")}</h1>
        <p>
          {t("Você usou os {n} dias da versão Android gratuita. Pra continuar, compre a versão Windows.", { n: demo.demo_days_total })}
        </p>
        <button className="lmx-settings-btn primary" onClick={() => invoke("open_url", { url: "https://pauloadriel98.gumroad.com/l/ludex" }).catch(() => {})}>
          {t("Comprar Windows (R$ 49,90)")}
        </button>
        {!showKeyInput ? (
          <button className="lmx-settings-btn ghost" onClick={() => setShowKeyInput(true)}>
            {t("Sou admin / tenho license")}
          </button>
        ) : (
          <div className="lmx-settings-key">
            <input
              type="text"
              placeholder={t("Cole sua license key")}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoFocus
              disabled={busy}
            />
            <button className="lmx-settings-btn primary" onClick={tryUnlock} disabled={busy || !keyInput.trim()}>
              {busy ? t("Verificando...") : t("Destravar")}
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
// Cada sistema mostra SO os botões que ele realmente usa, com label correto.
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
  n64:  { face: [{id:9,label:"C↑",color:"y"},{id:1,label:"C←",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:13,label:"C↓",color:"y"},{id:14,label:"C→",color:"y"}], shoulders: ["Z","R"], selectStart: ["", "START"], analog: true },
  // ---- Sega Genesis / Master System / GG ----
  md:     { face: [{id:1,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:8,label:"C",color:"y"},{id:9,label:"X",color:"x"},{id:10,label:"Y",color:"y"},{id:11,label:"Z",color:"y"}], shoulders: false, selectStart: ["MODE","START"] },
  sms:    { face: [{id:0,label:"1",color:"b"},{id:8,label:"2",color:"a"}], shoulders: false, selectStart: ["","START"] },
  gg:     { face: [{id:0,label:"1",color:"b"},{id:8,label:"2",color:"a"}], shoulders: false, selectStart: ["","START"] },
  segacd: { face: [{id:1,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:8,label:"C",color:"y"}], shoulders: false, selectStart: ["MODE","START"] },
  // ---- Sega Dreamcast / Saturn ----
  dreamcast: { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"}], shoulders: ["L","R"], selectStart: ["","START"], analog: true },
  saturn:    { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:11,label:"Z",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:10,label:"C",color:"y"}], shoulders: false, selectStart: ["","START"] },
  // ---- Sony PS1/PS2: triangle/square/circle/cross ----
  ps1: { face: [{id:9,label:"△",color:"y"},{id:1,label:"□",color:"x"},{id:8,label:"◯",color:"a"},{id:0,label:"✕",color:"b"}], shoulders: ["L1","R1","L2","R2"], selectStart: true, analog: true },
  ps2: { face: [{id:9,label:"△",color:"y"},{id:1,label:"□",color:"x"},{id:8,label:"◯",color:"a"},{id:0,label:"✕",color:"b"}], shoulders: ["L1","R1","L2","R2"], selectStart: true, analog: true },
  psp: { face: [{id:9,label:"△",color:"y"},{id:1,label:"□",color:"x"},{id:8,label:"◯",color:"a"},{id:0,label:"✕",color:"b"}], shoulders: ["L","R"], selectStart: true, analog: true },
  // ---- Nintendo GameCube / Wii ----
  gc:  { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:13,label:"Z",color:"y"}], shoulders: ["L","R"], selectStart: ["","START"], analog: true },
  wii: { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"},{id:13,label:"Z",color:"y"}], shoulders: ["L","R"], selectStart: true, analog: true },
  // ---- 3DS / DS ----
  ds:  { face: [{id:9,label:"X",color:"x"},{id:1,label:"Y",color:"y"},{id:8,label:"A",color:"a"},{id:0,label:"B",color:"b"}], shoulders: ["L","R"], selectStart: true },
  // ---- TG-16/PCE: 2 botões ----
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

// v0.9.13: preferencias GLOBAIS do controle virtual (vibracao, esconder com
// gamepad, tema/skin, escala global e por grupo). Itens 5/6/7/9 do Paulo.
const CONTROL_PREFS_KEY = "ludex.controlPrefs.v1";
const CONTROL_THEMES = [
  ["default", "Padrão (roxo)"],
  ["mono", "Mono (vidro)"],
  ["nintendo", "Nintendo"],
  ["sony", "Sony"],
  ["xbox", "Xbox"],
];
const DEFAULT_CONTROL_PREFS = {
  vibration: true,
  hideWhenGamepad: true,
  theme: "default",
  scale: 1,
  groupScale: { dpad: 1, face: 1, shoulders: 1, system: 1, analog: 1 },
};
// v0.9.13: temas do app (paridade com o launcher do PC). Aplicado via data-theme.
const APP_THEMES = [
  ["roxo", "Roxo (padrão)"],
  ["switch-dark", "Switch Dark"],
  ["ps3-wave", "PS3 Wave"],
  ["sunset", "Sunset"],
  ["forest", "Forest"],
  ["light", "Pure Light"],
];
const APP_THEME_KEY = "ludex.appTheme.v1";
function loadAppTheme() {
  try { return localStorage.getItem(APP_THEME_KEY) || "roxo"; } catch { return "roxo"; }
}
function saveAppTheme(id) {
  try { localStorage.setItem(APP_THEME_KEY, id); } catch {}
}

function loadControlPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(CONTROL_PREFS_KEY) || "{}");
    return { ...DEFAULT_CONTROL_PREFS, ...p, groupScale: { ...DEFAULT_CONTROL_PREFS.groupScale, ...(p.groupScale || {}) } };
  } catch { return { ...DEFAULT_CONTROL_PREFS }; }
}
function saveControlPrefs(prefs) {
  try { localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

// v0.9.10: portateis de 2 telas (DS/3DS) — atalho de layout DIRETO no menu in-game,
// aplicado AO VIVO (libretro_set_option seta OPTIONS_DIRTY -> core re-le na hora).
// Os mesmos keys/values do SystemSettingsModal, mas com label PT e 1 toque. Cobre o
// pedido do Paulo: tela de cima/baixo como principal, lado a lado, ou uma menor no canto.
// v0.9.20: SCREEN_LAYOUTS movido pra ludexSystemOptions.js (compartilhado com
// LudexLauncher PC) — importado acima junto com applySystemOptions.

function MobileEmulatorView({ system, game, onClose }) {
  const layout = SYSTEM_LAYOUTS[system.id] || DEFAULT_LAYOUT;
  const [menuOpen, setMenuOpen] = useState(false);
  const [cheatsOpen, setCheatsOpen] = useState(false);
  const [emuSettingsOpen, setEmuSettingsOpen] = useState(false); // v0.8.38: settings in-game
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
  // Edit mode + offsets custom dos grupos de botões (dpad, face, system, shoulders)
  const [editMode, setEditMode] = useState(false);
  const [offsets, setOffsets] = useState(() => loadCustomLayout(system.id) || {});
  const dragState = useRef(null);
  // v0.9.13: preferencias do controle virtual (vibracao/esconder-com-gamepad/tema/escala)
  const [ctrlPrefs, setCtrlPrefs] = useState(loadControlPrefs);
  const ctrlPrefsRef = useRef(ctrlPrefs);
  useEffect(() => { ctrlPrefsRef.current = ctrlPrefs; }, [ctrlPrefs]);
  const updateCtrlPrefs = useCallback((patch) => {
    setCtrlPrefs((prev) => { const next = { ...prev, ...patch }; saveControlPrefs(next); return next; });
  }, []);
  const setGroupScale = useCallback((key, delta) => {
    setCtrlPrefs((prev) => {
      const gs = { ...prev.groupScale, [key]: Math.max(0.6, Math.min(1.6, (prev.groupScale[key] || 1) + delta)) };
      const next = { ...prev, groupScale: gs }; saveControlPrefs(next); return next;
    });
  }, []);
  // Sleep timer: pausa core se sem input por X min (v0.8.22)
  const lastInputRef = useRef(Date.now());
  const [autoPaused, setAutoPaused] = useState(false);
  // v0.9.12: fast-forward FRACIONARIO. ffSpeed travado = 1 / 1.25 / 1.5 / 2.
  // ffActive = turbo momentaneo (segurar o botão FF) -> sempre 2x.
  const [ffSpeed, setFfSpeed] = useState(1);
  const [ffActive, setFfActive] = useState(false);
  const ffEffectiveRef = useRef(1);
  useEffect(() => {
    ffEffectiveRef.current = ffActive ? Math.max(ffSpeed, 2) : ffSpeed;
  }, [ffActive, ffSpeed]);
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

  // v0.9.40 FIX dos controles: orientação detectada por JS (innerWidth vs height).
  // O @media (orientation: landscape) NÃO casa de forma confiável quando o app
  // força screen.orientation.lock('landscape') no S25 — então a CSS de portrait
  // era usada em landscape e os controles iam tudo pro topo, sobrepostos. Um
  // data-orient no root dirige a CSS de forma confiável.
  const [orient, setOrient] = useState(() =>
    (typeof window !== "undefined" && window.innerWidth >= window.innerHeight) ? "landscape" : "portrait");
  useEffect(() => {
    const update = () => setOrient(window.innerWidth >= window.innerHeight ? "landscape" : "portrait");
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const id = setInterval(update, 600); // alguns devices não disparam resize no lock forçado
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      clearInterval(id);
    };
  }, []);

  const groupStyle = useCallback((key) => {
    const o = offsets[key] || { x: 0, y: 0 };
    const sc = (ctrlPrefs.scale || 1) * (ctrlPrefs.groupScale?.[key] || 1);
    // v0.9.36: offsets do edit mode são salvos em portrait. Em landscape a
    // tela rotaciona 90°, então aplicar Ox/Oy original joga o face/dpad/etc
    // pra fora da tela visível (causa do "ordem enlouquece" + botões PS1/PS2
    // sem resposta — eles estavam invisíveis fora da viewport). Em landscape
    // ignoramos os offsets manuais e usamos só o scale.
    const isLandscape = orient === "landscape";
    const moved = !isLandscape && (o.x || o.y);
    if (!moved && sc === 1) return undefined;
    return { transform: `translate(${moved ? o.x : 0}px, ${moved ? o.y : 0}px) scale(${sc})` };
  }, [offsets, ctrlPrefs, orient]);
  const resetLayout = useCallback(() => {
    setOffsets({});
    saveCustomLayout(system.id, {});
  }, [system.id]);
  // v0.9.12: layout de telas DS/3DS aplicado via RELOAD LIMPO do core (preservando
  // progresso com save state temporario). O hot-reload de layout no melonDS/citra
  // as vezes so meia-aplica e DUPLICA a tela (bug que o Paulo viu no "Destaque cima").
  // Recarregar o core com a opção ja setada aplica o layout do zero, sem glitch.
  const [screenLayoutVals, setScreenLayoutVals] = useState(() => loadSystemOptions(system.id));
  const setCoreOptionLive = useCallback(async (key, value) => {
    const cur = { ...loadSystemOptions(system.id), [key]: value };
    saveSystemOptions(system.id, cur);
    setScreenLayoutVals(cur);
    setStateMsg(t("Aplicando layout..."));
    try {
      try { await invoke("libretro_save_state", { romPath: game.path, slot: 98 }); } catch {}
      await invoke("libretro_set_option", { key, value });
      try { await invoke("libretro_unload"); } catch {}
      try { await applySystemOptions(system.id); } catch {}
      const result = await invoke("libretro_load_game", { coreFilename: system.libretro_core, romPath: game.path });
      setInfo(result);
      audioRateRef.current = result.sample_rate || 32040;
      try { await invoke("libretro_load_state", { romPath: game.path, slot: 98 }); } catch {}
      setStateMsg(t("Layout aplicado"));
    } catch (e) {
      setStateMsg(t("Falha no layout: {e}", { e }));
    }
    setTimeout(() => setStateMsg(null), 1600);
  }, [system.id, game.path, system.libretro_core]);
  const canvasRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  // v0.9.11: animacao de boot do emulador. Fica visivel por no mínimo BOOT_MS E
  // ate o core+ROM carregarem (o que demorar mais) — cobre o "ecossistema" do
  // emulador carregando em celular fraco, sem flash de tela preta (pedido do Paulo).
  const BOOT_MS = 1500; // piso: some assim que o core carrega, mas nunca antes de 1.5s
  const [bootMinDone, setBootMinDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBootMinDone(true), BOOT_MS);
    return () => clearTimeout(t);
  }, []);
  const audioCtxRef = useRef(null);
  const audioNextTimeRef = useRef(0);
  const audioResumeCleanupRef = useRef(null); // v0.9.5: remove o listener de resume no unmount
  const audioRateRef = useRef(32040);
  const stoppedRef = useRef(false);

  // Carrega core + ROM
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const coreFile = system.libretro_core;
        if (!coreFile) { setError(t("Sistema \"{name}\" sem core libretro", { name: system.name })); return; }
        // v0.8.38: aplica opções salvas do user antes de carregar
        try { await applySystemOptions(system.id); } catch {}
        const result = await invoke("libretro_load_game", { coreFilename: coreFile, romPath: game.path });
        if (cancelled) return;
        setInfo(result);
        audioRateRef.current = result.sample_rate || 32040;
        // v0.9.2: re-aplica cheats salvos (habilitados) ao carregar
        try {
          const saved = loadGameCheats(system.id, game.path).filter((c) => c.enabled);
          if (saved.length) setTimeout(() => { applyGameCheats(saved).catch(() => {}); }, 400);
        } catch {}
        if (canvasRef.current) {
          canvasRef.current.width = result.base_width;
          canvasRef.current.height = result.base_height;
        }
        try {
          // v0.9.5: NAO forcar sampleRate do core no AudioContext. No Android,
          // se o device não suporta a taxa exata do core (ex: GBA 32768Hz), o
          // construtor lanca NotSupportedError -> ficava SEM SOM. Usa a taxa
          // padrão do device; o createBuffer abaixo usa a taxa do core e o
          // contexto faz o resample no playback.
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          await ctx.resume();
          audioCtxRef.current = ctx;
          audioNextTimeRef.current = ctx.currentTime + 0.05;
          // resume também em qualquer toque (autoplay policy do WebView Android)
          const resumeOnTouch = () => { ctx.resume().catch(() => {}); };
          window.addEventListener("pointerdown", resumeOnTouch, { capture: true });
          audioResumeCleanupRef.current = () => window.removeEventListener("pointerdown", resumeOnTouch, { capture: true });
        } catch (e) { console.warn("AudioContext", e); }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      stoppedRef.current = true;
      invoke("libretro_unload").catch(() => {});
      if (audioResumeCleanupRef.current) { try { audioResumeCleanupRef.current(); } catch {} audioResumeCleanupRef.current = null; }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
    };
  }, [system.id, game.path, system.libretro_core]);

  // Loop de frames — v0.9.9: PACING PELO RELOGIO DE AUDIO (igual ao desktop em
  // LudexEmulatorView.jsx), não por throttle de performance.now()/rAF. O loop antigo
  // gatava "1 frame por refresh" e, com o jank de IPC/render do WebView Android, a
  // producao de audio atrasava -> o buffer agendado esvaziava -> engasgo. Agora o
  // AudioContext.currentTime e o mestre: a cada tick medimos quanto audio ainda esta
  // no buffer (produzido - consumido) e rodamos quantos frames forem necessarios pra
  // repor ate TARGET_LATENCY, com catch-up via libretro_skip_frames. producedPerCh
  // conta o audio produzido MESMO MUTADO, entao o pacing não dispara sozinho.
  // Buffer-alvo um pouco maior que o desktop (0.10/0.22 vs 0.07/0.16) pra absorver a
  // latencia extra do WebView. NAO voltar a pautar por rAF (regra anti-stutter).
  useEffect(() => {
    if (!info) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const baseFps = info.fps || 60;
    const sampleRate = audioRateRef.current || info.sample_rate || 48000;
    const samplesPerFrame = sampleRate / baseFps;
    const TARGET_LATENCY = 0.10; // alvo de buffer agendado (s)
    const MAX_LATENCY    = 0.22; // teto: acima disso pausa a producao neste tick
    const MAX_FRAMES_PER_TICK = 12;

    let producedPerCh = 0; // samples/canal produzidos desde audioStart (conta mutado)
    let audioStart = null; // ctx.currentTime quando comecamos a produzir
    let lastFf = 1;
    let raf = null;
    // v0.9.12: modo desempenho (celular fraco) — renderiza video em 30fps mantendo
    // emulacao/audio em 60fps (descarta o RGBA grande nos ticks impares = menos IPC).
    const perfMode = loadSystemOptions(system.id).ludex_performance_mode === "enabled";
    let videoTick = 0;
    let ffLastTime = null; // relogio de parede pro FF fracionario
    let ffAccum = 0;       // frames fracionarios acumulados no FF

    function renderVideo(buf) {
      if (!buf || buf.byteLength < 8) return;
      const ab = buf.buffer ? buf.buffer : buf;
      const off = buf.byteOffset || 0;
      const view = new DataView(ab, off, buf.byteLength);
      const w = view.getUint32(0, true);
      const h = view.getUint32(4, true);
      const rgba = new Uint8ClampedArray(ab, off + 8, w * h * 4);
      if (w !== ctx.canvas.width || h !== ctx.canvas.height) {
        ctx.canvas.width = w; ctx.canvas.height = h;
      }
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
    }

    // Conta o audio pra pacing SEMPRE; so agenda playback se não estiver mutado.
    function postAudioI16(i16) {
      const frames = i16.length / 2;
      if (frames <= 0) return;
      producedPerCh += frames;
      const actx = audioCtxRef.current;
      if (!actx || mutedRef.current) return;
      const node = actx.createBuffer(2, frames, sampleRate);
      const L = node.getChannelData(0); const R = node.getChannelData(1);
      for (let i = 0; i < frames; i++) { L[i] = i16[i*2]/32768; R[i] = i16[i*2+1]/32768; }
      const src = actx.createBufferSource(); src.buffer = node; src.connect(actx.destination);
      const ct = actx.currentTime;
      if (audioNextTimeRef.current < ct) audioNextTimeRef.current = ct + 0.04; // reseed pos-underrun/unmute
      src.start(audioNextTimeRef.current);
      audioNextTimeRef.current += frames / sampleRate;
    }

    // Parseia o buffer combinado [video_len u32][video][audio] do run_frame_av.
    function applyAV(buf, renderThisTick) {
      if (!buf || buf.byteLength < 4) return;
      const ab = buf.buffer ? buf.buffer : buf;
      const base = buf.byteOffset || 0;
      const dv = new DataView(ab, base, buf.byteLength);
      const vlen = dv.getUint32(0, true);
      if (vlen >= 8 && renderThisTick) {
        const w = dv.getUint32(4, true);
        const h = dv.getUint32(8, true);
        const rgba = new Uint8ClampedArray(ab, base + 12, w * h * 4);
        if (w !== ctx.canvas.width || h !== ctx.canvas.height) { ctx.canvas.width = w; ctx.canvas.height = h; }
        ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
      }
      const aOff = base + 4 + vlen;
      const aBytes = buf.byteLength - 4 - vlen;
      if (aBytes >= 2) postAudioI16(new Int16Array(ab, aOff, Math.floor(aBytes / 2)));
    }

    async function tick() {
      if (stoppedRef.current) return;
      const actx = audioCtxRef.current;
      const ff = Math.max(1, ffEffectiveRef.current || 1);
      try {
        if (ff > 1) {
          // FF mudo, ritmo por RELOGIO DE PAREDE (independente do Hz da tela):
          // produz ff*baseFps frames reais/seg via acumulador -> suporta 1.25x/1.5x.
          const now = performance.now();
          if (lastFf === 1 || ffLastTime == null) { ffLastTime = now; ffAccum = 0; }
          ffAccum += ((now - ffLastTime) / 1000) * baseFps * ff;
          ffLastTime = now;
          let n = Math.min(MAX_FRAMES_PER_TICK, Math.floor(ffAccum));
          ffAccum -= n;
          if (n >= 1) {
            if (n > 1) { try { await invoke("libretro_skip_frames", { n: n - 1 }); } catch {} }
            renderVideo(await invoke("libretro_run_frame"));
            try { await invoke("libretro_take_audio"); } catch {}
          }
          lastFf = ff;
          audioStart = null; producedPerCh = 0;
          if (actx) audioNextTimeRef.current = actx.currentTime;
        } else {
          if (lastFf !== 1) { audioStart = null; producedPerCh = 0; lastFf = 1; if (actx) audioNextTimeRef.current = actx.currentTime; }
          let framesToRun = 1;
          if (actx) {
            if (audioStart == null) { audioStart = actx.currentTime; producedPerCh = 0; }
            const consumedPerCh = Math.max(0, (actx.currentTime - audioStart) * sampleRate);
            const bufferedSec = (producedPerCh - consumedPerCh) / sampleRate;
            if (bufferedSec >= MAX_LATENCY) {
              framesToRun = 0;
            } else {
              const deficitSec = TARGET_LATENCY - bufferedSec;
              framesToRun = Math.min(
                MAX_FRAMES_PER_TICK,
                Math.max(1, Math.ceil((deficitSec * sampleRate) / samplesPerFrame)),
              );
            }
          }
          if (framesToRun > 0) {
            if (framesToRun > 1) { try { await invoke("libretro_skip_frames", { n: framesToRun - 1 }); } catch {} }
            // v0.9.12: 1 IPC (video+audio juntos) em vez de 2. Em perfMode pula o
            // transfer do video nos ticks impares (30fps video / 60fps audio).
            const renderThisTick = !perfMode || ((videoTick++ & 1) === 0);
            applyAV(await invoke("libretro_run_frame_av", { wantVideo: renderThisTick }), renderThisTick);
          }
        }
      } catch (e) { console.error("frame tick", e); }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [info]);

  // v0.9.10: input de toque com TRACKER GLOBAL no container dos controles.
  // Antes cada botão tinha onTouchStart/End proprio; o touchend so dispara no
  // elemento onde o toque COMECOU, entao "segurar pra baixo e deslizar o dedo pro
  // analogico/outro botão" deixava o pra-baixo preso. Agora cada dedo (por
  // identifier) sabe qual botão esta embaixo dele via elementFromPoint, e ao
  // deslizar soltamos o antigo e apertamos o novo. Refcount por botão trata 2
  // dedos no mesmo botão. Botoes so tem data-btn; quem ouve e o container.
  const controlsRef = useRef(null);
  const pressCounts = useRef(new Map()); // btnId -> nº de dedos em cima
  const touchMap = useRef(new Map());    // touch.identifier -> btnId atual
  const setBtnInput = useCallback((id, pressed) => {
    lastInputRef.current = Date.now();
    if (pressed && autoPaused) setAutoPaused(false);
    invoke("libretro_set_input", { buttonId: id, pressed }).catch(() => {});
  }, [autoPaused]);
  const pressBtn = useCallback((id, pressed) => {
    if (id == null || Number.isNaN(id)) return;
    const counts = pressCounts.current;
    const prev = counts.get(id) || 0;
    const next = pressed ? prev + 1 : Math.max(0, prev - 1);
    counts.set(id, next);
    if (prev === 0 && next > 0) { setBtnInput(id, true); if (ctrlPrefsRef.current.vibration) haptic(8); }
    else if (prev > 0 && next === 0) setBtnInput(id, false);
    const wrap = controlsRef.current;
    if (wrap) {
      const el = wrap.querySelector(`[data-btn="${id}"]`);
      if (el) el.classList.toggle("pressing", next > 0);
    }
  }, [setBtnInput]);
  const btnIdAtPoint = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y);
    const target = el && el.closest ? el.closest("[data-btn]") : null;
    if (!target) return null;
    const v = target.getAttribute("data-btn");
    return v == null ? null : parseInt(v, 10);
  }, []);
  // v0.9.19: analogico na tela (faltava — GameCube/N64/PSP/PS/Dreamcast/Wii).
  // Um dedo dentro do anel arrasta o knob; mandamos x/y normalizado (±32767, igual
  // ao gamepad fisico) via libretro_set_analog stick 0. Tracker por touch.identifier.
  const analogRef = useRef({ id: null, cx: 0, cy: 0, r: 1, knob: null });
  const moveAnalog = useCallback((clientX, clientY) => {
    const a = analogRef.current;
    if (a.id == null) return;
    let dx = clientX - a.cx, dy = clientY - a.cy;
    const dist = Math.hypot(dx, dy);
    if (dist > a.r) { dx = (dx / dist) * a.r; dy = (dy / dist) * a.r; }
    if (a.knob) a.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    lastInputRef.current = Date.now();
    if (autoPaused) setAutoPaused(false);
    const x = Math.max(-32767, Math.min(32767, Math.round((dx / a.r) * 32767)));
    const y = Math.max(-32767, Math.min(32767, Math.round((dy / a.r) * 32767)));
    invoke("libretro_set_analog", { stick: 0, x, y }).catch(() => {});
  }, [autoPaused]);
  const startAnalog = useCallback((t, baseEl) => {
    const r = baseEl.getBoundingClientRect();
    analogRef.current = {
      id: t.identifier,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      r: Math.max(1, r.width / 2),
      knob: baseEl.querySelector(".lmx-emu-analog-knob"),
    };
    if (ctrlPrefsRef.current.vibration) haptic(8);
    moveAnalog(t.clientX, t.clientY);
  }, [moveAnalog]);
  const endAnalog = useCallback(() => {
    const a = analogRef.current;
    if (a.knob) a.knob.style.transform = "";
    analogRef.current = { ...a, id: null };
    invoke("libretro_set_analog", { stick: 0, x: 0, y: 0 }).catch(() => {});
  }, []);
  const analogBaseAtPoint = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("[data-analog]") : null;
  }, []);
  const onControlsTouchStart = useCallback((e) => {
    if (editMode) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const base = analogBaseAtPoint(t.clientX, t.clientY);
      if (base) { startAnalog(t, base); continue; }
      const id = btnIdAtPoint(t.clientX, t.clientY);
      touchMap.current.set(t.identifier, id);
      if (id != null) pressBtn(id, true);
    }
  }, [editMode, btnIdAtPoint, pressBtn, analogBaseAtPoint, startAnalog]);
  const onControlsTouchMove = useCallback((e) => {
    if (editMode) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === analogRef.current.id) { moveAnalog(t.clientX, t.clientY); continue; }
      const oldId = touchMap.current.get(t.identifier);
      const newId = btnIdAtPoint(t.clientX, t.clientY);
      if (newId !== oldId) {
        if (oldId != null) pressBtn(oldId, false);
        if (newId != null) pressBtn(newId, true);
        touchMap.current.set(t.identifier, newId);
      }
    }
  }, [editMode, btnIdAtPoint, pressBtn, moveAnalog]);
  const onControlsTouchEnd = useCallback((e) => {
    if (editMode) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === analogRef.current.id) { endAnalog(); continue; }
      const oldId = touchMap.current.get(t.identifier);
      if (oldId != null) pressBtn(oldId, false);
      touchMap.current.delete(t.identifier);
    }
  }, [editMode, pressBtn, endAnalog]);

  // v0.8.26: gamepad fisico (Bluetooth/USB) — Android WebView suporta nativo.
  // Standard mapping -> libretro RetroPad (mesma logica do desktop).
  const [gamepadConnected, setGamepadConnected] = useState(false);
  useEffect(() => {
    if (!info) return;
    // v0.8.42: usa mapa salvo do user (Settings > Controle), fallback default
    const PAD_MAP = effectivePadMap(system.id);
    const lastState = new Array(16).fill(false);
    const lastAnalog = [0, 0, 0, 0]; // v0.8.45
    let raf;
    function poll() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      // v0.8.42: prefere mapping=standard (evita phantoms)
      let pad = null;
      let connected = false;
      const all = [];
      for (const p of pads) { if (p) all.push(p); }
      for (const p of all) { if (p.mapping === "standard") { pad = p; break; } }
      if (!pad && all.length > 0) pad = all[0];
      connected = !!pad;
      if (connected !== gamepadConnected) setGamepadConnected(connected);
      if (pad) {
        lastInputRef.current = Date.now();
        if (autoPaused) setAutoPaused(false);
        // Combo Select+Start = sair (igual desktop)
        if (pad.buttons[8]?.pressed && pad.buttons[9]?.pressed) {
          onClose();
          return;
        }
        // v0.8.46: D-pad unificado — buttons[12-15] OU hat 6/7 OU stick L (0/1)
        const ax = pad.axes[0] || 0; const ay = pad.axes[1] || 0;
        const hatX = pad.axes[6] || 0; const hatY = pad.axes[7] || 0;
        const dpUp    = !!pad.buttons[12]?.pressed || hatY < -0.4 || ay < -0.4;
        const dpDown  = !!pad.buttons[13]?.pressed || hatY > 0.4  || ay > 0.4;
        const dpLeft  = !!pad.buttons[14]?.pressed || hatX < -0.4 || ax < -0.4;
        const dpRight = !!pad.buttons[15]?.pressed || hatX > 0.4  || ax > 0.4;
        for (const [padIdx, libretroId] of Object.entries(PAD_MAP)) {
          const idx = parseInt(padIdx);
          let pressed;
          switch (idx) {
            case 12: pressed = dpUp; break;
            case 13: pressed = dpDown; break;
            case 14: pressed = dpLeft; break;
            case 15: pressed = dpRight; break;
            default: pressed = !!pad.buttons[idx]?.pressed;
          }
          if (pressed !== lastState[libretroId]) {
            lastState[libretroId] = pressed;
            invoke("libretro_set_input", { buttonId: libretroId, pressed }).catch(() => {});
          }
        }
        // v0.8.45: stick analogico real
        const lx = Math.round((pad.axes[0] || 0) * 32767);
        const ly = Math.round((pad.axes[1] || 0) * 32767);
        const rx = Math.round((pad.axes[2] || 0) * 32767);
        const ry = Math.round((pad.axes[3] || 0) * 32767);
        if (lx !== lastAnalog[0] || ly !== lastAnalog[1]) {
          lastAnalog[0] = lx; lastAnalog[1] = ly;
          invoke("libretro_set_analog", { stick: 0, x: lx, y: ly }).catch(() => {});
        }
        if (rx !== lastAnalog[2] || ry !== lastAnalog[3]) {
          lastAnalog[2] = rx; lastAnalog[3] = ry;
          invoke("libretro_set_analog", { stick: 1, x: rx, y: ry }).catch(() => {});
        }
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [info, onClose, autoPaused, gamepadConnected]);

  // Save / Load state (com thumbnail v0.8.22)
  const saveState = useCallback(async (slot) => {
    try {
      await invoke("libretro_save_state", { romPath: game.path, slot });
      // Captura thumbnail do canvas atual (data URL)
      try {
        if (canvasRef.current) {
          const thumb = canvasRef.current.toDataURL("image/jpeg", 0.6);
          saveThumbnail(system.id, slot, thumb);
        }
      } catch {}
      try { unlockAchievement("first_save", () => {}); } catch {}
      setStateMsg(t("Salvo no slot {slot}", { slot }));
    } catch (e) { setStateMsg(t("Falha ao salvar: {e}", { e })); }
    setTimeout(() => setStateMsg(null), 2500);
  }, [system.id, game.path]);
  const loadState = useCallback(async (slot) => {
    try {
      await invoke("libretro_load_state", { romPath: game.path, slot });
      setStateMsg(t("Carregado slot {slot}", { slot }));
    } catch (e) { setStateMsg(t("Falha ao carregar: {e}", { e })); }
    setTimeout(() => setStateMsg(null), 2500);
  }, [game.path]);

  // Sleep timer: a cada 60s, checa idle > 30min e auto-pause (v0.8.22)
  useEffect(() => {
    const t = setInterval(() => {
      const idleMs = Date.now() - lastInputRef.current;
      if (idleMs > 30 * 60 * 1000 && !autoPaused) {
        setAutoPaused(true);
        setStateMsg(t("Pausado (30min sem input). Toque pra retomar."));
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
      setStateMsg(t("Screenshot salva (Ajustes -> Galeria)"));
      sfx.confirm(); haptic(15);
      setTimeout(() => setStateMsg(null), 2500);
    } catch {}
  }, [system.id, game.name]);

  // v0.9.16: early-return DEPOIS de TODOS os hooks (regra do React). Antes ficava
  // antes de saveState/loadState/sleep/cornerTap -> quando o emulador setava erro
  // (ex: Wii/GameCube sem core ARM no Android) pulava hooks = React #300 (crash
  // "Ludex falhou ao iniciar"). Agora todos os hooks rodam sempre.
  if (error) {
    // v0.9.30: hint contextual no celular tb (paridade com PC). Erro de BIOS,
    // core faltando ou crash interno mostra ação concreta pro Paulo (rodar
    // deep-scan) em vez de so a stacktrace seca.
    const errLow = String(error).toLowerCase();
    const isBios = errLow.includes("bios") || errLow.includes("required");
    const isCoreMissing = errLow.includes("core não encontrado") || errLow.includes("sem core libretro");
    const isPanic = errLow.includes("crash interno") || errLow.includes("panic");
    return (
      <div className="lmx-emu-root">
        <div className="lmx-emu-error">
          <h2>{t("Erro ao carregar jogo")}</h2>
          <pre>{error}</pre>
          {(isBios || isPanic) && (
            <div style={{ marginTop: 12, padding: 12, background: "rgba(255,255,255,0.05)", borderRadius: 10 }}>
              <p style={{ margin: "0 0 10px 0", fontSize: 13 }}>
                {isBios
                  ? t("Provável: BIOS do sistema falta em Ludex/system/.")
                  : t("Provável: BIOS ou config inválida do core.")}
                {" "}{t("Vá em Ajustes → Procurar BIOS no celular inteiro.")}
              </p>
              <button className="lmx-settings-btn primary" style={{ width: "100%" }}
                onClick={async () => {
                  try {
                    const n = await invoke("bios_deep_scan");
                    mAlert(n > 0
                      ? t("Importei {n} BIOS. Tente abrir o jogo de novo.", { n })
                      : t("Nenhuma BIOS encontrada no storage. Coloque os .bin em Download e tente novamente."));
                  } catch (e) { mAlert(t("Falha: {err}", { err: e })); }
                }}>
                {t("Procurar BIOS agora")}
              </button>
            </div>
          )}
          {isCoreMissing && (
            <div style={{ marginTop: 12, padding: 12, background: "rgba(255,255,255,0.05)", borderRadius: 10 }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                {t("Core libretro {core} não está dentro do APK pra este sistema no Android. Suporte vai chegar em versão futura — por enquanto use o launcher no PC.", { core: system?.libretro_core || "?" })}
              </p>
            </div>
          )}
          <button className="lmx-settings-btn primary" onClick={onClose} style={{ marginTop: 12 }}>{t("Voltar")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="lmx-emu-root" data-orient={orient}>
      <button className="lmx-emu-back" onClick={onClose} aria-label={t("Voltar")}><IconArrowLeft /></button>
      <button className="lmx-emu-menu-btn" onClick={() => setMenuOpen(true)} aria-label={t("Menu")}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </button>
      {/* v0.9.15: Fast-forward agora e TAP-TOGGLE (segurar/touch-hold era flaky no
          WebView — "não funcionava"). Toca = liga 2x, toca de novo = desliga. */}
      <button
        className={`lmx-emu-ff-btn ${ffActive || ffSpeed > 1 ? "active" : ""}`}
        onClick={() => { setFfActive((a) => !a); haptic(10); }}
        aria-label={t("Fast forward (liga/desliga)")}
      >
        {ffActive ? `${Math.max(ffSpeed, 2)}x` : (ffSpeed > 1 ? `${ffSpeed}x` : "FF")}
      </button>
      <div className={`lmx-emu-canvas-wrap lmx-emu-scale-${scaleMode}`}>
        <canvas ref={canvasRef} className="lmx-emu-canvas" />
        {/* Corner tap zones: TL=quick save, TR=quick load (double tap) */}
        <div className="lmx-emu-corner lmx-emu-corner-tl" onTouchEnd={cornerTap("tl")} onClick={cornerTap("tl")} aria-label={t("Tap duplo: save state 0")} />
        <div className="lmx-emu-corner lmx-emu-corner-tr" onTouchEnd={cornerTap("tr")} onClick={cornerTap("tr")} aria-label={t("Tap duplo: load state 0")} />
        {/* Watermark "Ludex Desktop" (paywall hint) */}
        <div className="lmx-emu-watermark">{t("Versão prévia — a versão Desktop tem mais consoles")}</div>
        {autoPaused && (
          <div className="lmx-emu-autopause">
            <h3>{t("Pausado")}</h3>
            <p>{t("30min sem input. Toque pra retomar.")}</p>
          </div>
        )}
      </div>
      {stateMsg && <div className="lmx-emu-toast">{stateMsg}</div>}
      {menuOpen && (
        <div className="lmx-emu-menu-overlay" onClick={() => setMenuOpen(false)}>
          <div className="lmx-emu-menu" onClick={(e) => e.stopPropagation()}>
            <h3>{t("Opções")}</h3>

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">{t("Escala da tela")}</div>
              <div className="lmx-emu-menu-row">
                {[
                  ["contain", t("Encaixar")],
                  ["cover",   t("Preencher")],
                  ["integer", t("Integer (pixel-perfect)")],
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
              <div className="lmx-emu-menu-label">{t("Save states")}</div>
              <div className="lmx-emu-menu-row">
                {[1,2,3].map(s => (
                  <button key={`s${s}`} className="lmx-emu-menu-pill" onClick={() => { saveState(s); setMenuOpen(false); }}>{t("Salvar {slot}", { slot: s })}</button>
                ))}
              </div>
              <div className="lmx-emu-menu-row">
                {[1,2,3].map(s => (
                  <button key={`l${s}`} className="lmx-emu-menu-pill" onClick={() => { loadState(s); setMenuOpen(false); }}>{t("Carregar {slot}", { slot: s })}</button>
                ))}
              </div>
            </div>

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">{t("Controle virtual")}</div>
              <button className="lmx-emu-menu-pill" onClick={() => { setEditMode(true); setMenuOpen(false); }}>
                {t("Editar layout (arrastar + tamanho)")}
              </button>
              <button className="lmx-emu-menu-pill" onClick={resetLayout} style={{marginTop:6}}>
                {t("Resetar posições")}
              </button>
              <div className="lmx-emu-menu-row" style={{ marginTop: 8 }}>
                <button className={`lmx-emu-menu-pill ${ctrlPrefs.vibration ? "on" : ""}`}
                        onClick={() => updateCtrlPrefs({ vibration: !ctrlPrefs.vibration })}>
                  {ctrlPrefs.vibration ? t("Vibração: ligada") : t("Vibração: desligada")}
                </button>
                <button className={`lmx-emu-menu-pill ${ctrlPrefs.hideWhenGamepad ? "on" : ""}`}
                        onClick={() => updateCtrlPrefs({ hideWhenGamepad: !ctrlPrefs.hideWhenGamepad })}>
                  {ctrlPrefs.hideWhenGamepad ? t("Esconder c/ controle: sim") : t("Esconder c/ controle: não")}
                </button>
              </div>
              <div className="lmx-emu-menu-sublabel">{t("Tamanho geral")}</div>
              <div className="lmx-emu-menu-row">
                <button className="lmx-emu-menu-pill" onClick={() => updateCtrlPrefs({ scale: Math.max(0.6, +(ctrlPrefs.scale - 0.1).toFixed(2)) })}>−</button>
                <span className="lmx-emu-menu-val">{Math.round(ctrlPrefs.scale * 100)}%</span>
                <button className="lmx-emu-menu-pill" onClick={() => updateCtrlPrefs({ scale: Math.min(1.6, +(ctrlPrefs.scale + 0.1).toFixed(2)) })}>+</button>
              </div>
              <div className="lmx-emu-menu-sublabel">{t("Tema do controle")}</div>
              <div className="lmx-emu-menu-row" style={{ flexWrap: "wrap" }}>
                {CONTROL_THEMES.map(([id, lbl]) => (
                  <button key={id} className={`lmx-emu-menu-pill ${ctrlPrefs.theme === id ? "on" : ""}`}
                          onClick={() => updateCtrlPrefs({ theme: id })}>{t(lbl)}</button>
                ))}
              </div>
            </div>

            {SCREEN_LAYOUTS[system.id] && (
              <div className="lmx-emu-menu-section">
                <div className="lmx-emu-menu-label">{t("Telas (portátil de 2 telas)")}</div>
                <div className="lmx-emu-menu-row">
                  {SCREEN_LAYOUTS[system.id].options.map(([val, lbl]) => {
                    const cfg = SCREEN_LAYOUTS[system.id];
                    const active = (screenLayoutVals[cfg.key] ?? cfg.def) === val;
                    return (
                      <button key={val} className={`lmx-emu-menu-pill ${active ? "on" : ""}`}
                              onClick={() => setCoreOptionLive(cfg.key, val)}>{t(lbl)}</button>
                    );
                  })}
                </div>
                {SCREEN_LAYOUTS[system.id].swap && (
                  <div className="lmx-emu-menu-row">
                    {SCREEN_LAYOUTS[system.id].swap.options.map(([val, lbl]) => {
                      const sw = SCREEN_LAYOUTS[system.id].swap;
                      const active = (screenLayoutVals[sw.key] ?? sw.def) === val;
                      return (
                        <button key={val} className={`lmx-emu-menu-pill ${active ? "on" : ""}`}
                                onClick={() => setCoreOptionLive(sw.key, val)}>{t(lbl)}</button>
                      );
                    })}
                  </div>
                )}
                <p className="lmx-settings-hint" style={{ marginTop: 6 }}>
                  {t("Aplica na hora. Cima/baixo principal, lado a lado, ou uma menor no canto.")}
                </p>
              </div>
            )}

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">{t("Velocidade (fast-forward)")}</div>
              <div className="lmx-emu-menu-row">
                {[
                  [1, "1x"],
                  [1.25, "1.25x"],
                  [1.5, "1.5x"],
                  [2, "2x"],
                ].map(([sp, lbl]) => (
                  <button
                    key={sp}
                    className={`lmx-emu-menu-pill ${ffSpeed === sp ? "on" : ""}`}
                    onClick={() => setFfSpeed(sp)}
                  >{lbl}</button>
                ))}
              </div>
              <p className="lmx-settings-hint" style={{ marginTop: 6 }}>
                {t("Sustenta botão FF no canto pra acelerar só enquanto segura, ou trava velocidade aqui (ótimo pra Pokémon e RPGs lentos).")}
              </p>
            </div>

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">{t("Captura")}</div>
              <button className="lmx-emu-menu-pill" onClick={() => { takeScreenshot(); setMenuOpen(false); }}>
                {t("Tirar screenshot")}
              </button>
            </div>

            <div className="lmx-emu-menu-section">
              <button className="lmx-emu-menu-pill" onClick={() => setMuted(m => !m)}>
                {muted ? t("Ativar som") : t("Mutar som")}
              </button>
            </div>

            {hasOptionsForSystem(system.id) && (
              <div className="lmx-emu-menu-section">
                <div className="lmx-emu-menu-label">{t("Opções do Emulador")}</div>
                <button
                  className="lmx-emu-menu-pill"
                  onClick={() => { setEmuSettingsOpen(true); setMenuOpen(false); }}
                >
                  {t("Resolução, Performance, etc")}
                </button>
                <p className="lmx-settings-hint" style={{ marginTop: 6 }}>
                  {t("Mudanças aplicam ao abrir o jogo de novo.")}
                </p>
              </div>
            )}

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">{t("Cheats")}</div>
              <button
                className="lmx-emu-menu-pill"
                onClick={() => { setCheatsOpen(true); setMenuOpen(false); }}
              >
                {t("Buscar / gerenciar cheats")}
              </button>
            </div>

            <button className="lmx-settings-btn primary" onClick={() => setMenuOpen(false)}>{t("Fechar")}</button>
            <button className="lmx-settings-btn ghost" onClick={() => { onClose(); }} style={{marginTop: 8}}>{t("Sair do jogo")}</button>
          </div>
        </div>
      )}
      {cheatsOpen && (
        <CheatsModal systemId={system.id} gamePath={game.path} onClose={() => setCheatsOpen(false)} />
      )}
      <SystemSettingsModal
        open={emuSettingsOpen}
        systemId={system.id}
        systemName={system.name}
        onClose={() => setEmuSettingsOpen(false)}
      />
      {(!info || !bootMinDone) && (
        <div className="lmx-emu-boot" style={{ "--sys-color": system.color }}>
          <div className="lmx-emu-boot-aurora" />
          <div className="lmx-emu-boot-center">
            <div className="lmx-emu-boot-tile"><SysGlyph id={system.id} /></div>
            <div className="lmx-emu-boot-title">{game.name}</div>
            <div className="lmx-emu-boot-sub">{system.name}</div>
          </div>
          <div className="lmx-emu-boot-foot">
            <div className="lmx-emu-boot-track"><span /></div>
            <div className="lmx-emu-boot-hint">{t("Carregando…")}</div>
          </div>
        </div>
      )}
      {/* Indicador gamepad fisico conectado */}
      {gamepadConnected && !editMode && (
        <div className="lmx-emu-gamepad-badge" title={t("Gamepad conectado")}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ marginRight: 5, verticalAlign: "-2px" }}><line x1="6" y1="11" x2="10" y2="11" /><line x1="8" y1="9" x2="8" y2="13" /><line x1="15" y1="12" x2="15.01" y2="12" /><line x1="18" y1="10" x2="18.01" y2="10" /><rect x="2" y="6" width="20" height="12" rx="2" /></svg>
          {t("GAMEPAD")}
        </div>
      )}
      {/* Touch controls — layout customizado por sistema. Esconde se gamepad ativo */}
      <div ref={controlsRef}
           className={`lmx-emu-controls lmx-ctrl-theme-${ctrlPrefs.theme} ${editMode ? "lmx-emu-edit" : ""} ${gamepadConnected && !editMode ? (ctrlPrefs.hideWhenGamepad ? "lmx-emu-controls-hidden" : "lmx-emu-controls-dim") : ""}`}
           data-face-count={layout.face.length}
           data-has-analog={layout.analog ? "1" : undefined}
           onTouchStart={onControlsTouchStart}
           onTouchMove={onControlsTouchMove}
           onTouchEnd={onControlsTouchEnd}
           onTouchCancel={onControlsTouchEnd}>
        {/* D-pad esquerda (todos os sistemas tem D-pad) */}
        <div className="lmx-emu-dpad" style={groupStyle("dpad")}
             onTouchStart={editMode ? startDrag("dpad") : undefined}
             onMouseDown={editMode ? startDrag("dpad") : undefined}>
          <button className="lmx-emu-dpad-up"    data-btn={4}>▲</button>
          <button className="lmx-emu-dpad-left"  data-btn={6}>◀</button>
          <button className="lmx-emu-dpad-right" data-btn={7}>▶</button>
          <button className="lmx-emu-dpad-down"  data-btn={5}>▼</button>
        </div>
        {/* Analogico esquerdo (so sistemas com stick: GC/N64/PSP/PS/Dreamcast/Wii) */}
        {layout.analog && (
          <div className="lmx-emu-analog" data-analog="0" style={groupStyle("analog")}
               onTouchStart={editMode ? startDrag("analog") : undefined}
               onMouseDown={editMode ? startDrag("analog") : undefined}>
            <div className="lmx-emu-analog-knob" />
          </div>
        )}
        {/* Face buttons (A/B/X/Y/C/etc — varia por sistema) */}
        <div className={`lmx-emu-face lmx-emu-face-${layout.face.length}`}
             style={groupStyle("face")}
             onTouchStart={editMode ? startDrag("face") : undefined}
             onMouseDown={editMode ? startDrag("face") : undefined}>
          {layout.face.map((btn, i) => (
            <button
              key={btn.id}
              className={`lmx-emu-btn lmx-emu-face-pos-${i} lmx-emu-color-${btn.color}`}
              data-btn={btn.id}
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
              {labels[0] && <button className="lmx-emu-btn lmx-emu-btn-select" data-btn={2}>{labels[0]}</button>}
              {labels[1] && <button className="lmx-emu-btn lmx-emu-btn-start"  data-btn={3}>{labels[1]}</button>}
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
                  <button key={l} className="lmx-emu-btn lmx-emu-btn-l" data-btn={map[l]}>{l}</button>
                ))}
              </div>
              <div className="lmx-emu-shoulders-r">
                {sh.filter(l => /^R/.test(l)).map(l => (
                  <button key={l} className="lmx-emu-btn lmx-emu-btn-r" data-btn={map[l]}>{l}</button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
      {/* Banner edit mode */}
      {editMode && (
        <div className="lmx-emu-edit-banner">
          <span>{t("Arraste pra mover. Ajuste o tamanho de cada grupo:")}</span>
          <div className="lmx-emu-edit-sizes">
            {[
              ["dpad", t("Direcional")],
              ...(layout.analog ? [["analog", t("Analógico")]] : []),
              ["face", t("Ações")],
              ...(layout.shoulders ? [["shoulders", "L/R"]] : []),
              ...(layout.selectStart ? [["system", "Select/Start"]] : []),
            ].map(([key, lbl]) => (
              <div key={key} className="lmx-emu-edit-size">
                <span className="lmx-emu-edit-size-lbl">{lbl}</span>
                <button onClick={() => setGroupScale(key, -0.1)}>−</button>
                <span className="lmx-emu-edit-size-val">{Math.round((ctrlPrefs.groupScale?.[key] || 1) * 100)}%</span>
                <button onClick={() => setGroupScale(key, 0.1)}>+</button>
              </div>
            ))}
          </div>
          <div className="lmx-emu-edit-actions">
            <button className="lmx-settings-btn ghost" onClick={resetLayout}>{t("Resetar posição")}</button>
            <button className="lmx-settings-btn primary" onClick={() => setEditMode(false)}>{t("OK")}</button>
          </div>
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
      <h3 className="lmx-section-title">{t("Continue onde parou")}</h3>
      <button className="lmx-recents-card" onClick={() => onResume(top)} style={{ "--sys-color": top.systemColor }}>
        {cover ? (
          <img className="lmx-recents-bg" src={cover} alt="" aria-hidden />
        ) : (
          <div className="lmx-recents-fallback" aria-hidden><SysGlyph id={top.systemId} /></div>
        )}
        <div className="lmx-recents-overlay" />
        <div className="lmx-recents-body">
          <span className="lmx-recents-sys">{top.systemName}</span>
          <h2 className="lmx-recents-name">{top.gameName}</h2>
          <div className="lmx-recents-meta">
            {stats.totalSec > 0 && <span>{t("{time} jogado", { time: formatPlayTime(stats.totalSec) })}</span>}
            <span>{formatRelative(top.timestamp)}</span>
          </div>
          <span className="lmx-recents-cta">{t("Continuar")}</span>
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
// === TUTORIAL OVERLAY (v0.9.34 — spotlight + blur por feature)
// ============================================================
// Substitui a v0.9.4 (3-cards genericos). Agora aponta pra cada elemento
// real do app (via data-tour="..."), troca de aba sozinho, e usa 4 divs
// com backdrop-filter blur ao redor do alvo (efeito vidro fosco em volta,
// alvo nitido). Mesmo padrão do tour do PC (LudexOnboarding.jsx) pra
// paridade. Cada step tem `tab` (pra qual aba ele pertence), `selector`
// (CSS query do alvo) e `body` explicando o que aquela feature faz.
const MOBILE_TOUR_STEPS = [
  { id: "welcome", tab: "home", title: "Bem-vindo ao Ludex Mobile", body: "Vou te mostrar o que cada parte do app faz. Sao ~15 passos rapidos, pode pular a qualquer momento.", placement: "center" },
  { id: "home-avatar", tab: "home", selector: '[data-tour="home-avatar"]', title: "Seu perfil", body: "Toque pra trocar foto, nome e avatar. Seus saves, favoritos e tempo de jogo ficam no perfil ativo.", placement: "bottom" },
  { id: "home-reload", tab: "home", selector: '[data-tour="home-reload"]', title: "Recarregar capas", body: "Apaga o cache de capas e re-busca tudo do zero. Util quando alguma capa não baixou ou veio errada.", placement: "bottom" },
  { id: "home-mais-jogados", tab: "home", selector: '[data-tour="home-mais-jogados"]', title: "Mais jogados", body: "Seus titulos com mais tempo de jogo aparecem aqui automaticamente.", placement: "bottom" },
  { id: "home-continue", tab: "home", selector: '[data-tour="home-continue"]', title: "Continue onde parou", body: "Mostra o ultimo jogo que você abriu. Tocar = retoma direto do save state.", placement: "bottom" },
  { id: "tabs", tab: "home", selector: '[data-tour="tabs"]', title: "Navegacao", body: "4 abas: Inicio, Sistemas (lista de 27+ consoles), Buscar e Ajustes.", placement: "top" },
  { id: "tab-systems", tab: "systems", selector: '[data-tour="tab-systems"]', title: "Sistemas", body: "Todos consoles suportados (SNES, GBA, NDS, PS1, etc). Toque num pra ver os jogos. Sistemas sem ROM aparecem em cinza.", placement: "center" },
  { id: "tab-search", tab: "search", selector: '[data-tour="search-input"]', title: "Buscar", body: "Busca em TODOS seus jogos de uma vez. Ignora acentos e maiusculas ('Pokemon' acha 'Pokémon').", placement: "bottom" },
  { id: "settings-profile", tab: "settings", selector: '[data-tour="settings-profile"]', title: "Perfil ativo", body: "Mostra qual perfil esta em uso. Saves e histórico sao por perfil.", placement: "bottom" },
  { id: "settings-controle", tab: "settings", selector: '[data-tour="settings-controle"]', title: "Controle externo", body: "Controle Bluetooth/USB conectado aparece aqui. Para remapear, abra um jogo -> engrenagem -> Opcoes do Emulador -> Controle.", placement: "bottom" },
  { id: "settings-bios", tab: "settings", selector: '[data-tour="settings-bios"]', title: "BIOS", body: "PS1, PS2, Dreamcast e Saturn precisam de BIOS pra rodar. Coloque seus .bin em Download e clique aqui — o app varre o celular inteiro e copia certinho.", placement: "bottom" },
  { id: "settings-theme", tab: "settings", selector: '[data-tour="settings-theme"]', title: "Tema do app", body: "Troca o visual (fundo, cards, accent). Opcoes: Roxo Ludex (padrão), Switch Dark, PS3 Wave, Sunset, Forest e Light.", placement: "top" },
  { id: "settings-tutorial", tab: "settings", selector: '[data-tour="settings-tutorial"]', title: "Ver tutorial de novo", body: "Quando quiser refrescar — botão aqui sempre re-abre este passo a passo.", placement: "top" },
  { id: "settings-folder", tab: "settings", selector: '[data-tour="settings-folder"]', title: "Pasta de ROMs", body: "Aponte pra pasta onde estão suas ROMs (.gba/.nes/.iso/.smc/etc). O Ludex varre subpastas inteiras e detecta cada sistema pela extensão.", placement: "top" },
  { id: "done", tab: "home", title: "Tudo pronto!", body: "Bons jogos. Voce sempre pode reabrir este tutorial em Ajustes -> Ver tutorial novamente.", placement: "center" },
];

function useTourTargetRect(selector, deps) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    let cancelled = false;
    function measure() {
      if (cancelled) return;
      if (!selector) return setRect(null);
      const el = document.querySelector(selector);
      if (!el) return setRect(null);
      const r = el.getBoundingClientRect();
      // ignora alvos colapsados (selector existe mas height 0)
      if (r.width < 2 || r.height < 2) return setRect(null);
      setRect(r);
    }
    measure();
    // re-mede ao longo do tempo pq mudanca de aba causa entrance animation
    const id = setInterval(measure, 180);
    window.addEventListener("resize", measure);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener("resize", measure); };
  }, [selector, ...deps]);
  return rect;
}

function TutorialSpotlight({ rect }) {
  // 4 divs em volta do rect: cada uma com backdrop-filter blur(8px) + dark.
  // O retangulo central fica nitido. Usar 4 divs em vez de SVG mask porque
  // backdrop-filter não funciona dentro de <mask>. Webview Android (Chromium
  // 110+) suporta backdrop-filter desde 2022, S25 Ultra tem Chromium 130+.
  if (!rect) {
    // sem alvo (welcome/done) — overlay full
    return <div className="lmx-tour-full-overlay" />;
  }
  const pad = 10;
  const r = {
    top: Math.max(0, rect.top - pad),
    left: Math.max(0, rect.left - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return (
    <>
      {/* TOP */}
      <div className="lmx-tour-blur" style={{ top: 0, left: 0, width: "100%", height: r.top }} />
      {/* BOTTOM */}
      <div className="lmx-tour-blur" style={{ top: r.top + r.height, left: 0, width: "100%", height: Math.max(0, vh - (r.top + r.height)) }} />
      {/* LEFT (apenas faixa horizontal do alvo) */}
      <div className="lmx-tour-blur" style={{ top: r.top, left: 0, width: r.left, height: r.height }} />
      {/* RIGHT */}
      <div className="lmx-tour-blur" style={{ top: r.top, left: r.left + r.width, width: Math.max(0, vw - (r.left + r.width)), height: r.height }} />
      {/* Highlight ring sobre o alvo (nitido) */}
      <div
        className="lmx-tour-ring"
        style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
      />
    </>
  );
}

function TutorialBanner({ step, rect, idx, total, onNext, onPrev, onSkip }) {
  const style = useMemo(() => {
    const w = Math.min(360, window.innerWidth - 32);
    const margin = 18;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!rect || step.placement === "center") {
      return { top: vh / 2 - 130, left: vw / 2 - w / 2, width: w };
    }
    let top, left;
    if (step.placement === "top") {
      top = rect.top - margin - 220;
    } else {
      // default bottom
      top = rect.bottom + margin;
    }
    left = Math.max(margin, Math.min(vw - w - margin, rect.left + rect.width / 2 - w / 2));
    top = Math.max(margin, Math.min(vh - 250, top));
    return { top, left, width: w };
  }, [rect, step]);

  return (
    <div className="lmx-tour-banner" style={style} role="dialog" aria-label={step.title}>
      <div className="lmx-tour-step">{t("Passo {n} de {total}", { n: idx + 1, total })}</div>
      <h2 className="lmx-tour-title">{t(step.title)}</h2>
      <p className="lmx-tour-body">{t(step.body)}</p>
      <div className="lmx-tour-actions">
        <button className="lmx-tour-btn lmx-tour-btn-ghost" onClick={onSkip}>{t("Pular")}</button>
        <div className="lmx-tour-nav">
          {idx > 0 && <button className="lmx-tour-btn lmx-tour-btn-ghost" onClick={onPrev}>{t("Voltar")}</button>}
          <button className="lmx-tour-btn lmx-tour-btn-primary" onClick={onNext}>
            {idx === total - 1 ? t("Concluir") : t("Próximo")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TutorialOverlay({ activeTab, setActiveTab, onDone }) {
  const [idx, setIdx] = useState(0);
  const step = MOBILE_TOUR_STEPS[idx];
  // Troca de aba quando o step pede uma aba diferente. 320ms de espera pra
  // animacao de entrada da aba assentar antes de medir o rect.
  const [tabReady, setTabReady] = useState(true);
  useEffect(() => {
    if (!step) return;
    if (step.tab && step.tab !== activeTab) {
      setTabReady(false);
      setActiveTab(step.tab);
      const t = setTimeout(() => setTabReady(true), 360);
      return () => clearTimeout(t);
    } else {
      setTabReady(true);
    }
  }, [idx, step, activeTab, setActiveTab]);

  const rect = useTourTargetRect(tabReady ? step?.selector : null, [idx, tabReady]);

  const next = () => {
    if (idx + 1 >= MOBILE_TOUR_STEPS.length) { onDone(); return; }
    setIdx(idx + 1);
  };
  const prev = () => { if (idx > 0) setIdx(idx - 1); };
  const skip = () => onDone();

  return (
    <div className="lmx-tour-root" role="dialog" aria-modal="true">
      <TutorialSpotlight rect={rect} />
      <TutorialBanner
        step={step}
        rect={rect}
        idx={idx}
        total={MOBILE_TOUR_STEPS.length}
        onNext={next}
        onPrev={prev}
        onSkip={skip}
      />
    </div>
  );
}

// ============================================================
// === WHY WINDOWS CARD (paywall sutil) =======================
// ============================================================
function WhyWindowsCard() {
  return (
    <section className="lmx-settings-card lmx-why-windows">
      <div className="lmx-settings-label">{t("Por que comprar a versão Windows?")}</div>
      <ul className="lmx-why-list">
        <li>{t("27+ sistemas embedded: PS2, GameCube, Wii, 3DS, Saturn, Dreamcast e mais")}</li>
        <li>{t("Switch, PS3, Xbox 360, PS Vita, Wii U via emuladores nativos")}</li>
        <li>{t("RetroAchievements (conquistas reais por jogo)")}</li>
        <li>{t("Save states com slot múltiplo + resume automático")}</li>
        <li>{t("Discord Rich Presence (mostra o jogo no seu perfil)")}</li>
        <li>{t("Música ambiente com playlist + crossfade")}</li>
        <li>{t("Wallpapers customizados, perfis ilimitados")}</li>
        <li>{t("Gamepad nativo sem latência + remap por emulador")}</li>
        <li>{t("Notificação quando controle conecta/desconecta")}</li>
        <li>{t("Auto-update do app + cores libretro")}</li>
      </ul>
      {/* v0.9.5: botão de compra removido daqui — ja existe no card de status da
          licenca acima (estava aparecendo 2x). */}
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
      <div className="lmx-settings-label">{t("Conquistas Ludex ({unlocked}/{total})", { unlocked: unlocked.length, total: ACHIEVEMENTS.length })}</div>
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
                <div className="lmx-ach-name">{t(a.name)}</div>
                <div className="lmx-ach-desc">{t(a.desc)}</div>
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
  // v0.9.2: window.prompt/alert não funcionam no WebView Android -> input in-app
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePin, setDisablePin] = useState("");
  const [err, setErr] = useState(null);
  const enable = () => {
    if (pinInput.length !== 4) { setErr(t("PIN deve ter 4 dígitos")); return; }
    setChildModeStore(true, pinInput);
    setOnState(true);
    setPinInput("");
    setSetupOpen(false);
    setErr(null);
    sfx.confirm();
  };
  const doDisable = () => {
    if (!verifyChildPin(disablePin)) { setErr(t("PIN incorreto")); return; }
    setChildModeStore(false);
    setOnState(false);
    setDisableOpen(false);
    setDisablePin("");
    setErr(null);
    sfx.confirm();
  };
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">{t("Modo criança")}</div>
      <p className="lmx-settings-hint">
        {t("Esconde ROMs com nomes contendo palavras-chave adultas (GTA, Resident Evil, Doom, etc). Precisa PIN de 4 dígitos pra desativar.")}
      </p>
      {on ? (
        !disableOpen ? (
          <button className="lmx-settings-btn ghost" onClick={() => { setDisableOpen(true); setErr(null); }}>{t("Desativar Modo criança")}</button>
        ) : (
          <div className="lmx-settings-key">
            <input
              type="tel" inputMode="numeric" maxLength={4} placeholder={t("PIN pra desativar")}
              value={disablePin} onChange={(e) => setDisablePin(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
            <button className="lmx-settings-btn primary" onClick={doDisable} disabled={disablePin.length !== 4}>{t("Confirmar")}</button>
          </div>
        )
      ) : !setupOpen ? (
        <button className="lmx-settings-btn primary" onClick={() => setSetupOpen(true)}>{t("Ativar Modo criança")}</button>
      ) : (
        <div className="lmx-settings-key">
          <input
            type="tel" inputMode="numeric" maxLength={4} placeholder={t("PIN 4 dígitos")}
            value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <button className="lmx-settings-btn primary" onClick={enable} disabled={pinInput.length !== 4}>{t("Confirmar")}</button>
        </div>
      )}
      {err && <p className="lmx-settings-msg error">{err}</p>}
    </section>
  );
}

// ============================================================
// === BACKUP / RESTORE CARD ==================================
// ============================================================
function BackupRestoreCard() {
  const [msg, setMsg] = useState(null);
  // v0.9.2: navigator.clipboard e window.prompt não funcionam no WebView Android.
  // Export mostra o JSON num textarea selecionavel (+ tenta clipboard como bonus).
  // Import usa textarea in-app em vez de prompt.
  const [exportText, setExportText] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const taStyle = { width: "100%", height: 92, marginTop: 8, padding: 10, borderRadius: 8, background: "rgba(0,0,0,0.3)", border: "1px solid var(--lmx-border)", color: "var(--lmx-text)", fontFamily: "monospace", fontSize: 11, boxSizing: "border-box", resize: "vertical" };
  const doExport = () => {
    const json = exportConfig();
    setExportText(json);
    try { if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {}); } catch {}
    try { notifyBackupMade && notifyBackupMade(() => {}); } catch {}
    sfx.confirm();
  };
  const doImport = () => {
    const json = importText.trim();
    if (!json) return;
    if (importConfig(json)) {
      setMsg({ kind: "ok", text: t("Config importada. Reabra o app pra aplicar — perfil, conquistas, recents, favoritos e capas custom vieram do outro dispositivo.") });
      setImportOpen(false); setImportText("");
    } else {
      setMsg({ kind: "error", text: t("Falha ao importar. Verifica se o JSON tá completo.") });
    }
    setTimeout(() => setMsg(null), 8000);
  };
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">{t("Backup / restore")}</div>
      <p className="lmx-settings-hint">
        {t("Exporta recents, conquistas, stats, cheats e capas custom em JSON.")}
      </p>
      <button className="lmx-settings-btn primary" onClick={doExport}>{t("Exportar config")}</button>
      {exportText && (
        <>
          <p className="lmx-settings-hint" style={{ marginTop: 8 }}>
            {t("Tentei copiar pro clipboard. Se não colar, segura no texto abaixo, \"Selecionar tudo\" e copia:")}
          </p>
          <textarea readOnly value={exportText} onFocus={(e) => e.target.select()} style={taStyle} />
        </>
      )}
      <button className="lmx-settings-btn ghost" onClick={() => { setImportOpen(o => !o); setMsg(null); }} style={{ marginTop: 8 }}>
        {importOpen ? t("Cancelar import") : t("Importar config")}
      </button>
      {importOpen && (
        <>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={t("Cola aqui o JSON exportado do outro dispositivo")} style={taStyle} />
          <button className="lmx-settings-btn primary" onClick={doImport} disabled={!importText.trim()} style={{ marginTop: 8 }}>{t("Aplicar import")}</button>
        </>
      )}
      {msg && <p className={`lmx-settings-msg ${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}

// ============================================================
// === AMBIENT MUSIC TOGGLE ===================================
// ============================================================
// v0.9.1: ambient music agora suporta MP3s (paridade Windows) + fallback chiptune.
// MP3s vão na pasta /storage/emulated/0/Ludex/music/ no Android. Vazio = chiptune.
function AmbientMusicToggle() {
  // v0.9.9: o playback agora e app-wide (efeito no componente principal). Aqui o
  // toggle so liga/desliga a preferencia e avisa via evento. Toca a MESMA música
  // do launcher do Windows (MP3 shuffle + crossfade), ou chiptune se não ha MP3.
  const [on, setOnState] = useState(isAmbientOn());
  const [count, setCount] = useState(ambientMusic.playlist.length);
  const [trackName, setTrackName] = useState(null);

  useEffect(() => {
    if (ambientMusic.playlist.length) { setCount(ambientMusic.playlist.length); return; }
    ambientMusic.load().then(setCount).catch(() => setCount(0));
  }, []);

  useEffect(() => {
    if (!on || count === 0) { setTrackName(null); return; }
    const tick = () => {
      const q = ambientMusic.queue;
      const p = q.length ? q[ambientMusic.current % q.length] : null;
      setTrackName(p ? p.split(/[\\/]/).pop().replace(/\.mp3$/i, "").replace(/^ES_/, "").slice(0, 35) : null);
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [on, count]);

  const toggle = () => {
    const next = !on;
    setOnState(next);
    setAmbientPref(next);
    window.dispatchEvent(new CustomEvent("ludex:ambient-changed"));
  };
  const skip = () => { if (ambientMusic.playlist.length) ambientMusic.skip(); };

  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">{t("Música ambiente")}</div>
      <p className="lmx-settings-hint">
        {count > 0
          ? (count > 1
              ? t("{n} MP3s em Ludex/music/ — toca no app todo (shuffle + crossfade, igual o Windows). Pausa dentro do jogo.", { n: count })
              : t("{n} MP3 em Ludex/music/ — toca no app todo (shuffle + crossfade, igual o Windows). Pausa dentro do jogo.", { n: count }))
          : t("Chiptune sintético (Web Audio). Pra ter as mesmas faixas do Windows, copia MP3s pra /storage/emulated/0/Ludex/music/")}
      </p>
      {on && trackName && (
        <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.25)", fontSize: 12, color: "#c4b5fd", display: "flex", alignItems: "center", gap: 8 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{trackName}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="lmx-settings-btn primary" onClick={toggle} style={{ flex: 1 }}>
          {on ? t("Desligar música") : t("Ligar música")}
        </button>
        {on && count > 1 && (
          <button className="lmx-settings-btn ghost" onClick={skip} title={t("Próxima faixa")} style={{ minWidth: 56 }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}

// ============================================================
// === PROFILE SWITCHER CARD (v0.9.1 - paridade Windows) ======
// ============================================================
// Multiplos profiles no mobile (era single 'Player'). User pode criar,
// trocar, renomear, deletar. Conquistas/recents/stats sao por dispositivo
// (localStorage), mas o profile ativo determina o name/avatar mostrado.
// Salva no config.json via save_config (mesmo backend Rust do desktop).
// v0.9.1: usa DEFAULT_AVATARS (SVG glyphs Unicode, sem emoji) — paridade total com desktop.

function ProfileSwitcherCard({ config, activeProfile, onConfigChange }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAvatarId, setNewAvatarId] = useState(DEFAULT_AVATARS[0].id);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editAvatarId, setEditAvatarId] = useState(null); // v0.9.3: editar avatar tb
  const [msg, setMsg] = useState(null);
  const profiles = config?.profiles || [];

  const save = async (updatedConfig) => {
    try {
      await invoke("save_config", { config: updatedConfig });
      onConfigChange && onConfigChange(updatedConfig);
      sfx.confirm();
    } catch (e) {
      setMsg({ kind: "error", text: t("Falha ao salvar: {e}", { e }) });
    }
  };

  const create = async () => {
    const n = newName.trim();
    if (n.length < 2) { setMsg({ kind: "error", text: t("Nome muito curto (mínimo 2 letras)") }); return; }
    const newProfile = {
      id: `p${Math.random().toString(36).slice(2, 10)}`,
      name: n,
      avatar_id: newAvatarId,
      photo_path: null,
      created_at: Math.floor(Date.now() / 1000),
    };
    const updated = {
      ...config,
      profiles: [...profiles, newProfile],
      active_profile_id: newProfile.id,
    };
    await save(updated);
    setCreating(false);
    setNewName("");
    setMsg({ kind: "ok", text: t("Perfil \"{name}\" criado e ativado.", { name: n }) });
    setTimeout(() => setMsg(null), 3000);
  };

  const switchTo = async (id) => {
    if (id === config?.active_profile_id) return;
    await save({ ...config, active_profile_id: id });
    const p = profiles.find(x => x.id === id);
    setMsg({ kind: "ok", text: t("Trocou pro perfil \"{name}\".", { name: p?.name }) });
    setTimeout(() => setMsg(null), 3000);
  };

  // v0.9.3: salva nome E avatar (antes so nome, com onBlur que quebrava no mobile)
  const saveEdit = async (id) => {
    const n = editName.trim();
    if (n.length < 2) { setMsg({ kind: "error", text: t("Nome muito curto (mínimo 2 letras)") }); return; }
    const updated = {
      ...config,
      profiles: profiles.map(p => p.id === id ? { ...p, name: n, avatar_id: editAvatarId || p.avatar_id } : p),
    };
    await save(updated);
    setEditingId(null);
    setEditName("");
    setEditAvatarId(null);
    setMsg({ kind: "ok", text: t("Perfil atualizado.") });
    setTimeout(() => setMsg(null), 2500);
  };

  const del = async (id) => {
    if (profiles.length <= 1) { setMsg({ kind: "error", text: t("Não pode deletar o único perfil.") }); return; }
    if (!(await mConfirm(t("Deletar esse perfil? Tempo/conquistas locais ficam (são por dispositivo).")))) return;
    const newProfiles = profiles.filter(p => p.id !== id);
    const newActive = config.active_profile_id === id ? newProfiles[0].id : config.active_profile_id;
    await save({ ...config, profiles: newProfiles, active_profile_id: newActive });
  };

  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">{t("Perfis ({n})", { n: profiles.length })}</div>
      <p className="lmx-settings-hint">
        {t("Múltiplos perfis: cada um com nome + avatar. Use Backup/Sync (acima) pra trazer conquistas e favoritos de outro dispositivo.")}
      </p>

      {profiles.map(p => {
        const isActive = p.id === config?.active_profile_id;
        const av = DEFAULT_AVATARS.find(a => a.id === p.avatar_id) || DEFAULT_AVATARS[0];
        const isEditing = editingId === p.id;
        if (isEditing) {
          // v0.9.3: painel de edicao com nome + avatar + botões explicitos
          // (sem onBlur, que fechava antes de trocar o avatar no celular)
          return (
            <div key={p.id} style={{ padding: 12, marginBottom: 6, borderRadius: 10, background: "rgba(124,58,237,0.10)", border: "1px solid rgba(124,58,237,0.3)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", marginBottom: 8 }}>{t("Editar perfil")}</div>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("Nome do perfil")}
                maxLength={28}
                autoFocus
                style={{ width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(124,58,237,0.4)", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 6 }}>{t("Avatar")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 8 }}>
                {DEFAULT_AVATARS.map(a => (
                  <button key={a.id} onClick={() => setEditAvatarId(a.id)} title={a.label}
                    style={{ aspectRatio: "1/1", borderRadius: 8, border: `2px solid ${(editAvatarId || p.avatar_id) === a.id ? "#fff" : "transparent"}`, cursor: "pointer", padding: 0, overflow: "hidden", background: "rgba(0,0,0,0.3)" }}>
                    <img src={avatarUrl(a)} alt={a.label} style={{ width: "100%", height: "100%", display: "block" }} />
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="lmx-settings-btn primary" onClick={() => saveEdit(p.id)} style={{ flex: 1 }}>{t("Salvar")}</button>
                <button className="lmx-settings-btn ghost" onClick={() => { setEditingId(null); setEditName(""); setEditAvatarId(null); }} style={{ flex: 1 }}>{t("Cancelar")}</button>
              </div>
            </div>
          );
        }
        return (
          <div key={p.id} style={{
            display: "flex", alignItems: "center", gap: 10, padding: 10, marginBottom: 6,
            borderRadius: 10, background: isActive ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${isActive ? "rgba(124,58,237,0.4)" : "rgba(255,255,255,0.06)"}`,
          }}>
            <img
              src={profileImgSrc(p)}
              alt={av.label}
              style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, objectFit: "cover" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
              {isActive && <div style={{ fontSize: 10, color: "#c4b5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{t("Ativo")}</div>}
            </div>
            {!isActive && (
              <button onClick={() => switchTo(p.id)} style={{ background: "#7c3aed", border: "none", color: "#fff", padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                {t("Usar")}
              </button>
            )}
            <button onClick={() => { setEditingId(p.id); setEditName(p.name); setEditAvatarId(p.avatar_id); }} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", padding: "6px 8px", borderRadius: 6, fontSize: 11 }}>
              {t("Editar")}
            </button>
            {profiles.length > 1 && !isActive && (
              <button onClick={() => del(p.id)} style={{ background: "rgba(239,68,68,0.15)", border: "none", color: "#ef4444", padding: "6px 8px", borderRadius: 6, fontSize: 11 }}>
                {t("Excluir")}
              </button>
            )}
          </div>
        );
      })}

      {!creating ? (
        <button className="lmx-settings-btn primary" onClick={() => setCreating(true)} style={{ marginTop: 8 }}>
          {t("+ Novo perfil")}
        </button>
      ) : (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("Nome do perfil")}
            maxLength={28}
            autoFocus
            style={{ width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(124,58,237,0.4)", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 8 }}>
            {DEFAULT_AVATARS.map(av => (
              <button
                key={av.id}
                onClick={() => setNewAvatarId(av.id)}
                title={av.label}
                style={{
                  aspectRatio: "1/1", borderRadius: 8,
                  border: `2px solid ${newAvatarId === av.id ? "#fff" : "transparent"}`,
                  cursor: "pointer", padding: 0, overflow: "hidden",
                  background: "rgba(0,0,0,0.3)",
                }}
              >
                <img src={avatarUrl(av)} alt={av.label} style={{ width: "100%", height: "100%", display: "block" }} />
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="lmx-settings-btn primary" onClick={create} style={{ flex: 1 }}>{t("Criar")}</button>
            <button className="lmx-settings-btn ghost" onClick={() => { setCreating(false); setNewName(""); }} style={{ flex: 1 }}>{t("Cancelar")}</button>
          </div>
        </div>
      )}

      {msg && <p className={`lmx-settings-msg ${msg.kind}`}>{msg.text}</p>}
    </section>
  );
}

// ============================================================
// === STATS DASHBOARD CARD (v0.9.1 - paridade Windows) =======
// ============================================================
// CollectionStats + TopPlayed + Sessions equivalente do desktop.
// Le do localStorage (loadStats, totalPlayTime, loadRecents) e renderiza
// 3 sub-secoes: cards de overview, top 5 mais jogados, atividade ultimos 7 dias.
function StatsDashboardCard({ systems }) {
  const stats = loadStats();
  const recents = loadRecents();
  const totalSec = totalPlayTime();
  const totalGames = Object.keys(stats).length;
  const totalSessions = Object.values(stats).reduce((acc, s) => acc + (s.sessions || 0), 0);
  const sysSet = new Set(recents.map(r => r.systemId).filter(Boolean));

  // Top 5 mais jogados
  const topGames = Object.entries(stats)
    .map(([gamePath, s]) => {
      const recent = recents.find(r => r.gamePath === gamePath);
      return {
        path: gamePath,
        name: recent?.gameName || gamePath.split(/[\\/]/).pop(),
        systemId: recent?.systemId || "?",
        systemColor: recent?.systemColor || "#7c3aed",
        totalSec: s.totalSec || 0,
        sessions: s.sessions || 0,
      };
    })
    .filter(g => g.totalSec > 0)
    .sort((a, b) => b.totalSec - a.totalSec)
    .slice(0, 5);

  // Sessoes ultimos 7 dias (barras simples)
  const now = Date.now();
  const dayMs = 86400000;
  const last7 = [];
  for (let d = 6; d >= 0; d--) {
    const dayStart = now - d * dayMs;
    const dayLabel = new Date(dayStart).toLocaleDateString(currentLocale(), { weekday: "short" }).slice(0, 3);
    let dayTotal = 0;
    for (const s of Object.values(stats)) {
      if (s.lastSession && s.lastSession >= dayStart - dayMs && s.lastSession <= dayStart) {
        dayTotal += s.totalSec || 0;
      }
    }
    last7.push({ label: dayLabel, total: dayTotal });
  }
  const maxDay = Math.max(1, ...last7.map(d => d.total));

  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">{t("Estatísticas")}</div>
      <p className="lmx-settings-hint">{t("Sua atividade no Ludex Mobile (local, este dispositivo).")}</p>

      {/* Overview cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginTop: 10 }}>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.25)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#c4b5fd" }}>{formatPlayTime(totalSec)}</div>
          <div style={{ fontSize: 11, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 1 }}>{t("Tempo total")}</div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#86efac" }}>{totalGames}</div>
          <div style={{ fontSize: 11, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1 }}>{t("Jogos")}</div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(236,72,153,0.12)", border: "1px solid rgba(236,72,153,0.25)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#f9a8d4" }}>{totalSessions}</div>
          <div style={{ fontSize: 11, color: "#f472b6", textTransform: "uppercase", letterSpacing: 1 }}>{t("Sessões")}</div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#93c5fd" }}>{sysSet.size}</div>
          <div style={{ fontSize: 11, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 1 }}>{t("Sistemas")}</div>
        </div>
      </div>

      {/* Top 5 mais jogados */}
      {topGames.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{t("Mais jogados")}</div>
          {topGames.map((g, idx) => (
            <div key={g.path} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: idx < topGames.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div style={{ width: 4, height: 28, background: g.systemColor, borderRadius: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{g.sessions !== 1 ? t("{n} sessões", { n: g.sessions }) : t("{n} sessão", { n: g.sessions })}</div>
              </div>
              <strong style={{ fontSize: 13, color: "#c4b5fd", whiteSpace: "nowrap" }}>{formatPlayTime(g.totalSec)}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Últimos 7 dias - barras simples */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{t("Últimos 7 dias")}</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
          {last7.map((d, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: "100%",
                height: `${Math.max(2, (d.total / maxDay) * 50)}px`,
                background: "linear-gradient(180deg, #c4b5fd, #7c3aed)",
                borderRadius: "3px 3px 0 0",
                opacity: d.total > 0 ? 1 : 0.2,
              }} title={`${d.label}: ${formatPlayTime(d.total)}`} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)" }}>{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// === SOURCES GUIDE CARD (v0.9.1 - paridade Windows) =========
// ============================================================
// "Onde baixar jogos / DLCs / Mods" - mesmo SuggestionsModal usado no
// LudexLauncher desktop. Lista catalogada: Vimm's Lair, Myrient, CDRomance,
// Romhacking.net, GameBanana, NoPayStation, etc. Aviso legal explicito.
function SourcesGuideCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="lmx-settings-card">
        <div className="lmx-settings-label">{t("Onde baixar jogos / DLCs / Mods")}</div>
        <p className="lmx-settings-hint">
          {t("Lista de sites populares por categoria — ROMs (Vimm's, Myrient, CDRomance), patches PT-BR (Tradu-Roms, Romhacking), DLCs (NoPayStation, Hshop). Mesma lista do Windows.")}
        </p>
        <button className="lmx-settings-btn primary" onClick={() => { sfx.confirm(); setOpen(true); }}>
          {t("Abrir guia de fontes")}
        </button>
      </section>
      <SuggestionsModal open={open} onClose={() => setOpen(false)} defaultTab="roms" />
    </>
  );
}

// ============================================================
// === LOGS VIEWER CARD (v0.9.1 - paridade Windows) ===========
// ============================================================
// Mostra ultimas 200 linhas do app log. Util quando algum jogo não abre
// ou app trava - copia o log e me manda. Backend ja tem read_app_logs.
function LogsViewerCard() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(t("Carregando..."));
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const logs = await invoke("read_app_logs", { maxLines: 200 });
      setText(logs || t("(log vazio)"));
    } catch (e) {
      setText(t("Erro: {err}", { err: String(e) }));
    } finally { setBusy(false); }
  };
  // v0.9.2: clipboard pode falhar no WebView Android. Tenta, e dá feedback;
  // se falhar, o usuário segura no <pre> e seleciona manual.
  const copy = async () => {
    try {
      if (navigator.clipboard) { await navigator.clipboard.writeText(text); mAlert(t("Log copiado.")); return; }
      throw new Error("sem clipboard");
    } catch {
      mAlert(t("Não consegui copiar automático. Segura no texto do log e seleciona/copia manual."));
    }
  };
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">{t("Logs do app")}</div>
      <p className="lmx-settings-hint">
        {t("Últimas 200 linhas. Útil quando algum jogo não abre — copia e me manda.")}
      </p>
      <button className="lmx-settings-btn primary" onClick={() => { sfx.click(); load(); setOpen(true); }}>
        {t("Abrir logs")}
      </button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, padding: 16, display: "flex", flexDirection: "column" }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, background: "#0a0420", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong style={{ color: "#c4b5fd" }}>{t("Logs do Ludex")}</strong>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: 24, cursor: "pointer" }}>×</button>
            </div>
            <pre style={{ flex: 1, overflow: "auto", fontSize: 10, color: "#ddd", whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="lmx-settings-btn" onClick={load} disabled={busy}>{busy ? t("Recarregando...") : t("Recarregar")}</button>
              <button className="lmx-settings-btn primary" onClick={copy}>{t("Copiar tudo")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
