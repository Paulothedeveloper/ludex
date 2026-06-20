import React, { useEffect, useRef, useState } from "react";
import { t } from "./ludexI18n";

/**
 * v0.9.39: diálogos in-app navegáveis por CONTROLE (substituem alert/confirm/prompt
 * nativos do sistema — que em fullscreen não seguem o tema e muitas vezes não são
 * focáveis por gamepad). API imperativa via singleton (pub/sub), pra usar de
 * qualquer componente sem prop-drilling:
 *
 *   import { lxConfirm, lxAlert } from "./LudexDialog";
 *   if (await lxConfirm("Apagar tudo?")) { ... }
 *   await lxAlert("Pronto!");
 *
 * Monte <LxDialogHost /> UMA vez no root (App.jsx). Controle: A confirma o botão
 * focado, B cancela, ←/→ troca de botão. Teclado: Enter confirma, Esc cancela.
 */

let _push = null; // setado pelo host quando monta
let _seq = 0;

function request(opts) {
  return new Promise((resolve) => {
    if (!_push) {
      // Fallback defensivo: sem host montado, não trava o fluxo.
      // confirm -> false (não-destrutivo), alert -> resolve.
      resolve(opts.kind === "confirm" ? false : undefined);
      return;
    }
    _push({ ...opts, id: ++_seq, resolve });
  });
}

export function lxConfirm(message, { title, okText, cancelText, danger = false } = {}) {
  return request({ kind: "confirm", title: title ?? t("Confirmar"), message, okText: okText ?? t("Confirmar"), cancelText: cancelText ?? t("Cancelar"), danger });
}

export function lxAlert(message, { title, okText = "OK" } = {}) {
  return request({ kind: "alert", title: title ?? t("Aviso"), message, okText });
}

export function LxDialogHost() {
  const [dlg, setDlg] = useState(null);
  // foco entre botões: 0 = cancelar (confirm) | ok (alert), 1 = ok (confirm)
  const [focusIdx, setFocusIdx] = useState(0);

  useEffect(() => {
    _push = (d) => { setDlg(d); setFocusIdx(d.kind === "confirm" ? 1 : 0); };
    return () => { _push = null; };
  }, []);

  const stateRef = useRef({});
  stateRef.current = { dlg, focusIdx };

  function close(result) {
    const cur = stateRef.current.dlg;
    if (cur) { try { cur.resolve(result); } catch {} }
    setDlg(null);
  }
  function activateFocused() {
    const { dlg: d, focusIdx: f } = stateRef.current;
    if (!d) return;
    if (d.kind === "alert") { close(undefined); return; }
    close(f === 1); // confirm: idx 1 = OK(true), idx 0 = cancelar(false)
  }

  // Teclado
  useEffect(() => {
    function onKey(e) {
      if (!stateRef.current.dlg) return;
      if (e.key === "Escape") { e.preventDefault(); close(stateRef.current.dlg.kind === "confirm" ? false : undefined); }
      else if (e.key === "Enter") { e.preventDefault(); activateFocused(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setFocusIdx(0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setFocusIdx(1); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Gamepad (loop rAF próprio — funciona mesmo sobre o launcher/emulador)
  useEffect(() => {
    let raf, navCd = 0;
    const prev = {};
    const tick = (t) => {
      if (stateRef.current.dlg) {
        const pads = (typeof navigator !== "undefined" && navigator.getGamepads) ? navigator.getGamepads() : [];
        let gp = null;
        for (const p of pads) { if (p) { gp = p; break; } }
        if (gp) {
          const down = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
          const edge = (i, fn) => { const n = down(i); if (n && !prev[i]) fn(); prev[i] = n; };
          edge(0, () => activateFocused());                                   // A
          edge(1, () => close(stateRef.current.dlg.kind === "confirm" ? false : undefined)); // B
          edge(9, () => activateFocused());                                   // Start
          const ax = gp.axes || [];
          const lf = down(14) || (ax[0] ?? 0) < -0.5;
          const rt = down(15) || (ax[0] ?? 0) > 0.5;
          if (lf || rt) { if (t >= navCd) { setFocusIdx(lf ? 0 : 1); navCd = t + 160; } } else { navCd = 0; }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!dlg) return null;
  const isConfirm = dlg.kind === "confirm";

  return (
    <div className="lx-dlg-overlay" onClick={() => close(isConfirm ? false : undefined)}>
      <div className="lx-dlg-card" role="dialog" aria-label={dlg.title} onClick={(e) => e.stopPropagation()}>
        <h2 className="lx-dlg-title">{dlg.title}</h2>
        <p className="lx-dlg-message">{dlg.message}</p>
        <div className="lx-dlg-actions">
          {isConfirm && (
            <button
              className={`lx-dlg-btn lx-dlg-btn-ghost ${focusIdx === 0 ? "focused" : ""}`}
              onClick={() => close(false)}
              onMouseEnter={() => setFocusIdx(0)}
            >{dlg.cancelText}</button>
          )}
          <button
            className={`lx-dlg-btn ${dlg.danger ? "lx-dlg-btn-danger" : "lx-dlg-btn-primary"} ${(isConfirm ? focusIdx === 1 : true) ? "focused" : ""}`}
            onClick={() => close(isConfirm ? true : undefined)}
            onMouseEnter={() => isConfirm && setFocusIdx(1)}
          >{dlg.okText}</button>
        </div>
        <div className="lx-dlg-hint">🎮 <b>A</b> {isConfirm ? t("selecionar") : "OK"} · {isConfirm ? t("←/→ trocar · B cancelar") : t("B fechar")}</div>
      </div>
    </div>
  );
}
