function normalizedMessage(row) {
  return String(row?.message || "").trim();
}

export function classifyClientError(row) {
  const message = normalizedMessage(row);
  const combined = `${message} ${row?.stack || ""}`;

  if (/^script error\.?$/i.test(message)) {
    return {
      code: "JS-OPAQUE-001",
      title: "Браузер скрыл подробности ошибки",
      explanation: "На странице произошёл сбой внешнего сценария, но браузер не передал его источник и причину. По этой записи нельзя достоверно определить, какое действие не сработало.",
      recommendation: "Если ошибка повторится, новая версия журнала постарается сохранить источник и последнее действие пользователя.",
      confidence: "Деталей недостаточно",
    };
  }

  if (/Array\.from requires an array-like object/i.test(combined)) {
    return {
      code: "JS-LIST-001",
      title: "Не удалось обработать список на странице",
      explanation: "Сценарий ожидал список элементов, но получил пустое значение. Часть профиля могла не загрузиться или перестать реагировать.",
      recommendation: "Чаще всего это связано с несовпадением версии страницы и сценария в кеше. Защитная проверка добавлена; при повторении нужен источник из технических деталей.",
      confidence: "Причина определена",
    };
  }

  if (row?.kind === "unhandled_rejection") {
    return {
      code: "JS-ASYNC-001",
      title: "Фоновая операция завершилась с ошибкой",
      explanation: "Одна из асинхронных операций страницы не была обработана корректно. Пользователь мог не получить ожидаемый результат после действия.",
      recommendation: "Проверьте страницу, источник и последнее действие пользователя в технических деталях.",
      confidence: "Тип сбоя определён",
    };
  }

  if (/null|undefined|not a function|cannot read/i.test(combined)) {
    return {
      code: "JS-DATA-001",
      title: "Страница получила неожиданные данные",
      explanation: "Сценарий попытался использовать отсутствующее значение или функцию. Отдельный блок интерфейса мог работать неправильно.",
      recommendation: "Проверьте источник, строку и последнее действие. При повторении на одной странице нужен точечный разбор.",
      confidence: "Тип сбоя определён",
    };
  }

  return {
    code: "JS-RUNTIME-001",
    title: "Ошибка выполнения страницы",
    explanation: "Во время работы интерфейса возникла непредусмотренная ошибка. Подробности сохранены ниже для диагностики.",
    recommendation: "Сопоставьте страницу, время и последнее действие пользователя. Повторяющиеся записи требуют отдельного исправления.",
    confidence: "Общая классификация",
  };
}

function csvCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildClientErrorsCsv(rows) {
  const header = [
    "Дата", "Пользователь", "Код", "Объяснение", "Страница", "Последнее действие",
    "Тип", "Техническое сообщение", "Источник", "Строка", "Столбец", "Браузер",
  ];
  const body = (rows || []).map((row) => {
    const insight = classifyClientError(row);
    const context = row?.context || {};
    return [
      row?.created_at || "", row?.display_name || "Сотрудник", insight.code,
      `${insight.title}. ${insight.explanation}`, row?.page || "", context.lastAction?.target || "",
      row?.kind || "", row?.message || "", context.source || "", context.line || "",
      context.column || "", context.userAgent || "",
    ].map(csvCell).join(";");
  });
  return `\uFEFF${[header.map(csvCell).join(";"), ...body].join("\r\n")}`;
}
