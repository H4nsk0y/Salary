const DEFAULT_TAX_RATE = 0.13;
const DEFAULT_HOLIDAY_RESERVE_SHARE = 0.5;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Estimates the net part of increased holiday/overtime pay that may be settled
 * at year end. It is an explanatory forecast, not a payroll or legal finding.
 */
export function estimateYearEndReserve(months, {
  taxRate = DEFAULT_TAX_RATE,
  defaultHolidayReserveShare = DEFAULT_HOLIDAY_RESERVE_SHARE,
} = {}) {
  const source = Array.isArray(months) ? months : [];
  const safeTaxRate = clamp(finite(taxRate, DEFAULT_TAX_RATE), 0, 0.99);
  const defaultShare = clamp(finite(defaultHolidayReserveShare, DEFAULT_HOLIDAY_RESERVE_SHARE), 0, 1);

  let yearBalanceHours = 0;
  let holidayHours = 0;
  let holidayExtraNet = 0;
  let weightedHourlyGross = 0;
  let hourlyWeight = 0;
  let calibratedGapNet = 0;
  let calibratedHolidayNet = 0;
  let confirmedHolidayMonths = 0;

  for (const month of source) {
    yearBalanceHours += finite(month?.overtimeBalanceHours) - finite(month?.compensatoryLeaveHours);
    holidayHours += Math.max(0, finite(month?.holidayHours));
    holidayExtraNet += Math.max(0, finite(month?.holidayExtraNet));

    const rate = Math.max(0, finite(month?.overtimeHourlyGross));
    const weight = Math.max(0, finite(month?.workedNonHolidayHours));
    if (rate > 0) {
      const appliedWeight = weight > 0 ? weight : 1;
      weightedHourlyGross += rate * appliedWeight;
      hourlyWeight += appliedWeight;
    }

    const calculatedNet = finite(month?.calculatedNet, Number.NaN);
    const actualNet = finite(month?.actualNet, Number.NaN);
    const monthHolidayExtraNet = Math.max(0, finite(month?.holidayExtraNet));
    if (month?.actualConfirmed && Number.isFinite(calculatedNet) && Number.isFinite(actualNet) && monthHolidayExtraNet > 0) {
      const positiveGap = clamp(calculatedNet - actualNet, 0, monthHolidayExtraNet);
      if (positiveGap > 0) {
        calibratedGapNet += positiveGap;
        calibratedHolidayNet += monthHolidayExtraNet;
        confirmedHolidayMonths += 1;
      }
    }
  }

  const holidayReserveShare = calibratedHolidayNet > 0
    ? clamp(calibratedGapNet / calibratedHolidayNet, 0, 1)
    : defaultShare;
  const holidayReserveNet = holidayExtraNet * holidayReserveShare;

  // Holiday hours already paid at an increased rate cannot also be treated as overtime.
  const overtimeHours = Math.max(0, yearBalanceHours - holidayHours);
  const overtimeHoursOneAndHalf = Math.min(2, overtimeHours);
  const overtimeHoursDouble = Math.max(0, overtimeHours - overtimeHoursOneAndHalf);
  const averageHourlyGross = hourlyWeight > 0 ? weightedHourlyGross / hourlyWeight : 0;
  const overtimeReserveGross = averageHourlyGross
    * (overtimeHoursOneAndHalf * 0.5 + overtimeHoursDouble);
  const overtimeReserveNet = overtimeReserveGross * (1 - safeTaxRate);

  return {
    totalReserveNet: Math.max(0, holidayReserveNet + overtimeReserveNet),
    holidayReserveNet: Math.max(0, holidayReserveNet),
    overtimeReserveNet: Math.max(0, overtimeReserveNet),
    holidayReserveShare,
    holidayHours,
    overtimeHours,
    overtimeHoursOneAndHalf,
    overtimeHoursDouble,
    averageHourlyGross,
    yearBalanceHours,
    confirmedHolidayMonths,
    monthsWithData: source.length,
  };
}

export function buildDecemberForecast({ decemberAutoNet, reserve }) {
  const autoNet = finite(decemberAutoNet, Number.NaN);
  const reserveNet = Math.max(0, finite(reserve?.totalReserveNet));
  return {
    decemberAutoNet: Number.isFinite(autoNet) ? autoNet : null,
    reserveNet,
    expectedNet: Number.isFinite(autoNet) ? autoNet + reserveNet : null,
  };
}
