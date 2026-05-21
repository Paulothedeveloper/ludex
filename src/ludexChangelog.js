// v0.9.8: Changelog + "Novidades" pós-update. Mostra um modal resumido do que
// mudou quando o usuario abre uma versao mais nova do que a ultima que ele viu.
// Usado no app (LudexMobile) e no launcher do PC (LudexLauncher).

// Bullets curtos e claros por versao (pt-BR). Manter a mais nova no topo.
export const CHANGELOG = {
  "0.9.14": [
    "Tela de carregamento some assim que o jogo fica pronto (mais rapida).",
    "Destaque virou 'Mais jogados' (nao repete mais os recentes).",
    "Tema do controle muda tambem o visual em repouso.",
    "Backup agora inclui tema, controle e layout.",
    "Respeita 'reduzir movimento' do sistema; ajustes no tema claro.",
  ],
  "0.9.13": [
    "Destaque no tamanho padrao com contorno colorido; Continua jogando com a capa do jogo.",
    "Tela de carregamento do emulador refeita.",
    "Controle: vibracao on/off, esconder com controle externo, ajuste de tamanho (por grupo e geral) e temas.",
    "Temas do app (Switch Dark, PS3, Sunset, Forest, Light) nos Ajustes.",
    "Config do emulador e menu in-game redesenhados.",
  ],
  "0.9.12": [
    "Modo desempenho pra celular fraco (video 30fps, menos travada).",
    "Aceleracao agora e 1x / 1.25x / 1.5x / 2x.",
    "Icones de sistema iguais aos do launcher do PC.",
    "Configuracoes do emulador refeitas (tela cheia, fontes melhores, sem bugs).",
    "Layout de telas DS/3DS nao duplica mais a tela.",
    "Controle: corrigido travar direcao ao deslizar o dedo.",
    "Tela inicial no modo horizontal com tamanhos ajustados.",
    "Controle externo nos Ajustes + animacao ao abrir um sistema.",
  ],
  "0.9.11": [
    "Controle: deslizar o dedo entre botoes funciona (nao trava mais a direcao).",
    "Barra de navegacao flutuante estilo console, com icones novos e sem texto.",
    "Conquistas aparecem embaixo, acima da barra de navegacao.",
    "Animacao ao trocar de aba e ao abrir o jogo (boot do emulador).",
  ],
  "0.9.10": [
    "Salvar e carregar estado (save state) voltou a funcionar no app.",
    "Botoes L e R nao ficam mais em cima do Voltar e da engrenagem.",
    "DS e 3DS: troca o layout das telas direto no menu (cima/baixo, lado a lado, uma menor no canto).",
  ],
  "0.9.9": [
    "Capas dos jogos voltam a carregar no Android (rede com IPv6 instavel).",
    "Som dos emuladores mais estavel: emulacao no ritmo do audio, sem engasgo.",
    "App assinado com chave propria (some o alerta de seguranca no Android).",
    "Crashes do app agora ficam registrados nos Logs pra diagnostico.",
  ],
  "0.9.8": [
    "Banner de novidades: agora o app mostra o que mudou a cada atualizacao.",
  ],
  "0.9.7": [
    "Animacao de abertura (splash) e entrada suave dos catalogos.",
    "Controles do emulador com toque animado (escala + brilho).",
  ],
  "0.9.6": [
    "App nao e mais marcado como malware no Android.",
    "Nota da web (IGDB) no detalhe do jogo.",
  ],
  "0.9.5": [
    "Som dos emuladores, da interface e da musica corrigidos no Android.",
    "Pasta separada por emulador (cada sistema com a sua).",
    "Botao Voltar navega dentro do app em vez de minimizar.",
    "Perfil com foto e nome editaveis, e mais presente na tela inicial.",
  ],
  "0.9.4": [
    "Editor de perfil (trocar foto e nome) tocando no avatar.",
    "Tutorial inicial nao trava mais.",
  ],
  "0.9.3": [
    "Detalhe do jogo: nota, abrir pasta e mods.",
    "Atualizacao abre a pagina de download no navegador.",
  ],
};

const LAST_SEEN_KEY = "ludex.lastSeenVersion";

// Compara versoes semver-ish "a.b.c". >0 se a>b.
export function cmpVersion(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function getLastSeen() {
  try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
}

export function markVersionSeen(version) {
  try { localStorage.setItem(LAST_SEEN_KEY, version); } catch {}
}

// Retorna { current, entries: [{version, items}] } com tudo que mudou entre a
// ultima versao vista e a atual. null se nao ha o que mostrar.
// Em instalacao nova (sem lastSeen) NAO mostra — so marca como visto (o tutorial
// cobre o onboarding). So mostra quando houve um UPDATE de verdade.
export function getWhatsNew(currentVersion, isReturningUser = false) {
  if (!currentVersion) return null;
  const lastSeen = getLastSeen();
  if (!lastSeen) {
    // Sem registro. Se o usuario JA usava o app (returning), provavelmente
    // atualizou de uma versao sem esse recurso -> mostra so a versao atual.
    // Se for instalacao nova (não returning), nao mostra (o tutorial cobre).
    if (isReturningUser) {
      // Primeira vez vendo o changelog (atualizou de uma versao sem o recurso):
      // mostra as ultimas versoes (ate 4) ate a atual, pra dar um resumo util.
      const recent = Object.keys(CHANGELOG)
        .filter((v) => cmpVersion(v, currentVersion) <= 0)
        .sort((a, b) => cmpVersion(b, a))
        .slice(0, 4)
        .map((v) => ({ version: v, items: CHANGELOG[v] }));
      if (recent.length) return { current: currentVersion, entries: recent };
    }
    markVersionSeen(currentVersion);
    return null;
  }
  if (cmpVersion(currentVersion, lastSeen) <= 0) return null; // ja viu

  const entries = Object.keys(CHANGELOG)
    .filter((v) => cmpVersion(v, lastSeen) > 0 && cmpVersion(v, currentVersion) <= 0)
    .sort((a, b) => cmpVersion(b, a))
    .map((v) => ({ version: v, items: CHANGELOG[v] }));

  if (entries.length === 0) return null;
  return { current: currentVersion, entries };
}
