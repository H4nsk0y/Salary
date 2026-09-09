const SEARCH_STYLE_ID = "alvisa-site-search-style";
const SEARCH_EASTER_EGG_URL = "https://yandex.ru/images/search?img_url=https%3A%2F%2Fyt3.googleusercontent.com%2Fte4KezxUjBKQD0AUKH-K-tciqntCsriu8hH1_EI9sqZHMt4vHU2OxbBkBnXrffALFTlHWUpLFrs%3Ds900-c-k-c0x00ffffff-no-rj&lr=11007&pos=0&rpt=simage&source=serp&text=%D1%84%D0%B0%D1%80%D0%B8%D1%82%20%D0%BC%D0%B5%D0%BC";

const PUBLIC_SEARCH_ENTRIES = [
  { title: "Главная", href: "index.html", description: "Основные разделы ALVISA SALARY", keywords: "начало рабочее пространство разделы" },
  { title: "Калькулятор", href: "calculator.html", description: "Рассчитать зарплату и выплаты", keywords: "зарплата оклад аванс остаток расчет деньги" },
  { title: "Личный табель", href: "table.html", description: "Смены, часы и расчетные листы", keywords: "график часы день ночь отпуск больничный отпускные расчетка расчетный лист" },
  { title: "Смены", href: "schedule.html", description: "Кто работает сегодня и завтра", keywords: "расписание отдел коллеги дневная ночная смена" },
  { title: "Чек-лист смены", href: "checklist.html", description: "Дела на смену и сдача смены", keywords: "задачи дела ничего не забыть смену сдал" },
  { title: "Профиль", href: "profile.html", description: "Личные данные и история табелей", keywords: "фио должность пол филиал оклад норма 35 часов 40 часов аватар" },
  { title: "Настройки", href: "settings.html", description: "Отображение, приложение и уведомления", keywords: "скрыть деньги калькулятор приложение pwa push" },
  { title: "Push-уведомления", href: "settings.html#pushNotificationsBtn", description: "Включение уведомлений на устройстве", keywords: "пуш оповещения подписка суточные егаис" },
  { title: "Обучение", href: "timesheet-training.html", description: "Тренажер заполнения табеля", keywords: "курс практика коды отсутствия руководитель научиться" },
  { title: "Помощь", href: "help.html", description: "Ответы по сменам, кодам и расчетам", keywords: "справка вопрос инструкция как пользоваться faq" },
  { title: "Коды отсутствия", href: "help.html#codes", description: "ОТ, Б, У, ОД и другие коды", keywords: "отпуск больничный учебный отсутствие нт ув" },
  { title: "Нормы времени", href: "help.html#norms", description: "Рабочая норма и особенности графика", keywords: "35 часов 40 часов женщина шато инвалид" },
  { title: "Выплаты и расчеты", href: "help.html#payments", description: "Как устроены расчеты в табеле", keywords: "аванс остаток налог отпускные зарплата" },
  { title: "Обновления", href: "updates.html", description: "Последние изменения ALVISA SALARY", keywords: "новости версии что нового журнал" },
  { title: "Поддержка", href: "support.html", description: "Связаться и поддержать проект", keywords: "помощь автор telegram телеграм идея" },
];

const OWNER_SEARCH_ENTRIES = [
  { title: "Управление отделами", href: "owner.html", description: "Сотрудники, редакторы и отделы", keywords: "овнер owner руководство управление" },
  { title: "Пользователи", href: "owner-users.html", description: "Учетные записи и приглашения", keywords: "email оклад профиль удалить приглашение" },
  { title: "Аналитика", href: "owner-analytics.html", description: "Отклонения выплат и ошибки", keywords: "статистика сравнение факт расчет" },
  { title: "Серьезные ошибки", href: "owner-analytics.html#clientErrorsTitle", description: "Журнал крупных ошибок интерфейса", keywords: "сбои отчет выгрузить" },
  { title: "Предложенные идеи", href: "owner-ideas.html", description: "Заявки пользователей", keywords: "предложения рассмотрено" },
  { title: "Состояние системы", href: "owner-status.html", description: "База, подключение и системные проверки", keywords: "размер базы здоровье диагностика лимит" },
];

function normalizeSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

export function isSearchEasterEgg(query) {
  return normalizeSearchText(query) === "поиск";
}

function scoreEntry(entry, query, tokens) {
  const title = normalizeSearchText(entry.title);
  const description = normalizeSearchText(entry.description);
  const keywords = normalizeSearchText(entry.keywords);
  const haystack = `${title} ${description} ${keywords}`;
  if (!tokens.every((token) => haystack.includes(token))) return -1;

  let score = 0;
  if (title === query) score += 160;
  else if (title.startsWith(query)) score += 110;
  else if (title.includes(query)) score += 75;
  for (const token of tokens) {
    if (title.startsWith(token)) score += 24;
    else if (title.includes(token)) score += 14;
    else if (keywords.includes(token)) score += 7;
  }
  return score;
}

export function searchSiteEntries(query, { isOwner = false, limit = 8 } = {}) {
  const entries = isOwner ? [...PUBLIC_SEARCH_ENTRIES, ...OWNER_SEARCH_ENTRIES] : PUBLIC_SEARCH_ENTRIES;
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return entries.slice(0, limit);

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return entries
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, normalizedQuery, tokens) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}

function injectSearchStyles() {
  if (document.getElementById(SEARCH_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SEARCH_STYLE_ID;
  style.textContent = `
    .app-site-search { flex: 0 0 auto; }
    .app-search-button {
      display: inline-flex; width: 40px; height: 40px; align-items: center; justify-content: center;
      border: 1px solid rgba(241,238,232,.14); border-radius: 8px; background: rgba(241,238,232,.04);
      color: #c6c9cc; transition: background .16s ease, border-color .16s ease, color .16s ease, transform .16s ease;
    }
    .app-search-button:hover, .app-search-button.is-open { border-color: rgba(110,168,232,.35); background: rgba(110,168,232,.08); color: #d8ebff; }
    .app-search-button:active { transform: scale(.98); }
    .app-search-dialog { width: min(620px, calc(100vw - 24px)); max-height: min(680px, calc(100dvh - 28px)); margin: auto; padding: 0; overflow: hidden; border: 1px solid rgba(241,238,232,.16); border-radius: 10px; background: #111417; color: #f1eee8; box-shadow: 0 28px 90px rgba(0,0,0,.58); }
    .app-search-dialog::backdrop { background: rgba(4,5,6,.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
    .app-search-head { display: flex; align-items: center; gap: 10px; min-height: 62px; padding: 10px 12px 10px 16px; border-bottom: 1px solid rgba(241,238,232,.11); }
    .app-search-head svg { flex: 0 0 auto; color: #858b90; }
    .app-search-input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #f1eee8; font: inherit; font-size: 1rem; }
    .app-search-input::placeholder { color: #777d82; }
    .app-search-close { flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid rgba(241,238,232,.12); border-radius: 6px; background: rgba(241,238,232,.04); color: #a8adb2; font-size: 1.25rem; line-height: 1; }
    .app-search-close:hover { color: #f1eee8; background: rgba(241,238,232,.08); }
    .app-search-meta { padding: 11px 16px 5px; color: #777d82; font-size: .7rem; font-weight: 700; text-transform: uppercase; }
    .app-search-results { max-height: min(550px, calc(100dvh - 130px)); overflow-y: auto; padding: 6px 8px 10px; }
    .app-search-result { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; align-items: center; min-height: 58px; padding: 10px 12px; border: 1px solid transparent; border-radius: 7px; color: inherit; text-decoration: none; }
    .app-search-result:hover, .app-search-result.is-active { border-color: rgba(110,168,232,.25); background: rgba(110,168,232,.07); }
    .app-search-result-title { color: #f1eee8; font-size: .9rem; font-weight: 700; }
    .app-search-result-copy { margin-top: 3px; color: #92979c; font-size: .76rem; line-height: 1.35; }
    .app-search-result-arrow { color: #6ea8e8; font-size: 1rem; }
    .app-search-empty { padding: 34px 18px 38px; text-align: center; color: #92979c; font-size: .86rem; }
    .app-search-easter-egg { display: block; margin: 6px 8px 12px; padding: 28px 18px; border: 1px solid rgba(110,168,232,.25); border-radius: 7px; background: rgba(110,168,232,.07); color: #d8ebff; font-size: .96rem; font-weight: 700; line-height: 1.55; text-align: center; text-decoration: none; }
    .app-search-easter-egg:hover { border-color: rgba(110,168,232,.48); background: rgba(110,168,232,.12); }
    @media (max-width: 520px) {
      .app-search-dialog { width: calc(100vw - 20px); max-height: calc(100dvh - max(20px, env(safe-area-inset-top)) - max(20px, env(safe-area-inset-bottom))); }
      .app-search-result { min-height: 62px; }
    }
  `;
  document.head.appendChild(style);
}

function searchIcon(size = 18) {
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>`;
  return span;
}

export function createSiteSearchWidget() {
  injectSearchStyles();
  let isOwner = false;
  let activeIndex = 0;
  let renderedEntries = [];

  const root = document.createElement("div");
  root.className = "app-site-search";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "app-search-button";
  button.setAttribute("aria-label", "Поиск по сайту");
  button.title = "Поиск по сайту (Ctrl+K)";
  button.append(searchIcon());

  const dialog = document.createElement("dialog");
  dialog.className = "app-search-dialog";
  dialog.setAttribute("aria-label", "Поиск по сайту");

  const head = document.createElement("div");
  head.className = "app-search-head";
  head.append(searchIcon(20));

  const input = document.createElement("input");
  input.className = "app-search-input";
  input.type = "search";
  input.autocomplete = "off";
  input.placeholder = "Раздел или функция";
  input.setAttribute("aria-label", "Введите запрос");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "app-search-close";
  close.setAttribute("aria-label", "Закрыть поиск");
  close.textContent = "×";
  head.append(input, close);

  const meta = document.createElement("div");
  meta.className = "app-search-meta";
  const results = document.createElement("div");
  results.className = "app-search-results";
  results.setAttribute("role", "listbox");
  dialog.append(head, meta, results);
  root.append(button, dialog);

  const setActive = (nextIndex) => {
    if (!renderedEntries.length) return;
    activeIndex = (nextIndex + renderedEntries.length) % renderedEntries.length;
    results.querySelectorAll(".app-search-result").forEach((node, index) => {
      node.classList.toggle("is-active", index === activeIndex);
      node.setAttribute("aria-selected", String(index === activeIndex));
      if (index === activeIndex) node.scrollIntoView({ block: "nearest" });
    });
  };

  const render = () => {
    const query = input.value.trim();
    renderedEntries = searchSiteEntries(query, { isOwner });
    activeIndex = 0;
    results.replaceChildren();
    meta.textContent = query ? `Результаты: ${renderedEntries.length}` : "Быстрый переход";

    if (isSearchEasterEgg(query)) {
      renderedEntries = [];
      meta.textContent = "Найдено кое-что особенное";
      const message = document.createElement("a");
      message.className = "app-search-easter-egg";
      message.href = SEARCH_EASTER_EGG_URL;
      message.target = "_blank";
      message.rel = "noopener noreferrer";
      message.textContent = "Поздравляю! Вы такой умный! Нашли в поиске поиск. ВАУ!";
      results.append(message);
      return;
    }

    if (!renderedEntries.length) {
      const empty = document.createElement("div");
      empty.className = "app-search-empty";
      empty.textContent = "Ничего не найдено. Попробуйте сформулировать короче.";
      results.append(empty);
      return;
    }

    renderedEntries.forEach((entry, index) => {
      const link = document.createElement("a");
      link.className = `app-search-result${index === 0 ? " is-active" : ""}`;
      link.href = entry.href;
      link.dataset.navKey = entry.href.split(/[.#?]/)[0].replace(/\.html$/i, "") || "home";
      link.setAttribute("role", "option");
      link.setAttribute("aria-selected", String(index === 0));

      const copy = document.createElement("div");
      const title = document.createElement("div");
      title.className = "app-search-result-title";
      title.textContent = entry.title;
      const description = document.createElement("div");
      description.className = "app-search-result-copy";
      description.textContent = entry.description;
      copy.append(title, description);

      const arrow = document.createElement("span");
      arrow.className = "app-search-result-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "›";
      link.append(copy, arrow);
      link.addEventListener("mouseenter", () => setActive(index));
      results.append(link);
    });
  };

  const open = () => {
    if (dialog.open) return;
    input.value = "";
    render();
    dialog.showModal();
    button.classList.add("is-open");
    requestAnimationFrame(() => input.focus());
  };

  const closeDialog = () => {
    if (dialog.open) dialog.close();
  };

  button.addEventListener("click", open);
  close.addEventListener("click", closeDialog);
  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && renderedEntries[activeIndex]) {
      event.preventDefault();
      results.querySelectorAll(".app-search-result")[activeIndex]?.click();
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener("close", () => {
    button.classList.remove("is-open");
    button.focus();
  });
  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "k") return;
    event.preventDefault();
    dialog.open ? closeDialog() : open();
  });

  return {
    element: root,
    setProfile(profile) {
      isOwner = profile?.role === "owner";
      if (dialog.open) render();
    },
  };
}
