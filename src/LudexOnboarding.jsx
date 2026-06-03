import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import VirtualKeyboard from "./LudexOSK";

// 10 avatares SVG procedurais (data URI) — sem assets externos.
// Cada um tem cor/glyph diferente. Inicial do nome do user é desenhada por cima
// se passada via prop, mas o "default" sozinho já é suficiente.
// dominant-baseline=central + text-anchor=middle = centro geometrico exato
// independente da metrica de cada caractere. glyphSize ajusta caso a caso.
function buildAvatarSvg({ bg1, bg2, glyph, glyphColor = "#fff", glyphSize = 110 }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0%" stop-color="${bg1}"/>` +
        `<stop offset="100%" stop-color="${bg2}"/>` +
      `</linearGradient></defs>` +
      `<rect width="200" height="200" fill="url(#g)"/>` +
      `<text x="100" y="100" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="Inter, system-ui, sans-serif" ` +
        `font-size="${glyphSize}" font-weight="800" fill="${glyphColor}">${glyph}</text>` +
    `</svg>`
  );
}

// Glyphs sao simbolos Unicode geometricos (nao emojis no padrao Unicode emoji
// block) - renderizam como vetor monocromatico, sem variation-selector colorido.
export const DEFAULT_AVATARS = [
  { id: "av-purple",   label: "Roxo Ludex",   svg: buildAvatarSvg({ bg1: "#7c3aed", bg2: "#5b21b6", glyph: "L",  glyphSize: 130 }) },
  { id: "av-pink",     label: "Estrela Rosa", svg: buildAvatarSvg({ bg1: "#ec4899", bg2: "#be185d", glyph: "★", glyphSize: 140 }) },
  { id: "av-blue",     label: "Diamante",     svg: buildAvatarSvg({ bg1: "#3b82f6", bg2: "#1d4ed8", glyph: "◆", glyphSize: 140 }) },
  { id: "av-green",    label: "Play",         svg: buildAvatarSvg({ bg1: "#22c55e", bg2: "#15803d", glyph: "▶", glyphSize: 110 }) },
  { id: "av-red",      label: "Coracao",      svg: buildAvatarSvg({ bg1: "#ef4444", bg2: "#b91c1c", glyph: "♥", glyphSize: 130 }) },
  { id: "av-orange",   label: "Alvo",         svg: buildAvatarSvg({ bg1: "#f97316", bg2: "#c2410c", glyph: "◉", glyphSize: 140 }) },
  { id: "av-yellow",   label: "Estrela Ouro", svg: buildAvatarSvg({ bg1: "#eab308", bg2: "#a16207", glyph: "★", glyphSize: 140, glyphColor: "#1a1a1a" }) },
  { id: "av-cyan",     label: "Power",        svg: buildAvatarSvg({ bg1: "#06b6d4", bg2: "#0e7490", glyph: "⏻", glyphSize: 120 }) },
  { id: "av-slate",    label: "Quadrado",     svg: buildAvatarSvg({ bg1: "#475569", bg2: "#1e293b", glyph: "▣", glyphSize: 130 }) },
  { id: "av-rainbow",  label: "Omega",        svg: buildAvatarSvg({ bg1: "#7c3aed", bg2: "#ec4899", glyph: "Ω", glyphSize: 130 }) },
];

export function avatarUrl(av) {
  if (!av) return null;
  return `data:image/svg+xml;utf8,${encodeURIComponent(av.svg)}`;
}

/**
 * Resolve a URL de exibicao do avatar do profile, na ordem:
 *   1. Foto custom salva no disco (photo_path) -> file:// via convertFileSrc
 *   2. Avatar default escolhido no onboarding (avatar_id) -> data URI SVG
 *   3. null (caller deve fallback pra <UserIcon />)
 *
 * `convertFileSrc` precisa ser passado por dependency injection porque o helper
 * vive em LudexOnboarding mas e usado em LudexLauncher (evita circular import).
 */
export function getProfileAvatarUrl(profile, convertFileSrc) {
  if (!profile) return null;
  if (profile.photo_path && convertFileSrc) {
    return convertFileSrc(profile.photo_path);
  }
  if (profile.avatar_id) {
    const av = DEFAULT_AVATARS.find((a) => a.id === profile.avatar_id);
    if (av) return avatarUrl(av);
  }
  return null;
}

// Steps do tour. Cada step tem um seletor (data-tour) que aponta pro elemento
// na home — o spotlight overlay mede getBoundingClientRect e abre uma janela
// na máscara. Banner liquid glass aparece numa posição relativa ao alvo.
// v0.9.34: muito mais steps + cada um explica funcao de um elemento real
// (era so 5 steps, agora cobre topbar inteira, continue jogando, ordem,
// grid, ajustes, busca, sortear, perfil, atalhos). Pode pular a qualquer hora.
const TOUR_STEPS = [
  {
    id: "topbar",
    selector: '[data-tour="topbar"]',
    title: "Topo do Ludex",
    body: "Avatar do seu perfil, sistema selecionado, atalhos pra abrir pastas (ROMs, DLCs, Mods), controle e indicador de gamepad conectado. Tudo acessivel sem sair da home.",
    placement: "bottom",
  },
  {
    id: "search",
    selector: '[data-tour="search"]',
    title: "Buscar jogo (atalho: / )",
    body: "Busca rapida em TODOS seus jogos de todos sistemas. Aceita acentos e ignora maiusculas ('mario' acha 'Super Mario'). No controle, L2+LB tambem abre.",
    placement: "bottom",
  },
  {
    id: "random",
    selector: '[data-tour="random"]',
    title: "Sortear (atalho: R)",
    body: "Escolhe um jogo aleatorio da sua biblioteca inteira — bom pra quebrar a paralisia de 'tenho muito jogo nao sei o que jogar'.",
    placement: "bottom",
  },
  {
    id: "settings",
    selector: '[data-tour="settings"]',
    title: "Configuracoes (atalho: S)",
    body: "Tema, perfil, musica ambiente, wallpaper, RetroAchievements, Discord Rich Presence, auto-update do app, pasta de ROMs, cores libretro, BIOS, atalhos. Tudo aqui.",
    placement: "left",
  },
  {
    id: "continue",
    selector: '[data-tour="continue"]',
    title: "Continue jogando",
    body: "Mostra o ultimo jogo que voce abriu (com capa). Tocar = retoma exatamente de onde parou (save state automatico).",
    placement: "bottom",
  },
  {
    id: "systems",
    selector: '[data-tour="systems"]',
    title: "Plataformas (27+ sistemas)",
    body: "PS1, PS2, N64, GameCube, Wii, 3DS, Saturn, Dreamcast, GBA, NDS, Switch e mais — todos com core embedded (nao precisa baixar nada). Use Up/Down no teclado ou D-pad pra navegar. LB/RB pulam categoria inteira.",
    placement: "right",
  },
  {
    id: "sort",
    selector: '[data-tour="sort"]',
    title: "Filtros e ordenacao",
    body: "Padrao / A-Z / Recentes (ultimo jogado) / Mais jogados / Favoritos. Mantenha 'Recentes' pra ver no topo o jogo que voce abriu ultimo.",
    placement: "bottom",
  },
  {
    id: "grid",
    selector: '[data-tour="grid"]',
    title: "Sua biblioteca",
    body: "Clique pra abrir detalhes (capa, screenshots, sua nota, tempo jogado, status). Duplo-clique pra iniciar. Botao direito abre menu com 'Remover', 'Favorito', 'Renomear' etc.",
    placement: "top",
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
  // v0.9.34: 4 divs com backdrop-filter blur em volta do alvo (era SVG mask).
  // Backdrop-filter so funciona em <div>, nao dentro de <mask> — entao usamos
  // 4 retangulos cobrindo top/bottom/left/right do alvo, cada um borrado.
  // Resultado: alvo nitido, resto da tela com vidro fosco escurecido.
  if (!rect) {
    return <div className="lx-tour-full-blur" />;
  }
  const pad = 12;
  const r = {
    top: Math.max(0, rect.top - pad),
    left: Math.max(0, rect.left - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return (
    <>
      <div className="lx-tour-blur" style={{ top: 0, left: 0, width: "100%", height: r.top }} />
      <div className="lx-tour-blur" style={{ top: r.top + r.height, left: 0, width: "100%", height: Math.max(0, vh - (r.top + r.height)) }} />
      <div className="lx-tour-blur" style={{ top: r.top, left: 0, width: r.left, height: r.height }} />
      <div className="lx-tour-blur" style={{ top: r.top, left: r.left + r.width, width: Math.max(0, vw - (r.left + r.width)), height: r.height }} />
      <div
        className="lx-tour-ring"
        style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
      />
    </>
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
  const [oskOpen, setOskOpen] = useState(false);
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
          onFocus={() => setOskOpen(true)}
          placeholder="Seu nome ou apelido (clique pra digitar com controle)"
          readOnly={oskOpen}
        />
      </label>
      {oskOpen && (
        <VirtualKeyboard
          label="Seu nome ou apelido"
          value={name}
          maxLength={28}
          placeholder="Digite com controle ou teclado"
          onChange={setName}
          onSubmit={() => setOskOpen(false)}
          onClose={() => setOskOpen(false)}
        />
      )}

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
 *
 * v0.9.34: prop `tourOnly` = true pula o intro e a criacao de perfil, vai
 * direto pro tour. Usado quando o user clica "Ver tutorial novamente" nos
 * Ajustes (ja tem perfil, so quer rever as explicacoes). onComplete e
 * chamado sem args nesse modo.
 */
export default function LudexOnboarding({ onComplete, tourOnly = false }) {
  const [phase, setPhase] = useState(tourOnly ? "tour" : "intro"); // intro | tour | profile
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
      if (tourOnly) {
        onComplete && onComplete();
      } else {
        setPhase("profile");
      }
    } else {
      setStepIdx(stepIdx + 1);
    }
  }
  function prevStep() {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }
  function skipTour() {
    if (tourOnly) {
      onComplete && onComplete();
    } else {
      setPhase("profile");
    }
  }

  if (phase === "intro") {
    return (
      <div className="lx-firstrun-root">
        <div className="lx-firstrun-bg" />
        <div className="lx-firstrun-card lx-firstrun-card-intro">
          <div className="lx-firstrun-logo">L U D E X</div>
          <p className="lx-firstrun-sub">
            Sua biblioteca retro em um lugar só — 27+ sistemas embedded, controle nativo, save states, RetroAchievements e Discord Rich Presence.
          </p>
          <div className="lx-firstrun-actions" style={{ justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
            <button className="lx-tour-btn lx-tour-btn-primary" onClick={() => setPhase("profile")}>
              Continuar
            </button>
            <button className="lx-tour-btn lx-tour-btn-ghost" onClick={() => setPhase("tour")}>
              Ver tour guiado (opcional)
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
