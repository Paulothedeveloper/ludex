import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import VirtualKeyboard from "./LudexOSK";
import { t, LANGUAGES, getLanguage, setLanguage } from "./ludexI18n";

/**
 * Tela bloqueante mostrada antes de qualquer outra coisa quando o app não
 * tem license valida. Renderiza:
 * - Logo Ludex
 * - Input pra colar license key (com OSK pra controle)
 * - Botao "Colar" (clipboard) e "Ativar"
 * - Link "Comprar agora" abrindo o Gumroad no browser
 *
 * onLicensed() eh chamado quando ativacao deu certo (config persistido no
 * backend ja). LudexLauncher entao deixa o app continuar pro splash/onboarding.
 *
 * Importante: input NAO eh readOnly mesmo com OSK aberto, pra permitir que o
 * user de teclado fisico cole com Ctrl+V. OSK so eh visual auxiliar.
 */
// v0.9.37: detecta erro de REDE (offline) vs rejeição real da chave, pra nunca
// mostrar stacktrace crua nem confundir "sem internet" com "chave inválida".
function isNetworkError(msg) {
  const low = String(msg || "").toLowerCase();
  return low.includes("sending request") || low.includes("network") ||
    low.includes("timeout") || low.includes("dns") || low.includes("connect") ||
    low.includes("conex") || low.includes("offline") || low.includes("resolve");
}

export default function LudexLicenseGate({ onLicensed, reason }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [purchaseUrl, setPurchaseUrl] = useState("");
  const [oskOpen, setOskOpen] = useState(false);

  useEffect(() => {
    invoke("license_purchase_link").then(setPurchaseUrl).catch(() => {});
  }, []);

  async function activate() {
    if (!key.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const info = await invoke("license_activate", { key: key.trim() });
      if (info?.valid) {
        onLicensed && onLicensed(info);
      } else {
        setErr(info?.message || "Chave invalida");
      }
    } catch (e) {
      setErr(isNetworkError(e)
        ? t("Sem conexão com a internet. Reconecte e tente ativar de novo.")
        : t("Não consegui validar a chave. Confira se digitou/colou certo."));
    } finally {
      setBusy(false);
    }
  }

  function buyNow() {
    if (purchaseUrl) {
      invoke("open_url", { url: purchaseUrl }).catch(() => {});
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setKey(text.trim().toUpperCase());
        setErr(null);
        setOskOpen(false);
      }
    } catch (e) {
      setErr(t("Nao consegui ler o clipboard. Cola manualmente com Ctrl+V no campo."));
    }
  }

  return (
    <div className="lx-licgate-root">
      <div className="lx-licgate-bg" />

      <div className="lx-licgate-card">
        {/* v0.9.40: seletor de idioma na tela de entrada (issue #1) */}
        <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
          {LANGUAGES.map((lng) => (
            <button key={lng.code} type="button"
              title={lng.label}
              onClick={() => setLanguage(lng.code)}
              style={{
                background: getLanguage() === lng.code ? "rgba(124,92,255,0.35)" : "rgba(255,255,255,0.06)",
                border: getLanguage() === lng.code ? "1px solid rgba(124,92,255,0.8)" : "1px solid rgba(255,255,255,0.14)",
                borderRadius: 8, padding: "5px 9px", cursor: "pointer", fontSize: 16, lineHeight: 1,
              }}>{lng.flag}</button>
          ))}
        </div>
        <div className="lx-licgate-logo"><img src="/ludex-wordmark.png" alt="Ludex" style={{ width: "min(320px, 78%)", height: "auto", display: "block", margin: "0 auto" }} /></div>
        <p className="lx-licgate-sub">{t("Sua biblioteca retro em um lugar só")}</p>

        <div className="lx-licgate-divider" />

        {reason === "offline" && (
          <p style={{
            background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.35)",
            color: "#fde68a", borderRadius: 10, padding: "10px 12px", fontSize: 13,
            lineHeight: 1.45, margin: "0 0 14px 0",
          }}>
            {t("Você já ativou o Ludex aqui, mas não consegui revalidar a licença (parece que ficou muito tempo sem internet). Reconecte e clique em")} <b>{t("Ativar")}</b> {t("com a")} <b>{t("mesma chave")}</b> {t("— seus jogos e perfis continuam salvos.")}
          </p>
        )}

        <label className="lx-licgate-field">
          <span>{t("Sua license key")}</span>
          <input
            type="text"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            onClick={() => setOskOpen(true)}
            maxLength={64}
            spellCheck={false}
          />
        </label>

        {err && <p className="lx-licgate-err">{err}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="lx-licgate-btn lx-licgate-btn-ghost"
            onClick={pasteFromClipboard}
            type="button"
            style={{ flex: "0 0 auto", minWidth: 96 }}
          >
            {t("Colar")}
          </button>
          <button
            className="lx-licgate-btn lx-licgate-btn-primary"
            onClick={activate}
            disabled={busy || !key.trim()}
            style={{ flex: 1 }}
          >
            {busy ? t("Validando...") : t("Ativar Ludex")}
          </button>
        </div>

        <div className="lx-licgate-divider" />

        <p className="lx-licgate-help">{t("Não tem uma license ainda?")}</p>
        <button
          className="lx-licgate-btn lx-licgate-btn-ghost"
          onClick={buyNow}
          disabled={!purchaseUrl}
        >
          {t("Comprar agora →")}
        </button>

        <p className="lx-licgate-foot">
          {t("Funciona em até 2 PCs · Acesso vitalício · Sem assinatura")}
        </p>
      </div>

      {oskOpen && (
        <VirtualKeyboard
          label={t("License key")}
          value={key}
          maxLength={64}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          onChange={(v) => setKey(v.toUpperCase())}
          onSubmit={() => { setOskOpen(false); activate(); }}
          onClose={() => setOskOpen(false)}
        />
      )}
    </div>
  );
}
