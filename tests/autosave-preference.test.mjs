import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../js/features/autosavePreference.js", import.meta.url), "utf8");

function preferenceContext(storage = new Map()) {
  const context = vm.createContext({
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    window: { dispatchEvent() {} },
    CustomEvent: class {},
  });
  vm.runInContext(source.replaceAll("export function", "function"), context);
  return context;
}

test("leave warnings only apply to manual saving, enabled by default", () => {
  const context = preferenceContext();
  assert.equal(context.isManualSaveWarningEnabled(), false);
  context.setTimesheetAutosaveDisabled(true);
  assert.equal(context.isManualSaveWarningEnabled(), true);
  context.setManualSaveWarningEnabled(false);
  assert.equal(context.isManualSaveWarningEnabled(), false);
  context.setManualSaveWarningEnabled(true);
  context.setTimesheetAutosaveDisabled(false);
  assert.equal(context.isManualSaveWarningEnabled(), false);
});

test("unavailable local storage does not break settings", () => {
  const context = preferenceContext();
  context.localStorage.getItem = () => { throw new Error("denied"); };
  context.localStorage.setItem = () => { throw new Error("denied"); };
  assert.doesNotThrow(() => context.setManualSaveWarningEnabled(true));
  assert.doesNotThrow(() => context.setTimesheetAutosaveDisabled(true));
  assert.equal(context.isManualSaveWarningEnabled(), false);
});
