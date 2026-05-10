import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

// 10 avatares SVG procedurais (data URI) — sem assets externos.
// Cada um tem cor/glyph diferente. Inicial do nome do user é desenhada por cima
// se passada via prop, mas o "default" sozinho já é suficiente.
function buildAvatarSvg({ bg1, bg2, glyph, glyphColor = "#fff" }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0%" stop-color="${bg1}"/>` +
        `<stop offset="100%" stop-color="${bg2}"/>` +
      `</linearGradient></defs>` +
      `<rect width="200" height="200" fill="url(#g)"/>` +
      `<text x="100" y="125" text-anchor="middle" font-family="Inter, system-ui, sans-serif" ` +
        `font-size="100" font-weight="800" fill="${glyphColor}">${glyph}</text>` +
    `</svg>`
  );
}

export const DEFAULT_AVATARS = [
  { id: "av-purple",   label: "Roxo Ludex",  svg: buildAvatarSvg({ bg1: "#7c3aed", bg2: "#5b21b6", glyph: "L" }) },
  { id: "av-pink",     label: "Rosa Neon",   svg: buildAvatarSvg({ bg1: "#ec4899", bg2: "#be185d", glyph: "★" }) },
  { id: "av-blue",     label: "Azul Retro",  svg: buildAvatarSvg({ bg1: "#3b82f6", bg2: "#1d4ed8", glyph: "8" }) },
  { id: "av-green",    label: "Verde 8-bit", svg: buildAvatarSvg({ bg1: "#22c55e", bg2: "#15803d", glyph: "▶" }) },
  { id: "av-red",      label: "Vermelho",    svg: buildAvatarSvg({ bg1: "#ef4444", bg2: "#b91c1c", glyph: "♥" }) },
  { id: "av-orange",   label: "Laranja Joy", svg: buildAvatarSvg({ bg1: "#f97316", bg2: "#c2410c", glyph: "◉" }) },
  { id: "av-yellow",   label: "Estrela",     svg: buildAvatarSvg({ bg1: "#eab308", bg2: "#a16207", glyph: "★", glyphColor: "#1a1a1a" }) },
  { id: "av-cyan",     label: "Power Ciano", svg: buildAvatarSvg({ bg1: "#06b6d4", bg2: "#0e7490", glyph: "⏻" }) },
  { id: "av-slate",    label: "Cartucho",    svg: buildAvatarSvg({ bg1: "#475569", bg2: "#1e293b", glyph: "▣" }) },
  { id: "av-rainbow",  label: "Multiverse",  svg: buildAvatarSvg({ bg1: "#7c3aed", bg2: "#ec4899", glyph: "Ω" }) },
];

export function avatarUrl(av) {
  if (!av) return null;
  return `data:image/svg+xml;utf8,${encodeURIComponent(av.svg)}`;
}

// Steps do tour. Cada step tem um seletor (data-tour) que aponta pro elemento
// na home — o spotlight overlay mede getBoundingClientRect e abre uma janela
// na máscara. Banner liquid glass aparece numa posição relativa ao alvo.
const TOUR_STEPS = [
  {
    id: "topbar",
    selector: '[data-tour="topbar"]',
    title: "Topo do Ludex",
    body: "A barra superior mostra qual jogo está selecionado, tem o botão 🎲 para sortear um jogo aleatório (atalho: tecla R), abre seu perfil e os ajustes.",
    placement: "bottom",
  },
  {
    id: "systems",
    selector: '[data-tour="systems"]',
    title: "Plataformas",
    body: "Aqui ficam todos os emuladores. Use ←/→ no teclado ou no controle (D-pad) pra trocar de console. Cada plataforma mostra seus próprios jogos abaixo.",
    placement: "bottom",
  },
  {
    id: "sort",
    selector: '[data-tour="sort"]',
    title: "Filtros e ordenação",
    body: "Padrão / A-Z / Recentes (último jogado) / Mais jogados / Favoritos. Passe rápido pelas opções pra encontrar o jogo certo.",
    placement: "bottom",
  },
  {
    id: "grid",
    selector: '[data-tour="grid"]',
    title: "Sua biblioteca",
    body: "Clique num jogo pra abrir os detalhes (capa, screenshots, sua nota, status, tempo jogado). Duplo-clique pra iniciar direto.",
    placement: "top",
  },
  {
    id: "settings",
    selector: '[data-tour="settings"]',
    title: "Configurações",
    body: "Tema, perfil, música ambiente, RetroAchievements, Discord, atualizações — tudo nos ajustes (atalho: tecla S).",
    placement: "left",
  },
];

function useTargetRect(selector, deps) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    function measure() {
      if (!selector) return setRect(null);
      const el = document.querySelector(selector);
      if (!el) return setRect(null);
      setRect(el.getBoundingClientRect());
    }
    measure();
    const id = setInterval(measure, 200); // re-mede caso layout mude
    window.addEventListener("resize", measure);
    return () => { clearInterval(id); window.removeEventListener("resize", measure); };
  }, [selector, ...deps]);
  return rect;
}

function SpotlightOverlay({ rect }) {
  // Mostra overlay escuro com um buraco no rect alvo. Usa SVG mask pra recortar.
  const pad = 12;
  const r = rect ? {
    x: Math.max(0, rect.left - pad),
    y: Math.max(0, rect.top - pad),
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
  } : null;
  return (
    <svg className="lx-tour-spot" width="100%" height="100%">
      <defs>
        <mask id="spot-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
          {r && <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="14" ry="14" fill="#000" />}
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="rgba(8,5,20,0.78)" mask="url(#spot-mask)" />
      {r && (
        <rect
          x={r.x} y={r.y} width={r.w} height={r.h} rx="14" ry="14"
          fill="none" stroke="rgba(167,139,250,0.85)" strokeWidth="2.5"
          style={{ filter: "drop-shadow(0 0 18px rgba(167,139,250,0.55))" }}
        />
      )}
    </svg>
  );
}

function TourBanner({ step, rect, idx, total, onNext, onPrev, onSkip }) {
  // Calcula posição do banner com base no rect do alvo + placement.
  const style = useMemo(() => {
    if (!rect) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    const w = 380;
    const margin = 24;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top, left;
    switch (step.placement) {
      case "bottom":
        top = rect.bottom + margin;
        left = Math.max(margin, Math.min(vw - w - margin, rect.left + rect.width / 2 - w / 2));
        break;
      case "top":
        top = rect.top - margin - 200;
        left = Math.max(margin, Math.min(vw - w - margin, rect.left + rect.width / 2 - w / 2));
        break;
      case "left":
        top = rect.top + rect.height / 2 - 100;
        left = Math.max(margin, rect.left - margin - w);
        break;
      case "right":
        top = rect.top + rect.height / 2 - 100;
        left = Math.min(vw - w - margin, rect.right + margin);
        break;
      default:
        top = vh / 2 - 100;
        left = vw / 2 - w / 2;
    }
    top = Math.max(margin, Math.min(vh - 220, top));
    return { top, left, width: w };
  }, [rect, step]);

  return (
    <div className="lx-tour-banner" style={style} role="dialog" aria-label={step.title}>
      <div className="lx-tour-banner-step">
        Passo {idx + 1} de {total}
      </div>
      <h2 className="lx-tour-banner-title">{step.title}</h2>
      <p className="lx-tour-banner-body">{step.body}</p>
      <div className="lx-tour-banner-actions">
        <button className="lx-tour-btn lx-tour-btn-ghost" onClick={onSkip}>
          Pular tour
        </button>
        <div className="lx-tour-banner-nav">
          {idx > 0 && (
            <button className="lx-tour-btn lx-tour-btn-ghost" onClick={onPrev}>
              Anterior
            </button>
          )}
          <button className="lx-tour-btn lx-tour-btn-primary" onClick={onNext}>
            {idx === total - 1 ? "Concluir tour" : "Próximo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileForm({ initialName = "", onCreate, onBack }) {
  const [name, setName] = useState(initialName);
  const [avatarId, setAvatarId] = useState(DEFAULT_AVATARS[0].id);
  const [customPhotoPath, setCustomPhotoPath] = useState(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const trimmed = name.trim();
  const canContinue = trimmed.length >= 2;

  async function pickPhoto() {
    setPickingPhoto(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const file = await open({
        multiple: false,
        filters: [{ name: "Imagem", extensions: ["jpg", "jpeg", "png", "webp"] }],
      });
      if (typeof file === "string") setCustomPhotoPath(file);
    } catch (e) {
      console.error("pickPhoto", e);
    } finally {
      setPickingPhoto(false);
    }
  }

  function handleCreate() {
    if (!canContinue) return;
    const av = DEFAULT_AVATARS.find(a => a.id === avatarId);
    onCreate({
      name: trimmed,
      avatar: av,
      customPhotoPath,
    });
  }

  return (
    <div className="lx-firstrun-card">
      <h2 className="lx-firstrun-title">Crie seu perfil</h2>
      <p className="lx-firstrun-sub">
        Seu perfil guarda saves, favoritos, tempo jogado e nota dos jogos. Pode trocar tudo depois nos Ajustes.
      </p>

      <label className="lx-firstrun-field">
        <span>Como você quer ser chamado?</span>
        <input
          autoFocus
          type="text"
          maxLength={28}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome ou apelido"
        />
      </label>

      <div className="lx-firstrun-field">
        <span>Escolha um avatar</span>
        <div className="lx-avatar-grid">
          {DEFAULT_AVATARS.map((av) => {
            const selected = !customPhotoPath && av.id === avatarId;
            return (
              <button
                key={av.id}
                type="button"
                className={`lx-avatar-tile ${selected ? "selected" : ""}`}
                title={av.label}
                onClick={() => { setAvatarId(av.id); setCustomPhotoPath(null); }}
              >
                <img src={avatarUrl(av)} alt={av.label} />
              </button>
            );
          })}
          <button
            type="button"
            className={`lx-avatar-tile lx-avatar-custom ${customPhotoPath ? "selected" : ""}`}
            onClick={pickPhoto}
            disabled={pickingPhoto}
            title="Escolher imagem do PC"
          >
            {customPhotoPath ? (
              <img src={convertFileSrc(customPhotoPath)} alt="Sua foto" />
            ) : (
              <span>+ Foto</span>
            )}
          </button>
        </div>
      </div>

      <div className="lx-firstrun-actions">
        {onBack && (
          <button className="lx-tour-btn lx-tour-btn-ghost" onClick={onBack}>
            Ver tour de novo
          </button>
        )}
        <button
          className="lx-tour-btn lx-tour-btn-primary"
          onClick={handleCreate}
          disabled={!canContinue}
        >
          Entrar no Ludex
        </button>
      </div>
      {!canContinue && (
        <p className="lx-firstrun-hint">Digite pelo menos 2 letras pra continuar.</p>
      )}
    </div>
  );
}

/**
 * Wrapper completo: tour primeiro, depois criação de perfil.
 * Não é desmontado pelo pai (LudexLauncher) — fica em cima de tudo até o user
 * concluir. Quando termina, chama onComplete({ name, avatar | customPhotoPath })
 * e o pai persiste o perfil + chama complete_first_run() no backend.
 */
export default function LudexOnboarding({ onComplete }) {
  const [phase, setPhase] = useState("intro"); // intro | tour | profile
  const [stepIdx, setStepIdx] = useState(0);
  const step = TOUR_STEPS[stepIdx];
  const rect = useTargetRect(phase === "tour" ? step?.selector : null, [stepIdx, phase]);

  // ESC pula tour
  useEffect(() => {
    function onKey(e) {
      if (phase === "tour" && e.key === "Escape") {
        e.preventDefault();
        setPhase("profile");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  function nextStep() {
    if (stepIdx >= TOUR_STEPS.length - 1) {
      setPhase("profile");
    } else {
      setStepIdx(stepIdx + 1);
    }
  }
  function prevStep() {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }
  function skipTour() {
    setPhase("profile");
  }

  if (phase === "intro") {
    return (
      <div className="lx-firstrun-root">
        <div className="lx-firstrun-bg" />
        <div className="lx-firstrun-card lx-firstrun-card-intro">
          <div className="lx-firstrun-logo">L U D E X</div>
          <p className="lx-firstrun-sub">
            Sua biblioteca retro em um lugar só. Antes de começar, vamos te mostrar como tudo funciona em 5 passos rápidos.
          </p>
          <div className="lx-firstrun-actions" style={{ justifyContent: "center", marginTop: 22 }}>
            <button className="lx-tour-btn lx-tour-btn-ghost" onClick={() => setPhase("profile")}>
              Pular tour
            </button>
            <button className="lx-tour-btn lx-tour-btn-primary" onClick={() => setPhase("tour")}>
              Começar tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "tour") {
    return (
      <div className="lx-tour-root">
        <SpotlightOverlay rect={rect} />
        <TourBanner
          step={step}
          rect={rect}
          idx={stepIdx}
          total={TOUR_STEPS.length}
          onNext={nextStep}
          onPrev={prevStep}
          onSkip={skipTour}
        />
      </div>
    );
  }

  // phase === "profile"
  return (
    <div className="lx-firstrun-root">
      <div className="lx-firstrun-bg" />
      <ProfileForm
        onCreate={onComplete}
        onBack={() => { setStepIdx(0); setPhase("tour"); }}
      />
    </div>
  );
}
