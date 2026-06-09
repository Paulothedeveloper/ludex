// v0.9.0: SettingsPanel extraido do LudexLauncher.jsx pra reduzir o tamanho do
// arquivo principal. Recebe via props os artefatos module-level do launcher
// (sfx, ambientMusic, THEMES, DEFAULT_CUSTOM_THEME, ACHIEVEMENTS) e os
// sub-componentes (CustomThemeEditor, CollectionStats, TopPlayedList,
// SessionsGraph, LicenseSettingsSection) pra evitar import circular e não
// duplicar codigo. Logica intacta.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  CloseIcon, UserIcon, PowerIcon, RotateIcon, PlusIcon, RefreshIcon,
  FullscreenIcon, CheckIcon, InfoIcon, StarIcon,
} from "./ludexIcons";
import { applyAllSavedOptions } from "./ludexSystemOptions";
import { formatPlayTime } from "./ludexUtils";
import { getProfileAvatarUrl } from "./LudexOnboarding";

export default function SettingsPanel({
  closing, onClose, systems, romsRoot, emulatorsRoot,
  onToggleFullscreen, onQuit, isFullscreen,
  config, onSetTheme, onSetCustomTheme, onPickWallpaper, onClearWallpaper,
  onSyncCovers, syncStatus, onRescan, rescanBusy,
  onOpenProfiles, activeProfile,
  onSetupSwitchKeys, switchKeysStatus,
  // v0.9.35: setup auto-import equivalente pra Wii U e PS Vita
  onSetupWiiuKeys, wiiuKeysStatus,
  onSetupVitaFirmware, vitaFwStatus,
  onToggleSavesIsolation, savesStatus,
  onToggleMusic, onSetMusicVolume,
  onShowLogs, onShowHealth,
  onOpenSuggestions,
  onReplayTour,
  modalGamepadRef,
  // v0.9.0: artefatos module-level do launcher passados via props
  sfx, ambientMusic, THEMES, DEFAULT_CUSTOM_THEME, ACHIEVEMENTS,
  CustomThemeEditor, CollectionStats, TopPlayedList, SessionsGraph,
  LicenseSettingsSection,
}) {
  const [discordId, setDiscordId] = useState(config.discord_app_id || "");
  const [discordStatus, setDiscordStatus] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);
  // v0.9.23: status + download de cores libretro do buildbot oficial.
  const [coresStatus, setCoresStatus] = useState([]); // [{system_id, system_name, core_filename, installed}]
  const [coresExpanded, setCoresExpanded] = useState(false);
  const [coresBusy, setCoresBusy] = useState(false);
  const [coresProgress, setCoresProgress] = useState(null); // {done, total, current, fails:[]}
  const refreshCoresStatus = useCallback(async () => {
    try {
      const list = await invoke("libretro_cores_status");
      setCoresStatus(Array.isArray(list) ? list : []);
    } catch (e) { console.error("cores status", e); }
  }, []);
  useEffect(() => { refreshCoresStatus(); }, [refreshCoresStatus]);
  // v0.9.24: status de BIOS (sem download — copyright). Mostra o user o que falta.
  const [biosStatus, setBiosStatus] = useState([]); // [{system_id, system_name, files:[{name,present}], any_present}]
  const [biosExpanded, setBiosExpanded] = useState(false);
  const refreshBiosStatus = useCallback(async () => {
    try {
      const list = await invoke("bios_status");
      setBiosStatus(Array.isArray(list) ? list : []);
    } catch (e) { console.error("bios status", e); }
  }, []);
  useEffect(() => { refreshBiosStatus(); }, [refreshBiosStatus]);
  // v0.9.25: refactor — uma função generica que aceita lista de cores + force.
  // Usado por downloadMissingCores (faltando + force=false) e updateInstalledCores
  // (instalados + force=true pra atualizar pra nightly mais recente do buildbot).
  const runCoreDownloads = useCallback(async (list, force) => {
    if (coresBusy || list.length === 0) return;
    setCoresBusy(true);
    const fails = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      setCoresProgress({ done: i, total: list.length, current: c.core_filename, fails: [...fails] });
      try {
        await invoke("download_libretro_core", { filename: c.core_filename, force });
      } catch (e) {
        console.warn("[cores] falha", c.core_filename, e);
        fails.push({ filename: c.core_filename, err: String(e) });
      }
    }
    setCoresProgress({ done: list.length, total: list.length, current: null, fails });
    await refreshCoresStatus();
    setCoresBusy(false);
  }, [coresBusy, refreshCoresStatus]);
  const downloadMissingCores = useCallback(() => {
    return runCoreDownloads(coresStatus.filter((c) => !c.installed), false);
  }, [coresStatus, runCoreDownloads]);
  const updateInstalledCores = useCallback(() => {
    return runCoreDownloads(coresStatus.filter((c) => c.installed), true);
  }, [coresStatus, runCoreDownloads]);
  const updateSingleCore = useCallback((filename) => {
    return runCoreDownloads([{ core_filename: filename }], true);
  }, [runCoreDownloads]);
  // v0.8.37: Restaura opções salvas do user (per-system Settings) no boot.
  // v0.8.39: defer pra fora do mount inicial — sequencia de invokes não pode
  // atrasar o setup do polling de gamepad nem do RAF do launcher.
  useEffect(() => {
    // v0.8.45: 0ms (era 250ms paranoia, ja descartada — gamepad bug era outro)
    const t = setTimeout(() => { applyAllSavedOptions().catch(() => {}); }, 0);
    return () => clearTimeout(t);
  }, []);
  // RetroAchievements
  const [raUser, setRaUser] = useState(config.ra_username || "");
  const [raKey, setRaKey] = useState(config.ra_api_key || "");
  const [raSummary, setRaSummary] = useState(null);
  const [raStatus, setRaStatus] = useState(null);
  const [raBusy, setRaBusy] = useState(false);
  const panelRef = useRef(null);
  const [focusIdx, setFocusIdx] = useState(0);
  useEffect(() => { setDiscordId(config.discord_app_id || ""); }, [config.discord_app_id]);
  useEffect(() => { setRaUser(config.ra_username || ""); setRaKey(config.ra_api_key || ""); }, [config.ra_username, config.ra_api_key]);

  // Carrega summary RA on mount se já configurado
  useEffect(() => {
    if (!config.ra_username || !config.ra_api_key) { setRaSummary(null); return; }
    let cancelled = false;
    invoke("ra_get_summary").then((s) => { if (!cancelled) setRaSummary(s); })
      .catch((e) => { if (!cancelled) setRaStatus({ kind: "warn", text: "Falha ao buscar RA: " + String(e).slice(0, 120) }); });
    return () => { cancelled = true; };
  }, [config.ra_username, config.ra_api_key]);

  async function saveRa() {
    if (!raUser.trim() || !raKey.trim()) {
      setRaStatus({ kind: "error", text: "Informe usuário e Web API Key." });
      return;
    }
    setRaBusy(true);
    setRaStatus({ kind: "info", text: "Validando credenciais..." });
    try {
      const summary = await invoke("ra_save_credentials", { username: raUser.trim(), apiKey: raKey.trim() });
      setRaSummary(summary);
      setRaStatus({ kind: "ok", text: `Conectado como ${summary.username}!` });
    } catch (e) {
      setRaStatus({ kind: "error", text: String(e).slice(0, 200) });
    } finally {
      setRaBusy(false);
    }
  }

  async function clearRa() {
    try {
      await invoke("ra_clear_credentials");
      setRaSummary(null);
      setRaUser("");
      setRaKey("");
      setRaStatus({ kind: "ok", text: "RetroAchievements desconectado." });
      setTimeout(() => setRaStatus(null), 2500);
    } catch (e) {
      setRaStatus({ kind: "error", text: String(e) });
    }
  }

  async function refreshRa() {
    setRaBusy(true);
    try {
      const s = await invoke("ra_get_summary");
      setRaSummary(s);
      setRaStatus({ kind: "ok", text: "Atualizado." });
      setTimeout(() => setRaStatus(null), 2000);
    } catch (e) {
      setRaStatus({ kind: "error", text: String(e).slice(0, 200) });
    } finally {
      setRaBusy(false);
    }
  }

  // Coleta elementos focaveis dentro do painel pra navegar com gamepad
  const getFocusables = useCallback(() => {
    if (!panelRef.current) return [];
    return Array.from(panelRef.current.querySelectorAll(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null); // visiveis
  }, []);

  const focusByIdx = useCallback((idx) => {
    const items = getFocusables();
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    setFocusIdx(clamped);
    items.forEach((el, i) => {
      if (i === clamped) {
        el.classList.add("pb-gp-focus");
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      } else {
        el.classList.remove("pb-gp-focus");
      }
    });
  }, [getFocusables]);

  // Foca primeiro item ao montar
  useEffect(() => {
    const t = setTimeout(() => focusByIdx(0), 50);
    return () => clearTimeout(t);
  }, [focusByIdx]);

  // Handler de gamepad
  useEffect(() => {
    if (!modalGamepadRef) return;
    const handler = (action) => {
      if (action === "down") {
        focusByIdx(focusIdx + 1);
        return true;
      }
      if (action === "up") {
        focusByIdx(focusIdx - 1);
        return true;
      }
      if (action === "right" || action === "left") {
        const items = getFocusables();
        const cur = items[focusIdx];
        if (cur) {
          // Se o foco atual eh um botão em sequencia horizontal (theme card, etc), pula 1.
          // Detecta pela proximidade do bounding rect (mesma linha)
          const curRect = cur.getBoundingClientRect();
          const dir = action === "right" ? 1 : -1;
          let target = focusIdx + dir;
          while (target >= 0 && target < items.length) {
            const next = items[target];
            const nextRect = next.getBoundingClientRect();
            if (Math.abs(nextRect.top - curRect.top) < 8) {
              focusByIdx(target);
              return true;
            }
            target += dir;
          }
        }
        focusByIdx(focusIdx + (action === "right" ? 1 : -1));
        return true;
      }
      if (action === "a") {
        const items = getFocusables();
        const cur = items[focusIdx];
        if (cur) cur.click();
        return true;
      }
      if (action === "b") { onClose(); return true; }
      return false;
    };
    modalGamepadRef.current = handler;
    return () => { if (modalGamepadRef.current === handler) modalGamepadRef.current = null; };
  }, [modalGamepadRef, focusIdx, focusByIdx, getFocusables, onClose]);

  async function doCheckUpdate() {
    if (updateBusy) return;
    setUpdateBusy(true);
    setUpdateStatus({ kind: "info", text: "Procurando atualização..." });
    try {
      const update = await checkUpdate();
      if (!update) {
        setUpdateStatus({ kind: "ok", text: "Você já está na versão mais recente!" });
        return;
      }
      setUpdateStatus({ kind: "info", text: `Versão ${update.version} disponível. Baixando...` });
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength || 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength || 0;
          const pct = total ? Math.round((downloaded / total) * 100) : 0;
          setUpdateStatus({ kind: "info", text: `Baixando v${update.version}: ${pct}%` });
        }
        if (event.event === "Finished") setUpdateStatus({ kind: "ok", text: "Download OK. Reiniciando..." });
      });
      await relaunch();
    } catch (e) {
      console.error("update check", e);
      // v0.9.18: quando o release mais recente não tem build pra esta plataforma
      // (ex: release so-APK ou latest.json sem windows-x86_64), o updater lanca
      // "None of the fallback platforms ... were found". Pro usuário isso não e
      // erro — e so "ainda não ha update pra este sistema". Mostra mensagem amigavel.
      const msg = String(e || "");
      if (/fallback platforms|platforms` object|no longer supported|platform/i.test(msg)) {
        setUpdateStatus({ kind: "ok", text: "Você já está na versão mais recente!" });
      } else {
        setUpdateStatus({ kind: "error", text: `Erro: ${e}` });
      }
    } finally {
      setUpdateBusy(false);
    }
  }
  async function saveDiscord() {
    try {
      const ok = await invoke("discord_set_app_id", { appId: discordId.trim() || null });
      setDiscordStatus(ok ? { kind: "ok", text: "Conectado ao Discord!" } : { kind: "warn", text: "Salvo. Discord pode não estar rodando — abre o Discord e tenta de novo." });
    } catch (e) {
      setDiscordStatus({ kind: "error", text: String(e) });
    }
    setTimeout(() => setDiscordStatus(null), 4000);
  }
  const totalPlayTime = activeProfile
    ? Object.values(activeProfile.play_time || {}).reduce((a, b) => a + b, 0)
    : 0;
  const unlocked = activeProfile
    ? ACHIEVEMENTS.filter((a) => (activeProfile.achievements || []).includes(a.id))
    : [];
  const locked = activeProfile
    ? ACHIEVEMENTS.filter((a) => !(activeProfile.achievements || []).includes(a.id))
    : ACHIEVEMENTS;
  return (
    <>
      <div className={`pb-settings-backdrop ${closing ? "closing" : ""}`} onClick={() => { sfx.back(); onClose(); }} />
      <aside ref={panelRef} className={`pb-settings ${closing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <header className="pb-settings-header">
          <h2>Configurações</h2>
          <button className="pb-icon-btn" onClick={() => { sfx.back(); onClose(); }} title="Fechar (Esc)"><CloseIcon /></button>
        </header>

        <div className="pb-settings-section">
          <h3>Perfil ativo</h3>
          {activeProfile ? (
            <button className="pb-active-profile" onClick={() => { sfx.open(); onOpenProfiles(); }}>
              <div className="pb-profile-avatar pb-profile-avatar-sm">
                {(() => {
                  const src = getProfileAvatarUrl(activeProfile, convertFileSrc);
                  return src ? <img src={src} alt="" /> : <UserIcon />;
                })()}
              </div>
              <span>{activeProfile.name}</span>
              <span className="pb-active-profile-action">Trocar</span>
            </button>
          ) : (
            <button className="pb-settings-btn" onClick={() => { sfx.open(); onOpenProfiles(); }}>
              <UserIcon /> Criar perfil
            </button>
          )}
        </div>

        <div className="pb-settings-section">
          <h3>Tema</h3>
          <div className="pb-theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`pb-theme-card ${config.theme_id === t.id ? "active" : ""}`}
                onClick={() => onSetTheme(t.id)}
              >
                <div className="pb-theme-swatch">
                  {t.swatch.map((c, i) => <span key={i} style={{ background: c }} />)}
                </div>
                <span>{t.name}</span>
              </button>
            ))}
            <button
              className={`pb-theme-card ${config.theme_id === "custom" ? "active" : ""}`}
              onClick={() => onSetTheme("custom")}
              title="Tema customizado"
            >
              <div className="pb-theme-swatch">
                {(config.custom_theme ? [config.custom_theme.bg, config.custom_theme.card, config.custom_theme.text] : [DEFAULT_CUSTOM_THEME.bg, DEFAULT_CUSTOM_THEME.card, DEFAULT_CUSTOM_THEME.text]).map((c, i) => <span key={i} style={{ background: c }} />)}
              </div>
              <span>Custom</span>
            </button>
          </div>
          {config.theme_id === "custom" && (
            <CustomThemeEditor
              theme={config.custom_theme || DEFAULT_CUSTOM_THEME}
              onChange={onSetCustomTheme}
            />
          )}
        </div>

        <div className="pb-settings-section">
          <h3>Música ambiente</h3>
          <button
            className={`pb-settings-btn ${config.music_enabled ? "pb-settings-btn-danger" : ""}`}
            onClick={() => { sfx.toggle(); onToggleMusic(); }}
          >
            <PowerIcon />
            {config.music_enabled ? "Desativar música" : "Ativar música"}
          </button>
          {config.music_enabled && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <label className="pb-settings-hint" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ minWidth: 60 }}>Volume</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.music_volume ?? 0.3}
                  onChange={(e) => onSetMusicVolume(parseFloat(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ minWidth: 30, textAlign: "right" }}>{Math.round((config.music_volume ?? 0.3) * 100)}%</span>
              </label>
              <button className="pb-settings-btn" onClick={() => { sfx.click(); ambientMusic.skip(); }}>
                <RotateIcon /> Próxima música
              </button>
            </div>
          )}
          <p className="pb-settings-hint">Playlist embaralhada da pasta <code>music/</code>. Pausa enquanto jogo está aberto.</p>
        </div>

        <div className="pb-settings-section">
          <h3>Papel de parede</h3>
          {config.wallpaper_path && (
            <div className="pb-wallpaper-preview">
              <img src={convertFileSrc(config.wallpaper_path)} alt="" />
              <button className="pb-wallpaper-clear" onClick={onClearWallpaper} title="Remover">
                <CloseIcon />
              </button>
            </div>
          )}
          <button className="pb-settings-btn" style={{ justifyContent: "center" }} onClick={() => { sfx.click(); onPickWallpaper(); }}>
            <PlusIcon />
            {config.wallpaper_path ? "Trocar imagem" : "Escolher imagem"}
          </button>
        </div>

        <div className="pb-settings-section">
          <h3>Capas dos jogos</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onSyncCovers(); }} disabled={syncStatus.busy}>
            <RefreshIcon />
            {syncStatus.busy ? `Sincronizando ${syncStatus.text}...` : "Sincronizar capas (limpa cache)"}
          </button>
          <p className="pb-settings-hint">
            Apaga capas em cache e re-busca pelo IGDB. Use se alguma capa veio errada.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Biblioteca</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onRescan(); }} disabled={rescanBusy}>
            <RefreshIcon />
            {rescanBusy ? "Re-escaneando..." : "Re-escanear pasta de ROMs"}
          </button>
          <p className="pb-settings-hint">
            Detecta jogos novos sem precisar reabrir o app.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Switch — Yuzu</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onSetupSwitchKeys(); }} disabled={switchKeysStatus.busy}>
            <RefreshIcon />
            {switchKeysStatus.busy ? "Copiando..." : "Instalar keys + firmware (Yuzu)"}
          </button>
          {switchKeysStatus.message && (
            <p className="pb-settings-hint" style={{ color: switchKeysStatus.kind === "error" ? "#fca5a5" : "#86efac" }}>
              {switchKeysStatus.message}
            </p>
          )}
          <p className="pb-settings-hint">
            Copia <code>prod.keys</code>, <code>title.keys</code> e firmware NCA da pasta KEYS pra <code>%APPDATA%\yuzu\</code>.
          </p>
        </div>

        {/* v0.9.35: equivalente Wii U */}
        <div className="pb-settings-section">
          <h3>Wii U — Cemu</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onSetupWiiuKeys && onSetupWiiuKeys(); }} disabled={wiiuKeysStatus?.busy}>
            <RefreshIcon />
            {wiiuKeysStatus?.busy ? "Copiando..." : "Instalar keys (Cemu)"}
          </button>
          {wiiuKeysStatus?.message && (
            <p className="pb-settings-hint" style={{ color: wiiuKeysStatus.kind === "error" ? "#fca5a5" : "#86efac" }}>
              {wiiuKeysStatus.message}
            </p>
          )}
          <p className="pb-settings-hint">
            Copia <code>keys.txt</code> (+ <code>otp.bin</code> / <code>seeprom.bin</code> opcionais) da pasta <code>roms/KEYS/</code> pra <code>emulators/CEMU/Cemu_2.6/</code>.
          </p>
        </div>

        {/* v0.9.35: equivalente PS Vita */}
        <div className="pb-settings-section">
          <h3>PS Vita — Vita3K</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onSetupVitaFirmware && onSetupVitaFirmware(); }} disabled={vitaFwStatus?.busy}>
            <RefreshIcon />
            {vitaFwStatus?.busy ? "Copiando..." : "Instalar firmware (Vita3K)"}
          </button>
          {vitaFwStatus?.message && (
            <p className="pb-settings-hint" style={{ color: vitaFwStatus.kind === "error" ? "#fca5a5" : "#86efac" }}>
              {vitaFwStatus.message}
            </p>
          )}
          <p className="pb-settings-hint">
            Copia <code>PSVITAUPDAT.PUP</code> da pasta <code>roms/KEYS/</code> pra <code>emulators/VITA/</code>. Depois abra o Vita3K, Welcome wizard, aponte o PUP.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Saves separados por perfil</h3>
          <button
            className={`pb-settings-btn ${savesStatus.enabled ? "pb-settings-btn-danger" : ""}`}
            onClick={() => { sfx.toggle(); onToggleSavesIsolation(); }}
            disabled={savesStatus.busy || !activeProfile}
          >
            <PowerIcon />
            {savesStatus.busy ? "Aplicando..." : (savesStatus.enabled ? "Desativar (restaurar pasta unica)" : "Ativar (saves separados)")}
          </button>
          {savesStatus.message && (
            <p className="pb-settings-hint" style={{ color: savesStatus.kind === "error" ? "#fca5a5" : "#86efac", whiteSpace: "pre-wrap" }}>
              {savesStatus.message}
            </p>
          )}
          <p className="pb-settings-hint">
            Quando ativo, cada perfil tem saves proprios (Yuzu, PCSX2, Dolphin, DuckStation, RPCS3, Project64). Trocar perfil = troca os saves automaticamente. Funciona via junctions Windows (NTFS).
          </p>
        </div>

        {activeProfile && (
          <div className="pb-settings-section">
            <h3>Estatisticas — {activeProfile.name}</h3>
            <div className="pb-stats">
              <div className="pb-stat"><strong>{activeProfile.total_launches || 0}</strong><span>jogos lancados</span></div>
              <div className="pb-stat"><strong>{(activeProfile.favorites || []).length}</strong><span>favoritos</span></div>
              <div className="pb-stat"><strong>{formatPlayTime(totalPlayTime)}</strong><span>tempo total</span></div>
              <div className="pb-stat"><strong>{Object.keys(activeProfile.play_time || {}).length}</strong><span>jogos abertos</span></div>
            </div>
            <CollectionStats gameMeta={activeProfile.game_meta || {}} systems={systems} />
            <TopPlayedList playTime={activeProfile.play_time || {}} sessions={activeProfile.sessions || []} systems={systems} />
            <SessionsGraph sessions={activeProfile.sessions} />
          </div>
        )}

        {activeProfile && (
          <div className="pb-settings-section">
            <h3>Conquistas ({unlocked.length}/{ACHIEVEMENTS.length})</h3>
            <ul className="pb-achievement-list">
              {[...unlocked, ...locked].map((a) => {
                const isUnlocked = unlocked.includes(a);
                return (
                  <li key={a.id} className={isUnlocked ? "unlocked" : "locked"}>
                    <span className="pb-achievement-list-icon"><StarIcon filled={isUnlocked} /></span>
                    <div>
                      <strong>{a.name}</strong>
                      <span>{a.desc}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <LicenseSettingsSection />

        <div className="pb-settings-section">
          <h3>Atualizações</h3>
          <div className="pb-version-line">
            <span className="pb-version-label">Versão instalada:</span>
            <strong className="pb-version-current">v{appVersion || "?"}</strong>
          </div>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); doCheckUpdate(); }} disabled={updateBusy}>
            <RefreshIcon /> {updateBusy ? "Verificando..." : "Verificar atualização"}
          </button>
          {updateStatus && (
            <p className="pb-settings-hint" style={{ color: updateStatus.kind === "error" ? "#fca5a5" : updateStatus.kind === "ok" ? "#86efac" : "#fcd34d" }}>
              {updateStatus.text}
            </p>
          )}
          <p className="pb-settings-hint" style={{ marginTop: 6 }}>
            Verifica novas versões em <code>github.com/EllaeMyApp/ludex</code>. Baixa e reinicia automaticamente.
          </p>
        </div>

        {/* v0.9.23: cores libretro — status + auto-download do buildbot oficial */}
        <div className="pb-settings-section">
          <h3>Cores libretro</h3>
          {(() => {
            const total = coresStatus.length;
            const installed = coresStatus.filter((c) => c.installed).length;
            const missing = total - installed;
            return (
              <p className="pb-settings-hint" style={{ marginTop: 0 }}>
                <strong>{installed}/{total}</strong> cores instalados em <code>cores/</code>
                {missing > 0 ? ` — ${missing} faltando.` : ` — tudo certo!`}
                {missing > 0 && " Sem o .dll certo, o emulador crasha ou não identifica os jogos."}
              </p>
            );
          })()}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {coresStatus.some((c) => !c.installed) && (
              <button
                className="pb-settings-btn"
                onClick={() => { sfx.click(); downloadMissingCores(); }}
                disabled={coresBusy}
              >
                {coresBusy
                  ? (coresProgress ? `Baixando ${coresProgress.done + 1}/${coresProgress.total}: ${coresProgress.current || "..."}` : "Baixando...")
                  : `Baixar ${coresStatus.filter((c) => !c.installed).length} cores faltando`}
              </button>
            )}
            {coresStatus.some((c) => c.installed) && (
              <button
                className="pb-settings-btn"
                onClick={() => { sfx.click(); updateInstalledCores(); }}
                disabled={coresBusy}
                title="Re-baixa cada core instalado pra versão nightly mais recente do buildbot"
              >
                {coresBusy && coresProgress?.current
                  ? `${coresProgress.done + 1}/${coresProgress.total}: ${coresProgress.current}`
                  : `Atualizar ${coresStatus.filter((c) => c.installed).length} cores instalados`}
              </button>
            )}
          </div>
          {coresProgress && !coresBusy && (
            <p className="pb-settings-hint" style={{ marginTop: 6, color: coresProgress.fails.length > 0 ? "#fcd34d" : "#86efac" }}>
              {coresProgress.fails.length === 0
                ? `OK — ${coresProgress.done} cores baixados.`
                : `${coresProgress.done - coresProgress.fails.length} OK, ${coresProgress.fails.length} falharam (talvez não existam no buildbot pra este target).`}
            </p>
          )}
          <button
            className="pb-settings-btn"
            onClick={() => { sfx.click(); setCoresExpanded((v) => !v); }}
            style={{ marginTop: 8 }}
          >
            {coresExpanded ? "Esconder lista" : "Ver lista completa"}
          </button>
          {coresExpanded && (
            <div style={{ marginTop: 8, maxHeight: 280, overflowY: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 8 }}>
              {coresStatus.map((c) => (
                <div key={c.system_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 6px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <strong>{c.system_name}</strong> <code style={{ opacity: 0.7, fontSize: 11 }}>{c.core_filename}</code>
                  </span>
                  <span style={{ fontSize: 11, color: c.installed ? "#86efac" : "#fca5a5", flexShrink: 0 }}>
                    {c.installed ? "OK" : "FALTANDO"}
                  </span>
                  <button
                    className="pb-settings-btn"
                    style={{ padding: "2px 8px", fontSize: 11, flexShrink: 0 }}
                    disabled={coresBusy}
                    onClick={() => { sfx.click(); c.installed ? updateSingleCore(c.core_filename) : runCoreDownloads([c], false); }}
                    title={c.installed ? "Re-baixar do buildbot (atualizar)" : "Baixar do buildbot"}
                  >
                    {c.installed ? "↻" : "↓"}
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            className="pb-settings-btn"
            onClick={async () => { sfx.click(); try { await invoke("open_cores_folder"); } catch (e) { console.error(e); } }}
            style={{ marginTop: 8 }}
          >
            Abrir pasta cores/
          </button>
          <p className="pb-settings-hint" style={{ marginTop: 6 }}>
            Fonte: <code>buildbot.libretro.com/nightly/windows/x86_64/latest/</code>. Cada core e um .dll dentro de um .zip — Ludex baixa, extrai e instala automaticamente.
          </p>
        </div>

        {/* v0.9.24: BIOS — status + auto-import (sem download direto: copyright). */}
        <div className="pb-settings-section">
          <h3>BIOS dos emuladores</h3>
          {(() => {
            const sysWithBios = biosStatus.length;
            const sysOK = biosStatus.filter((s) => s.any_present).length;
            const sysMiss = sysWithBios - sysOK;
            return (
              <p className="pb-settings-hint" style={{ marginTop: 0 }}>
                <strong>{sysOK}/{sysWithBios}</strong> sistemas com BIOS presente
                {sysMiss > 0 ? ` — ${sysMiss} sem BIOS (PS1, PS2, Dreamcast, Saturn, 3DO, Jaguar etc dependem dela pra rodar).` : ` — tudo certo!`}
              </p>
            );
          })()}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button
              className="pb-settings-btn"
              onClick={async () => {
                sfx.click();
                try {
                  const n = await invoke("bios_try_auto_import");
                  if (n > 0) alert(`Importei ${n} BIOS de PCSX2/bios, RetroArch/system, Documents, Downloads etc.`);
                  else alert("Nada novo. Pra importar automático, cola os .bin em D:\\BIOS, C:\\BIOS, Documents\\PCSX2\\bios, emulators\\PCSX2\\bios ou Downloads\\.");
                  await refreshBiosStatus();
                } catch (e) { alert("Falha: " + e); }
              }}
            >
              Tentar auto-import
            </button>
            <button
              className="pb-settings-btn"
              onClick={async () => {
                sfx.click();
                if (!confirm("Vou varrer D:\\, E:\\, F:\\, G:\\ e sua pasta de usuário inteira atras de arquivos com nome de BIOS (scph5500.bin, dc_boot.bin, sega_101.bin etc). Pode demorar 30s-2min. Continuar?")) return;
                try {
                  const n = await invoke("bios_deep_scan");
                  if (n > 0) alert(`Deep-scan importou ${n} BIOS pra system\\.`);
                  else alert("Deep-scan não achou nenhum arquivo com nome de BIOS conhecida. Voce precisa baixar manualmente (BIOS sao copyright).");
                  await refreshBiosStatus();
                } catch (e) { alert("Falha: " + e); }
              }}
              title="Varre D:\\, outras unidades e a home do usuário atras de BIOS no PC inteiro"
            >
              Procurar BIOS no PC inteiro
            </button>
            <button
              className="pb-settings-btn"
              onClick={async () => { sfx.click(); try { await invoke("open_system_folder"); } catch (e) { console.error(e); } }}
            >
              Abrir pasta system\
            </button>
            <button
              className="pb-settings-btn"
              onClick={() => { sfx.click(); setBiosExpanded((v) => !v); }}
            >
              {biosExpanded ? "Esconder lista" : "Ver lista detalhada"}
            </button>
          </div>
          {biosExpanded && (
            <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 8 }}>
              {biosStatus.map((s) => (
                <div key={s.system_id} style={{ padding: "6px 6px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 13 }}>{s.system_name}</strong>
                    <span style={{ fontSize: 11, color: s.any_present ? "#86efac" : "#fca5a5" }}>
                      {s.any_present ? "OK" : "FALTANDO"}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.75 }}>
                    {s.files.map((f) => (
                      <span key={f.name} style={{ marginRight: 10, color: f.present ? "#86efac" : "rgba(255,255,255,0.5)" }}>
                        {f.present ? "✓" : "·"} {f.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="pb-settings-hint" style={{ marginTop: 6 }}>
            BIOS sao arquivos protegidos por copyright — Ludex não baixa por você. Cola o .bin em qualquer uma das pastas conhecidas (D:\BIOS, Documents\PCSX2\bios, Downloads, etc) e clica em "Tentar auto-import", ou cola direto em <code>system\</code>.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Onde baixar jogos / DLCs / mods</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onOpenSuggestions && onOpenSuggestions(); }}>
            <PlusIcon /> Abrir guia de fontes
          </button>
          <p className="pb-settings-hint" style={{ marginTop: 6 }}>
            Lista de sites populares por categoria (ROMs, traduções PT-BR, mods de FPS/resolução, DLCs). Aviso legal e dicas pra evitar quebrar saves.
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Discord Rich Presence</h3>
          <p className="pb-settings-hint" style={{ marginBottom: 10 }}>
            Mostra o jogo que você tá jogando no seu perfil do Discord.
            Crie uma "Application" em <code>discord.com/developers/applications</code> e cole o <strong>Client ID</strong> abaixo.
          </p>
          <input
            type="text"
            className="pb-input"
            placeholder="Discord Application ID (ex: 1234567890123456789)"
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <button className="pb-settings-btn" onClick={() => { sfx.click(); saveDiscord(); }}>
            <RefreshIcon /> Salvar e conectar
          </button>
          {discordStatus && (
            <p className="pb-settings-hint" style={{ color: discordStatus.kind === "error" ? "#fca5a5" : discordStatus.kind === "warn" ? "#fcd34d" : "#86efac" }}>
              {discordStatus.text}
            </p>
          )}
        </div>

        <div className="pb-settings-section">
          <h3>RetroAchievements</h3>
          {raSummary ? (
            <div className="pb-ra-card">
              <div className="pb-ra-header">
                <img className="pb-ra-avatar" src={raSummary.avatar_url} alt={raSummary.username} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <div className="pb-ra-meta">
                  <strong className="pb-ra-username">{raSummary.username}</strong>
                  <span className="pb-ra-points">{raSummary.total_points.toLocaleString()} pts</span>
                  {raSummary.rank > 0 && <span className="pb-ra-rank">Rank #{raSummary.rank.toLocaleString()}{raSummary.total_ranked > 0 ? ` / ${raSummary.total_ranked.toLocaleString()}` : ""}</span>}
                </div>
              </div>
              {raSummary.last_game_title && (
                <div className="pb-ra-last">
                  {raSummary.last_game_image_url && <img src={raSummary.last_game_image_url} alt="" />}
                  <div>
                    <span className="pb-ra-last-label">Último jogo</span>
                    <strong>{raSummary.last_game_title}</strong>
                    {raSummary.rich_presence_msg && <em>{raSummary.rich_presence_msg}</em>}
                  </div>
                </div>
              )}
              {raSummary.recent_achievements.length > 0 && (
                <>
                  <h4 className="pb-ra-sub">Conquistas recentes ({raSummary.recent_achievements.length})</h4>
                  <ul className="pb-ra-ach-list">
                    {raSummary.recent_achievements.slice(0, 8).map((a, i) => (
                      <li key={i} className={`pb-ra-ach ${a.hardcore ? "hardcore" : ""}`}>
                        {a.badge_url && <img className="pb-ra-ach-badge" src={a.badge_url} alt="" />}
                        <div className="pb-ra-ach-body">
                          <div className="pb-ra-ach-row">
                            <strong>{a.title}</strong>
                            <span className="pb-ra-ach-points">{a.points} pts{a.hardcore ? " · 🔥" : ""}</span>
                          </div>
                          <span className="pb-ra-ach-desc">{a.description}</span>
                          <span className="pb-ra-ach-game">{a.game_title} · {a.console_name}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="pb-settings-btn" onClick={() => { sfx.click(); refreshRa(); }} disabled={raBusy}>
                  <RefreshIcon /> {raBusy ? "..." : "Atualizar"}
                </button>
                <button className="pb-settings-btn pb-settings-btn-danger" onClick={() => { sfx.back(); clearRa(); }}>
                  <PowerIcon /> Desconectar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="pb-settings-hint" style={{ marginBottom: 10 }}>
                Mostra suas conquistas, pontos e ranking do <code>retroachievements.org</code>.
                Pegue sua <strong>Web API Key</strong> em <code>retroachievements.org/controlpanel.php</code>.
              </p>
              <input
                type="text"
                className="pb-input"
                placeholder="Username RA"
                value={raUser}
                onChange={(e) => setRaUser(e.target.value)}
                style={{ marginBottom: 8 }}
                autoComplete="off"
                spellCheck={false}
              />
              <input
                type="password"
                className="pb-input"
                placeholder="Web API Key (32 caracteres)"
                value={raKey}
                onChange={(e) => setRaKey(e.target.value)}
                style={{ marginBottom: 10 }}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="pb-settings-btn" onClick={() => { sfx.click(); saveRa(); }} disabled={raBusy}>
                <RefreshIcon /> {raBusy ? "Validando..." : "Conectar"}
              </button>
            </>
          )}
          {raStatus && (
            <p className="pb-settings-hint" style={{ color: raStatus.kind === "error" ? "#fca5a5" : raStatus.kind === "warn" ? "#fcd34d" : raStatus.kind === "info" ? "#a5b4fc" : "#86efac" }}>
              {raStatus.text}
            </p>
          )}
        </div>

        <div className="pb-settings-section">
          <h3>Pasta de ROMs</h3>
          <code className="pb-settings-path">{romsRoot}</code>
        </div>

        <div className="pb-settings-section">
          <h3>Pasta dos Emuladores</h3>
          <code className="pb-settings-path">{emulatorsRoot}</code>
        </div>

        <div className="pb-settings-section">
          <h3>Emuladores</h3>
          <ul className="pb-settings-list">
            {systems.map((s) => (
              <li key={s.id}>
                <span className={`pb-status ${s.emulator_exists ? "ok" : "fail"}`} />
                <div className="pb-settings-list-info">
                  <strong>{s.name}</strong>
                  <code>{s.emulator_path}</code>
                </div>
                <span className="pb-settings-list-count">{s.games.length}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pb-settings-section">
          <h3>Atalhos</h3>
          <dl className="pb-shortcuts">
            <dt>← →</dt><dd>Navegar jogo</dd>
            <dt>↑ ↓</dt><dd>Navegar sistema</dd>
            <dt>ENTER</dt><dd>Lançar jogo</dd>
            <dt>F</dt><dd>Marcar favorito</dd>
            <dt>/</dt><dd>Buscar jogo</dd>
            <dt>S</dt><dd>Configurações</dd>
            <dt>P</dt><dd>Trocar perfil</dd>
            <dt>F11</dt><dd>Tela cheia</dd>
            <dt>ESC</dt><dd>Voltar / Fechar painel</dd>
          </dl>
          <p className="pb-settings-hint" style={{ marginTop: 12 }}>
            Controle: D-Pad/Stick = navegar · A = lançar · X = perfil · Y = config · Select+Start (no jogo) = sair pro launcher
          </p>
        </div>

        <div className="pb-settings-section">
          <h3>Sistema</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.toggle(); onToggleFullscreen(); }}>
            <FullscreenIcon />
            {isFullscreen ? "Sair da Tela Cheia" : "Entrar em Tela Cheia"}
          </button>
          <button className="pb-settings-btn pb-settings-btn-danger" onClick={() => { sfx.back(); onQuit(); }}>
            <PowerIcon /> Sair do Ludex
          </button>
        </div>

        <div className="pb-settings-section">
          <h3>Diagnóstico</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onShowHealth && onShowHealth(); }}>
            <CheckIcon /> Health Check dos emuladores
          </button>
          <p className="pb-settings-hint">Verifica setup de cada emulador (.exe presente, ROMs detectadas, BIOS Xbox, etc).</p>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onShowLogs(); }}>
            <InfoIcon /> Ver logs do app
          </button>
          <p className="pb-settings-hint">Útil quando algum jogo não abre — mostra as últimas 200 linhas do log.</p>
        </div>

        {/* v0.9.34: re-abrir tour spotlight pra rever cada feature do launcher */}
        <div className="pb-settings-section">
          <h3>Tutorial</h3>
          <button className="pb-settings-btn" onClick={() => { sfx.click(); onReplayTour && onReplayTour(); }}>
            <InfoIcon /> Ver tutorial novamente
          </button>
          <p className="pb-settings-hint">Refaz o passo a passo da home (topbar, busca, sortear, sistemas, grid, ajustes) com destaque em cada elemento.</p>
        </div>

        {/* v0.9.1: Sincroniza perfil + conquistas + favoritos + game_meta + recents
            entre PC <-> Celular via export/import manual de JSON. Mesma license
            unlock em ambos = mesmo direito de usar; sync de dados via copy/paste. */}
        <DesktopBackupRestoreSection sfx={sfx} />

        <footer className="pb-settings-footer">Ludex · v0.9</footer>
      </aside>
    </>
  );
}

/**
 * v0.9.1: Export/Import config (desktop equivalente do BackupRestoreCard do mobile).
 * Exporta o config.json inteiro (profiles + game_meta + favorites + play_time +
 * achievements + sessions) como string. Import faz merge no profile ativo.
 *
 * Use case: user usa Ludex no Windows E no celular com a MESMA license.
 * Quer conquista, favoritos e tempo de jogo sincronizados entre dispositivos.
 * Como não temos backend (Gumroad não guarda dados), sync e manual:
 *   - PC: copia config (Export). Cola no celular > Ajustes > Backup > Importar.
 *   - Celular -> PC: idem na direcao inversa.
 */
function DesktopBackupRestoreSection({ sfx }) {
  const [msg, setMsg] = useState(null);

  const doExport = async () => {
    try {
      const cfg = await invoke("load_config");
      const json = JSON.stringify(cfg, null, 2);
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(json);
        setMsg({ kind: "ok", text: `Config copiada (${(json.length / 1024).toFixed(1)} KB). Cola no celular > Ajustes > Backup > Importar.` });
      } else {
        setMsg({ kind: "info", text: "Clipboard indisponivel. Veja console pra JSON." });
        console.log(json);
      }
      try { sfx.confirm(); } catch {}
    } catch (e) {
      setMsg({ kind: "error", text: `Falha: ${e}` });
    }
    setTimeout(() => setMsg(null), 8000);
  };

  const doImport = async () => {
    const json = window.prompt("Cola aqui o JSON da config exportada (do celular ou de outro PC):");
    if (!json) return;
    try {
      const cfg = JSON.parse(json);
      if (!cfg.profiles || !Array.isArray(cfg.profiles)) {
        throw new Error("JSON invalido — falta 'profiles'");
      }
      await invoke("save_config", { config: cfg });
      setMsg({ kind: "ok", text: "Config importada! Reinicie o app pra ver perfil/conquistas atualizados." });
      try { sfx.confirm(); } catch {}
    } catch (e) {
      setMsg({ kind: "error", text: `Falha ao importar: ${e.message || e}` });
    }
    setTimeout(() => setMsg(null), 8000);
  };

  return (
    <div className="pb-settings-section">
      <h3>Backup / Sync com Celular</h3>
      <p className="pb-settings-hint">
        Exporta perfil + conquistas + favoritos + tempo de jogo como JSON. No
        celular, abre Ajustes &gt; Backup e cola pra ter o mesmo progresso.
        (Sync automático via license key exigiria servidor — ainda não implementado.)
      </p>
      <button className="pb-settings-btn" onClick={doExport}>
        Copiar config (Export)
      </button>
      <button className="pb-settings-btn" onClick={doImport}>
        Colar config (Import)
      </button>
      {msg && (
        <p style={{
          marginTop: 8, padding: "8px 10px", borderRadius: 6, fontSize: "0.85em",
          background: msg.kind === "ok" ? "rgba(34,197,94,0.15)" : msg.kind === "error" ? "rgba(239,68,68,0.15)" : "rgba(96,165,250,0.15)",
          color: msg.kind === "ok" ? "#22c55e" : msg.kind === "error" ? "#ef4444" : "#60a5fa",
          border: `1px solid ${msg.kind === "ok" ? "rgba(34,197,94,0.3)" : msg.kind === "error" ? "rgba(239,68,68,0.3)" : "rgba(96,165,250,0.3)"}`,
        }}>{msg.text}</p>
      )}
    </div>
  );
}
