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
  // Sony (so PS1 e PSP tem core libretro ARM)
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
  const launchGame = useCallback(async (system, game) => {
    setLaunching(true);
    try {
      await invoke("launch_game", { systemId: system.id, romPath: game.path });
    } catch (e) {
      console.error("launch_game", e);
      alert(`Falha ao iniciar: ${e}`);
    } finally {
      setTimeout(() => setLaunching(false), 1500);
    }
  }, []);

  // ============ DEMO EXPIRED (bloqueia) ============
  if (androidDemo?.expired && !androidDemo?.is_admin_unlocked) {
    return <DemoExpiredScreen demo={androidDemo} onUnlock={setAndroidDemo} />;
  }

  // ============ GAME DETAIL (full screen modal) ============
  if (openGame) {
    return (
      <GameDetailScreen
        system={openGame.system}
        game={openGame.game}
        coverSrc={covers[openGame.game.path]}
        onClose={() => setOpenGame(null)}
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
        onBack={() => setOpenSystem(null)}
        onPickGame={(game) => setOpenGame({ system: openSystem, game })}
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
            onPickSystem={(sys) => setOpenSystem(sys)}
            onPickGame={(system, game) => setOpenGame({ system, game })}
          />
        )}
        {activeTab === "systems" && (
          <SystemsTab
            systems={systems}
            onPickSystem={(sys) => setOpenSystem(sys)}
          />
        )}
        {activeTab === "search" && (
          <SearchTab
            systems={systems}
            covers={covers}
            search={search}
            setSearch={setSearch}
            onPickGame={(system, game) => setOpenGame({ system, game })}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            activeProfile={activeProfile}
            androidDemo={androidDemo}
            onAdminUnlock={setAndroidDemo}
          />
        )}
      </main>

      {/* Bottom tab bar (estilo iOS/Android nativo) */}
      <nav className="lmx-tabs">
        <TabBtn icon={<IconHome />} label="Inicio" active={activeTab === "home"} onClick={() => setActiveTab("home")} />
        <TabBtn icon={<IconGrid />} label="Sistemas" active={activeTab === "systems"} onClick={() => setActiveTab("systems")} />
        <TabBtn icon={<IconSearch />} label="Buscar" active={activeTab === "search"} onClick={() => setActiveTab("search")} />
        <TabBtn icon={<IconSettings />} label="Ajustes" active={activeTab === "settings"} onClick={() => setActiveTab("settings")} />
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
function HomeTab({ systems, covers, activeProfile, androidDemo, loading, onPickSystem, onPickGame }) {
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
          <p>
            Coloque suas ROMs em <br />
            <code>/storage/emulated/0/Ludex/roms/&lt;sistema&gt;/</code>
            <br />
            e volte aqui.
          </p>
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
function SettingsTab({ activeProfile, androidDemo, onAdminUnlock }) {
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
        <div className="lmx-settings-label">Pastas</div>
        <div className="lmx-settings-paths">
          <div><strong>ROMs:</strong> <code>/storage/emulated/0/Ludex/roms/</code></div>
          <div><strong>BIOS:</strong> <code>/storage/emulated/0/Ludex/system/</code></div>
          <div><strong>Saves:</strong> <code>/storage/emulated/0/Ludex/saves-libretro/</code></div>
        </div>
        <p className="lmx-settings-hint">
          Crie as pastas acima e coloque suas ROMs/BIOS la. O Ludex detecta automaticamente.
        </p>
      </section>

      <section className="lmx-settings-card">
        <div className="lmx-settings-label">Sobre</div>
        <div className="lmx-settings-value">Ludex Android v0.8.0</div>
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
function SystemScreen({ system, covers, onBack, onPickGame }) {
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
            Coloque ROMs em <br />
            <code>/storage/emulated/0/Ludex/roms/{system.folder_name}/</code>
          </p>
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
