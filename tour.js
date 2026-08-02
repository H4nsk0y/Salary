const tourSteps = {
  calculator: [
    {
      element: "#salaryForm",
      popover: {
        title: "Быстрый расчёт зарплаты",
        description: "Заполните основные показатели месяца. Калькулятор работает и без регистрации, а авторизованным пользователям может подставить оклад из профиля.",
        position: "bottom",
      },
    },
    {
      element: "#oklad",
      popover: {
        title: "Оклад",
        description: "Укажите месячный оклад. Денежное значение можно скрыть от посторонних кнопкой с изображением глаза.",
        position: "bottom",
      },
    },
    {
      element: "#normHours",
      popover: {
        title: "Норма месяца",
        description: "Введите норму часов по производственному календарю или вашему рабочему графику за выбранный месяц.",
        position: "bottom",
      },
    },
    {
      element: "#workedHours",
      popover: {
        title: "Отработанные часы",
        description: "Здесь учитываются все фактически отработанные часы месяца. Ночные часы ниже указываются отдельно, но входят в это общее количество.",
        position: "bottom",
      },
    },
    {
      element: "#nightHours",
      popover: {
        title: "Ночные часы",
        description: "Укажите часы, пришедшиеся на ночное время. К ним применяется дополнительная оплата 40% от базовой часовой ставки.",
        position: "bottom",
      },
    },
    {
      element: "#firstHalfHours",
      popover: {
        title: "Первая половина месяца",
        description: "Часы до 15 числа используются для ориентировочного разделения выплаты на аванс и остаток.",
        position: "bottom",
      },
    },
    {
      element: "#holidayToggle",
      popover: {
        title: "Работа в праздники",
        description: "Включите этот режим, если были праздничные смены. Появятся отдельные поля для дневных и ночных часов с двойной оплатой.",
        position: "right",
      },
    },
    {
      element: "#resultsPeekBtn",
      popover: {
        title: "Результат на руки",
        description: "Расчёт показывает предполагаемую сумму после налога, часовую ставку, премию, ночные, аванс и остаток. Это ориентир, а не расчётный лист работодателя.",
        position: "top",
      },
    },
    {
      element: "#resetBtn",
      popover: {
        title: "Начать заново",
        description: "Кнопка очищает введённые показатели. Оклад из профиля при этом можно быстро вернуть повторно.",
        position: "top",
      },
    },
    {
      element: "#calculatorSignupPrompt",
      popover: {
        title: "Больше возможностей после входа",
        description: "В профиле сохраняются персональные настройки, а табель рассчитывает часы и выплаты автоматически по каждому дню.",
        position: "top",
      },
    },
  ],

  table: [
    {
      element: "#monthSelect",
      popover: {
        title: "Период табеля",
        description: "Переключайте месяц и год. Сохранённые данные загружаются автоматически, а старые месяцы используют свои снимки нормы и оклада.",
        position: "bottom",
      },
    },
    {
      element: "#readOnlyNotice",
      popover: {
        title: "Режим просмотра",
        description: "В отделе ЕГАИС официальный график изменяют owner и редакторы отдела. Сотрудник видит актуальный табель и по-прежнему может подтверждать фактические выплаты.",
        position: "bottom",
      },
    },
    {
      element: "#okladPanel",
      popover: {
        title: "Оклад и коды",
        description: "Оклад участвует в расчёте выплат. Здесь же находится шпаргалка по отпускам, больничным, учебным дням, периоду до трудоустройства и увольнению.",
        position: "bottom",
      },
    },
    {
      element: "#helpPanel",
      popover: {
        title: "Схемы смен",
        description: "Краткие примеры объясняют дневные, ночные и переходящие смены. Для практики откройте интерактивный тренажёр табеля.",
        position: "bottom",
      },
    },
    {
      element: "#timesheet",
      popover: {
        title: "День и ночь",
        description: "Верхняя строка содержит дневные часы или код отсутствия, нижняя — ночные. Таблица прокручивается горизонтально, а стрелки клавиатуры перемещают фокус между ячейками.",
        position: "top",
      },
    },
    {
      element: "#mobileBar",
      popover: {
        title: "Управление на телефоне",
        description: "Стрелками выберите дату. Если редактирование доступно, нижние кнопки отмечают праздник, перенесённый выходной или сокращённый день.",
        position: "bottom",
      },
    },
    {
      element: ".timesheet-summary",
      popover: {
        title: "Часы и личная норма",
        description: "Здесь собраны отработанные часы, норма месяца, личная норма после отсутствий и итоговая переработка или недоработка.",
        position: "top",
      },
    },
    {
      element: "#payPeekBtn",
      popover: {
        title: "Выплаты",
        description: "Откройте денежный блок, чтобы увидеть сумму на руки, налог, аванс, остаток, доплаты, таймер ближайшей выплаты и предварительные отпускные.",
        position: "left",
      },
    },
    {
      element: "#saveBtn",
      popover: {
        title: "Сохранение",
        description: "При наличии доступа изменения сохраняются автоматически. Кнопка позволяет записать их сразу; в режиме просмотра она показывает, что официальный график защищён.",
        position: "bottom",
      },
    },
  ],

  profile: [
    {
      element: "#avatarFallback",
      popover: {
        title: "Личный профиль",
        description: "Добавьте аватар и проверьте данные, от которых зависят табель, нормы рабочего времени и отображение в отделе.",
        position: "bottom",
      },
    },
    {
      element: "#displayNameInput",
      popover: {
        title: "Имя сотрудника",
        description: "Имя используется в табелях отдела, сменах, задачах и уведомлениях. Укажите его так, чтобы коллеги сразу вас узнали.",
        position: "right",
      },
    },
    {
      element: "#positionSelect",
      popover: {
        title: "Должность",
        description: "Должность помогает правильно отображать сотрудника в списках и может влиять на отдельные расчёты, например надбавку за вредность.",
        position: "right",
      },
    },
    {
      element: "#branchSelect",
      popover: {
        title: "Филиал",
        description: "Филиал нужен для применения локальных правил. Пониженная женская дневная норма действует только для CHATEAU ALVISA.",
        position: "right",
      },
    },
    {
      element: "#weeklyHoursSelect",
      popover: {
        title: "Норма рабочей недели",
        description: "По умолчанию используется 40 часов. Значение 35 часов выбирается только для сотрудников, которым установлена сокращённая рабочая неделя.",
        position: "right",
      },
    },
    {
      element: "#employmentDateInput",
      popover: {
        title: "Дата трудоустройства",
        description: "Дата помогает корректно рассчитывать годовую норму нового сотрудника и период работы в Alvisa.",
        position: "right",
      },
    },
    {
      element: "#okladInput",
      popover: {
        title: "Оклад",
        description: "Оклад подставляется в калькулятор и новые табели. Старые месяцы сохраняют собственный денежный снимок и не пересчитываются после его изменения.",
        position: "right",
      },
    },
    {
      element: "#saveProfileBtn",
      popover: {
        title: "Сохраните изменения",
        description: "После изменения персональных данных нажмите «Сохранить». Обязательные поля должны быть заполнены для корректной работы табеля.",
        position: "top",
      },
    },
    {
      element: "#trainingAchievement",
      popover: {
        title: "Обучение",
        description: "После полного прохождения интерактивного тренажёра здесь появится отметка об успешном обучении.",
        position: "bottom",
      },
    },
    {
      element: "#overtimeBarText",
      popover: {
        title: "Годовой баланс",
        description: "Профиль собирает подтверждённые табели выбранного года и показывает переработку, остаток лимита и корректировки по отсутствиям.",
        position: "bottom",
      },
    },
    {
      element: "#timesheetsList",
      popover: {
        title: "Сохранённые месяцы",
        description: "Здесь можно открыть любой сохранённый месяц. Будущие табели не включаются в годовые финансовые итоги до наступления соответствующего месяца.",
        position: "top",
      },
    },
    {
      element: "#calGrid",
      popover: {
        title: "Календарь",
        description: "Календарь объединяет официальные выходные и отметки табеля. Нажатие на дату открывает соответствующий день месяца.",
        position: "left",
      },
    },
  ],
};

function isElementVisible(element) {
  if (!(element instanceof Element)) return false;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
}

function prepareSteps(page) {
  return (tourSteps[page] ?? [])
    .map((step) => {
      const element = document.querySelector(step.element);
      if (!isElementVisible(element)) return null;

      return {
        ...step,
        element,
        popover: {
          ...step.popover,
          className: "alvisa-tour",
        },
      };
    })
    .filter(Boolean);
}

export function startTour(page) {
  if (typeof window.Driver !== "function") {
    console.error("Driver.js не загружен");
    return;
  }

  const steps = prepareSteps(page);
  if (!steps.length) {
    console.warn(`Для обзора «${page}» не найдено доступных шагов.`);
    return;
  }

  const driver = new window.Driver({
    opacity: 0.72,
    animate: !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    allowClose: true,
    keyboardControl: true,
    padding: 8,
    nextBtnText: "Далее",
    prevBtnText: "Назад",
    closeBtnText: "Закрыть",
    doneBtnText: "Завершить",
  });

  driver.defineSteps(steps);
  driver.start();
}

export function shouldShowTour(page) {
  const key = `tour_${page}_shown`;
  if (localStorage.getItem(key)) return false;
  localStorage.setItem(key, "true");
  return true;
}
