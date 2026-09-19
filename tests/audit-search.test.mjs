import assert from "node:assert/strict";
import test from "node:test";

import { filterAuditEntries } from "../features/auditSearch.js";

const entries = [
  {
    actor_name: "Мирзоев Ханахмед Бегахмедович",
    employee_changes: [{ name: "Алиев Али", days: [{ day: 3 }] }],
  },
  {
    actor_name: "Иванов Иван Иванович",
    employee_changes: [{ name: "Петров Пётр", days: [{ day: 7 }] }],
  },
];

test("audit search finds an actor by an unfinished name", () => {
  assert.deepEqual(filterAuditEntries(entries, "Мир"), [entries[0]]);
  assert.deepEqual(filterAuditEntries(entries, "ханах"), [entries[0]]);
});

test("audit search is case-insensitive, treats ё as е and searches affected employees", () => {
  assert.deepEqual(filterAuditEntries(entries, "МИР БЕГАХ"), [entries[0]]);
  assert.deepEqual(filterAuditEntries(entries, "петр"), [entries[1]]);
});
