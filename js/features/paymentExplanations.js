const number = (value) => Number.isFinite(value)
  ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
  : "—";
const rub = (value) => `${number(value)} ₽`;

export function explainPayment(id, context = {}) {
  const c = context.calculated;
  const descriptions = {
    hourRateNet: ["Часовая ставка на руки", "Оклад с учётом вредности делим на календарную норму месяца, добавляем премию 35% и вычитаем налог 13%. Это стоимость обычного часа с премией."],
    nightHourNet: ["Стоимость ночного часа", "К обычному часу с премией прибавляем ночную надбавку: 40% часовой ставки оклада после налога. Поэтому ночной час дороже дневного."],
    holidayExtraGross: ["Доплата за праздники", "Обычная оплата праздничных часов уже входит в оклад за факт, премию и ночные. Здесь показана дополнительная такая же оплата этих часов, чтобы суммарно получить двойную. Доплата выплачивается с остатком, а не с авансом. Это расчётная оценка сайта; расчётка может отличаться."],
    baseFactGross: ["Оклад за отработанное время", "Оклад с учётом вредности делим на календарную норму месяца и умножаем на все отработанные часы: дневные и ночные. Из результата вычитаем 13% налога."],
    bonusGross: ["Премия", "Премия составляет 35% оклада за фактически отработанные часы. Здесь показана сумма после налога. В прогнозе премия включена в остаток."],
    nightExtraGross: ["Ночная надбавка", "За каждый ночной час прибавляем 40% часовой ставки оклада. Здесь только надбавка после налога: обычная оплата этих часов уже входит в другие суммы."],
    grossPay: ["Автоматический расчёт", "Складываем оклад за факт, премию, ночную надбавку и праздничную доплату после налога. Это прогноз по часам табеля. Отпускные, больничные и другие фактические выплаты в этот авторасчёт не входят."],
    taxPay: ["Расчётный налог", "Сайт считает 13% от суммы начислений до налога, включая премию, ночные и праздничные доплаты. Индивидуальные вычеты и освобождения от налога этот прогноз не учитывает."],
    advancePay: ["Аванс", "Берём часы с 1-го по 15-е включительно. Оплачиваем их по окладу после налога и добавляем ночную надбавку за ночные часы этого периода. Премия и дополнительная праздничная оплата остаются в остатке."],
    remainingPay: ["Остаток", "Из автоматического расчёта за весь месяц вычитаем расчётный аванс. Поэтому сюда попадают премия и дополнительная оплата праздников, даже если праздничные смены были в первой половине месяца."],
    vacationPayEstimate: ["Предполагаемые отпускные", "Оценка основана на подтверждённых выплатах за 12 предыдущих месяцев. Сайт исключает выплаты и периоды отпусков, больничных и других отсутствий, рассчитывает средний дневной заработок и умножает его на оплачиваемые дни ОТ. Обычные выходные внутри отпуска учитываются, официальные праздники исключаются. При недостатке истории оценка не показывается."],
    paymentCountdownValue: ["Ближайшая выплата", "Счётчик показывает время до ближайшей плановой даты выплаты: 25-го числа — аванс, 10-го следующего месяца — остаток. Если дата выпадает на выходной или праздник, сайт переносит её на предыдущий рабочий день. Это календарный ориентир, а не информация о фактическом банковском переводе."],
  };
  const entry = descriptions[id];
  if (!entry) return null;
  let detail = "";
  if (c) {
    const oklad = c.effectiveOkladSnapshot;
    const rate = oklad / c.monthNorm;
    const amounts = {
      hourRateNet: `${rub(oklad)} ÷ ${number(c.monthNorm)} ч × 1,35 × 0,87 = ${rub(c.hourRateNet)} за час.`,
      nightHourNet: `${rub(c.hourRateNet)} + ${rub(rate * 0.4 * 0.87)} = ${rub(c.nightHourNet)} за час.`,
      baseFactGross: `${rub(oklad)} ÷ ${number(c.monthNorm)} ч × ${number(c.workedHours)} ч × 0,87 = ${rub(c.baseFactGross * 0.87)}.`,
      bonusGross: `${rub(c.baseFactGross)} × 35% × 0,87 = ${rub(c.bonusGross * 0.87)}.`,
      nightExtraGross: `${rub(rate)} × ${number(c.workedNightHours)} ночных ч × 40% × 0,87 = ${rub(c.nightExtraGross * 0.87)}.`,
      holidayExtraGross: `${number(context.holiday?.hDay ?? 0)} дневных и ${number(context.holiday?.hNight ?? 0)} ночных праздничных часов. Доплата после налога: ${rub(c.holidayExtraGross * 0.87)}.`,
      grossPay: `Оклад: ${rub(c.baseFactGross * 0.87)}; премия: ${rub(c.bonusGross * 0.87)}; ночные: ${rub(c.nightExtraGross * 0.87)}; праздники: ${rub(c.holidayExtraGross * 0.87)}. Всего: ${rub(c.net)}.`,
      taxPay: `${rub(c.gross)} × 13% = ${rub(c.tax)}.`,
      advancePay: `С 1-го по 15-е: ${number(context.firstHalfDay)} дневных и ${number(context.firstHalfNight)} ночных часов. Расчётный аванс: ${rub(c.advance)}.`,
      remainingPay: `${rub(c.net)} − ${rub(c.advance)} = ${rub(c.remaining)}.`,
    };
    detail = amounts[id] || "";
    if (detail && c.hazardRate > 0) detail += ` В используемом окладе учтена вредность ${number(c.hazardRate * 100)}%.`;
  } else if (!["vacationPayEstimate", "paymentCountdownValue"].includes(id)) {
    detail = "Для примера расчёта заполните оклад и часы табеля.";
  }
  if (["advancePay", "remainingPay"].includes(id) && !context.draft) {
    detail += " Если внесены подтверждённые фактические суммы, карточка показывает их; приведённый здесь расчёт остаётся прогнозом.";
  }
  return { title: entry[0], message: entry[1], detail };
}

export function setupPaymentExplanations({ getContext, ensureAccess }) {
  let opening = false;
  for (const card of document.querySelectorAll(".pay-metrics-grid > div")) {
    const value = card.querySelector("[id]");
    if (!value || !explainPayment(value.id)) continue;
    card.classList.add("payment-explained");
    card.removeAttribute("title");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "payment-help";
    button.textContent = "?";
    button.setAttribute("aria-label", `Как считается: ${explainPayment(value.id).title}`);
    button.addEventListener("click", async () => {
      if (opening) return;
      opening = true;
      try {
        if (!(await ensureAccess())) return;
        const explanation = explainPayment(value.id, getContext());
        const dialog = document.createElement("dialog");
        dialog.className = "payment-explanation-dialog";
        const header = document.createElement("header");
        const title = document.createElement("h2");
        title.id = "paymentExplanationTitle";
        title.textContent = explanation.title;
        dialog.setAttribute("aria-labelledby", title.id);
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "×";
        close.setAttribute("aria-label", "Закрыть объяснение");
        close.addEventListener("click", () => dialog.close());
        header.append(title, close);
        const body = document.createElement("div");
        body.className = "payment-explanation-body";
        for (const text of [explanation.message, explanation.detail]) {
          if (!text) continue;
          const p = document.createElement("p");
          p.textContent = text;
          body.append(p);
        }
        dialog.append(header, body);
        dialog.addEventListener("close", () => { dialog.remove(); button.focus(); });
        dialog.addEventListener("click", (event) => {
          const rect = dialog.getBoundingClientRect();
          if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
        });
        document.body.append(dialog);
        dialog.showModal();
      } finally { opening = false; }
    });
    card.append(button);
  }
}
