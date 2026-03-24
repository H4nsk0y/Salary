// tour.js
const steps = {
  calculator: [
  {
    element: '#oklad',
    popover: {
      title: 'Оклад',
      description: 'Ваш месячный оклад. Если вы авторизованы, значение подтянется из профиля. Можно ввести вручную.',
      side: 'bottom'
    }
  },
  {
    element: '#normHours',
    popover: {
      title: 'Норма часов в месяце',
      description: 'Норма зависит от месяца. Если вы отсутствовали по уважительной причине, она может измениться (больничный, отпуск).',
      side: 'bottom'
    }
  },
  {
    element: '#workedHours',
    popover: {
      title: 'Отработано часов',
      description: 'Укажите количество фактически отработанных часов в этом месяце.',
      side: 'bottom'
    }
  },
  {
    element: '#nightHours',
    popover: {
      title: 'Ночные часы',
      description: 'Часы, отработанные с 22:00 до 6:00. К ним применяется надбавка 40%.',
      side: 'bottom'
    }
  },
  {
    element: '#firstHalfHours',
    popover: {
      title: 'Первая половина месяца',
      description: 'Часы, отработанные до 15 числа. Используется для расчёта аванса.',
      side: 'bottom'
    }
  },
  {
    element: '#firstHalfNightHours',
    popover: {
      title: 'Ночные в первой половине',
      description: 'Ночные часы, которые пришлись на первую половину месяца.',
      side: 'bottom'
    }
  },
  {
    element: '#holidayToggle',
    popover: {
      title: 'Праздничные дни',
      description: 'Если вы работали в праздники, отметьте галочкой. Появятся поля для ввода смен.',
      side: 'right'
    }
  },
  {
    element: '#resetBtn',
    popover: {
      title: 'Сбросить форму',
      description: 'Очищает все поля ввода, оставляя только оклад из профиля.',
      side: 'top'
    }
  },
  {
    element: '#net',
    popover: {
      title: 'Результат расчёта',
      description: 'Здесь отображается итоговая сумма к выплате (нетто, после вычета налогов).',
      side: 'left'
    }
  }
],
  table: [
  {
    element: '#monthSelect',
    popover: {
      title: 'Выбор месяца и года',
      description: 'Выберите месяц и год, чтобы открыть или создать табель.',
      side: 'bottom'
    }
  },
  {
    element: '#okladInput',
    popover: {
      title: 'Оклад',
      description: 'Оклад используется для расчёта зарплаты по табелю. Подтягивается из профиля.',
      side: 'bottom'
    }
  },
  {
    element: '#timesheet',
    popover: {
      title: 'Табель',
      description: 'В строках "День" и "Ночь" вводите отработанные часы. Для отпуска – введите "ОТ", для больничного – "Б".',
      side: 'top'
    }
  },
  {
    element: '#dayRow',
    popover: {
      title: 'Дневные часы',
      description: 'В этой строке указывайте количество часов, отработанных в дневную смену.',
      side: 'right'
    }
  },
  {
    element: '#nightRow',
    popover: {
      title: 'Ночные часы',
      description: 'Сюда вводятся часы, отработанные ночью (с 22:00 до 6:00).',
      side: 'right'
    }
  },
  {
    element: '#saveBtn',
    popover: {
      title: 'Сохранить табель',
      description: 'После ввода данных нажмите "Сохранить". Данные будут доступны в личном кабинете.',
      side: 'top'
    }
  },
  {
    element: '#totalHours',
    popover: {
      title: 'Итоги',
      description: 'Здесь отображаются общие часы, норма, переработка и расчёт зарплаты.',
      side: 'top'
    }
  }
],
  profile: [
        {
    element: '#avatarFallback',
    popover: {
        title: 'Аватар',
        description: 'Загрузите своё фото, чтобы персонализировать профиль.',
        side: 'bottom'
    }
    },
    {
      element: '#displayNameInput',
      popover: {
        title: 'Имя',
        description: 'Как вас называть в интерфейсе.',
        side: 'right'
      }
    },
    {
      element: '#genderSelect',
      popover: {
        title: 'Пол',
        description: 'Нужен для расчёта нормы рабочего времени (женщинам – 7.2 часа в день).',
        side: 'right'
      }
    },
    {
      element: '#okladInput',
      popover: {
        title: 'Оклад',
        description: 'Базовый оклад, который будет подставляться в калькулятор и табель.',
        side: 'right'
      }
    },
    {
      element: '#saveProfileBtn',
      popover: {
        title: 'Сохранить',
        description: 'Сохраняет изменения в профиле.',
        side: 'top'
      }
    },
    {
      element: '#yearSelect',
      popover: {
        title: 'Выбор года',
        description: 'Просмотр переработок и табелей за выбранный год.',
        side: 'bottom'
      }
    },
    {
      element: '#overtimeBarFill',
      popover: {
        title: 'Лимит переработок',
        description: 'Показывает, сколько часов переработки вы использовали из годового лимита 120 часов.',
        side: 'bottom'
      }
    },
    {
      element: '#timesheetsList',
      popover: {
        title: 'Ваши табели',
        description: 'Список всех сохранённых табелей за выбранный год. Можно открыть или удалить.',
        side: 'top'
      }
    },
    {
      element: '#calGrid',
      popover: {
        title: 'Календарь',
        description: 'Цвета показывают официальные праздники, выходные, а также ваши отметки из табеля. Нажмите на день – перейдёте в табель.',
        side: 'left'
      }
    }
  ]
};

// ЕДИНСТВЕННАЯ функция startTour
export function startTour(page) {
  if (typeof window.Driver !== 'function') {
    console.error('Driver.js не загружен');
    return;
  }

  const driver = new window.Driver({
    opacity: 0.5,
    animate: true,
    nextBtnText: 'Далее',
    prevBtnText: 'Назад',
    closeBtnText: 'Закрыть',
    doneBtnText: 'Готово'
  });

  if (!steps[page]) {
    console.warn(`Тур для страницы "${page}" не определён`);
    return;
  }

  const stepsCopy = steps[page]
    .map(step => {
      if (step.element && typeof step.element === 'string') {
        const el = document.querySelector(step.element);
        if (!el) {
          console.warn(`Элемент "${step.element}" не найден, шаг пропущен`);
          return null;
        }

        return {
          ...step,
          element: el,
          popover: {
            ...step.popover,
            className: 'alvisa-tour'
          }
        };
      }

      return {
        ...step,
        popover: {
          ...step.popover,
          className: 'alvisa-tour'
        }
      };
    })
    .filter(step => step !== null);

  if (stepsCopy.length === 0) {
    console.warn('Нет валидных шагов для тура');
    return;
  }

  if (typeof driver.defineSteps === 'function') {
    driver.defineSteps(stepsCopy);
    driver.start();
  } else if (typeof driver.setSteps === 'function') {
    driver.setSteps(stepsCopy);
    driver.start();
  } else {
    console.error('Неизвестный API driver.js, доступные методы:', Object.keys(driver));
  }
}

export function shouldShowTour(page) {
  const key = `tour_${page}_shown`;
  const shown = localStorage.getItem(key);
  if (!shown) {
    localStorage.setItem(key, 'true');
    return true;
  }
  return false;
}