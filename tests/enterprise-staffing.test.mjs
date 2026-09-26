import assert from "node:assert/strict";
import test from "node:test";
import { buildEnterpriseStaffing, classifyStaffing } from "../js/enterpriseStaffing.js";

test("staffing heat map separates empty, minimum and staffed shifts", () => {
  assert.equal(classifyStaffing({ count:0, members:4 }).status, "empty");
  assert.equal(classifyStaffing({ count:1, members:4 }).status, "minimum");
  assert.equal(classifyStaffing({ count:2, members:4 }).status, "staffed");
  assert.equal(classifyStaffing({ count:0, members:4, missing:4 }).status, "unknown");
});

test("enterprise staffing groups Chateau buildings and Odyssey independently", () => {
  const state = buildEnterpriseStaffing([
    { department_key:"egais", branch:"chateau_alvisa", member_count:4, on_shift_count:1, schedule_missing_count:0 },
    { department_key:"bottling", branch:"chateau_alvisa", member_count:5, on_shift_count:2, schedule_missing_count:0 },
    { department_key:"accounting", branch:"chateau_alvisa", member_count:3, on_shift_count:0, schedule_missing_count:0 },
    { department_key:"warehouse", branch:"contract_odyssey", member_count:6, on_shift_count:2, schedule_missing_count:0 },
  ]);

  assert.equal(state.departments.egais.status, "minimum");
  assert.equal(state.departments.bottling.status, "staffed");
  assert.equal(state.buildings.production.status, "staffed");
  assert.equal(state.buildings.office.status, "empty");
  assert.equal(state.buildings.odyssey.status, "staffed");
  assert.equal(state.buildings.odyssey.count, 2);
});
