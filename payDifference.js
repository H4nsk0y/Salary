function finiteMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createDifference(label, actualValue, calculatedValue) {
  const actual = finiteMoney(actualValue);
  const calculated = finiteMoney(calculatedValue);
  if (actual === null || calculated === null) return null;

  const signed = Number((actual - calculated).toFixed(2));
  return {
    label,
    signed,
    amount: Math.abs(signed),
    direction: signed > 0 ? "more" : signed < 0 ? "less" : "equal",
  };
}

export function buildPayDifferenceInsight({ actual, calculated, paidLeaveEstimate = null } = {}) {
  if (!actual || !calculated) return null;

  const mainDifference = createDifference("зарплате за месяц", actual.net, calculated.net);
  const paidLeaveDifference = createDifference(
    "отпускных",
    actual.paidLeaveNet,
    paidLeaveEstimate
  );

  let totalSigned = null;
  if (mainDifference) totalSigned = mainDifference.signed;
  if (paidLeaveDifference) totalSigned = (totalSigned ?? 0) + paidLeaveDifference.signed;
  if (totalSigned === null) return null;

  totalSigned = Number(totalSigned.toFixed(2));

  const components = [
    createDifference("авансе", actual.advance, calculated.advance),
    createDifference("остатке", actual.remaining, calculated.remaining),
    paidLeaveDifference,
  ].filter((item) => item && item.amount >= 1);

  components.sort((left, right) => right.amount - left.amount);

  return {
    signed: totalSigned,
    amount: Math.abs(totalSigned),
    direction: totalSigned > 0 ? "more" : totalSigned < 0 ? "less" : "equal",
    largest: components[0] ?? null,
  };
}
