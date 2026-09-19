const AUTOSAVE_DISABLED_KEY = "alvisa:timesheet-autosave-disabled";

export function isTimesheetAutosaveDisabled() {
  try {
    return localStorage.getItem(AUTOSAVE_DISABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTimesheetAutosaveDisabled(disabled) {
  try {
    localStorage.setItem(AUTOSAVE_DISABLED_KEY, disabled ? "1" : "0");
  } catch {
    // Some private or managed browser modes can deny local storage access.
  }
  window.dispatchEvent(new CustomEvent("alvisa:timesheet-autosave", {
    detail: { disabled: disabled === true },
  }));
}
