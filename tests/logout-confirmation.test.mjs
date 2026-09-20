import assert from "node:assert/strict";
import test from "node:test";

import { bindLogoutConfirmation } from "../js/features/logoutConfirmation.js";

function buttonMock() {
  let clickHandler;
  return {
    button: {
      addEventListener(event, handler) {
        assert.equal(event, "click");
        clickHandler = handler;
      },
    },
    click: () => clickHandler(),
  };
}

test("logout stays on the page when confirmation is declined", async () => {
  const { button, click } = buttonMock();
  let signedOut = false;
  let redirected = false;

  bindLogoutConfirmation({
    button,
    confirmDialog: async (options) => {
      assert.equal(options.title, "Выйти из аккаунта?");
      assert.equal(options.confirmText, "Выйти");
      assert.equal(options.cancelText, "Остаться");
      assert.equal(options.tone, "danger");
      return false;
    },
    signOut: async () => { signedOut = true; },
    redirect: () => { redirected = true; },
  });

  await click();
  assert.equal(signedOut, false);
  assert.equal(redirected, false);
});

test("confirmed logout ends the session and redirects", async () => {
  const { button, click } = buttonMock();
  const calls = [];

  bindLogoutConfirmation({
    button,
    confirmDialog: async () => true,
    signOut: async () => { calls.push("sign-out"); },
    redirect: () => { calls.push("redirect"); },
  });

  await click();
  assert.deepEqual(calls, ["sign-out", "redirect"]);
});
