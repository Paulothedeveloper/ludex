import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import VirtualKeyboard from "./LudexOSK";
import { t } from "./ludexI18n";

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

// Glyphs sao simbolos Unicode geometricos (não emojis no padrão Unicode emoji
// block) - renderizam como vetor monocromatico, sem variation-selector colorido.
export const DEFAULT_AVATARS = [
  { id: "av-purple",   label: "Roxo Ludex",   svg: buildAvatarSvg({ bg1: "#7c3aed", bg2: "#5b21b6", glyph: "L",  glyphSize: 130 }) },
  { id: "av-pink",     label: "Estrela Rosa", svg: buildAvatarSvg({ bg1: "#ec4899", bg2: "#be185d", glyph: "★", glyphSize: 140 }) },
  { id: "av-blue",     label: "Diamante",     svg: buildAvatarSvg({ bg1: "#3b82f6", bg2: "#1d4ed8", glyph: "◆", glyphSize: 140 }) },
  { id: "av-green",    label: "Play",         svg: buildAvatarSvg({ bg1: "#22c55e", bg2: "#15803d", glyph: "▶", glyphSize: 110 }) },
  { id: "av-red",      label: "Coração",      svg: buildAvatarSvg({ bg1: "#ef4444", bg2: "#b91c1c", glyph: "♥", glyphSize: 130 }) },
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

// v0.9.39: navegação por CONTROLE no onboarding (tour + criação de perfil).
// Loop rAF próprio (igual o OSK) — lê o 1º gamepad e chama handlerRef.current(btn)
// na borda de subida de cada botão. O handler (redefinido a cada render, guardado
// num ref) decide o que fazer com o estado atual. D-pad/stick têm repeat ~160ms.
function useGamepadButtons(handlerRef) {
  useEffect(() => {
    let raf, navCd = 0;
    const prev = {};
    const map = { 0: "a", 1: "b", 2: "x", 3: "y", 9: "start", 8: "select", 4: "lb", 5: "rb" };
    const tick = (t) => {
      const pads = (typeof navigator !== "undefined" && navigator.getGamepads) ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads) { if (p) { gp = p; break; } }
      if (gp) {
        const fn = handlerRef.current;
        const down = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
        for (const i of [0, 1, 2, 3, 9, 8, 4, 5]) {
          const n = down(i);
          if (n && !prev[i]) fn && fn(map[i]);
          prev[i] = n;
        }
        const ax = gp.axes || [];
        const up = down(12) || (ax[1] ?? 0) < -0.5;
        const dn = down(13) || (ax[1] ?? 0) > 0.5;
        const lf = down(14) || (ax[0] ?? 0) < -0.5;
        const rt = down(15) || (ax[0] ?? 0) > 0.5;
        if (up || dn || lf || rt) {
          if (t >= navCd) { fn && fn(up ? "up" : dn ? "down" : lf ? "left" : "right"); navCd = t + 160; }
        } else { navCd = 0; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

// Steps do tour. Cada step tem um seletor (data-tour) que aponta pro elemento
// na home — o spotlight overlay mede getBoundingClientRect e abre uma janela
// na máscara. Banner liquid glass aparece numa posição relativa ao alvo.
// v0.9.34: muito mais steps + cada um explica função de um elemento real
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
    body: "Busca rapida em TODOS seus jogos de todos sistemas. Aceita acentos e ignora maiusculas ('mario' acha 'Super Mario'). No controle, L2+LB também abre.",
    placement: "bottom",
  },
  {
    id: "random",
    selector: '[data-tour="random"]',
    title: "Sortear (atalho: R)",
    body: "Escolhe um jogo aleatorio da sua biblioteca inteira — bom pra quebrar a paralisia de 'tenho muito jogo não sei o que jogar'.",
    placement: "bottom",
  },
  {
    id: "settings",
    selector: '[data-tour="settings"]',
    title: "Configurações (atalho: S)",
    body: "Tema, perfil, música ambiente, wallpaper, RetroAchievements, Discord Rich Presence, auto-update do app, pasta de ROMs, cores libretro, BIOS, atalhos. Tudo aqui.",
    placement: "left",
  },
  {
    id: "continue",
    selector: '[data-tour="continue"]',
    title: "Continue jogando",
    body: "Mostra o ultimo jogo que você abriu (com capa). Tocar = retoma exatamente de onde parou (save state automático).",
    placement: "bottom",
  },
  {
    id: "systems",
    selector: '[data-tour="systems"]',
    title: "Plataformas (27+ sistemas)",
    body: "PS1, PS2, N64, GameCube, Wii, 3DS, Saturn, Dreamcast, GBA, NDS, Switch e mais — todos com core embedded (não precisa baixar nada). Use Up/Down no teclado ou D-pad pra navegar. LB/RB pulam categoria inteira.",
    placement: "right",
  },
  {
    id: "sort",
    selector: '[data-tour="sort"]',
    title: "Filtros e ordenacao",
    body: "Padrao / A-Z / Recentes (ultimo jogado) / Mais jogados / Favoritos. Mantenha 'Recentes' pra ver no topo o jogo que você abriu ultimo.",
    placement: "bottom",
  },
  {
    id: "grid",
    selector: '[data-tour="grid"]',
    title: "Sua biblioteca",
    body: "Clique pra abrir detalhes (capa, screenshots, sua nota, tempo jogado, status). Duplo-clique pra iniciar. Botao direito abre menu com 'Remover', 'Favorito', 'Renomear' etc.",
    placement: "top",
  },
  {
    id: "power",
    selector: '[data-tour="sort"]',
    title: "Atalhos & visualização",
    body: "Ctrl+K abre a paleta de comandos — buscar, ir direto pra um console, trocar tema, screenshot, tudo num lugar só. Os 3 ícones ao lado trocam a visualização: grade, capa grande ou lista. Dentro do jogo, F12 tira screenshot.",
    placement: "bottom",
  },
  {
    // selector que não casa com nada → rect null → banner centralizado + blur cheio
    id: "end",
    selector: '[data-tour="__end__"]',
    title: "Bom jogo! 🎮",
    body: "É isso! Sua biblioteca retro tá pronta. Aproveite — e bons jogos.",
    placement: "center",
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
  // Backdrop-filter so funciona em <div>, não dentro de <mask> — entao usamos
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
    <div className="lx-tour-banner" style={style} role="dialog" aria-label={t(step.title)}>
      <div className="lx-tour-banner-step">
        {t("Passo {n} de {total}", { n: idx + 1, total })}
      </div>
      <h2 className="lx-tour-banner-title">{t(step.title)}</h2>
      <p className="lx-tour-banner-body">{t(step.body)}</p>
      {step.id === "end" && (
        <div className="lx-tour-credit" style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 14px", fontSize: 13, color: "var(--theme-muted, #aaa)" }}>
          <span>{t("Feito com 💜 por")} <strong style={{ color: "var(--theme-text, #fff)" }}>Paulo</strong></span>
          <button
            onClick={() => invoke("open_url", { url: "https://instagram.com/paulo.videodev" }).catch(() => {})}
            style={{ marginLeft: "auto", background: "var(--lx-grad, linear-gradient(135deg,#7c3aed,#ec4899))", color: "#fff", border: 0, borderRadius: 999, padding: "5px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}
            title="Instagram"
          >📸 @paulo.videodev</button>
        </div>
      )}
      <div className="lx-tour-banner-actions">
        <button className="lx-tour-btn lx-tour-btn-ghost" onClick={onSkip}>
          {t("Pular tour")}
        </button>
        <div className="lx-tour-banner-nav">
          {idx > 0 && (
            <button className="lx-tour-btn lx-tour-btn-ghost" onClick={onPrev}>
              {t("Anterior")}
            </button>
          )}
          <button className="lx-tour-btn lx-tour-btn-primary" onClick={onNext}>
            {idx === total - 1 ? t("Concluir tour") : t("Próximo")}
          </button>
        </div>
      </div>
      <div className="lx-tour-banner-step" style={{ marginTop: 10, opacity: 0.75 }}>
        🎮 <b>A</b> {t("próximo")} · <b>B</b> {t("anterior")} · <b>Start</b> {t("pular")}
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

  function cycleAvatar(dir) {
    setCustomPhotoPath(null);
    setAvatarId((cur) => {
      const i = DEFAULT_AVATARS.findIndex(a => a.id === cur);
      const n = (i + dir + DEFAULT_AVATARS.length) % DEFAULT_AVATARS.length;
      return DEFAULT_AVATARS[n].id;
    });
  }

  // v0.9.39: controle no perfil. Enquanto o OSK está aberto, ele tem o loop
  // próprio (não agimos aqui). Fechado: A abre o teclado (ou Entra se nome ok),
  // X/Y abre teclado pra editar, D-pad/LB/RB troca avatar, Start = Entrar.
  const gpRef = useRef(null);
  gpRef.current = (btn) => {
    if (oskOpen) return;
    if (btn === "a") { if (canContinue) handleCreate(); else setOskOpen(true); }
    else if (btn === "x" || btn === "y") setOskOpen(true);
    else if (btn === "start") { if (canContinue) handleCreate(); }
    else if (btn === "left" || btn === "lb") cycleAvatar(-1);
    else if (btn === "right" || btn === "rb") cycleAvatar(1);
  };
  useGamepadButtons(gpRef);

  return (
    <div className="lx-firstrun-card">
      <h2 className="lx-firstrun-title">{t("Crie seu perfil")}</h2>
      <p className="lx-firstrun-sub">
        {t("Seu perfil guarda saves, favoritos, tempo jogado e nota dos jogos. Pode trocar tudo depois nos Ajustes.")}
      </p>

      <label className="lx-firstrun-field">
        <span>{t("Como você quer ser chamado?")}</span>
        <input
          autoFocus
          type="text"
          maxLength={28}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setOskOpen(true)}
          placeholder={t("Seu nome ou apelido (clique pra digitar com controle)")}
          readOnly={oskOpen}
        />
      </label>
      {oskOpen && (
        <VirtualKeyboard
          label={t("Seu nome ou apelido")}
          value={name}
          maxLength={28}
          placeholder={t("Digite com controle ou teclado")}
          onChange={setName}
          onSubmit={() => setOskOpen(false)}
          onClose={() => setOskOpen(false)}
        />
      )}

      <div className="lx-firstrun-field">
        <span>{t("Escolha um avatar")}</span>
        <div className="lx-avatar-grid">
          {DEFAULT_AVATARS.map((av) => {
            const selected = !customPhotoPath && av.id === avatarId;
            return (
              <button
                key={av.id}
                type="button"
                className={`lx-avatar-tile ${selected ? "selected" : ""}`}
                title={t(av.label)}
                onClick={() => { setAvatarId(av.id); setCustomPhotoPath(null); }}
              >
                <img src={avatarUrl(av)} alt={t(av.label)} />
              </button>
            );
          })}
          <button
            type="button"
            className={`lx-avatar-tile lx-avatar-custom ${customPhotoPath ? "selected" : ""}`}
            onClick={pickPhoto}
            disabled={pickingPhoto}
            title={t("Escolher imagem do PC")}
          >
            {customPhotoPath ? (
              <img src={convertFileSrc(customPhotoPath)} alt={t("Sua foto")} />
            ) : (
              <span>{t("+ Foto")}</span>
            )}
          </button>
        </div>
      </div>

      <div className="lx-firstrun-actions">
        {onBack && (
          <button className="lx-tour-btn lx-tour-btn-ghost" onClick={onBack}>
            {t("Ver tour de novo")}
          </button>
        )}
        <button
          className="lx-tour-btn lx-tour-btn-primary"
          onClick={handleCreate}
          disabled={!canContinue}
        >
          {t("Entrar no Ludex")}
        </button>
      </div>
      {!canContinue && (
        <p className="lx-firstrun-hint">{t("Digite pelo menos 2 letras pra continuar.")}</p>
      )}
      <p className="lx-firstrun-hint">🎮 {t("No controle:")} <b>A</b> {t("digitar nome / Entrar")} · <b>←/→</b> {t("trocar avatar")} · <b>Start</b> {t("Entrar")}</p>
    </div>
  );
}

/**
 * Wrapper completo: tour primeiro, depois criação de perfil.
 * Não é desmontado pelo pai (LudexLauncher) — fica em cima de tudo até o user
 * concluir. Quando termina, chama onComplete({ name, avatar | customPhotoPath })
 * e o pai persiste o perfil + chama complete_first_run() no backend.
 *
 * v0.9.34: prop `tourOnly` = true pula o intro e a criação de perfil, vai
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

  // v0.9.39: controle no intro + tour. (O perfil tem o handler próprio no
  // ProfileForm.) A/→ avança, B/← volta, Start/Select/Y pula, Y no intro abre tour.
  const gpRef = useRef(null);
  gpRef.current = (btn) => {
    if (phase === "intro") {
      if (btn === "a") setPhase("profile");
      else if (btn === "y") setPhase("tour");
    } else if (phase === "tour") {
      if (btn === "a" || btn === "right") nextStep();
      else if (btn === "b" || btn === "left") prevStep();
      else if (btn === "start" || btn === "select" || btn === "y") skipTour();
    }
  };
  useGamepadButtons(gpRef);

  if (phase === "intro") {
    return (
      <div className="lx-firstrun-root">
        <div className="lx-firstrun-bg" />
        <div className="lx-firstrun-card lx-firstrun-card-intro">
          <div className="lx-firstrun-logo"><img src="/ludex-wordmark.png" alt="Ludex" style={{ width: "min(340px, 72%)", height: "auto", display: "block", margin: "0 auto" }} /></div>
          <p className="lx-firstrun-sub">
            {t("Sua biblioteca retro em um lugar só — 27+ sistemas embedded, controle nativo, save states, RetroAchievements e Discord Rich Presence.")}
          </p>
          <div className="lx-firstrun-actions" style={{ justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
            <button className="lx-tour-btn lx-tour-btn-primary" onClick={() => setPhase("profile")}>
              {t("Continuar")}
            </button>
            <button className="lx-tour-btn lx-tour-btn-ghost" onClick={() => setPhase("tour")}>
              {t("Ver tour guiado (opcional)")}
            </button>
          </div>
          <p className="lx-firstrun-hint" style={{ marginTop: 16 }}>🎮 {t("No controle:")} <b>A</b> {t("continuar")} · <b>Y</b> {t("ver tour")}</p>
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
