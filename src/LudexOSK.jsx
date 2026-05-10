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
  ["SHIFT",",",".","-","_"," "," "," ","á","ã"],
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

  // Auto-focus pra capturar teclas
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  function clampPos(r, c) {
    const safeR = Math.max(0, Math.min(matrix.length - 1, r));
    const cols = matrix[safeR].length;
    const safeC = Math.max(0, Math.min(cols - 1, c));
    return { r: safeR, c: safeC };
  }

  function moveSelection(dr, dc) {
    const next = clampPos(row + dr, col + dc);
    setRow(next.r); setCol(next.c);
  }

  function pressKey(key) {
    if (key === "BACK") {
      onChange(value.slice(0, -1));
    } else if (key === "SPACE") {
      if (value.length < maxLength) onChange(value + " ");
    } else if (key === "SHIFT") {
      setLayout(layout === "lower" ? "upper" : "lower");
    } else if (key === "SYM") {
      setLayout(layout === "sym" ? "lower" : "sym");
    } else if (key === "CLEAR") {
      onChange("");
    } else if (key === "OK") {
      onSubmit && onSubmit();
    } else {
      if (value.length < maxLength) onChange(value + key);
    }
  }

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
          <span><b>Tab</b> trocar layout</span>
          <span><b>Esc</b> fechar</span>
        </div>
      </div>
    </div>
  );
}
