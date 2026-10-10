import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../js/settings.js", import.meta.url), "utf8");
function setup({ approved = true, fail = false } = {}) {
  const elements = new Map();
  const patches = [];
  const localChanges = [];
  const context = vm.createContext({
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
      });
      return elements.get(id);
    } },
    window: { addEventListener() {} },
    confirmDialog: async () => approved,
    updateMyProfileFields: async (patch) => {
      if (fail) throw new Error("offline");
      patches.push(patch);
    },
    setTimesheetAutosaveDisabled: (value) => localChanges.push(["autosave", value]),
    setManualSaveWarningEnabled: (value) => localChanges.push(["warning", value]),
    isTimesheetAutosaveDisabled: () => false,
    isManualSaveWarningEnabled: () => false,
    setScreenWakeEnabled: async (value) => {
      localChanges.push(["wake", value]);
      return { enabled: value, supported: true, active: false };
    },
    setUiStatus() {},
  });
  const code = source.slice(0, source.lastIndexOf("(async () => {"))
    .replace(/import\s+[\s\S]*?from\s+"[^"]+";/g, "")
    .replace(/import\s+"[^"]+";/g, "");
  vm.runInContext(code, context);
  vm.runInContext(`canUseEgaisFileReminders = true;
    currentSettings = { ...currentSettings, hide_money: true, money_pin_hash: 'test-hash', money_pin_salt: 'test-salt', hide_calculator_nav: true };
    pendingSettings = cloneSettings(currentSettings);`, context);
  return { context, patches, localChanges, elements };
}

test("reset only updates preferences, preserving PIN and push subscriptions", async () => {
  const { context, patches, localChanges } = setup();
  await context.resetSettings();
  assert.deepEqual(JSON.parse(JSON.stringify(patches)), [{
    auto_collapse_table_panels: false, hide_calculator_nav: false,
    egais_file_reminders_enabled: false,
  }]);
  assert.equal(vm.runInContext("currentSettings.money_pin_hash", context), "test-hash");
  assert.equal(vm.runInContext("currentSettings.hide_money", context), true);
  assert.deepEqual(localChanges, [["autosave", false], ["warning", true], ["wake", false]]);
});

test("cancelled or failed server reset leaves local settings unchanged", async () => {
  for (const options of [{ approved: false }, { fail: true }]) {
    const { context, patches, localChanges } = setup(options);
    await context.resetSettings();
    assert.equal(patches.length, 0);
    assert.equal(localChanges.length, 0);
    assert.equal(vm.runInContext("currentSettings.hide_calculator_nav", context), true);
  }
});
