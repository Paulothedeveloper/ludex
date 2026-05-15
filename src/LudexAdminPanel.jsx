import React, { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Painel admin (modal fullscreen) que so abre se a license atual eh marcada
 * como is_admin pelo backend (email do comprador == ADMIN_EMAIL no secrets.rs).
 *
 * Lista vendas via Gumroad /v2/sales. Permite filtrar por email e force
 * deactivate (decrementa uses count) de qualquer license individual. Pra ban
 * total / refund, manda Paulo pro dashboard Gumroad (a API publica nao expoe
 * disable_license).
 *
 * Nada aqui depende so do frontend — cada admin command chama ensure_admin()
 * no backend que consulta o Gumroad. Se alguem abrir esse componente com
 * DevTools sem ser admin, todos os commands respondem "Acesso negado".
 */
export default function LudexAdminPanel({ onClose }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(true);
  const [search, setSearch] = useState("");
  const [actioning, setActioning] = useState(null); // license_key sendo desativada
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
    if (!confirm(`Liberar 1 slot da license de ${email || licenseKey}?\n\nIsso decrementa o uses_count no Gumroad. O cliente vai poder ativar em outro PC.`)) return;
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

  // Stats agregados (do que veio nessa pagina, nao do total)
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
            <p className="lx-adminpanel-sub">Vendas via Gumroad · gerenciamento de licenças</p>
          </div>
          <button className="lx-adminpanel-close" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <div className="lx-adminpanel-stats">
          <div className="lx-stat-pill">
            <span className="lx-stat-label">Vendas (esta página)</span>
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
          <button className="lx-adminpanel-btn" onClick={() => load(page)} disabled={busy}>
            {busy ? "Carregando..." : "Atualizar"}
          </button>
          <button className="lx-adminpanel-btn lx-adminpanel-btn-ghost" onClick={openDashboard}>
            Dashboard Gumroad ↗
          </button>
        </div>

        {actionMsg && (
          <p className={`lx-adminpanel-msg lx-adminpanel-msg-${actionMsg.kind}`}>
            {actionMsg.text}
          </p>
        )}

        {err && <p className="lx-adminpanel-msg lx-adminpanel-msg-error">{err}</p>}

        <div className="lx-adminpanel-tablewrap">
          <table className="lx-adminpanel-table">
            <thead>
              <tr>
                <th>Comprador</th>
                <th>Email</th>
                <th>Data</th>
                <th style={{ textAlign: "right" }}>Preço</th>
                <th style={{ textAlign: "center" }}>PCs</th>
                <th>License</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {busy && filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", opacity: 0.6, padding: 24 }}>Carregando vendas...</td></tr>
              )}
              {!busy && filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", opacity: 0.6, padding: 24 }}>
                  {search ? "Nenhuma venda bate com a busca." : "Nenhuma venda nessa página."}
                </td></tr>
              )}
              {filtered.map(s => {
                const date = s.created_at ? new Date(s.created_at).toLocaleDateString("pt-BR") : "—";
                const price = `R$ ${(Number(s.price || 0) / 100).toFixed(2)}`;
                const uses = s.license_uses_count || 0;
                const maxPC = 2;
                const keyShort = s.license_key
                  ? `${s.license_key.slice(0, 8)}...${s.license_key.slice(-4)}`
                  : "—";
                return (
                  <tr key={s.id}>
                    <td>{s.full_name || "—"}</td>
                    <td className="lx-adminpanel-email">{s.email || "—"}</td>
                    <td>{date}</td>
                    <td style={{ textAlign: "right" }}>{price}</td>
                    <td style={{ textAlign: "center", color: uses >= maxPC ? "#fca5a5" : undefined }}>
                      {uses}/{maxPC}
                    </td>
                    <td className="lx-adminpanel-key" title={s.license_key}>{keyShort}</td>
                    <td>
                      {s.refunded ? <span className="lx-tag lx-tag-danger">Refund</span>
                       : s.disputed ? <span className="lx-tag lx-tag-warn">Disputa</span>
                       : uses > 0 ? <span className="lx-tag lx-tag-ok">Ativa</span>
                       : <span className="lx-tag">Não ativada</span>}
                    </td>
                    <td>
                      {s.license_key && uses > 0 && !s.refunded && (
                        <button
                          className="lx-adminpanel-btn-mini"
                          onClick={() => forceDeactivate(s.license_key, s.email)}
                          disabled={actioning === s.license_key}
                          title="Decrementa o uses_count em 1 (libera 1 slot)"
                        >
                          {actioning === s.license_key ? "..." : "Liberar slot"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
          Pra <strong>refund</strong> ou <strong>banir</strong> uma sale por completo, use o
          <button className="lx-adminpanel-link" onClick={openDashboard}> Dashboard Gumroad</button>
          (a API pública não expõe disable_license).
        </p>
      </div>
    </div>
  );
}
