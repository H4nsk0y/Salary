import assert from "node:assert/strict";
import test from "node:test";
import { statSync } from "node:fs";
import { createHuntState, isValidHuntState, hashFestiveIdentity, HUNT_PAGES, GUEST_HUNT_PAGES, FESTIVE_GREETINGS } from "../js/features/festiveHuntModel.js";

test("hunt has three distinct accessible pages, stable placement and a first-page greeting", () => {
  for (const pages of [HUNT_PAGES, GUEST_HUNT_PAGES]) {
    for (const seed of [0, 1, 121, 0xffffffff]) {
      const state = createHuntState(seed, pages, "index.html");
      assert.equal(isValidHuntState(state, pages), true);
      assert.equal(state.places[0].page, "index.html");
      assert.equal(new Set(state.places.map(place => place.page)).size, 3);
      assert.deepEqual(state, createHuntState(seed, pages, "index.html"));
    }
  }
  const arrangements = new Set(Array.from({ length: 20 }, (_, seed) => JSON.stringify(createHuntState(seed).places)));
  assert.ok(arrangements.size > 15);
  assert.notEqual(hashFestiveIdentity("account-a"), hashFestiveIdentity("account-b"));
});

test("broken browser storage cannot inject routes or invalid findings", () => {
  assert.equal(isValidHuntState(null), false);
  assert.equal(isValidHuntState({}), false);
  const state = createHuntState(123);
  state.places[0].page = "https://example.com/";
  assert.equal(isValidHuntState(state), false);
  for (const found of [[-1], [3], ["0"], [0, 0]]) {
    assert.equal(isValidHuntState({ ...createHuntState(123), found }), false);
  }
  assert.equal(isValidHuntState({ ...createHuntState(123), found: [0, 1, 2] }), true);
});

test("three factory-wide greetings and both supplied assets are available", () => {
  assert.equal(FESTIVE_GREETINGS.length, 3);
  const text = JSON.stringify(FESTIVE_GREETINGS);
  for (const term of ["2027", "ЕГАИС", "КИП", "Бухгалтерии", "лаборатории", "производство", "технологов", "Сисадминам", "Складу", "розлива"]) assert.ok(text.includes(term), term);
  for (const name of ["images/festive-ded-moroz.png", "media/festive-laugh.mp3"]) {
    assert.ok(statSync(new URL(`../${name}`, import.meta.url)).size > 1000);
  }
});
