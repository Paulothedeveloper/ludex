// v0.9.8: Changelog + "Novidades" pós-update. Mostra um modal resumido do que
// mudou quando o usuário abre uma versão mais nova do que a ultima que ele viu.
// Usado no app (LudexMobile) e no launcher do PC (LudexLauncher).

// Bullets curtos e claros por versão (pt-BR). Manter a mais nova no topo.
export const CHANGELOG = {
  "1.1.6": [
    "Correção visual: dentro do jogo, o botão de captura não fica mais sobreposto ao botão CHEATS.",
  ],
  "1.1.5": [
    "Mais estável na emulação: correção de uma falha rara em jogos que trocam de resolução durante o jogo, e limpeza de arquivos temporários que ficavam pra trás.",
    "Correção: a atualização automática no Android agora aponta pro lugar certo — você volta a receber as novas versões.",
    "App e licenciamento mais seguros: proteções reforçadas (sem mudança no seu uso).",
    "Acabamento visual: ícones próprios no lugar de emojis e textos em espanhol revisados.",
  ],
  "1.1.4": [
    "Seletor de idioma mais claro: agora mostra o nome de cada idioma (Português, English, Español…) em vez de bandeirinhas — bandeira não representa idioma.",
  ],
  "1.1.3": [
    "Novo ícone do app: o símbolo \"L\" com o power pixel âmbar, redesenhado a partir de referências de design — identidade premium e consistente em todas as plataformas.",
  ],
  "1.1.2": [
    "Marca renovada: novo logotipo \"LUDEX\" (agora lê o nome com clareza) e ícone do app no Android redesenhado, com o ponto âmbar de power.",
  ],
  "1.1.1": [
    "Ao desativar um dispositivo, a vaga é liberada na hora pra você ativar em outro.",
  ],
  "1.1.0": [
    "Licenciamento mais seguro: a validação da sua key agora passa por um servidor próprio do Ludex — sua key e seus dados nunca ficam expostos dentro do app.",
    "Uma license só, PC e celular: ative com a mesma key nos dois (a versão Android virou produto completo, não só demo).",
    "Ativação simplificada: o app pede só a sua license key, sem etapas extras.",
  ],
  "1.0.0": [
    "O Ludex agora fala 6 idiomas (Português, Inglês, Espanhol, Francês, Chinês e Russo) — escolha na tela de entrada ou em Ajustes, troca na hora sem reiniciar.",
    "Nova identidade visual: logo e ícone novos em todo o app.",
    "Paleta de comandos (Ctrl+K) no PC: buscar, ir direto pra um console, trocar tema, screenshot — tudo num lugar só.",
    "Modos de visualização da biblioteca: grade, capa grande ou lista.",
    "Overlay de RetroAchievements: seus pontos, ranking e conquistas recentes num só lugar.",
    "Screenshot dentro do jogo (F12 no PC, menu no celular), salvo numa pasta própria.",
    "Re-escanear ROMs agora mostra barra de progresso e botão de cancelar.",
    "Biblioteca muito mais leve e fluida em coleções grandes (render progressivo do grid).",
    "Celular: nova tela de boas-vindas com escolha de idioma logo na entrada.",
    "Tutorial atualizado com as novidades e os atalhos novos.",
  ],
  "0.9.36": [
    "Celular: ao abrir um jogo, a tela trava em horizontal automaticamente (mesmo se a rotação do sistema estiver bloqueada).",
    "Celular: layout dos botões do PS1/PS2/PSP em horizontal corrigido — o offset do modo editar era de portrait e jogava os botões pra fora da tela em landscape (causa do 'enlouquece' e 'não responde').",
    "Pop-up de conquista agora tem animação de saída suave (desliza+fade) em vez de sumir abrupto.",
    "Tutorial: alvo do passo destacado com bem mais evidência — borda branca grossa + brilho mais intenso, fundo em volta bem mais escuro e desfocado.",
    "Revisão geral de português (acentos e cedilha) em alertas, botões, dicas e nomes de seção do app inteiro.",
    "Launcher PC: log detalhado do RPCS3 (stdout+stderr) capturado quando o jogo de PS3 falha — facilita diagnosticar 'Invalid file' e 'BootROM not found'.",
  ],
  "0.9.35": [
    "Launcher PC: novos botões nos Ajustes pra Wii U (Cemu) e PS Vita (Vita3K) — copiam keys/firmware da pasta KEYS pro emulador certo automaticamente (igual ja tinha pro Switch).",
    "Auditoria total dos 28 cores libretro PC + 27 .so embedded Android: TUDO presente, BIOS completas em PC e celular. Doc CORES-E-BIOS.md atualizado pra refletir a realidade.",
  ],
  "0.9.34": [
    "Tutorial refeito: agora aponta cada feature do app (avatar, busca, mais jogados, continue jogando, sistemas, ajustes, BIOS, tema, controle, pasta) com efeito de vidro fosco em volta e destaque no elemento. Mesmo padrão no celular e no PC.",
    "Botao 'Ver tutorial novamente' nos Ajustes (celular e PC) — refaz o passo a passo a qualquer hora.",
    "Tema do app agora muda fundo+cards+accent de verdade (era so o texto). Switch Dark, PS3 Wave, Sunset, Forest e Light ganharam paleta completa.",
  ],
  "0.9.33": [
    "Capas no celular agora carregam mais rapido no scroll inicial (4 downloads paralelos, era 2-3).",
  ],
  "0.9.32": [
    "Estabilidade total: TODOS os IPC do emulador agora protegidos contra crash (set/get/clear option, skip frames, info de disco, lista de saves). Qualquer panic no core vira mensagem de erro, app nunca morre.",
  ],
  "0.9.31": [
    "Estabilidade hot-path: input, analogico e leitura de audio agora também não crashavam o app se o core panicar (catch_unwind nos 3 IPC chamados por frame).",
  ],
  "0.9.30": [
    "Celular: erro 'falha ao carregar jogo' agora mostra botão 'Procurar BIOS agora' quando o problema e BIOS faltando — 1 clique resolve em vez de ter que ir nos Ajustes.",
    "Estabilidade extra: save state, load state, troca de disco e cheats agora também não crashavam o app se o core panicar.",
  ],
  "0.9.29": [
    "Celular: novo botão 'Procurar BIOS no celular inteiro' nos Ajustes — varre o storage inteiro atras de qualquer .bin com nome de BIOS conhecida (scph5501.bin, dc_boot.bin etc) e importa pra Ludex/system/. Resolve PS1/Dreamcast/Saturn travando ao abrir.",
  ],
  "0.9.28": [
    "Controles na tela: sistemas com 5 ou 6 botões (GameCube/Wii, N64, Genesis 6-buttons, Saturn, Arcade) ganharam respiro maior — botões não roçam mais nos ombros L/R nem na barra Select/Start.",
  ],
  "0.9.27": [
    "Estabilidade: GameCube/PS1/PSP não crashavam mais o launcher do celular — panic do core/load_game agora vira mensagem de erro e o app continua vivo.",
  ],
  "0.9.26": [
    "Launcher PC: novo botão 'Procurar BIOS no PC inteiro' varre D:\\, outras unidades e sua home atras de qualquer arquivo com nome de BIOS conhecida (scph5500.bin, dc_boot.bin etc) e importa pra system\\ automaticamente.",
  ],
  "0.9.25": [
    "Launcher PC: secao Cores libretro ganhou 'Atualizar instalados' (re-baixa todos os cores pra versão nightly mais recente) e botão ↻/↓ por core na lista detalhada.",
  ],
  "0.9.24": [
    "Launcher PC: nova secao BIOS dos emuladores nos Ajustes mostra quais sistemas estão com BIOS faltando e tem botão de auto-import.",
    "Launcher PC: 'Sincronizar capas' agora realmente re-baixa as capas (antes o React engolia o re-disparo).",
  ],
  "0.9.23": [
    "Launcher PC: nova secao 'Cores libretro' nos Ajustes mostra quantos cores estão instalados e baixa os que faltam direto do buildbot oficial (1 clique). Resolve crash/tela preta de GameCube, 3DS, DS, PSP, Dreamcast, PS2, Saturn e companhia.",
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
    "Capas: novo fallback gratis em libretro-thumbnails quando o IGDB não encontra (muito menos jogo sem capa).",
    "Launcher PC: botão TELAS no jogo de DS/3DS pra trocar layout das duas telas ao vivo (igual ja tinha no celular).",
    "PSP melhor de fabrica: resolucao 2x (era 3x), auto frame-skip ligado e CPU lock disponível = mais FPS e audio melhor.",
    "Mais de 15 cores e algumas BIOS estavam faltando no PC e causavam crash/tela preta. Veja Ludex/CORES-E-BIOS.md.",
  ],
  "0.9.19": [
    "Analogico na tela para GameCube, Nintendo 64, PSP, PlayStation, Dreamcast e Wii.",
    "Controles na horizontal reposicionados (não bagunca mais o layout).",
    "Botao Z do GameCube/Wii reposicionado pra não colidir com o L/R.",
  ],
  "0.9.18": [
    "GameCube e Wii agora aparecem cada um na sua lista (identificacao pelo proprio disco, não mais pelo nome do arquivo).",
  ],
  "0.9.17": [
    "Emuladores 3D (Wii, GameCube, 3DS, Dreamcast, PSP, Nintendo 64) agora tem aceleracao gráfica real no Android.",
    "Corrigida a causa de fundo dos crashes/tela preta nesses sistemas.",
  ],
  "0.9.16": [
    "Corrigido o crash do app ao abrir certos emuladores (Wii, GameCube, etc).",
    "Emulador que falha agora mostra erro na tela em vez de derrubar o app.",
  ],
  "0.9.15": [
    "Botao de acelerar (FF) agora liga/desliga com um toque.",
    "Aba Sistemas em estilo roda (o do centro fica grande).",
    "Guia de instalação e sites de download/traducao em cada emulador.",
    "Continua jogando: fundo bonito quando o jogo não tem capa + botão de recarregar capas.",
  ],
  "0.9.14": [
    "Tela de carregamento some assim que o jogo fica pronto (mais rapida).",
    "Destaque virou 'Mais jogados' (não repete mais os recentes).",
    "Tema do controle muda também o visual em repouso.",
    "Backup agora inclui tema, controle e layout.",
    "Respeita 'reduzir movimento' do sistema; ajustes no tema claro.",
  ],
  "0.9.13": [
    "Destaque no tamanho padrão com contorno colorido; Continua jogando com a capa do jogo.",
    "Tela de carregamento do emulador refeita.",
    "Controle: vibracao on/off, esconder com controle externo, ajuste de tamanho (por grupo e geral) e temas.",
    "Temas do app (Switch Dark, PS3, Sunset, Forest, Light) nos Ajustes.",
    "Config do emulador e menu in-game redesenhados.",
  ],
  "0.9.12": [
    "Modo desempenho pra celular fraco (video 30fps, menos travada).",
    "Aceleracao agora e 1x / 1.25x / 1.5x / 2x.",
    "Icones de sistema iguais aos do launcher do PC.",
    "Configurações do emulador refeitas (tela cheia, fontes melhores, sem bugs).",
    "Layout de telas DS/3DS não duplica mais a tela.",
    "Controle: corrigido travar direcao ao deslizar o dedo.",
    "Tela inicial no modo horizontal com tamanhos ajustados.",
    "Controle externo nos Ajustes + animacao ao abrir um sistema.",
  ],
  "0.9.11": [
    "Controle: deslizar o dedo entre botões funciona (não trava mais a direcao).",
    "Barra de navegação flutuante estilo console, com icones novos e sem texto.",
    "Conquistas aparecem embaixo, acima da barra de navegação.",
    "Animacao ao trocar de aba e ao abrir o jogo (boot do emulador).",
  ],
  "0.9.10": [
    "Salvar e carregar estado (save state) voltou a funcionar no app.",
    "Botoes L e R não ficam mais em cima do Voltar e da engrenagem.",
    "DS e 3DS: troca o layout das telas direto no menu (cima/baixo, lado a lado, uma menor no canto).",
  ],
  "0.9.9": [
    "Capas dos jogos voltam a carregar no Android (rede com IPv6 instavel).",
    "Som dos emuladores mais estavel: emulacao no ritmo do audio, sem engasgo.",
    "App assinado com chave propria (some o alerta de seguranca no Android).",
    "Crashes do app agora ficam registrados nos Logs pra diagnostico.",
  ],
  "0.9.8": [
    "Banner de novidades: agora o app mostra o que mudou a cada atualização.",
  ],
  "0.9.7": [
    "Animacao de abertura (splash) e entrada suave dos catalogos.",
    "Controles do emulador com toque animado (escala + brilho).",
  ],
  "0.9.6": [
    "App não e mais marcado como malware no Android.",
    "Nota da web (IGDB) no detalhe do jogo.",
  ],
  "0.9.5": [
    "Som dos emuladores, da interface e da música corrigidos no Android.",
    "Pasta separada por emulador (cada sistema com a sua).",
    "Botao Voltar navega dentro do app em vez de minimizar.",
    "Perfil com foto e nome editaveis, e mais presente na tela inicial.",
  ],
  "0.9.4": [
    "Editor de perfil (trocar foto e nome) tocando no avatar.",
    "Tutorial inicial não trava mais.",
  ],
  "0.9.3": [
    "Detalhe do jogo: nota, abrir pasta e mods.",
    "Atualizacao abre a pagina de download no navegador.",
  ],
};

const LAST_SEEN_KEY = "ludex.lastSeenVersion";

// Compara versões semver-ish "a.b.c". >0 se a>b.
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
// ultima versão vista e a atual. null se não ha o que mostrar.
// Em instalação nova (sem lastSeen) NAO mostra — so marca como visto (o tutorial
// cobre o onboarding). So mostra quando houve um UPDATE de verdade.
export function getWhatsNew(currentVersion, isReturningUser = false) {
  if (!currentVersion) return null;
  const lastSeen = getLastSeen();
  if (!lastSeen) {
    // Sem registro. Se o usuário JA usava o app (returning), provavelmente
    // atualizou de uma versão sem esse recurso -> mostra so a versão atual.
    // Se for instalação nova (não returning), não mostra (o tutorial cobre).
    if (isReturningUser) {
      // Primeira vez vendo o changelog (atualizou de uma versão sem o recurso):
      // mostra as ultimas versões (ate 4) ate a atual, pra dar um resumo útil.
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
