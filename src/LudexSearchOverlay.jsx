import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SearchIcon, SystemIcon } from "./ludexIcons";
import { t } from "./ludexI18n";

const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");

const VK_ROWS = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L","-"],
  ["Z","X","C","V","B","N","M",".","'"," "],
];
const VK_ACTIONS = ["⌫","CLEAR","BUSCAR"];

export default function SearchOverlay({ systems, onPick, onClose, closing, modalGamepadRef }) {
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("keyboard");
  const [kbRow, setKbRow] = useState(1);
  const [kbCol, setKbCol] = useState(0);
  const [resIdx, setResIdx] = useState(0);

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmed) return [];
    const out = [];
    for (const s of systems) {
      for (const g of s.games) {
        if (g.name.toLowerCase().includes(trimmed)) {
          out.push({ system: s, game: g });
          if (out.length >= 60) return out;
        }
      }
    }
    return out;
  }, [trimmed, systems]);

  const appendChar = useCallback((c) => setQuery((q) => q + c), []);
  const backspace = useCallback(() => setQuery((q) => q.slice(0, -1)), []);
  const clearAll = useCallback(() => setQuery(""), []);

  const confirmKey = useCallback(() => {
    if (kbRow < 4) {
      const c = VK_ROWS[kbRow][kbCol];
      if (c) appendChar(c);
    } else {
      const action = VK_ACTIONS[kbCol] || VK_ACTIONS[0];
      if (action === "⌫") backspace();
      else if (action === "CLEAR") clearAll();
      else if (action === "BUSCAR" && results[0]) onPick(results[0]);
    }
  }, [kbRow, kbCol, appendChar, backspace, clearAll, results, onPick]);

  useEffect(() => {
    if (!modalGamepadRef) return;
    const handler = (action) => {
      if (zone === "keyboard") {
        if (action === "left") {
          setKbCol((c) => {
            const max = kbRow === 4 ? VK_ACTIONS.length - 1 : VK_ROWS[kbRow].length - 1;
            return c > 0 ? c - 1 : max;
          });
          return true;
        }
        if (action === "right") {
          setKbCol((c) => {
            const max = kbRow === 4 ? VK_ACTIONS.length - 1 : VK_ROWS[kbRow].length - 1;
            return c < max ? c + 1 : 0;
          });
          return true;
        }
        if (action === "up") {
          setKbRow((r) => {
            if (r === 0) {
              if (results.length > 0) { setZone("results"); return r; }
              return r;
            }
            const newR = r - 1;
            const newMax = newR === 4 ? VK_ACTIONS.length - 1 : VK_ROWS[newR].length - 1;
            setKbCol((c) => Math.min(c, newMax));
            return newR;
          });
          return true;
        }
        if (action === "down") {
          setKbRow((r) => {
            if (r >= 4) return r;
            const newR = r + 1;
            const newMax = newR === 4 ? VK_ACTIONS.length - 1 : VK_ROWS[newR].length - 1;
            setKbCol((c) => Math.min(c, newMax));
            return newR;
          });
          return true;
        }
        if (action === "a") { confirmKey(); return true; }
        if (action === "y") { backspace(); return true; }
        if (action === "x") { appendChar(" "); return true; }
        if (action === "start") { if (results[0]) onPick(results[0]); return true; }
        if (action === "b") { onClose(); return true; }
      } else if (zone === "results") {
        if (action === "down") {
          setResIdx((i) => {
            if (i + 1 >= results.length) { setZone("keyboard"); return i; }
            return i + 1;
          });
          return true;
        }
        if (action === "up") {
          setResIdx((i) => i > 0 ? i - 1 : 0);
          return true;
        }
        if (action === "a" && results[resIdx]) { onPick(results[resIdx]); return true; }
        if (action === "b") { setZone("keyboard"); return true; }
      }
      return false;
    };
    modalGamepadRef.current = handler;
    return () => { if (modalGamepadRef.current === handler) modalGamepadRef.current = null; };
  }, [modalGamepadRef, zone, kbRow, kbCol, resIdx, results, confirmKey, backspace, appendChar, onClose, onPick]);

  useEffect(() => { setResIdx(0); }, [trimmed]);

  return (
    <div className={`pb-search-backdrop ${closing ? "closing" : ""}`} onClick={onClose}>
      <div className={`pb-search-box ${closing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="pb-search-input-wrap">
          <SearchIcon />
          <input
            autoFocus
            type="text"
            className="pb-search-input"
            placeholder={t("Use o controle: D-pad/Stick navega · A confirma · Y apaga · X espaco · Start busca · B sai")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              if (e.key === "Enter" && results[0]) { e.preventDefault(); onPick(results[0]); }
            }}
          />
          <span className="pb-search-count">{trimmed ? `${results.length}` : ""}</span>
        </div>

        {!IS_ANDROID && (
          <div className={`pb-vk ${zone === "keyboard" ? "focused" : ""}`}>
            {VK_ROWS.map((row, r) => (
              <div key={r} className="pb-vk-row">
                {row.map((c, ci) => (
                  <button
                    key={ci}
                    className={`pb-vk-key ${zone === "keyboard" && kbRow === r && kbCol === ci ? "focused" : ""}`}
                    onClick={() => { setZone("keyboard"); setKbRow(r); setKbCol(ci); appendChar(c); }}
                  >{c === " " ? "␣" : c}</button>
                ))}
              </div>
            ))}
            <div className="pb-vk-row pb-vk-actions">
              {VK_ACTIONS.map((a, ai) => (
                <button
                  key={ai}
                  className={`pb-vk-key pb-vk-action ${zone === "keyboard" && kbRow === 4 && kbCol === ai ? "focused" : ""}`}
                  onClick={() => {
                    setZone("keyboard"); setKbRow(4); setKbCol(ai);
                    if (a === "⌫") backspace();
                    else if (a === "CLEAR") clearAll();
                    else if (a === "BUSCAR" && results[0]) onPick(results[0]);
                  }}
                >{a === "⌫" ? a : t(a)}</button>
              ))}
            </div>
          </div>
        )}

        <div className={`pb-search-results ${zone === "results" ? "focused" : ""}`}>
          {results.map(({ system, game }, i) => (
            <button
              key={game.path}
              className={`pb-search-item ${zone === "results" && i === resIdx ? "focused" : ""}`}
              onClick={() => onPick({ system, game })}
            >
              <span className="pb-search-item-sys" style={{ background: system.color }}>
                <SystemIcon id={system.id} />
              </span>
              <span className="pb-search-item-name">{game.name}</span>
              <span className="pb-search-item-meta">{system.name}</span>
            </button>
          ))}
          {trimmed && results.length === 0 && (
            <div className="pb-search-empty">{t("Nenhum jogo encontrado")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
