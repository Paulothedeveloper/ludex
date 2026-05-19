// v0.9.0: SettingsPanel extraido do LudexLauncher.jsx pra reduzir o tamanho do
// arquivo principal. Recebe via props os artefatos module-level do launcher
// (sfx, ambientMusic, THEMES, DEFAULT_CUSTOM_THEME, ACHIEVEMENTS) e os
// sub-componentes (CustomThemeEditor, CollectionStats, TopPlayedList,
// SessionsGraph, LicenseSettingsSection) pra evitar import circular e nao
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
  onToggleSavesIsolation, savesStatus,
  onToggleMusic, onSetMusicVolume,
  onShowLogs, onShowHealth,
  onOpenSuggestions,
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
  // v0.8.37: Restaura opcoes salvas do user (per-system Settings) no boot.
  // v0.8.39: defer pra fora do mount inicial — sequencia de invokes nao pode
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
      setRaStatus({ kind: "error", text: "Informe usuario e Web API Key." });
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
          // Se o foco atual eh um botao em sequencia horizontal (theme card, etc), pula 1.
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
      setUpdateStatus({ kind: "error", text: `Erro: ${e}` });
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
          <h2>Configuracoes</h2>
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
            <dt>ENTER</dt><dd>Lancar jogo</dd>
            <dt>F</dt><dd>Marcar favorito</dd>
            <dt>/</dt><dd>Buscar jogo</dd>
            <dt>S</dt><dd>Configuracoes</dd>
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

        <footer className="pb-settings-footer">Ludex · v0.4</footer>
      </aside>
    </>
  );
}
