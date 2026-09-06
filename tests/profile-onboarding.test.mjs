import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getMissingRequiredProfileFields } from "../profileCompletion.js";
import { validatePasswordPolicy } from "../passwordPolicy.js";

test("profile completion requires payroll-critical fields but not tab number or weekly norm", () => {
  const complete = {
    display_name: "Сотрудник-1",
    position: "loader",
    gender: "male",
    branch: "chateau_alvisa",
    employment_date: "2024-01-15",
    oklad: 50000,
  };
  assert.deepEqual(getMissingRequiredProfileFields(complete), []);
  assert.deepEqual(getMissingRequiredProfileFields({ ...complete, branch: "", employment_date: "" }), ["branch", "employment_date"]);
  assert.deepEqual(getMissingRequiredProfileFields({ ...complete, employment_date: "2026-02-31" }), ["employment_date"]);
});

test("password policy is understandable and does not require uppercase or symbols", () => {
  assert.equal(validatePasswordPolicy("salary26").valid, true);
  assert.equal(validatePasswordPolicy("12345678").valid, false);
  assert.equal(validatePasswordPolicy("password").valid, false);
});

test("common navigation redirects incomplete profiles without another request per click", async () => {
  const source = await readFile(new URL("../nav.js", import.meta.url), "utf8");
  assert.match(source, /installProfileCompletionNavigationGate/);
  assert.match(source, /key === "calculator" \|\| key === "profile"/);
  assert.match(source, /buildProfileCompletionUrl/);
  assert.match(source, /alvisa:profile-updated/);
});

test("signup enters profile when Supabase returns a session", async () => {
  const source = await readFile(new URL("../login.js", import.meta.url), "utf8");
  assert.match(source, /signUpResult\?\.session/);
  assert.match(source, /buildProfileCompletionUrl\(getNextUrl\(\)/);
});

test("personal profile no longer asks for an employee number", async () => {
  const source = await readFile(new URL("../profile.html", import.meta.url), "utf8");
  assert.doesNotMatch(source, /id="tabNumberInput"/);
});
