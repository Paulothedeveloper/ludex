import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/* SVG icons inline — sem emoji em UI de producao. Stroke 1.6, 18x18 default. */
const ic = (size = 18) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round",
});
export const FolderIcon  = (p) => <svg {...ic(p?.size)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>;
export const GiftIcon    = (p) => <svg {...ic(p?.size)}><path d="M20 12v9H4v-9"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/></svg>;
export const ToolsIcon   = (p) => <svg {...ic(p?.size)}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5 2.5-2.5Z"/></svg>;
export const GlobeIcon   = (p) => <svg {...ic(p?.size)}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>;
export const GamepadIcon = (p) => <svg {...ic(p?.size)}><path d="M6 9h2M7 8v2M16 9h.01M18 11h.01M5 6h14a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3 4 4 0 0 1-3-1l-1-1H8l-1 1a4 4 0 0 1-3 1 3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z"/></svg>;
export const WarningIcon = (p) => <svg {...ic(p?.size)}><path d="M12 3 1 21h22L12 3Z"/><path d="M12 10v5M12 18v.01"/></svg>;
export const ExternalIcon = (p) => <svg {...ic(p?.size)}><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M20 14v6H4V4h6"/></svg>;
const CloseIconLx  = (p) => <svg {...ic(p?.size)}><path d="M6 6l12 12M18 6 6 18"/></svg>;

/**
 * Empty state mostrado quando o sistema atual não tem ROMs.
 * Botões: abrir pasta de ROMs, abrir pasta de DLCs, abrir pasta de Mods, ver sugestões.
 * O backend cria as subpastas _DLC e _MODS sob demanda via get_system_folders.
 */
export function EmptyStateSystem({ system, onOpenSuggestions, onOpenControls }) {
  const [folders, setFolders] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function ensureFolders() {
    setBusy(true);
    setErr(null);
    try {
      const f = await invoke("get_system_folders", { systemId: system.id });
      setFolders(f);
      return f;
    } catch (e) {
      setErr(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openKind(kind) {
    let f = folders || await ensureFolders();
    if (!f) return;
    const path = kind === "roms" ? f.roms_path : kind === "dlc" ? f.dlc_path : f.mods_path;
    try { await invoke("open_folder", { path }); } catch (e) { setErr(String(e)); }
  }

  return (
    <div className="lx-empty-system">
      <h3 className="lx-empty-title">Sem jogos do {system.name} ainda</h3>
      <p className="lx-empty-body">
        Coloque suas ROMs na pasta certa e o Ludex vai detectar automaticamente. DLCs ficam em <code>_DLC/</code>, mods e patches em <code>_MODS/</code> dentro da mesma pasta do console — o Ludex cria essas subpastas pra você.
      </p>
      <div className="lx-empty-actions">
        <button className="lx-empty-btn lx-empty-btn-primary" onClick={() => openKind("roms")} disabled={busy}>
          <FolderIcon /> Abrir pasta de ROMs
        </button>
        <button className="lx-empty-btn" onClick={() => openKind("dlc")} disabled={busy}>
          <GiftIcon /> Abrir pasta de DLCs
        </button>
        <button className="lx-empty-btn" onClick={() => openKind("mods")} disabled={busy}>
          <ToolsIcon /> Abrir pasta de Mods/Patches
        </button>
        <button className="lx-empty-btn" onClick={() => onOpenSuggestions && onOpenSuggestions(system)}>
          <GlobeIcon /> Onde baixar
        </button>
        <button className="lx-empty-btn" onClick={() => onOpenControls && onOpenControls(system)}>
          <GamepadIcon /> Configurar controle
        </button>
      </div>
      <p className="lx-empty-warn">
        <WarningIcon size={14} /> Use ROMs, DLCs e patches que você possui legalmente. Mods de tradução e patches de FPS/resolução podem corromper saves antigos — faça backup antes.
      </p>
      {err && <p className="lx-empty-warn" style={{ color: "#fca5a5" }}>{err}</p>}
    </div>
  );
}

/**
 * Catálogo de sites — categorizado por tipo. Cada item tem nome, descrição e URL.
 * Backend abre a URL no navegador padrão via comando open_url.
 *
 * AVISO LEGAL: Paulo escolheu publicar a lista cheia. Cada seção tem disclaimer
 * pesado e o modal abre com warning padrão.
 */
const SUGG_DATA = {
  roms: {
    title: "ROMs (jogos)",
    intro: "Sites populares pra baixar ROMs por console. Use só pra jogos que você possui legalmente.",
    items: [
      { name: "Vimm's Lair", desc: "Clássico. Cobertura ampla de retrô (NES, SNES, GBA, PS1, GC, Wii).", url: "https://vimm.net/vault/" },
      { name: "Myrient", desc: "Mirror público de no-intro/redump. Sets organizados por região, hashes verificados.", url: "https://myrient.erista.me/" },
      { name: "CDRomance", desc: "PSP, PS1, PS2, GBA, Switch. Inclui versões pré-patcheadas (PT-BR, undub).", url: "https://cdromance.org/" },
      { name: "r/Roms megathread", desc: "Lista mantida pela comunidade do Reddit. Mais atualizada para Switch/PS3/Xbox.", url: "https://r-roms.github.io/" },
      { name: "NoPayStation (NPS)", desc: "PSP / PSV / PS3. Use o NPS Browser pra baixar PKGs oficiais + DLCs + updates.", url: "https://nopaystation.com/" },
      { name: "Hshop (3DS)", desc: "Loja alternativa de .cia (jogos, DLCs, updates) pra Citra ou 3DS modificado.", url: "https://hshop.erista.me/" },
      { name: "Internet Archive", desc: "Abandonware legal: arcade, MS-DOS, console antigo. 100% público.", url: "https://archive.org/details/softwarelibrary" },
    ],
  },
  mods: {
    title: "Mods, Tradução PT-BR e Patches IPS/UPS",
    intro: "Patches de tradução, undub, PT-BR, mods de gameplay. Aplique no rom original (.smc/.gba/.iso) com Floating IPS ou xdelta.",
    items: [
      { name: "Romhacking.net", desc: "Maior banco de patches IPS/UPS/xdelta. Traduções, hacks de dificuldade, undub.", url: "https://www.romhacking.net/" },
      { name: "Tradu-Roms", desc: "Patches PT-BR de fan tradutores brasileiros. RPGs, JRPGs.", url: "https://www.tradu-roms.com/" },
      { name: "GameBanana", desc: "Mods modernos: Switch (Yuzu), PC, retroarch shaders. Texturas HD.", url: "https://gamebanana.com/" },
      { name: "GBAtemp", desc: "Hub da comunidade. CFW guides, mods de Switch/3DS/Wii U.", url: "https://gbatemp.net/" },
    ],
  },
  patches: {
    title: "Patches de FPS / Resolução / Performance",
    intro: "Mods que destravam framerate, melhoram resolução interna ou removem fog/blur. Apenas pra emuladores específicos.",
    items: [
      { name: "PCSX2 Cheat Database", desc: "PNACH files com 60FPS unlock + widescreen patches pra PS2.", url: "https://forums.pcsx2.net/Forum-PCSX2-cheats-and-game-fixes" },
      { name: "RPCS3 Patch List", desc: "Patches oficiais embutidos no RPCS3 (FPS, resolução). Atualize via Manager.", url: "https://wiki.rpcs3.net/index.php?title=Help:Patches" },
      { name: "Dolphin Wiki (per-game)", desc: "Notas por jogo: gráficos, hacks, savestates compatíveis.", url: "https://wiki.dolphin-emu.org/" },
      { name: "Yuzu Mods (GameBanana)", desc: "Mods de Switch: 60FPS, 4K, gameplay. Coloque em load/<TitleID>/.", url: "https://gamebanana.com/games/7237" },
      { name: "Citra Patches", desc: "Texture packs HD, mods, undub de 3DS. Coloque em load/mods/<TitleID>/.", url: "https://citra-emu.org/wiki/" },
    ],
  },
  dlcs: {
    title: "DLCs e Updates",
    intro: "Conteúdo extra (mapas, personagens, expansões) e atualizações de versão. Atenção à região (USA/EUR/JPN deve casar com a ROM base).",
    items: [
      { name: "NoPayStation", desc: "PSP, PSV, PS3 — DLCs e updates oficiais via NPS Browser.", url: "https://nopaystation.com/" },
      { name: "NSWDB.com", desc: "Banco de dados de Switch — IDs, regiões, atualizações compatíveis.", url: "https://nswdb.com/" },
      { name: "Hshop (3DS)", desc: "DLCs e updates de jogos 3DS em .cia.", url: "https://hshop.erista.me/" },
    ],
  },
};

export function SuggestionsModal({ open, onClose, defaultTab = "roms" }) {
  const [tab, setTab] = useState(defaultTab);
  useEffect(() => { if (open) setTab(defaultTab); }, [open, defaultTab]);
  if (!open) return null;

  const tabs = Object.keys(SUGG_DATA);
  const data = SUGG_DATA[tab];

  async function openLink(url) {
    try { await invoke("open_url", { url }); } catch (e) { console.error("open_url", e); }
  }

  return (
    <div className="lx-modal-overlay" onClick={onClose}>
      <div className="lx-modal lx-modal-large" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="lx-modal-header">
          <h2>Onde baixar — guia de fontes</h2>
          <button className="lx-modal-close" onClick={onClose} aria-label="Fechar"><CloseIconLx /></button>
        </div>

        <div className="lx-sugg-warn">
          <strong>Aviso:</strong> O Ludex apenas referencia esses sites. O conteúdo lá hospedado pode infringir direitos autorais — você é responsável por baixar somente jogos que possui legalmente. Mods e patches podem corromper saves; faça backup antes de aplicar. DLCs precisam ser da mesma região da sua ROM base.
        </div>

        <div className="pb-sort-pills" style={{ marginTop: 14 }}>
          {tabs.map((t) => (
            <button
              key={t}
              className={`pb-sort-pill ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {SUGG_DATA[t].title}
            </button>
          ))}
        </div>

        <div className="lx-suggestions">
          <div className="lx-sugg-section">
            <h4>{data.title}</h4>
            <p>{data.intro}</p>
            <div className="lx-sugg-list">
              {data.items.map((it) => (
                <div key={it.name} className="lx-sugg-item">
                  <div className="lx-sugg-item-info">
                    <span className="lx-sugg-item-name">{it.name}</span>
                    <span className="lx-sugg-item-desc">{it.desc}</span>
                  </div>
                  <button className="lx-sugg-item-link" onClick={() => openLink(it.url)}>
                    Abrir →
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Dicas de configuração de controle por emulador. Cada emulador externo tem
 * seu fluxo próprio — esse modal lista o passo-a-passo + controles testados.
 */
const CONTROL_TIPS = {
  switch: {
    label: "Yuzu (Switch)",
    pads: ["Xbox One/Series", "DualSense (PS5)", "DualShock 4 (PS4)", "Switch Pro", "8BitDo Pro 2"],
    steps: [
      "Conecte o controle ANTES de abrir o jogo (USB ou Bluetooth).",
      "Abra Yuzu standalone (executável fora do Ludex) → Emulation → Configure → Controls.",
      "Em Player 1 escolha 'Pro Controller' como handheld, depois clique em cada botão e pressione no controle.",
      "DualSense/DS4: ative o adapter via 'Use SDL Controller'. Switch Pro: funciona nativo.",
      "Salve. Da próxima vez que rodar pelo Ludex, vai usar essa config.",
    ],
  },
  ps2: {
    label: "PCSX2 (PS2)",
    pads: ["DualShock 4", "DualSense", "Xbox", "8BitDo SN30 Pro"],
    steps: [
      "Conecte o controle antes de abrir.",
      "Abra PCSX2 standalone → Settings → Controllers → Pad 1.",
      "Em 'Type' escolha 'DualShock 2', depois 'Automatic Mapping' e selecione seu controle.",
      "Verifique sticks e pressão dos triggers no Settings.",
      "Salve. Funciona depois pelo Ludex.",
    ],
  },
  gc: {
    label: "Dolphin (GC)",
    pads: ["GameCube Controller adapter", "Xbox", "DualSense", "DS4"],
    steps: [
      "Dolphin → Controllers → Standard Controller, clique 'Configure' do Port 1.",
      "Em 'Device' escolha XInput/0 (Xbox/8BitDo) ou DInput/0 (DS4/DualSense).",
      "Clique em cada botão e pressione no controle. C-Stick vai pro analógico direito.",
      "Pressione 'Background Input' pra funcionar mesmo sem foco da janela.",
      "Salve.",
    ],
  },
  wii: {
    label: "Dolphin (Wii)",
    pads: ["Real Wiimote (Bluetooth)", "Xbox/PS como Wiimote emulado", "Switch JoyCons (via DolphinBar)"],
    steps: [
      "Dolphin → Controllers → 'Emulated Wii Remote' pro Wiimote 1.",
      "Configure os botões + Motion Input (giroscópio do controle moderno funciona).",
      "Pra usar Wiimote real: 'Real Wii Remote' + parear via Bluetooth do PC.",
      "Nunchuck: configure em 'Extension' do Wiimote 1.",
    ],
  },
  ps3: {
    label: "RPCS3 (PS3)",
    pads: ["DualSense (recomendado)", "DualShock 4", "Xbox"],
    steps: [
      "RPCS3 → Pads.",
      "Em 'Handlers' escolha 'DualShock 4' (ou DualSense). Pra Xbox use 'XInput'.",
      "Clique em 'Refresh' e selecione seu controle.",
      "Auto-Map ou configure manualmente. DualSense tem suporte completo (touchpad, vibração).",
    ],
  },
  xbox: {
    label: "xemu (Xbox original)",
    pads: ["DualShock 4", "Xbox (XInput)", "8BitDo"],
    steps: [
      "Conecte o controle antes do jogo.",
      "xemu → Machine → Input → Port 1 → 'Bind All' ou bind manual.",
      "Em alguns jogos o L/R analógico precisa ser configurado nos triggers.",
      "Salve a config — o Ludex já trava o xemu.toml em read-only pra não perder.",
    ],
  },
};

export function ControlsTipModal({ open, onClose, system }) {
  if (!open || !system) return null;
  const tip = CONTROL_TIPS[system.id];

  return (
    <div className="lx-modal-overlay" onClick={onClose}>
      <div className="lx-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="lx-modal-header">
          <h2>Controle — {system.name}</h2>
          <button className="lx-modal-close" onClick={onClose} aria-label="Fechar"><CloseIconLx /></button>
        </div>

        <div className="lx-controls-tip">
          {tip ? (
            <>
              <div className="lx-controls-section">
                <h4>Controles testados</h4>
                <div className="lx-controls-pads">
                  {tip.pads.map((p) => <span key={p} className="lx-controls-pad-pill">{p}</span>)}
                </div>
              </div>
              <div className="lx-controls-section">
                <h4>Passo-a-passo — {tip.label}</h4>
                <ol>
                  {tip.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
              <div className="lx-controls-section">
                <h4>Geral pra qualquer console</h4>
                <ul>
                  <li>Sempre conecte o controle ANTES de abrir o emulador. Conexão depois pode não ser detectada.</li>
                  <li>DualShock 4 / DualSense: use cabo USB se Bluetooth der atraso (input lag).</li>
                  <li>Use o atalho Select+Start (ou Select+R1) no controle pra fechar o jogo e voltar ao Ludex.</li>
                  <li>Se o emulador rodar mas o controle não responder, verifique se a janela do jogo está em foco (clique nela).</li>
                </ul>
              </div>
            </>
          ) : (
            <div className="lx-controls-section">
              <h4>{system.name} — sem dicas específicas</h4>
              <p style={{ margin: 0, fontSize: 13, color: "rgba(229, 222, 244, 0.78)" }}>
                Esse sistema usa os cores libretro embutidos no Ludex. Os controles são detectados automaticamente pelo SDL2 — basta conectar antes de abrir o jogo e ele já funciona.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
