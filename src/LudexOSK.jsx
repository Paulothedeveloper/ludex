import React, { useEffect, useState, useRef } from "react";

/**
 * On-screen keyboard navegavel por D-pad/setas + A/Enter pra inserir tecla.
 * Suporta 3 layouts: lower / upper / symbols. Cada layout eh uma matriz
 * de strings — cada string pode ser 1 caractere ou um nome de tecla
 * especial (BACK, SPACE, SHIFT, SYM, OK, CLEAR).
 *
 * Uso: <VirtualKeyboard label="Seu nome" value={name} onChange={setName}
 *        onSubmit={() => fechar} onClose={() => cancelar} />
 */
const LAYOUT_LOWER = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l","'"],
  ["SHIFT","z","x","c","v","b","n","m",",","."],
  ["SYM","SPACE","BACK","CLEAR","OK"],
];
const LAYOUT_UPPER = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L",'"'],
  ["SHIFT","Z","X","C","V","B","N","M",";",":"],
  ["SYM","SPACE","BACK","CLEAR","OK"],
];
const LAYOUT_SYM = [
  ["!","@","#","$","%","^","&","*","(",")"],
  ["-","_","=","+","[","]","{","}","\\","|"],
  ["/","?","<",">","~","`","\"","'",";",":"],
  ["SHIFT","á","é","í","ó","ú","ç","ã","õ","â"],
  ["SYM","SPACE","BACK","CLEAR","OK"],
];

const LAYOUTS = { lower: LAYOUT_LOWER, upper: LAYOUT_UPPER, sym: LAYOUT_SYM };

export default function VirtualKeyboard({
  label,
  value,
  onChange,
  onSubmit,
  onClose,
  maxLength = 280,
  placeholder = "",
}) {
  const [layout, setLayout] = useState("lower");
  const [row, setRow] = useState(1); // comeca na linha de letras
  const [col, setCol] = useState(0);
  const matrix = LAYOUTS[layout];
  const rootRef = useRef(null);

  // v0.9.37: estado vivo num ref pra o loop de gamepad (deps []) ler sempre o
  // valor atual sem closures velhas.
  const stateRef = useRef({});
  stateRef.current = { row, col, layout, value, matrix };

  // Auto-focus pra capturar teclas
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  function clampPos(r, c, m) {
    const safeR = Math.max(0, Math.min(m.length - 1, r));
    const cols = m[safeR].length;
    const safeC = Math.max(0, Math.min(cols - 1, c));
    return { r: safeR, c: safeC };
  }

  function moveSelection(dr, dc) {
    const { row: r, col: c, matrix: m } = stateRef.current;
    const next = clampPos(r + dr, c + dc, m);
    setRow(next.r); setCol(next.c);
  }

  function pressKey(key) {
    const { value: val, layout: lay } = stateRef.current;
    if (key === "BACK") {
      onChange(val.slice(0, -1));
    } else if (key === "SPACE") {
      if (val.length < maxLength) onChange(val + " ");
    } else if (key === "SHIFT") {
      setLayout(lay === "lower" ? "upper" : "lower");
    } else if (key === "SYM") {
      setLayout(lay === "sym" ? "lower" : "sym");
    } else if (key === "CLEAR") {
      onChange("");
    } else if (key === "OK") {
      onSubmit && onSubmit();
    } else {
      if (val.length < maxLength) onChange(val + key);
    }
  }

  // v0.9.37: NAVEGAÇÃO POR CONTROLE. Antes só teclado físico/setas mexia o OSK —
  // as dicas prometiam D-pad/A/B mas não havia polling de gamepad, travando o 1º
  // uso (licença + criação de perfil) pra quem só tem controle. Loop rAF próprio
  // (independente do gamepad handler do launcher, já que o OSK é usado em vários
  // contextos). A=pressiona, B=apaga, X=shift, Y=símbolos, Start=OK, Select=fechar.
  const actionsRef = useRef({});
  actionsRef.current = {
    move: moveSelection,
    pressCurrent: () => { const { matrix: m, row: r, col: c } = stateRef.current; pressKey(m[r][c]); },
    press: pressKey,
    submit: () => onSubmit && onSubmit(),
    close: () => onClose && onClose(),
  };
  useEffect(() => {
    let raf, navCooldown = 0;
    const prev = {};
    const tick = (t) => {
      const pads = (typeof navigator !== "undefined" && navigator.getGamepads) ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads) { if (p) { gp = p; break; } }
      if (gp) {
        const A = actionsRef.current;
        const down = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
        const edge = (i, fn) => { const now = down(i); if (now && !prev[i]) fn(); prev[i] = now; };
        edge(0, () => A.pressCurrent());   // A
        edge(1, () => A.press("BACK"));    // B
        edge(2, () => A.press("SHIFT"));   // X
        edge(3, () => A.press("SYM"));     // Y
        edge(9, () => A.submit());          // Start
        edge(8, () => A.close());           // Select/View
        const ax = gp.axes || [];
        const up = down(12) || (ax[1] ?? 0) < -0.5;
        const dn = down(13) || (ax[1] ?? 0) > 0.5;
        const lf = down(14) || (ax[0] ?? 0) < -0.5;
        const rt = down(15) || (ax[0] ?? 0) > 0.5;
        if (up || dn || lf || rt) {
          if (t >= navCooldown) {
            if (up) A.move(-1, 0); else if (dn) A.move(1, 0);
            else if (lf) A.move(0, -1); else if (rt) A.move(0, 1);
            navCooldown = t + 140; // repeat ao segurar
          }
        } else {
          navCooldown = 0;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function onKey(e) {
    const k = e.key;
    if (k === "ArrowRight")  { e.preventDefault(); moveSelection(0, 1); }
    else if (k === "ArrowLeft") { e.preventDefault(); moveSelection(0, -1); }
    else if (k === "ArrowDown") { e.preventDefault(); moveSelection(1, 0); }
    else if (k === "ArrowUp")   { e.preventDefault(); moveSelection(-1, 0); }
    else if (k === "Enter")     { e.preventDefault(); pressKey(matrix[row][col]); }
    else if (k === "Backspace") { e.preventDefault(); pressKey("BACK"); }
    else if (k === "Escape")    { e.preventDefault(); onClose && onClose(); }
    else if (k === "Tab")       { e.preventDefault(); setLayout(layout === "lower" ? "upper" : layout === "upper" ? "sym" : "lower"); }
    else if (k.length === 1) {
      // Aceita digitacao por teclado fisico tambem
      e.preventDefault();
      if (value.length < maxLength) onChange(value + k);
    }
  }

  function keyLabel(k) {
    if (k === "BACK") return "←";
    if (k === "SPACE") return "espaço";
    if (k === "SHIFT") return layout === "upper" ? "shift" : "Shift";
    if (k === "SYM") return layout === "sym" ? "ABC" : "@!#";
    if (k === "CLEAR") return "limpar";
    if (k === "OK") return "OK";
    return k;
  }

  function keyClass(k, isFocused) {
    let cls = "lx-osk-key";
    if (k === "SPACE") cls += " lx-osk-key-wide";
    if (k === "OK") cls += " lx-osk-key-ok";
    if (k === "BACK" || k === "CLEAR") cls += " lx-osk-key-action";
    if (k === "SHIFT" || k === "SYM") cls += " lx-osk-key-mod";
    if (isFocused) cls += " focused";
    return cls;
  }

  return (
    <div className="lx-osk-overlay" onClick={onClose}>
      <div
        className="lx-osk"
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={label}
      >
        <div className="lx-osk-header">
          <div className="lx-osk-label">{label}</div>
          <div className="lx-osk-display">
            {value || <span className="lx-osk-placeholder">{placeholder}</span>}
            <span className="lx-osk-caret" />
          </div>
        </div>

        <div className="lx-osk-grid">
          {matrix.map((rowArr, ri) => (
            <div key={ri} className="lx-osk-row">
              {rowArr.map((k, ci) => (
                <button
                  key={`${ri}-${ci}`}
                  type="button"
                  className={keyClass(k, ri === row && ci === col)}
                  onClick={() => { setRow(ri); setCol(ci); pressKey(k); rootRef.current?.focus(); }}
                >
                  {keyLabel(k)}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="lx-osk-hints">
          <span><b>D-Pad / Setas</b> mover</span>
          <span><b>A / Enter</b> pressionar</span>
          <span><b>B / Backspace</b> apagar</span>
          <span><b>X/Y</b> trocar layout</span>
          <span><b>Start</b> OK · <b>Select</b> fechar</span>
        </div>
      </div>
    </div>
  );
}
