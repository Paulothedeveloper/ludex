// v0.9.2: Modal de cheats in-game. Usado tanto no EmulatorView (PC) quanto no
// emulador mobile. Auto-contido (estilos inline) pra nao depender do CSS de cada
// contexto. Busca cheats abertos online + permite adicionar manualmente.

import React, { useState, useEffect, useCallback } from "react";
import {
  loadCheats, saveCheats, fetchOnlineCheats, applyCheats,
  supportsOnlineCheats, cleanGameName,
} from "./ludexCheats";

const ACCENT = "#7c5cff";

export function CheatsModal({ systemId, gamePath, onClose }) {
  const [cheats, setCheats] = useState(() => loadCheats(systemId, gamePath));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [newDesc, setNewDesc] = useState("");
  const [newCode, setNewCode] = useState("");
  const online = supportsOnlineCheats(systemId);

  const persist = useCallback((next) => {
    setCheats(next);
    saveCheats(systemId, gamePath, next);
  }, [systemId, gamePath]);

  // aplica sempre que a lista muda (toggle/add/remove)
  const reapply = useCallback(async (list) => {
    try {
      const n = await applyCheats(list);
      setMsg({ kind: "ok", text: n > 0 ? `${n} cheat(s) ativo(s)` : "Nenhum cheat ativo" });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    }
  }, []);

  const toggle = (i) => {
    const next = cheats.map((c, idx) => idx === i ? { ...c, enabled: !c.enabled } : c);
    persist(next);
    reapply(next);
  };

  const remove = (i) => {
    const next = cheats.filter((_, idx) => idx !== i);
    persist(next);
    reapply(next);
  };

  const addManual = () => {
    if (!newCode.trim()) return;
    const next = [...cheats, { desc: newDesc.trim() || "Cheat manual", code: newCode.trim(), enabled: true }];
    persist(next);
    setNewDesc(""); setNewCode("");
    reapply(next);
  };

  const search = async () => {
    setBusy(true); setMsg(null);
    try {
      const found = await fetchOnlineCheats(systemId, gamePath);
      if (!found || found.length === 0) {
        setMsg({ kind: "err", text: "Nenhum cheat encontrado." });
      } else {
        // mescla sem duplicar por code
        const existing = new Set(cheats.map((c) => c.code));
        const merged = [...cheats];
        let added = 0;
        for (const f of found) {
          if (!existing.has(f.code)) { merged.push({ ...f, enabled: false }); added++; }
        }
        persist(merged);
        setMsg({ kind: "ok", text: `${added} cheat(s) adicionado(s). Ative os que quiser.` });
      }
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  // ESC fecha
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const S = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 100000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
    sheet: { width: "100%", maxWidth: 480, maxHeight: "86vh", background: "#15111f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)" },
    title: { margin: 0, fontSize: 17, fontWeight: 800, color: "#fff" },
    sub: { margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.5)" },
    close: { background: "transparent", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4 },
    body: { padding: 14, overflowY: "auto", flex: 1 },
    btn: { width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
    btnGhost: { background: "rgba(255,255,255,0.07)", color: "#fff" },
    item: { display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)", marginBottom: 8 },
    itemText: { flex: 1, minWidth: 0 },
    itemDesc: { fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    itemCode: { fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    sw: (on) => ({ flexShrink: 0, width: 44, height: 26, borderRadius: 13, background: on ? ACCENT : "rgba(255,255,255,0.18)", position: "relative", border: "none", cursor: "pointer", transition: "background .15s" }),
    knob: (on) => ({ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s" }),
    del: { flexShrink: 0, background: "transparent", border: "none", color: "rgba(255,107,107,0.85)", cursor: "pointer", fontSize: 18, padding: 4 },
    input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.3)", color: "#fff", fontFamily: "inherit", fontSize: 13, marginBottom: 8, boxSizing: "border-box" },
    msg: (kind) => ({ padding: "10px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 10, background: kind === "ok" ? "rgba(124,92,255,0.15)" : "rgba(255,107,107,0.15)", color: kind === "ok" ? "#cdbdff" : "#ff9b9b" }),
    section: { fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "16px 0 8px" },
    empty: { textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13, padding: "20px 0" },
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <div>
            <h3 style={S.title}>Cheats</h3>
            <p style={S.sub}>{cleanGameName(gamePath)}</p>
          </div>
          <button style={S.close} onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div style={S.body}>
          {msg && <div style={S.msg(msg.kind)}>{msg.text}</div>}

          <button
            style={{ ...S.btn, ...(online ? {} : S.btnGhost), opacity: busy ? 0.6 : 1 }}
            disabled={busy || !online}
            onClick={search}
          >
            {busy ? "Buscando…" : online ? "Buscar cheats online" : "Busca online indisponível p/ este sistema"}
          </button>

          <div style={S.section}>Lista de cheats</div>
          {cheats.length === 0 && <div style={S.empty}>Nenhum cheat ainda. Busque online ou adicione abaixo.</div>}
          {cheats.map((c, i) => (
            <div key={i} style={S.item}>
              <div style={S.itemText}>
                <div style={S.itemDesc}>{c.desc}</div>
                <div style={S.itemCode}>{c.code.replace(/\n/g, " ")}</div>
              </div>
              <button style={S.sw(c.enabled)} onClick={() => toggle(i)} aria-label="Ativar cheat">
                <span style={S.knob(c.enabled)} />
              </button>
              <button style={S.del} onClick={() => remove(i)} aria-label="Remover">×</button>
            </div>
          ))}

          <div style={S.section}>Adicionar manualmente</div>
          <input style={S.input} placeholder="Descrição (ex: Vidas infinitas)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <input style={S.input} placeholder="Código (Game Genie / PAR / raw)" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
          <button style={{ ...S.btn, ...S.btnGhost }} onClick={addManual} disabled={!newCode.trim()}>Adicionar cheat</button>
        </div>
      </div>
    </div>
  );
}
