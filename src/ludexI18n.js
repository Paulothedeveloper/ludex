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
  "Buscar jogo":   { en: "Search game", es: "Buscar juego", fr: "Chercher un jeu", zh: "搜索游戏", ru: "Поиск игры" },

  // ---- LudexSearchOverlay ----
  "Use o controle: D-pad/Stick navega · A confirma · Y apaga · X espaco · Start busca · B sai": { en: "Use the controller: D-pad/Stick to navigate · A confirms · Y deletes · X space · Start searches · B exits", es: "Usa el mando: D-pad/Stick navega · A confirma · Y borra · X espacio · Start busca · B sale", fr: "Utilisez la manette : D-pad/Stick navigue · A confirme · Y efface · X espace · Start recherche · B quitte", zh: "使用手柄：方向键/摇杆导航 · A 确认 · Y 删除 · X 空格 · Start 搜索 · B 退出", ru: "Используйте контроллер: D-pad/стик — навигация · A — подтвердить · Y — удалить · X — пробел · Start — поиск · B — выход" },
  "CLEAR": { en: "CLEAR", es: "BORRAR", fr: "EFFACER", zh: "清除", ru: "ОЧИСТИТЬ" },
  "BUSCAR": { en: "SEARCH", es: "BUSCAR", fr: "RECHERCHER", zh: "搜索", ru: "ПОИСК" },
  "Nenhum jogo encontrado": { en: "No games found", es: "No se encontraron juegos", fr: "Aucun jeu trouvé", zh: "未找到游戏", ru: "Игры не найдены" },

  // ---- LudexGameDetailPanel ----
  "Fechar (Esc)": { en: "Close (Esc)", es: "Cerrar (Esc)", fr: "Fermer (Échap)", zh: "关闭 (Esc)", ru: "Закрыть (Esc)" },
  "tempo jogado": { en: "play time", es: "tiempo jugado", fr: "temps de jeu", zh: "游玩时长", ru: "время игры" },
  "tamanho": { en: "size", es: "tamaño", fr: "taille", zh: "大小", ru: "размер" },
  "formato": { en: "format", es: "formato", fr: "format", zh: "格式", ru: "формат" },
  "Clique pra ciclar entre os status (sem status → quero jogar → jogando → zerei → platinei → abandonei)": { en: "Click to cycle through statuses (no status → want to play → playing → beaten → mastered → abandoned)", es: "Haz clic para alternar entre estados (sin estado → quiero jugar → jugando → terminado → platinado → abandonado)", fr: "Cliquez pour faire défiler les statuts (aucun statut → à jouer → en cours → terminé → maîtrisé → abandonné)", zh: "点击循环切换状态（无状态 → 想玩 → 游玩中 → 已通关 → 已白金 → 已弃坑）", ru: "Нажмите, чтобы переключать статусы (без статуса → хочу пройти → играю → пройдено → платина → заброшено)" },
  "Sua nota": { en: "Your rating", es: "Tu valoración", fr: "Votre note", zh: "你的评分", ru: "Ваша оценка" },
  "{n} estrela (clique de novo pra limpar)": { en: "{n} star (click again to clear)", es: "{n} estrella (haz clic de nuevo para limpiar)", fr: "{n} étoile (cliquez à nouveau pour effacer)", zh: "{n} 星（再次点击清除）", ru: "{n} звезда (нажмите ещё раз, чтобы сбросить)" },
  "{n} estrelas (clique de novo pra limpar)": { en: "{n} stars (click again to clear)", es: "{n} estrellas (haz clic de nuevo para limpiar)", fr: "{n} étoiles (cliquez à nouveau pour effacer)", zh: "{n} 星（再次点击清除）", ru: "{n} звёзд (нажмите ещё раз, чтобы сбросить)" },
  "Suas notas sobre o jogo... (auto-salva)": { en: "Your notes about the game... (auto-saved)", es: "Tus notas sobre el juego... (autoguardado)", fr: "Vos notes sur le jeu... (sauvegarde auto)", zh: "你对游戏的笔记……（自动保存）", ru: "Ваши заметки об игре... (автосохранение)" },
  "Buscando informações no IGDB...": { en: "Fetching info from IGDB...", es: "Buscando información en IGDB...", fr: "Récupération des infos sur IGDB...", zh: "正在从 IGDB 获取信息……", ru: "Получение данных из IGDB..." },
  "Jogar": { en: "Play", es: "Jugar", fr: "Jouer", zh: "开始游戏", ru: "Играть" },
  "Favorito": { en: "Favorited", es: "Favorito", fr: "Favori", zh: "已收藏", ru: "В избранном" },
  "Favoritar": { en: "Favorite", es: "Añadir a favoritos", fr: "Ajouter aux favoris", zh: "收藏", ru: "В избранное" },
  "Trocar capa": { en: "Change cover", es: "Cambiar portada", fr: "Changer la jaquette", zh: "更换封面", ru: "Сменить обложку" },
  "Re-sync IGDB": { en: "Re-sync IGDB", es: "Resincronizar IGDB", fr: "Resynchroniser IGDB", zh: "重新同步 IGDB", ru: "Пересинхронизировать IGDB" },
  "Abrir local": { en: "Open location", es: "Abrir ubicación", fr: "Ouvrir l'emplacement", zh: "打开位置", ru: "Открыть папку" },

  // ---- LudexCheatsModal ----
  "{n} cheat(s) ativo(s)": { en: "{n} cheat(s) active", es: "{n} truco(s) activo(s)", fr: "{n} code(s) actif(s)", zh: "{n} 个金手指已启用", ru: "Активно читов: {n}" },
  "Nenhum cheat ativo": { en: "No cheats active", es: "Ningún truco activo", fr: "Aucun code actif", zh: "没有启用的金手指", ru: "Нет активных читов" },
  "Cheat manual": { en: "Manual cheat", es: "Truco manual", fr: "Code manuel", zh: "手动金手指", ru: "Ручной чит" },
  "Nenhum cheat encontrado.": { en: "No cheats found.", es: "No se encontraron trucos.", fr: "Aucun code trouvé.", zh: "未找到金手指。", ru: "Читы не найдены." },
  "{added} cheat(s) adicionado(s). Ative os que quiser.": { en: "{added} cheat(s) added. Enable the ones you want.", es: "{added} truco(s) añadido(s). Activa los que quieras.", fr: "{added} code(s) ajouté(s). Activez ceux que vous voulez.", zh: "已添加 {added} 个金手指。启用你想要的。", ru: "Добавлено читов: {added}. Включите нужные." },
  "Cheats": { en: "Cheats", es: "Trucos", fr: "Codes de triche", zh: "金手指", ru: "Читы" },
  "Buscando…": { en: "Searching…", es: "Buscando…", fr: "Recherche…", zh: "搜索中…", ru: "Поиск…" },
  "Buscar cheats online": { en: "Search cheats online", es: "Buscar trucos en línea", fr: "Rechercher des codes en ligne", zh: "在线搜索金手指", ru: "Искать читы онлайн" },
  "Busca online indisponível p/ este sistema": { en: "Online search unavailable for this system", es: "Búsqueda en línea no disponible para este sistema", fr: "Recherche en ligne indisponible pour ce système", zh: "此系统不支持在线搜索", ru: "Онлайн-поиск недоступен для этой системы" },
  "Lista de cheats": { en: "Cheat list", es: "Lista de trucos", fr: "Liste des codes", zh: "金手指列表", ru: "Список читов" },
  "Nenhum cheat ainda. Busque online ou adicione abaixo.": { en: "No cheats yet. Search online or add one below.", es: "Aún no hay trucos. Busca en línea o añade uno abajo.", fr: "Aucun code pour l'instant. Cherchez en ligne ou ajoutez-en un ci-dessous.", zh: "暂无金手指。在线搜索或在下方添加。", ru: "Читов пока нет. Найдите онлайн или добавьте ниже." },
  "Ativar cheat": { en: "Toggle cheat", es: "Activar truco", fr: "Activer le code", zh: "切换金手指", ru: "Переключить чит" },
  "Remover": { en: "Remove", es: "Eliminar", fr: "Supprimer", zh: "移除", ru: "Удалить" },
  "Adicionar manualmente": { en: "Add manually", es: "Añadir manualmente", fr: "Ajouter manuellement", zh: "手动添加", ru: "Добавить вручную" },
  "Descrição (ex: Vidas infinitas)": { en: "Description (e.g. Infinite lives)", es: "Descripción (ej. Vidas infinitas)", fr: "Description (ex. Vies infinies)", zh: "描述（例如：无限生命）", ru: "Описание (напр. Бесконечные жизни)" },
  "Código (Game Genie / PAR / raw)": { en: "Code (Game Genie / PAR / raw)", es: "Código (Game Genie / PAR / raw)", fr: "Code (Game Genie / PAR / brut)", zh: "代码 (Game Genie / PAR / 原始)", ru: "Код (Game Genie / PAR / raw)" },
  "Adicionar cheat": { en: "Add cheat", es: "Añadir truco", fr: "Ajouter le code", zh: "添加金手指", ru: "Добавить чит" },

  // ---- LudexAdminPanel ----
  "Liberar 1 slot da license de {who}?\n\nIsso decrementa o uses_count no Gumroad. O cliente vai poder ativar em outro PC.": { en: "Free up 1 slot from {who}'s license?\n\nThis decrements the uses_count on Gumroad. The customer will be able to activate it on another PC.", es: "¿Liberar 1 espacio de la licencia de {who}?\n\nEsto reduce el uses_count en Gumroad. El cliente podrá activarla en otro PC.", fr: "Libérer 1 emplacement de la licence de {who} ?\n\nCela décrémente le uses_count sur Gumroad. Le client pourra l'activer sur un autre PC.", zh: "释放 {who} 的许可证的 1 个名额？\n\n这会减少 Gumroad 上的 uses_count。客户将能在另一台电脑上激活。", ru: "Освободить 1 слот лицензии {who}?\n\nЭто уменьшит uses_count в Gumroad. Клиент сможет активировать её на другом ПК." },
  "Liberar slot": { en: "Free up slot", es: "Liberar espacio", fr: "Libérer l'emplacement", zh: "释放名额", ru: "Освободить слот" },
  "Liberar": { en: "Free up", es: "Liberar", fr: "Libérer", zh: "释放", ru: "Освободить" },
  "Slot liberado pra {who}": { en: "Slot freed for {who}", es: "Espacio liberado para {who}", fr: "Emplacement libéré pour {who}", zh: "已为 {who} 释放名额", ru: "Слот освобождён для {who}" },
  "Painel Admin · Ludex": { en: "Admin Panel · Ludex", es: "Panel de administración · Ludex", fr: "Panneau d'administration · Ludex", zh: "管理面板 · Ludex", ru: "Панель администратора · Ludex" },
  "Vendas via Gumroad": { en: "Sales via Gumroad", es: "Ventas vía Gumroad", fr: "Ventes via Gumroad", zh: "通过 Gumroad 的销售", ru: "Продажи через Gumroad" },
  "Vendas (página)": { en: "Sales (page)", es: "Ventas (página)", fr: "Ventes (page)", zh: "销售（本页）", ru: "Продажи (страница)" },
  "Faturamento": { en: "Revenue", es: "Ingresos", fr: "Chiffre d'affaires", zh: "营收", ru: "Выручка" },
  "Ativadas": { en: "Activated", es: "Activadas", fr: "Activées", zh: "已激活", ru: "Активировано" },
  "Refunds": { en: "Refunds", es: "Reembolsos", fr: "Remboursements", zh: "退款", ru: "Возвраты" },
  "Buscar por email, nome ou license key...": { en: "Search by email, name or license key...", es: "Buscar por correo, nombre o clave de licencia...", fr: "Rechercher par e-mail, nom ou clé de licence...", zh: "按邮箱、姓名或许可证密钥搜索...", ru: "Поиск по email, имени или лицензионному ключу..." },
  "Atualizar": { en: "Refresh", es: "Actualizar", fr: "Actualiser", zh: "刷新", ru: "Обновить" },
  "Gumroad ↗": { en: "Gumroad ↗", es: "Gumroad ↗", fr: "Gumroad ↗", zh: "Gumroad ↗", ru: "Gumroad ↗" },
  "Carregando vendas...": { en: "Loading sales...", es: "Cargando ventas...", fr: "Chargement des ventes...", zh: "正在加载销售...", ru: "Загрузка продаж..." },
  "Nenhuma venda bate com a busca.": { en: "No sale matches the search.", es: "Ninguna venta coincide con la búsqueda.", fr: "Aucune vente ne correspond à la recherche.", zh: "没有销售符合搜索条件。", ru: "Нет продаж, соответствующих поиску." },
  "Nenhuma venda nessa página ainda.": { en: "No sales on this page yet.", es: "Aún no hay ventas en esta página.", fr: "Aucune vente sur cette page pour l'instant.", zh: "本页暂无销售。", ru: "На этой странице пока нет продаж." },
  "Compras de teste do creator podem não aparecer aqui — só vendas reais de clientes externos.": { en: "Creator test purchases may not appear here — only real sales from external customers.", es: "Las compras de prueba del creador pueden no aparecer aquí — solo ventas reales de clientes externos.", fr: "Les achats de test du créateur peuvent ne pas apparaître ici — seulement les ventes réelles de clients externes.", zh: "创作者的测试购买可能不会显示在此处——仅显示来自外部客户的真实销售。", ru: "Тестовые покупки создателя могут здесь не отображаться — только реальные продажи внешним клиентам." },
  "Sem nome": { en: "No name", es: "Sin nombre", fr: "Sans nom", zh: "无姓名", ru: "Без имени" },
  "Refund": { en: "Refund", es: "Reembolso", fr: "Remboursement", zh: "退款", ru: "Возврат" },
  "Disputa": { en: "Dispute", es: "Disputa", fr: "Litige", zh: "争议", ru: "Спор" },
  "Ativa": { en: "Active", es: "Activa", fr: "Active", zh: "已激活", ru: "Активна" },
  "Não ativada": { en: "Not activated", es: "No activada", fr: "Non activée", zh: "未激活", ru: "Не активирована" },
  "PCs": { en: "PCs", es: "PCs", fr: "PC", zh: "台电脑", ru: "ПК" },
  "License:": { en: "License:", es: "Licencia:", fr: "Licence :", zh: "许可证：", ru: "Лицензия:" },
  "Liberando...": { en: "Freeing up...", es: "Liberando...", fr: "Libération...", zh: "正在释放...", ru: "Освобождение..." },
  "Liberar 1 slot": { en: "Free up 1 slot", es: "Liberar 1 espacio", fr: "Libérer 1 emplacement", zh: "释放 1 个名额", ru: "Освободить 1 слот" },
  "← Anterior": { en: "← Previous", es: "← Anterior", fr: "← Précédent", zh: "← 上一页", ru: "← Назад" },
  "Página {page}": { en: "Page {page}", es: "Página {page}", fr: "Page {page}", zh: "第 {page} 页", ru: "Страница {page}" },
  "Próxima →": { en: "Next →", es: "Siguiente →", fr: "Suivant →", zh: "下一页 →", ru: "Вперёд →" },
  "Pra": { en: "To", es: "Para", fr: "Pour", zh: "要", ru: "Чтобы" },
  "refund": { en: "refund", es: "reembolsar", fr: "rembourser", zh: "退款", ru: "вернуть деньги" },
  "ou": { en: "or", es: "o", fr: "ou", zh: "或", ru: "или" },
  "banir": { en: "ban", es: "banear", fr: "bannir", zh: "封禁", ru: "заблокировать" },
  ", abra o": { en: ", open the", es: ", abre el", fr: ", ouvrez le", zh: "，请打开", ru: ", откройте" },
  "Dashboard Gumroad": { en: "Gumroad Dashboard", es: "Panel de Gumroad", fr: "Tableau de bord Gumroad", zh: "Gumroad 仪表板", ru: "Панель Gumroad" },

  // ---- LudexWhatsNew ----
  "NOVIDADES": { en: "WHAT'S NEW", es: "NOVEDADES", fr: "NOUVEAUTÉS", zh: "新功能", ru: "ЧТО НОВОГО" },
  "O que mudou": { en: "What changed", es: "Qué cambió", fr: "Ce qui a changé", zh: "更新内容", ru: "Что изменилось" },
  "O que mudou na v{v}": { en: "What changed in v{v}", es: "Qué cambió en la v{v}", fr: "Ce qui a changé en v{v}", zh: "v{v} 更新内容", ru: "Что изменилось в v{v}" },
  "Você atualizou e chegou na v{v}. Resumo das mudanças:": { en: "You updated and reached v{v}. Summary of changes:", es: "Actualizaste y llegaste a la v{v}. Resumen de cambios:", fr: "Vous avez mis à jour vers la v{v}. Résumé des changements :", zh: "您已更新至 v{v}。更新摘要：", ru: "Вы обновились до v{v}. Сводка изменений:" },
  "Resumo rápido desta atualização.": { en: "Quick summary of this update.", es: "Resumen rápido de esta actualización.", fr: "Résumé rapide de cette mise à jour.", zh: "本次更新的简要说明。", ru: "Краткая сводка этого обновления." },
  "Entendi": { en: "Got it", es: "Entendido", fr: "Compris", zh: "知道了", ru: "Понятно" },
};

/**
 * Traduz `s` pro idioma atual. Cadeia: idioma -> inglês -> PT (a própria chave).
 * `vars` interpola placeholders {nome}: t("Importei {n} BIOS", { n: 3 }).
 */
export function t(s, vars) {
  let out;
  if (_lang === "pt") out = s;
  else { const e = DICT[s]; out = e ? (e[_lang] || e.en || s) : s; }
  if (vars) {
    for (const k in vars) out = out.split("{" + k + "}").join(String(vars[k]));
  }
  return out;
}
