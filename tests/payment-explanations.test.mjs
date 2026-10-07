import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { explainPayment } from "../js/features/paymentExplanations.js";
import { computeSalary, computePaymentSplit } from "../js/calc.js";

test("payment explanations reflect the calculation rather than confirmed actual payments", () => {
  const { result } = computeSalary({ oklad: 50000, normHours: 160, workedHours: 168, nightHours: 40 });
  const split = computePaymentSplit({ netTotal: result.net, effectiveOklad: 50000, monthNorm: 160, firstHalfDayHours: 60, firstHalfNightHours: 20 });
  const calculated = { ...split, ...result, effectiveOkladSnapshot: 50000, monthNorm: 160,
    workedHours: 168, workedNightHours: 40, hourRateNet: result.hourRate,
    nightHourNet: result.hourRate + 312.5 * 0.4 * 0.87,
    baseFactGross: result.baseFact, bonusGross: result.bonus, nightExtraGross: result.nightExtra, holidayExtraGross: 0 };
  const context = { calculated, firstHalfDay: 60, firstHalfNight: 20 };
  assert.match(explainPayment("hourRateNet", context).detail, /367,03/);
  assert.match(explainPayment("nightHourNet", context).detail, /475,78/);
  assert.match(explainPayment("advancePay", context).detail, /60 дневных и 20 ночных/);
  assert.match(explainPayment("remainingPay", context).detail, /прогнозом/);
  assert.doesNotMatch(explainPayment("remainingPay", { ...context, draft: true }).detail, /подтверждённые/);
});

test("every payment card has an explanation and incomplete data stays meaningful", () => {
  const html = readFileSync(new URL("../table.html", import.meta.url), "utf8");
  for (const id of ["hourRateNet", "nightHourNet", "holidayExtraGross", "baseFactGross", "bonusGross", "nightExtraGross", "grossPay", "taxPay", "advancePay", "remainingPay", "vacationPayEstimate", "paymentCountdownValue"]) {
    assert.ok(html.includes(`id="${id}"`));
    assert.ok(explainPayment(id)?.message);
  }
  assert.match(explainPayment("hourRateNet").detail, /заполните оклад/);
  assert.equal(explainPayment("unknown"), null);
  assert.match(explainPayment("holidayExtraGross").message, /с остатком, а не с авансом/);
});

test("draft save and autosave return before any database write or save timer", async () => {
  const source = readFileSync(new URL("../js/table.js", import.meta.url), "utf8");
  const save = source.slice(source.indexOf("async function saveTimesheetNow()"), source.indexOf("function scheduleSave()"));
  const schedule = source.slice(source.indexOf("function scheduleSave()"), source.indexOf("function resetTableDom()"));
  const statuses = [];
  const fail = () => { throw new Error("Draft tried to save"); };
  const context = vm.createContext({ isDraftMode: true, dirty: true,
    setSaveStatus: (text) => statuses.push(text), saveTimesheet: fail,
    saveMyTimesheetActual: fail, markDirty: fail, setTimeout: fail });
  vm.runInContext(`${save}\n${schedule}`, context);
  assert.equal(await context.saveTimesheetNow(), true);
  context.scheduleSave();
  assert.equal(context.dirty, false);
  assert.equal(statuses.length, 2);
});
