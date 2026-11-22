const editingIntentByDocument = new WeakMap();

function getKeyboardEditingIntent(ownerDocument) {
  if (editingIntentByDocument.has(ownerDocument)) return editingIntentByDocument.get(ownerDocument);
  const intent = { active: false, timer: 0 };
  ownerDocument.addEventListener("keydown", (event) => {
    if (!event.isTrusted || !["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    intent.active = true;
    clearTimeout(intent.timer);
    intent.timer = setTimeout(() => { intent.active = false; }, 0);
  }, true);
  editingIntentByDocument.set(ownerDocument, intent);
  return intent;
}

export function hardenTimesheetInput(input, { requireEditingIntent = false } = {}) {
  if (!input) return input;
  input.autocomplete = "off";
  input.setAttribute("data-lpignore", "true");
  input.setAttribute("data-1p-ignore", "true");
  input.setAttribute("data-form-type", "other");
  input.setAttribute("aria-autocomplete", "none");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("data-bwignore", "true");
  if (requireEditingIntent) {
    const intent = getKeyboardEditingIntent(input.ownerDocument);
    input.readOnly = true;
    input.addEventListener("pointerdown", (event) => {
      if (event.isTrusted && !input.disabled) input.readOnly = false;
    });
    input.addEventListener("focus", (event) => {
      if (!input.readOnly || intent.active) {
        input.readOnly = false;
        return;
      }
      // Browser-restored focus is not consent to edit or overwrite a saved shift.
      input.value = String(input.dataset.prev ?? "");
      event.stopImmediatePropagation();
      input.blur();
    });
    input.addEventListener("blur", () => { input.readOnly = true; });
  }
  return input;
}

export function rejectUnexpectedTimesheetAutofill(input) {
  if (!input) return false;
  let browserMarkedAutofill = false;
  try {
    browserMarkedAutofill = input.matches(":-webkit-autofill");
  } catch {}
  if (document.activeElement === input && !input.readOnly && !browserMarkedAutofill) return false;
  const previous = String(input.dataset.prev ?? "");
  if (input.readOnly) {
    input.value = previous;
    return true;
  }
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
