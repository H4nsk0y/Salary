// Personal timesheet rule: pay on the previous working day, including weekends.
export async function resolvePaymentDate(rawDate, isNonWorking) {
  const resolved = new Date(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate());
  for (let guard = 20; guard > 0 && await isNonWorking(resolved); guard -= 1) {
    resolved.setDate(resolved.getDate() - 1);
  }
  return resolved;
}
