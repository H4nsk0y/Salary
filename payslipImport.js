const MONTH_INDEX = new Map([
  ["ЯНВАРЬ", 0], ["ФЕВРАЛЬ", 1], ["МАРТ", 2], ["АПРЕЛЬ", 3],
  ["МАЙ", 4], ["ИЮНЬ", 5], ["ИЮЛЬ", 6], ["АВГУСТ", 7],
  ["СЕНТЯБРЬ", 8], ["ОКТЯБРЬ", 9], ["НОЯБРЬ", 10], ["ДЕКАБРЬ", 11],
]);

const MONEY_PATTERN = /-?\d{1,3}(?:[\s\u00a0]\d{3})*(?:[,.]\d{2})|-?\d+[,.]\d{2}/g;

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function parseMoney(value) {
  const number = Number(String(value || "").replace(/[\s\u00a0]/g, "").replace(",", "."));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function searchable(value) {
  return normalizeText(value).toLocaleUpperCase("ru-RU").replace(/Ё/g, "Е");
}

function lineAmount(line) {
  const matches = normalizeText(line).match(MONEY_PATTERN) || [];
  return matches.length ? parseMoney(matches[matches.length - 1]) : null;
}

function findAmount(lines, label) {
  const normalizedLabel = searchable(label);
  const line = lines.find((item) => searchable(item).includes(normalizedLabel));
  return line ? lineAmount(line) : null;
}

function findFirstAmountAfterLabel(lines, label) {
  const normalizedLabel = searchable(label);
  const line = lines.find((item) => searchable(item).includes(normalizedLabel));
  if (!line) return null;
  const upperLine = searchable(line);
  const tail = line.slice(upperLine.indexOf(normalizedLabel) + normalizedLabel.length);
  const match = normalizeText(tail).match(MONEY_PATTERN);
  return match?.length ? parseMoney(match[0]) : null;
}

function sumAmounts(lines, label) {
  const normalizedLabel = searchable(label);
  const values = lines
    .filter((item) => searchable(item).includes(normalizedLabel))
    .map(lineAmount)
    .filter(Number.isFinite);
  return values.length ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(2)) : null;
}

export function parsePayrollSlipText(rawText) {
  const lines = normalizeText(rawText)
    .split(/\n+/)
    .map(normalizeText)
    .filter(Boolean);
  const fullText = lines.join("\n");
  const periodMatch = fullText.match(/РАСЧ[ЕЁ]ТНЫЙ ЛИСТОК ЗА\s+([А-ЯЁ]+)\s+(20\d{2})/i);
  const month = periodMatch ? MONTH_INDEX.get(periodMatch[1].toLocaleUpperCase("ru-RU")) : undefined;
  const year = periodMatch ? Number(periodMatch[2]) : null;

  const result = {
    month: Number.isInteger(month) ? month : null,
    year,
    employee: "",
    accrued: findFirstAmountAfterLabel(lines, "Начислено:"),
    withheld: findAmount(lines, "Удержано:"),
    advance: findAmount(lines, "За первую половину месяца"),
    remaining: findAmount(lines, "Зарплата за месяц"),
    paidLeaveNet: sumAmounts(lines, "Отпуска, межрасчет"),
    paidTotal: findAmount(lines, "Выплачено:"),
    warnings: [],
    errors: [],
  };

  const employeeLine = lines.find((line) => /Сотрудник\s*:/i.test(line));
  if (employeeLine) result.employee = normalizeText(employeeLine.replace(/^.*?Сотрудник\s*:\s*/i, ""));

  if (result.month === null || !Number.isInteger(result.year)) {
    result.errors.push("Не удалось определить месяц и год расчётного листка.");
  }
  if (result.advance === null && result.remaining === null) {
    result.errors.push("Не найдены выплаты «За первую половину месяца» или «Зарплата за месяц».");
  }

  const recognizedPaid = Number(((result.advance || 0) + (result.remaining || 0) + (result.paidLeaveNet || 0)).toFixed(2));
  result.recognizedPaid = recognizedPaid;
  if (result.paidTotal !== null && Math.abs(result.paidTotal - recognizedPaid) > 1) {
    result.errors.push(
      `Сумма найденных выплат (${recognizedPaid.toFixed(2)}) не совпадает с итогом «Выплачено» (${result.paidTotal.toFixed(2)}).`
    );
  }
  if (result.withheld === null) result.warnings.push("Не удалось найти удержанный НДФЛ.");
  if (result.paidLeaveNet === null) result.paidLeaveNet = 0;

  return result;
}

function htmlToText(source) {
  const documentNode = new DOMParser().parseFromString(source, "text/html");
  const tableRows = Array.from(documentNode.querySelectorAll("tr"));
  if (tableRows.length) {
    return tableRows
      .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => normalizeText(cell.textContent)).filter(Boolean).join(" "))
      .filter(Boolean)
      .join("\n");
  }
  return normalizeText(documentNode.body?.textContent || source);
}

function groupPdfText(items) {
  const rows = [];
  for (const item of items) {
    const value = normalizeText(item.str);
    if (!value) continue;
    const x = Number(item.transform?.[4]) || 0;
    const y = Number(item.transform?.[5]) || 0;
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, value });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.value).join(" "))
    .join("\n");
}

async function pdfToText(file) {
  const pdfjs = await import("./vendor/pdfjs/pdf.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.js", import.meta.url).href;
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push(groupPdfText((await page.getTextContent()).items));
  }
  return pages.join("\n");
}

export async function parsePayrollSlipFile(file) {
  if (!file) throw new Error("Файл не выбран.");
  const name = String(file.name || "").toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const isHtml = /html?$/i.test(name) || file.type === "text/html";
  if (!isPdf && !isHtml) throw new Error("Поддерживаются расчётные листки в PDF и HTML.");
  const text = isPdf ? await pdfToText(file) : htmlToText(await file.text());
  return parsePayrollSlipText(text);
}
