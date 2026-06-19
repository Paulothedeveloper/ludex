// v0.9.40: i18n multi-idioma (issue #1). Idiomas mais populares: PT, EN, ES, FR, ZH, RU.
//
// Estratégia: o dicionário é KEYED PELA STRING PT (a string no código É a chave).
// `t("Salvar")` devolve a tradução pro idioma atual; se faltar, cai pra inglês;
// se faltar inglês, devolve a própria string PT (fallback gracioso — nunca quebra,
// só fica numa língua "anterior"). Internacionaliza surface por surface: basta
// envolver a string com t() e preencher as traduções abaixo.
//
// Idioma muda raramente (seletor) -> ao trocar salvamos + reload, então t() só lê
// um módulo-var setado no startup.

export const LANGUAGES = [
  { code: "pt", label: "Português", flag: "🇧🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
];
const CODES = LANGUAGES.map((l) => l.code);
const STORAGE_KEY = "ludex.language";

let _lang = "pt";

export function detectInitialLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (CODES.includes(saved)) return saved;
  } catch {}
  try {
    const nav = (navigator.language || navigator.userLanguage || "pt").toLowerCase();
    for (const c of CODES) { if (nav.startsWith(c)) return c; }
    if (nav.startsWith("zh")) return "zh";
    return "en"; // idioma desconhecido -> inglês (mais universal que PT)
  } catch {}
  return "pt";
}

export function initLanguage() { _lang = detectInitialLanguage(); }
export function getLanguage() { return _lang; }
export function hasLanguagePref() {
  try { return CODES.includes(localStorage.getItem(STORAGE_KEY)); } catch { return false; }
}

// v0.9.40: troca de idioma REATIVA (sem reload). Os componentes assinam via
// useLanguage() e re-renderizam na hora — t() re-resolve. Reload era frágil
// (dependia do localStorage persistir + re-init) e o usuário não via mudar.
const _listeners = new Set();
export function subscribeLanguage(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

/** Troca idioma, persiste e NOTIFICA (re-render imediato, sem reload). */
export function setLanguage(l) {
  _lang = CODES.includes(l) ? l : "en";
  try { localStorage.setItem(STORAGE_KEY, _lang); } catch {}
  _listeners.forEach((fn) => { try { fn(_lang); } catch {} });
}

// Dicionário: { "string PT": { en, es, fr, zh, ru } }. PT é a própria chave.
const DICT = {
  // ---- Comuns / botões ----
  "Salvar":     { en: "Save", es: "Guardar", fr: "Enregistrer", zh: "保存", ru: "Сохранить" },
  "Cancelar":   { en: "Cancel", es: "Cancelar", fr: "Annuler", zh: "取消", ru: "Отмена" },
  "Confirmar":  { en: "Confirm", es: "Confirmar", fr: "Confirmer", zh: "确认", ru: "Подтвердить" },
  "Voltar":     { en: "Back", es: "Volver", fr: "Retour", zh: "返回", ru: "Назад" },
  "Fechar":     { en: "Close", es: "Cerrar", fr: "Fermer", zh: "关闭", ru: "Закрыть" },
  "Apagar":     { en: "Delete", es: "Borrar", fr: "Supprimer", zh: "删除", ru: "Удалить" },
  "Continuar":  { en: "Continue", es: "Continuar", fr: "Continuer", zh: "继续", ru: "Продолжить" },
  "Procurar":   { en: "Search", es: "Buscar", fr: "Rechercher", zh: "搜索", ru: "Поиск" },
  "Importar":   { en: "Import", es: "Importar", fr: "Importer", zh: "导入", ru: "Импорт" },
  "Trocar":     { en: "Switch", es: "Cambiar", fr: "Changer", zh: "切换", ru: "Сменить" },
  "Idioma":     { en: "Language", es: "Idioma", fr: "Langue", zh: "语言", ru: "Язык" },

  // ---- License gate ----
  "Sua biblioteca retro em um lugar só": { en: "Your retro library in one place", es: "Tu biblioteca retro en un solo lugar", fr: "Votre bibliothèque rétro en un seul endroit", zh: "您的复古游戏库，尽在一处", ru: "Ваша ретро-библиотека в одном месте" },
  "Sua license key": { en: "Your license key", es: "Tu clave de licencia", fr: "Votre clé de licence", zh: "您的许可证密钥", ru: "Ваш лицензионный ключ" },
  "Colar":        { en: "Paste", es: "Pegar", fr: "Coller", zh: "粘贴", ru: "Вставить" },
  "Ativar Ludex": { en: "Activate Ludex", es: "Activar Ludex", fr: "Activer Ludex", zh: "激活 Ludex", ru: "Активировать Ludex" },
  "Validando...": { en: "Validating...", es: "Validando...", fr: "Validation...", zh: "验证中…", ru: "Проверка…" },
  "Não tem uma license ainda?": { en: "Don't have a license yet?", es: "¿Aún no tienes una licencia?", fr: "Vous n'avez pas encore de licence ?", zh: "还没有许可证？", ru: "Ещё нет лицензии?" },
  "Comprar agora →": { en: "Buy now →", es: "Comprar ahora →", fr: "Acheter →", zh: "立即购买 →", ru: "Купить →" },
  "Funciona em até 2 PCs · Acesso vitalício · Sem assinatura": { en: "Works on up to 2 PCs · Lifetime access · No subscription", es: "Funciona en hasta 2 PCs · Acceso de por vida · Sin suscripción", fr: "Jusqu'à 2 PC · Accès à vie · Sans abonnement", zh: "最多 2 台电脑 · 终身访问 · 无订阅", ru: "До 2 ПК · Пожизненный доступ · Без подписки" },
  "Sem conexão com a internet. Reconecte e tente ativar de novo.": { en: "No internet connection. Reconnect and try activating again.", es: "Sin conexión a internet. Reconéctate e intenta activar de nuevo.", fr: "Pas de connexion Internet. Reconnectez-vous et réessayez.", zh: "无网络连接。请重新连接后再试。", ru: "Нет подключения к интернету. Переподключитесь и повторите." },
  "Não consegui validar a chave. Confira se digitou/colou certo.": { en: "Couldn't validate the key. Check that you typed/pasted it correctly.", es: "No se pudo validar la clave. Verifica que la escribiste/pegaste bien.", fr: "Impossible de valider la clé. Vérifiez la saisie.", zh: "无法验证密钥。请检查输入是否正确。", ru: "Не удалось проверить ключ. Проверьте ввод." },

  // ---- Onboarding ----
  "Sua biblioteca retro em um lugar só — 27+ sistemas embedded, controle nativo, save states, RetroAchievements e Discord Rich Presence.": { en: "Your retro library in one place — 27+ built-in systems, native controller support, save states, RetroAchievements and Discord Rich Presence.", es: "Tu biblioteca retro en un lugar — 27+ sistemas integrados, soporte de mando, save states, RetroAchievements y Discord Rich Presence.", fr: "Votre bibliothèque rétro en un seul endroit — 27+ systèmes intégrés, manette native, save states, RetroAchievements et Discord Rich Presence.", zh: "您的复古游戏库，尽在一处 — 27+ 内置系统、原生手柄支持、即时存档、RetroAchievements 和 Discord Rich Presence。", ru: "Ваша ретро-библиотека в одном месте — 27+ встроенных систем, поддержка геймпада, сохранения, RetroAchievements и Discord Rich Presence." },
  "Ver tour guiado (opcional)": { en: "See guided tour (optional)", es: "Ver tour guiado (opcional)", fr: "Voir la visite guidée (facultatif)", zh: "查看引导教程（可选）", ru: "Смотреть обзор (необязательно)" },
  "Crie seu perfil": { en: "Create your profile", es: "Crea tu perfil", fr: "Créez votre profil", zh: "创建您的资料", ru: "Создайте профиль" },
  "Seu perfil guarda saves, favoritos, tempo jogado e nota dos jogos. Pode trocar tudo depois nos Ajustes.": { en: "Your profile keeps saves, favorites, playtime and game ratings. You can change everything later in Settings.", es: "Tu perfil guarda partidas, favoritos, tiempo jugado y valoraciones. Puedes cambiarlo todo luego en Ajustes.", fr: "Votre profil conserve sauvegardes, favoris, temps de jeu et notes. Vous pouvez tout changer plus tard dans les Réglages.", zh: "您的资料保存存档、收藏、游戏时长和评分。稍后可在设置中更改。", ru: "Профиль хранит сохранения, избранное, время игры и оценки. Всё можно изменить позже в настройках." },
  "Como você quer ser chamado?": { en: "What should we call you?", es: "¿Cómo quieres que te llamemos?", fr: "Comment vous appeler ?", zh: "如何称呼您？", ru: "Как к вам обращаться?" },
  "Seu nome ou apelido (clique pra digitar com controle)": { en: "Your name or nickname (click to type with a controller)", es: "Tu nombre o apodo (clic para escribir con mando)", fr: "Votre nom ou pseudo (cliquez pour saisir à la manette)", zh: "您的名字或昵称（点击用手柄输入）", ru: "Имя или ник (нажмите для ввода геймпадом)" },
  "Seu nome ou apelido": { en: "Your name or nickname", es: "Tu nombre o apodo", fr: "Votre nom ou pseudo", zh: "您的名字或昵称", ru: "Имя или ник" },
  "Digite com controle ou teclado": { en: "Type with controller or keyboard", es: "Escribe con mando o teclado", fr: "Saisissez à la manette ou au clavier", zh: "用手柄或键盘输入", ru: "Ввод геймпадом или клавиатурой" },
  "Escolha um avatar": { en: "Choose an avatar", es: "Elige un avatar", fr: "Choisissez un avatar", zh: "选择头像", ru: "Выберите аватар" },
  "Ver tour de novo": { en: "See tour again", es: "Ver tour de nuevo", fr: "Revoir la visite", zh: "再看一次教程", ru: "Показать обзор снова" },
  "Entrar no Ludex": { en: "Enter Ludex", es: "Entrar en Ludex", fr: "Entrer dans Ludex", zh: "进入 Ludex", ru: "Войти в Ludex" },
  "Digite pelo menos 2 letras pra continuar.": { en: "Type at least 2 letters to continue.", es: "Escribe al menos 2 letras para continuar.", fr: "Saisissez au moins 2 lettres pour continuer.", zh: "请至少输入 2 个字符以继续。", ru: "Введите хотя бы 2 буквы, чтобы продолжить." },
  "Pular tour":   { en: "Skip tour", es: "Saltar tour", fr: "Passer la visite", zh: "跳过教程", ru: "Пропустить" },
  "Anterior":     { en: "Previous", es: "Anterior", fr: "Précédent", zh: "上一步", ru: "Назад" },
  "Próximo":      { en: "Next", es: "Siguiente", fr: "Suivant", zh: "下一步", ru: "Далее" },
  "Concluir tour":{ en: "Finish tour", es: "Terminar tour", fr: "Terminer", zh: "完成教程", ru: "Завершить" },

  // ---- Settings ----
  "Configurações": { en: "Settings", es: "Ajustes", fr: "Réglages", zh: "设置", ru: "Настройки" },
  "Trocar o idioma recarrega o app.": { en: "Changing the language reloads the app.", es: "Cambiar el idioma recarga la app.", fr: "Changer la langue recharge l'app.", zh: "更改语言会重新加载应用。", ru: "Смена языка перезагрузит приложение." },
  "Perfil ativo": { en: "Active profile", es: "Perfil activo", fr: "Profil actif", zh: "当前资料", ru: "Активный профиль" },

  // ---- Diálogos ----
  "Não consegui abrir o jogo": { en: "Couldn't open the game", es: "No se pudo abrir el juego", fr: "Impossible d'ouvrir le jeu", zh: "无法打开游戏", ru: "Не удалось открыть игру" },
  "Licença necessária para abrir jogos. Ative o Ludex nos Ajustes.": { en: "License required to open games. Activate Ludex in Settings.", es: "Se requiere licencia para abrir juegos. Activa Ludex en Ajustes.", fr: "Licence requise pour ouvrir des jeux. Activez Ludex dans les Réglages.", zh: "打开游戏需要许可证。请在设置中激活 Ludex。", ru: "Для запуска игр нужна лицензия. Активируйте Ludex в настройках." },

  // ---- Tela de seleção de idioma (entrada) ----
  "Escolha seu idioma": { en: "Choose your language", es: "Elige tu idioma", fr: "Choisissez votre langue", zh: "选择您的语言", ru: "Выберите язык" },

  // ---- Home / ordenação ----
  "Padrão":        { en: "Default", es: "Predeterminado", fr: "Par défaut", zh: "默认", ru: "По умолчанию" },
  "A-Z":           { en: "A-Z", es: "A-Z", fr: "A-Z", zh: "A-Z", ru: "А-Я" },
  "Recentes":      { en: "Recent", es: "Recientes", fr: "Récents", zh: "最近", ru: "Недавние" },
  "Mais jogados":  { en: "Most played", es: "Más jugados", fr: "Plus joués", zh: "最常玩", ru: "Часто играемые" },
  "★ Favoritos":   { en: "★ Favorites", es: "★ Favoritos", fr: "★ Favoris", zh: "★ 收藏", ru: "★ Избранное" },
};

/** Traduz `s` pro idioma atual. Cadeia: idioma -> inglês -> PT (a própria chave). */
export function t(s) {
  if (_lang === "pt") return s;
  const e = DICT[s];
  if (!e) return s;
  return e[_lang] || e.en || s;
}
