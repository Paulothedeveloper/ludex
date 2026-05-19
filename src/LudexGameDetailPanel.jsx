import React, { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  CloseIcon, SystemIcon, StarIcon, PlayIcon, ImageIcon,
  RotateIcon, FolderIcon,
} from "./ludexIcons";
import {
  formatPlayTime, GAME_STATUS_ORDER, GAME_STATUS_LABELS, GAME_STATUS_EMOJI,
} from "./ludexUtils";

/**
 * Detalhe fullscreen do jogo: capa hero + screenshots + summary + ações.
 * Inclui personal library: status (wishlist/playing/beat/mastered/abandoned),
 * rating 1-5 estrelas e notas com auto-save (debounce 600ms).
 */
export default function GameDetailPanel({
  system, game, playTimeSec, gameMeta, onClose, onLaunch, onPickCover,
  onResyncCover, onOpenLocation, onToggleFavorite, isFavorite, onSetRating,
  onSetStatus, onSetNotes, closing,
}) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeShot, setActiveShot] = useState(0);
  const [notesDraft, setNotesDraft] = useState(gameMeta?.notes || "");
  const notesTimerRef = useRef(null);

  useEffect(() => {
    setNotesDraft(gameMeta?.notes || "");
  }, [game.path, gameMeta?.notes]);

  // Auto-save notas (debounce 600ms)
  useEffect(() => {
    if (notesDraft === (gameMeta?.notes || "")) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      onSetNotes && onSetNotes(notesDraft);
    }, 600);
    return () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); };
  }, [notesDraft]);

  const cycleStatus = () => {
    const cur = gameMeta?.status || "";
    const idx = GAME_STATUS_ORDER.indexOf(cur);
    const next = GAME_STATUS_ORDER[(idx + 1) % GAME_STATUS_ORDER.length];
    onSetStatus && onSetStatus(next);
  };
  const curStatus = gameMeta?.status || "";
  const curRating = gameMeta?.rating || 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    setActiveShot(0);
    (async () => {
      try {
        const d = await invoke("fetch_game_details", { systemId: system.id, gameName: game.name });
        if (!cancelled) setDetails(d);
      } catch (e) {
        console.error("fetch_game_details", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [system.id, game.path, game.name]);

  useEffect(() => {
    if (!details?.screenshot_paths?.length) return;
    const id = setInterval(() => {
      setActiveShot((i) => (i + 1) % details.screenshot_paths.length);
    }, 4000);
    return () => clearInterval(id);
  }, [details]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "Enter") { e.preventDefault(); onLaunch(); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); onToggleFavorite(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onLaunch, onToggleFavorite]);

  const heroSrc = details?.cover_path ? convertFileSrc(details.cover_path) : null;
  const shotSrc = details?.screenshot_paths?.[activeShot] ? convertFileSrc(details.screenshot_paths[activeShot]) : null;

  return (
    <div className={`pb-detail ${closing ? "closing" : ""}`} aria-hidden={closing}>
      {shotSrc && <img key={shotSrc} className="pb-detail-bg" src={shotSrc} alt="" aria-hidden />}
      <div className="pb-detail-overlay" />

      <button className="pb-detail-close" onClick={onClose} title="Fechar (Esc)"><CloseIcon /></button>

      <div className="pb-detail-stage">
        <div className="pb-detail-cover-wrap">
          {heroSrc ? (
            <img className="pb-detail-cover" src={heroSrc} alt={game.name} />
          ) : (
            <div className="pb-detail-cover pb-detail-cover-fallback" style={{ background: system.color }}>
              <div className="pb-detail-cover-icon"><SystemIcon id={system.id} /></div>
            </div>
          )}
          {isFavorite && <span className="pb-detail-fav"><StarIcon filled /></span>}
        </div>

        <div className="pb-detail-info">
          <div className="pb-detail-tag">
            <span className="pb-detail-tag-icon" style={{ color: system.color }}><SystemIcon id={system.id} /></span>
            <span className="pb-detail-tag-name">{system.name}</span>
          </div>

          <h1 className="pb-detail-title">{details?.name || game.name}</h1>

          <div className="pb-detail-meta">
            {details?.first_release_year && <span>{details.first_release_year}</span>}
            {details?.developer && <span>· {details.developer}</span>}
            {details?.publisher && details.publisher !== details.developer && <span>· {details.publisher}</span>}
            {typeof details?.rating === "number" && <span className="pb-detail-rating">{Math.round(details.rating)}<small>/100</small></span>}
          </div>

          {details?.genres?.length > 0 && (
            <div className="pb-detail-genres">
              {details.genres.slice(0, 5).map((g) => <span key={g} className="pb-detail-genre">{g}</span>)}
            </div>
          )}

          <div className="pb-detail-stats">
            <div className="pb-detail-stat">
              <strong>{formatPlayTime(playTimeSec || 0)}</strong>
              <span>tempo jogado</span>
            </div>
            <div className="pb-detail-stat">
              <strong>{game.size_mb ? `${game.size_mb} MB` : "—"}</strong>
              <span>tamanho</span>
            </div>
            <div className="pb-detail-stat">
              <strong>{game.extension?.toUpperCase() || "—"}</strong>
              <span>formato</span>
            </div>
          </div>

          <div className="pb-detail-personal">
            <div className="pb-detail-personal-row">
              <button
                className={`pb-status-pill pb-status-${curStatus || "none"}`}
                onClick={cycleStatus}
                title="Clique pra ciclar entre os status (sem status → quero jogar → jogando → zerei → platinei → abandonei)"
              >
                <span className="pb-status-icon">{GAME_STATUS_EMOJI[curStatus]}</span>
                <span className="pb-status-label">{GAME_STATUS_LABELS[curStatus]}</span>
              </button>
              <div className="pb-rating" role="group" aria-label="Sua nota">
                {[1,2,3,4,5].map((n) => (
                  <button
                    key={n}
                    className={`pb-rating-star ${n <= curRating ? "filled" : ""}`}
                    onClick={() => onSetRating && onSetRating(n === curRating ? 0 : n)}
                    title={`${n} estrela${n > 1 ? "s" : ""} (clique de novo pra limpar)`}
                  >★</button>
                ))}
              </div>
            </div>
            <textarea
              className="pb-detail-notes"
              placeholder="Suas notas sobre o jogo... (auto-salva)"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              maxLength={4000}
              rows={3}
            />
          </div>

          {loading && !details && (
            <p className="pb-detail-loading">Buscando informações no IGDB...</p>
          )}

          {details?.summary && (
            <p className="pb-detail-summary">{details.summary}</p>
          )}

          {details?.screenshot_paths?.length > 0 && (
            <div className="pb-detail-shots">
              {details.screenshot_paths.map((p, i) => (
                <button
                  key={p}
                  className={`pb-detail-shot ${i === activeShot ? "active" : ""}`}
                  onClick={() => setActiveShot(i)}
                >
                  <img src={convertFileSrc(p)} alt="" />
                </button>
              ))}
            </div>
          )}

          <div className="pb-detail-actions">
            <button className="pb-btn pb-btn-primary pb-btn-large" onClick={onLaunch}>
              <PlayIcon /> Jogar
            </button>
            <button className="pb-btn pb-btn-ghost" onClick={onToggleFavorite}>
              <StarIcon filled={isFavorite} />
              {isFavorite ? "Favorito" : "Favoritar"}
            </button>
            <button className="pb-btn pb-btn-ghost" onClick={onPickCover}>
              <ImageIcon /> Trocar capa
            </button>
            <button className="pb-btn pb-btn-ghost" onClick={onResyncCover}>
              <RotateIcon /> Re-sync IGDB
            </button>
            <button className="pb-btn pb-btn-ghost" onClick={onOpenLocation}>
              <FolderIcon /> Abrir local
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
