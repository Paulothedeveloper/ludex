// v0.9.8: Modal "Novidades" pos-update. Auto-contido (estilos inline) pra rodar
// igual no app (LudexMobile) e no launcher do PC (LudexLauncher).

import React, { useEffect } from "react";
import { t } from "./ludexI18n";

const ACCENT = "#7c5cff";

export function WhatsNewModal({ data, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!data) return null;

  const S = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100002, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 },
    sheet: { width: "100%", maxWidth: 460, maxHeight: "84vh", background: "#17122b", border: "1px solid rgba(124,92,255,0.45)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,0.6)", animation: "lmxwn-in 0.32s cubic-bezier(0.22,1,0.36,1)" },
    header: { padding: "20px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" },
    badge: { display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: "#1a1030", background: "linear-gradient(135deg,#a78bfa,#ec4899)", padding: "3px 10px", borderRadius: 999, marginBottom: 8 },
    title: { margin: 0, fontSize: 19, fontWeight: 800, color: "#fff" },
    sub: { margin: "4px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.55)" },
    body: { padding: "8px 20px 4px", overflowY: "auto", flex: 1 },
    verLabel: { fontSize: 12, fontWeight: 800, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.04em", margin: "14px 0 6px" },
    item: { display: "flex", gap: 9, fontSize: 13.5, color: "rgba(255,255,255,0.85)", lineHeight: 1.5, marginBottom: 7 },
    dot: { flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: ACCENT, marginTop: 6 },
    footer: { padding: 16, borderTop: "1px solid rgba(255,255,255,0.08)" },
    btn: { width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  };

  const multi = data.entries.length > 1;

  return (
    <div style={S.backdrop} onClick={onClose}>
      <style>{`@keyframes lmxwn-in{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}`}</style>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <span style={S.badge}>{t("NOVIDADES")}</span>
          <h2 style={S.title}>{multi ? t("O que mudou") : t("O que mudou na v{v}", { v: data.current })}</h2>
          <p style={S.sub}>{multi ? t("Você atualizou e chegou na v{v}. Resumo das mudanças:", { v: data.current }) : t("Resumo rápido desta atualização.")}</p>
        </div>
        <div style={S.body}>
          {data.entries.map((e) => (
            <div key={e.version}>
              {multi && <div style={S.verLabel}>v{e.version}</div>}
              {e.items.map((it, i) => (
                <div key={i} style={S.item}><span style={S.dot} /><span>{it}</span></div>
              ))}
            </div>
          ))}
        </div>
        <div style={S.footer}>
          <button style={S.btn} onClick={onClose}>{t("Entendi")}</button>
        </div>
      </div>
    </div>
  );
}
