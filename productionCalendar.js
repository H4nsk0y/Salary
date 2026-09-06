const CHATEAU_ALVISA_BRANCH = "chateau_alvisa";
const STANDARD_CACHE_PREFIX = "alvisa_prodcal_v2";

// Verified against GdeRabota's 2026 production calendar for the Republic of Dagestan on 2026-09-06.
const DAGESTAN_2026_SPECIAL_DAYS = Object.freeze({
  "2026-01-01": "holiday", "2026-01-02": "holiday", "2026-01-03": "holiday",
  "2026-01-04": "holiday", "2026-01-05": "holiday", "2026-01-06": "holiday",
  "2026-01-07": "holiday", "2026-01-08": "holiday", "2026-01-09": "transferred",
  "2026-02-23": "holiday", "2026-03-08": "holiday", "2026-03-09": "transferred",
  "2026-03-18": "short", "2026-03-19": "holiday", "2026-03-20": "holiday",
  "2026-04-13": "holiday", "2026-04-20": "short", "2026-04-21": "holiday",
  "2026-04-30": "short", "2026-05-01": "holiday", "2026-05-08": "short",
  "2026-05-09": "holiday", "2026-05-11": "transferred", "2026-05-26": "short",
  "2026-05-27": "holiday", "2026-05-28": "holiday", "2026-05-29": "holiday",
  "2026-06-11": "short", "2026-06-12": "holiday", "2026-07-26": "holiday",
  "2026-07-27": "transferred", "2026-09-14": "short", "2026-09-15": "holiday",
  "2026-11-03": "short", "2026-11-04": "holiday", "2026-12-31": "transferred",
});

function monthLength(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function emptyMarks(year, month) {
  const length = monthLength(year, month);
  return {
    isHoliday: new Array(length).fill(false),
    isTransferredOff: new Array(length).fill(false),
    isShortDay: new Array(length).fill(false),
  };
}

function weekendFallback(year, month) {
  const length = monthLength(year, month);
  return Array.from({ length }, (_, index) => {
    const day = new Date(year, month, index + 1).getDay();
    return day === 0 || day === 6 ? 1 : 0;
  });
}

export function parseIsDayOffMonth(text, expectedLength) {
  const source = String(text ?? "").trim();
  if (source.length < expectedLength) return null;

  const result = Array.from(source.slice(0, expectedLength), (char) => Number(char));
  return result.every(Number.isInteger) ? result : null;
}

function marksFromIsDayOff(codes, year, month) {
  const marks = emptyMarks(year, month);

  codes.forEach((code, index) => {
    if (code === 8) marks.isHoliday[index] = true;
    else if (code === 2) marks.isShortDay[index] = true;
    else if (code === 1) {
      const day = new Date(year, month, index + 1).getDay();
      if (day !== 0 && day !== 6) marks.isTransferredOff[index] = true;
    }
  });

  return marks;
}

function getDagestan2026Month(year, month) {
  const marks = emptyMarks(year, month);

  for (let day = 1; day <= marks.isHoliday.length; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const type = DAGESTAN_2026_SPECIAL_DAYS[date];
    if (type === "holiday") marks.isHoliday[day - 1] = true;
    else if (type === "transferred") marks.isTransferredOff[day - 1] = true;
    else if (type === "short") marks.isShortDay[day - 1] = true;
  }

  return {
    ...marks,
    codes: Array.from({ length: marks.isHoliday.length }, (_, index) => {
      if (marks.isHoliday[index]) return 8;
      if (marks.isShortDay[index]) return 2;
      if (marks.isTransferredOff[index]) return 1;
      const day = new Date(year, month, index + 1).getDay();
      return day === 0 || day === 6 ? 1 : 0;
    }),
    version: "gderabota-dagestan-2026-v1",
    source: "gderabota-dagestan",
  };
}

async function getStandardMonth(year, month) {
  const length = monthLength(year, month);
  const key = `${STANDARD_CACHE_PREFIX}_${year}_${String(month + 1).padStart(2, "0")}`;
  let codes = null;

  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (Array.isArray(cached?.data) && cached.data.length === length) codes = cached.data;
  } catch {}

  if (!codes) {
    const mm = String(month + 1).padStart(2, "0");
    try {
      const response = await fetch(`https://isdayoff.ru/api/getdata?year=${year}&month=${mm}&pre=1&holiday=1`);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      codes = parseIsDayOffMonth(await response.text(), length);
      if (!codes) throw new Error("BAD_PRODUCTION_CALENDAR_DATA");
      try {
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: codes }));
      } catch {}
    } catch {
      codes = weekendFallback(year, month);
    }
  }

  return {
    ...marksFromIsDayOff(codes, year, month),
    codes,
    version: `isdayoff-${year}-${String(month + 1).padStart(2, "0")}-v1`,
    source: "isdayoff",
  };
}

export async function getProductionCalendarMonth(year, month, { branch = null } = {}) {
  if (branch === CHATEAU_ALVISA_BRANCH && year === 2026) {
    return getDagestan2026Month(year, month);
  }
  return getStandardMonth(year, month);
}

export function shouldApplyProductionCalendar(payload, calendar) {
  return Boolean(calendar?.version && payload?.productionCalendarVersion !== calendar.version);
}

export function mergeProductionCalendarDefaults(payload, calendar) {
  if (!payload || !shouldApplyProductionCalendar(payload, calendar)) return payload;
  return {
    ...payload,
    isHoliday: calendar.isHoliday.map(Boolean),
    isTransferredOff: calendar.isTransferredOff.map(Boolean),
    isShortDay: calendar.isShortDay.map(Boolean),
    productionCalendarVersion: calendar.version,
  };
}
