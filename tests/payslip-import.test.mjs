import test from "node:test";
import assert from "node:assert/strict";
import { parsePayrollSlipText } from "../payslipImport.js";

test("parses a payroll slip with advance, remainder and intersettlement payment", () => {
  const result = parsePayrollSlipText(`
    РАСЧЕТНЫЙ ЛИСТОК ЗА МАЙ 2025
    Сотрудник: Сотрудник-1
    Начислено: 94 377,96
    Удержано: 12 269,00
    За первую половину месяца 22 220,30
    Зарплата за месяц 41 423,76
    Отпуска, межрасчет 18 464,90
    Выплачено: 82 108,96
  `);
  assert.deepEqual(
    { month: result.month, year: result.year, advance: result.advance, remaining: result.remaining, leave: result.paidLeaveNet },
    { month: 4, year: 2025, advance: 22220.3, remaining: 41423.76, leave: 18464.9 }
  );
  assert.equal(result.errors.length, 0);
});

test("accepts a payroll slip without an advance row", () => {
  const result = parsePayrollSlipText(`
    РАСЧЕТНЫЙ ЛИСТОК ЗА ИЮНЬ 2025
    Начислено: 53 162,12
    Удержано: 6 911,00
    Зарплата за месяц 43 837,32
    Отпуска, межрасчет 2 413,80
    Выплачено: 46 251,12
  `);
  assert.equal(result.advance, null);
  assert.equal(result.remaining, 43837.32);
  assert.equal(result.errors.length, 0);
});

test("blocks an arithmetically inconsistent payroll slip", () => {
  const result = parsePayrollSlipText(`
    РАСЧЕТНЫЙ ЛИСТОК ЗА АПРЕЛЬ 2025
    Удержано: 10 396,00
    За первую половину месяца 26 444,91
    Зарплата за месяц 43 125,84
    Выплачено: 99 999,00
  `);
  assert.match(result.errors.join(" "), /не совпадает/i);
});
