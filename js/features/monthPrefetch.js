export function getAdjacentMonthPeriods(year, month) {
  const current = new Date(year, month, 1);
  return [-1, 1].map((offset) => {
    const date = new Date(current.getFullYear(), current.getMonth() + offset, 1);
    return { year: date.getFullYear(), month: date.getMonth() };
  });
}

export function scheduleAdjacentMonthPrefetch(year, month, loader) {
  if (typeof loader !== "function") return () => {};
  let active = true;
  const run = () => {
    if (active) void Promise.allSettled(
      getAdjacentMonthPeriods(year, month).map((period) => Promise.resolve().then(() => loader(period)))
    );
  };
  const idle = typeof globalThis.requestIdleCallback === "function";
  const handle = idle
    ? globalThis.requestIdleCallback(run, { timeout: 1_200 })
    : globalThis.setTimeout(run, 300);
  return () => {
    active = false;
    if (idle) globalThis.cancelIdleCallback?.(handle);
    else globalThis.clearTimeout(handle);
  };
}
