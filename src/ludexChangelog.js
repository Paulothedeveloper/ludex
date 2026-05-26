// v0.9.8: Changelog + "Novidades" pós-update. Mostra um modal resumido do que
// mudou quando o usuario abre uma versao mais nova do que a ultima que ele viu.
// Usado no app (LudexMobile) e no launcher do PC (LudexLauncher).

// Bullets curtos e claros por versao (pt-BR). Manter a mais nova no topo.
export const CHANGELOG = {
  "0.9.28": [
    "Controles na tela: sistemas com 5 ou 6 botoes (GameCube/Wii, N64, Genesis 6-buttons, Saturn, Arcade) ganharam respiro maior — botoes nao roçam mais nos ombros L/R nem na barra Select/Start.",
  ],
  "0.9.27": [
    "Estabilidade: GameCube/PS1/PSP nao crashavam mais o launcher do celular — panic do core/load_game agora vira mensagem de erro e o app continua vivo.",
  ],
  "0.9.26": [
    "Launcher PC: novo botao 'Procurar BIOS no PC inteiro' varre D:\\, outras unidades e sua home atras de qualquer arquivo com nome de BIOS conhecida (scph5500.bin, dc_boot.bin etc) e importa pra system\\ automaticamente.",
  ],
  "0.9.25": [
    "Launcher PC: secao Cores libretro ganhou 'Atualizar instalados' (re-baixa todos os cores pra versao nightly mais recente) e botao ↻/↓ por core na lista detalhada.",
  ],
  "0.9.24": [
    "Launcher PC: nova secao BIOS dos emuladores nos Ajustes mostra quais sistemas estao com BIOS faltando e tem botao de auto-import.",
    "Launcher PC: 'Sincronizar capas' agora realmente re-baixa as capas (antes o React engolia o re-disparo).",
  ],
  "0.9.23": [
    "Launcher PC: nova secao 'Cores libretro' nos Ajustes mostra quantos cores estao instalados e baixa os que faltam direto do buildbot oficial (1 clique). Resolve crash/tela preta de GameCube, 3DS, DS, PSP, Dreamcast, PS2, Saturn e companhia.",
  ],
  "0.9.22": [
    "Launcher PC: quando um core libretro estiver faltando, o erro agora aparece bem claro e abre a pasta cores/ ou copia a URL pro buildbot.",
  ],
  "0.9.21": [
    "Performance dos emuladores 3D no Android: leitura GPU agora e assincrona (2 buffers em ping-pong). Wii/GameCube/N64/PSP/Dreamcast rodam mais fluido e o audio para de engasgar.",
  ],
  "0.9.20": [
    "Botao de refresh do app agora re-escaneia a pasta e recarrega capas (antes so apagava as capas).",
    "PSP, PS1 e Dreamcast agora aparecem na lista certa no Android (identificacao pelo proprio disco).",
    "Tema do app volta a mudar fundo + cards + texto (como no PC).",
    "PS3 .pkg agora INSTALA primeiro e depois inicia (corrige 'Invalid file or folder' do RPCS3).",
    "Capas: novo fallback gratis em libretro-thumbnails quando o IGDB nao encontra (muito menos jogo sem capa).",
    "Launcher PC: botao TELAS no jogo de DS/3DS pra trocar layout das duas telas ao vivo (igual ja tinha no celular).",
    "PSP melhor de fabrica: resolucao 2x (era 3x), auto frame-skip ligado e CPU lock disponivel = mais FPS e audio melhor.",
    "Mais de 15 cores e algumas BIOS estavam faltando no PC e causavam crash/tela preta. Veja Ludex/CORES-E-BIOS.md.",
  ],
  "0.9.19": [
    "Analogico na tela para GameCube, Nintendo 64, PSP, PlayStation, Dreamcast e Wii.",
    "Controles na horizontal reposicionados (nao bagunca mais o layout).",
    "Botao Z do GameCube/Wii reposicionado pra nao colidir com o L/R.",
  ],
  "0.9.18": [
    "GameCube e Wii agora aparecem cada um na sua lista (identificacao pelo proprio disco, nao mais pelo nome do arquivo).",
  ],
  "0.9.17": [
    "Emuladores 3D (Wii, GameCube, 3DS, Dreamcast, PSP, Nintendo 64) agora tem aceleracao grafica real no Android.",
    "Corrigida a causa de fundo dos crashes/tela preta nesses sistemas.",
  ],
  "0.9.16": [
    "Corrigido o crash do app ao abrir certos emuladores (Wii, GameCube, etc).",
    "Emulador que falha agora mostra erro na tela em vez de derrubar o app.",
  ],
  "0.9.15": [
    "Botao de acelerar (FF) agora liga/desliga com um toque.",
    "Aba Sistemas em estilo roda (o do centro fica grande).",
    "Guia de instalacao e sites de download/traducao em cada emulador.",
    "Continua jogando: fundo bonito quando o jogo nao tem capa + botao de recarregar capas.",
  ],
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
