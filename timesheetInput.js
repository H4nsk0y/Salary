export function hardenTimesheetInput(input) {
  if (!input) return input;
  input.autocomplete = "off";
  input.setAttribute("data-lpignore", "true");
  input.setAttribute("data-1p-ignore", "true");
  input.setAttribute("data-form-type", "other");
  input.setAttribute("aria-autocomplete", "none");
  return input;
}

export function rejectUnexpectedTimesheetAutofill(input) {
  if (!input) return false;
  let browserMarkedAutofill = false;
  try {
    browserMarkedAutofill = input.matches(":-webkit-autofill");
  } catch {}
  if (document.activeElement === input && !browserMarkedAutofill) return false;
  const previous = String(input.dataset.prev ?? "");
  if (String(input.value ?? "") === previous) return false;
  input.value = previous;
  return true;
}

export function restoreUnfocusedNumericInput(input, value, activeElement) {
  const numericValue = Number(value);
  if (!input || activeElement === input || !(Number.isFinite(numericValue) && numericValue > 0)) {
    return false;
  }

  input.value = String(numericValue);
  return true;
}
