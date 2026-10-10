const AUTOSAVE_DISABLED_KEY = "alvisa:timesheet-autosave-disabled";
const LEAVE_WARNING_KEY = "alvisa:timesheet-leave-warning";

export function isManualSaveWarningEnabled() {
  try {
    return isTimesheetAutosaveDisabled() && localStorage.getItem(LEAVE_WARNING_KEY) !== "0";
  } catch {
    return isTimesheetAutosaveDisabled();
  }
}

export function setManualSaveWarningEnabled(enabled) {
  try {
    localStorage.setItem(LEAVE_WARNING_KEY, enabled ? "1" : "0");
  } catch {
    // Managed browsers may deny local storage access.
  }
}

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
