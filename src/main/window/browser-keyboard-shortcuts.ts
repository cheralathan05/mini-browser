import type { BrowserWindow, WebContents } from "electron";

export interface BrowserKeyboardShortcutInput {
  type?: string;
  key?: string;
  code?: string;
  keyCode?: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  isAutoRepeat?: boolean;
}

export interface BrowserKeyboardShortcutHandlers {
  openWindow: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  openTab: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  closeActiveTab: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  reloadActiveTab: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  goBack: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  goForward: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  openPageSearch: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  openSearch: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  focusAddressBar: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
  toggleBrowserChrome: (targetWindow: BrowserWindow) => Promise<unknown> | unknown;
}

interface BrowserKeyboardShortcut {
  id: string;
  matches: (input: BrowserKeyboardShortcutInput) => boolean;
  run: (
    targetWindow: BrowserWindow,
    handlers: BrowserKeyboardShortcutHandlers,
  ) => Promise<unknown> | unknown;
}

function isPrimaryModifierPressed(input: BrowserKeyboardShortcutInput) {
  return Boolean(input.meta || input.control);
}

function isKeyDown(input: BrowserKeyboardShortcutInput) {
  const type = input.type?.trim().toLowerCase();
  return type === undefined || type === "" || type === "keydown";
}

function isAutoRepeat(input: BrowserKeyboardShortcutInput) {
  return Boolean(input.isAutoRepeat);
}

function getNormalizedInputTokens(input: BrowserKeyboardShortcutInput) {
  return [
    input.key,
    input.code,
    input.keyCode,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

function hasAnyInputToken(input: BrowserKeyboardShortcutInput, tokens: string[]) {
  const normalizedTokens = getNormalizedInputTokens(input);
  return tokens.some((token) => normalizedTokens.includes(token));
}

const browserKeyboardShortcuts: BrowserKeyboardShortcut[] = [
  {
    id: "new-window",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && isPrimaryModifierPressed(input)
      && hasAnyInputToken(input, ["n", "keyn"]),
    run: (targetWindow, handlers) => handlers.openWindow(targetWindow),
  },
  {
    id: "new-tab",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && isPrimaryModifierPressed(input)
      && hasAnyInputToken(input, ["t", "keyt"]),
    run: (targetWindow, handlers) => handlers.openTab(targetWindow),
  },
  {
    id: "close-tab",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && isPrimaryModifierPressed(input)
      && hasAnyInputToken(input, ["w", "keyw"]),
    run: (targetWindow, handlers) => handlers.closeActiveTab(targetWindow),
  },
  {
    id: "reload-tab",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && isPrimaryModifierPressed(input)
      && hasAnyInputToken(input, ["r", "keyr"]),
    run: (targetWindow, handlers) => handlers.reloadActiveTab(targetWindow),
  },
  {
    id: "go-back-alt-left",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && Boolean(input.alt)
      && hasAnyInputToken(input, ["arrowleft"]),
    run: (targetWindow, handlers) => handlers.goBack(targetWindow),
  },
  {
    id: "go-forward-alt-right",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && Boolean(input.alt)
      && hasAnyInputToken(input, ["arrowright"]),
    run: (targetWindow, handlers) => handlers.goForward(targetWindow),
  },
  {
    id: "go-back-browser-back",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && hasAnyInputToken(input, ["browserback", "goback"]),
    run: (targetWindow, handlers) => handlers.goBack(targetWindow),
  },
  {
    id: "go-forward-browser-forward",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && hasAnyInputToken(input, ["browserforward", "goforward"]),
    run: (targetWindow, handlers) => handlers.goForward(targetWindow),
  },
  {
    id: "go-back-meta-bracket-left",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && Boolean(input.meta)
      && !input.alt
      && !input.control
      && hasAnyInputToken(input, ["bracketleft"]),
    run: (targetWindow, handlers) => handlers.goBack(targetWindow),
  },
  {
    id: "go-forward-meta-bracket-right",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && Boolean(input.meta)
      && !input.alt
      && !input.control
      && hasAnyInputToken(input, ["bracketright"]),
    run: (targetWindow, handlers) => handlers.goForward(targetWindow),
  },
  {
    id: "focus-address-bar",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && isPrimaryModifierPressed(input)
      && !input.alt
      && !input.shift
      && hasAnyInputToken(input, ["l", "keyl"]),
    run: (targetWindow, handlers) => handlers.focusAddressBar(targetWindow),
  },
  {
    id: "open-page-search",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && isPrimaryModifierPressed(input)
      && hasAnyInputToken(input, ["f", "keyf"]),
    run: (targetWindow, handlers) => handlers.openPageSearch(targetWindow),
  },
  {
    id: "open-search",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && isPrimaryModifierPressed(input)
      && hasAnyInputToken(input, ["k", "keyk"]),
    run: (targetWindow, handlers) => handlers.openSearch(targetWindow),
  },
  {
    id: "toggle-browser-chrome",
    matches: (input) =>
      isKeyDown(input)
      && !isAutoRepeat(input)
      && isPrimaryModifierPressed(input)
      && Boolean(input.shift)
      && !input.alt
      && hasAnyInputToken(input, ["\\", "|", "backslash"]),
    run: (targetWindow, handlers) => handlers.toggleBrowserChrome(targetWindow),
  },
];

export function runBrowserKeyboardShortcut(
  input: BrowserKeyboardShortcutInput,
  targetWindow: BrowserWindow,
  handlers: BrowserKeyboardShortcutHandlers,
) {
  const shortcut = browserKeyboardShortcuts.find((entry) => entry.matches(input));
  if (!shortcut) return null;
  return {
    id: shortcut.id,
    result: shortcut.run(targetWindow, handlers),
  };
}

export function createBrowserKeyboardShortcutsManager(
  handlers: BrowserKeyboardShortcutHandlers,
) {
  const installedContentsIds = new Set<number>();

  function install(targetWindow: BrowserWindow, targetContents: WebContents) {
    if (targetContents.isDestroyed() || installedContentsIds.has(targetContents.id)) {
      return;
    }

    installedContentsIds.add(targetContents.id);
    targetContents.once("destroyed", () => {
      installedContentsIds.delete(targetContents.id);
    });

    targetContents.on("before-input-event", (event, input) => {
      const match = runBrowserKeyboardShortcut(
        input as BrowserKeyboardShortcutInput,
        targetWindow,
        handlers,
      );
      if (!match) {
        return;
      }

      event.preventDefault();
      void Promise.resolve(match.result).catch((error) => {
        console.warn(`[Shortcuts] Failed to handle shortcut "${match.id}".`, error);
      });
    });
  }

  return {
    install,
  };
}
