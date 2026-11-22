import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { shouldNavigateGrid } from "../js/features/gridKeyboard.js";

const input = (value, start, end = start) => ({ value, selectionStart: start, selectionEnd: end });
test("whole selected values navigate immediately in either direction", () => {
  for (const value of ['11','7,2','ОТ','']) for (const key of ['ArrowLeft','ArrowRight']) {
    assert.equal(shouldNavigateGrid({ key }, input(value, 0, value.length)), true);
  }
});
test("caret editing and partial selections remain inside the cell until a boundary", () => {
  assert.equal(shouldNavigateGrid({ key: 'ArrowRight' }, input('11',1)), false);
  assert.equal(shouldNavigateGrid({ key: 'ArrowLeft' }, input('11',1)), false);
  assert.equal(shouldNavigateGrid({ key: 'ArrowRight' }, input('11',0,1)), false);
  assert.equal(shouldNavigateGrid({ key: 'ArrowRight' }, input('11',2)), true);
  assert.equal(shouldNavigateGrid({ key: 'ArrowLeft' }, input('11',0)), true);
  assert.equal(shouldNavigateGrid({ key: 'ArrowDown' }, input('11',1)), true);
  for (const modifier of ['shiftKey','ctrlKey','metaKey','altKey','isComposing','defaultPrevented']) assert.equal(shouldNavigateGrid({ key: 'ArrowRight', [modifier]: true }, input('11',0,2)), false);
});
test("personal, admin, custom draft and both trainers share the same arrow policy", () => {
  for (const path of ['js/table.js','js/admin.js','js/features/scheduleLab.js','js/timesheet-training.js','js/manager-training.js']) {
    assert.match(readFileSync(new URL('../' + path, import.meta.url),'utf8'), /shouldNavigateGrid\(/, path);
  }
});
