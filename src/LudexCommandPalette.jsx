import React, { useEffect, useMemo, useRef, useState } from "react";
import { t } from "./ludexI18n";

/**
 * v1.0: Command Palette (Ctrl+K) — unifica AÇÕES do launcher num só lugar:
 * pular pra um console, abrir Ajustes, trocar visualização/ordenação, buscar
 * jogos, sortear, tela cheia, re-escanear. Recebe `commands` já prontos do
 * LudexLauncher (cada um com label/hint/group/run). Navegável por teclado.
 */
export default function LudexCommandPalette({ open, onClose, commands }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ(""); setSel(0);
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) =>
      c.label.toLowerCase().includes(s) ||
      (c.hint || "").toLowerCase().includes(s) ||
      (c.group || "").toLowerCase().includes(s)
    );
  }, [q, commands]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${sel}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const run = (c) => {
    onClose();
    setTimeout(() => { try { c.run(); } catch (e) { console.error("cmd", e); } }, 0);
  };

  const onKey = (e) => {
    // stopPropagation: impede que a navegação global do launcher receba estas teclas
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setSel((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (filtered[sel]) run(filtered[sel]); }
  };

  const S = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 100050, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" },
    panel: { width: "min(620px, 92vw)", maxHeight: "70vh", display: "flex", flexDirection: "column", background: "var(--theme-surface, #1f1f1f)", border: "1px solid var(--theme-border, #3a3a3a)", borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.6)", overflow: "hidden", animation: "lxcmd-in .18s ease" },
    input: { width: "100%", boxSizing: "border-box", padding: "16px 18px", fontSize: 16, border: "0", borderBottom: "1px solid var(--theme-border, #3a3a3a)", background: "transparent", color: "var(--theme-text, #fff)", outline: "none", fontFamily: "inherit" },
    list: { overflowY: "auto", padding: 6 },
    empty: { padding: "22px 18px", color: "var(--theme-muted, #aaa)", fontSize: 14 },
    hint: { padding: "8px 14px", fontSize: 11, color: "var(--theme-muted, #aaa)", borderTop: "1px solid var(--theme-border,#3a3a3a)", display: "flex", gap: 14 },
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <style>{`@keyframes lxcmd-in{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}
        .lxcmd-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:9px;cursor:pointer;color:var(--theme-text,#fff);font-size:14px}
        .lxcmd-item .lxcmd-group{margin-left:auto;font-size:11px;color:var(--theme-muted,#aaa)}
        .lxcmd-item.sel{background:var(--lx-grad,linear-gradient(135deg,#7c3aed,#ec4899));color:#fff}
        .lxcmd-item.sel .lxcmd-group{color:rgba(255,255,255,.85)}`}</style>
      <div style={S.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Comandos")}>
        <input
          ref={inputRef}
          style={S.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={t("Buscar comando, console, ação…")}
          aria-label={t("Buscar comando")}
        />
        <div style={S.list} ref={listRef}>
          {filtered.length === 0 && <div style={S.empty}>{t("Nenhum comando.")}</div>}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              data-idx={i}
              className={`lxcmd-item ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              {c.group && <span className="lxcmd-group">{c.group}</span>}
            </div>
          ))}
        </div>
        <div style={S.hint}>
          <span>↑↓ {t("navegar")}</span><span>↵ {t("executar")}</span><span>Esc {t("fechar")}</span>
        </div>
      </div>
    </div>
  );
}
