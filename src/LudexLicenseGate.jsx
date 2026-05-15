import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import VirtualKeyboard from "./LudexOSK";

/**
 * Tela bloqueante mostrada antes de qualquer outra coisa quando o app nao
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
export default function LudexLicenseGate({ onLicensed }) {
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
      setErr(String(e));
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
      setErr("Nao consegui ler o clipboard. Cola manualmente com Ctrl+V no campo.");
    }
  }

  return (
    <div className="lx-licgate-root">
      <div className="lx-licgate-bg" />

      <div className="lx-licgate-card">
        <div className="lx-licgate-logo">L U D E X</div>
        <p className="lx-licgate-sub">Sua biblioteca retro em um lugar só</p>

        <div className="lx-licgate-divider" />

        <label className="lx-licgate-field">
          <span>Sua license key</span>
          <input
            type="text"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            onFocus={() => setOskOpen(true)}
            maxLength={64}
            autoFocus
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
            Colar
          </button>
          <button
            className="lx-licgate-btn lx-licgate-btn-primary"
            onClick={activate}
            disabled={busy || !key.trim()}
            style={{ flex: 1 }}
          >
            {busy ? "Validando..." : "Ativar Ludex"}
          </button>
        </div>

        <div className="lx-licgate-divider" />

        <p className="lx-licgate-help">Não tem uma license ainda?</p>
        <button
          className="lx-licgate-btn lx-licgate-btn-ghost"
          onClick={buyNow}
          disabled={!purchaseUrl}
        >
          Comprar agora →
        </button>

        <p className="lx-licgate-foot">
          Funciona em até 2 PCs · Acesso vitalício · Sem assinatura
        </p>
      </div>

      {oskOpen && (
        <VirtualKeyboard
          label="License key"
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
