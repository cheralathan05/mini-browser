import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as extractZipModule from "extract-zip";
import { app, BrowserWindow, Menu, net, screen, session, shell, type Session } from "electron";
import { buildWorkspacePartition } from "../shared/utils.js";
import {
  assertChromeWebStoreExtensionInstallAllowed,
  getExtensionCompatibility,
  isChromeWebStoreExtensionInstallAllowed,
  type BrowserExtensionCompatibilitySummary,
} from "./extension-compatibility.js";
import {
  ensureNativeMessagingBridgeStarted,
  type NativeMessagingBridgeInfo,
} from "./native-messaging.js";

type ExtractZip = (
  zipPath: string,
  options: { dir: string },
) => Promise<void>;
const extractZip = (
  "default" in extractZipModule ? extractZipModule.default : extractZipModule
) as ExtractZip;

export type BrowserExtensionSource = "chrome-web-store" | "local-unpacked";

export interface BrowserExtensionSummary {
  id: string;
  profileId: string;
  name: string;
  version: string;
  description?: string;
  source: BrowserExtensionSource;
  path: string;
  enabled: boolean;
  loaded: boolean;
  installedAt: number;
  updatedAt: number;
  storeId?: string;
  storeUrl?: string;
  lastError?: string;
  compatibility: BrowserExtensionCompatibilitySummary;
  action?: BrowserExtensionActionSummary;
}

export interface BrowserExtensionActionSummary {
  title: string;
  popupUrl: string;
  defaultPopup: string;
  iconUrl?: string;
}

export interface ExtensionActionPopupAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ExtensionActionBridgeInfo {
  baseUrl: string;
  token: string;
}

export type ChromeWebStoreInstallState = "installable" | "installed" | "disabled" | "pending" | "unsupported";

export interface ChromeWebStoreInstallRequest {
  id: string;
  storeUrl?: string;
  manifest?: string;
  localizedName?: string;
  iconUrl?: string;
}

interface PersistedExtensionRecord {
  id: string;
  profileId: string;
  name: string;
  version: string;
  description?: string;
  source: BrowserExtensionSource;
  path: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  storeId?: string;
  storeUrl?: string;
  lastError?: string;
}

interface ExtensionStatePayload {
  version: number;
  extensions: PersistedExtensionRecord[];
}

interface ChromeWebStoreReference {
  id: string;
  storeUrl: string;
}

interface PendingChromeWebStoreInstallApproval {
  id: string;
  profileId: string;
  storeUrl: string;
  manifest?: string;
  localizedName?: string;
  iconUrl?: string;
  createdAt: number;
}

interface ExtensionManagerContext {
  userAgent: string;
  resolveRequestUserAgent?: (url: string) => string;
  resolveActiveTab?: (
    profileId: string,
    ownerWindow: BrowserWindow | null,
  ) => ExtensionBrowserTabSnapshot | null;
  resolveTab?: (
    profileId: string,
    windowId: number,
    tabId: string,
  ) => ExtensionBrowserTabSnapshot | null;
  onChanged?: (profileId: string) => void;
}

interface ExtensionBrowserTabSnapshot {
  tabId: string;
  windowId: number;
  url: string;
  title?: string;
  active?: boolean;
  index?: number;
  favIconUrl?: string;
  isLoading?: boolean;
}

interface ExtensionMappedTab {
  chromeTabId: number;
  profileId: string;
  windowId: number;
  tabId: string;
}

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/i;
const EXTENSION_STATE_VERSION = 1;
const EXTENSION_STORAGE_DIRECTORY_NAME = "extensions";
const EXTENSION_STATE_FILE_NAME = "extension-state.json";
const EXTENSION_TEMP_PREFIX = "milo-extension-";
const MANIFEST_FILE_NAME = "manifest.json";
const MILO_EXTENSION_COMPAT_SHIM_START = "/* milo-extension-compat:start */";
const MILO_EXTENSION_COMPAT_SHIM_END = "/* milo-extension-compat:end */";
const MILO_COMPAT_BACKGROUND_SCRIPT_PREFIX = "milo_compat_";
const LEGACY_MILO_COMPAT_BACKGROUND_SCRIPT_PREFIX = "__milo_compat_";
const MILO_COMPAT_BACKGROUND_HASH_LENGTH = 12;
const MILO_COMPAT_BRIDGE_CONFIG_FILE_NAME = "milo_compat_bridge_config.json";
const MILO_COMPAT_POSTAMBLE_PATTERN = /^var chrome = globalThis\.chrome;\r?\nvar navigator = globalThis\.navigator;\r?\n/;
const MILO_COMPAT_RUNTIME_ERROR_WRAPPER_START = "try {\n";
const MILO_COMPAT_RUNTIME_ERROR_WRAPPER_END = "\n} catch (error) {\n  const message = String(error && (error.message || error) || \"\");\n  if (!(error && error.name === \"ReferenceError\")\n    && !message.includes(\"Attempting to use a disconnected port object\")\n    && !message.includes(\"Called encrypt() without a session key\")\n    && !message.includes(\"Native host has exited\")\n    && !message.includes(\"The message port closed before a response was received\")) {\n    throw error;\n  }\n}\n";
const MILO_LOCAL_BRIDGE_HOST_PERMISSION = "http://127.0.0.1/*";
const MAX_EXTENSION_ACTION_BRIDGE_REQUEST_BYTES = 64 * 1024;
const ELECTRON_UNSUPPORTED_EXTENSION_PERMISSIONS = new Set([
  "contextMenus",
  "declarativeContent",
  "privacy",
  "webNavigation",
]);
const COMPATIBILITY_API_MARKERS = [
  "chrome.contextMenus",
  "chrome.declarativeContent",
  "chrome.privacy",
  "chrome.action.openPopup",
  "chrome.browserAction.openPopup",
  "chrome.runtime.connectNative",
  "chrome.runtime.sendMessage",
  "chrome.storage.sync",
  "chrome.tabs.sendMessage",
  "chrome.webNavigation",
  "chrome.windows",
  "g_nativeAppPort.postMessage",
];

const MILO_EXTENSION_COMPAT_SHIM = String.raw`(() => {
  const root = globalThis;
  const miloExtensionId = typeof root.__miloExtensionId === "string" ? root.__miloExtensionId : "";
  const miloProfileId = typeof root.__miloProfileId === "string" ? root.__miloProfileId : "";
  const miloBridgeConfigPath = typeof root.__miloBridgeConfigPath === "string"
    ? root.__miloBridgeConfigPath
    : "";
  let miloExtensionActionBridgeBaseUrl = typeof root.__miloExtensionActionBridgeBaseUrl === "string"
    ? root.__miloExtensionActionBridgeBaseUrl.replace(/\/+$/, "")
    : "";
  let miloExtensionActionBridgeToken = typeof root.__miloExtensionActionBridgeToken === "string"
    ? root.__miloExtensionActionBridgeToken
    : "";
  let miloNativeMessagingBridgeBaseUrl = typeof root.__miloNativeMessagingBridgeBaseUrl === "string"
    ? root.__miloNativeMessagingBridgeBaseUrl.replace(/\/+$/, "")
    : "";
  let miloNativeMessagingBridgeToken = typeof root.__miloNativeMessagingBridgeToken === "string"
    ? root.__miloNativeMessagingBridgeToken
    : "";
  if (!root.navigator) {
    try {
      Object.defineProperty(root, "navigator", {
        configurable: true,
        enumerable: true,
        value: { platform: "MacIntel", userAgent: "" },
      });
    } catch {
      root.navigator = { platform: "MacIntel", userAgent: "" };
    }
  }
  const chromeApi = root.chrome || {};
  if (!root.chrome) {
    try {
      Object.defineProperty(root, "chrome", {
        configurable: true,
        enumerable: true,
        value: chromeApi,
      });
    } catch {
      root.chrome = chromeApi;
    }
  }
  if (chromeApi.__miloCompatInstalled) {
    return;
  }

  try {
    Object.defineProperty(chromeApi, "__miloCompatInstalled", { value: true });
  } catch {
    chromeApi.__miloCompatInstalled = true;
  }

  const createEvent = () => {
    const listeners = new Set();
    return {
      addListener(listener) {
        if (typeof listener === "function") {
          listeners.add(listener);
        }
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
      hasListener(listener) {
        return listeners.has(listener);
      },
      hasListeners() {
        return listeners.size > 0;
      },
      dispatch() {
        const args = Array.from(arguments);
        for (const listener of Array.from(listeners)) {
          try {
            const result = listener.apply(undefined, args);
            if (result && typeof result.catch === "function") {
              result.catch((error) => {
                if (!isBenignCompatError(error)) {
                  setTimeout(() => {
                    throw error;
                  }, 0);
                }
              });
            }
          } catch (error) {
            if (!isBenignCompatError(error)) {
              setTimeout(() => {
                throw error;
              }, 0);
            }
          }
        }
      },
    };
  };

  const isBenignCompatError = (error) => {
    const message = String(error && (error.message || error) || "");
    return message.includes("Attempting to use a disconnected port object")
      || message.includes("Called encrypt() without a session key")
      || message.includes("Could not establish connection")
      || message.includes("Native host has exited")
      || message.includes("The message port closed before a response was received")
      || message.includes("Specified native messaging host not found");
  };

  const ensureEvent = (owner, name) => {
    if (owner[name] && typeof owner[name].addListener === "function") {
      if (typeof owner[name].dispatch !== "function") {
        try {
          Object.defineProperty(owner[name], "dispatch", { value: () => undefined });
        } catch {}
      }
      return owner[name];
    }
    owner[name] = createEvent();
    return owner[name];
  };

  const wrapEventListeners = (owner, name) => {
    const event = owner && owner[name];
    if (!event || typeof event.addListener !== "function" || event.__miloCompatWrapped) {
      return event;
    }

    const listenerMap = new WeakMap();
    const originalAddListener = event.addListener.bind(event);
    const originalRemoveListener = typeof event.removeListener === "function"
      ? event.removeListener.bind(event)
      : null;
    event.addListener = (listener, ...rest) => {
      if (typeof listener !== "function") {
        return originalAddListener(listener, ...rest);
      }

      const wrappedListener = function () {
        try {
          const result = listener.apply(this, arguments);
          if (result && typeof result.catch === "function") {
            result.catch((error) => {
              if (!isBenignCompatError(error)) {
                setTimeout(() => {
                  throw error;
                }, 0);
              }
            });
          }
          return result;
        } catch (error) {
          if (!isBenignCompatError(error)) {
            throw error;
          }
          return undefined;
        }
      };
      listenerMap.set(listener, wrappedListener);
      return originalAddListener(wrappedListener, ...rest);
    };
    if (originalRemoveListener) {
      event.removeListener = (listener, ...rest) => {
        return originalRemoveListener(listenerMap.get(listener) || listener, ...rest);
      };
    }
    try {
      Object.defineProperty(event, "__miloCompatWrapped", { value: true });
    } catch {
      event.__miloCompatWrapped = true;
    }
    return event;
  };

  const wrapPort = (port) => {
    if (!port || typeof port !== "object" || port.__miloCompatWrapped) {
      return port;
    }

    if (!port.onMessage) {
      port.onMessage = createEvent();
    }
    if (!port.onDisconnect) {
      port.onDisconnect = createEvent();
    }

    const originalPostMessage = typeof port.postMessage === "function"
      ? port.postMessage.bind(port)
      : null;
    port.postMessage = function () {
      if (!originalPostMessage) {
        return undefined;
      }
      try {
        return originalPostMessage.apply(undefined, arguments);
      } catch (error) {
        if (!isBenignCompatError(error)) {
          throw error;
        }
        return undefined;
      }
    };

    try {
      Object.defineProperty(port, "__miloCompatWrapped", { value: true });
    } catch {
      port.__miloCompatWrapped = true;
    }
    return port;
  };

  const createDisconnectedNativePort = (name) => {
    const onMessage = createEvent();
    const onDisconnect = createEvent();
    return {
      name: String(name || ""),
      onMessage,
      onDisconnect,
      postMessage() {},
      disconnect() {
        onDisconnect.dispatch();
      },
    };
  };

  const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
  const normalizeBridgeBaseUrl = (value) => typeof value === "string" ? value.replace(/\/+$/, "") : "";
  let miloBridgeConfigLoadPromise = null;
  let miloBridgeConfigLoadedAt = 0;

  const applyMiloBridgeConfig = (config) => {
    if (!config || typeof config !== "object") {
      return;
    }
    const actionBridge = config.actionBridge && typeof config.actionBridge === "object"
      ? config.actionBridge
      : null;
    const nativeMessagingBridge = config.nativeMessagingBridge && typeof config.nativeMessagingBridge === "object"
      ? config.nativeMessagingBridge
      : null;
    if (actionBridge) {
      miloExtensionActionBridgeBaseUrl = normalizeBridgeBaseUrl(actionBridge.baseUrl);
      miloExtensionActionBridgeToken = typeof actionBridge.token === "string" ? actionBridge.token : "";
    }
    if (nativeMessagingBridge) {
      miloNativeMessagingBridgeBaseUrl = normalizeBridgeBaseUrl(nativeMessagingBridge.baseUrl);
      miloNativeMessagingBridgeToken = typeof nativeMessagingBridge.token === "string" ? nativeMessagingBridge.token : "";
    }
  };

  const loadMiloBridgeConfig = async () => {
    if (
      !miloBridgeConfigPath
      || typeof fetch !== "function"
      || !chromeApi.runtime
      || typeof chromeApi.runtime.getURL !== "function"
    ) {
      return null;
    }

    const now = Date.now();
    if (miloBridgeConfigLoadPromise && now - miloBridgeConfigLoadedAt < 500) {
      return miloBridgeConfigLoadPromise;
    }

    miloBridgeConfigLoadedAt = now;
    miloBridgeConfigLoadPromise = fetch(chromeApi.runtime.getURL(miloBridgeConfigPath), {
      cache: "no-store",
    })
      .then((response) => response.ok ? response.json() : null)
      .then((config) => {
        applyMiloBridgeConfig(config);
        return config;
      })
      .catch(() => null);
    return miloBridgeConfigLoadPromise;
  };

  const getMiloNativeMessagingBridgeConfig = async () => {
    await loadMiloBridgeConfig();
    if (!miloNativeMessagingBridgeBaseUrl || !miloNativeMessagingBridgeToken || typeof fetch !== "function") {
      throw new Error("Native messaging bridge is unavailable.");
    }
    return {
      baseUrl: miloNativeMessagingBridgeBaseUrl,
      token: miloNativeMessagingBridgeToken,
    };
  };

  const getMiloExtensionActionBridgeConfig = async () => {
    await loadMiloBridgeConfig();
    if (!miloExtensionActionBridgeBaseUrl || !miloExtensionActionBridgeToken || typeof fetch !== "function") {
      return null;
    }
    return {
      baseUrl: miloExtensionActionBridgeBaseUrl,
      token: miloExtensionActionBridgeToken,
    };
  };

  const createNativeMessagingBridgePort = (name) => {
    if (typeof fetch !== "function") {
      return createDisconnectedNativePort(name);
    }

    const port = createDisconnectedNativePort(name);
    const pendingMessages = [];
    let connectionId = "";
    let cursor = 0;
    let disconnected = false;

    const dispatchDisconnect = () => {
      if (disconnected) {
        return;
      }
      disconnected = true;
      try {
        port.onDisconnect.dispatch(port);
      } catch {}
    };

    const bridgeFetch = async (route, init) => {
      const bridgeConfig = await getMiloNativeMessagingBridgeConfig();
      return fetch(bridgeConfig.baseUrl + route, {
        ...init,
        headers: {
          ...(init && init.headers ? init.headers : {}),
          authorization: "Bearer " + bridgeConfig.token,
        },
      });
    };

    const readJsonResponse = async (response) => {
      const payload = await response.text();
      let parsed = null;
      if (payload) {
        try {
          parsed = JSON.parse(payload);
        } catch {
          parsed = null;
        }
      }
      if (!response.ok) {
        const message = parsed && parsed.error ? String(parsed.error) : "Native messaging bridge failed: " + response.status;
        throw new Error(message);
      }
      return parsed || {};
    };

    const postToBridge = async (message) => {
      const response = await bridgeFetch("/post", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ connectionId, message }),
      });
      await readJsonResponse(response);
    };

    const flushPendingMessages = () => {
      const messages = pendingMessages.splice(0);
      for (const message of messages) {
        postToBridge(message).catch((error) => {
          if (!isBenignCompatError(error)) {
            port.error = error;
          }
          dispatchDisconnect();
        });
      }
    };

    const pollBridgeEvents = async () => {
      while (!disconnected && connectionId) {
        try {
          const response = await bridgeFetch("/events?connectionId=" + encodeURIComponent(connectionId) + "&cursor=" + cursor, {
            method: "GET",
          });
          const payload = await readJsonResponse(response);
          const events = Array.isArray(payload.events) ? payload.events : [];
          if (Number.isFinite(Number(payload.nextCursor))) {
            cursor = Number(payload.nextCursor);
          }
          for (const event of events) {
            if (!event || typeof event !== "object") {
              continue;
            }
            if (Number.isFinite(Number(event.id))) {
              cursor = Math.max(cursor, Number(event.id));
            }
            if (event.type === "message") {
              port.onMessage.dispatch(event.message, port);
            } else if (event.type === "error") {
              port.error = new Error(String(event.error || "Native messaging bridge error."));
            } else if (event.type === "disconnect") {
              dispatchDisconnect();
              return;
            }
          }
          await delay(events.length ? 20 : 150);
        } catch (error) {
          if (!isBenignCompatError(error)) {
            port.error = error;
          }
          dispatchDisconnect();
          return;
        }
      }
    };

    const connect = async () => {
      const extensionId = String(
        (chromeApi.runtime && chromeApi.runtime.id)
        || miloExtensionId
        || "",
      );
      const response = await bridgeFetch("/connect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          extensionId,
          hostName: String(name || ""),
        }),
      });
      const payload = await readJsonResponse(response);
      connectionId = String(payload.connectionId || "");
      if (!connectionId) {
        throw new Error("Native messaging bridge did not return a connection id.");
      }
      flushPendingMessages();
      void pollBridgeEvents();
    };

    port.postMessage = (message) => {
      if (disconnected) {
        throw new Error("Attempting to use a disconnected port object");
      }
      if (!connectionId) {
        pendingMessages.push(message);
        return undefined;
      }
      return postToBridge(message).catch((error) => {
        if (!isBenignCompatError(error)) {
          port.error = error;
        }
        dispatchDisconnect();
        return undefined;
      });
    };

    port.disconnect = () => {
      if (disconnected) {
        return;
      }
      disconnected = true;
      if (connectionId) {
        bridgeFetch("/disconnect", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ connectionId }),
        }).catch(() => undefined);
      }
      port.onDisconnect.dispatch(port);
    };

    connect().catch((error) => {
      if (!isBenignCompatError(error)) {
        port.error = error;
      }
      dispatchDisconnect();
    });

    return port;
  };

  root.__miloSafeNativePostMessage = (port, message) => {
    if (!port || typeof port.postMessage !== "function") {
      return undefined;
    }
    try {
      return port.postMessage(message);
    } catch (error) {
      if (!isBenignCompatError(error)) {
        throw error;
      }
      return undefined;
    }
  };

  const callMessageApi = (sendMessage, args) => {
    const hasCallback = typeof args[args.length - 1] === "function";
    const callback = hasCallback ? args[args.length - 1] : null;
    const callArgs = hasCallback
      ? args.slice(0, -1).concat([(response) => {
        try {
          void (chromeApi.runtime && chromeApi.runtime.lastError && chromeApi.runtime.lastError.message);
          callback(response);
        } catch (error) {
          if (!isBenignCompatError(error)) {
            throw error;
          }
        }
      }])
      : args;

    try {
      const result = sendMessage.apply(undefined, callArgs);
      if (result && typeof result.then === "function") {
        return result.catch((error) => {
          if (!isBenignCompatError(error)) {
            return undefined;
          }
          return undefined;
        });
      }
      return hasCallback ? undefined : Promise.resolve(result);
    } catch (error) {
      if (!isBenignCompatError(error)) {
        return hasCallback ? undefined : Promise.resolve(undefined);
      }
      return hasCallback ? undefined : Promise.resolve(undefined);
    }
  };

  root.__miloSafeTabsSendMessage = function () {
    const sendMessage = chromeApi.tabs && chromeApi.tabs.sendMessage;
    if (typeof sendMessage !== "function") {
      return Promise.resolve(undefined);
    }
    return callMessageApi(sendMessage.bind(chromeApi.tabs), Array.from(arguments));
  };

  root.__miloSafeRuntimeSendMessage = function () {
    const sendMessage = chromeApi.runtime && chromeApi.runtime.sendMessage;
    if (typeof sendMessage !== "function") {
      return Promise.resolve(undefined);
    }
    return callMessageApi(sendMessage.bind(chromeApi.runtime), Array.from(arguments));
  };

  if (chromeApi.runtime && typeof chromeApi.runtime.connectNative === "function") {
    const originalConnectNative = chromeApi.runtime.connectNative.bind(chromeApi.runtime);
    chromeApi.runtime.connectNative = (name) => {
      if ((miloNativeMessagingBridgeBaseUrl && miloNativeMessagingBridgeToken) || miloBridgeConfigPath) {
        return createNativeMessagingBridgePort(name);
      }
      try {
        return wrapPort(originalConnectNative(name));
      } catch (error) {
        if (!isBenignCompatError(error)) {
          throw error;
        }
        return createNativeMessagingBridgePort(name);
      }
    };
  } else if (chromeApi.runtime) {
    chromeApi.runtime.connectNative = (name) => createNativeMessagingBridgePort(name);
  }

  const complete = (factory, callback) => {
    const promise = Promise.resolve().then(factory);
    if (typeof callback === "function") {
      promise.then(
        (value) => callback(value),
        () => callback(undefined),
      );
      return undefined;
    }
    return promise;
  };

  chromeApi.runtime = chromeApi.runtime || {};
  if (!chromeApi.runtime.id && miloExtensionId) {
    try {
      chromeApi.runtime.id = miloExtensionId;
    } catch {}
  }
  if (typeof chromeApi.runtime.getURL !== "function") {
    chromeApi.runtime.getURL = (resourcePath) => {
      const extensionId = String((chromeApi.runtime && chromeApi.runtime.id) || miloExtensionId || "");
      return "chrome-extension://" + extensionId + "/" + String(resourcePath || "").replace(/^\/+/, "");
    };
  }
  chromeApi.tabs = chromeApi.tabs || {};
  chromeApi.action = chromeApi.action || {};
  chromeApi.browserAction = chromeApi.browserAction || chromeApi.action;
  chromeApi.i18n = chromeApi.i18n || {};
  chromeApi.scripting = chromeApi.scripting || {};

  if (typeof chromeApi.runtime.getManifest !== "function") {
    chromeApi.runtime.getManifest = () => ({});
  }
  if (typeof chromeApi.runtime.sendMessage !== "function") {
    chromeApi.runtime.sendMessage = function () {
      const callback = Array.from(arguments).find((argument) => typeof argument === "function");
      return complete(() => undefined, callback);
    };
  }
  if (typeof chromeApi.runtime.connectNative !== "function") {
    chromeApi.runtime.connectNative = (name) => createNativeMessagingBridgePort(name);
  }
  if (typeof chromeApi.i18n.getMessage !== "function") {
    chromeApi.i18n.getMessage = (messageName) => String(messageName || "");
  }
  if (typeof chromeApi.scripting.executeScript !== "function") {
    chromeApi.scripting.executeScript = function () {
      const callback = Array.from(arguments).find((argument) => typeof argument === "function");
      return complete(() => [], callback);
    };
  }

  const callExtensionActionBridge = async (route, payload) => {
    const bridgeConfig = await getMiloExtensionActionBridgeConfig();
    if (!bridgeConfig || typeof fetch !== "function") {
      return undefined;
    }

    const response = await fetch(bridgeConfig.baseUrl + route, {
      method: "POST",
      headers: {
        authorization: "Bearer " + bridgeConfig.token,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload || {}),
    });
    if (!response.ok) {
      let message = "Extension action bridge failed: " + response.status;
      try {
        const parsed = await response.json();
        if (parsed && parsed.error) {
          message = String(parsed.error);
        }
      } catch {}
      throw new Error(message);
    }
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  };

  const isValidUrlString = (value) => {
    if (typeof value !== "string" || !value.trim()) {
      return false;
    }
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  };

  const callChromeApiWithCallback = (api, args, fallbackValue) => new Promise((resolve) => {
    if (typeof api !== "function") {
      resolve(fallbackValue);
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(fallbackValue), 300);

    try {
      const result = api(...args, finish);
      if (result && typeof result.then === "function") {
        result.then(finish, () => finish(fallbackValue));
      } else if (result !== undefined) {
        finish(result);
      }
    } catch {
      finish(fallbackValue);
    }
  });

  const mergeBridgeTab = (nativeTab, bridgeTab) => {
    if (!nativeTab && !bridgeTab) {
      return null;
    }

    const nextTab = {
      ...(bridgeTab && typeof bridgeTab === "object" ? bridgeTab : {}),
      ...(nativeTab && typeof nativeTab === "object" ? nativeTab : {}),
    };
    if (!isValidUrlString(nextTab.url) && bridgeTab && isValidUrlString(bridgeTab.url)) {
      nextTab.url = bridgeTab.url;
    }
    if (!isValidUrlString(nextTab.pendingUrl) && bridgeTab && isValidUrlString(bridgeTab.pendingUrl)) {
      nextTab.pendingUrl = bridgeTab.pendingUrl;
    }
    if (!isValidUrlString(nextTab.url) && isValidUrlString(nextTab.pendingUrl)) {
      nextTab.url = nextTab.pendingUrl;
    }
    if (!isValidUrlString(nextTab.url)) {
      nextTab.url = "about:blank";
    }
    return nextTab;
  };

  const getBridgeTabs = async (queryInfo) => {
    const payload = await callExtensionActionBridge("/tabs/query", {
      extensionId: miloExtensionId || (chromeApi.runtime && chromeApi.runtime.id) || "",
      profileId: miloProfileId,
      queryInfo: queryInfo || {},
    });
    return payload && Array.isArray(payload.tabs) ? payload.tabs : [];
  };

  const openMiloActionPopup = (callback) => complete(() => callExtensionActionBridge("/open-action-popup", {
    extensionId: miloExtensionId || (chromeApi.runtime && chromeApi.runtime.id) || "",
    profileId: miloProfileId,
  }), callback);

  const ensureActionApi = (actionApi) => {
    if (!actionApi || typeof actionApi !== "object") {
      return;
    }
    for (const methodName of ["setBadgeBackgroundColor", "setBadgeText", "setIcon", "setPopup", "setTitle"]) {
      if (typeof actionApi[methodName] !== "function") {
        actionApi[methodName] = function () {
          const callback = Array.from(arguments).find((argument) => typeof argument === "function");
          return complete(() => undefined, callback);
        };
      }
    }
    if ((miloExtensionActionBridgeBaseUrl && miloExtensionActionBridgeToken) || miloBridgeConfigPath) {
      actionApi.openPopup = function () {
        const callback = Array.from(arguments).find((argument) => typeof argument === "function");
        return openMiloActionPopup(callback);
      };
    } else if (typeof actionApi.openPopup !== "function") {
      actionApi.openPopup = function () {
        const callback = Array.from(arguments).find((argument) => typeof argument === "function");
        return complete(() => undefined, callback);
      };
    }
  };
  ensureActionApi(chromeApi.action);
  ensureActionApi(chromeApi.browserAction);

  for (const eventName of ["onActivated", "onCreated", "onRemoved", "onUpdated"]) {
    ensureEvent(chromeApi.tabs, eventName);
  }
  if (typeof chromeApi.tabs.get !== "function") {
    chromeApi.tabs.get = function (tabId, callback) {
      return complete(() => null, callback);
    };
  }
  const originalTabsGet = typeof chromeApi.tabs.get === "function"
    ? chromeApi.tabs.get.bind(chromeApi.tabs)
    : null;
  if (typeof chromeApi.tabs.query !== "function") {
    chromeApi.tabs.query = function (queryInfo, callback) {
      return complete(() => [], callback);
    };
  }
  const originalTabsQuery = typeof chromeApi.tabs.query === "function"
    ? chromeApi.tabs.query.bind(chromeApi.tabs)
    : null;
  chromeApi.tabs.get = function (tabId, callback) {
    return complete(async () => {
      const nativeTab = await callChromeApiWithCallback(originalTabsGet, [tabId], null);
      if (nativeTab && isValidUrlString(nativeTab.url || nativeTab.pendingUrl)) {
        return nativeTab;
      }

      const payload = await callExtensionActionBridge("/tabs/get", {
        extensionId: miloExtensionId || (chromeApi.runtime && chromeApi.runtime.id) || "",
        profileId: miloProfileId,
        tabId,
      });
      return mergeBridgeTab(nativeTab, payload && payload.tab);
    }, callback);
  };
  chromeApi.tabs.query = function (queryInfo, callback) {
    return complete(async () => {
      const nativeTabs = await callChromeApiWithCallback(originalTabsQuery, [queryInfo || {}], []);
      const nativeTabList = Array.isArray(nativeTabs) ? nativeTabs : [];
      if (nativeTabList.length && nativeTabList.every((tab) => isValidUrlString(tab && (tab.url || tab.pendingUrl)))) {
        return nativeTabList;
      }

      const bridgeTabs = await getBridgeTabs(queryInfo || {});
      if (!bridgeTabs.length) {
        return nativeTabList;
      }
      if (!nativeTabList.length) {
        return bridgeTabs.map((tab) => mergeBridgeTab(null, tab)).filter(Boolean);
      }
      return nativeTabList.map((tab, index) => mergeBridgeTab(tab, bridgeTabs[index] || bridgeTabs[0])).filter(Boolean);
    }, callback);
  };
  if (typeof chromeApi.tabs.connect !== "function") {
    chromeApi.tabs.connect = (tabId, connectInfo) => wrapPort(createDisconnectedNativePort(
      connectInfo && connectInfo.name,
    ));
  }
  if (typeof chromeApi.tabs.sendMessage !== "function") {
    chromeApi.tabs.sendMessage = function () {
      const callback = Array.from(arguments).find((argument) => typeof argument === "function");
      return complete(() => undefined, callback);
    };
  }

  const getTab = (tabId) => new Promise((resolve) => {
    if (!chromeApi.tabs || typeof chromeApi.tabs.get !== "function" || !Number.isFinite(Number(tabId))) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (tab) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(tab || null);
    };

    try {
      const result = chromeApi.tabs.get(Number(tabId), finish);
      if (result && typeof result.then === "function") {
        result.then(finish, () => finish(null));
      }
    } catch {
      finish(null);
    }
  });

  const buildMainFrame = async (details) => {
    const tabId = Number(details && details.tabId);
    const requestedFrameId = Number(details && details.frameId);
    const frameId = Number.isFinite(requestedFrameId) ? requestedFrameId : 0;
    const tab = await getTab(tabId);
    return {
      tabId,
      frameId,
      parentFrameId: frameId === 0 ? -1 : 0,
      frameType: frameId === 0 ? "outermost_frame" : "sub_frame",
      url: (tab && (tab.url || tab.pendingUrl)) || "about:blank",
    };
  };

  const webNavigation = chromeApi.webNavigation || {};
  const onBeforeNavigate = ensureEvent(webNavigation, "onBeforeNavigate");
  const onCompleted = ensureEvent(webNavigation, "onCompleted");
  const onHistoryStateUpdated = ensureEvent(webNavigation, "onHistoryStateUpdated");
  ensureEvent(webNavigation, "onTabReplaced");
  if (typeof webNavigation.getFrame !== "function") {
    webNavigation.getFrame = (details, callback) => complete(() => buildMainFrame(details), callback);
  }
  const originalWebNavigationGetFrame = typeof webNavigation.getFrame === "function"
    ? webNavigation.getFrame.bind(webNavigation)
    : null;
  if (typeof webNavigation.getAllFrames !== "function") {
    webNavigation.getAllFrames = (details, callback) => complete(async () => [await buildMainFrame({
      tabId: details && details.tabId,
      frameId: 0,
    })], callback);
  }
  const originalWebNavigationGetAllFrames = typeof webNavigation.getAllFrames === "function"
    ? webNavigation.getAllFrames.bind(webNavigation)
    : null;
  webNavigation.getFrame = (details, callback) => complete(async () => {
    const nativeFrame = await callChromeApiWithCallback(originalWebNavigationGetFrame, [details || {}], null);
    if (nativeFrame && isValidUrlString(nativeFrame.url)) {
      return nativeFrame;
    }

    const payload = await callExtensionActionBridge("/web-navigation/get-frame", {
      extensionId: miloExtensionId || (chromeApi.runtime && chromeApi.runtime.id) || "",
      profileId: miloProfileId,
      details: details || {},
    });
    if (payload && payload.frame && isValidUrlString(payload.frame.url)) {
      return payload.frame;
    }
    return buildMainFrame(details || {});
  }, callback);
  webNavigation.getAllFrames = (details, callback) => complete(async () => {
    const nativeFrames = await callChromeApiWithCallback(originalWebNavigationGetAllFrames, [details || {}], null);
    if (Array.isArray(nativeFrames) && nativeFrames.length && nativeFrames.every((frame) => isValidUrlString(frame && frame.url))) {
      return nativeFrames;
    }

    const payload = await callExtensionActionBridge("/web-navigation/get-all-frames", {
      extensionId: miloExtensionId || (chromeApi.runtime && chromeApi.runtime.id) || "",
      profileId: miloProfileId,
      details: details || {},
    });
    if (payload && Array.isArray(payload.frames) && payload.frames.length) {
      return payload.frames.map((frame) => ({
        ...frame,
        url: isValidUrlString(frame && frame.url) ? frame.url : "about:blank",
      }));
    }
    return [await buildMainFrame({
      tabId: details && details.tabId,
      frameId: 0,
    })];
  }, callback);
  chromeApi.webNavigation = webNavigation;

  if (chromeApi.tabs && chromeApi.tabs.onUpdated && typeof chromeApi.tabs.onUpdated.addListener === "function") {
    chromeApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const url = (changeInfo && changeInfo.url) || (tab && (tab.url || tab.pendingUrl)) || "";
      const details = {
        tabId,
        frameId: 0,
        parentFrameId: -1,
        url,
        timeStamp: Date.now(),
      };
      if (changeInfo && changeInfo.url && typeof onHistoryStateUpdated.dispatch === "function") {
        onHistoryStateUpdated.dispatch(details);
      }
      if (changeInfo && changeInfo.status === "loading" && typeof onBeforeNavigate.dispatch === "function") {
        onBeforeNavigate.dispatch(details);
      }
      if (changeInfo && changeInfo.status === "complete" && typeof onCompleted.dispatch === "function") {
        onCompleted.dispatch(details);
      }
    });
  }
  if (chromeApi.tabs) {
    for (const eventName of ["onActivated", "onCreated", "onRemoved", "onUpdated"]) {
      ensureEvent(chromeApi.tabs, eventName);
      wrapEventListeners(chromeApi.tabs, eventName);
    }
  }

  const windows = chromeApi.windows || {};
  if (typeof windows.WINDOW_ID_NONE !== "number") {
    windows.WINDOW_ID_NONE = -1;
  }
  ensureEvent(windows, "onFocusChanged");
  wrapEventListeners(windows, "onFocusChanged");
  if (typeof windows.getCurrent !== "function") {
    windows.getCurrent = (callback) => complete(() => ({ id: 1, focused: true }), callback);
  }
  chromeApi.windows = windows;

  const contextMenus = chromeApi.contextMenus || {};
  ensureEvent(contextMenus, "onClicked");
  if (typeof contextMenus.create !== "function") {
    contextMenus.create = (properties, callback) => {
      if (typeof callback === "function") {
        setTimeout(callback, 0);
      }
      return properties && properties.id;
    };
  }
  for (const methodName of ["remove", "removeAll", "update"]) {
    if (typeof contextMenus[methodName] !== "function") {
      contextMenus[methodName] = function () {
        const callback = Array.from(arguments).find((argument) => typeof argument === "function");
        return complete(() => undefined, callback);
      };
    }
  }
  chromeApi.contextMenus = contextMenus;
  wrapEventListeners(contextMenus, "onClicked");

  const declarativeContent = chromeApi.declarativeContent || {};
  const onPageChanged = declarativeContent.onPageChanged || {};
  for (const methodName of ["addRules", "removeRules"]) {
    if (typeof onPageChanged[methodName] !== "function") {
      onPageChanged[methodName] = function () {
        const callback = Array.from(arguments).find((argument) => typeof argument === "function");
        return complete(() => undefined, callback);
      };
    }
  }
  if (typeof onPageChanged.getRules !== "function") {
    onPageChanged.getRules = function () {
      const callback = Array.from(arguments).find((argument) => typeof argument === "function");
      return complete(() => [], callback);
    };
  }
  declarativeContent.onPageChanged = onPageChanged;
  if (typeof declarativeContent.PageStateMatcher !== "function") {
    declarativeContent.PageStateMatcher = function PageStateMatcher(input) {
      Object.assign(this, input || {});
    };
  }
  if (typeof declarativeContent.ShowPageAction !== "function") {
    declarativeContent.ShowPageAction = function ShowPageAction(input) {
      Object.assign(this, input || {});
    };
  }
  chromeApi.declarativeContent = declarativeContent;

  const createMemoryStorageArea = () => {
    const store = new Map();
    const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    return {
      get(keys, callback) {
        return complete(() => {
          if (keys === null || keys === undefined) {
            return Object.fromEntries(Array.from(store.entries()).map(([key, value]) => [key, clone(value)]));
          }
          if (typeof keys === "string") {
            return { [keys]: clone(store.get(keys)) };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, clone(store.get(key))]));
          }
          if (typeof keys === "object") {
            return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
              key,
              store.has(key) ? clone(store.get(key)) : fallback,
            ]));
          }
          return {};
        }, callback);
      },
      set(items, callback) {
        return complete(() => {
          if (items && typeof items === "object") {
            for (const [key, value] of Object.entries(items)) {
              store.set(key, clone(value));
            }
          }
        }, callback);
      },
      remove(keys, callback) {
        return complete(() => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            store.delete(key);
          }
        }, callback);
      },
      clear(callback) {
        return complete(() => {
          store.clear();
        }, callback);
      },
      getBytesInUse(keys, callback) {
        return complete(() => 0, callback);
      },
      onChanged: createEvent(),
    };
  };

  chromeApi.storage = chromeApi.storage || {};
  if (!chromeApi.storage.local) {
    chromeApi.storage.local = createMemoryStorageArea();
  }
  const compatibleSyncStorage = chromeApi.storage.local || createMemoryStorageArea();
  try {
    chromeApi.storage.sync = compatibleSyncStorage;
  } catch {
    try {
      Object.defineProperty(chromeApi.storage, "sync", {
        configurable: true,
        enumerable: true,
        value: compatibleSyncStorage,
      });
    } catch {}
  }
  if (chromeApi.storage.sync && chromeApi.storage.sync !== compatibleSyncStorage) {
    for (const methodName of ["get", "set", "remove", "clear", "getBytesInUse"]) {
      try {
        chromeApi.storage.sync[methodName] = compatibleSyncStorage[methodName].bind(compatibleSyncStorage);
      } catch {}
    }
    if (!chromeApi.storage.sync.onChanged) {
      chromeApi.storage.sync.onChanged = createEvent();
    }
  }

  const privacy = chromeApi.privacy || {};
  privacy.services = privacy.services || {};
  const makePrivacySetting = () => ({
    get(details, callback) {
      return complete(() => ({ levelOfControl: "not_controllable", value: false }), callback);
    },
    set(details, callback) {
      return complete(() => false, callback);
    },
    clear(details, callback) {
      return complete(() => undefined, callback);
    },
    onChange: createEvent(),
  });
  for (const settingName of [
    "alternateErrorPagesEnabled",
    "autofillAddressEnabled",
    "autofillCreditCardEnabled",
    "autofillEnabled",
    "enableInPageAutoFill",
    "hotwordSearchEnabled",
    "passwordSavingEnabled",
    "safeBrowsingEnabled",
    "safeBrowsingExtendedReportingEnabled",
    "searchSuggestEnabled",
    "spellingServiceEnabled",
    "translationServiceEnabled",
  ]) {
    if (!privacy.services[settingName]) {
      privacy.services[settingName] = makePrivacySetting();
    }
  }
  try {
    privacy.services = new Proxy(privacy.services, {
      get(target, key) {
        if (typeof key === "string" && !(key in target)) {
          target[key] = makePrivacySetting();
        }
        return target[key];
      },
    });
  } catch {}
  chromeApi.privacy = privacy;

  if (chromeApi.runtime && typeof chromeApi.runtime.getFrameId !== "function") {
    chromeApi.runtime.getFrameId = () => 0;
  }
  if (chromeApi.runtime) {
    for (const eventName of [
      "onConnect",
      "onInstalled",
      "onMessage",
      "onSuspend",
      "onSuspendCanceled",
      "onUpdateAvailable",
    ]) {
      ensureEvent(chromeApi.runtime, eventName);
      wrapEventListeners(chromeApi.runtime, eventName);
    }
  }
})();`;

function isPathInsideDirectory(targetPath: string, directoryPath: string) {
  const normalizedDirectory = path.resolve(directoryPath);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedDirectory
    || normalizedTarget.startsWith(`${normalizedDirectory}${path.sep}`);
}

function sanitizeExtensionRecords(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as PersistedExtensionRecord[];
  }

  const sanitized: PersistedExtensionRecord[] = [];
  const seen = new Set<string>();

  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Partial<PersistedExtensionRecord>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const profileId = typeof record.profileId === "string" ? record.profileId.trim() : "";
    const extensionPath = typeof record.path === "string" ? record.path.trim() : "";
    const dedupeKey = `${profileId}:${id}`;

    if (!id || !profileId || !extensionPath || seen.has(dedupeKey)) {
      continue;
    }

    sanitized.push({
      id,
      profileId,
      name: typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : id,
      version: typeof record.version === "string" && record.version.trim()
        ? record.version.trim()
        : "0.0.0",
      description: typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : undefined,
      source: record.source === "chrome-web-store" ? "chrome-web-store" : "local-unpacked",
      path: path.resolve(extensionPath),
      enabled: Boolean(record.enabled),
      installedAt: Number.isFinite(record.installedAt) ? Number(record.installedAt) : Date.now(),
      updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : Date.now(),
      storeId: typeof record.storeId === "string" && record.storeId.trim()
        ? record.storeId.trim()
        : undefined,
      storeUrl: typeof record.storeUrl === "string" && record.storeUrl.trim()
        ? record.storeUrl.trim()
        : undefined,
      lastError: typeof record.lastError === "string" && record.lastError.trim()
        ? record.lastError.trim()
        : undefined,
    });

    seen.add(dedupeKey);
  }

  return sanitized;
}

function buildCanonicalChromeWebStoreUrl(extensionId: string) {
  return `https://chromewebstore.google.com/detail/${extensionId}`;
}

function normalizeChromeExtensionId(value: string) {
  const normalized = value.trim().toLowerCase();
  return EXTENSION_ID_PATTERN.test(normalized) ? normalized : "";
}

function parseChromeWebStoreReference(input: string): ChromeWebStoreReference {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("请输入 Chrome Web Store 链接或扩展 ID。");
  }

  const directId = normalizeChromeExtensionId(trimmed);
  if (directId) {
    return {
      id: directId,
      storeUrl: buildCanonicalChromeWebStoreUrl(directId),
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error("请输入有效的 Chrome Web Store 链接或扩展 ID。");
  }

  const idFromQuery = normalizeChromeExtensionId(parsedUrl.searchParams.get("id") ?? "");
  if (idFromQuery) {
    return {
      id: idFromQuery,
      storeUrl: buildCanonicalChromeWebStoreUrl(idFromQuery),
    };
  }

  const pathSegments = parsedUrl.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const idFromPath = pathSegments
    .map((segment) => normalizeChromeExtensionId(segment))
    .find((candidate) => candidate);

  if (!idFromPath) {
    throw new Error("未能从链接中识别扩展 ID。");
  }

  return {
    id: idFromPath,
    storeUrl: buildCanonicalChromeWebStoreUrl(idFromPath),
  };
}

function extractCrxZipPayload(buffer: Buffer) {
  if (buffer.length < 4) {
    throw new Error("下载到的扩展包无效。");
  }

  if (buffer.subarray(0, 4).toString("binary") === "PK\u0003\u0004") {
    return buffer;
  }

  if (buffer.subarray(0, 4).toString("ascii") !== "Cr24" || buffer.length < 12) {
    throw new Error("下载到的文件不是有效的 CRX 扩展包。");
  }

  const version = buffer.readUInt32LE(4);
  let zipOffset = 0;

  if (version === 2) {
    if (buffer.length < 16) {
      throw new Error("CRX2 头部不完整。");
    }
    const publicKeyLength = buffer.readUInt32LE(8);
    const signatureLength = buffer.readUInt32LE(12);
    zipOffset = 16 + publicKeyLength + signatureLength;
  } else if (version === 3) {
    const headerLength = buffer.readUInt32LE(8);
    zipOffset = 12 + headerLength;
  } else {
    throw new Error(`暂不支持的 CRX 版本: ${version}。`);
  }

  if (zipOffset <= 0 || zipOffset >= buffer.length) {
    throw new Error("CRX 扩展包头部解析失败。");
  }

  return buffer.subarray(zipOffset);
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = normalizeJsonValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }

  return value;
}

function normalizeManifestString(manifest: string) {
  const parsed = JSON.parse(manifest) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("扩展 manifest 无效。");
  }

  return JSON.stringify(normalizeJsonValue(parsed));
}

function resolveManifestRoot(directoryPath: string) {
  const directManifestPath = path.join(directoryPath, MANIFEST_FILE_NAME);
  if (existsSync(directManifestPath)) {
    return directoryPath;
  }

  const childEntries = readdirSync(directoryPath, {
    withFileTypes: true,
  }) as Array<{ isDirectory: () => boolean; name: string }>;
  const childDirectories = childEntries.filter((entry) => entry.isDirectory());

  if (childDirectories.length === 1) {
    const nestedDirectory = path.join(directoryPath, childDirectories[0].name);
    if (existsSync(path.join(nestedDirectory, MANIFEST_FILE_NAME))) {
      return nestedDirectory;
    }
  }

  throw new Error("扩展目录中缺少 manifest.json。");
}

function readManifestInfo(extensionDirectory: string) {
  const manifestPath = path.join(extensionDirectory, MANIFEST_FILE_NAME);
  if (!existsSync(manifestPath)) {
    throw new Error("扩展目录中缺少 manifest.json。");
  }

  const raw = readFileSync(manifestPath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    name: typeof parsed.name === "string" ? parsed.name.trim() : "",
    version: typeof parsed.version === "string" ? parsed.version.trim() : "",
    description: typeof parsed.description === "string" ? parsed.description.trim() : undefined,
  };
}

function readManifestObject(extensionDirectory: string) {
  const raw = readManifestRaw(extensionDirectory);
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("扩展 manifest 无效。");
  }

  return parsed as Record<string, unknown>;
}

function readManifestRaw(extensionDirectory: string) {
  const manifestPath = path.join(extensionDirectory, MANIFEST_FILE_NAME);
  if (!existsSync(manifestPath)) {
    throw new Error("扩展目录中缺少 manifest.json。");
  }

  return readFileSync(manifestPath, "utf-8");
}

function writeManifestObject(extensionDirectory: string, manifest: Record<string, unknown>) {
  const manifestPath = path.join(extensionDirectory, MANIFEST_FILE_NAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function removeUnsupportedManifestPermissions(manifest: Record<string, unknown>) {
  let changed = false;

  for (const key of ["permissions", "optional_permissions"]) {
    const value = manifest[key];
    if (!Array.isArray(value)) {
      continue;
    }

    const filteredValue = value.filter((entry) => {
      return typeof entry !== "string"
        || !ELECTRON_UNSUPPORTED_EXTENSION_PERMISSIONS.has(entry.trim());
    });
    if (filteredValue.length !== value.length) {
      manifest[key] = filteredValue;
      changed = true;
    }
  }

  return changed;
}

function ensureManifestStringArrayValue(
  manifest: Record<string, unknown>,
  key: string,
  value: string,
) {
  const existingValue = manifest[key];
  if (!Array.isArray(existingValue)) {
    manifest[key] = [value];
    return true;
  }

  if (existingValue.some((entry) => entry === value)) {
    return false;
  }

  manifest[key] = existingValue.concat(value);
  return true;
}

function ensureLocalBridgeManifestPermission(manifest: Record<string, unknown>) {
  const manifestVersion = Number(manifest.manifest_version);
  return ensureManifestStringArrayValue(
    manifest,
    Number.isFinite(manifestVersion) && manifestVersion >= 3 ? "host_permissions" : "permissions",
    MILO_LOCAL_BRIDGE_HOST_PERMISSION,
  );
}

function collectJavaScriptFiles(directoryPath: string) {
  const files: string[] = [];
  const entries = readdirSync(directoryPath, { withFileTypes: true }) as Array<{
    isDirectory: () => boolean;
    isFile: () => boolean;
    name: string;
  }>;

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

function removeExistingMiloCompatShim(source: string) {
  const startIndex = source.indexOf(MILO_EXTENSION_COMPAT_SHIM_START);
  if (startIndex < 0) {
    return source;
  }

  const endIndex = source.indexOf(MILO_EXTENSION_COMPAT_SHIM_END, startIndex);
  if (endIndex < 0) {
    return source;
  }

  const afterShimIndex = endIndex + MILO_EXTENSION_COMPAT_SHIM_END.length;
  const afterShim = source.slice(afterShimIndex)
    .replace(/^\r?\n/, "")
    .replace(MILO_COMPAT_POSTAMBLE_PATTERN, "");
  return `${source.slice(0, startIndex)}${afterShim}`;
}

function unwrapMiloCompatRuntimeErrors(source: string) {
  const useStrictMatch = source.match(/^(\s*(?:"use strict"|'use strict');\s*)/);
  const prefix = useStrictMatch?.[1] ?? "";
  const body = source.slice(prefix.length);
  if (
    !body.startsWith(MILO_COMPAT_RUNTIME_ERROR_WRAPPER_START)
    || !body.endsWith(MILO_COMPAT_RUNTIME_ERROR_WRAPPER_END)
  ) {
    return source;
  }

  return `${prefix}${body.slice(
    MILO_COMPAT_RUNTIME_ERROR_WRAPPER_START.length,
    body.length - MILO_COMPAT_RUNTIME_ERROR_WRAPPER_END.length,
  )}`;
}

function removeMiloCompatPostamble(source: string) {
  const useStrictMatch = source.match(/^(\s*(?:"use strict"|'use strict');\s*)/);
  const prefix = useStrictMatch?.[1] ?? "";
  const body = source.slice(prefix.length);
  return `${prefix}${body.replace(MILO_COMPAT_POSTAMBLE_PATTERN, "")}`;
}

function restoreMiloCompatSource(source: string) {
  let restored = source;
  for (let index = 0; index < 25; index += 1) {
    const previous = restored;
    restored = unwrapMiloCompatRuntimeErrors(
      removeMiloCompatPostamble(
        removeExistingMiloCompatShim(restored),
      ),
    );
    if (restored === previous) {
      return restored;
    }
  }
  return restored;
}

function rewriteMiloCompatSource(source: string) {
  return source
    .replaceAll(
      "g_nativeAppPort.postMessage(",
      "__miloSafeNativePostMessage(g_nativeAppPort, ",
    )
    .replaceAll(
      "chrome.tabs.sendMessage(",
      "__miloSafeTabsSendMessage(",
    )
    .replaceAll(
      "chrome.runtime.sendMessage(",
      "__miloSafeRuntimeSendMessage(",
    );
}

function normalizeManifestScriptPath(scriptPath: string) {
  return scriptPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveOriginalBackgroundScriptPath(serviceWorkerPath: string) {
  const normalizedPath = normalizeManifestScriptPath(serviceWorkerPath);
  if (!normalizedPath) {
    return "";
  }

  const directoryName = path.posix.dirname(normalizedPath);
  let baseName = path.posix.basename(normalizedPath);
  const compatPrefix = [
    MILO_COMPAT_BACKGROUND_SCRIPT_PREFIX,
    LEGACY_MILO_COMPAT_BACKGROUND_SCRIPT_PREFIX,
  ].find((prefix) => baseName.startsWith(prefix));
  if (compatPrefix) {
    baseName = baseName.slice(compatPrefix.length);
    const hashedCompatMatch = baseName.match(/^[a-f0-9]{12}_(.+)$/i);
    if (hashedCompatMatch) {
      baseName = hashedCompatMatch[1];
    }
  }

  return directoryName === "."
    ? baseName
    : `${directoryName}/${baseName}`;
}

function buildCompatBackgroundScriptPath(serviceWorkerPath: string, sourceHash: string) {
  const originalPath = resolveOriginalBackgroundScriptPath(serviceWorkerPath);
  if (!originalPath) {
    return "";
  }

  const directoryName = path.posix.dirname(originalPath);
  const baseName = path.posix.basename(originalPath);
  const compatBaseName = `${MILO_COMPAT_BACKGROUND_SCRIPT_PREFIX}${sourceHash}_${baseName}`;
  return directoryName === "."
    ? compatBaseName
    : `${directoryName}/${compatBaseName}`;
}

function isGeneratedCompatBackgroundScriptName(fileName: string) {
  return (
    fileName.startsWith(MILO_COMPAT_BACKGROUND_SCRIPT_PREFIX)
    || fileName.startsWith(LEGACY_MILO_COMPAT_BACKGROUND_SCRIPT_PREFIX)
  ) && fileName.toLowerCase().endsWith(".js");
}

function resolveExtensionRelativePath(extensionDirectory: string, relativePath: string) {
  const normalizedPath = normalizeManifestScriptPath(relativePath);
  if (!normalizedPath) {
    return "";
  }

  return path.join(extensionDirectory, ...normalizedPath.split("/"));
}

function writeCompatBridgeConfig(
  extensionDirectory: string,
  actionBridge: ExtensionActionBridgeInfo,
  nativeMessagingBridge: NativeMessagingBridgeInfo,
) {
  const configPath = path.join(extensionDirectory, MILO_COMPAT_BRIDGE_CONFIG_FILE_NAME);
  const configSource = `${JSON.stringify({
    actionBridge,
    nativeMessagingBridge,
  }, null, 2)}\n`;
  const currentConfigSource = existsSync(configPath)
    ? readFileSync(configPath, "utf-8")
    : "";
  if (currentConfigSource !== configSource) {
    writeFileSync(configPath, configSource, "utf-8");
  }
}

function ensureCompatBackgroundServiceWorker(
  extensionDirectory: string,
  manifest: Record<string, unknown>,
  extensionId: string,
  profileId: string,
) {
  const background = isPlainRecord(manifest.background) ? manifest.background : null;
  const serviceWorkerPath = typeof background?.service_worker === "string"
    ? background.service_worker.trim()
    : "";
  if (!background || !serviceWorkerPath) {
    return false;
  }

  const originalServiceWorkerPath = resolveOriginalBackgroundScriptPath(serviceWorkerPath);
  const originalSourcePath = resolveExtensionRelativePath(extensionDirectory, originalServiceWorkerPath);
  const currentSourcePath = resolveExtensionRelativePath(extensionDirectory, serviceWorkerPath);
  const sourcePath = originalSourcePath && existsSync(originalSourcePath)
    ? originalSourcePath
    : currentSourcePath;
  if (!sourcePath || !existsSync(sourcePath)) {
    return false;
  }

  const compatSource = injectMiloCompatShim(readFileSync(sourcePath, "utf-8"), {
    extensionId,
    profileId,
    wrapRuntimeErrors: true,
  });
  const compatSourceHash = createHash("sha256")
    .update(compatSource)
    .digest("hex")
    .slice(0, MILO_COMPAT_BACKGROUND_HASH_LENGTH);
  const compatServiceWorkerPath = buildCompatBackgroundScriptPath(
    originalServiceWorkerPath || serviceWorkerPath,
    compatSourceHash,
  );
  const compatPath = resolveExtensionRelativePath(extensionDirectory, compatServiceWorkerPath);
  if (!compatServiceWorkerPath || !compatPath) {
    return false;
  }

  mkdirSync(path.dirname(compatPath), { recursive: true });
  const currentCompatSource = existsSync(compatPath)
    ? readFileSync(compatPath, "utf-8")
    : "";
  let changed = false;
  if (currentCompatSource !== compatSource) {
    writeFileSync(compatPath, compatSource, "utf-8");
    changed = true;
  }

  if (background.service_worker !== compatServiceWorkerPath) {
    background.service_worker = compatServiceWorkerPath;
    changed = true;
  }

  return changed;
}

function removeGeneratedCompatBackgroundScripts(
  directoryPath: string,
  keepAbsolutePaths = new Set<string>(),
): boolean {
  let changed = false;
  const entries = readdirSync(directoryPath, { withFileTypes: true }) as Array<{
    isDirectory: () => boolean;
    isFile: () => boolean;
    name: string;
  }>;

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      changed = removeGeneratedCompatBackgroundScripts(entryPath, keepAbsolutePaths) || changed;
      continue;
    }

    if (
      entry.isFile()
      && isGeneratedCompatBackgroundScriptName(entry.name)
      && !keepAbsolutePaths.has(path.resolve(entryPath))
    ) {
      rmSync(entryPath, { force: true });
      changed = true;
    }
  }

  return changed;
}

function wrapMiloCompatRuntimeErrors(source: string) {
  return `${MILO_COMPAT_RUNTIME_ERROR_WRAPPER_START}${source}${MILO_COMPAT_RUNTIME_ERROR_WRAPPER_END}`;
}

function injectMiloCompatShim(
  source: string,
  options?: {
    extensionId?: string;
    profileId?: string;
    actionBridge?: ExtensionActionBridgeInfo;
    nativeMessagingBridge?: NativeMessagingBridgeInfo;
    wrapRuntimeErrors?: boolean;
  },
) {
  const sourceWithoutShim = rewriteMiloCompatSource(restoreMiloCompatSource(source));
  const shimConfig = [
    `globalThis.__miloExtensionId = ${JSON.stringify(options?.extensionId ?? "")};`,
    `globalThis.__miloProfileId = ${JSON.stringify(options?.profileId ?? "")};`,
    `globalThis.__miloBridgeConfigPath = ${JSON.stringify(MILO_COMPAT_BRIDGE_CONFIG_FILE_NAME)};`,
    "globalThis.__miloExtensionActionBridgeBaseUrl = \"\";",
    "globalThis.__miloExtensionActionBridgeToken = \"\";",
    "globalThis.__miloNativeMessagingBridgeBaseUrl = \"\";",
    "globalThis.__miloNativeMessagingBridgeToken = \"\";",
  ].join("\n");
  const shim = `${MILO_EXTENSION_COMPAT_SHIM_START}\n${shimConfig}\n${MILO_EXTENSION_COMPAT_SHIM}\n${MILO_EXTENSION_COMPAT_SHIM_END}\nvar chrome = globalThis.chrome;\nvar navigator = globalThis.navigator;\n`;
  const body = options?.wrapRuntimeErrors
    ? wrapMiloCompatRuntimeErrors(sourceWithoutShim)
    : sourceWithoutShim;
  const useStrictMatch = sourceWithoutShim.match(/^(\s*(?:"use strict"|'use strict');\s*)/);
  if (!useStrictMatch) {
    return `${shim}${body}`;
  }

  const prefix = useStrictMatch[1];
  const bodyWithoutStrictPrefix = options?.wrapRuntimeErrors
    ? wrapMiloCompatRuntimeErrors(sourceWithoutShim.slice(prefix.length))
    : sourceWithoutShim.slice(prefix.length);
  return `${prefix}${shim}${bodyWithoutStrictPrefix}`;
}

function shouldInjectMiloCompatShim(source: string) {
  return source.includes(MILO_EXTENSION_COMPAT_SHIM_START)
    || COMPATIBILITY_API_MARKERS.some((marker) => source.includes(marker));
}

function ensureManagedChromeWebStoreExtensionCompatibility(
  extensionDirectory: string,
  extensionId: string,
  profileId: string,
  actionBridge: ExtensionActionBridgeInfo,
  nativeMessagingBridge: NativeMessagingBridgeInfo,
) {
  const manifest = readManifestObject(extensionDirectory);
  let manifestChanged = removeUnsupportedManifestPermissions(manifest);
  let compatibilityChanged = manifestChanged;
  const javaScriptFiles = collectJavaScriptFiles(extensionDirectory);
  const manifestUsesNativeMessaging = Array.isArray(manifest.permissions)
    && manifest.permissions.some((entry) => entry === "nativeMessaging");
  let sourceUsesNativeMessaging = false;
  let sourceUsesActionBridge = false;
  let sourceNeedsShim = false;
  for (const filePath of javaScriptFiles) {
    try {
      if (isGeneratedCompatBackgroundScriptName(path.basename(filePath))) {
        continue;
      }
      const source = readFileSync(filePath, "utf-8");
      sourceUsesNativeMessaging = sourceUsesNativeMessaging
        || source.includes("chrome.runtime.connectNative");
      sourceUsesActionBridge = sourceUsesActionBridge
        || source.includes("chrome.action.openPopup")
        || source.includes("chrome.browserAction.openPopup");
      sourceNeedsShim = sourceNeedsShim || shouldInjectMiloCompatShim(source);
    } catch {}
  }

  if (manifestUsesNativeMessaging || sourceUsesNativeMessaging || sourceUsesActionBridge) {
    writeCompatBridgeConfig(extensionDirectory, actionBridge, nativeMessagingBridge);
    const bridgePermissionChanged = ensureLocalBridgeManifestPermission(manifest);
    manifestChanged = bridgePermissionChanged || manifestChanged;
    compatibilityChanged = bridgePermissionChanged || compatibilityChanged;
  }

  const background = isPlainRecord(manifest.background) ? manifest.background : null;
  const serviceWorkerPath = typeof background?.service_worker === "string"
    ? background.service_worker.trim()
    : "";
  const normalizedServiceWorkerPath = serviceWorkerPath
    ? normalizeManifestScriptPath(serviceWorkerPath)
    : "";
  const originalBackgroundServiceWorkerPath = serviceWorkerPath
    ? resolveOriginalBackgroundScriptPath(serviceWorkerPath)
    : "";
  const hasGeneratedCompatBackgroundServiceWorker = Boolean(
    normalizedServiceWorkerPath
      && originalBackgroundServiceWorkerPath
      && normalizedServiceWorkerPath !== originalBackgroundServiceWorkerPath,
  );
  const needsShim = manifestChanged || sourceNeedsShim;

  if (!needsShim) {
    if (background && hasGeneratedCompatBackgroundServiceWorker) {
      background.service_worker = originalBackgroundServiceWorkerPath;
      manifestChanged = true;
      compatibilityChanged = true;
    }
    compatibilityChanged = removeGeneratedCompatBackgroundScripts(extensionDirectory)
      || compatibilityChanged;
    if (manifestChanged) {
      writeManifestObject(extensionDirectory, manifest);
    }
    return compatibilityChanged;
  }

  const originalBackgroundPath = serviceWorkerPath
    ? resolveExtensionRelativePath(
      extensionDirectory,
      originalBackgroundServiceWorkerPath,
    )
    : "";
  const normalizedOriginalBackgroundPath = originalBackgroundPath
    ? path.resolve(originalBackgroundPath)
    : "";

  if (originalBackgroundPath && existsSync(originalBackgroundPath)) {
    const source = readFileSync(originalBackgroundPath, "utf-8");
    const restoredSource = restoreMiloCompatSource(source);
    if (restoredSource !== source) {
      writeFileSync(originalBackgroundPath, restoredSource, "utf-8");
      compatibilityChanged = true;
    }
  }

  for (const filePath of javaScriptFiles) {
    if (!isPathInsideDirectory(filePath, extensionDirectory)) {
      continue;
    }
    if (normalizedOriginalBackgroundPath && path.resolve(filePath) === normalizedOriginalBackgroundPath) {
      continue;
    }

    const baseName = path.basename(filePath);
    if (isGeneratedCompatBackgroundScriptName(baseName)) {
      continue;
    }

    const source = readFileSync(filePath, "utf-8");
    const nextSource = injectMiloCompatShim(source, {
      extensionId,
      profileId,
      actionBridge,
      nativeMessagingBridge,
      wrapRuntimeErrors: Boolean(originalBackgroundPath && filePath === originalBackgroundPath),
    });
    if (nextSource !== source) {
      writeFileSync(filePath, nextSource, "utf-8");
      compatibilityChanged = true;
    }
  }

  const backgroundChanged = ensureCompatBackgroundServiceWorker(
    extensionDirectory,
    manifest,
    extensionId,
    profileId,
  );
  manifestChanged = backgroundChanged || manifestChanged;
  compatibilityChanged = backgroundChanged || compatibilityChanged;

  const nextServiceWorkerPath = typeof background?.service_worker === "string"
    ? background.service_worker.trim()
    : "";
  const nextGeneratedBackgroundPath = nextServiceWorkerPath
    && isGeneratedCompatBackgroundScriptName(path.posix.basename(normalizeManifestScriptPath(nextServiceWorkerPath)))
    ? resolveExtensionRelativePath(extensionDirectory, nextServiceWorkerPath)
    : "";
  const keepGeneratedBackgroundPaths = new Set<string>();
  if (nextGeneratedBackgroundPath) {
    keepGeneratedBackgroundPaths.add(path.resolve(nextGeneratedBackgroundPath));
  }
  compatibilityChanged = removeGeneratedCompatBackgroundScripts(
    extensionDirectory,
    keepGeneratedBackgroundPaths,
  ) || compatibilityChanged;

  if (manifestChanged) {
    writeManifestObject(extensionDirectory, manifest);
  }

  return compatibilityChanged;
}

function readStringProperty(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function selectIconPath(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (!isPlainRecord(value)) {
    return "";
  }

  const iconEntries = Object.entries(value)
    .map(([size, iconPath]) => ({
      size: Number(size),
      iconPath: typeof iconPath === "string" ? iconPath.trim() : "",
    }))
    .filter((entry) => entry.iconPath && Number.isFinite(entry.size))
    .sort((left, right) => right.size - left.size);

  return iconEntries[0]?.iconPath ?? "";
}

function buildExtensionResourceUrl(extensionId: string, resourcePath: string) {
  const normalizedPath = resourcePath.trim().replace(/^\/+/, "");
  if (!normalizedPath) {
    return "";
  }

  return `chrome-extension://${extensionId}/${normalizedPath}`;
}

function resolveManifestAction(
  extensionId: string,
  manifest: Record<string, unknown>,
): BrowserExtensionActionSummary | undefined {
  const actionRecord = isPlainRecord(manifest.action)
    ? manifest.action
    : isPlainRecord(manifest.browser_action)
      ? manifest.browser_action
      : isPlainRecord(manifest.page_action)
        ? manifest.page_action
        : null;

  if (!actionRecord) {
    return undefined;
  }

  const defaultPopup = readStringProperty(actionRecord, "default_popup");
  if (!defaultPopup) {
    return undefined;
  }

  const title = readStringProperty(actionRecord, "default_title")
    || readStringProperty(manifest, "name")
    || extensionId;
  const iconPath = selectIconPath(actionRecord.default_icon) || selectIconPath(manifest.icons);
  const iconUrl = iconPath ? buildExtensionResourceUrl(extensionId, iconPath) : undefined;

  return {
    title,
    defaultPopup,
    popupUrl: buildExtensionResourceUrl(extensionId, defaultPopup),
    iconUrl,
  };
}

function buildChromeWebStoreDownloadUrl(extensionId: string) {
  const chromeVersion = process.versions.chrome || "120.0.0.0";
  const requestPayload = encodeURIComponent(`id=${extensionId}&installsource=ondemand&uc`);
  return `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=${encodeURIComponent(chromeVersion)}&x=${requestPayload}`;
}

function buildProfileDirectoryKey(profileId: string) {
  return createHash("sha256").update(profileId).digest("hex").slice(0, 16);
}

function normalizeChromeWebStoreInstallRequest(input: string | ChromeWebStoreInstallRequest) {
  if (typeof input === "string") {
    return {
      reference: parseChromeWebStoreReference(input),
    };
  }

  if (!input || typeof input !== "object") {
    throw new Error("请输入有效的 Chrome Web Store 安装参数。");
  }

  const extensionId = normalizeChromeExtensionId(
    typeof input.id === "string" ? input.id : "",
  );
  if (!extensionId) {
    throw new Error("未能从请求中识别扩展 ID。");
  }

  let storeUrl = buildCanonicalChromeWebStoreUrl(extensionId);
  if (typeof input.storeUrl === "string" && input.storeUrl.trim()) {
    try {
      const parsedStoreUrl = new URL(input.storeUrl.trim());
      storeUrl = parsedStoreUrl.toString();
    } catch {
      storeUrl = buildCanonicalChromeWebStoreUrl(extensionId);
    }
  }

  const manifest = typeof input.manifest === "string" && input.manifest.trim()
    ? normalizeManifestString(input.manifest.trim())
    : undefined;

  const localizedName = typeof input.localizedName === "string" && input.localizedName.trim()
    ? input.localizedName.trim()
    : undefined;

  const iconUrl = typeof input.iconUrl === "string" && input.iconUrl.trim()
    ? input.iconUrl.trim()
    : undefined;

  return {
    reference: {
      id: extensionId,
      storeUrl,
    },
    manifest,
    localizedName,
    iconUrl,
  };
}

export function createExtensionManager(context: ExtensionManagerContext) {
  const extensionStatePath = path.join(app.getPath("userData"), EXTENSION_STATE_FILE_NAME);
  const extensionStorageRoot = path.join(app.getPath("userData"), EXTENSION_STORAGE_DIRECTORY_NAME);
  const recordsByProfileId = new Map<string, PersistedExtensionRecord[]>();
  const observedProfileIds = new Set<string>();
  const pendingChromeWebStoreInstalls = new Map<string, PendingChromeWebStoreInstallApproval>();
  const activeChromeWebStoreInstallTasks = new Map<string, Promise<BrowserExtensionSummary>>();
  const actionBridgeToken = randomUUID();
  let actionBridgeServer: Server | null = null;
  let actionBridgeStartPromise: Promise<ExtensionActionBridgeInfo> | null = null;
  let actionBridgeBaseUrl = "";
  let activeActionPopupWindow: BrowserWindow | null = null;
  let activeActionPopupSource: {
    extensionId: string;
    profileId: string;
    chromeTabId: number;
  } | null = null;
  let nextExtensionChromeTabId = 1;
  const extensionTabIdsByKey = new Map<string, number>();
  const extensionTabKeysByChromeId = new Map<number, ExtensionMappedTab>();

  function getProfileSession(profileId: string) {
    return session.fromPartition(buildWorkspacePartition(profileId));
  }

  function normalizeExtensionTabUrl(url: string) {
    if (url.trim()) {
      try {
        return new URL(url).toString();
      } catch {}
    }
    return "about:blank";
  }

  function getExtensionChromeTabId(profileId: string, windowId: number, tabId: string) {
    const key = `${profileId}:${windowId}:${tabId}`;
    const existingId = extensionTabIdsByKey.get(key);
    if (existingId) {
      return existingId;
    }

    const chromeTabId = nextExtensionChromeTabId;
    nextExtensionChromeTabId += 1;
    extensionTabIdsByKey.set(key, chromeTabId);
    extensionTabKeysByChromeId.set(chromeTabId, {
      chromeTabId,
      profileId,
      windowId,
      tabId,
    });
    return chromeTabId;
  }

  function toChromeTab(profileId: string, snapshot: ExtensionBrowserTabSnapshot) {
    const chromeTabId = getExtensionChromeTabId(profileId, snapshot.windowId, snapshot.tabId);
    const url = normalizeExtensionTabUrl(snapshot.url);
    return {
      id: chromeTabId,
      index: Number.isFinite(snapshot.index) ? Number(snapshot.index) : 0,
      windowId: snapshot.windowId,
      active: snapshot.active ?? true,
      highlighted: snapshot.active ?? true,
      selected: snapshot.active ?? true,
      pinned: false,
      audible: false,
      discarded: false,
      autoDiscardable: true,
      incognito: false,
      status: snapshot.isLoading ? "loading" : "complete",
      title: snapshot.title ?? "",
      url,
      pendingUrl: url,
      favIconUrl: snapshot.favIconUrl,
    };
  }

  function resolveChromeTab(profileId: string, chromeTabId: number) {
    const mappedTab = extensionTabKeysByChromeId.get(chromeTabId);
    if (!mappedTab || mappedTab.profileId !== profileId) {
      return null;
    }

    const snapshot = context.resolveTab?.(profileId, mappedTab.windowId, mappedTab.tabId);
    return snapshot ? toChromeTab(profileId, snapshot) : null;
  }

  function resolveActionBridgeSourceTab(profileId: string, extensionId: string) {
    if (
      activeActionPopupSource
      && activeActionPopupSource.profileId === profileId
      && activeActionPopupSource.extensionId === extensionId
    ) {
      const tab = resolveChromeTab(profileId, activeActionPopupSource.chromeTabId);
      if (tab) {
        return tab;
      }
    }

    const ownerWindow = BrowserWindow.getFocusedWindow();
    const snapshot = context.resolveActiveTab?.(profileId, ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow : null);
    return snapshot ? toChromeTab(profileId, snapshot) : null;
  }

  function buildExtensionFrame(tab: ReturnType<typeof toChromeTab> | null, frameId = 0) {
    if (!tab) {
      return null;
    }

    return {
      tabId: tab.id,
      frameId,
      parentFrameId: frameId === 0 ? -1 : 0,
      frameType: frameId === 0 ? "outermost_frame" : "sub_frame",
      url: normalizeExtensionTabUrl(tab.url),
    };
  }

  function writeActionBridgeCorsHeaders(request: IncomingMessage, response: ServerResponse) {
    const origin = request.headers.origin;
    response.setHeader("Access-Control-Allow-Origin", typeof origin === "string" ? origin : "*");
    response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Access-Control-Max-Age", "86400");
    response.setHeader("Vary", "Origin");
  }

  function sendActionBridgeJson(response: ServerResponse, statusCode: number, payload: unknown) {
    if (response.headersSent || response.writableEnded) {
      return;
    }

    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload));
  }

  function readActionBridgeJsonBody(request: IncomingMessage) {
    return new Promise<unknown>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      request.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_EXTENSION_ACTION_BRIDGE_REQUEST_BYTES) {
          reject(new Error("Extension action bridge request body is too large."));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("error", reject);
      request.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf-8").trim();
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async function handleActionBridgeRequest(request: IncomingMessage, response: ServerResponse) {
    writeActionBridgeCorsHeaders(request, response);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${actionBridgeToken}` && requestUrl.searchParams.get("token") !== actionBridgeToken) {
      sendActionBridgeJson(response, 401, { error: "Unauthorized extension action bridge request." });
      return;
    }

    if (request.method !== "POST") {
      sendActionBridgeJson(response, 404, { error: "Extension action bridge route not found." });
      return;
    }

    const body = await readActionBridgeJsonBody(request);
    if (!isPlainRecord(body)) {
      sendActionBridgeJson(response, 400, { error: "Invalid extension action bridge request." });
      return;
    }

    const profileId = readStringProperty(body, "profileId");
    const extensionId = readStringProperty(body, "extensionId").toLowerCase();
    if (!profileId || !EXTENSION_ID_PATTERN.test(extensionId)) {
      sendActionBridgeJson(response, 400, { error: "Invalid extension action popup request." });
      return;
    }

    if (requestUrl.pathname === "/open-action-popup") {
      const ownerWindow = BrowserWindow.getFocusedWindow();
      const ownerBounds = ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow.getBounds() : null;
      await openActionPopup(
        profileId,
        extensionId,
        ownerBounds ? ownerWindow : null,
        ownerBounds
          ? {
            left: ownerBounds.width,
            top: 0,
            width: 0,
            height: 0,
          }
          : null,
      );
      sendActionBridgeJson(response, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname === "/tabs/query") {
      const queryInfo = isPlainRecord(body.queryInfo) ? body.queryInfo : {};
      if (queryInfo.active === false) {
        sendActionBridgeJson(response, 200, { tabs: [] });
        return;
      }

      const tab = resolveActionBridgeSourceTab(profileId, extensionId);
      sendActionBridgeJson(response, 200, { tabs: tab ? [tab] : [] });
      return;
    }

    if (requestUrl.pathname === "/tabs/get") {
      const requestedTabId = Number(body.tabId);
      const tab = Number.isFinite(requestedTabId)
        ? resolveChromeTab(profileId, requestedTabId)
        : null;
      sendActionBridgeJson(response, 200, {
        tab: tab ?? resolveActionBridgeSourceTab(profileId, extensionId),
      });
      return;
    }

    if (
      requestUrl.pathname === "/web-navigation/get-frame"
      || requestUrl.pathname === "/web-navigation/get-all-frames"
    ) {
      const details = isPlainRecord(body.details) ? body.details : {};
      const requestedTabId = Number(details.tabId);
      const requestedFrameId = Number(details.frameId);
      const tab = Number.isFinite(requestedTabId)
        ? resolveChromeTab(profileId, requestedTabId)
        : resolveActionBridgeSourceTab(profileId, extensionId);
      const frame = buildExtensionFrame(tab, Number.isFinite(requestedFrameId) ? requestedFrameId : 0);
      sendActionBridgeJson(response, 200, requestUrl.pathname.endsWith("get-all-frames")
        ? { frames: frame ? [frame] : [] }
        : { frame });
      return;
    }

    sendActionBridgeJson(response, 404, { error: "Extension action bridge route not found." });
  }

  function ensureExtensionActionBridgeStarted(): Promise<ExtensionActionBridgeInfo> {
    if (actionBridgeServer && actionBridgeBaseUrl) {
      return Promise.resolve({
        baseUrl: actionBridgeBaseUrl,
        token: actionBridgeToken,
      });
    }

    if (actionBridgeStartPromise) {
      return actionBridgeStartPromise;
    }

    actionBridgeServer = createServer((request, response) => {
      void handleActionBridgeRequest(request, response).catch((error) => {
        sendActionBridgeJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    actionBridgeStartPromise = new Promise<ExtensionActionBridgeInfo>((resolve, reject) => {
      const server = actionBridgeServer;
      if (!server) {
        reject(new Error("Extension action bridge server was not created."));
        return;
      }

      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address() as AddressInfo | null;
        if (!address || typeof address.port !== "number") {
          reject(new Error("Extension action bridge did not expose a TCP port."));
          return;
        }
        actionBridgeBaseUrl = `http://127.0.0.1:${address.port}`;
        resolve({
          baseUrl: actionBridgeBaseUrl,
          token: actionBridgeToken,
        });
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });

    return actionBridgeStartPromise;
  }

  async function clearExtensionServiceWorkerStorage(
    targetSession: Session,
    extensionId: string,
  ) {
    try {
      await targetSession.clearStorageData({
        origin: `chrome-extension://${extensionId}`,
        storages: ["serviceworkers", "cachestorage"],
      });
    } catch {
      // Clearing stale worker registrations is best effort; loadExtension will surface real failures.
    }
  }

  function getProfileRecords(profileId: string) {
    const existingRecords = recordsByProfileId.get(profileId);
    if (existingRecords) {
      return existingRecords;
    }

    const nextRecords: PersistedExtensionRecord[] = [];
    recordsByProfileId.set(profileId, nextRecords);
    return nextRecords;
  }

  function sortProfileRecords(profileId: string) {
    const records = getProfileRecords(profileId);
    records.sort((left, right) => {
      const nameOrder = left.name.localeCompare(right.name);
      if (nameOrder !== 0) {
        return nameOrder;
      }
      return left.id.localeCompare(right.id);
    });
  }

  function notifyChanged(profileId: string) {
    sortProfileRecords(profileId);
    context.onChanged?.(profileId);
  }

  function buildChromeWebStoreInstallKey(profileId: string, extensionId: string) {
    return `${profileId}:${extensionId}`;
  }

  function saveState() {
    const payload: ExtensionStatePayload = {
      version: EXTENSION_STATE_VERSION,
      extensions: Array.from(recordsByProfileId.values())
        .flatMap((records) => records.map((record) => ({ ...record })))
        .sort((left, right) => {
          const profileOrder = left.profileId.localeCompare(right.profileId);
          if (profileOrder !== 0) {
            return profileOrder;
          }
          return left.name.localeCompare(right.name);
        }),
    };

    writeFileSync(extensionStatePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  function loadState() {
    if (!existsSync(extensionStatePath)) {
      return;
    }

    try {
      const raw = readFileSync(extensionStatePath, "utf-8").trim();
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<ExtensionStatePayload> | unknown;
      const payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Partial<ExtensionStatePayload>
        : { extensions: [] as PersistedExtensionRecord[] };

      const sanitizedRecords = sanitizeExtensionRecords(payload.extensions);
      recordsByProfileId.clear();
      for (const record of sanitizedRecords) {
        getProfileRecords(record.profileId).push(record);
      }
      for (const profileId of recordsByProfileId.keys()) {
        sortProfileRecords(profileId);
      }
    } catch (error) {
      console.error("[Extensions] Failed to load extension state.", error);
    }
  }

  function observeProfileSession(profileId: string) {
    if (observedProfileIds.has(profileId)) {
      return;
    }

    const targetSession = getProfileSession(profileId);
    targetSession.extensions.on("extension-loaded", (_event, extension) => {
      const record = getProfileRecords(profileId).find((candidate) => candidate.id === extension.id);
      if (!record) {
        return;
      }

      record.name = extension.name || record.name;
      record.version = extension.version || record.version;
      record.description = typeof extension.manifest?.description === "string"
        ? String(extension.manifest.description).trim() || record.description
        : record.description;
      record.lastError = undefined;
      record.updatedAt = Date.now();
      saveState();
      notifyChanged(profileId);
    });

    targetSession.extensions.on("extension-unloaded", (_event, extension) => {
      const record = getProfileRecords(profileId).find((candidate) => candidate.id === extension.id);
      if (!record) {
        return;
      }

      notifyChanged(profileId);
    });

    observedProfileIds.add(profileId);
  }

  function isLoaded(profileId: string, extensionId: string) {
    return Boolean(getProfileSession(profileId).extensions.getExtension(extensionId));
  }

  function resolveRecordManifest(record: PersistedExtensionRecord) {
    const loadedExtension = getProfileSession(record.profileId).extensions.getExtension(record.id);
    if (isPlainRecord(loadedExtension?.manifest)) {
      return loadedExtension.manifest;
    }

    try {
      return readManifestObject(record.path);
    } catch {
      return null;
    }
  }

  function resolveRecordAction(record: PersistedExtensionRecord) {
    const manifest = resolveRecordManifest(record);
    if (!manifest) {
      return undefined;
    }

    return resolveManifestAction(record.id, manifest);
  }

  function toSummary(record: PersistedExtensionRecord): BrowserExtensionSummary {
    return {
      id: record.id,
      profileId: record.profileId,
      name: record.name,
      version: record.version,
      description: record.description,
      source: record.source,
      path: record.path,
      enabled: record.enabled,
      loaded: isLoaded(record.profileId, record.id),
      installedAt: record.installedAt,
      updatedAt: record.updatedAt,
      storeId: record.storeId,
      storeUrl: record.storeUrl,
      lastError: record.lastError,
      compatibility: getExtensionCompatibility(record.id, record.source),
      action: resolveRecordAction(record),
    };
  }

  function findRecord(profileId: string, extensionId: string) {
    return getProfileRecords(profileId).find((record) => record.id === extensionId);
  }

  function getChromeWebStoreInstallState(
    profileId: string,
    input: string | ChromeWebStoreInstallRequest,
  ): ChromeWebStoreInstallState {
    const request = normalizeChromeWebStoreInstallRequest(input);
    const installKey = buildChromeWebStoreInstallKey(profileId, request.reference.id);
    if (
      pendingChromeWebStoreInstalls.has(installKey)
      || activeChromeWebStoreInstallTasks.has(installKey)
    ) {
      return "pending";
    }

    const record = findRecord(profileId, request.reference.id);
    if (!record) {
      if (!isChromeWebStoreExtensionInstallAllowed(request.reference.id)) {
        return "unsupported";
      }

      return "installable";
    }

    if (!isChromeWebStoreExtensionInstallAllowed(record.id)) {
      return "unsupported";
    }

    return record.enabled ? "installed" : "disabled";
  }

  async function loadRecordIntoSession(
    profileId: string,
    record: PersistedExtensionRecord,
    options?: { forceReload?: boolean; rethrow?: boolean },
  ) {
    observeProfileSession(profileId);
    const targetSession = getProfileSession(profileId);
    try {
      let shouldReloadLoadedExtension = Boolean(options?.forceReload);
      const isManagedChromeWebStoreExtension = record.source === "chrome-web-store"
        && isPathInsideDirectory(record.path, extensionStorageRoot);
      if (
        isManagedChromeWebStoreExtension
      ) {
        const actionBridge = await ensureExtensionActionBridgeStarted();
        const nativeMessagingBridge = await ensureNativeMessagingBridgeStarted();
        shouldReloadLoadedExtension = ensureManagedChromeWebStoreExtensionCompatibility(
          record.path,
          record.id,
          profileId,
          actionBridge,
          nativeMessagingBridge,
        )
          || shouldReloadLoadedExtension;
      }

      const existingExtension = targetSession.extensions.getExtension(record.id);
      if (existingExtension && !shouldReloadLoadedExtension) {
        record.lastError = undefined;
        return existingExtension;
      }

      if (isManagedChromeWebStoreExtension) {
        await clearExtensionServiceWorkerStorage(targetSession, record.id);
      }

      if (existingExtension && shouldReloadLoadedExtension) {
        targetSession.extensions.removeExtension(record.id);
      }

      const loadedExtension = await targetSession.extensions.loadExtension(record.path, {
        allowFileAccess: true,
      });
      record.name = loadedExtension.name || record.name;
      record.version = loadedExtension.version || record.version;
      record.description = typeof loadedExtension.manifest?.description === "string"
        ? String(loadedExtension.manifest.description).trim() || record.description
        : record.description;
      record.lastError = undefined;
      record.updatedAt = Date.now();
      saveState();
      notifyChanged(profileId);
      return loadedExtension;
    } catch (error) {
      record.lastError = error instanceof Error ? error.message : String(error);
      record.updatedAt = Date.now();
      saveState();
      notifyChanged(profileId);
      if (options?.rethrow === false) {
        return null;
      }
      throw error;
    }
  }

  async function downloadChromeWebStorePackage(reference: ChromeWebStoreReference) {
    const requestUrl = buildChromeWebStoreDownloadUrl(reference.id);
    const requestUserAgent = context.resolveRequestUserAgent?.(requestUrl) ?? context.userAgent;
    const response = await net.fetch(requestUrl, {
      method: "GET",
      headers: {
        "user-agent": requestUserAgent,
      },
    });

    if (!response.ok) {
      throw new Error(`下载扩展失败，状态码 ${response.status}。`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  function buildManagedStoreExtensionPath(profileId: string, extensionId: string) {
    const profileDirectoryKey = buildProfileDirectoryKey(profileId);
    const targetDirectory = path.join(extensionStorageRoot, profileDirectoryKey, "store");
    mkdirSync(targetDirectory, { recursive: true });
    return path.join(targetDirectory, extensionId);
  }

  async function installChromeWebStoreReference(
    profileId: string,
    reference: ChromeWebStoreReference,
    approval?: PendingChromeWebStoreInstallApproval,
  ) {
    assertChromeWebStoreExtensionInstallAllowed(reference.id);

    const targetSession = getProfileSession(profileId);
    observeProfileSession(profileId);

    const existingRecord = findRecord(profileId, reference.id);
    if (existingRecord && isLoaded(profileId, reference.id)) {
      targetSession.extensions.removeExtension(reference.id);
    }

    const tempDirectory = mkdtempSync(path.join(app.getPath("temp"), EXTENSION_TEMP_PREFIX));
    try {
      const crxBuffer = await downloadChromeWebStorePackage(reference);
      const zipBuffer = extractCrxZipPayload(crxBuffer);
      const archivePath = path.join(tempDirectory, `${reference.id}.zip`);
      const extractedDirectory = path.join(tempDirectory, "extracted");
      writeFileSync(archivePath, zipBuffer);
      mkdirSync(extractedDirectory, { recursive: true });
      await extractZip(archivePath, { dir: extractedDirectory });

      const unpackedDirectory = resolveManifestRoot(extractedDirectory);
      const normalizedDownloadedManifest = normalizeManifestString(readManifestRaw(unpackedDirectory));
      if (approval?.manifest && approval.manifest !== normalizedDownloadedManifest) {
        throw new Error("商店页面返回的 manifest 与下载到的扩展不一致。");
      }
      const manifestInfo = readManifestInfo(unpackedDirectory);
      const finalDirectory = buildManagedStoreExtensionPath(profileId, reference.id);
      const stagingDirectory = `${finalDirectory}.tmp-${Date.now()}`;

      if (existsSync(stagingDirectory)) {
        rmSync(stagingDirectory, { recursive: true, force: true });
      }

      renameSync(unpackedDirectory, stagingDirectory);
      if (existsSync(finalDirectory)) {
        rmSync(finalDirectory, { recursive: true, force: true });
      }
      renameSync(stagingDirectory, finalDirectory);
      const actionBridge = await ensureExtensionActionBridgeStarted();
      const nativeMessagingBridge = await ensureNativeMessagingBridgeStarted();
      ensureManagedChromeWebStoreExtensionCompatibility(
        finalDirectory,
        reference.id,
        profileId,
        actionBridge,
        nativeMessagingBridge,
      );
      await clearExtensionServiceWorkerStorage(targetSession, reference.id);

      const loadedExtension = await targetSession.extensions.loadExtension(finalDirectory, {
        allowFileAccess: true,
      });
      if (loadedExtension.id !== reference.id) {
        throw new Error("下载到的扩展 ID 与商店页面不一致。");
      }

      const installedAt = existingRecord?.installedAt ?? Date.now();
      const nextRecord: PersistedExtensionRecord = {
        id: loadedExtension.id,
        profileId,
        name: loadedExtension.name || manifestInfo.name || approval?.localizedName || reference.id,
        version: loadedExtension.version || manifestInfo.version || "0.0.0",
        description: typeof loadedExtension.manifest?.description === "string"
          ? String(loadedExtension.manifest.description).trim() || manifestInfo.description
          : manifestInfo.description,
        source: "chrome-web-store",
        path: finalDirectory,
        enabled: true,
        installedAt,
        updatedAt: Date.now(),
        storeId: reference.id,
        storeUrl: approval?.storeUrl || reference.storeUrl,
      };

      const profileRecords = getProfileRecords(profileId);
      const currentRecordIndex = profileRecords.findIndex((record) => record.id === loadedExtension.id);
      if (currentRecordIndex >= 0) {
        const previousRecord = profileRecords[currentRecordIndex];
        profileRecords[currentRecordIndex] = nextRecord;
        if (
          previousRecord.source === "chrome-web-store"
          && previousRecord.path !== finalDirectory
          && isPathInsideDirectory(previousRecord.path, extensionStorageRoot)
        ) {
          rmSync(previousRecord.path, { recursive: true, force: true });
        }
      } else {
        profileRecords.push(nextRecord);
      }

      saveState();
      notifyChanged(profileId);
      return toSummary(nextRecord);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  }

  function beginChromeWebStoreInstall(
    profileId: string,
    input: ChromeWebStoreInstallRequest,
  ) {
    const request = normalizeChromeWebStoreInstallRequest(input);
    const installKey = buildChromeWebStoreInstallKey(profileId, request.reference.id);
    pendingChromeWebStoreInstalls.set(installKey, {
      id: request.reference.id,
      profileId,
      storeUrl: request.reference.storeUrl,
      manifest: request.manifest,
      localizedName: request.localizedName,
      iconUrl: request.iconUrl,
      createdAt: Date.now(),
    });

    return getChromeWebStoreInstallState(profileId, request.reference.id);
  }

  async function completeChromeWebStoreInstall(profileId: string, extensionId: string) {
    const normalizedExtensionId = normalizeChromeExtensionId(extensionId);
    if (!normalizedExtensionId) {
      throw new Error("未能识别扩展 ID。");
    }

    const installKey = buildChromeWebStoreInstallKey(profileId, normalizedExtensionId);
    const existingTask = activeChromeWebStoreInstallTasks.get(installKey);
    if (existingTask) {
      return existingTask;
    }

    const pendingApproval = pendingChromeWebStoreInstalls.get(installKey);
    if (!pendingApproval) {
      const existingRecord = findRecord(profileId, normalizedExtensionId);
      if (existingRecord) {
        return toSummary(existingRecord);
      }

      throw new Error("未找到待处理的 Chrome Web Store 安装请求。");
    }

    const task = installChromeWebStoreReference(
      profileId,
      {
        id: pendingApproval.id,
        storeUrl: pendingApproval.storeUrl,
      },
      pendingApproval,
    ).finally(() => {
      activeChromeWebStoreInstallTasks.delete(installKey);
      pendingChromeWebStoreInstalls.delete(installKey);
    });

    activeChromeWebStoreInstallTasks.set(installKey, task);
    return task;
  }

  async function installFromChromeWebStore(
    profileId: string,
    input: string | ChromeWebStoreInstallRequest,
  ) {
    const request = normalizeChromeWebStoreInstallRequest(input);
    assertChromeWebStoreExtensionInstallAllowed(request.reference.id);
    return installChromeWebStoreReference(profileId, request.reference, request.manifest || request.localizedName || request.iconUrl
      ? {
        id: request.reference.id,
        profileId,
        storeUrl: request.reference.storeUrl,
        manifest: request.manifest,
        localizedName: request.localizedName,
        iconUrl: request.iconUrl,
        createdAt: Date.now(),
      }
      : undefined);
  }

  async function installUnpacked(profileId: string, extensionPath: string) {
    const normalizedPath = path.resolve(extensionPath);
    const manifestRoot = resolveManifestRoot(normalizedPath);
    const manifestInfo = readManifestInfo(manifestRoot);
    const existingByPath = getProfileRecords(profileId)
      .find((record) => path.resolve(record.path) === manifestRoot);

    if (existingByPath) {
      existingByPath.enabled = true;
      await loadRecordIntoSession(profileId, existingByPath, {
        forceReload: true,
      });
      return toSummary(existingByPath);
    }

    observeProfileSession(profileId);
    const targetSession = getProfileSession(profileId);
    const loadedExtension = await targetSession.extensions.loadExtension(manifestRoot, {
      allowFileAccess: true,
    });

    const existingById = findRecord(profileId, loadedExtension.id);
    const nextRecord: PersistedExtensionRecord = {
      id: loadedExtension.id,
      profileId,
      name: loadedExtension.name || manifestInfo.name || loadedExtension.id,
      version: loadedExtension.version || manifestInfo.version || "0.0.0",
      description: typeof loadedExtension.manifest?.description === "string"
        ? String(loadedExtension.manifest.description).trim() || manifestInfo.description
        : manifestInfo.description,
      source: "local-unpacked",
      path: manifestRoot,
      enabled: true,
      installedAt: existingById?.installedAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    const profileRecords = getProfileRecords(profileId);
    if (existingById) {
      const existingIndex = profileRecords.findIndex((record) => record.id === loadedExtension.id);
      profileRecords[existingIndex] = nextRecord;
    } else {
      profileRecords.push(nextRecord);
    }

    saveState();
    notifyChanged(profileId);
    return toSummary(nextRecord);
  }

  async function setEnabled(profileId: string, extensionId: string, enabled: boolean) {
    const record = findRecord(profileId, extensionId);
    if (!record) {
      throw new Error("扩展不存在。");
    }

    if (enabled && record.source === "chrome-web-store") {
      assertChromeWebStoreExtensionInstallAllowed(record.id);
    }

    const targetSession = getProfileSession(profileId);
    if (!enabled) {
      record.enabled = false;
      record.lastError = undefined;
      record.updatedAt = Date.now();
      if (isLoaded(profileId, record.id)) {
        targetSession.extensions.removeExtension(record.id);
      }
      saveState();
      notifyChanged(profileId);
      return toSummary(record);
    }

    record.enabled = true;
    record.updatedAt = Date.now();
    saveState();
    await loadRecordIntoSession(profileId, record, {
      forceReload: true,
    });
    return toSummary(record);
  }

  async function reload(profileId: string, extensionId: string) {
    const record = findRecord(profileId, extensionId);
    if (!record) {
      throw new Error("扩展不存在。");
    }

    await loadRecordIntoSession(profileId, record, { forceReload: true });
    return toSummary(record);
  }

  async function remove(profileId: string, extensionId: string) {
    const profileRecords = getProfileRecords(profileId);
    const recordIndex = profileRecords.findIndex((record) => record.id === extensionId);
    if (recordIndex < 0) {
      throw new Error("扩展不存在。");
    }

    const [record] = profileRecords.splice(recordIndex, 1);
    const targetSession = getProfileSession(profileId);
    if (isLoaded(profileId, record.id)) {
      targetSession.extensions.removeExtension(record.id);
    }

    if (record.source === "chrome-web-store" && isPathInsideDirectory(record.path, extensionStorageRoot)) {
      rmSync(record.path, { recursive: true, force: true });
    }

    saveState();
    notifyChanged(profileId);
  }

  async function reveal(profileId: string, extensionId: string) {
    const record = findRecord(profileId, extensionId);
    if (!record) {
      throw new Error("扩展不存在。");
    }

    const openError = await shell.openPath(record.path);
    if (openError) {
      throw new Error(openError);
    }

    return record.path;
  }

  function normalizePopupAnchor(anchor: Partial<ExtensionActionPopupAnchor> | null | undefined) {
    return {
      left: Number.isFinite(anchor?.left) ? Number(anchor?.left) : 0,
      top: Number.isFinite(anchor?.top) ? Number(anchor?.top) : 0,
      width: Number.isFinite(anchor?.width) ? Number(anchor?.width) : 0,
      height: Number.isFinite(anchor?.height) ? Number(anchor?.height) : 0,
    };
  }

  function resolvePopupBounds(
    ownerWindow: BrowserWindow | null,
    anchor: Partial<ExtensionActionPopupAnchor> | null | undefined,
  ) {
    const popupWidth = 380;
    const popupHeight = 560;
    const ownerBounds = ownerWindow && !ownerWindow.isDestroyed()
      ? ownerWindow.getBounds()
      : screen.getPrimaryDisplay().workArea;
    const normalizedAnchor = normalizePopupAnchor(anchor);
    const display = screen.getDisplayMatching(ownerBounds);
    const workArea = display.workArea;
    const margin = 8;
    const preferredX = ownerBounds.x
      + Math.round(normalizedAnchor.left + normalizedAnchor.width - popupWidth);
    const preferredY = ownerBounds.y
      + Math.round(normalizedAnchor.top + normalizedAnchor.height + margin);

    return {
      width: popupWidth,
      height: popupHeight,
      x: Math.max(
        workArea.x + margin,
        Math.min(preferredX, workArea.x + workArea.width - popupWidth - margin),
      ),
      y: Math.max(
        workArea.y + margin,
        Math.min(preferredY, workArea.y + workArea.height - popupHeight - margin),
      ),
    };
  }

  async function openActionPopup(
    profileId: string,
    extensionId: string,
    ownerWindow: BrowserWindow | null,
    anchor?: Partial<ExtensionActionPopupAnchor> | null,
  ) {
    const record = findRecord(profileId, extensionId);
    if (!record) {
      throw new Error("扩展不存在。");
    }

    if (!record.enabled) {
      throw new Error("扩展未启用。");
    }

    const loadedExtension = await loadRecordIntoSession(profileId, record, {
      rethrow: true,
    });
    if (!loadedExtension) {
      throw new Error("扩展未加载。");
    }

    const action = resolveRecordAction(record);
    if (!action?.popupUrl) {
      throw new Error("该扩展没有可打开的 popup。");
    }

    if (activeActionPopupWindow && !activeActionPopupWindow.isDestroyed()) {
      activeActionPopupWindow.close();
    }

    const popupBounds = resolvePopupBounds(ownerWindow, anchor);
    const popupWindow = new BrowserWindow({
      ...popupBounds,
      parent: ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow : undefined,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        partition: buildWorkspacePartition(profileId),
      },
    });

    activeActionPopupWindow = popupWindow;
    const sourceSnapshot = context.resolveActiveTab?.(
      profileId,
      ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow : null,
    );
    activeActionPopupSource = sourceSnapshot
      ? {
        extensionId,
        profileId,
        chromeTabId: toChromeTab(profileId, sourceSnapshot).id,
      }
      : null;
    let popupContextMenuOpen = false;
    popupWindow.on("closed", () => {
      if (activeActionPopupWindow === popupWindow) {
        activeActionPopupWindow = null;
        activeActionPopupSource = null;
      }
    });
    popupWindow.on("blur", () => {
      if (
        !popupWindow.isDestroyed()
        && !popupContextMenuOpen
        && !popupWindow.webContents.isDevToolsOpened()
      ) {
        popupWindow.close();
      }
    });
    popupWindow.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url);
      return { action: "deny" };
    });
    popupWindow.webContents.on("context-menu", (_event, params) => {
      if (popupWindow.isDestroyed()) {
        return;
      }

      popupContextMenuOpen = true;
      const openDevTools = () => {
        if (!popupWindow.isDestroyed()) {
          popupWindow.webContents.openDevTools({ mode: "detach", activate: true });
        }
      };

      Menu.buildFromTemplate([
        {
          label: "打开 DevTools",
          click: openDevTools,
        },
        {
          label: "检查元素",
          click: () => {
            openDevTools();
            if (!popupWindow.isDestroyed()) {
              popupWindow.webContents.inspectElement(params.x, params.y);
            }
          },
        },
      ]).popup({
        window: popupWindow,
        callback: () => {
          popupContextMenuOpen = false;
          if (
            !popupWindow.isDestroyed()
            && !popupWindow.isFocused()
            && !popupWindow.webContents.isDevToolsOpened()
          ) {
            popupWindow.close();
          }
        },
      });
    });

    await popupWindow.loadURL(action.popupUrl);
    if (!popupWindow.isDestroyed()) {
      popupWindow.show();
      popupWindow.focus();
    }

    return action;
  }

  async function ensureProfileExtensionsLoaded(profileId: string) {
    observeProfileSession(profileId);
    const enabledRecords = getProfileRecords(profileId).filter((record) => record.enabled);
    for (const record of enabledRecords) {
      if (
        record.source === "chrome-web-store"
        && !isChromeWebStoreExtensionInstallAllowed(record.id)
      ) {
        record.enabled = false;
        record.lastError = "This extension is marked as unsupported in the Milo compatibility matrix.";
        record.updatedAt = Date.now();
        saveState();
        notifyChanged(profileId);
        continue;
      }

      await loadRecordIntoSession(profileId, record, { rethrow: false });
    }
  }

  function listExtensions(profileId: string) {
    observeProfileSession(profileId);
    return getProfileRecords(profileId).map((record) => toSummary(record));
  }

  function getInstalledProfileIds() {
    return Array.from(recordsByProfileId.keys());
  }

  loadState();

  return {
    beginChromeWebStoreInstall,
    completeChromeWebStoreInstall,
    ensureProfileExtensionsLoaded,
    getChromeWebStoreInstallState,
    getInstalledProfileIds,
    installFromChromeWebStore,
    installUnpacked,
    listExtensions,
    openActionPopup,
    reload,
    remove,
    reveal,
    setEnabled,
  };
}
