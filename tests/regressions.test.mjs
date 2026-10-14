import assert from "node:assert/strict";
import test from "node:test";

import { redactSensitiveSettings } from "../dist-tests/state/settings-export.js";
import { runBrowserKeyboardShortcut } from "../dist-tests/window/browser-keyboard-shortcuts.js";

test("data exports redact credentials and request headers recursively", () => {
  const result = redactSensitiveSettings({
    theme: "dark",
    provider: {
      apiKey: "sk-private",
      extraHeaders: { Authorization: "Bearer private" },
      modelSettings: {
        fast: { extraHeadersText: "X-Token: private" },
      },
    },
    translationGoogleApiKey: "google-private",
    downloadHeadersText: "Cookie: private",
    emptyApiKey: "",
  });

  assert.deepEqual(result, {
    theme: "dark",
    provider: {
      apiKey: "[REDACTED]",
      extraHeaders: "[REDACTED]",
      modelSettings: {
        fast: { extraHeadersText: "[REDACTED]" },
      },
    },
    translationGoogleApiKey: "[REDACTED]",
    downloadHeadersText: "[REDACTED]",
    emptyApiKey: "",
  });
});

test("hardware browser navigation keys keep their expected direction", () => {
  const calls = [];
  const targetWindow = {};
  const handlers = createShortcutHandlers(calls);

  assert.equal(
    runBrowserKeyboardShortcut({ key: "BrowserBack" }, targetWindow, handlers)?.id,
    "go-back-browser-back",
  );
  assert.equal(
    runBrowserKeyboardShortcut({ key: "BrowserForward" }, targetWindow, handlers)?.id,
    "go-forward-browser-forward",
  );
  assert.deepEqual(calls, ["back", "forward"]);
});

test("primary-L focuses the address bar", () => {
  const calls = [];
  const result = runBrowserKeyboardShortcut(
    { key: "l", meta: true },
    {},
    createShortcutHandlers(calls),
  );

  assert.equal(result?.id, "focus-address-bar");
  assert.deepEqual(calls, ["address"]);
});

function createShortcutHandlers(calls) {
  return {
    openWindow() {},
    openTab() {},
    closeActiveTab() {},
    reloadActiveTab() {},
    goBack() { calls.push("back"); },
    goForward() { calls.push("forward"); },
    openPageSearch() {},
    openSearch() {},
    focusAddressBar() { calls.push("address"); },
    toggleBrowserChrome() {},
  };
}
