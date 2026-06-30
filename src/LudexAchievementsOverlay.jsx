import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./ludexI18n";

/**
 * v1.0: Overlay dedicado de RetroAchievements (mais bonito que o card enterrado
 * nos Ajustes). Reusa o comando ra_get_summary que já existe. Mostra avatar,
 * pontos, rank, último jogo (rich presence) e conquistas recentes com badges.
 *
 * NOTA: isto NÃO é detecção de unlock em tempo real (isso exigiria rcheevos no
 * loop de emulação). É a vitrine do perfil + progresso recente do usuário.
 */
export default function LudexAchievementsOverlay({ open, onClose }) {
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => {
    setBusy(true); setErr(null);
    return invoke("ra_get_summary")
      .then((s) => setSummary(s))
      .catch((e) => { setErr(String(e)); setSummary(null); })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    invoke("ra_get_summary")
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch((e) => { if (!cancelled) { setErr(String(e)); setSummary(null); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const S = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)", zIndex: 100060, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
    panel: { width: "min(680px, 94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--theme-surface, #1f1f1f)", border: "1px solid var(--theme-border, #3a3a3a)", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.6)", animation: "lxra-in .22s cubic-bezier(.22,1,.36,1)" },
    header: { padding: "20px 22px", background: "var(--lx-grad, linear-gradient(135deg,#7c3aed,#ec4899))", display: "flex", alignItems: "center", gap: 16, position: "relative" },
    avatar: { width: 64, height: 64, borderRadius: 12, border: "2px solid rgba(255,255,255,.5)", objectFit: "cover", background: "rgba(0,0,0,.2)" },
    close: { position: "absolute", top: 12, right: 14, width: 32, height: 32, borderRadius: "50%", border: 0, background: "rgba(0,0,0,.28)", color: "#fff", fontSize: 18, cursor: "pointer" },
    body: { padding: 18, overflowY: "auto" },
    achList: { display: "grid", gridTemplateColumns: "1fr", gap: 8, margin: "6px 0 0", padding: 0, listStyle: "none" },
  };

  const noCreds = !!err || !summary;

  return (
    <div style={S.backdrop} onClick={onClose}>
      <style>{`@keyframes lxra-in{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
        .lxra-ach{display:flex;gap:12px;align-items:center;padding:10px;border-radius:12px;background:var(--theme-card,#2a2a2a)}
        .lxra-ach.hc{outline:1px solid rgba(245,158,11,.6)}
        .lxra-ach img{width:48px;height:48px;border-radius:8px;flex:0 0 auto}
        .lxra-ach-title{font-weight:700;color:var(--theme-text,#fff);font-size:14px}
        .lxra-ach-desc{font-size:12px;color:var(--theme-muted,#aaa);display:block;margin-top:2px}
        .lxra-ach-game{font-size:11px;color:var(--theme-muted,#aaa);opacity:.8}
        .lxra-pts{margin-left:auto;font-weight:800;color:#a78bfa;white-space:nowrap}
        .lxra-btn{padding:9px 16px;border-radius:9px;border:1px solid var(--theme-border,#3a3a3a);background:var(--theme-card,#2a2a2a);color:var(--theme-text,#fff);cursor:pointer;font-family:inherit;font-size:13px}`}</style>
      <div style={S.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="RetroAchievements">
        {noCreds ? (
          <>
            <div style={{ ...S.header, justifyContent: "space-between" }}>
              <strong style={{ color: "#fff", fontSize: 20 }}>RetroAchievements</strong>
              <button style={S.close} onClick={onClose} aria-label={t("Fechar")}>×</button>
            </div>
            <div style={S.body}>
              <p style={{ color: "var(--theme-muted,#aaa)", lineHeight: 1.5 }}>
                {busy ? t("Carregando...") : t("Conecte sua conta RetroAchievements em Configurações → RetroAchievements para ver pontos, ranking e conquistas recentes aqui.")}
              </p>
            </div>
          </>
        ) : (
          <>
            <div style={S.header}>
              <img style={S.avatar} src={summary.avatar_url} alt={summary.username} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              <div style={{ color: "#fff" }}>
                <strong style={{ fontSize: 20, display: "block" }}>{summary.username}</strong>
                <span style={{ fontWeight: 800 }}>{t("{points} pts", { points: Number(summary.total_points || 0).toLocaleString() })}</span>
                {summary.rank > 0 && (
                  <span style={{ marginLeft: 10, opacity: .9 }}>
                    {t("Rank #{rank}", { rank: Number(summary.rank).toLocaleString() })}
                    {summary.total_ranked > 0 ? ` / ${Number(summary.total_ranked).toLocaleString()}` : ""}
                  </span>
                )}
              </div>
              <button style={S.close} onClick={onClose} aria-label={t("Fechar")}>×</button>
            </div>
            <div style={S.body}>
              {summary.last_game_title && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
                  {summary.last_game_image_url && <img src={summary.last_game_image_url} alt="" style={{ width: 56, height: 56, borderRadius: 10 }} />}
                  <div>
                    <span style={{ fontSize: 11, color: "var(--theme-muted,#aaa)", textTransform: "uppercase", letterSpacing: ".05em" }}>{t("Último jogo")}</span>
                    <strong style={{ display: "block", color: "var(--theme-text,#fff)" }}>{summary.last_game_title}</strong>
                    {summary.rich_presence_msg && <em style={{ fontSize: 12, color: "var(--theme-muted,#aaa)" }}>{summary.rich_presence_msg}</em>}
                  </div>
                </div>
              )}
              {summary.recent_achievements && summary.recent_achievements.length > 0 ? (
                <>
                  <h4 style={{ margin: "0 0 8px", color: "var(--theme-text,#fff)" }}>
                    {t("Conquistas recentes ({count})", { count: summary.recent_achievements.length })}
                  </h4>
                  <ul style={S.achList}>
                    {summary.recent_achievements.slice(0, 20).map((a, i) => (
                      <li key={i} className={`lxra-ach ${a.hardcore ? "hc" : ""}`}>
                        {a.badge_url && <img src={a.badge_url} alt="" />}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="lxra-ach-title">{a.title}</div>
                          <span className="lxra-ach-desc">{a.description}</span>
                          <span className="lxra-ach-game">{a.game_title} · {a.console_name}</span>
                        </div>
                        <span className="lxra-pts">{t("{points} pts", { points: a.points })}{a.hardcore ? <span title="Hardcore" style={{ marginLeft: 5, fontSize: "0.78em", fontWeight: 800, color: "#ff7a59", letterSpacing: "0.04em" }}>HC</span> : ""}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p style={{ color: "var(--theme-muted,#aaa)" }}>{t("Nenhuma conquista recente.")}</p>
              )}
              <div style={{ marginTop: 16 }}>
                <button className="lxra-btn" onClick={load} disabled={busy}>{busy ? "..." : t("Atualizar")}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
