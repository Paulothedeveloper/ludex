// v0.9.40: i18n EN/PT (issue #1 — pedido de UI em inglês).
//
// Estratégia: o dicionário é KEYED PELA STRING PT — ou seja, a string que já
// está no código É a chave. `t("Salvar")` devolve "Save" quando idioma=en e a
// tradução existe; senão devolve a própria string PT (fallback gracioso: string
// não traduzida aparece em PT, NUNCA quebra). Isso permite internacionalizar
// surface por surface sem risco — basta envolver a string com t() e adicionar
// a entrada no dicionário EN abaixo.
//
// Idioma muda raramente (toggle nos Ajustes) -> ao trocar, salvamos e damos
// reload, então t() só precisa ler um módulo-var setado no startup.

const STORAGE_KEY = "ludex.language";

let _lang = "pt";

export function detectInitialLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "pt") return saved;
  } catch {}
  try {
    const nav = (navigator.language || navigator.userLanguage || "pt").toLowerCase();
    return nav.startsWith("pt") ? "pt" : "en"; // não-PT -> inglês
  } catch {}
  return "pt";
}

/** Chamar UMA vez no startup (main.jsx) antes de renderizar. */
export function initLanguage() { _lang = detectInitialLanguage(); }
export function getLanguage() { return _lang; }

/** Troca o idioma e persiste. O caller deve dar reload pra re-renderizar tudo. */
export function setLanguage(l) {
  _lang = l === "en" ? "en" : "pt";
  try { localStorage.setItem(STORAGE_KEY, _lang); } catch {}
}

// Dicionário EN — keyed pela string PT. Crescer conforme mais surfaces são
// envolvidas com t(). Ordem por área pra facilitar manutenção.
const EN = {
  // ---- Comuns / botões ----
  "Salvar": "Save",
  "Cancelar": "Cancel",
  "Confirmar": "Confirm",
  "Voltar": "Back",
  "Fechar": "Close",
  "Apagar": "Delete",
  "Continuar": "Continue",
  "Pronto": "Done",
  "OK": "OK",
  "Aviso": "Notice",
  "Sim": "Yes",
  "Não": "No",
  "Procurar": "Search",
  "Importar": "Import",
  "Exportar": "Export",
  "Idioma": "Language",
  "Português": "Portuguese",
  "Inglês": "English",

  // ---- License gate ----
  "Sua biblioteca retro em um lugar só": "Your retro library in one place",
  "Sua license key": "Your license key",
  "Colar": "Paste",
  "Ativar Ludex": "Activate Ludex",
  "Validando...": "Validating...",
  "Não tem uma license ainda?": "Don't have a license yet?",
  "Comprar agora →": "Buy now →",
  "Funciona em até 2 PCs · Acesso vitalício · Sem assinatura": "Works on up to 2 PCs · Lifetime access · No subscription",
  "Sem conexão com a internet. Reconecte e tente ativar de novo.": "No internet connection. Reconnect and try activating again.",
  "Não consegui validar a chave. Confira se digitou/colou certo.": "Couldn't validate the key. Check that you typed/pasted it correctly.",

  // ---- Onboarding: intro ----
  "Sua biblioteca retro em um lugar só — 27+ sistemas embedded, controle nativo, save states, RetroAchievements e Discord Rich Presence.":
    "Your retro library in one place — 27+ built-in systems, native controller support, save states, RetroAchievements and Discord Rich Presence.",
  "Ver tour guiado (opcional)": "See guided tour (optional)",

  // ---- Onboarding: criação de perfil ----
  "Crie seu perfil": "Create your profile",
  "Seu perfil guarda saves, favoritos, tempo jogado e nota dos jogos. Pode trocar tudo depois nos Ajustes.":
    "Your profile keeps saves, favorites, playtime and game ratings. You can change everything later in Settings.",
  "Como você quer ser chamado?": "What should we call you?",
  "Seu nome ou apelido (clique pra digitar com controle)": "Your name or nickname (click to type with a controller)",
  "Seu nome ou apelido": "Your name or nickname",
  "Digite com controle ou teclado": "Type with controller or keyboard",
  "Escolha um avatar": "Choose an avatar",
  "Sua foto": "Your photo",
  "Escolher imagem do PC": "Choose image from PC",
  "Ver tour de novo": "See tour again",
  "Entrar no Ludex": "Enter Ludex",
  "Digite pelo menos 2 letras pra continuar.": "Type at least 2 letters to continue.",

  // ---- Tour (genéricos) ----
  "Pular tour": "Skip tour",
  "Anterior": "Previous",
  "Próximo": "Next",
  "Concluir tour": "Finish tour",

  // ---- Diálogos comuns ----
  "Não consegui abrir o jogo": "Couldn't open the game",
  "Licença necessária para abrir jogos. Ative o Ludex nos Ajustes.": "License required to open games. Activate Ludex in Settings.",
};

/** Traduz `s` pro idioma atual (fallback: a própria string PT). */
export function t(s) {
  if (_lang === "en") return EN[s] || s;
  return s;
}
