import React, { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { lxConfirm } from "./LudexDialog";

/**
 * Painel admin (modal fullscreen) que so abre se a license atual eh marcada
 * como is_admin pelo backend (email do comprador == ADMIN_EMAIL no secrets.rs).
 *
 * Lista vendas via Gumroad /v2/sales. Permite filtrar por email e force
 * deactivate (decrementa uses count) de qualquer license individual. Pra ban
 * total / refund, manda Paulo pro dashboard Gumroad (a API pública não expoe
 * disable_license).
 *
 * Layout de cards (não tabela) pra funcionar bem em qualquer largura.
 */
export default function LudexAdminPanel({ onClose }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(true);
  const [search, setSearch] = useState("");
  const [actioning, setActioning] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  async function load(p = page) {
    setBusy(true);
    setErr(null);
    try {
      const resp = await invoke("admin_list_sales", { page: p });
      setData(resp);
    } catch (e) {
      setErr(String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(page); }, [page]);

  async function forceDeactivate(licenseKey, email) {
    if (!await lxConfirm(`Liberar 1 slot da license de ${email || licenseKey}?\n\nIsso decrementa o uses_count no Gumroad. O cliente vai poder ativar em outro PC.`, { title: "Liberar slot", okText: "Liberar" })) return;
    setActioning(licenseKey);
    setActionMsg(null);
    try {
      await invoke("admin_force_deactivate", { licenseKey });
      setActionMsg({ kind: "ok", text: `Slot liberado pra ${email || licenseKey}` });
      await load(page);
    } catch (e) {
      setActionMsg({ kind: "error", text: String(e) });
    } finally {
      setActioning(null);
    }
  }

  async function openDashboard() {
    try {
      const url = await invoke("admin_dashboard_url");
      await invoke("open_url", { url });
    } catch (e) {
      setActionMsg({ kind: "error", text: String(e) });
    }
  }

  const sales = data?.sales || [];
  const filtered = useMemo(() => {
    if (!search.trim()) return sales;
    const q = search.toLowerCase();
    return sales.filter(s =>
      (s.email || "").toLowerCase().includes(q) ||
      (s.license_key || "").toLowerCase().includes(q) ||
      (s.full_name || "").toLowerCase().includes(q)
    );
  }, [sales, search]);

  const stats = useMemo(() => {
    let totalRevenue = 0;
    let refunded = 0;
    let activated = 0;
    for (const s of sales) {
      totalRevenue += Number(s.price || 0);
      if (s.refunded) refunded++;
      if ((s.license_uses_count || 0) > 0) activated++;
    }
    return { totalRevenue, refunded, activated, total: sales.length };
  }, [sales]);

  return (
    <div className="lx-adminpanel-root" onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div className="lx-adminpanel-card">
        <header className="lx-adminpanel-header">
          <div>
            <h2>Painel Admin · Ludex</h2>
            <p className="lx-adminpanel-sub">Vendas via Gumroad</p>
          </div>
          <button className="lx-adminpanel-close" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <div className="lx-adminpanel-stats">
          <div className="lx-stat-pill">
            <span className="lx-stat-label">Vendas (página)</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="lx-stat-pill">
            <span className="lx-stat-label">Faturamento</span>
            <strong>R$ {(stats.totalRevenue / 100).toFixed(2)}</strong>
          </div>
          <div className="lx-stat-pill">
            <span className="lx-stat-label">Ativadas</span>
            <strong>{stats.activated}</strong>
          </div>
          <div className="lx-stat-pill" style={{ color: stats.refunded > 0 ? "#fca5a5" : undefined }}>
            <span className="lx-stat-label">Refunds</span>
            <strong>{stats.refunded}</strong>
          </div>
        </div>

        <div className="lx-adminpanel-toolbar">
          <input
            className="lx-adminpanel-search"
            type="text"
            placeholder="Buscar por email, nome ou license key..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="lx-adminpanel-toolbar-actions">
            <button className="lx-adminpanel-btn" onClick={() => load(page)} disabled={busy}>
              {busy ? "..." : "Atualizar"}
            </button>
            <button className="lx-adminpanel-btn lx-adminpanel-btn-ghost" onClick={openDashboard}>
              Gumroad ↗
            </button>
          </div>
        </div>

        {actionMsg && (
          <p className={`lx-adminpanel-msg lx-adminpanel-msg-${actionMsg.kind}`}>
            {actionMsg.text}
          </p>
        )}

        {err && <p className="lx-adminpanel-msg lx-adminpanel-msg-error">{err}</p>}

        <div className="lx-adminpanel-list">
          {busy && filtered.length === 0 && (
            <div className="lx-adminpanel-empty">Carregando vendas...</div>
          )}
          {!busy && filtered.length === 0 && (
            <div className="lx-adminpanel-empty">
              {search ? "Nenhuma venda bate com a busca." : "Nenhuma venda nessa página ainda."}
              {!search && (
                <p className="lx-adminpanel-empty-hint">
                  Compras de teste do creator podem não aparecer aqui — só vendas reais de clientes externos.
                </p>
              )}
            </div>
          )}
          {filtered.map(s => {
            const date = s.created_at ? new Date(s.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
            const price = `R$ ${(Number(s.price || 0) / 100).toFixed(2)}`;
            const uses = s.license_uses_count || 0;
            const maxPC = 2;
            const status = s.refunded ? { label: "Refund", cls: "danger" }
                       : s.disputed ? { label: "Disputa", cls: "warn" }
                       : uses > 0 ? { label: "Ativa", cls: "ok" }
                       : { label: "Não ativada", cls: "" };
            return (
              <div key={s.id} className="lx-sale-card">
                <div className="lx-sale-header">
                  <div className="lx-sale-identity">
                    <strong>{s.full_name || s.email || "Sem nome"}</strong>
                    {s.email && s.email !== s.full_name && (
                      <span className="lx-sale-email">{s.email}</span>
                    )}
                  </div>
                  <span className={`lx-tag lx-tag-${status.cls}`}>{status.label}</span>
                </div>
                <div className="lx-sale-meta">
                  <span><b>{date}</b></span>
                  <span>·</span>
                  <span><b>{price}</b></span>
                  <span>·</span>
                  <span style={{ color: uses >= maxPC ? "#fca5a5" : undefined }}>
                    <b>{uses}/{maxPC}</b> PCs
                  </span>
                </div>
                {s.license_key && (
                  <div className="lx-sale-key" title={s.license_key}>
                    <span className="lx-sale-key-label">License:</span>
                    <code>{s.license_key}</code>
                  </div>
                )}
                {s.license_key && uses > 0 && !s.refunded && (
                  <div className="lx-sale-actions">
                    <button
                      className="lx-adminpanel-btn-mini"
                      onClick={() => forceDeactivate(s.license_key, s.email)}
                      disabled={actioning === s.license_key}
                    >
                      {actioning === s.license_key ? "Liberando..." : "Liberar 1 slot"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="lx-adminpanel-pager">
          <button
            className="lx-adminpanel-btn"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || busy}
          >
            ← Anterior
          </button>
          <span className="lx-adminpanel-pageinfo">Página {page}</span>
          <button
            className="lx-adminpanel-btn"
            onClick={() => setPage(p => p + 1)}
            disabled={busy || sales.length === 0}
          >
            Próxima →
          </button>
        </div>

        <p className="lx-adminpanel-foot">
          Pra <strong>refund</strong> ou <strong>banir</strong>, abra o
          <button className="lx-adminpanel-link" onClick={openDashboard}>Dashboard Gumroad</button>.
        </p>
      </div>
    </div>
  );
}
