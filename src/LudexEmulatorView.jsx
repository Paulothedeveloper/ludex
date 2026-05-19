// v0.8.51: EmulatorView extraido do LudexLauncher.jsx pra reduzir tamanho do
// arquivo principal. Inclui SaveStateOverlay (helper privado) e ResumePromptModal
// (exportado pq parent usa pra prompt de quick-resume antes do load).

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { SystemSettingsModal } from "./LudexExtras";
import { CloseIcon, SystemIcon } from "./ludexIcons";
import { ToolsIcon as LxToolsIcon } from "./LudexExtras";
import { hasOptionsForSystem, applySystemOptions, effectivePadMap, getFrontendConfig } from "./ludexSystemOptions";
import { validRomExtension, invokeTimeout } from "./ludexUtils";

export function EmulatorView({ system, game, onClose, autoLoadSlot = null }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [stateMsg, setStateMsg] = useState(null);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [slots, setSlots] = useState([]);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const [emuSettingsOpen, setEmuSettingsOpen] = useState(false);
  const [discInfo, setDiscInfo] = useState(null);
  const [discMenuOpen, setDiscMenuOpen] = useState(false);
  const audioCtxRef = useRef(null);
  const audioRateRef = useRef(32040);
  const audioGainNodeRef = useRef(null);
  // v0.9.1: AudioWorklet roda na audio thread = zero stutter independente do main.
  // workletNodeRef.port.postMessage(samples) e o jeito de mandar audio do main.
  const workletNodeRef = useRef(null);
  const autoLoadDoneRef = useRef(false);
  const [ffSpeed, setFfSpeed] = useState(1);
  const [ffHold, setFfHold] = useState(false);
  const ffEffectiveRef = useRef(1);
  // v0.9.1: config frontend reativa (audio gain, deadzone, rewind, FF speed, pixel filter, etc)
  const [frontendCfg, setFrontendCfg] = useState(() => getFrontendConfig(system.id));
  const cfgRef = useRef(frontendCfg);
  useEffect(() => { cfgRef.current = frontendCfg; }, [frontendCfg]);
  // FF default vem da config (3x / 4x / etc) quando user pressiona o botao
  useEffect(() => {
    const ffFromCfg = frontendCfg.ffSpeed || 4;
    ffEffectiveRef.current = ffHold ? Math.max(ffSpeed, ffFromCfg) : ffSpeed;
  }, [ffHold, ffSpeed, frontendCfg.ffSpeed]);
  // Atualiza audio gain ao vivo quando user muda volume na UI
  useEffect(() => {
    if (audioGainNodeRef.current) {
      audioGainNodeRef.current.gain.value = frontendCfg.audioGain ?? 1.0;
    }
  }, [frontendCfg.audioGain]);
  // Escuta evento da SystemSettingsModal pra recarregar config sem precisar fechar/abrir modal
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.systemId && e.detail.systemId !== system.id) return;
      setFrontendCfg(getFrontendConfig(system.id));
    };
    window.addEventListener("ludex:frontend-config-changed", handler);
    return () => window.removeEventListener("ludex:frontend-config-changed", handler);
  }, [system.id]);

  const KEY_MAP = useMemo(() => ({
    ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7,
    "z": 0, "Z": 0, "x": 8, "X": 8, "a": 1, "A": 1, "s": 9, "S": 9,
    "Enter": 3, "Shift": 2, "q": 10, "Q": 10, "w": 11, "W": 11,
  }), []);

  // Carrega core + ROM
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const coreFile = system.libretro_core;
        if (!coreFile) {
          setError(`Sistema "${system.name}" sem core libretro configurado`);
          return;
        }
        if (!validRomExtension(game.path)) {
          setError(`Extensao de arquivo nao suportada: ${game.path}`);
          return;
        }
        try { await applySystemOptions(system.id); } catch {}
        const result = await invokeTimeout("libretro_load_game", { coreFilename: coreFile, romPath: game.path }, 60000);
        if (cancelled) return;
        setInfo(result);
        audioRateRef.current = result.sample_rate || 32040;
        try {
          const di = await invoke("libretro_get_disc_info");
          if (di && di.supported && di.num_images > 1) setDiscInfo(di);
        } catch {}
        if (canvasRef.current) {
          canvasRef.current.width = result.base_width;
          canvasRef.current.height = result.base_height;
        }
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: result.sample_rate,
            latencyHint: cfgRef.current.lowLatencyAudio ? "interactive" : "playback",
          });
          await ctx.resume();
          audioCtxRef.current = ctx;
          // v0.9.1: AudioWorklet - rodando na audio thread, imune a stutter do main
          await ctx.audioWorklet.addModule("/ludex-audio-worklet.js");
          const workletNode = new AudioWorkletNode(ctx, "ludex-audio-processor", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { sampleRate: result.sample_rate },
          });
          const gain = ctx.createGain();
          gain.gain.value = cfgRef.current.audioGain ?? 1.0;
          workletNode.connect(gain);
          gain.connect(ctx.destination);
          audioGainNodeRef.current = gain;
          workletNodeRef.current = workletNode;
        } catch (e) {
          console.warn("AudioContext/Worklet init", e);
        }
      } catch (e) {
        console.error("libretro_load_game", e);
        setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      invoke("libretro_unload").catch(() => {});
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
    };
  }, [system.id, game.path, system.libretro_core]);

  // v0.9.1: drainer removido — AudioWorklet processa direto na audio thread.

  // Loop de frames
  useEffect(() => {
    if (!info) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let nextFrame = performance.now();
    const baseFps = info.fps || 60;

    async function tick() {
      const now = performance.now();
      const ff = Math.max(1, ffEffectiveRef.current || 1);
      const emuRate = baseFps * ff;
      const renderRate = Math.min(emuRate, 144);
      const targetFrameMs = 1000 / renderRate;
      const framesPerRender = Math.max(1, Math.round(emuRate / renderRate));
      if (now < nextFrame) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      nextFrame += targetFrameMs;
      if (now - nextFrame > targetFrameMs * 4) nextFrame = now + targetFrameMs;
      try {
        if (framesPerRender > 1) {
          try { await invoke("libretro_skip_frames", { n: framesPerRender - 1 }); } catch {}
        }
        const buf = await invoke("libretro_run_frame");
        if (buf && buf.byteLength >= 8) {
          const view = new DataView(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength);
          const w = view.getUint32(0, true);
          const h = view.getUint32(4, true);
          const rgba = new Uint8ClampedArray(
            buf.buffer ? buf.buffer : buf,
            (buf.byteOffset || 0) + 8,
            w * h * 4
          );
          if (w !== ctx.canvas.width || h !== ctx.canvas.height) {
            ctx.canvas.width = w;
            ctx.canvas.height = h;
          }
          const imageData = new ImageData(rgba, w, h);
          ctx.putImageData(imageData, 0, 0);
        }
        // v0.9.1: posta audio direto pro AudioWorklet (audio thread)
        const audioBuf = await invoke("libretro_take_audio");
        if (audioBuf && audioBuf.byteLength > 0 && workletNodeRef.current) {
          const srcView = new Int16Array(
            audioBuf.buffer ? audioBuf.buffer : audioBuf,
            audioBuf.byteOffset || 0,
            audioBuf.byteLength / 2
          );
          // Copia pro Int16Array proprio (audioBuf eh transferivel mas seguro copiar)
          const copy = new Int16Array(srcView);
          // Transferable: zero-copy do main pra audio thread
          workletNodeRef.current.port.postMessage(
            { type: 'samples', data: copy },
            [copy.buffer],
          );
        }
      } catch (e) {
        console.error("frame tick", e);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [info]);

  // Cleanup do setTimeout (v0.8.49)
  const stateMsgTimeoutRef = useRef(null);
  const showStateMsg = useCallback((kind, text) => {
    if (stateMsgTimeoutRef.current) clearTimeout(stateMsgTimeoutRef.current);
    setStateMsg({ kind, text });
    stateMsgTimeoutRef.current = setTimeout(() => {
      setStateMsg(null);
      stateMsgTimeoutRef.current = null;
    }, 1800);
  }, []);
  useEffect(() => () => {
    if (stateMsgTimeoutRef.current) clearTimeout(stateMsgTimeoutRef.current);
  }, []);

  const captureThumbnail = useCallback(async () => {
    const c = canvasRef.current;
    if (!c) return null;
    try {
      const targetW = 320;
      const targetH = Math.max(1, Math.round((c.height / c.width) * targetW));
      const off = document.createElement("canvas");
      off.width = targetW;
      off.height = targetH;
      const offCtx = off.getContext("2d");
      offCtx.imageSmoothingEnabled = true;
      offCtx.drawImage(c, 0, 0, targetW, targetH);
      const blob = await new Promise((res) => off.toBlob(res, "image/png"));
      if (!blob) return null;
      const arr = new Uint8Array(await blob.arrayBuffer());
      return Array.from(arr);
    } catch (e) {
      console.warn("captureThumbnail", e);
      return null;
    }
  }, []);

  const refreshSlots = useCallback(async () => {
    try {
      const list = await invoke("libretro_list_states", { romPath: game.path });
      setSlots(list || []);
    } catch (e) {
      console.warn("list_states", e);
    }
  }, [game.path]);

  const saveState = useCallback(async (slot = 0) => {
    setSlotsBusy(true);
    try {
      const thumb = await captureThumbnail();
      await invoke("libretro_save_state", { romPath: game.path, slot, thumbnailPng: thumb });
      showStateMsg("ok", `Save slot ${slot} salvo`);
      refreshSlots();
    } catch (e) {
      showStateMsg("error", `Erro: ${e}`);
    } finally {
      setSlotsBusy(false);
    }
  }, [game.path, showStateMsg, captureThumbnail, refreshSlots]);

  const loadState = useCallback(async (slot = 0) => {
    try {
      await invoke("libretro_load_state", { romPath: game.path, slot });
      showStateMsg("ok", `Save slot ${slot} carregado`);
    } catch (e) {
      showStateMsg("error", `${e}`);
    }
  }, [game.path, showStateMsg]);

  const deleteState = useCallback(async (slot) => {
    setSlotsBusy(true);
    try {
      await invoke("libretro_delete_state", { romPath: game.path, slot });
      showStateMsg("ok", `Slot ${slot} apagado`);
      refreshSlots();
    } catch (e) {
      showStateMsg("error", `${e}`);
    } finally {
      setSlotsBusy(false);
    }
  }, [game.path, showStateMsg, refreshSlots]);

  useEffect(() => {
    if (!info) return;
    refreshSlots();
    if (autoLoadSlot != null && !autoLoadDoneRef.current) {
      autoLoadDoneRef.current = true;
      const t = setTimeout(() => { loadState(autoLoadSlot); }, 250);
      return () => clearTimeout(t);
    }
  }, [info, autoLoadSlot, loadState, refreshSlots]);

  // Input teclado + hotkeys
  useEffect(() => {
    const onKey = (e, pressed) => {
      if (pressed && (e.key === "Tab" || e.key === "F1")) {
        e.preventDefault();
        setSlotsOpen((v) => {
          if (!v) refreshSlots();
          return !v;
        });
        return;
      }
      if (slotsOpen) {
        if (pressed && e.key === "Escape") { e.preventDefault(); setSlotsOpen(false); return; }
        if (pressed && /^[1-9]$/.test(e.key)) {
          e.preventDefault();
          const n = parseInt(e.key, 10);
          if (e.shiftKey) saveState(n); else loadState(n);
          return;
        }
        if (pressed && e.key === "0") { e.preventDefault(); if (e.shiftKey) saveState(0); else loadState(0); return; }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (pressed) {
        if (e.key === "F5") { e.preventDefault(); saveState(0); return; }
        if (e.key === "F8") { e.preventDefault(); loadState(0); return; }
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setFfHold(pressed);
        return;
      }
      if (pressed && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        setFfSpeed(s => Math.min(s + 1, 4));
        return;
      }
      if (pressed && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        setFfSpeed(s => Math.max(s - 1, 1));
        return;
      }
      const id = KEY_MAP[e.key];
      if (id !== undefined) {
        e.preventDefault();
        invoke("libretro_set_input", { buttonId: id, pressed }).catch(() => {});
      }
    };
    const down = (e) => onKey(e, true);
    const up = (e) => onKey(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [KEY_MAP, onClose, saveState, loadState, slotsOpen, refreshSlots]);

  // Input gamepad
  useEffect(() => {
    if (!info) return;
    let raf;
    const PAD_MAP = effectivePadMap(system.id);
    const lastState = new Array(16).fill(false);
    const lastAnalog = [0, 0, 0, 0];
    const lastComboRef = { save: false, load: false };

    function poll() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null;
      const all = [];
      for (const p of pads) { if (p) all.push(p); }
      for (const p of all) { if (p.mapping === "standard") { pad = p; break; } }
      if (!pad && all.length > 0) pad = all[0];
      if (pad) {
        if (pad.buttons[8]?.pressed && pad.buttons[9]?.pressed) {
          onClose();
          return;
        }
        const selectHeld = !!pad.buttons[8]?.pressed;
        const lbDown = !!pad.buttons[4]?.pressed;
        const rbDown = !!pad.buttons[5]?.pressed;
        if (selectHeld && lbDown && !lastComboRef.save) {
          lastComboRef.save = true;
          saveState(0);
        } else if (!lbDown || !selectHeld) {
          lastComboRef.save = false;
        }
        if (selectHeld && rbDown && !lastComboRef.load) {
          lastComboRef.load = true;
          loadState(0);
        } else if (!rbDown || !selectHeld) {
          lastComboRef.load = false;
        }
        // v0.9.1: deadzone configuravel pelo user (defaults 15%)
        const dz = cfgRef.current.deadzone ?? 0.15;
        const applyDz = (v) => Math.abs(v) < dz ? 0 : Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
        const ax = applyDz(pad.axes[0] || 0);
        const ay = applyDz(pad.axes[1] || 0);
        const hatX = pad.axes[6] || 0;
        const hatY = pad.axes[7] || 0;
        const dpUp    = !!pad.buttons[12]?.pressed || hatY < -0.5 || ay < -0.5;
        const dpDown  = !!pad.buttons[13]?.pressed || hatY > 0.5  || ay > 0.5;
        const dpLeft  = !!pad.buttons[14]?.pressed || hatX < -0.5 || ax < -0.5;
        const dpRight = !!pad.buttons[15]?.pressed || hatX > 0.5  || ax > 0.5;

        for (const [padIdx, libretroId] of Object.entries(PAD_MAP)) {
          const idx = parseInt(padIdx);
          let pressed;
          if (selectHeld && (idx === 4 || idx === 5 || idx === 8)) {
            pressed = false;
          } else switch (idx) {
            case 12: pressed = dpUp; break;
            case 13: pressed = dpDown; break;
            case 14: pressed = dpLeft; break;
            case 15: pressed = dpRight; break;
            default: pressed = !!pad.buttons[idx]?.pressed;
          }
          if (pressed !== lastState[libretroId]) {
            lastState[libretroId] = pressed;
            invoke("libretro_set_input", { buttonId: libretroId, pressed }).catch(() => {});
          }
        }
        // v0.9.1: aplica deadzone tambem nos analogicos mandados pro core
        const lx = Math.round(applyDz(pad.axes[0] || 0) * 32767);
        const ly = Math.round(applyDz(pad.axes[1] || 0) * 32767);
        const rx = Math.round(applyDz(pad.axes[2] || 0) * 32767);
        const ry = Math.round(applyDz(pad.axes[3] || 0) * 32767);
        if (lx !== lastAnalog[0] || ly !== lastAnalog[1]) {
          lastAnalog[0] = lx; lastAnalog[1] = ly;
          invoke("libretro_set_analog", { stick: 0, x: lx, y: ly }).catch(() => {});
        }
        if (rx !== lastAnalog[2] || ry !== lastAnalog[3]) {
          lastAnalog[2] = rx; lastAnalog[3] = ry;
          invoke("libretro_set_analog", { stick: 1, x: rx, y: ry }).catch(() => {});
        }
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [info, onClose, saveState, loadState, system.id]);

  return (
    <div className="pb-emulator-view" onContextMenu={(e) => e.preventDefault()}>
      <button className="pb-emulator-close" onClick={onClose} title="Sair (Esc / Select+Start)">
        <CloseIcon />
      </button>
      {hasOptionsForSystem(system.id) && (
        <button
          className="pb-emulator-settings"
          onClick={() => setEmuSettingsOpen(true)}
          title="Opções do emulador (resolução, performance, etc) — efeito no próximo jogo"
        >
          <LxToolsIcon />
        </button>
      )}
      {discInfo && discInfo.supported && discInfo.num_images > 1 && (
        <button
          className="pb-emulator-disc"
          onClick={() => setDiscMenuOpen(true)}
          title={`Trocar disco (${discInfo.num_images} discos detectados)`}
        >
          DISC
        </button>
      )}
      {discMenuOpen && discInfo && (
        <div className="lx-modal-overlay" onClick={() => setDiscMenuOpen(false)}>
          <div className="lx-modal" onClick={(e) => e.stopPropagation()} role="dialog" style={{ maxWidth: 420 }}>
            <div className="lx-modal-header">
              <h2>Trocar Disco</h2>
              <button className="lx-modal-close" onClick={() => setDiscMenuOpen(false)} aria-label="Fechar">×</button>
            </div>
            <div className="lx-settings-body">
              <p className="lx-settings-hint">
                {discInfo.num_images} discos detectados. Disco atual: <b>{discInfo.current_image + 1}</b>
              </p>
              <div className="lx-settings-rows">
                {Array.from({ length: discInfo.num_images }, (_, i) => (
                  <button
                    key={i}
                    className={`lx-settings-btn ${i === discInfo.current_image ? "lx-settings-btn-primary" : "lx-settings-btn-ghost"}`}
                    onClick={async () => {
                      try {
                        await invoke("libretro_swap_disc", { idx: i });
                        const fresh = await invoke("libretro_get_disc_info");
                        setDiscInfo(fresh);
                      } catch (e) { console.error(e); }
                    }}
                  >Disco {i + 1}{i === discInfo.current_image ? " (atual)" : ""}</button>
                ))}
              </div>
              <button
                className="lx-settings-btn lx-settings-btn-ghost"
                style={{ marginTop: 14 }}
                onClick={async () => {
                  try {
                    const picked = await openDialog({
                      multiple: false,
                      filters: [{ name: "ISO/CHD/BIN/CUE/MDF", extensions: ["iso","chd","bin","cue","mdf","img"] }],
                    });
                    if (picked) {
                      await invoke("libretro_replace_disc", { path: picked });
                      const fresh = await invoke("libretro_get_disc_info");
                      setDiscInfo(fresh);
                    }
                  } catch (e) { console.error(e); }
                }}
              >Carregar Disco de Arquivo...</button>
            </div>
          </div>
        </div>
      )}
      <div className="pb-emulator-info">
        <span className="pb-emulator-icon" style={{ color: system.color }}><SystemIcon id={system.id} /></span>
        <span className="pb-emulator-game">{game.name}</span>
        {info && <span className="pb-emulator-meta">{info.library_name} {info.library_version} · {info.base_width}×{info.base_height} · {Math.round(info.fps)}fps</span>}
      </div>
      <div className="pb-emulator-hints">
        <kbd>Tab</kbd> Slots · <kbd>F5</kbd>/<kbd>F8</kbd> Quick · <kbd>Space</kbd> FF · <kbd>+</kbd>/<kbd>-</kbd> Speed · <kbd>Esc</kbd> Sair
        <span style={{ opacity: 0.5, marginLeft: 8 }}>· Pad: Select+L1 Save · Select+R1 Load · Select+Start Sair</span>
      </div>
      <SystemSettingsModal
        open={emuSettingsOpen}
        systemId={system.id}
        systemName={system.name}
        onClose={() => setEmuSettingsOpen(false)}
      />
      {(ffHold || ffSpeed > 1) && (
        <div className="pb-emulator-ff-indicator">
          ▶▶ {ffHold ? Math.max(ffSpeed, 2) : ffSpeed}x
        </div>
      )}
      {stateMsg && (
        <div className={`pb-emulator-state-msg pb-emulator-state-${stateMsg.kind}`}>
          {stateMsg.text}
        </div>
      )}
      {error ? (
        <div className="pb-emulator-error">
          <strong>Erro ao carregar:</strong>
          <code>{error}</code>
          {String(error).toLowerCase().includes("bios") && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
              <button className="pb-btn pb-btn-primary" onClick={async () => {
                try { await invoke("open_system_folder"); }
                catch (e) { alert("Falha ao abrir pasta: " + e); }
              }}>Abrir pasta system\</button>
              <button className="pb-btn" onClick={async () => {
                try {
                  const n = await invoke("bios_try_auto_import");
                  if (n > 0) {
                    alert(`Importei ${n} BIOS — tentando de novo...`);
                    setError(null);
                    autoLoadDoneRef.current = false;
                  } else {
                    alert("Nenhuma BIOS encontrada em PCSX2/bios, RetroArch/system, Documents, Downloads. Cola o .bin manualmente na pasta system\\");
                  }
                } catch (e) { alert("Falha: " + e); }
              }}>Auto-import BIOS</button>
            </div>
          )}
          <button className="pb-btn pb-btn-primary" onClick={onClose}>Voltar</button>
        </div>
      ) : (
        <canvas ref={canvasRef} className="pb-emulator-canvas" />
      )}
      {slotsOpen && (
        <SaveStateOverlay
          slots={slots}
          busy={slotsBusy}
          onClose={() => setSlotsOpen(false)}
          onSave={(slot) => saveState(slot)}
          onLoad={(slot) => loadState(slot)}
          onDelete={(slot) => deleteState(slot)}
        />
      )}
    </div>
  );
}

export function ResumePromptModal({ info, onContinue, onFresh, onCancel }) {
  function fmt(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}min atras`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atras`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d atras`;
    return d.toLocaleDateString("pt-BR");
  }
  return (
    <div className="pb-modal-backdrop" onClick={onCancel}>
      <div className="pb-modal pb-resume-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pb-modal-header">
          <h2>Continuar de onde parou?</h2>
          <button className="pb-icon-btn" onClick={onCancel}><CloseIcon /></button>
        </header>
        <div className="pb-resume-body">
          <p><strong>{info.game.name}</strong></p>
          <p className="pb-resume-meta">Slot {info.slot} · salvo {fmt(info.when)}</p>
          <div className="pb-resume-actions">
            <button className="pb-btn pb-btn-primary" autoFocus onClick={onContinue}>Continuar</button>
            <button className="pb-btn" onClick={onFresh}>Comecar do inicio</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveStateOverlay({ slots, busy, onClose, onSave, onLoad, onDelete }) {
  const slotMap = useMemo(() => {
    const m = new Map();
    for (const s of slots) m.set(s.slot, s);
    return m;
  }, [slots]);
  const cards = [];
  for (let i = 1; i <= 9; i++) cards.push(i);

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return "agora";
    if (diff < 3600) return `${Math.floor(diff / 60)}min atras`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atras`;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="pb-savestate-overlay" onClick={onClose}>
      <div className="pb-savestate-panel" onClick={(e) => e.stopPropagation()}>
        <header className="pb-savestate-header">
          <h2>Save States</h2>
          <button className="pb-icon-btn" onClick={onClose} title="Fechar (Tab/Esc)"><CloseIcon /></button>
        </header>
        <p className="pb-savestate-hint">
          <kbd>1-9</kbd> carrega · <kbd>Shift+1-9</kbd> salva · clique nos slots abaixo
        </p>
        <div className="pb-savestate-grid">
          {cards.map((n) => {
            const info = slotMap.get(n);
            const empty = !info;
            return (
              <div key={n} className={`pb-savestate-card ${empty ? "empty" : ""}`}>
                <div className="pb-savestate-thumb">
                  {info?.thumbnail_path ? (
                    <img src={convertFileSrc(info.thumbnail_path)} alt={`Slot ${n}`} />
                  ) : (
                    <span className="pb-savestate-empty-label">vazio</span>
                  )}
                  <span className="pb-savestate-slot-num">{n}</span>
                </div>
                <div className="pb-savestate-meta">
                  {info ? fmtTime(info.modified_at) : "—"}
                </div>
                <div className="pb-savestate-actions">
                  <button className="pb-savestate-btn" disabled={busy} onClick={() => onSave(n)} title="Salvar (sobrescreve)">Salvar</button>
                  <button className="pb-savestate-btn pb-savestate-btn-primary" disabled={busy || empty} onClick={() => { onLoad(n); onClose(); }} title="Carregar">Carregar</button>
                  {!empty && (
                    <button className="pb-savestate-btn pb-savestate-btn-danger" disabled={busy} onClick={() => onDelete(n)} title="Apagar">×</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
