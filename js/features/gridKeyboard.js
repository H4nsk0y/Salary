export function shouldNavigateGrid(event, input) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return false;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") return true;
  if (typeof input?.selectionStart !== "number") return true;
  const start = input.selectionStart;
  const end = input.selectionEnd ?? start;
  const length = String(input.value ?? "").length;
  if (start === 0 && end === length) return true;
  return event.key === "ArrowLeft" ? start === 0 && end === 0 : start === length && end === length;
}
