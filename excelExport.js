// =========================
// FILE: /excelExport.js
// =========================
const TEMPLATE_SHEET_NAME = "пример";
const TEMPLATE_BLOCK_START_ROW = 9;
const TEMPLATE_BLOCK_HEIGHT = 3;
const DAY_START_COLUMN = "I";
const FIRST_HALF_END_DAY = 15;
const EXPORT_LAST_USED_COLUMN = "BC";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const DOW_SHORT_UPPER = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const DEFAULT_DAY_HOURS = 8;
const FEMALE_DAY_HOURS = 7.2;
const SHORT_DAY_REDUCTION_HOURS = 1;

const POSITION_LABELS = {
  egais_head: "Руководитель Отдела ЕГАИС",
  egais_senior_operator: "Ст.Оператор ЕГАИС",
  egais_operator: "Оператор ЕГАИС",
  warehouse_head: "Руководитель склада",
  storekeeper: "Кладовщик",
  loader: "Грузчик",
  driver: "Водитель",
  bottling_plant_head: "Руководитель цеха розлива",
  shift_senior_master: "Старший мастер смены",
  shift_master: "Мастер смены",
  filling_line_operator: "Оператор линии розлива",
  accountant: "Учетчик",
  laboratory_head: "Руководитель лаборатории",
  deputy_head_laboratory: "Заместитель руководителя лаборатории",
  entrance_control_engineer: "Инженер входного контроля",
  quality_control_engineer: "Инженер контроля качества",
  chemist: "Химик",
  microbiologist: "Микробиолог",
};

const DEPARTMENT_LABELS = {
  egais: "Отдел Единой государственной автоматизированной информационной системы",
  warehouse: "Склад готовой продукции",
  bottling: "Цех розлива",
  laboratory: "Лаборатория",
};

function assertExcelJs() {
  if (!window.ExcelJS) {
    throw new Error("ExcelJS не подключен. Проверьте script в admin.html.");
  }
}

function columnLetterToNumber(letter) {
  let result = 0;
  const s = String(letter || "").toUpperCase();
  for (let i = 0; i < s.length; i += 1) {
    result = result * 26 + (s.charCodeAt(i) - 64);
  }
  return result;
}

function columnNumberToLetter(num) {
  let n = Number(num);
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function deepClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function parseRange(range) {
  const m = String(range).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) return null;

  return {
    startCol: columnLetterToNumber(m[1]),
    startRow: Number(m[2]),
    endCol: columnLetterToNumber(m[3]),
    endRow: Number(m[4]),
  };
}

function formatRange({ startCol, startRow, endCol, endRow }) {
  return `${columnNumberToLetter(startCol)}${startRow}:${columnNumberToLetter(endCol)}${endRow}`;
}

function rangeIntersectsRows(range, rowStart, rowEnd) {
  const parsed = parseRange(range);
  if (!parsed) return false;
  return parsed.endRow >= rowStart && parsed.startRow <= rowEnd;
}

function getTemplateMergedRanges(worksheet, rowStart, rowEnd) {
  const merges = Array.isArray(worksheet.model?.merges) ? worksheet.model.merges : [];
  return merges.filter((range) => rangeIntersectsRows(range, rowStart, rowEnd));
}

function cloneTemplateBlock(worksheet, templateBlock, targetStartRow) {
  const rowOffset = targetStartRow - templateBlock.startRow;

  for (let rowIndex = 0; rowIndex < templateBlock.rows.length; rowIndex += 1) {
    const sourceRowData = templateBlock.rows[rowIndex];
    const targetRow = worksheet.getRow(targetStartRow + rowIndex);

    targetRow.height = sourceRowData.height;

    for (const cellData of sourceRowData.cells) {
      const cell = worksheet.getCell(targetStartRow + rowIndex, cellData.col);
      cell.value = deepClone(cellData.value);
      cell.style = deepClone(cellData.style) || {};
      cell.numFmt = cellData.numFmt || cell.numFmt;
      cell.font = deepClone(cellData.font);
      cell.alignment = deepClone(cellData.alignment);
      cell.border = deepClone(cellData.border);
      cell.fill = deepClone(cellData.fill);
      cell.protection = deepClone(cellData.protection);
    }
  }

  for (const mergeRange of templateBlock.merges) {
    const parsed = parseRange(mergeRange);
    if (!parsed) continue;

    worksheet.mergeCells(
      formatRange({
        startCol: parsed.startCol,
        endCol: parsed.endCol,
        startRow: parsed.startRow + rowOffset,
        endRow: parsed.endRow + rowOffset,
      })
    );
  }
}

function captureTemplateBlock(worksheet, startRow, endRow) {
  const rows = [];

  for (let row = startRow; row <= endRow; row += 1) {
    const rowObj = worksheet.getRow(row);
    const cells = [];

    for (let col = 1; col <= worksheet.columnCount; col += 1) {
      const cell = worksheet.getCell(row, col);
      cells.push({
        col,
        value: deepClone(cell.value),
        style: deepClone(cell.style) || {},
        numFmt: cell.numFmt,
        font: deepClone(cell.font),
        alignment: deepClone(cell.alignment),
        border: deepClone(cell.border),
        fill: deepClone(cell.fill),
        protection: deepClone(cell.protection),
      });
    }

    rows.push({
      height: rowObj.height,
      cells,
    });
  }

  return {
    startRow,
    endRow,
    rows,
    merges: getTemplateMergedRanges(worksheet, startRow, endRow),
  };
}

function clearMergedRangesFromRow(worksheet, rowStart) {
  const merges = Array.isArray(worksheet.model?.merges) ? [...worksheet.model.merges] : [];
  for (const range of merges) {
    const parsed = parseRange(range);
    if (!parsed) continue;
    if (parsed.startRow >= rowStart || parsed.endRow >= rowStart) {
      worksheet.unMergeCells(range);
    }
  }
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sumRange(arr, startIdx, endIdxInclusive) {
  let total = 0;
  for (let i = startIdx; i <= endIdxInclusive; i += 1) {
    total += safeNum(arr?.[i]);
  }
  return total;
}

function normalizeLeaveTypeLegacy(lt) {
  if (!lt) return null;
  if (lt === "vacation") return "vac_paid";
  if (lt === "sick") return "sick";
  return String(lt);
}

function leaveTypeToCode(lt) {
  const t = normalizeLeaveTypeLegacy(lt);
  if (!t) return "";
  if (t === "vac_paid") return "ОТ";
  if (t === "vac_unpaid") return "ОД";
  if (t === "vac_unpaid_required") return "ОЗ";
  if (t === "edu_paid") return "У";
  if (t === "edu_unpaid") return "УД";
  if (t === "sick") return "Б";
  return "";
}

function getPositionLabel(position) {
  const key = String(position ?? "").trim();
  return POSITION_LABELS[key] || key || "";
}

function getDepartmentLabel(department) {
  const key = String(department?.key ?? "").trim();
  return DEPARTMENT_LABELS[key] || String(department?.name ?? "").trim() || "";
}

function getGenderLabel(gender) {
  if (gender === "male") return "Мужской";
  if (gender === "female") return "Женский";
  return "";
}

function getBaseDayHours(gender) {
  return gender === "female" ? FEMALE_DAY_HOURS : DEFAULT_DAY_HOURS;
}

function isWeekendByIndex(year, month, dayIndex0) {
  const day = new Date(year, month, dayIndex0 + 1).getDay();
  return day === 0 || day === 6;
}

function calendarNormForRange({
  year,
  month,
  startDayIndex,
  endDayIndex,
  baseDayHours,
  sharedHoliday,
  sharedTransferredOff,
  sharedShortDay,
}) {
  let weekdays = 0;
  let holidayWeekdays = 0;
  let transferredWeekdays = 0;
  let shortWeekdays = 0;

  for (let i = startDayIndex; i <= endDayIndex; i += 1) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays += 1;

    if (sharedHoliday[i]) holidayWeekdays += 1;
    else if (sharedTransferredOff[i]) transferredWeekdays += 1;
    else if (sharedShortDay[i]) shortWeekdays += 1;
  }

  return (
    weekdays * baseDayHours -
    holidayWeekdays * baseDayHours -
    transferredWeekdays * baseDayHours -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS
  );
}

function leaveDaysForRange({
  startDayIndex,
  endDayIndex,
  leaveType,
  sharedHoliday,
  sharedTransferredOff,
}) {
  let total = 0;

  for (let i = startDayIndex; i <= endDayIndex; i += 1) {
    const lt = normalizeLeaveTypeLegacy(leaveType?.[i]);
    if (!lt) continue;
    if (sharedHoliday[i] || sharedTransferredOff[i]) continue;
    total += 1;
  }

  return total;
}

function buildExportStats({
  state,
  year,
  month,
  daysInMonth,
  sharedHoliday,
  sharedTransferredOff,
  sharedShortDay,
}) {
  const endMonthIdx = daysInMonth - 1;
  const endHalfIdx = Math.min(FIRST_HALF_END_DAY - 1, endMonthIdx);
  const baseDayHours = getBaseDayHours(state.gender);

  const monthNormCalendar = calendarNormForRange({
    year,
    month,
    startDayIndex: 0,
    endDayIndex: endMonthIdx,
    baseDayHours,
    sharedHoliday,
    sharedTransferredOff,
    sharedShortDay,
  });

  const firstHalfNormCalendar = calendarNormForRange({
    year,
    month,
    startDayIndex: 0,
    endDayIndex: endHalfIdx,
    baseDayHours,
    sharedHoliday,
    sharedTransferredOff,
    sharedShortDay,
  });

  const monthLeaveDays = leaveDaysForRange({
    startDayIndex: 0,
    endDayIndex: endMonthIdx,
    leaveType: state.leaveType,
    sharedHoliday,
    sharedTransferredOff,
  });

  const firstHalfLeaveDays = leaveDaysForRange({
    startDayIndex: 0,
    endDayIndex: endHalfIdx,
    leaveType: state.leaveType,
    sharedHoliday,
    sharedTransferredOff,
  });

  const monthPersonalNorm = monthNormCalendar - monthLeaveDays * baseDayHours;
  const firstHalfPersonalNorm = firstHalfNormCalendar - firstHalfLeaveDays * baseDayHours;

  const monthDayHours = sumRange(state.dayHours, 0, endMonthIdx);
  const monthNightHours = sumRange(state.nightHours, 0, endMonthIdx);
  const firstHalfDayHours = sumRange(state.dayHours, 0, endHalfIdx);
  const firstHalfNightHours = sumRange(state.nightHours, 0, endHalfIdx);

  let monthAttendanceDays = 0;
  let firstHalfAttendanceDays = 0;

  for (let i = 0; i <= endMonthIdx; i += 1) {
    const total = safeNum(state.dayHours?.[i]) + safeNum(state.nightHours?.[i]);
    if (total > 0) {
      monthAttendanceDays += 1;
      if (i <= endHalfIdx) firstHalfAttendanceDays += 1;
    }
  }

  return {
    firstHalf: {
      days: firstHalfAttendanceDays,
      hours: firstHalfDayHours + firstHalfNightHours,
      dayHours: firstHalfDayHours,
      nightHours: firstHalfNightHours,
      norm: firstHalfPersonalNorm,
      overtime: firstHalfDayHours + firstHalfNightHours - firstHalfPersonalNorm,
    },
    month: {
      days: monthAttendanceDays,
      hours: monthDayHours + monthNightHours,
      dayHours: monthDayHours,
      nightHours: monthNightHours,
      norm: monthPersonalNorm,
      overtime: monthDayHours + monthNightHours - monthPersonalNorm,
    },
  };
}

function getDayCode(state, index) {
  const leaveCode = leaveTypeToCode(state.leaveType?.[index]);
  if (leaveCode) return leaveCode;

  const total = safeNum(state.dayHours?.[index]) + safeNum(state.nightHours?.[index]);
  if (total > 0) return "Я";

  return "";
}

function formatDayHeaderDate(year, month, day) {
  const yy = String(year).slice(-2);
  return `${day}.${month + 1}.${yy}`;
}

function setDynamicBlockCellsEmpty(worksheet, startRow, endRow) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = 2; col <= worksheet.columnCount; col += 1) {
      const address = `${columnNumberToLetter(col)}${row}`;

      if (
        address === `H${startRow}` ||
        address === `H${startRow + 1}` ||
        address === `H${startRow + 2}`
      ) {
        continue;
      }

      worksheet.getCell(row, col).value = null;
    }
  }
}

function fillDayHeaders(worksheet, year, month, maxTemplateDays, daysInMonth) {
  const startCol = columnLetterToNumber(DAY_START_COLUMN);

  for (let offset = 0; offset < maxTemplateDays; offset += 1) {
    const col = columnNumberToLetter(startCol + offset);
    const day = offset + 1;

    if (day <= daysInMonth) {
      const date = new Date(year, month, day);
      worksheet.getCell(`${col}7`).value = DOW_SHORT_UPPER[date.getDay()];
      worksheet.getCell(`${col}8`).value = formatDayHeaderDate(year, month, day);
    } else {
      worksheet.getCell(`${col}7`).value = null;
      worksheet.getCell(`${col}8`).value = null;
    }
  }
}

function downloadBuffer(buffer, fileName) {
  const blob = new Blob(
    [buffer],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function removeRowsAfter(worksheet, lastUsedRow) {
  const maxRow = worksheet.rowCount || worksheet.actualRowCount || 0;
  const extraCount = maxRow - lastUsedRow;

  if (extraCount > 0) {
    worksheet.spliceRows(lastUsedRow + 1, extraCount);
  }
}

function clearCellsAfterRow(worksheet, rowStart) {
  const maxRow = worksheet.rowCount || 0;
  const maxCol = worksheet.columnCount || 0;

  for (let row = rowStart; row <= maxRow; row += 1) {
    for (let col = 1; col <= maxCol; col += 1) {
      worksheet.getCell(row, col).value = null;
    }
  }
}

function setPrintAreaToUsedTable(worksheet, lastRow) {
  worksheet.pageSetup = worksheet.pageSetup || {};
  worksheet.pageSetup.printArea = `B1:${EXPORT_LAST_USED_COLUMN}${lastRow}`;
  worksheet.pageSetup.fitToPage = true;
  worksheet.pageSetup.fitToWidth = 1;
  worksheet.pageSetup.fitToHeight = 0;
}

function clearColumnRange(worksheet, startColumn, endColumn, rowStart, rowEnd) {
  const startCol = columnLetterToNumber(startColumn);
  const endCol = columnLetterToNumber(endColumn);

  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      worksheet.getCell(row, col).value = null;
    }
  }
}

export async function exportDepartmentTimesheetXlsx({
  year,
  month,
  department,
  states,
  sharedHoliday,
  sharedTransferredOff,
  sharedShortDay,
  templateUrl = "/templates/tabel-template.xlsx",
}) {
  assertExcelJs();

  const list = Array.isArray(states) ? states : [];
  if (!list.length) {
    throw new Error("Нет сотрудников для выгрузки.");
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const response = await fetch(templateUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Не удалось загрузить Excel-шаблон. Проверьте путь templateUrl.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.getWorksheet(TEMPLATE_SHEET_NAME);
  if (!worksheet) {
    throw new Error(`В шаблоне не найден лист "${TEMPLATE_SHEET_NAME}".`);
  }

  const templateBlock = captureTemplateBlock(
    worksheet,
    TEMPLATE_BLOCK_START_ROW,
    TEMPLATE_BLOCK_START_ROW + TEMPLATE_BLOCK_HEIGHT - 1
  );

  const dayStartCol = columnLetterToNumber(DAY_START_COLUMN);
  const firstHalfStartCol = columnLetterToNumber("AM");
  const maxTemplateDays = firstHalfStartCol - dayStartCol;

  if (daysInMonth > maxTemplateDays) {
    throw new Error(
      `Текущий шаблон поддерживает только ${maxTemplateDays} дней. Для месяца ${month + 1}.${year} нужен другой шаблон.`
    );
  }

  worksheet.getCell("D5").value = MONTH_NAMES[month];
  fillDayHeaders(worksheet, year, month, maxTemplateDays, daysInMonth);

  clearMergedRangesFromRow(worksheet, TEMPLATE_BLOCK_START_ROW);

  const removeCount = Math.max(0, worksheet.rowCount - TEMPLATE_BLOCK_START_ROW + 1);
  if (removeCount > 0) {
    worksheet.spliceRows(TEMPLATE_BLOCK_START_ROW, removeCount);
  }

  worksheet.spliceRows(
    TEMPLATE_BLOCK_START_ROW,
    0,
    ...Array.from({ length: list.length * TEMPLATE_BLOCK_HEIGHT }, () => [])
  );

  const departmentLabel = getDepartmentLabel(department);

  const summaryCols = {
    firstHalf: {
      days: "AM",
      hours: "AN",
      dayHours: "AO",
      nightHours: "AP",
      norm: "AQ",
      avgNorm: "AR",
      overtime: "AS",
      avgOvertime: "AT",
    },
    month: {
      days: "AU",
      hours: "AV",
      dayHours: "AW",
      nightHours: "AX",
      norm: "AY",
      avgNorm: "AZ",
      overtime: "BA",
      avgOvertime: "BB",
    },
    comment: "BC",
  };

  for (let idx = 0; idx < list.length; idx += 1) {
    const state = list[idx];
    const blockStartRow = TEMPLATE_BLOCK_START_ROW + idx * TEMPLATE_BLOCK_HEIGHT;

    cloneTemplateBlock(worksheet, templateBlock, blockStartRow);
    setDynamicBlockCellsEmpty(worksheet, blockStartRow, blockStartRow + 2);

    const rowCode = blockStartRow;
    const rowDay = blockStartRow + 1;
    const rowNight = blockStartRow + 2;

    worksheet.getCell(`B${rowCode}`).value = idx + 1;
    worksheet.getCell(`C${rowCode}`).value = state.name || "";
    worksheet.getCell(`D${rowCode}`).value = state.tabNumber || "";
    worksheet.getCell(`E${rowCode}`).value = getPositionLabel(state.position);
    worksheet.getCell(`F${rowCode}`).value = departmentLabel;
    worksheet.getCell(`G${rowCode}`).value = getGenderLabel(state.gender);

    for (let dayIndex = 0; dayIndex < maxTemplateDays; dayIndex += 1) {
      const col = columnNumberToLetter(dayStartCol + dayIndex);

      if (dayIndex < daysInMonth) {
        const code = getDayCode(state, dayIndex);
        const dayHours = safeNum(state.dayHours?.[dayIndex]);
        const nightHours = safeNum(state.nightHours?.[dayIndex]);

        worksheet.getCell(`${col}${rowCode}`).value = code || null;
        worksheet.getCell(`${col}${rowDay}`).value = dayHours > 0 ? dayHours : null;
        worksheet.getCell(`${col}${rowNight}`).value = nightHours > 0 ? nightHours : null;
      } else {
        worksheet.getCell(`${col}${rowCode}`).value = null;
        worksheet.getCell(`${col}${rowDay}`).value = null;
        worksheet.getCell(`${col}${rowNight}`).value = null;
      }
    }

    const stats = buildExportStats({
      state,
      year,
      month,
      daysInMonth,
      sharedHoliday,
      sharedTransferredOff,
      sharedShortDay,
    });

    worksheet.getCell(`${summaryCols.firstHalf.days}${rowCode}`).value = stats.firstHalf.days || null;
    worksheet.getCell(`${summaryCols.firstHalf.hours}${rowCode}`).value = stats.firstHalf.hours || null;
    worksheet.getCell(`${summaryCols.firstHalf.dayHours}${rowCode}`).value = stats.firstHalf.dayHours || null;
    worksheet.getCell(`${summaryCols.firstHalf.nightHours}${rowCode}`).value = stats.firstHalf.nightHours || null;
    worksheet.getCell(`${summaryCols.firstHalf.norm}${rowCode}`).value = stats.firstHalf.norm || null;
    worksheet.getCell(`${summaryCols.firstHalf.avgNorm}${rowCode}`).value = null;
    worksheet.getCell(`${summaryCols.firstHalf.overtime}${rowCode}`).value = stats.firstHalf.overtime || null;
    worksheet.getCell(`${summaryCols.firstHalf.avgOvertime}${rowCode}`).value = null;

    worksheet.getCell(`${summaryCols.month.days}${rowCode}`).value = stats.month.days || null;
    worksheet.getCell(`${summaryCols.month.hours}${rowCode}`).value = stats.month.hours || null;
    worksheet.getCell(`${summaryCols.month.dayHours}${rowCode}`).value = stats.month.dayHours || null;
    worksheet.getCell(`${summaryCols.month.nightHours}${rowCode}`).value = stats.month.nightHours || null;
    worksheet.getCell(`${summaryCols.month.norm}${rowCode}`).value = stats.month.norm || null;
    worksheet.getCell(`${summaryCols.month.avgNorm}${rowCode}`).value = null;
    worksheet.getCell(`${summaryCols.month.overtime}${rowCode}`).value = stats.month.overtime || null;
    worksheet.getCell(`${summaryCols.month.avgOvertime}${rowCode}`).value = null;

    worksheet.getCell(`${summaryCols.comment}${rowCode}`).value = null;
  }

  const lastDataRow = TEMPLATE_BLOCK_START_ROW + list.length * TEMPLATE_BLOCK_HEIGHT - 1;

  clearColumnRange(worksheet, "BD", "BF", TEMPLATE_BLOCK_START_ROW, lastDataRow);
  clearCellsAfterRow(worksheet, lastDataRow + 1);
  removeRowsAfter(worksheet, lastDataRow);
  setPrintAreaToUsedTable(worksheet, lastDataRow);

  const fileDepartment = String(department?.key || "department").trim() || "department";
  const fileMonth = String(month + 1).padStart(2, "0");
  const fileName = `tabel_${fileDepartment}_${year}_${fileMonth}.xlsx`;

  const outBuffer = await workbook.xlsx.writeBuffer();
  downloadBuffer(outBuffer, fileName);
}