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
// por isso varios botoes "nao funcionavam" no APK. Usa os dialogs NATIVOS do
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
import { ambientMusic } from "./ludexAmbientMusic"; // v0.9.9: musica ambiente igual ao PC
import { SystemSettingsModal, SuggestionsModal } from "./LudexExtras"; // v0.9.1: + SuggestionsModal pra paridade com desktop
import { DEFAULT_AVATARS, avatarUrl } from "./LudexOnboarding"; // v0.9.1: reusa avatares SVG do desktop (regra: NUNCA emoji em UI prod)
import { hasOptionsForSystem, applySystemOptions, effectivePadMap, loadSystemOptions, saveSystemOptions } from "./ludexSystemOptions";
import { CheatsModal } from "./LudexCheatsModal";
import { loadCheats as loadGameCheats, applyCheats as applyGameCheats } from "./ludexCheats";

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
      <div className="lmx-splash-word">LUDEX</div>
      <div className="lmx-splash-bar"><span /></div>
    </div>
  );
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
    } catch (e) { mAlert("Nao consegui abrir Configuracoes: " + e); }
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
        // Auto-cria profile se nao tem — e PERSISTE na hora. Sem o save_config o
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
        const sys = await invoke("scan_roms_overrides", { romsRoot: null, overrides: loadSystemFolders() });
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

  // v0.9.7: splash de abertura (some sozinho; entrada dos catalogos roda atras)
  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1550);
    return () => clearTimeout(t);
  }, []);

  // v0.9.8: novidades pos-update (compara versao atual com a ultima vista)
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
      mAlert(`Sistema "${system.name}" nao tem core libretro embedded pra Android.`);
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

  // ============ MUSICA AMBIENTE APP-WIDE (paridade PC) ============
  // v0.9.9: toca a MESMA musica ambiente do launcher do Windows (MP3 da pasta
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

  // v0.9.3: BACK do Android (gesto de swipe / botao) navega DENTRO do app em vez
  // de MINIMIZAR. Antes qualquer back minimizava o app em qualquer aba (bug) e o
  // user era obrigado a usar as setas. Agora usa History API: mantemos um "trap"
  // no historico; ao voltar, desfazemos UM nivel de navegacao e re-armamos o
  // trap. So na raiz (Inicio, nada aberto) o proximo back sai do app.
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
      else handled = false; // raiz -> deixa o proximo back sair do app
      if (handled) { try { history.pushState({ lx: 1 }, ""); } catch {} }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
        // Checa permissao de acesso a todos os arquivos
        let hasAccess = true;
        try { hasAccess = await invoke("android_has_all_files_access"); } catch {}
        if (!hasAccess) {
          const ok = await mConfirm(
            "O Ludex precisa de permissao para acessar seus arquivos.\n\n" +
            "Vou abrir Configuracoes -- ative 'Permitir gerenciar todos os arquivos' e volte aqui.\n\nAbrir agora?"
          );
          if (ok) {
            try { await invoke("android_open_all_files_settings"); } catch (err) {
              await mAlert("Nao consegui abrir Configuracoes: " + err);
            }
          }
        } else {
          await mAlert(
            "Nenhum jogo encontrado em:\n" + path + "\n\n" +
            "ROMs supported: .nes .smc .sfc .gba .gb .gbc .iso .bin .cue .z64 .n64 .md .smd .gen .sms .gg .pce .ws .ngc .lnx .a26 .j64 .zip .7z e outras."
          );
        }
      }
    } catch (e) {
      dbg(`setRomsFolder falhou: ${e}`);
      await mAlert(`Falha: ${e}`);
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
          // v0.9.3: em vez de baixar/instalar dentro do app (instavel no WebView),
          // abre a release no GitHub no NAVEGADOR PADRAO do celular. O user baixa
          // o APK por la e instala. Mais confiavel e e o que o Paulo pediu.
          setUpdateState({ stage: "installing", msg: "Abrindo a pagina da atualizacao no navegador..." });
          try {
            await invoke("open_url", { url: "https://github.com/EllaeMyApp/ludex/releases/latest" });
          } catch (e) {
            setUpdateState({ stage: "error", msg: "Nao consegui abrir o navegador. Acesse manualmente: github.com/EllaeMyApp/ludex/releases/latest" });
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
            title={`Pasta de ${openSystem.name}`}
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
    <div className="lmx" style={lastGameCover ? { backgroundImage: `linear-gradient(180deg, rgba(10,2,32,0.85) 0%, rgba(10,2,32,0.98) 70%), url(${lastGameCover})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {!loading && launching && (
        <div className="lmx-loading-overlay">
          <div className="lmx-spinner" />
          <div>Abrindo jogo...</div>
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
          />
        )}
        </div>
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

      {/* v0.9.7: splash de abertura */}
      {!splashDone && <MobileSplash />}
      {/* v0.9.8: novidades pos-update (depois do splash e do tutorial) */}
      {whatsNew && splashDone && tutorialDone && (
        <WhatsNewModal data={whatsNew} onClose={() => { markVersionSeen(whatsNew.current); setWhatsNew(null); }} />
      )}
      {/* Tutorial first run */}
      {!tutorialDone && splashDone && (
        <TutorialOverlay onDone={() => { markFirstRunDone(); setTutorialDone(true); }} />
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
      <nav className="lmx-tabs lmx-tabs-float">
        <TabBtn icon={<IconNavHome />} label="Inicio" active={activeTab === "home"} onClick={() => changeTab("home")} />
        <TabBtn icon={<IconNavLibrary />} label="Sistemas" active={activeTab === "systems"} onClick={() => changeTab("systems")} />
        <TabBtn icon={<IconNavSearch />} label="Buscar" active={activeTab === "search"} onClick={() => changeTab("search")} />
        <TabBtn icon={<IconNavSettings />} label="Ajustes" active={activeTab === "settings"} onClick={() => changeTab("settings")} />
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
function HomeTab({ systems, covers, activeProfile, androidDemo, loading, recents, onPickSystem, onPickGame, onResume, onPickFolder, hasFilesAccess, onRequestAccess, onOpenProfile }) {
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

  return (
    <div className="lmx-home">
      {/* Hero header */}
      <header className="lmx-home-hero">
        {/* v0.9.3: avatar do perfil presente na home (toca = abre Ajustes/perfil) */}
        <button className="lmx-home-avatar" onClick={onOpenProfile} aria-label="Editar perfil">
          <img src={profileImg} alt="Perfil" />
        </button>
        <div className="lmx-home-greeting">
          <div className="lmx-home-hello">Olá</div>
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

      {/* v0.9.9: Destaques — carrossel horizontal de capas grandes no topo
          (paridade com o launcher do PC). Some sozinho se ainda nao ha capas. */}
      <FeaturedCarousel items={recentByMtime} covers={covers} onPick={onPickGame} />

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
// === FEATURED CAROUSEL (v0.9.9 - paridade launcher PC) ======
// Carrossel horizontal de capas GRANDES no topo da home. Usa os jogos mais
// recentes que JA tem capa baixada (some inteiro enquanto nao ha capa, pra nao
// mostrar placeholders feios). Scroll-snap horizontal premium.
// ============================================================
function FeaturedCarousel({ items, covers, onPick }) {
  const withCover = (items || []).filter(
    ({ game }) => typeof covers[game.path] === "string" && covers[game.path].length > 0
  );
  if (withCover.length === 0) return null;
  const feat = withCover.slice(0, 6);
  return (
    <section className="lmx-featured">
      <h3 className="lmx-section-title">Destaques</h3>
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
                style={{ "--sys-color": sys.color }}
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
        <h1>Atualização disponível</h1>
        <div className="lmx-update-version">
          <span>v{info.current}</span>
          <span className="lmx-update-arrow">→</span>
          <span className="lmx-update-target">v{info.latest}</span>
        </div>
        {info.notes && <p className="lmx-update-notes">{info.notes}</p>}
        <p className="lmx-update-required-text">
          Toque em "Atualizar agora" para abrir a página de download no navegador.<br />
          A versão Windows é gratuita pra quem comprou.
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

function SettingsTab({ activeProfile, androidDemo, onAdminUnlock, onPickFolder, currentRomsRoot, config, onConfigChange }) {
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
              <button className="lmx-settings-btn primary" onClick={() => invoke("open_url", { url: "https://pauloadriel98.gumroad.com/l/ludex" }).catch(() => {})}>
                Comprar versao Windows (R$ 49,90)
              </button>
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
          // v0.9.5: abrir uma pasta especifica e instavel entre gerenciadores de
          // arquivos do Android. Tenta abrir, mas SEMPRE mostra o caminho como
          // fallback (antes falhava em silencio = "nao funciona").
          const base = await invoke("android_ludex_base_path").catch(() => "/storage/emulated/0/Ludex");
          let opened = false;
          try { await invoke("android_open_folder", { absPath: base }); opened = true; } catch {}
          if (!opened) {
            await mAlert(
              "Abra o app de Arquivos (Meus Arquivos) do seu celular e vá até:\n\n" + base +
              "\n\nColoque BIOS em " + base + "/system/ e mods em " + base + "/mods/<sistema>/"
            );
          }
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
        <div className="lmx-settings-label">Sons</div>
        <SoundToggle />
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">Sobre</div>
        <div className="lmx-settings-value">Ludex Android v0.8.23</div>
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
function SystemScreen({ system, covers, onBack, onPickGame, onPickFolder, onPickSystemFolder, currentSystemFolder }) {
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
        {/* v0.9.5: pasta exclusiva deste sistema */}
        {onPickSystemFolder && (
          <button className="lmx-sysfolder-btn" onClick={onPickSystemFolder} title="Escolher pasta só deste sistema" aria-label="Pasta deste sistema">
            <IconFolder withRoms={!!currentSystemFolder} />
          </button>
        )}
      </header>
      {currentSystemFolder && (
        <div className="lmx-sysfolder-bar">
          <span>Pasta deste sistema: <code>{currentSystemFolder}</code></span>
          <button onClick={onPickSystemFolder}>Trocar</button>
        </div>
      )}
      {system.games.length === 0 ? (
        <div className="lmx-empty-state">
          <div className="lmx-empty-icon"><IconGrid /></div>
          <h2>Sem jogos de {system.name}</h2>
          <p>
            Escolha uma pasta SÓ pra {system.name} — assim cada emulador pode ter
            a sua. O Ludex detecta as ROMs pela extensão.
          </p>
          {onPickSystemFolder && (
            <button className="lmx-settings-btn primary" onClick={onPickSystemFolder} style={{ maxWidth: 280, margin: "16px auto 8px" }}>
              Escolher pasta de {system.name}
            </button>
          )}
          {onPickFolder && (
            <button className="lmx-settings-btn ghost" onClick={onPickFolder} style={{ maxWidth: 280, margin: "0 auto" }}>
              Usar a pasta geral de ROMs
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
    catch (e) { mAlert("Nao consegui abrir a pasta: " + e); }
  };
  const openModsFolder = async () => {
    try { await invoke("android_open_folder", { absPath: modsDir }); }
    catch (e) { mAlert("Nao consegui abrir a pasta de mods: " + e); }
  };

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
        {/* v0.9.6: nota de usuarios externos (IGDB, 0-100) — paridade com PC */}
        {details?.rating != null && (
          <div className="lmx-detail-webrating">
            <span className="lmx-detail-webrating-score">{Math.round(details.rating)}</span>
            <span className="lmx-detail-webrating-label">Nota web<br />(usuários IGDB)</span>
          </div>
        )}

        <button className="lmx-detail-play" onClick={onLaunch}>
          <IconPlay /> JOGAR
        </button>

        {/* v0.9.3: nota do usuario (estrelas) */}
        <div className="lmx-detail-rating">
          <span className="lmx-detail-rating-label">Sua nota</span>
          <div className="lmx-detail-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={"lmx-detail-star" + (n <= rating ? " on" : "")} onClick={() => setStars(n === rating ? 0 : n)} aria-label={`${n} estrelas`}>
                <IconStar filled={n <= rating} />
              </button>
            ))}
          </div>
        </div>

        {/* v0.9.3: arquivo + mods (acesso direto pela tela do jogo) */}
        <div className="lmx-detail-files">
          <button className="lmx-detail-filebtn" onClick={openGameFolder}>
            <IconFolder withRoms={false} />
            <span>Abrir pasta do jogo</span>
          </button>
          <button className="lmx-detail-filebtn" onClick={openModsFolder}>
            <IconFolder withRoms={modCount > 0} />
            <span>Mods{modCount != null ? ` (${modCount})` : ""}</span>
          </button>
        </div>
        <p className="lmx-detail-files-hint">
          Coloque traduções/hacks em <code>Ludex/mods/{system.id}/</code> — renomeie ou aplique o patch na ROM antes de jogar.
        </p>

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
          <h3>{title || (isImage ? "Escolher foto" : "Escolher pasta de ROMs")}</h3>
          <button className="lmx-back-btn" onClick={onClose} aria-label="Fechar"><IconClose /></button>
        </div>

        {/* Atalhos rapidos */}
        <div className="lmx-fb-shortcuts">
          {(isImage ? IMG_SHORTCUTS : QUICK_SHORTCUTS).map((s) => (
            <button key={s.path} className="lmx-fb-chip" onClick={() => load(s.path)}>{s.label}</button>
          ))}
        </div>

        {/* Breadcrumb + subir */}
        <div className="lmx-fb-bar">
          <button
            className="lmx-fb-up"
            disabled={!listing?.parent}
            onClick={() => listing?.parent && load(listing.parent)}
            aria-label="Subir um nível"
          ><IconUp /></button>
          <div className="lmx-fb-crumbs">
            {crumbs.length === 0 ? <span className="lmx-fb-crumb">/</span> : crumbs.map((c, i) => (
              <span key={c.path} className="lmx-fb-crumb-wrap">
                {i > 0 && <span className="lmx-fb-sep">/</span>}
                <button className="lmx-fb-crumb" onClick={() => load(c.path)}>{c.label}</button>
              </span>
            ))}
          </div>
        </div>

        {/* Conteudo */}
        <div className="lmx-fb-list">
          {loading && <div className="lmx-fb-status">Carregando…</div>}
          {err && <div className="lmx-fb-status lmx-fb-err">{err}</div>}
          {!loading && !err && folders.length === 0 && files.length === 0 && (
            <div className="lmx-fb-status">Pasta vazia</div>
          )}
          {!loading && !err && folders.map((f) => (
            <button key={f.path} className="lmx-fb-item" onClick={() => load(f.path)}>
              <span className={"lmx-fb-icon" + (f.rom_count > 0 ? " has-roms" : "")}><IconFolder withRoms={f.rom_count > 0} /></span>
              <span className="lmx-fb-name">{f.name}</span>
              {f.rom_count > 0 && <span className="lmx-fb-badge">{f.rom_count} ROM{f.rom_count > 1 ? "s" : ""}</span>}
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
            <div className="lmx-fb-foundhint">Toque numa imagem para usar como foto</div>
          </div>
        ) : (
          <div className="lmx-fb-footer">
            {romsHere > 0 && (
              <div className="lmx-fb-foundhint">{romsHere} ROM{romsHere > 1 ? "s" : ""} nesta pasta</div>
            )}
            <button
              className="lmx-settings-btn primary"
              disabled={!cwd || loading}
              onClick={() => onPick(cwd)}
            >
              Usar esta pasta
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
// verdade (picker de imagem), nome e avatar. Antes nao tinha como trocar foto
// nem o nome era facil de achar — Paulo pediu varias vezes.
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
      setMsg({ kind: "ok", text: "Foto pronta. Toque em Salvar." });
    } catch (e) {
      setMsg({ kind: "error", text: "Falha na foto: " + String(e) });
    } finally { setBusy(false); }
  };

  const removePhoto = async () => {
    try { await invoke("delete_profile_photo", { profileId: activeProfile.id }); } catch {}
    setPhotoPath(null); setBust((v) => v + 1);
  };

  const save = async () => {
    const n = name.trim();
    if (n.length < 2) { setMsg({ kind: "error", text: "Nome muito curto (mínimo 2 letras)" }); return; }
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
      setMsg({ kind: "error", text: "Falha ao salvar: " + String(e) });
      setBusy(false);
    }
  };

  if (picking) {
    return <FolderPickerModal mode="image" title="Escolher foto do perfil" onClose={() => setPicking(false)} onPick={onPickImage} />;
  }

  const previewSrc = photoPath
    ? convertFileSrc(photoPath) + "?v=" + bust
    : avatarUrl(DEFAULT_AVATARS.find(a => a.id === avatarId) || DEFAULT_AVATARS[0]);

  return (
    <div className="lmx-sheet-backdrop" onClick={onClose}>
      <div className="lmx-folder-sheet" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "calc(24px + var(--lmx-safe-bottom))" }}>
        <div className="lmx-sheet-handle" />
        <div className="lmx-sheet-header">
          <h3>Editar perfil</h3>
          <button className="lmx-back-btn" onClick={onClose} aria-label="Fechar"><IconClose /></button>
        </div>
        <div style={{ padding: "4px 18px 0", overflowY: "auto" }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <img src={previewSrc} alt="" style={{ width: 96, height: 96, borderRadius: 26, objectFit: "cover", border: "2px solid rgba(124,92,255,0.55)", background: "rgba(0,0,0,0.3)" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
              <button className="lmx-settings-btn primary" onClick={() => setPicking(true)} disabled={busy} style={{ width: "auto", padding: "9px 18px" }}>Escolher foto</button>
              {photoPath && <button className="lmx-settings-btn ghost" onClick={removePhoto} style={{ width: "auto", padding: "9px 18px" }}>Remover</button>}
            </div>
          </div>
          <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={28} placeholder="Seu nome" autoFocus
            style={{ width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(124,92,255,0.4)", color: "#fff", padding: "11px 13px", borderRadius: 9, fontSize: 15, boxSizing: "border-box", marginBottom: 14 }} />
          {!photoPath && (
            <>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>Ou um avatar</label>
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
          <button className="lmx-settings-btn primary" onClick={save} disabled={busy} style={{ marginTop: 4 }}>{busy ? "Salvando..." : "Salvar"}</button>
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
        <button className="lmx-settings-btn primary" onClick={() => invoke("open_url", { url: "https://pauloadriel98.gumroad.com/l/ludex" }).catch(() => {})}>
          Comprar Windows (R$ 49,90)
        </button>
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

// v0.9.10: portateis de 2 telas (DS/3DS) — atalho de layout DIRETO no menu in-game,
// aplicado AO VIVO (libretro_set_option seta OPTIONS_DIRTY -> core re-le na hora).
// Os mesmos keys/values do SystemSettingsModal, mas com label PT e 1 toque. Cobre o
// pedido do Paulo: tela de cima/baixo como principal, lado a lado, ou uma menor no canto.
const SCREEN_LAYOUTS = {
  ds: {
    key: "melonds_screen_layout",
    def: "Top/Bottom",
    options: [
      ["Top/Bottom", "Cima / Baixo"],
      ["Bottom/Top", "Baixo / Cima"],
      ["Left/Right", "Lado a lado"],
      ["Hybrid Top", "Destaque cima"],
      ["Hybrid Bottom", "Destaque baixo"],
      ["Top Only", "Só de cima"],
      ["Bottom Only", "Só de baixo"],
    ],
  },
  "3ds": {
    key: "citra_layout_option",
    def: "Default Top-Bottom Screen",
    options: [
      ["Default Top-Bottom Screen", "Cima / Baixo"],
      ["Side by Side", "Lado a lado"],
      ["Large Screen, Small Screen", "Grande + pequena"],
      ["Single Screen Only", "Tela única"],
    ],
    swap: {
      key: "citra_swap_screen",
      def: "Top",
      options: [["Top", "Principal: Cima"], ["Bottom", "Principal: Baixo"]],
    },
  },
};

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
  // Edit mode + offsets custom dos grupos de botoes (dpad, face, system, shoulders)
  const [editMode, setEditMode] = useState(false);
  const [offsets, setOffsets] = useState(() => loadCustomLayout(system.id) || {});
  const dragState = useRef(null);
  // Sleep timer: pausa core se sem input por X min (v0.8.22)
  const lastInputRef = useRef(Date.now());
  const [autoPaused, setAutoPaused] = useState(false);
  // v0.8.23: fast-forward (acelera GBA/Pokemon e outros lentos)
  // ffSpeed = 1 (normal), 2, 3, 4. ffActive = override temporario (hold)
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
  const groupStyle = useCallback((key) => {
    const o = offsets[key];
    if (!o) return undefined;
    return { transform: `translate(${o.x}px, ${o.y}px)` };
  }, [offsets]);
  const resetLayout = useCallback(() => {
    setOffsets({});
    saveCustomLayout(system.id, {});
  }, [system.id]);
  // v0.9.10: layout de telas DS/3DS aplicado AO VIVO (sem reabrir o jogo).
  const [screenLayoutVals, setScreenLayoutVals] = useState(() => loadSystemOptions(system.id));
  const setCoreOptionLive = useCallback((key, value) => {
    const cur = { ...loadSystemOptions(system.id), [key]: value };
    saveSystemOptions(system.id, cur);
    setScreenLayoutVals(cur);
    invoke("libretro_set_option", { key, value }).catch(() => {});
    setStateMsg("Layout aplicado");
    setTimeout(() => setStateMsg(null), 1400);
  }, [system.id]);
  const canvasRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  // v0.9.11: animacao de boot do emulador. Fica visivel por no minimo BOOT_MS E
  // ate o core+ROM carregarem (o que demorar mais) — cobre o "ecossistema" do
  // emulador carregando em celular fraco, sem flash de tela preta (pedido do Paulo).
  const BOOT_MS = 4200;
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
        if (!coreFile) { setError(`Sistema "${system.name}" sem core libretro`); return; }
        // v0.8.38: aplica opcoes salvas do user antes de carregar
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
          // se o device nao suporta a taxa exata do core (ex: GBA 32768Hz), o
          // construtor lanca NotSupportedError -> ficava SEM SOM. Usa a taxa
          // padrao do device; o createBuffer abaixo usa a taxa do core e o
          // contexto faz o resample no playback.
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          await ctx.resume();
          audioCtxRef.current = ctx;
          audioNextTimeRef.current = ctx.currentTime + 0.05;
          // resume tambem em qualquer toque (autoplay policy do WebView Android)
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
  // LudexEmulatorView.jsx), nao por throttle de performance.now()/rAF. O loop antigo
  // gatava "1 frame por refresh" e, com o jank de IPC/render do WebView Android, a
  // producao de audio atrasava -> o buffer agendado esvaziava -> engasgo. Agora o
  // AudioContext.currentTime e o mestre: a cada tick medimos quanto audio ainda esta
  // no buffer (produzido - consumido) e rodamos quantos frames forem necessarios pra
  // repor ate TARGET_LATENCY, com catch-up via libretro_skip_frames. producedPerCh
  // conta o audio produzido MESMO MUTADO, entao o pacing nao dispara sozinho.
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

    // Conta o audio pra pacing SEMPRE; so agenda playback se nao estiver mutado.
    function postAudio(audioBuf) {
      if (!audioBuf || audioBuf.byteLength === 0) return;
      const ab = audioBuf.buffer ? audioBuf.buffer : audioBuf;
      const i16 = new Int16Array(ab, audioBuf.byteOffset || 0, audioBuf.byteLength / 2);
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

    async function tick() {
      if (stoppedRef.current) return;
      const actx = audioCtxRef.current;
      const ff = Math.max(1, ffEffectiveRef.current || 1);
      try {
        if (ff > 1) {
          // Fast-forward roda mudo (descarta audio) pra nao acumular/pitch-bend.
          const n = Math.min(ff, MAX_FRAMES_PER_TICK);
          if (n > 1) { try { await invoke("libretro_skip_frames", { n: n - 1 }); } catch {} }
          renderVideo(await invoke("libretro_run_frame"));
          try { await invoke("libretro_take_audio"); } catch {}
          audioStart = null; producedPerCh = 0; lastFf = ff;
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
            renderVideo(await invoke("libretro_run_frame"));
            postAudio(await invoke("libretro_take_audio"));
          }
        }
      } catch (e) { console.error("frame tick", e); }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [info]);

  // v0.9.10: input de toque com TRACKER GLOBAL no container dos controles.
  // Antes cada botao tinha onTouchStart/End proprio; o touchend so dispara no
  // elemento onde o toque COMECOU, entao "segurar pra baixo e deslizar o dedo pro
  // analogico/outro botao" deixava o pra-baixo preso. Agora cada dedo (por
  // identifier) sabe qual botao esta embaixo dele via elementFromPoint, e ao
  // deslizar soltamos o antigo e apertamos o novo. Refcount por botao trata 2
  // dedos no mesmo botao. Botoes so tem data-btn; quem ouve e o container.
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
    if (prev === 0 && next > 0) { setBtnInput(id, true); haptic(8); }
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
  const onControlsTouchStart = useCallback((e) => {
    if (editMode) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const id = btnIdAtPoint(t.clientX, t.clientY);
      touchMap.current.set(t.identifier, id);
      if (id != null) pressBtn(id, true);
    }
  }, [editMode, btnIdAtPoint, pressBtn]);
  const onControlsTouchMove = useCallback((e) => {
    if (editMode) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const oldId = touchMap.current.get(t.identifier);
      const newId = btnIdAtPoint(t.clientX, t.clientY);
      if (newId !== oldId) {
        if (oldId != null) pressBtn(oldId, false);
        if (newId != null) pressBtn(newId, true);
        touchMap.current.set(t.identifier, newId);
      }
    }
  }, [editMode, btnIdAtPoint, pressBtn]);
  const onControlsTouchEnd = useCallback((e) => {
    if (editMode) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const oldId = touchMap.current.get(t.identifier);
      if (oldId != null) pressBtn(oldId, false);
      touchMap.current.delete(t.identifier);
    }
  }, [editMode, pressBtn]);

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
      await invoke("libretro_save_state", { romPath: game.path, slot });
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
  }, [system.id, game.path]);
  const loadState = useCallback(async (slot) => {
    try {
      await invoke("libretro_load_state", { romPath: game.path, slot });
      setStateMsg(`Carregado slot ${slot}`);
    } catch (e) { setStateMsg(`Falha ao carregar: ${e}`); }
    setTimeout(() => setStateMsg(null), 2500);
  }, [game.path]);

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
      <button className="lmx-emu-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </button>
      {/* v0.8.23: botao Fast-Forward — hold pra acelerar 2x, indicador visual */}
      <button
        className={`lmx-emu-ff-btn ${ffActive || ffSpeed > 1 ? "active" : ""}`}
        onTouchStart={(e) => { e.preventDefault(); setFfActive(true); haptic(8); }}
        onTouchEnd={(e) => { e.preventDefault(); setFfActive(false); }}
        onTouchCancel={(e) => { e.preventDefault(); setFfActive(false); }}
        onMouseDown={() => setFfActive(true)}
        onMouseUp={() => setFfActive(false)}
        onMouseLeave={() => setFfActive(false)}
        aria-label="Fast forward"
      >
        {ffSpeed > 1 && !ffActive ? `${ffSpeed}x` : "FF"}
      </button>
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

            {SCREEN_LAYOUTS[system.id] && (
              <div className="lmx-emu-menu-section">
                <div className="lmx-emu-menu-label">Telas (portátil de 2 telas)</div>
                <div className="lmx-emu-menu-row">
                  {SCREEN_LAYOUTS[system.id].options.map(([val, lbl]) => {
                    const cfg = SCREEN_LAYOUTS[system.id];
                    const active = (screenLayoutVals[cfg.key] ?? cfg.def) === val;
                    return (
                      <button key={val} className={`lmx-emu-menu-pill ${active ? "on" : ""}`}
                              onClick={() => setCoreOptionLive(cfg.key, val)}>{lbl}</button>
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
                                onClick={() => setCoreOptionLive(sw.key, val)}>{lbl}</button>
                      );
                    })}
                  </div>
                )}
                <p className="lmx-settings-hint" style={{ marginTop: 6 }}>
                  Aplica na hora. Cima/baixo principal, lado a lado, ou uma menor no canto.
                </p>
              </div>
            )}

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">Velocidade (fast-forward)</div>
              <div className="lmx-emu-menu-row">
                {[
                  [1, "1x (normal)"],
                  [2, "2x"],
                  [3, "3x"],
                  [4, "4x"],
                ].map(([sp, lbl]) => (
                  <button
                    key={sp}
                    className={`lmx-emu-menu-pill ${ffSpeed === sp ? "on" : ""}`}
                    onClick={() => setFfSpeed(sp)}
                  >{lbl}</button>
                ))}
              </div>
              <p className="lmx-settings-hint" style={{ marginTop: 6 }}>
                Sustenta botao FF no canto pra acelerar so enquanto segura, ou trava
                velocidade aqui (otimo pra Pokemon e RPGs lentos).
              </p>
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

            {hasOptionsForSystem(system.id) && (
              <div className="lmx-emu-menu-section">
                <div className="lmx-emu-menu-label">Opções do Emulador</div>
                <button
                  className="lmx-emu-menu-pill"
                  onClick={() => { setEmuSettingsOpen(true); setMenuOpen(false); }}
                >
                  Resolução, Performance, etc
                </button>
                <p className="lmx-settings-hint" style={{ marginTop: 6 }}>
                  Mudanças aplicam ao abrir o jogo de novo.
                </p>
              </div>
            )}

            <div className="lmx-emu-menu-section">
              <div className="lmx-emu-menu-label">Cheats</div>
              <button
                className="lmx-emu-menu-pill"
                onClick={() => { setCheatsOpen(true); setMenuOpen(false); }}
              >
                Buscar / gerenciar cheats
              </button>
            </div>

            <button className="lmx-settings-btn primary" onClick={() => setMenuOpen(false)}>Fechar</button>
            <button className="lmx-settings-btn ghost" onClick={() => { onClose(); }} style={{marginTop: 8}}>Sair do jogo</button>
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
          <div className="lmx-emu-boot-glow" />
          <div className="lmx-emu-boot-sys"><SysGlyph id={system.id} /></div>
          <div className="lmx-emu-boot-ring" />
          <div className="lmx-emu-boot-title">{game.name}</div>
          <div className="lmx-emu-boot-sub">{system.name}</div>
          <div className="lmx-emu-boot-bar"><span style={{ animationDuration: `${BOOT_MS}ms` }} /></div>
        </div>
      )}
      {/* Indicador gamepad fisico conectado */}
      {gamepadConnected && !editMode && (
        <div className="lmx-emu-gamepad-badge" title="Gamepad conectado">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ marginRight: 5, verticalAlign: "-2px" }}><line x1="6" y1="11" x2="10" y2="11" /><line x1="8" y1="9" x2="8" y2="13" /><line x1="15" y1="12" x2="15.01" y2="12" /><line x1="18" y1="10" x2="18.01" y2="10" /><rect x="2" y="6" width="20" height="12" rx="2" /></svg>
          GAMEPAD
        </div>
      )}
      {/* Touch controls — layout customizado por sistema. Esconde se gamepad ativo */}
      <div ref={controlsRef}
           className={`lmx-emu-controls ${editMode ? "lmx-emu-edit" : ""} ${gamepadConnected && !editMode ? "lmx-emu-controls-dim" : ""}`}
           data-face-count={layout.face.length}
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
    { title: "Bem-vindo ao Ludex Mobile", body: "Sua biblioteca retro no celular: GBA, NES, SNES, GB/GBC, Mega Drive, NDS, PS1 e mais — direto no Android, sem PC.", icon: "M5 4a2 2 0 012-2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2zM12 18h.01" },
    { title: "Adiciona suas ROMs", body: "Vai em Ajustes > 'Escolher pasta no celular' e aponta pra pasta com seus arquivos (.gba/.nes/.iso/.smc/etc). O Ludex encontra as ROMs automaticamente.", icon: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" },
    { title: "Controle Bluetooth", body: "Pareia qualquer controle (Xbox/PS/Switch/8BitDo) nas Configuracoes do Android. Ao abrir um jogo, o Ludex reconhece automaticamente e voce joga sem touchscreen.", icon: "M6 9h12M6 15h2m8 0h2M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" },
    { title: "Auto-update", body: "Quando sai versao nova no GitHub, o Ludex avisa na hora e baixa o APK direto. Voce so confirma a instalacao do Android.", icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 7v5l3 3" },
    { title: "Versao Windows tem MAIS", body: "PS2, GameCube, Wii, 3DS, Saturn, Switch, PS3, Xbox 360, RetroAchievements, Discord Rich Presence, musica ambiente, wallpapers — tudo na versao paga de PC.", icon: "M21 9V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-4" },
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
        <li>27+ sistemas embedded: PS2, GameCube, Wii, 3DS, Saturn, Dreamcast e mais</li>
        <li>Switch, PS3, Xbox 360, PS Vita, Wii U via emuladores nativos</li>
        <li>RetroAchievements (conquistas reais por jogo)</li>
        <li>Save states com slot multiplo + resume automatico</li>
        <li>Discord Rich Presence (mostra o jogo no seu perfil)</li>
        <li>Musica ambiente com playlist + crossfade</li>
        <li>Wallpapers customizados, perfis ilimitados</li>
        <li>Gamepad nativo sem latencia + remap por emulador</li>
        <li>Notificacao quando controle conecta/desconecta</li>
        <li>Auto-update do app + cores libretro</li>
      </ul>
      {/* v0.9.5: botao de compra removido daqui — ja existe no card de status da
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
  // v0.9.2: window.prompt/alert nao funcionam no WebView Android -> input in-app
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePin, setDisablePin] = useState("");
  const [err, setErr] = useState(null);
  const enable = () => {
    if (pinInput.length !== 4) { setErr("PIN deve ter 4 digitos"); return; }
    setChildModeStore(true, pinInput);
    setOnState(true);
    setPinInput("");
    setSetupOpen(false);
    setErr(null);
    sfx.confirm();
  };
  const doDisable = () => {
    if (!verifyChildPin(disablePin)) { setErr("PIN incorreto"); return; }
    setChildModeStore(false);
    setOnState(false);
    setDisableOpen(false);
    setDisablePin("");
    setErr(null);
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
        !disableOpen ? (
          <button className="lmx-settings-btn ghost" onClick={() => { setDisableOpen(true); setErr(null); }}>Desativar Modo crianca</button>
        ) : (
          <div className="lmx-settings-key">
            <input
              type="tel" inputMode="numeric" maxLength={4} placeholder="PIN pra desativar"
              value={disablePin} onChange={(e) => setDisablePin(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
            <button className="lmx-settings-btn primary" onClick={doDisable} disabled={disablePin.length !== 4}>Confirmar</button>
          </div>
        )
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
      {err && <p className="lmx-settings-msg error">{err}</p>}
    </section>
  );
}

// ============================================================
// === BACKUP / RESTORE CARD ==================================
// ============================================================
function BackupRestoreCard() {
  const [msg, setMsg] = useState(null);
  // v0.9.2: navigator.clipboard e window.prompt nao funcionam no WebView Android.
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
      setMsg({ kind: "ok", text: "Config importada. Reabra o app pra aplicar — perfil, conquistas, recents, favoritos e capas custom vieram do outro dispositivo." });
      setImportOpen(false); setImportText("");
    } else {
      setMsg({ kind: "error", text: "Falha ao importar. Verifica se o JSON ta completo." });
    }
    setTimeout(() => setMsg(null), 8000);
  };
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">Backup / restore</div>
      <p className="lmx-settings-hint">
        Exporta recents, conquistas, stats, cheats e capas custom em JSON.
      </p>
      <button className="lmx-settings-btn primary" onClick={doExport}>Exportar config</button>
      {exportText && (
        <>
          <p className="lmx-settings-hint" style={{ marginTop: 8 }}>
            Tentei copiar pro clipboard. Se nao colar, segura no texto abaixo, "Selecionar tudo" e copia:
          </p>
          <textarea readOnly value={exportText} onFocus={(e) => e.target.select()} style={taStyle} />
        </>
      )}
      <button className="lmx-settings-btn ghost" onClick={() => { setImportOpen(o => !o); setMsg(null); }} style={{ marginTop: 8 }}>
        {importOpen ? "Cancelar import" : "Importar config"}
      </button>
      {importOpen && (
        <>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Cola aqui o JSON exportado do outro dispositivo" style={taStyle} />
          <button className="lmx-settings-btn primary" onClick={doImport} disabled={!importText.trim()} style={{ marginTop: 8 }}>Aplicar import</button>
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
  // toggle so liga/desliga a preferencia e avisa via evento. Toca a MESMA musica
  // do launcher do Windows (MP3 shuffle + crossfade), ou chiptune se nao ha MP3.
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
      <div className="lmx-settings-label">Música ambiente</div>
      <p className="lmx-settings-hint">
        {count > 0
          ? `${count} MP3${count > 1 ? "s" : ""} em Ludex/music/ — toca no app todo (shuffle + crossfade, igual o Windows). Pausa dentro do jogo.`
          : "Chiptune sintético (Web Audio). Pra ter as mesmas faixas do Windows, copia MP3s pra /storage/emulated/0/Ludex/music/"}
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
          {on ? "Desligar música" : "Ligar música"}
        </button>
        {on && count > 1 && (
          <button className="lmx-settings-btn ghost" onClick={skip} title="Próxima faixa" style={{ minWidth: 56 }}>
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
      setMsg({ kind: "error", text: "Falha ao salvar: " + e });
    }
  };

  const create = async () => {
    const n = newName.trim();
    if (n.length < 2) { setMsg({ kind: "error", text: "Nome muito curto (mínimo 2 letras)" }); return; }
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
    setMsg({ kind: "ok", text: `Profile "${n}" criado e ativado.` });
    setTimeout(() => setMsg(null), 3000);
  };

  const switchTo = async (id) => {
    if (id === config?.active_profile_id) return;
    await save({ ...config, active_profile_id: id });
    const p = profiles.find(x => x.id === id);
    setMsg({ kind: "ok", text: `Trocou pro profile "${p?.name}".` });
    setTimeout(() => setMsg(null), 3000);
  };

  // v0.9.3: salva nome E avatar (antes so nome, com onBlur que quebrava no mobile)
  const saveEdit = async (id) => {
    const n = editName.trim();
    if (n.length < 2) { setMsg({ kind: "error", text: "Nome muito curto (mínimo 2 letras)" }); return; }
    const updated = {
      ...config,
      profiles: profiles.map(p => p.id === id ? { ...p, name: n, avatar_id: editAvatarId || p.avatar_id } : p),
    };
    await save(updated);
    setEditingId(null);
    setEditName("");
    setEditAvatarId(null);
    setMsg({ kind: "ok", text: "Perfil atualizado." });
    setTimeout(() => setMsg(null), 2500);
  };

  const del = async (id) => {
    if (profiles.length <= 1) { setMsg({ kind: "error", text: "Não pode deletar o único profile." }); return; }
    if (!(await mConfirm("Deletar esse profile? Tempo/conquistas locais ficam (são por dispositivo)."))) return;
    const newProfiles = profiles.filter(p => p.id !== id);
    const newActive = config.active_profile_id === id ? newProfiles[0].id : config.active_profile_id;
    await save({ ...config, profiles: newProfiles, active_profile_id: newActive });
  };

  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">Perfis ({profiles.length})</div>
      <p className="lmx-settings-hint">
        Múltiplos perfis: cada um com nome + avatar. Use Backup/Sync (acima) pra trazer
        conquistas e favoritos de outro dispositivo.
      </p>

      {profiles.map(p => {
        const isActive = p.id === config?.active_profile_id;
        const av = DEFAULT_AVATARS.find(a => a.id === p.avatar_id) || DEFAULT_AVATARS[0];
        const isEditing = editingId === p.id;
        if (isEditing) {
          // v0.9.3: painel de edicao com nome + avatar + botoes explicitos
          // (sem onBlur, que fechava antes de trocar o avatar no celular)
          return (
            <div key={p.id} style={{ padding: 12, marginBottom: 6, borderRadius: 10, background: "rgba(124,58,237,0.10)", border: "1px solid rgba(124,58,237,0.3)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", marginBottom: 8 }}>Editar perfil</div>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nome do perfil"
                maxLength={28}
                autoFocus
                style={{ width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(124,58,237,0.4)", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 6 }}>Avatar</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 8 }}>
                {DEFAULT_AVATARS.map(a => (
                  <button key={a.id} onClick={() => setEditAvatarId(a.id)} title={a.label}
                    style={{ aspectRatio: "1/1", borderRadius: 8, border: `2px solid ${(editAvatarId || p.avatar_id) === a.id ? "#fff" : "transparent"}`, cursor: "pointer", padding: 0, overflow: "hidden", background: "rgba(0,0,0,0.3)" }}>
                    <img src={avatarUrl(a)} alt={a.label} style={{ width: "100%", height: "100%", display: "block" }} />
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="lmx-settings-btn primary" onClick={() => saveEdit(p.id)} style={{ flex: 1 }}>Salvar</button>
                <button className="lmx-settings-btn ghost" onClick={() => { setEditingId(null); setEditName(""); setEditAvatarId(null); }} style={{ flex: 1 }}>Cancelar</button>
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
              {isActive && <div style={{ fontSize: 10, color: "#c4b5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Ativo</div>}
            </div>
            {!isActive && (
              <button onClick={() => switchTo(p.id)} style={{ background: "#7c3aed", border: "none", color: "#fff", padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                Usar
              </button>
            )}
            <button onClick={() => { setEditingId(p.id); setEditName(p.name); setEditAvatarId(p.avatar_id); }} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", padding: "6px 8px", borderRadius: 6, fontSize: 11 }}>
              Editar
            </button>
            {profiles.length > 1 && !isActive && (
              <button onClick={() => del(p.id)} style={{ background: "rgba(239,68,68,0.15)", border: "none", color: "#ef4444", padding: "6px 8px", borderRadius: 6, fontSize: 11 }}>
                Excluir
              </button>
            )}
          </div>
        );
      })}

      {!creating ? (
        <button className="lmx-settings-btn primary" onClick={() => setCreating(true)} style={{ marginTop: 8 }}>
          + Novo perfil
        </button>
      ) : (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do perfil"
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
            <button className="lmx-settings-btn primary" onClick={create} style={{ flex: 1 }}>Criar</button>
            <button className="lmx-settings-btn ghost" onClick={() => { setCreating(false); setNewName(""); }} style={{ flex: 1 }}>Cancelar</button>
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
    const dayLabel = new Date(dayStart).toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3);
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
      <div className="lmx-settings-label">Estatísticas</div>
      <p className="lmx-settings-hint">Sua atividade no Ludex Mobile (local, este dispositivo).</p>

      {/* Overview cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginTop: 10 }}>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.25)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#c4b5fd" }}>{formatPlayTime(totalSec)}</div>
          <div style={{ fontSize: 11, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 1 }}>Tempo total</div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#86efac" }}>{totalGames}</div>
          <div style={{ fontSize: 11, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1 }}>Jogos</div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(236,72,153,0.12)", border: "1px solid rgba(236,72,153,0.25)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#f9a8d4" }}>{totalSessions}</div>
          <div style={{ fontSize: 11, color: "#f472b6", textTransform: "uppercase", letterSpacing: 1 }}>Sessões</div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#93c5fd" }}>{sysSet.size}</div>
          <div style={{ fontSize: 11, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 1 }}>Sistemas</div>
        </div>
      </div>

      {/* Top 5 mais jogados */}
      {topGames.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Mais jogados</div>
          {topGames.map((g, idx) => (
            <div key={g.path} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: idx < topGames.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div style={{ width: 4, height: 28, background: g.systemColor, borderRadius: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{g.sessions} sessão{g.sessions !== 1 ? "ões" : ""}</div>
              </div>
              <strong style={{ fontSize: 13, color: "#c4b5fd", whiteSpace: "nowrap" }}>{formatPlayTime(g.totalSec)}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Últimos 7 dias - barras simples */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Últimos 7 dias</div>
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
        <div className="lmx-settings-label">Onde baixar jogos / DLCs / Mods</div>
        <p className="lmx-settings-hint">
          Lista de sites populares por categoria — ROMs (Vimm's, Myrient,
          CDRomance), patches PT-BR (Tradu-Roms, Romhacking), DLCs (NoPayStation,
          Hshop). Mesma lista do Windows.
        </p>
        <button className="lmx-settings-btn primary" onClick={() => { sfx.confirm(); setOpen(true); }}>
          Abrir guia de fontes
        </button>
      </section>
      <SuggestionsModal open={open} onClose={() => setOpen(false)} defaultTab="roms" />
    </>
  );
}

// ============================================================
// === LOGS VIEWER CARD (v0.9.1 - paridade Windows) ===========
// ============================================================
// Mostra ultimas 200 linhas do app log. Util quando algum jogo nao abre
// ou app trava - copia o log e me manda. Backend ja tem read_app_logs.
function LogsViewerCard() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("Carregando...");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const t = await invoke("read_app_logs", { maxLines: 200 });
      setText(t || "(log vazio)");
    } catch (e) {
      setText("Erro: " + String(e));
    } finally { setBusy(false); }
  };
  // v0.9.2: clipboard pode falhar no WebView Android. Tenta, e dá feedback;
  // se falhar, o usuario segura no <pre> e seleciona manual.
  const copy = async () => {
    try {
      if (navigator.clipboard) { await navigator.clipboard.writeText(text); mAlert("Log copiado."); return; }
      throw new Error("sem clipboard");
    } catch {
      mAlert("Nao consegui copiar automatico. Segura no texto do log e seleciona/copia manual.");
    }
  };
  return (
    <section className="lmx-settings-card">
      <div className="lmx-settings-label">Logs do app</div>
      <p className="lmx-settings-hint">
        Ultimas 200 linhas. Util quando algum jogo nao abre — copia e me manda.
      </p>
      <button className="lmx-settings-btn primary" onClick={() => { sfx.click(); load(); setOpen(true); }}>
        Abrir logs
      </button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, padding: 16, display: "flex", flexDirection: "column" }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, background: "#0a0420", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong style={{ color: "#c4b5fd" }}>Logs do Ludex</strong>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: 24, cursor: "pointer" }}>×</button>
            </div>
            <pre style={{ flex: 1, overflow: "auto", fontSize: 10, color: "#ddd", whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="lmx-settings-btn" onClick={load} disabled={busy}>{busy ? "Recarregando..." : "Recarregar"}</button>
              <button className="lmx-settings-btn primary" onClick={copy}>Copiar tudo</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
