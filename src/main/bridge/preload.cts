import { clipboard, contextBridge, ipcRenderer } from "electron";
import type {
  AgentLaunchScheduleSnapshot,
  AgentMcpServerExport,
  AgentMcpToolCallInput,
  AgentSessionDeleteResult,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentSessionUpdate,
} from "../agent/browser-agent-service.js";

const INTERNAL_MILO_HOSTS = new Set(["home", "agent", "search", "tasks", "settings", "learning", "bookmarks", "history", "downloads", "workspace", "extensions", "user-scripts", "widgets", "widget-runtime", "render-preview"]);
const INTERNAL_PAGE_PATTERN = /\/(index|page-search|ai-sidebar|home|agent|search|tasks|settings|learning|bookmarks|history|downloads|workspace|extensions|user-scripts|widgets|widget-runtime|render-preview|workspace-create|folder-settings)\.html$/i;

function shouldExposeBrowserShell() {
  try {
    const currentUrl = new URL(window.location.href);

    if (currentUrl.protocol === "milo:") {
      return INTERNAL_MILO_HOSTS.has(currentUrl.hostname.toLowerCase());
    }

    if (currentUrl.protocol === "file:") {
      return INTERNAL_PAGE_PATTERN.test(currentUrl.pathname);
    }

    if (
      (currentUrl.protocol === "http:" || currentUrl.protocol === "https:")
      && (currentUrl.hostname === "127.0.0.1" || currentUrl.hostname === "localhost")
    ) {
      return currentUrl.pathname === "/" || currentUrl.pathname === "" || INTERNAL_PAGE_PATTERN.test(currentUrl.pathname);
    }
  } catch {
    return false;
  }

  return false;
}

type ShellUiLocale = "en-US" | "zh-CN";

function normalizeShellUiLocale(value: unknown): ShellUiLocale | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }
  if (normalized.startsWith("en")) {
    return "en-US";
  }
  return null;
}

const shellUiLocaleState: {
  locale: ShellUiLocale | null;
} = {
  locale: null,
};

const TAB_VIEW_ARGUMENT = "--milo-tab-view";
const LINK_PREVIEW_ARGUMENT = "--milo-link-preview";
const LINK_PREVIEW_SHELL_ARGUMENT = "--milo-link-preview-shell";
const isMacOs = process.platform === "darwin";

interface InputWritingAssistContextAction {
  label: string;
  primary: boolean;
  run: () => void;
}

interface InputWritingAssistOverlayBridge {
  isVisibleForTarget: (target: HTMLElement) => boolean;
  setContextActions: (target: HTMLElement, actions: InputWritingAssistContextAction[]) => boolean;
  clearContextActions: (target?: HTMLElement) => void;
  containsEvent: (event: Event) => boolean;
  onVisible: (listener: (target: HTMLElement) => void) => () => void;
}

let inputWritingAssistOverlayBridge: InputWritingAssistOverlayBridge | null = null;

interface LinkPreviewHoverPayload {
  url: string;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface LinkPreviewShellStatePayload {
  url: string;
  loading: boolean;
  progress: number;
}

interface LinkPreviewBackdropStatePayload {
  visible: boolean;
}

type SplitViewMenuMode = "horizontal" | "vertical" | "bento";

type SplitViewMenuAction =
  | "create-horizontal"
  | "create-vertical"
  | "create-bento"
  | "set-horizontal"
  | "set-vertical"
  | "set-bento"
  | "toggle-sync-scroll"
  | "separate-all";

type SplitViewMenuInput =
  | {
    kind: "toolbar";
    x?: number;
    y?: number;
    isActiveSplit: boolean;
    activeMode?: SplitViewMenuMode;
    canCreatePair: boolean;
    canCreateBento: boolean;
    canUseBentoLayout: boolean;
    syncScroll: boolean;
  }
  | {
    kind: "sidebar";
    x?: number;
    y?: number;
  };

interface UserScriptsToolbarPopupInput {
  anchor?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  targetUrl?: string;
}

interface ExtensionsToolbarMenuInput {
  anchor?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface SplitViewDragPreviewPayload {
  mode: "horizontal" | "vertical";
  side: "left" | "right" | "top" | "bottom";
}

interface SplitViewDragDropPayload extends SplitViewDragPreviewPayload {
  tabId: string;
}

interface SplitDragPreviewOverlayElements {
  root: HTMLDivElement;
  frame: HTMLDivElement;
  primary: HTMLDivElement;
  primaryLabel: HTMLDivElement;
  secondary: HTMLDivElement;
  divider: HTMLDivElement;
  footerLabel: HTMLDivElement;
}

function hasProcessArgument(name: string) {
  return process.argv.some((entry) => entry === name || entry.startsWith(`${name}=`));
}

function runWhenDocumentElementReady(callback: () => void) {
  if (document.documentElement) {
    callback();
    return;
  }

  const retry = () => runWhenDocumentElementReady(callback);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", retry, { once: true });
    return;
  }

  window.setTimeout(retry, 0);
}

const isTabViewContext = hasProcessArgument(TAB_VIEW_ARGUMENT);
const isLinkPreviewContext = hasProcessArgument(LINK_PREVIEW_ARGUMENT);
const isLinkPreviewShellContext = hasProcessArgument(LINK_PREVIEW_SHELL_ARGUMENT);

const CHROME_WEB_STORE_HOSTS = new Set(["chromewebstore.google.com", "chrome.google.com"]);
const CHROME_WEB_STORE_EXTENSION_ID_PATTERN = /^[a-p]{32}$/i;

type ChromeWebStoreInstallState = "installable" | "installed" | "disabled" | "pending" | "unsupported";

interface ChromeWebStoreInstallRequest {
  id: string;
  storeUrl?: string;
  manifest?: string;
  localizedName?: string;
  iconUrl?: string;
}

interface ChromeWebStoreBeginInstallResult {
  accepted: boolean;
  state: ChromeWebStoreInstallState;
}

function resolveShellUiLocale() {
  const locale = shellUiLocaleState.locale ?? navigator.language ?? "en-US";
  return locale.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

shellUiLocaleState.locale = normalizeShellUiLocale(navigator.language);
void ipcRenderer.invoke("settings:get-language")
  .then((language) => {
    shellUiLocaleState.locale = normalizeShellUiLocale(language) ?? shellUiLocaleState.locale;
  })
  .catch(() => undefined);
ipcRenderer.on("language:changed", (_event, language: unknown) => {
  shellUiLocaleState.locale = normalizeShellUiLocale(language);
});

interface SerializedCredentialDescriptor {
  type?: string;
  id: string;
  transports?: string[];
}

interface PasskeyCreateRequestPayload {
  origin: string;
  rpId?: string;
  rpName?: string;
  user: {
    id: string;
    name?: string;
    displayName?: string;
  };
  challenge: string;
  pubKeyCredParams: Array<{
    type?: string;
    alg?: number;
  }>;
  excludeCredentials: SerializedCredentialDescriptor[];
  residentKey?: string;
  requireResidentKey?: boolean;
  userVerification?: string;
  authenticatorAttachment?: string;
  attestation?: string;
}

interface PasskeyGetRequestPayload {
  origin: string;
  rpId?: string;
  challenge: string;
  allowCredentials: SerializedCredentialDescriptor[];
  userVerification?: string;
  mediation?: string;
}

interface SerializedAttestationCredential {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment: "platform";
  clientExtensionResults: Record<string, never>;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    authenticatorData: string;
    publicKey: string;
    publicKeyAlgorithm: number;
    transports: string[];
  };
}

interface SerializedAssertionCredential {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment: "platform";
  clientExtensionResults: Record<string, never>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
}

type PasskeyOperationResult<T> =
  | {
      ok: true;
      credential: T;
    }
  | {
      ok: false;
      error: {
        name: string;
        message: string;
      };
    };

function toBase64UrlBytes(value: Uint8Array) {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64UrlToArrayBuffer(value: string) {
  const normalized = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function toUint8Array(value: BufferSource) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }

  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

function serializeBufferSource(value: BufferSource, fieldName: string) {
  if (!value) {
    throw createPasskeyDomException("TypeError", `Missing required binary field: ${fieldName}.`);
  }

  return toBase64UrlBytes(toUint8Array(value));
}

function serializeCredentialDescriptors(
  descriptors?: PublicKeyCredentialDescriptor[] | null,
): SerializedCredentialDescriptor[] {
  if (!Array.isArray(descriptors)) {
    return [];
  }

  return descriptors.map((descriptor) => ({
    type: descriptor?.type,
    id: serializeBufferSource(descriptor.id, "credential.id"),
    transports: Array.isArray(descriptor.transports) ? descriptor.transports.slice() : undefined,
  }));
}

function createPasskeyDomException(name: string, message: string) {
  try {
    return new DOMException(message, name);
  } catch {
    const error = new Error(message);
    error.name = name;
    return error;
  }
}

function defineReadonly(target: object, key: PropertyKey, value: unknown) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: false,
    value,
  });
}

function overrideFunction(target: object | null | undefined, key: PropertyKey, value: unknown) {
  if (!target) {
    return false;
  }

  try {
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value,
    });
    return true;
  } catch {
    return false;
  }
}

function createObjectWithPrototype<T extends object>(prototype: object | null | undefined) {
  return Object.create(prototype ?? Object.prototype) as T;
}

function cloneArrayBuffer(buffer: ArrayBuffer) {
  return buffer.slice(0);
}

function buildAttestationResponse(
  payload: SerializedAttestationCredential["response"],
): AuthenticatorAttestationResponse {
  const prototype =
    typeof AuthenticatorAttestationResponse === "function"
      ? AuthenticatorAttestationResponse.prototype
      : Object.prototype;
  const response = createObjectWithPrototype<AuthenticatorAttestationResponse>(prototype);
  const clientDataJSON = fromBase64UrlToArrayBuffer(payload.clientDataJSON);
  const attestationObject = fromBase64UrlToArrayBuffer(payload.attestationObject);
  const authenticatorData = fromBase64UrlToArrayBuffer(payload.authenticatorData);
  const publicKey = fromBase64UrlToArrayBuffer(payload.publicKey);

  defineReadonly(response, "clientDataJSON", clientDataJSON);
  defineReadonly(response, "attestationObject", attestationObject);
  overrideFunction(response, "getAuthenticatorData", () => cloneArrayBuffer(authenticatorData));
  overrideFunction(response, "getPublicKey", () => cloneArrayBuffer(publicKey));
  overrideFunction(response, "getPublicKeyAlgorithm", () => payload.publicKeyAlgorithm);
  overrideFunction(response, "getTransports", () => payload.transports.slice());
  overrideFunction(response, "toJSON", () => ({
    clientDataJSON: payload.clientDataJSON,
    attestationObject: payload.attestationObject,
    transports: payload.transports.slice(),
  }));

  return response;
}

function buildAssertionResponse(
  payload: SerializedAssertionCredential["response"],
): AuthenticatorAssertionResponse {
  const prototype =
    typeof AuthenticatorAssertionResponse === "function"
      ? AuthenticatorAssertionResponse.prototype
      : Object.prototype;
  const response = createObjectWithPrototype<AuthenticatorAssertionResponse>(prototype);
  const clientDataJSON = fromBase64UrlToArrayBuffer(payload.clientDataJSON);
  const authenticatorData = fromBase64UrlToArrayBuffer(payload.authenticatorData);
  const signature = fromBase64UrlToArrayBuffer(payload.signature);
  const userHandle = payload.userHandle ? fromBase64UrlToArrayBuffer(payload.userHandle) : null;

  defineReadonly(response, "clientDataJSON", clientDataJSON);
  defineReadonly(response, "authenticatorData", authenticatorData);
  defineReadonly(response, "signature", signature);
  defineReadonly(response, "userHandle", userHandle);
  overrideFunction(response, "toJSON", () => ({
    clientDataJSON: payload.clientDataJSON,
    authenticatorData: payload.authenticatorData,
    signature: payload.signature,
    userHandle: payload.userHandle ?? null,
  }));

  return response;
}

function buildPublicKeyCredential(
  payload: SerializedAttestationCredential | SerializedAssertionCredential,
): PublicKeyCredential {
  const prototype = typeof PublicKeyCredential === "function"
    ? PublicKeyCredential.prototype
    : Object.prototype;
  const credential = createObjectWithPrototype<PublicKeyCredential>(prototype);
  const rawId = fromBase64UrlToArrayBuffer(payload.rawId);
  const response =
    "attestationObject" in payload.response
      ? buildAttestationResponse(payload.response)
      : buildAssertionResponse(payload.response);

  defineReadonly(credential, "id", payload.id);
  defineReadonly(credential, "rawId", rawId);
  defineReadonly(credential, "type", payload.type);
  defineReadonly(credential, "authenticatorAttachment", payload.authenticatorAttachment);
  defineReadonly(credential, "response", response);
  overrideFunction(credential, "getClientExtensionResults", () => ({ ...payload.clientExtensionResults }));
  overrideFunction(credential, "toJSON", () => ({
    id: payload.id,
    rawId: payload.rawId,
    type: payload.type,
    authenticatorAttachment: payload.authenticatorAttachment,
    response: typeof (response as unknown as { toJSON?: () => unknown }).toJSON === "function"
      ? (response as unknown as { toJSON: () => unknown }).toJSON()
      : undefined,
    clientExtensionResults: payload.clientExtensionResults,
  }));

  return credential;
}

function serializeCreateRequest(
  options: CredentialCreationOptions & { publicKey: PublicKeyCredentialCreationOptions },
): PasskeyCreateRequestPayload {
  const { publicKey } = options;
  return {
    origin: window.location.origin,
    rpId: publicKey.rp.id,
    rpName: publicKey.rp.name,
    user: {
      id: serializeBufferSource(publicKey.user.id, "user.id"),
      name: publicKey.user.name,
      displayName: publicKey.user.displayName,
    },
    challenge: serializeBufferSource(publicKey.challenge, "challenge"),
    pubKeyCredParams: Array.isArray(publicKey.pubKeyCredParams)
      ? publicKey.pubKeyCredParams.map((entry) => ({
        type: entry.type,
        alg: entry.alg,
      }))
      : [],
    excludeCredentials: serializeCredentialDescriptors(publicKey.excludeCredentials),
    residentKey: publicKey.authenticatorSelection?.residentKey,
    requireResidentKey: publicKey.authenticatorSelection?.requireResidentKey,
    userVerification: publicKey.authenticatorSelection?.userVerification,
    authenticatorAttachment: publicKey.authenticatorSelection?.authenticatorAttachment,
    attestation: publicKey.attestation,
  };
}

function serializeGetRequest(
  options: CredentialRequestOptions & { publicKey: PublicKeyCredentialRequestOptions },
): PasskeyGetRequestPayload {
  const { publicKey } = options;
  return {
    origin: window.location.origin,
    rpId: publicKey.rpId,
    challenge: serializeBufferSource(publicKey.challenge, "challenge"),
    allowCredentials: serializeCredentialDescriptors(publicKey.allowCredentials),
    userVerification: publicKey.userVerification,
    mediation: options.mediation,
  };
}

async function withAbortSignal<T>(signal: AbortSignal | undefined, promise: Promise<T>) {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    throw createPasskeyDomException("AbortError", "The operation was aborted.");
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(createPasskeyDomException("AbortError", "The operation was aborted."));
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function unwrapPasskeyResult<T>(result: PasskeyOperationResult<T>) {
  if (result.ok) {
    return result.credential;
  }

  throw createPasskeyDomException(result.error.name, result.error.message);
}

function installPasskeyBridge() {
  if (typeof navigator === "undefined" || !navigator.credentials) {
    return;
  }

  const credentialsContainer = navigator.credentials;
  const credentialsPrototype = Object.getPrototypeOf(credentialsContainer) as object | null;
  const originalCreate = credentialsContainer.create?.bind(credentialsContainer);
  const originalGet = credentialsContainer.get?.bind(credentialsContainer);
  const originalPreventSilentAccess = credentialsContainer.preventSilentAccess?.bind(credentialsContainer);

  const createHandler = async (
    options?: CredentialCreationOptions,
  ): Promise<Credential | null> => {
    if (!options?.publicKey) {
      if (originalCreate) {
        return originalCreate(options);
      }
      throw createPasskeyDomException("NotSupportedError", "Credential creation is not available.");
    }

    if (!window.isSecureContext) {
      throw createPasskeyDomException("SecurityError", "Passkeys are only available in secure browsing contexts.");
    }

    const result = await withAbortSignal(
      options.signal,
      ipcRenderer.invoke(
        "passkeys:create",
        serializeCreateRequest(options as CredentialCreationOptions & {
          publicKey: PublicKeyCredentialCreationOptions;
        }),
      ) as Promise<PasskeyOperationResult<SerializedAttestationCredential>>,
    );

    return buildPublicKeyCredential(unwrapPasskeyResult(result));
  };

  const getHandler = async (
    options?: CredentialRequestOptions,
  ): Promise<Credential | null> => {
    if (!options?.publicKey) {
      if (originalGet) {
        return originalGet(options);
      }
      throw createPasskeyDomException("NotSupportedError", "Credential retrieval is not available.");
    }

    if (!window.isSecureContext) {
      throw createPasskeyDomException("SecurityError", "Passkeys are only available in secure browsing contexts.");
    }

    const result = await withAbortSignal(
      options.signal,
      ipcRenderer.invoke(
        "passkeys:get",
        serializeGetRequest(options as CredentialRequestOptions & {
          publicKey: PublicKeyCredentialRequestOptions;
        }),
      ) as Promise<PasskeyOperationResult<SerializedAssertionCredential>>,
    );

    return buildPublicKeyCredential(unwrapPasskeyResult(result));
  };

  overrideFunction(credentialsContainer, "create", createHandler)
    || overrideFunction(credentialsPrototype, "create", createHandler);
  overrideFunction(credentialsContainer, "get", getHandler)
    || overrideFunction(credentialsPrototype, "get", getHandler);

  if (originalPreventSilentAccess) {
    overrideFunction(credentialsContainer, "preventSilentAccess", originalPreventSilentAccess)
      || overrideFunction(credentialsPrototype, "preventSilentAccess", originalPreventSilentAccess);
  }

  const publicKeyCredential = window.PublicKeyCredential as
    | (typeof PublicKeyCredential & Record<string, unknown>)
    | undefined;
  if (!publicKeyCredential) {
    return;
  }

  const userVerifyingHandler = () => Promise.resolve(window.isSecureContext);
  const conditionalHandler = () => Promise.resolve(window.isSecureContext);
  const capabilitiesHandler = () => Promise.resolve({
    conditionalGet: window.isSecureContext,
    userVerifyingPlatformAuthenticator: window.isSecureContext,
  });

  overrideFunction(
    publicKeyCredential,
    "isUserVerifyingPlatformAuthenticatorAvailable",
    userVerifyingHandler,
  );
  overrideFunction(publicKeyCredential, "isConditionalMediationAvailable", conditionalHandler);
  overrideFunction(publicKeyCredential, "getClientCapabilities", capabilitiesHandler);
}

installPasskeyBridge();

function resolveHoveredAnchor(event: PointerEvent) {
  const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];

  for (const node of eventPath) {
    if (!(node instanceof Element)) {
      continue;
    }

    const anchor = node.closest("a[href]");
    if (anchor) {
      return anchor;
    }
  }

  const fallbackTarget = document.elementFromPoint(event.clientX, event.clientY);
  if (!(fallbackTarget instanceof Element)) {
    return null;
  }

  return fallbackTarget.closest("a[href]");
}

function buildLinkPreviewHoverPayload(anchor: Element): LinkPreviewHoverPayload | null {
  const rawHref = anchor.getAttribute("href");
  if (!rawHref) {
    return null;
  }

  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(rawHref, window.location.href);
  } catch {
    return null;
  }

  if (resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:") {
    return null;
  }

  try {
    const currentUrl = new URL(window.location.href);
    const isHashOnlyNavigation =
      resolvedUrl.origin === currentUrl.origin
      && resolvedUrl.pathname === currentUrl.pathname
      && resolvedUrl.search === currentUrl.search
      && resolvedUrl.hash !== currentUrl.hash;

    if (resolvedUrl.href === currentUrl.href || isHashOnlyNavigation) {
      return null;
    }
  } catch {
    // Ignore malformed current URL edge cases and fall through.
  }

  const rect = anchor.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    url: resolvedUrl.toString(),
    bounds: {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function areHoverPayloadsEqual(
  left: LinkPreviewHoverPayload | null,
  right: LinkPreviewHoverPayload | null,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.url === right.url
    && left.bounds.left === right.bounds.left
    && left.bounds.top === right.bounds.top
    && left.bounds.width === right.bounds.width
    && left.bounds.height === right.bounds.height
  );
}

function resolveLinkPreviewLocale() {
  return resolveShellUiLocale().toLowerCase();
}

function getLinkPreviewMessages() {
  const locale = resolveLinkPreviewLocale();
  if (locale.startsWith("zh")) {
    return {
      loading: "正在加载预览…",
      copy: "复制链接",
      copySuccess: "链接已复制",
      copyFailed: "复制失败",
      close: "关闭预览",
      maximize: "最大化预览",
    };
  }

  return {
    loading: "Loading preview…",
    copy: "Copy URL",
    copySuccess: "URL copied",
    copyFailed: "Copy failed",
    close: "Close preview",
    maximize: "Maximize preview",
  };
}

function isLinkPreviewTriggerPressed(
  event: Pick<PointerEvent | KeyboardEvent, "ctrlKey" | "metaKey" | "getModifierState">,
) {
  if (isMacOs && typeof event.getModifierState === "function") {
    return event.getModifierState("Meta");
  }

  return isMacOs ? Boolean(event.metaKey) : Boolean(event.ctrlKey);
}

function isLinkPreviewTriggerReleaseKey(event: KeyboardEvent) {
  if (isMacOs) {
    return event.key === "Meta";
  }

  return event.key === "Control";
}

function installTabLinkPreviewTracking() {
  let lastPayload: LinkPreviewHoverPayload | null = null;

  const clearHover = () => {
    if (!lastPayload) {
      return;
    }

    lastPayload = null;
    ipcRenderer.send("link-preview:hover-leave");
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!isLinkPreviewTriggerPressed(event)) {
      clearHover();
      return;
    }

    const anchor = resolveHoveredAnchor(event);
    const nextPayload = anchor ? buildLinkPreviewHoverPayload(anchor) : null;

    if (!nextPayload) {
      clearHover();
      return;
    }

    if (areHoverPayloadsEqual(lastPayload, nextPayload)) {
      return;
    }

    lastPayload = nextPayload;
    ipcRenderer.send("link-preview:hover", nextPayload);
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (!isLinkPreviewTriggerReleaseKey(event)) {
      return;
    }

    clearHover();
  };

  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("pointerleave", clearHover, true);
  window.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("blur", clearHover);
  window.addEventListener("beforeunload", clearHover);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearHover();
    }
  });
}

function installLinkPreviewBackdropMask() {
  let mask: HTMLDivElement | null = null;
  let removeTimer: number | null = null;

  const clearRemoveTimer = () => {
    if (removeTimer === null) {
      return;
    }

    window.clearTimeout(removeTimer);
    removeTimer = null;
  };

  const ensureMaskStyles = () => {
    if (document.getElementById("milo-link-preview-backdrop-mask-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "milo-link-preview-backdrop-mask-styles";
    style.textContent = `
      #milo-link-preview-backdrop-mask {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483646 !important;
        pointer-events: none !important;
        opacity: 0 !important;
        background: rgba(2, 6, 23, 0.12) !important;
        backdrop-filter: blur(14px) saturate(128%) contrast(96%) !important;
        -webkit-backdrop-filter: blur(14px) saturate(128%) contrast(96%) !important;
        transition: opacity 160ms ease !important;
        transform: translateZ(0) !important;
        will-change: opacity, backdrop-filter !important;
      }

      #milo-link-preview-backdrop-mask[data-visible="true"] {
        opacity: 1 !important;
      }

      @media (prefers-color-scheme: light) {
        #milo-link-preview-backdrop-mask {
          background: rgba(248, 250, 252, 0.22) !important;
          backdrop-filter: blur(14px) saturate(135%) contrast(98%) !important;
          -webkit-backdrop-filter: blur(14px) saturate(135%) contrast(98%) !important;
        }
      }
    `;

    (document.head ?? document.documentElement).append(style);
  };

  const ensureMask = () => {
    ensureMaskStyles();

    if (mask?.isConnected) {
      return mask;
    }

    mask = document.createElement("div");
    mask.id = "milo-link-preview-backdrop-mask";
    mask.dataset.visible = "false";
    mask.setAttribute("aria-hidden", "true");
    (document.body ?? document.documentElement).append(mask);
    return mask;
  };

  const removeMaskSoon = () => {
    clearRemoveTimer();
    removeTimer = window.setTimeout(() => {
      removeTimer = null;
      if (mask?.dataset.visible !== "true") {
        mask?.remove();
        mask = null;
      }
    }, 220);
  };

  const setMaskVisible = (visible: boolean) => {
    const applyVisibility = () => {
      if (!visible && !mask) {
        return;
      }

      const targetMask = visible ? ensureMask() : mask;
      if (!targetMask) {
        return;
      }

      clearRemoveTimer();
      targetMask.dataset.visible = visible ? "true" : "false";

      if (!visible) {
        removeMaskSoon();
      }
    };

    runWhenDocumentElementReady(applyVisibility);
  };

  ipcRenderer.on("link-preview:backdrop-state", (_event, payload: LinkPreviewBackdropStatePayload) => {
    setMaskVisible(Boolean(payload?.visible));
  });

  window.addEventListener("beforeunload", () => {
    clearRemoveTimer();
    mask?.remove();
    mask = null;
  }, { once: true });
}

function installTabTitleTracking() {
  let lastSentTitle: string | null = null;
  let syncTimer: number | null = null;
  let titleObserver: MutationObserver | null = null;
  let headObserver: MutationObserver | null = null;

  const sendTitle = () => {
    syncTimer = null;
    const title = document.title ?? "";
    if (title === lastSentTitle) {
      return;
    }

    lastSentTitle = title;
    ipcRenderer.send("tab:document-title-changed", { title });
  };

  const scheduleSync = () => {
    if (syncTimer !== null) {
      return;
    }

    syncTimer = window.setTimeout(sendTitle, 250);
  };

  const observeTitleElement = () => {
    titleObserver?.disconnect();
    titleObserver = null;

    const titleElement = document.querySelector("title");
    if (!titleElement) {
      return;
    }

    titleObserver = new MutationObserver(scheduleSync);
    titleObserver.observe(titleElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  };

  const observeHead = () => {
    headObserver?.disconnect();
    headObserver = null;

    const target = document.head ?? document.documentElement;
    if (!target) {
      return;
    }

    headObserver = new MutationObserver(() => {
      observeTitleElement();
      scheduleSync();
      if (target !== document.head && document.head) {
        observeHead();
      }
    });
    headObserver.observe(target, {
      childList: true,
      subtree: target === document.head,
    });
  };

  const cleanup = () => {
    titleObserver?.disconnect();
    headObserver?.disconnect();
    window.removeEventListener("DOMContentLoaded", scheduleSync);
    window.removeEventListener("load", scheduleSync);
    if (syncTimer !== null) {
      window.clearTimeout(syncTimer);
      syncTimer = null;
    }
  };

  runWhenDocumentElementReady(() => {
    observeTitleElement();
    observeHead();
    scheduleSync();
  });
  window.addEventListener("DOMContentLoaded", scheduleSync);
  window.addEventListener("load", scheduleSync);
  window.addEventListener("beforeunload", cleanup, { once: true });
}

function readTabScrollState(): TabScrollSyncPayload {
  const root = document.scrollingElement || document.documentElement || document.body;
  const maxTop = Math.max(0, (root?.scrollHeight ?? 0) - window.innerHeight);
  const maxLeft = Math.max(0, (root?.scrollWidth ?? 0) - window.innerWidth);

  return {
    top: Math.max(0, Math.round(window.scrollY || root?.scrollTop || 0)),
    left: Math.max(0, Math.round(window.scrollX || root?.scrollLeft || 0)),
    maxTop,
    maxLeft,
  };
}

function readSplitViewDragPreview(event: DragEvent): SplitViewDragPreviewPayload {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const relativeX = event.clientX / width;
  const relativeY = event.clientY / height;
  const deltaX = relativeX - 0.5;
  const deltaY = relativeY - 0.5;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return {
      mode: "horizontal",
      side: deltaX < 0 ? "left" : "right",
    };
  }

  return {
    mode: "vertical",
    side: deltaY < 0 ? "top" : "bottom",
  };
}

const SIDEBAR_TAB_DRAG_DATA_TYPES = [
  "application/x-milo-tab-id",
  "text/x-milo-tab-id",
];

function readSidebarDragData(event: DragEvent) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) {
    return { hasTabDragType: false, tabId: null };
  }

  const types = new Set(Array.from(dataTransfer.types).map((type) => type.toLowerCase()));
  const hasTabDragType = SIDEBAR_TAB_DRAG_DATA_TYPES.some((type) => types.has(type));
  if (!hasTabDragType) {
    return { hasTabDragType: false, tabId: null };
  }

  for (const type of [...SIDEBAR_TAB_DRAG_DATA_TYPES, "text/plain"]) {
    try {
      const value = dataTransfer.getData(type).trim();
      if (value) {
        return { hasTabDragType: true, tabId: value };
      }
    } catch {
      // Some pages expose drag types but block reading the payload until drop.
    }
  }

  return { hasTabDragType: true, tabId: null };
}

function installSplitDragPreviewStyles() {
  if (document.getElementById("milo-split-drag-preview-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "milo-split-drag-preview-styles";
  style.textContent = `
    @keyframes milo-split-drag-pulse {
      0% {
        transform: scale(1);
        box-shadow: 0 18px 44px rgba(14, 165, 233, 0.18);
      }
      100% {
        transform: scale(1.016);
        box-shadow: 0 24px 52px rgba(14, 165, 233, 0.28);
      }
    }

    .milo-split-drag-preview {
      position: fixed;
      inset: 18px;
      z-index: 2147483647;
      pointer-events: none;
      opacity: 0;
      transform: scale(0.996);
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .milo-split-drag-preview[data-visible="true"] {
      opacity: 1;
      transform: scale(1);
    }

    .milo-split-drag-preview__frame {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border-radius: 26px;
      border: 1px dashed rgba(125, 211, 252, 0.6);
      background: rgba(14, 165, 233, 0.12);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
    }

    .milo-split-drag-preview__frame::before {
      content: "";
      position: absolute;
      inset: 12px;
      border-radius: 22px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(10, 14, 25, 0.2);
    }

    .milo-split-drag-preview__pane {
      position: absolute;
      border-radius: 20px;
      border: 1px solid rgba(125, 211, 252, 0.2);
      background: rgba(255, 255, 255, 0.08);
      transition: all 160ms ease;
    }

    .milo-split-drag-preview__pane--primary {
      display: flex;
      align-items: center;
      justify-content: center;
      border-color: rgba(125, 211, 252, 0.58);
      background: rgba(14, 165, 233, 0.22);
      animation: milo-split-drag-pulse 1.15s ease-in-out infinite alternate;
    }

    .milo-split-drag-preview__pane--secondary {
      opacity: 0.7;
    }

    .milo-split-drag-preview__hint {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 8px 14px;
      font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: rgba(224, 242, 254, 0.96);
      background: rgba(2, 6, 23, 0.78);
      box-shadow: 0 10px 26px rgba(2, 6, 23, 0.18);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      white-space: nowrap;
    }

    .milo-split-drag-preview__divider {
      position: absolute;
      background: rgba(125, 211, 252, 0.52);
      border-radius: 999px;
      transition: all 160ms ease;
    }

    .milo-split-drag-preview__footer {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 20px;
      display: flex;
      justify-content: center;
    }

    @media (prefers-color-scheme: light) {
      .milo-split-drag-preview__frame {
        border-color: rgba(14, 165, 233, 0.42);
        background: rgba(14, 165, 233, 0.1);
      }

      .milo-split-drag-preview__frame::before {
        border-color: rgba(15, 23, 42, 0.08);
        background: rgba(255, 255, 255, 0.38);
      }

      .milo-split-drag-preview__pane {
        border-color: rgba(15, 23, 42, 0.08);
        background: rgba(255, 255, 255, 0.44);
      }

      .milo-split-drag-preview__pane--primary {
        border-color: rgba(14, 165, 233, 0.48);
        background: rgba(56, 189, 248, 0.2);
      }

      .milo-split-drag-preview__hint {
        color: rgba(3, 105, 161, 0.96);
        background: rgba(255, 255, 255, 0.9);
      }

      .milo-split-drag-preview__divider {
        background: rgba(14, 165, 233, 0.35);
      }
    }
  `;

  (document.head ?? document.documentElement).append(style);
}

function applySplitDragOverlayStyles(
  element: HTMLElement,
  styles: Record<string, string | undefined>,
) {
  element.style.removeProperty("left");
  element.style.removeProperty("right");
  element.style.removeProperty("top");
  element.style.removeProperty("bottom");
  element.style.removeProperty("width");
  element.style.removeProperty("height");
  element.style.removeProperty("transform");

  for (const [key, value] of Object.entries(styles)) {
    if (typeof value !== "string") {
      continue;
    }

    element.style.setProperty(key, value);
  }
}

function getSplitDragPreviewLabel(preview: SplitViewDragPreviewPayload) {
  const locale = resolveShellUiLocale().toLowerCase();
  const messages = locale.startsWith("zh")
    ? {
      left: "释放后拆分到左侧",
      right: "释放后拆分到右侧",
      top: "释放后拆分到上方",
      bottom: "释放后拆分到下方",
    }
    : {
      left: "Drop to split left",
      right: "Drop to split right",
      top: "Drop to split top",
      bottom: "Drop to split bottom",
    };

  return messages[preview.side];
}

function createSplitDragPreviewOverlay(): SplitDragPreviewOverlayElements {
  installSplitDragPreviewStyles();

  const root = document.createElement("div");
  root.className = "milo-split-drag-preview";
  root.dataset.visible = "false";

  const frame = document.createElement("div");
  frame.className = "milo-split-drag-preview__frame";

  const primary = document.createElement("div");
  primary.className = "milo-split-drag-preview__pane milo-split-drag-preview__pane--primary";

  const primaryLabel = document.createElement("div");
  primaryLabel.className = "milo-split-drag-preview__hint";
  primary.append(primaryLabel);

  const secondary = document.createElement("div");
  secondary.className = "milo-split-drag-preview__pane milo-split-drag-preview__pane--secondary";

  const divider = document.createElement("div");
  divider.className = "milo-split-drag-preview__divider";

  const footer = document.createElement("div");
  footer.className = "milo-split-drag-preview__footer";

  const footerLabel = document.createElement("div");
  footerLabel.className = "milo-split-drag-preview__hint";
  footer.append(footerLabel);

  frame.append(primary, secondary, divider, footer);
  root.append(frame);

  return {
    root,
    frame,
    primary,
    primaryLabel,
    secondary,
    divider,
    footerLabel,
  };
}

function readSplitDragPreviewLayout(preview: SplitViewDragPreviewPayload) {
  const outerInset = 0;
  const gap = 0;
  const frameInset = `${outerInset}px`;

  if (preview.mode === "horizontal") {
    const width = `calc((100% - ${outerInset * 2 + gap}px) / 2)`;

    return preview.side === "left"
      ? {
        primary: { left: frameInset, top: frameInset, width, height: `calc(100% - ${outerInset * 2}px)` },
        secondary: { right: frameInset, top: frameInset, width, height: `calc(100% - ${outerInset * 2}px)` },
        divider: {
          left: "50%",
          top: frameInset,
          width: "3px",
          height: `calc(100% - ${outerInset * 2}px)`,
          transform: "translateX(-50%)",
        },
      }
      : {
        primary: { right: frameInset, top: frameInset, width, height: `calc(100% - ${outerInset * 2}px)` },
        secondary: { left: frameInset, top: frameInset, width, height: `calc(100% - ${outerInset * 2}px)` },
        divider: {
          left: "50%",
          top: frameInset,
          width: "3px",
          height: `calc(100% - ${outerInset * 2}px)`,
          transform: "translateX(-50%)",
        },
      };
  }

  const height = `calc((100% - ${outerInset * 2 + gap}px) / 2)`;
  return preview.side === "top"
    ? {
      primary: { left: frameInset, top: frameInset, width: `calc(100% - ${outerInset * 2}px)`, height },
      secondary: { left: frameInset, bottom: frameInset, width: `calc(100% - ${outerInset * 2}px)`, height },
      divider: {
        left: frameInset,
        top: "50%",
        width: `calc(100% - ${outerInset * 2}px)`,
        height: "3px",
        transform: "translateY(-50%)",
      },
    }
    : {
      primary: { left: frameInset, bottom: frameInset, width: `calc(100% - ${outerInset * 2}px)`, height },
      secondary: { left: frameInset, top: frameInset, width: `calc(100% - ${outerInset * 2}px)`, height },
      divider: {
        left: frameInset,
        top: "50%",
        width: `calc(100% - ${outerInset * 2}px)`,
        height: "3px",
        transform: "translateY(-50%)",
      },
    };
}

function installTabViewInteractionTracking() {
  let scrollFrame = 0;
  let lastInteractionAt = 0;
  let lastSplitPreviewKey = "";
  let sidebarTabDragActive = false;
  let splitDragPreviewOverlay: SplitDragPreviewOverlayElements | null = null;
  let lastHistoryNavigation: {
    at: number;
    direction: "back" | "forward";
  } | null = null;

  const HISTORY_NAVIGATION_DEDUPE_MS = 220;
  const BACK_BUTTON_MASK = 8;
  const FORWARD_BUTTON_MASK = 16;

  const ensureSplitDragPreviewOverlay = () => {
    if (!splitDragPreviewOverlay) {
      splitDragPreviewOverlay = createSplitDragPreviewOverlay();
    }

    if (!splitDragPreviewOverlay.root.isConnected) {
      (document.body ?? document.documentElement).append(splitDragPreviewOverlay.root);
    }

    return splitDragPreviewOverlay;
  };

  const renderSplitPreviewOverlay = (preview: SplitViewDragPreviewPayload) => {
    const overlay = ensureSplitDragPreviewOverlay();
    const label = getSplitDragPreviewLabel(preview);
    const layout = readSplitDragPreviewLayout(preview);

    overlay.primaryLabel.textContent = label;
    overlay.footerLabel.textContent = label;
    applySplitDragOverlayStyles(overlay.primary, layout.primary);
    applySplitDragOverlayStyles(overlay.secondary, layout.secondary);
    applySplitDragOverlayStyles(overlay.divider, layout.divider);
    overlay.root.dataset.visible = "true";
  };

  const hideSplitPreviewOverlay = () => {
    if (!splitDragPreviewOverlay) {
      return;
    }

    splitDragPreviewOverlay.root.dataset.visible = "false";
  };

  const notifyInteraction = () => {
    const now = Date.now();
    if (now - lastInteractionAt < 80) {
      return;
    }

    lastInteractionAt = now;
    ipcRenderer.send("tab:view-interaction");
  };

  const resolveHistoryDirection = (
    event: MouseEvent | PointerEvent,
  ): "back" | "forward" | null => {
    if (event.button === 3) {
      return "forward";
    }

    if (event.button === 4) {
      return "back";
    }

    if ((event.buttons & BACK_BUTTON_MASK) !== 0) {
      return "forward";
    }

    if ((event.buttons & FORWARD_BUTTON_MASK) !== 0) {
      return "back";
    }

    return null;
  };

  const sendHistoryNavigation = (
    direction: "back" | "forward",
    event?: MouseEvent | PointerEvent | KeyboardEvent,
  ) => {
    notifyInteraction();

    if (!direction) {
      return;
    }

    const now = Date.now();
    if (
      lastHistoryNavigation
      && lastHistoryNavigation.direction === direction
      && now - lastHistoryNavigation.at < HISTORY_NAVIGATION_DEDUPE_MS
    ) {
      return;
    }

    lastHistoryNavigation = {
      at: now,
      direction,
    };
    event?.preventDefault();
    event?.stopPropagation();
    ipcRenderer.send("tab:view-history-navigation", {
      direction,
    });
  };

  const dispatchHistoryNavigation = (event: MouseEvent | PointerEvent) => {
    const direction = resolveHistoryDirection(event);
    if (!direction) {
      return;
    }

    sendHistoryNavigation(direction, event);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    if (event.key === "BrowserBack" || event.key === "GoBack") {
      sendHistoryNavigation("forward", event);
      return;
    }

    if (event.key === "BrowserForward" || event.key === "GoForward") {
      sendHistoryNavigation("back", event);
      return;
    }

    if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === "ArrowLeft") {
      sendHistoryNavigation("back", event);
      return;
    }

    if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === "ArrowRight") {
      sendHistoryNavigation("forward", event);
      return;
    }

    if (event.metaKey && !event.altKey && !event.ctrlKey && event.code === "BracketLeft") {
      sendHistoryNavigation("back", event);
      return;
    }

    if (event.metaKey && !event.altKey && !event.ctrlKey && event.code === "BracketRight") {
      sendHistoryNavigation("forward", event);
    }
  };

  const scheduleScrollSync = () => {
    if ((window as Window & { __miloSplitScrollSync?: unknown }).__miloSplitScrollSync) {
      return;
    }

    if (scrollFrame !== 0) {
      return;
    }

    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      if ((window as Window & { __miloSplitScrollSync?: unknown }).__miloSplitScrollSync) {
        return;
      }

      ipcRenderer.send("tab:view-scroll", readTabScrollState());
    });
  };

  const clearSplitPreview = () => {
    hideSplitPreviewOverlay();
    if (!lastSplitPreviewKey) {
      return;
    }

    lastSplitPreviewKey = "";
    ipcRenderer.send("tab:split-drag-leave");
  };

  const updateSplitPreview = (event: DragEvent) => {
    const sidebarDragData = readSidebarDragData(event);
    const sourceTabId = sidebarDragData.tabId;
    if (!sidebarTabDragActive && !sidebarDragData.hasTabDragType) {
      clearSplitPreview();
      return false;
    }

    event.preventDefault();
    const preview = readSplitViewDragPreview(event);
    renderSplitPreviewOverlay(preview);
    const previewKey = JSON.stringify({ ...preview, tabId: sourceTabId ?? "" });
    if (previewKey !== lastSplitPreviewKey) {
      lastSplitPreviewKey = previewKey;
      ipcRenderer.send(
        "tab:split-drag-preview",
        sourceTabId ? { ...preview, tabId: sourceTabId } : preview,
      );
    }
    return true;
  };

  window.addEventListener("pointerdown", notifyInteraction, true);
  window.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") {
      dispatchHistoryNavigation(event);
    }
  }, true);
  window.addEventListener("mousedown", dispatchHistoryNavigation, true);
  window.addEventListener("mouseup", dispatchHistoryNavigation, true);
  window.addEventListener("auxclick", dispatchHistoryNavigation, true);
  window.addEventListener("focus", notifyInteraction, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("wheel", notifyInteraction, { capture: true, passive: true });
  window.addEventListener("scroll", scheduleScrollSync, { capture: true, passive: true });
  window.addEventListener("dragenter", (event) => {
    void updateSplitPreview(event);
  }, true);
  window.addEventListener("dragover", (event) => {
    void updateSplitPreview(event);
  }, true);
  window.addEventListener("dragleave", (event) => {
    if (!sidebarTabDragActive) {
      return;
    }

    const leavingViewport =
      event.clientX <= 0
      || event.clientY <= 0
      || event.clientX >= window.innerWidth
      || event.clientY >= window.innerHeight;
    if (leavingViewport) {
      clearSplitPreview();
    }
  }, true);
  window.addEventListener("drop", (event) => {
    const sidebarDragData = readSidebarDragData(event);
    const sourceTabId = sidebarDragData.tabId;
    if (!sidebarTabDragActive && !sidebarDragData.hasTabDragType) {
      return;
    }

    event.preventDefault();
    const preview = readSplitViewDragPreview(event);
    clearSplitPreview();
    ipcRenderer.send(
      "tab:split-drag-drop",
      sourceTabId
        ? ({ ...preview, tabId: sourceTabId } satisfies SplitViewDragDropPayload)
        : preview,
    );
  }, true);
  const handleSidebarDragState = (_event: Electron.IpcRendererEvent, active: boolean) => {
    sidebarTabDragActive = Boolean(active);
    if (!sidebarTabDragActive) {
      clearSplitPreview();
    }
  };
  ipcRenderer.on("tab:sidebar-drag-state", handleSidebarDragState);
  window.addEventListener("blur", clearSplitPreview);
  window.addEventListener("beforeunload", () => {
    if (scrollFrame !== 0) {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    }
    if (splitDragPreviewOverlay?.root.isConnected) {
      splitDragPreviewOverlay.root.remove();
    }
    ipcRenderer.removeListener("tab:sidebar-drag-state", handleSidebarDragState);
    clearSplitPreview();
  }, { once: true });
}

function installLinkPreviewPointerTracking() {
  let pointerInside = false;

  const setPointerInside = (nextValue: boolean) => {
    if (pointerInside === nextValue) {
      return;
    }

    pointerInside = nextValue;
    ipcRenderer.send("link-preview:pointer-state", nextValue);
  };

  window.addEventListener("pointermove", () => {
    setPointerInside(true);
  }, true);
  window.addEventListener("pointerleave", () => {
    setPointerInside(false);
  }, true);
  window.addEventListener("blur", () => {
    setPointerInside(false);
  });
  window.addEventListener("beforeunload", () => {
    setPointerInside(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      setPointerInside(false);
    }
  });
}

function installLinkPreviewControls() {
  installLinkPreviewPointerTracking();
}

function installLinkPreviewShellUi() {
  installLinkPreviewPointerTracking();
  let currentState: LinkPreviewShellStatePayload = {
    url: "",
    loading: true,
    progress: 0,
  };
  let copyFeedback: "idle" | "ok" | "err" = "idle";
  let copyFeedbackResetTimer: number | null = null;

  const resetCopyFeedback = () => {
    if (copyFeedbackResetTimer !== null) {
      window.clearTimeout(copyFeedbackResetTimer);
      copyFeedbackResetTimer = null;
    }
    copyFeedback = "idle";
  };

  const copyTextWithExecCommand = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  };

  const copyPreviewUrl = async (value: string) => {
    const text = value.trim();
    if (!text) {
      return false;
    }

    try {
      const copied = await ipcRenderer.invoke("link-preview:copy-url", text);
      if (copied) {
        return true;
      }
    } catch {
      // Fall through to local clipboard strategies below.
    }

    try {
      clipboard.writeText(text);
      return true;
    } catch {
      // Fall through.
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through.
    }

    try {
      return copyTextWithExecCommand(text);
    } catch {
      return false;
    }
  };

  const syncCopyButtonFeedback = (
    copyButton: HTMLButtonElement,
    messages: ReturnType<typeof getLinkPreviewMessages>,
  ) => {
    copyButton.dataset.copyState = copyFeedback;
    const baseLabel = copyFeedback === "ok"
      ? messages.copySuccess
      : copyFeedback === "err"
        ? messages.copyFailed
        : messages.copy;
    copyButton.setAttribute("aria-label", baseLabel);
    copyButton.title = baseLabel;
  };

  const bindShellUi = () => {
    const urlInput = document.getElementById("preview-shell-url") as HTMLInputElement | null;
    const copyButton = document.getElementById("preview-shell-copy") as HTMLButtonElement | null;
    const closeButton = document.getElementById("preview-shell-close") as HTMLButtonElement | null;
    const maximizeButton = document.getElementById("preview-shell-maximize") as HTMLButtonElement | null;
    const progressTrack = document.getElementById("preview-shell-progress");
    const progressBar = document.getElementById("preview-shell-progress-bar");
    const loader = document.getElementById("preview-shell-loader");
    const label = document.querySelector<HTMLElement>(".loader-label");

    if (!urlInput || !copyButton || !closeButton || !maximizeButton || !progressTrack || !progressBar || !loader) {
      return;
    }

    if (!closeButton.dataset.bound) {
      closeButton.dataset.bound = "true";
      closeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ipcRenderer.send("link-preview:close");
      });
    }

    if (!maximizeButton.dataset.bound) {
      maximizeButton.dataset.bound = "true";
      maximizeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ipcRenderer.send("link-preview:maximize");
      });
    }

    if (!urlInput.dataset.bound) {
      urlInput.dataset.bound = "true";
      urlInput.addEventListener("focus", () => {
        urlInput.select();
      });
    }

    if (!copyButton.dataset.bound) {
      copyButton.dataset.bound = "true";
      copyButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const copied = await copyPreviewUrl(urlInput.value);
        copyFeedback = copied ? "ok" : "err";
        if (copyFeedbackResetTimer !== null) {
          window.clearTimeout(copyFeedbackResetTimer);
        }
        bindShellUi();
        copyFeedbackResetTimer = window.setTimeout(() => {
          copyFeedbackResetTimer = null;
          copyFeedback = "idle";
          bindShellUi();
        }, 1200);
      });
    }

    const messages = getLinkPreviewMessages();
    syncCopyButtonFeedback(copyButton, messages);
    closeButton.setAttribute("aria-label", messages.close);
    closeButton.title = messages.close;
    maximizeButton.setAttribute("aria-label", messages.maximize);
    maximizeButton.title = messages.maximize;
    if (label) {
      label.textContent = messages.loading;
    }

    const clampedProgress = Math.max(0, Math.min(1, Number(currentState.progress) || 0));
    urlInput.value = currentState.url;
    urlInput.title = currentState.url;
    copyButton.disabled = !currentState.url;
    maximizeButton.disabled = !currentState.url;
    loader.classList.toggle("hidden", !currentState.loading);
    progressTrack.classList.toggle("visible", clampedProgress < 0.999);
    progressBar.setAttribute("style", `transform: scaleX(${clampedProgress});`);
  };

  const applyShellState = (nextState: LinkPreviewShellStatePayload) => {
    currentState = {
      url: typeof nextState.url === "string" ? nextState.url : "",
      loading: Boolean(nextState.loading),
      progress: Number.isFinite(nextState.progress) ? Number(nextState.progress) : 0,
    };
    bindShellUi();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindShellUi, { once: true });
  } else {
    bindShellUi();
  }

  ipcRenderer.on("language:changed", bindShellUi);
  ipcRenderer.on("link-preview:shell-state", (_event, payload: LinkPreviewShellStatePayload) => {
    applyShellState(payload);
  });
  window.addEventListener("beforeunload", resetCopyFeedback, { once: true });
}

type WorkspaceProfileMode = "new" | "attached";

interface BrowserShellAppInfo {
  name: string;
  version: string;
  platform: string;
}

interface SystemNotificationInput {
  title?: string;
  body?: string;
  subtitle?: string;
  silent?: boolean;
  urgency?: "low" | "normal" | "critical";
}

interface SystemNotificationResult {
  shown: boolean;
  delivery?: "electron" | "macos-osascript";
  reason?: "app-not-ready" | "empty" | "unsupported";
}

interface WorkspaceSummary {
  id: string;
  name: string;
  profileId: string;
  profileMode: WorkspaceProfileMode;
  profileSourceWorkspaceId?: string;
  profileSourceWorkspaceName?: string;
  automationEnabled: boolean;
  tags?: string[];
  automationAttached: boolean;
  automationTargetId?: number;
  automationTargetUrl?: string;
  hasWindow: boolean;
  windowVisible: boolean;
  windowCount: number;
}

interface WindowTabSummary {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  favicon?: string;
  isLoading: boolean;
  isAutomationControlled?: boolean;
  manualInterventionMessage?: string;
}

interface WindowSummary {
  id: number;
  workspaceId: string;
  workspaceName: string;
  profileId: string;
  visible: boolean;
  focused: boolean;
  title: string;
  activeTabId?: string;
  tabCount: number;
  tabs: WindowTabSummary[];
}

interface BrowserBootstrapData {
  appInfo: BrowserShellAppInfo;
  currentWorkspace: WorkspaceSummary;
  currentWindow: WindowSummary;
  workspaces: WorkspaceSummary[];
  windows: WindowSummary[];
  sidebarOrganizationState?: SidebarOrganizationState;
}

type RenderPreviewFormat = "html" | "markdown";

interface RenderPreviewDocument {
  id: string;
  format: RenderPreviewFormat;
  content: string;
  sourceTitle?: string;
  sourceUrl?: string;
  createdAt: number;
}

interface CreateWorkspaceInput {
  name?: string;
  profileMode: WorkspaceProfileMode;
  profileSourceWorkspaceId?: string;
  appearanceSourceWorkspaceId?: string;
  showWindow: boolean;
}

interface OpenCreateWorkspaceDialogInput {
  sourceWorkspaceId: string;
  sourceWorkspaceName?: string;
}

interface OpenFolderSettingsDialogInput {
  workspaceId: string;
  folderId: string;
  name: string;
  icon?: string;
  backgroundColor?: string;
}

interface FolderSettingsUpdateInput {
  workspaceId: string;
  folderId: string;
  name: string;
  icon?: string;
  backgroundColor?: string;
}

interface RenameWorkspaceInput {
  workspaceId: string;
  name: string;
}

interface SwitchWorkspaceInput {
  workspaceId: string;
  sidebarWidth?: number;
  urlBarHeight?: number;
}

interface DeleteWorkspacesResult {
  deletedWorkspaceIds: string[];
  skippedWorkspaceIds: string[];
  skippedDetails?: Array<{
    workspaceId: string;
    reason: "protected" | "not_found" | "bound_agent";
    agentSessionId?: string;
    agentTitle?: string;
  }>;
}

interface CdpCommandInput {
  workspaceId: string;
  method: string;
  params?: Record<string, unknown>;
}

interface AutomationNavigateInput {
  workspaceId: string;
  url: string;
}

interface AutomationEvaluateInput {
  workspaceId: string;
  expression: string;
  awaitPromise?: boolean;
  returnByValue?: boolean;
}

interface SyncWindowStateInput {
  tabs: WindowTabSummary[];
  activeTabId?: string;
}

type SidebarOrganizationEntry =
  | { id: string; kind: "tab"; tabId: string }
  | { id: string; kind: "folder"; folderId: string }
  | { id: string; kind: "split"; splitId: string };

interface SidebarOrganizationFolderState {
  id: string;
  title: string;
  icon?: string;
  backgroundColor?: string;
  tabIds: string[];
  isExpanded: boolean;
}

interface SidebarOrganizationSplitState {
  id: string;
  mode: "horizontal" | "vertical" | "bento";
  tabIds: string[];
  focusedTabId: string;
  syncScroll: boolean;
}

interface SidebarOrganizationState {
  activeEntryId: string | null;
  entries: SidebarOrganizationEntry[];
  folders: Record<string, SidebarOrganizationFolderState>;
  splits: Record<string, SidebarOrganizationSplitState>;
}

interface TabStateUpdate {
  workspaceId?: string;
  tabs: WindowTabSummary[];
  activeTabId: string | null;
}

interface StartPageDockItem {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  createdAt: number;
}

interface StartPageAppearance {
  backgroundImage: string | null;
}

interface StartPageWidgetBase {
  gridH: number;
  gridW: number;
  gridX: number;
  gridY: number;
  id: string;
  title: string;
}

interface StartPageEmbedWidget extends StartPageWidgetBase {
  type: "embed";
  url: string;
}

interface StartPageProtocolWidget extends StartPageWidgetBase {
  source: string;
  type: "protocol";
}

interface StartPageNotesWidget extends StartPageWidgetBase {
  content: string;
  type: "notes";
}

type StartPageWidget =
  | StartPageEmbedWidget
  | StartPageProtocolWidget
  | StartPageNotesWidget;

interface StartPageWidgetsState {
  items: StartPageWidget[];
  migrated: boolean;
}

interface StartPageWidgetRefreshEvent {
  driftMs: number;
  reason: "interval";
  refreshedAt: number;
  refreshIntervalMs: number;
  scheduledAt: number;
  source: string;
  triggerId: string;
  widgetId: string;
  workspaceId: string;
}

interface StartPageShellLayout {
  shellHeight: number;
  shellWidth: number;
  viewHeight: number;
  viewWidth: number;
  viewX: number;
  viewY: number;
}

interface TabLayoutTileInput {
  tabId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TabLayoutUpdateInput {
  focusedTabId: string;
  syncScroll?: boolean;
  tiles: TabLayoutTileInput[];
}

interface TabScrollSyncPayload {
  top: number;
  left: number;
  maxTop: number;
  maxLeft: number;
}

interface BookmarkRecord {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId?: string | null;
  createdAt: number;
}

interface BookmarkFolderRecord {
  id: string;
  name: string;
  parentId?: string | null;
  importSourceId?: string;
  createdAt: number;
}

interface BookmarkImportSource {
  id: string;
  browserId: string;
  browserName: string;
  profileId: string;
  profileName: string;
  format: "chromium-json";
}

interface BookmarkImportResult {
  bookmarks: BookmarkRecord[];
  folders: BookmarkFolderRecord[];
  importedBookmarks: number;
  skippedBookmarks: number;
  importedFolders: number;
  sourceLabel: string;
}

interface HistoryRecord {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  createdAt: number;
  updatedAt: number;
  lastVisitedAt: number;
  visitCount: number;
  importSourceStats?: HistoryImportSourceStat[];
}

interface HistoryImportSourceStat {
  sourceId: string;
  visitCount: number;
  lastVisitedAt: number;
}

interface HistoryImportSource {
  id: string;
  browserId: string;
  browserName: string;
  profileId: string;
  profileName: string;
  format: "chromium-sqlite";
}

interface HistoryImportResult {
  records: HistoryRecord[];
  importedRecords: number;
  mergedRecords: number;
  skippedRecords: number;
  sourceLabel: string;
}

interface LearningHistoryPageSummary {
  url: string;
  title: string;
  visitCount: number;
  lastVisitedAt: number;
}

interface LearningHistorySiteSummary {
  siteId: string;
  domain: string;
  visitCount: number;
  uniquePageCount: number;
  observedDayCount: number;
  firstSeenAt: number;
  lastVisitedAt: number;
  activityLevel?: "high" | "medium" | "low";
  revisitPattern?: "habitual" | "balanced" | "exploratory";
  topPages: LearningHistoryPageSummary[];
  profileSummary?: string;
  commonIntents: string[];
  revisitDrivers: string[];
  confidence?: number;
}

interface LearningProgressItem {
  progressId: string;
  mode: "observe_workflow" | "learn_writing_style";
  workspaceId: string;
  domain: string;
  url?: string;
  pageTitle?: string;
  pageType?: string;
  updatedAt: number;
  eventCount: number;
  methods: Array<"input" | "click" | "scroll" | "navigation" | "dialog" | "download" | "typing">;
  latestEventKind?: string;
  latestEventSummary?: string;
  targetSummary?: string;
  contentPreview?: string;
  contextType?: "email" | "forum" | "article_editor" | "general_editor";
  slot?: "subject" | "body" | "title" | "comment" | "message" | "recipient" | "unknown";
  fieldHint?: string;
  recipientLabel?: string;
  charCount?: number;
  wordCount?: number;
}

interface LearningTaskStatus {
  state: "idle" | "running" | "paused" | "error_paused";
  mode: "off" | "on";
  pauseReason?: "manual" | "llm_error";
  pauseStage?: "episode_learning" | "history_profile_refinement" | "guidance_refinement" | "style_profile_refinement";
  pauseMessage?: string;
  pauseAt?: number;
  observerCount: number;
  activeWorkflowCount: number;
  activeWritingCount: number;
  queuedGuidanceRefinementCount: number;
  runningGuidanceRefinementCount: number;
  queuedHistoryProfileRefinementCount: number;
  runningHistoryProfileRefinementCount: number;
  queuedStyleProfileRefinementCount: number;
  runningStyleProfileRefinementCount: number;
  activeDomains: string[];
}

interface LearningStyleProfileSummary {
  profileId: string;
  domain?: string;
  scheme?: string;
  pageType?: string;
  contextType?: "email" | "forum" | "article_editor" | "general_editor";
  contextLabel?: string;
  slot?: "subject" | "body" | "title" | "comment" | "message" | "recipient" | "unknown";
  slotLabel?: string;
  fieldHint?: string;
  recipientKey?: string;
  recipientLabel?: string;
  tone?: string;
  formality?: string;
  searchStyle?: string;
  emailStyle?: string;
  forumStyle?: string;
  articleStyle?: string;
  notesStyle?: string;
  styleSummary?: string;
  commonPhrases: string[];
  exemplarSnippets: string[];
  exemplarCount: number;
  averageLength: number;
  confidence: number;
  lastUpdatedAt: number;
}

interface LearningPreferenceSignal {
  id?: string;
  key: string;
  value: string;
  category?: "recent_focus" | "stable_preference" | "negative_preference" | "workflow_preference";
  confidence: number;
  source: "explicit" | "observed" | "manual" | "agent_interaction" | "browsing_history" | "workflow_learning" | "writing_style";
  strength?: number;
  evidenceRefs?: string[];
  scope?: "global" | "workspace" | "domain";
  domain?: string;
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt?: number;
  status?: "active" | "stale" | "rejected";
  updatedAt: number;
}

interface LearningUserMemorySignalInput {
  profileId?: string;
  workspaceId?: string;
  signalId?: string;
  key?: string;
  category?: "recent_focus" | "stable_preference" | "negative_preference" | "workflow_preference";
  scope?: "global" | "workspace" | "domain";
  domain?: string;
}

interface LearningUserMemoryUpsertInput extends LearningUserMemorySignalInput {
  key: string;
  value: string;
  source?: "explicit" | "observed" | "manual" | "agent_interaction" | "browsing_history" | "workflow_learning" | "writing_style";
  confidence?: number;
  strength?: number;
  evidenceRefs?: string[];
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt?: number;
  status?: "active" | "stale" | "rejected";
}

interface LearningPreferenceProfileSummary {
  profileId: string;
  signals: LearningPreferenceSignal[];
  lastUpdatedAt: number;
}

interface LearningFlushResult {
  success: boolean;
  processedEventCount: number;
  learnedEpisodeCount: number;
  learnedGuidanceCount: number;
  writingSampleCount: number;
}

interface DownloadSegmentRecord {
  index: number;
  start: number;
  end: number;
  receivedBytes: number;
  tempPath: string;
}

interface DownloadRecord {
  id: string;
  source: "manual" | "browser";
  url: string;
  finalUrl: string;
  sourcePageUrl?: string;
  partition?: string;
  headers: Record<string, string>;
  filename: string;
  directory: string;
  targetPath: string;
  targetPathLocked: boolean;
  tempDirectory: string;
  mimeType?: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "canceled";
  threadCount: number;
  supportsRanges: boolean;
  totalBytes: number | null;
  receivedBytes: number;
  speedBytesPerSecond: number;
  fileExists: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  etag?: string;
  lastModified?: string;
  segments: DownloadSegmentRecord[];
}

interface BrowserExtensionActionSummary {
  title: string;
  popupUrl: string;
  defaultPopup: string;
  iconUrl?: string;
}

interface BrowserExtensionSummary {
  id: string;
  profileId: string;
  name: string;
  version: string;
  description?: string;
  source: "chrome-web-store" | "local-unpacked";
  path: string;
  enabled: boolean;
  loaded: boolean;
  installedAt: number;
  updatedAt: number;
  storeId?: string;
  storeUrl?: string;
  lastError?: string;
  compatibility: {
    level: "verified" | "candidate" | "blocked" | "unreviewed";
    installPolicy: "allow" | "warn" | "block";
    label: string;
    testedVersion?: string;
    testedAt?: string;
    knownIssues?: string[];
    missingApis?: string[];
  };
  action?: BrowserExtensionActionSummary;
}

type UserScriptRunAt = "document-idle";

interface UserScriptRecord {
  id: string;
  profileId: string;
  name: string;
  description?: string;
  enabled: boolean;
  matches: string[];
  excludes: string[];
  runAt: UserScriptRunAt;
  code: string;
  testCode?: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastMatchedUrl?: string;
  lastError?: string;
}

interface UserScriptCreateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  matches?: string[];
  excludes?: string[];
  runAt?: UserScriptRunAt;
  code?: string;
  testCode?: string;
}

interface UserScriptUpdateInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  matches?: string[];
  excludes?: string[];
  runAt?: UserScriptRunAt;
  code?: string;
  testCode?: string | null;
}

interface UserScriptRunResult {
  scriptId: string;
  name: string;
  url: string;
  success: boolean;
  ranAt: number;
  error?: string;
}

interface UserScriptTestAssertion {
  ok: boolean;
  message: string;
}

interface UserScriptTestResult {
  scriptId: string;
  name: string;
  url: string;
  success: boolean;
  ranAt: number;
  assertions: UserScriptTestAssertion[];
  error?: string;
}

type UserScriptAgentMode = "script" | "test" | "script-and-test";

interface UserScriptAgentGenerateInput {
  mode: UserScriptAgentMode;
  instruction: string;
  targetUrl?: string;
  pageTitle?: string;
  existingScript?: {
    name?: string;
    description?: string;
    matches?: string[];
    excludes?: string[];
    code?: string;
    testCode?: string;
  };
}

interface UserScriptAgentGenerateResult {
  name: string;
  description?: string;
  matches: string[];
  excludes: string[];
  code: string;
  testCode: string;
  notes?: string;
}

function isChromeWebStoreHost(hostname: string) {
  return CHROME_WEB_STORE_HOSTS.has(hostname.trim().toLowerCase());
}

function normalizeChromeWebStoreExtensionId(value: string) {
  const normalized = value.trim().toLowerCase();
  return CHROME_WEB_STORE_EXTENSION_ID_PATTERN.test(normalized) ? normalized : "";
}

function buildCanonicalChromeWebStoreUrl(extensionId: string) {
  return `https://chromewebstore.google.com/detail/${extensionId}`;
}

function parseChromeWebStorePageReference(url: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (!isChromeWebStoreHost(parsedUrl.hostname)) {
    return null;
  }

  const idFromQuery = normalizeChromeWebStoreExtensionId(parsedUrl.searchParams.get("id") ?? "");
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
    .map((segment) => normalizeChromeWebStoreExtensionId(segment))
    .find((candidate) => candidate);

  if (!idFromPath) {
    return null;
  }

  return {
    id: idFromPath,
    storeUrl: buildCanonicalChromeWebStoreUrl(idFromPath),
  };
}

function resolveChromeWebStorePageLocale() {
  const candidates = [
    shellUiLocaleState.locale,
    document.documentElement.lang,
    navigator.language,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().toLowerCase().startsWith("zh")) {
      return "zh-CN" as const;
    }
  }

  return "en-US" as const;
}

function getChromeWebStoreStrings() {
  return resolveChromeWebStorePageLocale() === "zh-CN"
    ? {
        add: "添加至 Milo",
        enable: "在 Milo 中启用",
        added: "已添加到 Milo",
        installing: "正在安装…",
        unsupported: "Milo 暂不支持",
        installFailed: "扩展安装失败",
        enableFailed: "扩展启用失败",
      }
    : {
        add: "Add to Milo",
        enable: "Enable in Milo",
        added: "Added to Milo",
        installing: "Installing...",
        unsupported: "Not supported in Milo",
        installFailed: "Extension installation failed",
        enableFailed: "Failed to enable the extension",
      };
}

function resolveChromeWebStoreActionButton() {
  const containerSelectors = [
    ".OdjmDb",
    "[jscontroller='ri2s0b']",
  ];

  for (const selector of containerSelectors) {
    const button = document.querySelector(`${selector} button`);
    if (button instanceof HTMLButtonElement) {
      return button;
    }
  }

  return null;
}

function resolveChromeWebStoreButtonLabelElement(button: HTMLButtonElement) {
  const label = button.querySelector("[jsname='V67aGc'], .UywwFc-vQzf8d");
  return label instanceof HTMLElement ? label : null;
}

function setChromeWebStoreButtonLabel(button: HTMLButtonElement, text: string) {
  const label = resolveChromeWebStoreButtonLabelElement(button);
  if (label) {
    if ((label.textContent ?? "").trim() === text) {
      return;
    }
    label.textContent = text;
    return;
  }

  if ((button.textContent ?? "").trim() === text) {
    return;
  }
  button.textContent = text;
}

function resolveChromeWebStoreInstallRequest() {
  const reference = parseChromeWebStorePageReference(window.location.href);
  if (!reference) {
    return null;
  }

  const title = document.querySelector("main h1, .Pa2dE");
  const icon = document.querySelector(".VgVgxc img, main img");

  return {
    id: reference.id,
    storeUrl: reference.storeUrl,
    localizedName:
      title instanceof HTMLElement && title.textContent
        ? title.textContent.trim() || undefined
        : undefined,
    iconUrl:
      icon instanceof HTMLImageElement && icon.src
        ? icon.src
        : undefined,
  } satisfies ChromeWebStoreInstallRequest;
}

function showChromeWebStoreError(message: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  window.alert(`${message}\n\n${detail}`);
}

function installChromeWebStorePageIntegration() {
  let currentUrl = window.location.href;
  if (!isChromeWebStoreHost(window.location.hostname)) {
    return;
  }

  let syncTimer: number | null = null;
  let syncSequence = 0;

  const scheduleSync = () => {
    if (syncTimer !== null) {
      return;
    }

    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      void syncActionButton();
    }, 60);
  };

  const syncActionButton = async () => {
    const request = resolveChromeWebStoreInstallRequest();
    if (!request) {
      return;
    }

    const button = resolveChromeWebStoreActionButton();
    if (!button) {
      return;
    }

    const sequence = ++syncSequence;
    const strings = getChromeWebStoreStrings();
    const label = resolveChromeWebStoreButtonLabelElement(button);
    const originalLabel = button.dataset.miloCwsOriginalLabel
      || label?.textContent?.trim()
      || button.textContent?.trim()
      || strings.add;
    button.dataset.miloCwsOriginalLabel = originalLabel;
    button.dataset.miloCwsExtensionId = request.id;

    if (button.dataset.miloCwsBound !== "1") {
      button.dataset.miloCwsBound = "1";
      button.addEventListener("click", (event) => {
        const targetButton = event.currentTarget instanceof HTMLButtonElement
          ? event.currentTarget
          : null;
        if (!targetButton) {
          return;
        }

        const interactiveEvent = event as Event & { stopImmediatePropagation?: () => void };
        interactiveEvent.stopImmediatePropagation?.();
        event.preventDefault();
        event.stopPropagation();

        void handleActionButtonClick(targetButton);
      }, true);
    }

    let state: ChromeWebStoreInstallState;
    try {
      state = await ipcRenderer.invoke(
        "extensions:chrome-web-store:get-status",
        request,
      ) as ChromeWebStoreInstallState;
    } catch {
      return;
    }

    if (sequence !== syncSequence || button.dataset.miloCwsExtensionId !== request.id) {
      return;
    }

    button.dataset.miloCwsState = state;
    if (state === "pending") {
      button.disabled = true;
      setChromeWebStoreButtonLabel(button, strings.installing);
      return;
    }

    if (state === "installed") {
      button.disabled = true;
      setChromeWebStoreButtonLabel(button, strings.added);
      return;
    }

    if (state === "unsupported") {
      button.disabled = true;
      setChromeWebStoreButtonLabel(button, strings.unsupported);
      return;
    }

    if (state === "disabled") {
      button.disabled = false;
      setChromeWebStoreButtonLabel(button, strings.enable);
      return;
    }

    button.disabled = false;
    setChromeWebStoreButtonLabel(button, strings.add);
  };

  const handleActionButtonClick = async (button: HTMLButtonElement) => {
    const request = resolveChromeWebStoreInstallRequest();
    if (!request) {
      return;
    }

    const strings = getChromeWebStoreStrings();
    const state = button.dataset.miloCwsState as ChromeWebStoreInstallState | undefined;
    if (state === "pending" || state === "installed") {
      return;
    }

    if (state === "disabled") {
      try {
        button.disabled = true;
        setChromeWebStoreButtonLabel(button, strings.installing);
        await ipcRenderer.invoke("extensions:set-enabled", request.id, true);
      } catch (error) {
        showChromeWebStoreError(strings.enableFailed, error);
      } finally {
        scheduleSync();
      }
      return;
    }

    try {
      button.disabled = true;
      setChromeWebStoreButtonLabel(button, strings.installing);
      const beginResult = await ipcRenderer.invoke(
        "extensions:chrome-web-store:begin-install",
        request,
      ) as ChromeWebStoreBeginInstallResult;
      if (!beginResult.accepted) {
        scheduleSync();
        return;
      }

      await ipcRenderer.invoke("extensions:chrome-web-store:complete-install", request.id);
    } catch (error) {
      showChromeWebStoreError(strings.installFailed, error);
    } finally {
      scheduleSync();
    }
  };

  const mutationObserver = new MutationObserver(() => {
    scheduleSync();
  });

  const handleExtensionsChanged = () => {
    scheduleSync();
  };

  mutationObserver.observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  const urlPollTimer = window.setInterval(() => {
    if (window.location.href === currentUrl) {
      return;
    }

    currentUrl = window.location.href;
    scheduleSync();
  }, 400);

  window.addEventListener("DOMContentLoaded", scheduleSync);
  window.addEventListener("load", scheduleSync);
  ipcRenderer.on("extensions:changed", handleExtensionsChanged);
  window.addEventListener("beforeunload", () => {
    mutationObserver.disconnect();
    window.clearInterval(urlPollTimer);
    if (syncTimer !== null) {
      window.clearTimeout(syncTimer);
    }
    ipcRenderer.removeListener("extensions:changed", handleExtensionsChanged);
  }, { once: true });

  scheduleSync();
}

function installInputWritingAssistIntegration() {
  if (shouldExposeBrowserShell() || isLinkPreviewContext || isLinkPreviewShellContext) {
    return;
  }

  if (window.top !== window) {
    return;
  }

  let currentUrl: URL;
  try {
    currentUrl = new URL(window.location.href);
  } catch {
    return;
  }

  if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
    return;
  }
  if (!document.documentElement) {
    runWhenDocumentElementReady(installInputWritingAssistIntegration);
    return;
  }

  const locale = resolveShellUiLocale();
  const strings = locale === "zh-CN"
    ? {
        polish: "润色",
        draft: "起草",
        generate: "生成",
        close: "收起",
        draftPlaceholder: "写下想让它帮你起草的要点或要求",
        waiting: "正在生成…",
        emptyPolish: "当前输入框里还没有可润色的内容。",
        emptyDraft: "先写下起草要求，或在输入框里放一段现有内容。",
        success: "已更新输入框内容。",
        unsupported: "当前输入框场景暂不支持。",
        fallbackLabel: "写作辅助",
      }
    : {
        polish: "Polish",
        draft: "Draft",
        generate: "Generate",
        close: "Close",
        draftPlaceholder: "Describe what you want drafted for this field",
        waiting: "Generating…",
        emptyPolish: "There is no current text to polish.",
        emptyDraft: "Add a drafting brief, or keep some existing text in the field.",
        success: "Field updated.",
        unsupported: "This writing surface is not supported yet.",
        fallbackLabel: "Writing Assist",
      };

  let bootstrapPromise: Promise<BrowserBootstrapData | null> | null = null;
  let activeTarget: HTMLElement | null = null;
  let activeContext:
    | {
        showMenu: boolean;
        supported: boolean;
        domain?: string;
        contextType?: string;
        contextLabel?: string;
        slot?: string;
        slotLabel?: string;
        recipientLabel?: string;
        matchReason?: string;
        styleProfile?: {
          styleSummary?: string;
        } | null;
        recentExamples: string[];
      }
    | null = null;
  let activeRequestBase:
    | {
        workspaceId: string;
        url?: string;
        pageTitle?: string;
        targetHint?: string;
        targetRole?: string;
        targetName?: string;
        targetLabel?: string;
        placeholder?: string;
        fieldHint?: string;
        contextType?: string;
        slot?: string;
        recipient?: string;
      }
    | null = null;
  let lookupVersion = 0;
  let hideTimer: number | null = null;
  const visibleListeners = new Set<(target: HTMLElement) => void>();

  const getWorkspaceId = async () => {
    if (!bootstrapPromise) {
      bootstrapPromise = ipcRenderer.invoke("browser:get-bootstrap-data")
        .then((payload) => payload as BrowserBootstrapData)
        .catch(() => null);
    }
    const payload = await bootstrapPromise;
    return payload?.currentWorkspace?.id || null;
  };

  const clip = (value: string | undefined, limit = 160) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      return undefined;
    }
    return normalized.length > limit
      ? `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
      : normalized;
  };

  const elementForNode = (target: EventTarget | Node | null) =>
    target instanceof HTMLElement
      ? target
      : (target instanceof Node
        ? target.parentElement
        : null);

  const isEditableTarget = (target: HTMLElement | null): target is HTMLElement => {
    if (!target) {
      return false;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (target.disabled || target.readOnly) {
        return false;
      }
    }
    if (target instanceof HTMLTextAreaElement) {
      return true;
    }
    if (target instanceof HTMLInputElement) {
      const type = (target.type || "").trim().toLowerCase();
      return !type || type === "text";
    }
    const role = target.getAttribute("role")?.trim().toLowerCase();
    return target.isContentEditable || role === "textbox";
  };

  const editableTextFor = (target: HTMLElement | null) => {
    if (!target) {
      return "";
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value || "";
    }
    if (target.isContentEditable) {
      return target.innerText || target.textContent || "";
    }
    return "";
  };

  const nameFor = (target: HTMLElement | null) =>
    clip(
      target?.getAttribute("aria-label")
      || target?.getAttribute("title")
      || target?.getAttribute("name")
      || undefined,
      120,
    );

  const labelFor = (target: HTMLElement | null) => {
    if (!target) {
      return undefined;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      if (target.labels?.length) {
        const labelText = Array.from(target.labels)
          .map((label) => label.textContent?.trim() || "")
          .filter(Boolean)
          .join(" | ");
        return clip(labelText, 120);
      }
    }
    const wrapped = target.closest("label");
    return clip(wrapped?.textContent || undefined, 120);
  };

  const targetHintFor = (target: HTMLElement | null) =>
    clip([
      target?.getAttribute("role"),
      nameFor(target),
      labelFor(target),
      target?.tagName?.toLowerCase(),
    ].filter(Boolean).join(" | "), 160);

  const fieldHintFor = (target: HTMLElement | null) =>
    clip([
      labelFor(target),
      nameFor(target),
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? target.placeholder
        : target?.getAttribute("placeholder"),
      target?.getAttribute("data-testid"),
      target?.id,
    ].filter(Boolean).join(" | "), 160);

  const controlSignalFor = (target: HTMLElement | null, limit = 260) =>
    clip([
      target?.getAttribute("role"),
      target?.getAttribute("aria-label"),
      target?.getAttribute("title"),
      target?.getAttribute("name"),
      target?.getAttribute("placeholder"),
      target?.getAttribute("autocomplete"),
      target?.getAttribute("inputmode"),
      target?.getAttribute("enterkeyhint"),
      target?.getAttribute("data-testid"),
      target?.getAttribute("data-test"),
      target?.getAttribute("data-qa"),
      target?.id,
      typeof target?.className === "string" ? target.className : undefined,
      labelFor(target),
    ].filter(Boolean).join(" "), limit) || "";

  const scopeSignalFor = (target: Element | null, limit = 700) => {
    if (!target) {
      return "";
    }
    return clip([
      target.getAttribute("role"),
      target.getAttribute("aria-label"),
      target.getAttribute("title"),
      target.getAttribute("name"),
      target.getAttribute("action"),
      target.getAttribute("data-testid"),
      target.getAttribute("data-test"),
      target.getAttribute("data-qa"),
      target.id,
      typeof (target as HTMLElement).className === "string" ? (target as HTMLElement).className : undefined,
      target.textContent,
    ].filter(Boolean).join(" "), limit) || "";
  };

  const SEARCH_OR_FILTER_HINT_PATTERN =
    /\b(search|filter|find|lookup|query|keyword|keywords|results|facet|facets)\b|搜索|筛选|过滤|查询|查找|检索|关键词/i;
  const AUTH_SCOPE_HINT_PATTERN =
    /\b(log[\s_-]?in|sign[\s_-]?in|sign[\s_-]?up|register|registration|create[\s_-]?account|account[\s_-]?signup|auth|authentication|password|passwd|pwd|credential|credentials|verify|verification|captcha|otp|2fa|mfa)\b|登录|登陆|注册|密码|验证码|身份验证|创建账号|创建账户/i;
  const AUTH_FIELD_HINT_PATTERN =
    /\b(user[\s_-]?name|username|login|account|email|e-mail|mail|phone|mobile|password|passwd|pwd|passcode|otp|code|captcha|verification|verify|first[\s_-]?name|last[\s_-]?name|full[\s_-]?name)\b|用户名|账号|账户|邮箱|邮件地址|手机号|手机|密码|验证码|校验码|姓名/i;
  const AUTH_AUTOCOMPLETE_TOKENS = new Set([
    "username",
    "current-password",
    "new-password",
    "one-time-code",
    "webauthn",
  ]);
  const SEARCH_FIELD_NAMES = new Set(["q", "query", "search", "filter", "keyword", "keywords"]);

  const inputAutocompleteTokens = (target: HTMLElement | null) =>
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target.autocomplete
      : target?.getAttribute("autocomplete") || "")
      .split(/\s+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);

  const isSearchOrFilterTarget = (target: HTMLElement | null) => {
    if (!target) {
      return false;
    }
    if (target instanceof HTMLInputElement) {
      const type = (target.type || "").trim().toLowerCase();
      if (type === "search") {
        return true;
      }
      const nameOrId = [target.name, target.id]
        .map((value) => value.trim().toLowerCase())
        .find(Boolean);
      if (nameOrId && SEARCH_FIELD_NAMES.has(nameOrId)) {
        return true;
      }
    }
    const role = target.getAttribute("role")?.trim().toLowerCase();
    if (role === "searchbox") {
      return true;
    }
    const searchScope = target.closest("search,[role='search'],form[role='search']");
    if (searchScope) {
      return true;
    }
    const fieldSignal = controlSignalFor(target);
    if (SEARCH_OR_FILTER_HINT_PATTERN.test(fieldSignal)) {
      return true;
    }
    const form = target.closest("form");
    return Boolean(form && SEARCH_OR_FILTER_HINT_PATTERN.test(scopeSignalFor(form, 320)));
  };

  const isAuthenticationTarget = (target: HTMLElement | null) => {
    if (!target) {
      return false;
    }
    if (target instanceof HTMLInputElement && (target.type || "").trim().toLowerCase() === "password") {
      return true;
    }
    if (inputAutocompleteTokens(target).some((token) => AUTH_AUTOCOMPLETE_TOKENS.has(token))) {
      return true;
    }
    const fieldSignal = controlSignalFor(target);
    const form = target.closest("form,[role='form']");
    const authScope = form || target.closest("[role='dialog'],main,section,article");
    const scopeSignal = [
      scopeSignalFor(form, 600),
      scopeSignalFor(authScope, 700),
      window.location.hostname,
      window.location.pathname,
      document.title,
    ].filter(Boolean).join(" ");
    const hasPasswordField = Boolean(authScope?.querySelector("input[type='password']"));
    const looksLikeAuthField = AUTH_FIELD_HINT_PATTERN.test(fieldSignal);
    const looksLikeAuthScope = AUTH_SCOPE_HINT_PATTERN.test(scopeSignal);
    return looksLikeAuthField && (hasPasswordField || looksLikeAuthScope);
  };

  const isWritingAssistTarget = (target: HTMLElement | null): target is HTMLElement =>
    isEditableTarget(target)
    && !isSearchOrFilterTarget(target)
    && !isAuthenticationTarget(target);

  const nearestWritingContainer = (target: HTMLElement | null) =>
    target?.closest('form,[role="dialog"],main,section,article,[data-compose],[data-editor],[data-testid]')
    || document.body
    || document.documentElement;

  const richTextLike = (target: HTMLElement | null) => Boolean(
    target?.isContentEditable
      || target?.getAttribute("contenteditable") === "true"
      || target?.getAttribute("data-lexical-editor") === "true"
      || target?.getAttribute("data-slate-editor") === "true"
      || target?.getAttribute("data-editor"),
  );

  const extractEmailRecipient = (target: HTMLElement | null) => {
    const container = nearestWritingContainer(target);
    if (!container) {
      return undefined;
    }
    const recipientHints = /(to|cc|bcc|recipient|收件人|抄送|密送)/i;
    const values: string[] = [];
    const candidates = Array.from(container.querySelectorAll<HTMLElement>(
      'input,textarea,[contenteditable="true"],[role="textbox"],[data-email],[email],[aria-label],[title]',
    )).slice(0, 80);
    for (const node of candidates) {
      const hint = [
        fieldHintFor(node),
        node.getAttribute("data-field"),
        node.getAttribute("data-testid"),
        node.className,
      ].filter(Boolean).join(" ");
      if (!recipientHints.test(hint)) {
        continue;
      }
      const value = clip(
        editableTextFor(node)
        || node.getAttribute("data-email")
        || node.getAttribute("email")
        || node.getAttribute("aria-label")
        || node.getAttribute("title")
        || node.textContent
        || "",
        80,
      );
      if (!value || values.includes(value)) {
        continue;
      }
      values.push(value);
      if (values.length >= 3) {
        break;
      }
    }
    return values.length > 0 ? values.join(", ") : undefined;
  };

  const contextForTarget = (target: HTMLElement | null) => {
    if (!isWritingAssistTarget(target)) {
      return null;
    }
    const container = nearestWritingContainer(target);
    const fieldHint = fieldHintFor(target);
    const pageSignals = [
      window.location.hostname,
      window.location.pathname,
      document.title,
      fieldHint,
      clip(container?.textContent || "", 600),
    ].filter(Boolean).join(" ").toLowerCase();

    let contextType = "general_editor";
    if (/(mail|email|compose|inbox|outlook|gmail|邮件|邮箱|收件人|抄送|密送|主题)/i.test(pageSignals)) {
      contextType = "email";
    } else if (/(forum|thread|reply|discussion|community|comment|帖子|论坛|回复|评论|发帖)/i.test(pageSignals)) {
      contextType = "forum";
    } else if (/(article|editor|publish|draft|story|blog|markdown|document|文章|编辑器|发布|草稿|标题)/i.test(pageSignals) || richTextLike(target)) {
      contextType = "article_editor";
    }

    let slot = "message";
    if (/(to|cc|bcc|recipient|收件人|抄送|密送)/i.test(fieldHint || "")) {
      slot = "recipient";
    } else if (/(subject|topic|主题)/i.test(fieldHint || "")) {
      slot = "subject";
    } else if (/(title|headline|标题)/i.test(fieldHint || "")) {
      slot = "title";
    } else if (/(comment|reply|回复|评论)/i.test(pageSignals)) {
      slot = "comment";
    } else if (/(message|content|body|正文|内容)/i.test(fieldHint || "")) {
      slot = "body";
    } else if (contextType === "email") {
      slot = "body";
    } else if (contextType === "forum") {
      slot = "comment";
    } else if (contextType === "article_editor") {
      slot = richTextLike(target) ? "body" : "title";
    }

    return {
      contextType,
      slot,
      fieldHint,
      placeholder: clip(
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
          ? target.placeholder
          : target.getAttribute("placeholder") || "",
        120,
      ),
      targetHint: targetHintFor(target),
      targetName: nameFor(target),
      targetLabel: labelFor(target),
      recipient: contextType === "email" ? extractEmailRecipient(target) : undefined,
    };
  };

  const dispatchTextEvents = (target: HTMLElement) => {
    target.dispatchEvent(new Event("input", { bubbles: true, cancelable: false }));
    target.dispatchEvent(new Event("change", { bubbles: true, cancelable: false }));
  };

  const setTargetText = (target: HTMLElement, text: string, options?: { focus?: boolean }) => {
    const shouldFocus = options?.focus ?? true;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const prototype = Object.getPrototypeOf(target) as { constructor?: unknown };
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(target, text);
      } else {
        target.value = text;
      }
      dispatchTextEvents(target);
      if (shouldFocus) {
        target.focus({ preventScroll: true });
      }
      return;
    }

    if (!target.isContentEditable) {
      return;
    }

    if (!shouldFocus) {
      target.textContent = text;
      dispatchTextEvents(target);
      return;
    }

    target.focus({ preventScroll: true });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection?.removeAllRanges();
    selection?.addRange(range);
    try {
      document.execCommand("insertText", false, text);
    } catch {
      target.innerHTML = "";
      const fragment = document.createDocumentFragment();
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        fragment.appendChild(document.createTextNode(line));
        if (index < lines.length - 1) {
          fragment.appendChild(document.createElement("br"));
        }
      });
      target.appendChild(fragment);
    }
    dispatchTextEvents(target);
  };

  const overlayHost = document.createElement("div");
  overlayHost.style.position = "fixed";
  overlayHost.style.left = "0";
  overlayHost.style.top = "0";
  overlayHost.style.zIndex = "2147483647";
  overlayHost.style.pointerEvents = "none";
  overlayHost.style.display = "none";
  const overlayShadow = overlayHost.attachShadow({ mode: "open" });
  overlayShadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap {
        display: inline-flex;
        flex-direction: column;
        gap: 8px;
        min-width: 240px;
        max-width: min(360px, calc(100vw - 24px));
        pointer-events: auto;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        color: #111827;
      }
      .bar, .panel {
        border: 1px solid rgba(148, 163, 184, 0.32);
        background:
          linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98));
        box-shadow:
          0 18px 40px rgba(15, 23, 42, 0.18),
          0 2px 8px rgba(15, 23, 42, 0.08);
        backdrop-filter: blur(12px);
        border-radius: 16px;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        flex-wrap: wrap;
      }
      .wrap.busy .bar {
        border-color: rgba(37, 99, 235, 0.34);
      }
      .label {
        flex: 1 1 150px;
        min-width: 0;
        font-size: 12px;
        line-height: 1.35;
        color: #475569;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .busy-indicator {
        display: none;
        align-items: center;
        gap: 6px;
        flex: 1 1 100%;
        color: #2563eb;
        font-size: 12px;
        font-weight: 650;
        line-height: 1.35;
      }
      .wrap.busy .busy-indicator {
        display: inline-flex;
      }
      .busy-indicator::before {
        width: 12px;
        height: 12px;
        border: 2px solid rgba(37, 99, 235, 0.22);
        border-top-color: #2563eb;
        border-radius: 999px;
        content: "";
        animation: milo-input-assist-spin 800ms linear infinite;
      }
      .action, .submit, .close {
        appearance: none;
        border: 0;
        cursor: pointer;
        border-radius: 12px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
        transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
      }
      .action:hover, .submit:hover, .close:hover {
        transform: translateY(-1px);
      }
      .action:disabled, .submit:disabled, .close:disabled {
        cursor: default;
        opacity: 0.55;
        transform: none;
      }
      .action.polish, .submit {
        background: #0f172a;
        color: #f8fafc;
      }
      .action.draft, .close {
        background: #e2e8f0;
        color: #0f172a;
      }
      .context-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .context-actions:empty {
        display: none;
      }
      .context-actions button {
        appearance: none;
        border: 0;
        cursor: pointer;
        border-radius: 10px;
        padding: 7px 9px;
        font-size: 12px;
        font-weight: 650;
        background: #f1f5f9;
        color: #0f172a;
        transition: transform 120ms ease, background 120ms ease;
      }
      .context-actions button:hover {
        transform: translateY(-1px);
      }
      .context-actions button.primary {
        background: #2563eb;
        color: #eff6ff;
      }
      .panel {
        display: none;
        padding: 10px;
      }
      .panel.show {
        display: block;
      }
      textarea {
        width: 100%;
        min-height: 88px;
        resize: vertical;
        box-sizing: border-box;
        border: 1px solid rgba(148, 163, 184, 0.38);
        border-radius: 12px;
        padding: 10px 12px;
        font: inherit;
        line-height: 1.45;
        color: #0f172a;
        background: rgba(255,255,255,0.86);
      }
      .panel-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
      }
      .status {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.4;
        color: #475569;
      }
      .status.loading {
        color: #2563eb;
        font-weight: 650;
      }
      @keyframes milo-input-assist-spin {
        to { transform: rotate(360deg); }
      }
    </style>
    <div class="wrap">
      <div class="bar">
        <div class="label"></div>
        <div class="busy-indicator" aria-live="polite"></div>
        <button class="action polish" type="button"></button>
        <button class="action draft" type="button"></button>
        <div class="context-actions"></div>
      </div>
      <div class="panel">
        <textarea></textarea>
        <div class="panel-row">
          <button class="submit" type="button"></button>
          <button class="close" type="button"></button>
        </div>
        <div class="status"></div>
      </div>
    </div>
  `;
  const wrap = overlayShadow.querySelector<HTMLDivElement>(".wrap")!;
  const labelEl = overlayShadow.querySelector<HTMLDivElement>(".label")!;
  const busyIndicatorEl = overlayShadow.querySelector<HTMLDivElement>(".busy-indicator")!;
  const polishButton = overlayShadow.querySelector<HTMLButtonElement>(".action.polish")!;
  const draftButton = overlayShadow.querySelector<HTMLButtonElement>(".action.draft")!;
  const contextActionsEl = overlayShadow.querySelector<HTMLDivElement>(".context-actions")!;
  const panelEl = overlayShadow.querySelector<HTMLDivElement>(".panel")!;
  const promptEl = overlayShadow.querySelector<HTMLTextAreaElement>("textarea")!;
  const submitButton = overlayShadow.querySelector<HTMLButtonElement>(".submit")!;
  const closeButton = overlayShadow.querySelector<HTMLButtonElement>(".close")!;
  const statusEl = overlayShadow.querySelector<HTMLDivElement>(".status")!;
  polishButton.textContent = strings.polish;
  draftButton.textContent = strings.draft;
  submitButton.textContent = strings.generate;
  closeButton.textContent = strings.close;
  promptEl.placeholder = strings.draftPlaceholder;
  let assistBusy = false;
  let assistRequestVersion = 0;
  let assistUserMovedAway = false;

  const clearHideTimer = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const setStatus = (message?: string) => {
    statusEl.textContent = message || "";
  };

  const setBusy = (busy: boolean, message?: string) => {
    assistBusy = busy;
    wrap.classList.toggle("busy", busy);
    wrap.setAttribute("aria-busy", busy ? "true" : "false");
    busyIndicatorEl.textContent = busy ? (message || strings.waiting) : "";
    statusEl.classList.toggle("loading", busy);
    polishButton.disabled = busy;
    draftButton.disabled = busy;
    submitButton.disabled = busy;
    closeButton.disabled = false;
    promptEl.disabled = busy;
    contextActionsEl.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = busy;
    });
    if (busy) {
      clearHideTimer();
    }
    setStatus(message);
  };

  const clearContextActions = () => {
    contextActionsEl.textContent = "";
  };

  const hideOverlay = (options?: { force?: boolean }) => {
    if (assistBusy && !options?.force) {
      return;
    }
    clearHideTimer();
    overlayHost.style.display = "none";
    panelEl.classList.remove("show");
    clearContextActions();
    setBusy(false);
    setStatus("");
  };

  const scheduleHideOverlay = (delay = 180) => {
    if (assistBusy) {
      clearHideTimer();
      return;
    }
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      if (assistBusy) {
        return;
      }
      if (document.activeElement === overlayHost || overlayShadow.activeElement) {
        return;
      }
      hideOverlay();
    }, delay);
  };

  const repositionOverlay = () => {
    if (!activeTarget || overlayHost.style.display === "none") {
      return;
    }
    const rect = activeTarget.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(360, Math.max(240, overlayHost.offsetWidth || 260));
    const targetOutsideHorizontalViewport = rect.right <= 0 || rect.left >= window.innerWidth;
    const left = targetOutsideHorizontalViewport
      ? rect.left
      : Math.min(
        Math.max(margin, rect.left),
        window.innerWidth - width - margin,
      );
    const height = overlayHost.offsetHeight || 44;
    const topCandidate = rect.bottom + 8;
    const targetOutsideVerticalViewport = rect.bottom <= 0 || rect.top >= window.innerHeight;
    const fitsBelow = topCandidate + height + margin <= window.innerHeight;
    const top = targetOutsideVerticalViewport
      ? topCandidate
      : fitsBelow
        ? topCandidate
        : Math.max(margin, rect.top - height - 8);
    overlayHost.style.left = `${Math.round(left)}px`;
    overlayHost.style.top = `${Math.round(top)}px`;
  };

  const showOverlayForTarget = (target: HTMLElement) => {
    activeTarget = target;
    overlayHost.style.display = "block";
    const labelParts = [
      activeContext?.contextLabel,
      activeContext?.slotLabel,
    ].filter(Boolean);
    labelEl.textContent = activeContext?.recipientLabel
      ? `${labelParts.join(" / ") || strings.fallbackLabel} · ${activeContext.recipientLabel}`
      : (labelParts.join(" / ") || strings.fallbackLabel);
    setStatus(activeContext?.styleProfile?.styleSummary || "");
    repositionOverlay();
    for (const listener of visibleListeners) {
      listener(target);
    }
  };

  const runAction = async (mode: "polish" | "draft") => {
    if (assistBusy || !activeTarget || !activeRequestBase) {
      return;
    }
    const target = activeTarget;
    const requestBase = activeRequestBase;
    const requestVersion = ++assistRequestVersion;
    const currentText = editableTextFor(target).trim();
    const instruction = promptEl.value.trim();
    if (mode === "polish" && !currentText) {
      setStatus(strings.emptyPolish);
      return;
    }
    if (mode === "draft" && !instruction && !currentText) {
      setStatus(strings.emptyDraft);
      return;
    }

    panelEl.classList.toggle("show", mode === "draft" || panelEl.classList.contains("show"));
    assistUserMovedAway = false;
    setBusy(true, strings.waiting);
    repositionOverlay();
    try {
      const result = await ipcRenderer.invoke("learning:generate-input-assist-text", {
        ...requestBase,
        mode,
        currentText,
        instruction: mode === "draft" ? instruction : undefined,
      }) as {
        success: boolean;
        text?: string;
        error?: string;
      };
      if (requestVersion !== assistRequestVersion) {
        return;
      }
      if (!result?.success || !result.text) {
        setBusy(false, result?.error || strings.unsupported);
        return;
      }
      const shouldRefocusTarget = !assistUserMovedAway
        && (
          document.activeElement === target
          || document.activeElement === overlayHost
          || document.activeElement === document.body
          || Boolean(overlayShadow.activeElement)
        );
      setTargetText(target, result.text, { focus: shouldRefocusTarget });
      if (mode === "draft") {
        promptEl.value = "";
        panelEl.classList.add("show");
      }
      setBusy(false, strings.success);
      activeTarget = target;
      repositionOverlay();
      if (!shouldRefocusTarget) {
        scheduleHideOverlay(1_400);
      }
    } catch (error) {
      if (requestVersion !== assistRequestVersion) {
        return;
      }
      setBusy(false, error instanceof Error ? error.message : strings.unsupported);
    }
  };

  polishButton.addEventListener("click", () => {
    void runAction("polish");
  });
  draftButton.addEventListener("click", () => {
    panelEl.classList.toggle("show");
    if (panelEl.classList.contains("show")) {
      promptEl.focus({ preventScroll: true });
      setStatus(activeContext?.styleProfile?.styleSummary || "");
    } else {
      setStatus(activeContext?.styleProfile?.styleSummary || "");
    }
    repositionOverlay();
  });
  submitButton.addEventListener("click", () => {
    void runAction("draft");
  });
  closeButton.addEventListener("click", () => {
    assistRequestVersion++;
    setBusy(false);
    panelEl.classList.remove("show");
    setStatus(activeContext?.styleProfile?.styleSummary || "");
    activeTarget?.focus({ preventScroll: true });
    repositionOverlay();
  });
  wrap.addEventListener("mouseenter", clearHideTimer);
  wrap.addEventListener("mouseleave", () => scheduleHideOverlay());
  wrap.addEventListener("focusin", clearHideTimer);
  wrap.addEventListener("focusout", () => scheduleHideOverlay());

  document.documentElement.appendChild(overlayHost);

  const writingBridge: InputWritingAssistOverlayBridge = {
    isVisibleForTarget: (target) =>
      activeTarget === target && overlayHost.style.display !== "none",
    setContextActions: (target, actions) => {
      if (activeTarget !== target || overlayHost.style.display === "none") {
        return false;
      }
      contextActionsEl.textContent = "";
      for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        if (action.primary) {
          button.classList.add("primary");
        }
        button.disabled = assistBusy;
        button.addEventListener("click", () => {
          action.run();
        });
        contextActionsEl.appendChild(button);
      }
      repositionOverlay();
      return true;
    },
    clearContextActions: (target) => {
      if (target && activeTarget !== target) {
        return;
      }
      clearContextActions();
      repositionOverlay();
    },
    containsEvent: (event) => event.composedPath().includes(overlayHost),
    onVisible: (listener) => {
      visibleListeners.add(listener);
      return () => {
        visibleListeners.delete(listener);
      };
    },
  };
  inputWritingAssistOverlayBridge = writingBridge;

  const lookupForTarget = async (target: HTMLElement) => {
    if (assistBusy) {
      return;
    }
    const context = contextForTarget(target);
    if (!context || context.slot === "recipient") {
      hideOverlay();
      return;
    }

    const workspaceId = await getWorkspaceId();
    if (!workspaceId) {
      hideOverlay();
      return;
    }

    const version = ++lookupVersion;
    const request = {
      workspaceId,
      url: window.location.href,
      pageTitle: document.title || undefined,
      targetHint: context.targetHint,
      targetRole: target.getAttribute("role") || undefined,
      targetName: context.targetName,
      targetLabel: context.targetLabel,
      placeholder: context.placeholder,
      fieldHint: context.fieldHint,
      contextType: context.contextType,
      slot: context.slot,
      recipient: context.recipient,
    };

    try {
      const nextContext = await ipcRenderer.invoke(
        "learning:resolve-input-assist-context",
        request,
      ) as typeof activeContext;
      if (version !== lookupVersion || activeTarget !== target) {
        return;
      }
      if (!nextContext?.showMenu) {
        activeContext = null;
        activeRequestBase = null;
        hideOverlay();
        return;
      }
      activeContext = nextContext;
      activeRequestBase = request;
      showOverlayForTarget(target);
    } catch {
      hideOverlay();
    }
  };

  document.addEventListener("focusin", (event) => {
    const target = elementForNode(event.target);
    if (assistBusy) {
      if (
        target
        && target !== activeTarget
        && !event.composedPath().includes(overlayHost)
      ) {
        assistUserMovedAway = true;
      }
      return;
    }
    if (!isEditableTarget(target)) {
      if (!event.composedPath().includes(overlayHost)) {
        scheduleHideOverlay();
      }
      return;
    }
    clearHideTimer();
    if (target !== activeTarget) {
      clearContextActions();
    }
    activeTarget = target;
    void lookupForTarget(target);
  }, true);

  document.addEventListener("focusout", (event) => {
    const target = elementForNode(event.target);
    if (assistBusy) {
      return;
    }
    if (!target || target !== activeTarget) {
      return;
    }
    scheduleHideOverlay();
  }, true);

  document.addEventListener("mousedown", (event) => {
    if (
      assistBusy
      && activeTarget
      && !event.composedPath().includes(overlayHost)
      && !event.composedPath().includes(activeTarget)
    ) {
      assistUserMovedAway = true;
    }
  }, true);

  window.addEventListener("scroll", repositionOverlay, true);
  window.addEventListener("resize", repositionOverlay);
  window.addEventListener("beforeunload", () => {
    clearHideTimer();
    if (inputWritingAssistOverlayBridge === writingBridge) {
      inputWritingAssistOverlayBridge = null;
    }
    overlayHost.remove();
  }, { once: true });
}

function installContextIntelligenceIntegration() {
  if (shouldExposeBrowserShell() || isLinkPreviewContext || isLinkPreviewShellContext) {
    return;
  }
  try {
    if (window.top !== window.self) {
      return;
    }
  } catch {
    return;
  }

  const pageUrl = () => window.location.href;
  if (!/^https?:\/\//i.test(pageUrl())) {
    return;
  }
  if (!document.documentElement) {
    runWhenDocumentElementReady(installContextIntelligenceIntegration);
    return;
  }

  type ContextOpportunity = {
    id: string;
    kind: string;
    label: string;
    actionLabel?: string;
    confidence: number;
    surface: string;
    cooldownKey: string;
    prompt: string;
    payload?: Record<string, unknown>;
  };

  const locale = resolveShellUiLocale();
  const strings = locale === "zh-CN"
    ? {
      close: "忽略",
      working: "已发送给 Milo",
    }
    : {
      close: "Dismiss",
      working: "Sent to Milo",
    };

  const clip = (value: string | undefined, limit = 2_000) => {
    const normalized = typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
    if (!normalized) {
      return "";
    }
    return normalized.length > limit
      ? `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
      : normalized;
  };

  const visibleText = (node: Element | null) => clip(node?.textContent || "", 8_000);
  const getSelectionText = () => clip(document.getSelection?.()?.toString() || "", 2_000);
  const isEditableElement = (target: EventTarget | null) => {
    const node = target instanceof HTMLElement ? target : null;
    if (!node) {
      return false;
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return true;
    }
    return node.isContentEditable || node.closest('[contenteditable="true"],[role="textbox"]') !== null;
  };

  let copiedTextLength = 0;
  let lastObservationUrl = "";
  let scanTimer: number | null = null;
  let activeOpportunity: ContextOpportunity | null = null;
  const startedAt = Date.now();

  const collectRepeatedStructureSamples = () => {
    const groups = new Map<string, Element[]>();
    for (const node of Array.from(document.body?.querySelectorAll("*") || []).slice(0, 1_500)) {
      const element = node instanceof Element ? node : null;
      if (!element || ["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(element.tagName)) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const text = visibleText(element);
      if (rect.width < 80 || rect.height < 32 || text.length < 24) {
        continue;
      }
      const key = [
        element.tagName.toLowerCase(),
        element.getAttribute("role") || "",
        element.children.length,
        Math.round(rect.width / 80),
        Math.round(rect.height / 40),
      ].join("|");
      const current = groups.get(key) || [];
      current.push(element);
      groups.set(key, current);
    }
    const best = Array.from(groups.values())
      .filter((group) => group.length >= 3)
      .sort((left, right) => right.length - left.length)[0] || [];
    return {
      count: best.length,
      samples: best.slice(0, 8).map((node) => clip(node.textContent || "", 260)),
    };
  };

  const collectHeadings = () =>
    Array.from(document.querySelectorAll("h1,h2,h3,[role='heading']"))
      .map((node) => clip(node.textContent || "", 160))
      .filter(Boolean)
      .slice(0, 16);

  const collectFormHints = () =>
    Array.from(document.querySelectorAll<HTMLElement>("label,input,textarea,select,button,[role='button'],[role='textbox']"))
      .map((node) => clip([
        node.getAttribute("aria-label"),
        node.getAttribute("placeholder"),
        node.getAttribute("name"),
        node.getAttribute("title"),
        node.textContent,
      ].filter(Boolean).join(" "), 160))
      .filter(Boolean)
      .slice(0, 18);

  const describeFocusedElement = (target: Element | null) => {
    const element = target instanceof HTMLElement ? target : null;
    if (!element) {
      return undefined;
    }
    const rect = element.getBoundingClientRect();
    return {
      tagName: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || undefined,
      text: clip(element.textContent || "", 240) || undefined,
      ariaLabel: element.getAttribute("aria-label") || undefined,
      placeholder: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.placeholder || undefined
        : element.getAttribute("placeholder") || undefined,
      name: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        ? element.name || undefined
        : element.getAttribute("name") || undefined,
      valueLength: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? (element.value || "").length
        : undefined,
      bounds: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  };

  const buildObservation = (trigger: "page_observation" | "selection_change" | "focus_change" | "copy" = "page_observation") => {
    const bodyText = visibleText(document.body);
    const articleText = visibleText(document.querySelector("article,main,[role='main']"));
    const selectedText = getSelectionText();
    const repeated = collectRepeatedStructureSamples();

    return {
      url: pageUrl(),
      title: document.title || undefined,
      locale,
      trigger,
      textSample: clip(articleText || bodyText, 3_000),
      headings: collectHeadings(),
      formHints: collectFormHints(),
      focusedElement: describeFocusedElement(document.activeElement),
      repeatedItemSamples: repeated.samples,
      selectedText,
      bodyTextLength: bodyText.length,
      articleTextLength: articleText.length,
      headingCount: document.querySelectorAll("h1,h2,h3").length,
      linkCount: document.links.length,
      formCount: document.forms.length,
      inputCount: document.querySelectorAll("input,textarea,select,[contenteditable='true'],[role='textbox']").length,
      repeatedItemCount: repeated.count,
      selectedTextLength: selectedText.length,
      copiedTextLength,
      dwellMs: Date.now() - startedAt,
      updatedAt: Date.now(),
    };
  };

  const chipHost = document.createElement("div");
  chipHost.style.position = "fixed";
  chipHost.style.right = "14px";
  chipHost.style.top = "42%";
  chipHost.style.zIndex = "2147483646";
  chipHost.style.pointerEvents = "none";
  chipHost.style.display = "none";
  const chipShadow = chipHost.attachShadow({ mode: "open" });
  chipShadow.innerHTML = `
    <style>
      :host { all: initial; }
      .chip {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: min(360px, calc(100vw - 28px));
        padding: 8px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
        color: #0f172a;
        font: 12px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      }
      .mark {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #2563eb;
        flex: 0 0 auto;
      }
      .label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button {
        appearance: none;
        border: 0;
        border-radius: 10px;
        padding: 6px 8px;
        font: inherit;
        font-weight: 650;
        cursor: pointer;
      }
      .run { background: #0f172a; color: #f8fafc; }
      .close { background: #e2e8f0; color: #334155; }
    </style>
    <div class="chip">
      <span class="mark"></span>
      <span class="label"></span>
      <button class="run" type="button"></button>
      <button class="close" type="button"></button>
    </div>
  `;
  const chipLabel = chipShadow.querySelector<HTMLSpanElement>(".label")!;
  const chipRun = chipShadow.querySelector<HTMLButtonElement>(".run")!;
  const chipClose = chipShadow.querySelector<HTMLButtonElement>(".close")!;
  chipClose.textContent = strings.close;

  const hideChip = () => {
    chipHost.style.display = "none";
    activeOpportunity = null;
  };

  const dismissOpportunity = (opportunity: ContextOpportunity | null) => {
    if (!opportunity) {
      hideChip();
      return;
    }
    void ipcRenderer.invoke("context:dismiss-opportunity", {
      opportunityId: opportunity.id,
      kind: opportunity.kind,
      url: pageUrl(),
    }).catch(() => undefined);
    hideChip();
  };

  const acceptOpportunity = async (opportunity: ContextOpportunity, promptOverride?: string) => {
    chipLabel.textContent = strings.working;
    try {
      await ipcRenderer.invoke("context:accept-opportunity", {
        opportunityId: opportunity.id,
        kind: opportunity.kind,
        url: pageUrl(),
        title: document.title || undefined,
        prompt: promptOverride || opportunity.prompt,
      });
      hideChip();
    } catch {
      chipLabel.textContent = opportunity.label;
    }
  };

  chipRun.addEventListener("click", () => {
    if (activeOpportunity) {
      void acceptOpportunity(activeOpportunity);
    }
  });
  chipClose.addEventListener("click", () => dismissOpportunity(activeOpportunity));

  const showChip = (opportunity: ContextOpportunity) => {
    activeOpportunity = opportunity;
    chipLabel.textContent = opportunity.label;
    chipRun.textContent = opportunity.actionLabel || (locale === "zh-CN" ? "执行" : "Run");
    chipHost.style.display = "block";
  };

  document.documentElement.appendChild(chipHost);

  const requestPageState = async () => {
    if (document.hidden) {
      return;
    }
    const observation = buildObservation();
    lastObservationUrl = observation.url;
    try {
      const state = await ipcRenderer.invoke("context:get-page-state", observation) as {
        opportunities?: ContextOpportunity[];
      };
      if (observation.url !== lastObservationUrl || document.hidden) {
        return;
      }
      const opportunity = state?.opportunities?.find((entry) => entry.surface === "tiny_chip");
      if (opportunity) {
        showChip(opportunity);
      }
    } catch {
      // Context hints are best-effort.
    }
  };

  const scheduleScan = (delay = 1_600) => {
    if (scanTimer !== null) {
      window.clearTimeout(scanTimer);
    }
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      void requestPageState();
    }, delay);
  };

  const selectionHost = document.createElement("div");
  selectionHost.style.position = "fixed";
  selectionHost.style.left = "0";
  selectionHost.style.top = "0";
  selectionHost.style.zIndex = "2147483647";
  selectionHost.style.pointerEvents = "none";
  selectionHost.style.display = "none";
  const selectionShadow = selectionHost.attachShadow({ mode: "open" });
  selectionShadow.innerHTML = `
    <style>
      :host { all: initial; }
      .menu {
        pointer-events: auto;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        max-width: min(520px, calc(100vw - 24px));
        padding: 7px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.97);
        box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
        font: 12px/1.3 ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      }
      button {
        appearance: none;
        border: 0;
        border-radius: 10px;
        padding: 7px 9px;
        background: #f1f5f9;
        color: #0f172a;
        font: inherit;
        font-weight: 650;
        cursor: pointer;
      }
      button.primary { background: #0f172a; color: #f8fafc; }
    </style>
    <div class="menu"></div>
  `;
  const selectionMenu = selectionShadow.querySelector<HTMLDivElement>(".menu")!;
  document.documentElement.appendChild(selectionHost);

  const fieldHost = document.createElement("div");
  fieldHost.style.position = "fixed";
  fieldHost.style.left = "0";
  fieldHost.style.top = "0";
  fieldHost.style.zIndex = "2147483646";
  fieldHost.style.pointerEvents = "none";
  fieldHost.style.display = "none";
  const fieldShadow = fieldHost.attachShadow({ mode: "open" });
  fieldShadow.innerHTML = `
    <style>
      :host { all: initial; }
      .menu {
        pointer-events: auto;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        max-width: min(460px, calc(100vw - 24px));
        padding: 7px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.97);
        box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
        font: 12px/1.3 ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      }
      button {
        appearance: none;
        border: 0;
        border-radius: 10px;
        padding: 7px 9px;
        background: #f1f5f9;
        color: #0f172a;
        font: inherit;
        font-weight: 650;
        cursor: pointer;
      }
      button.primary { background: #0f172a; color: #f8fafc; }
    </style>
    <div class="menu"></div>
  `;
  const fieldMenu = fieldShadow.querySelector<HTMLDivElement>(".menu")!;
  document.documentElement.appendChild(fieldHost);

  let selectionHideTimer: number | null = null;
  let fieldContextAttachedTarget: HTMLElement | null = null;
  let latestFieldTarget: HTMLElement | null = null;
  let latestFieldOpportunities: ContextOpportunity[] = [];
  let fieldFocusVersion = 0;
  const clearSelectionHideTimer = () => {
    if (selectionHideTimer !== null) {
      window.clearTimeout(selectionHideTimer);
      selectionHideTimer = null;
    }
  };
  const hideSelectionMenu = () => {
    clearSelectionHideTimer();
    selectionHost.style.display = "none";
  };
  const hideFieldMenu = () => {
    fieldHost.style.display = "none";
    fieldMenu.textContent = "";
    if (fieldContextAttachedTarget) {
      inputWritingAssistOverlayBridge?.clearContextActions(fieldContextAttachedTarget);
      fieldContextAttachedTarget = null;
    }
  };
  const scheduleSelectionHide = () => {
    clearSelectionHideTimer();
    selectionHideTimer = window.setTimeout(hideSelectionMenu, 180);
  };

  const renderSelectionMenu = (opportunities: ContextOpportunity[]) => {
    selectionMenu.textContent = "";
    for (const [index, opportunity] of opportunities.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = opportunity.actionLabel || opportunity.label;
      if (index === 0) {
        button.classList.add("primary");
      }
      button.addEventListener("click", () => {
        hideSelectionMenu();
        void acceptOpportunity(opportunity, opportunity.prompt);
      });
      selectionMenu.appendChild(button);
    }
  };

  const renderFieldMenu = (opportunities: ContextOpportunity[]) => {
    fieldMenu.textContent = "";
    for (const [index, opportunity] of opportunities.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = opportunity.actionLabel || opportunity.label;
      if (index === 0) {
        button.classList.add("primary");
      }
      button.addEventListener("click", () => {
        hideFieldMenu();
        void acceptOpportunity(opportunity, opportunity.prompt);
      });
      fieldMenu.appendChild(button);
    }
  };

  const buildFieldContextActions = (opportunities: ContextOpportunity[]): InputWritingAssistContextAction[] =>
    opportunities.map((opportunity, index) => ({
      label: opportunity.actionLabel || opportunity.label,
      primary: index === 0,
      run: () => {
        hideFieldMenu();
        void acceptOpportunity(opportunity, opportunity.prompt);
      },
    }));

  const tryAttachFieldMenuToWritingAssist = (
    target: HTMLElement,
    opportunities: ContextOpportunity[],
  ) => {
    const attached = inputWritingAssistOverlayBridge?.setContextActions(
      target,
      buildFieldContextActions(opportunities),
    ) ?? false;
    if (!attached) {
      return false;
    }
    if (fieldContextAttachedTarget && fieldContextAttachedTarget !== target) {
      inputWritingAssistOverlayBridge?.clearContextActions(fieldContextAttachedTarget);
    }
    fieldHost.style.display = "none";
    fieldMenu.textContent = "";
    fieldContextAttachedTarget = target;
    return true;
  };

  const showFieldMenu = (target: HTMLElement, opportunities: ContextOpportunity[]) => {
    latestFieldTarget = target;
    latestFieldOpportunities = opportunities;
    if (tryAttachFieldMenuToWritingAssist(target, opportunities)) {
      return;
    }

    if (fieldContextAttachedTarget && fieldContextAttachedTarget !== target) {
      inputWritingAssistOverlayBridge?.clearContextActions(fieldContextAttachedTarget);
    }
    fieldContextAttachedTarget = null;
    renderFieldMenu(opportunities);
    const rect = target.getBoundingClientRect();
    const margin = 12;
    fieldHost.style.display = "block";
    const width = fieldHost.offsetWidth || 360;
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const topCandidate = rect.bottom + 8;
    const top = topCandidate + (fieldHost.offsetHeight || 42) + margin <= window.innerHeight
      ? topCandidate
      : Math.max(margin, rect.top - (fieldHost.offsetHeight || 42) - 8);
    fieldHost.style.left = `${Math.round(left)}px`;
    fieldHost.style.top = `${Math.round(top)}px`;
  };

  const removeWritingVisibleListener = inputWritingAssistOverlayBridge?.onVisible((target) => {
    if (target !== latestFieldTarget || latestFieldOpportunities.length === 0) {
      return;
    }
    void tryAttachFieldMenuToWritingAssist(target, latestFieldOpportunities);
  });

  const showSelectionMenu = async () => {
    const selection = document.getSelection?.();
    const text = getSelectionText();
    if (!selection || selection.rangeCount === 0 || text.length < 3 || isEditableElement(document.activeElement)) {
      hideSelectionMenu();
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || rect.width <= 0 || rect.height <= 0) {
      hideSelectionMenu();
      return;
    }
    let opportunities: ContextOpportunity[] = [];
    try {
      const state = await ipcRenderer.invoke("context:get-page-state", buildObservation("selection_change")) as {
        opportunities?: ContextOpportunity[];
      };
      opportunities = (state.opportunities || []).filter((entry) => entry.surface === "selection_menu");
    } catch {
      opportunities = [];
    }
    if (opportunities.length === 0) {
      hideSelectionMenu();
      return;
    }
    renderSelectionMenu(opportunities);
    const margin = 12;
    selectionHost.style.display = "block";
    const hostWidth = selectionHost.offsetWidth || 440;
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - hostWidth - margin);
    const top = Math.max(margin, rect.top - (selectionHost.offsetHeight || 42) - 8);
    selectionHost.style.left = `${Math.round(left)}px`;
    selectionHost.style.top = `${Math.round(top)}px`;
  };

  selectionMenu.addEventListener("mouseenter", clearSelectionHideTimer);
  selectionMenu.addEventListener("mouseleave", scheduleSelectionHide);
  fieldMenu.addEventListener("mouseenter", clearSelectionHideTimer);

  document.addEventListener("selectionchange", () => {
    window.setTimeout(() => {
      void showSelectionMenu();
    }, 180);
  }, true);
  document.addEventListener("focusin", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || !isEditableElement(target)) {
      if (!inputWritingAssistOverlayBridge?.containsEvent(event)) {
        fieldFocusVersion += 1;
        latestFieldTarget = null;
        latestFieldOpportunities = [];
        hideFieldMenu();
      }
      return;
    }
    const version = ++fieldFocusVersion;
    window.setTimeout(async () => {
      try {
        const state = await ipcRenderer.invoke("context:get-page-state", buildObservation("focus_change")) as {
          opportunities?: ContextOpportunity[];
        };
        if (version !== fieldFocusVersion) {
          return;
        }
        const opportunities = (state.opportunities || []).filter((entry) => entry.surface === "field_popover");
        if (opportunities.length === 0) {
          latestFieldTarget = target;
          latestFieldOpportunities = [];
          hideFieldMenu();
          return;
        }
        showFieldMenu(target, opportunities);
      } catch {
        hideFieldMenu();
      }
    }, 220);
  }, true);
  document.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (fieldContextAttachedTarget) {
        if (!inputWritingAssistOverlayBridge?.isVisibleForTarget(fieldContextAttachedTarget)) {
          hideFieldMenu();
        }
        return;
      }
      if (!fieldHost.matches(":hover")) {
        hideFieldMenu();
      }
    }, 180);
  }, true);
  document.addEventListener("mousedown", (event) => {
    if (selectionHost.style.display !== "none" && event.composedPath().includes(selectionHost)) {
      return;
    }
    scheduleSelectionHide();
  }, true);
  document.addEventListener("copy", () => {
    copiedTextLength = getSelectionText().length;
    void ipcRenderer.invoke("context:get-page-state", buildObservation("copy")).catch(() => undefined);
    scheduleScan(600);
  }, true);
  window.addEventListener("scroll", () => {
    hideSelectionMenu();
    hideFieldMenu();
    scheduleScan(2_500);
  }, true);
  window.addEventListener("resize", () => {
    hideSelectionMenu();
    hideFieldMenu();
    scheduleScan(1_200);
  });
  window.addEventListener("pageshow", () => scheduleScan(1_800));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleScan(1_000);
    }
  });
  window.addEventListener("beforeunload", () => {
    if (scanTimer !== null) {
      window.clearTimeout(scanTimer);
    }
    removeWritingVisibleListener?.();
    chipHost.remove();
    selectionHost.remove();
    fieldHost.remove();
  }, { once: true });

  scheduleScan(2_400);
}

const browserShell = {
  getBootstrapData: () =>
    ipcRenderer.invoke("browser:get-bootstrap-data") as Promise<BrowserBootstrapData>,
  renderPreviewGetDocument: (id: string) =>
    ipcRenderer.invoke("render-preview:get-document", id) as Promise<RenderPreviewDocument | null>,
  createWorkspace: (input: CreateWorkspaceInput) =>
    ipcRenderer.invoke("browser:create-workspace", input) as Promise<WorkspaceSummary>,
  deleteWorkspaces: (workspaceIds: string[]) =>
    ipcRenderer.invoke("browser:delete-workspaces", workspaceIds) as Promise<DeleteWorkspacesResult>,
  openWorkspaceProfileDirectory: (workspaceId: string) =>
    ipcRenderer.invoke("browser:open-workspace-profile-directory", workspaceId) as Promise<string>,
  renameWorkspace: (input: RenameWorkspaceInput) =>
    ipcRenderer.invoke("browser:rename-workspace", input) as Promise<WorkspaceSummary>,
  showWorkspaceMenu: (anchor: { left: number; top: number; width: number; height: number }) =>
    ipcRenderer.invoke("browser:show-workspace-menu", anchor) as Promise<void>,
  openCreateWorkspaceDialog: (input: OpenCreateWorkspaceDialogInput) =>
    ipcRenderer.invoke("browser:open-create-workspace-dialog", input) as Promise<void>,
  openFolderSettingsDialog: (input: OpenFolderSettingsDialogInput) =>
    ipcRenderer.invoke("browser:open-folder-settings-dialog", input) as Promise<void>,
  submitFolderSettingsDialog: (input: FolderSettingsUpdateInput) =>
    ipcRenderer.invoke("browser:submit-folder-settings-dialog", input) as Promise<void>,
  openWorkspaceWindow: (workspaceId: string) =>
    ipcRenderer.invoke("browser:open-workspace-window", workspaceId) as Promise<WorkspaceSummary>,
  switchWorkspace: (input: SwitchWorkspaceInput) =>
    ipcRenderer.invoke("browser:switch-workspace", input) as Promise<BrowserBootstrapData>,
  closeCurrentWindow: () =>
    ipcRenderer.invoke("browser:close-current-window") as Promise<void>,
  minimizeCurrentWindow: () =>
    ipcRenderer.invoke("browser:minimize-current-window") as Promise<void>,
  maximizeCurrentWindow: () =>
    ipcRenderer.invoke("browser:maximize-current-window") as Promise<boolean>,
  isWindowMaximized: () =>
    ipcRenderer.invoke("browser:is-window-maximized") as Promise<boolean>,
  showSystemNotification: (input: SystemNotificationInput) =>
    ipcRenderer.invoke("system-notifications:show", input) as Promise<SystemNotificationResult>,
  focusWindow: (windowId: number) =>
    ipcRenderer.invoke("browser:focus-window", windowId) as Promise<WindowSummary>,
  syncWindowState: (input: SyncWindowStateInput) =>
    ipcRenderer.invoke("browser:sync-window-state", input) as Promise<WindowSummary>,
  sidebarSyncState: (input: { workspaceId: string; state: SidebarOrganizationState; sequence?: number }) =>
    ipcRenderer.invoke("browser:sync-sidebar-organization-state", input) as Promise<SidebarOrganizationState>,
  sidebarSyncStateNow: (input: { workspaceId: string; state: SidebarOrganizationState; sequence?: number }) => {
    const result = ipcRenderer.sendSync(
      "browser:sync-sidebar-organization-state-now",
      input,
    ) as { ok?: boolean; state?: SidebarOrganizationState; error?: string };
    if (!result?.ok || !result.state) {
      throw new Error(result?.error ?? "Failed to sync sidebar organization state.");
    }
    return result.state;
  },
  setAutomationTarget: (workspaceId: string, targetContentsId: number) =>
    ipcRenderer.invoke(
      "browser:automation:set-target",
      workspaceId,
      targetContentsId,
    ) as Promise<WorkspaceSummary>,
  sendAutomationCommand: (input: CdpCommandInput) =>
    ipcRenderer.invoke("browser:automation:send-command", input) as Promise<unknown>,
  automationNavigate: (input: AutomationNavigateInput) =>
    ipcRenderer.invoke("browser:automation:navigate", input) as Promise<unknown>,
  automationEvaluate: (input: AutomationEvaluateInput) =>
    ipcRenderer.invoke("browser:automation:evaluate", input) as Promise<unknown>,
  onWorkspaceContext: (callback: (payload: BrowserBootstrapData) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: BrowserBootstrapData,
    ) => {
      callback(payload);
    };

    ipcRenderer.on("browser:workspace-context", listener);

    return () => {
      ipcRenderer.removeListener("browser:workspace-context", listener);
    };
  },
  onFolderSettingsUpdated: (callback: (payload: FolderSettingsUpdateInput) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: FolderSettingsUpdateInput,
    ) => {
      callback(payload);
    };

    ipcRenderer.on("browser:folder-settings-updated", listener);

    return () => {
      ipcRenderer.removeListener("browser:folder-settings-updated", listener);
    };
  },
  onSidebarOrganizationStateApplied: (
    callback: (payload: { workspaceId: string; state: SidebarOrganizationState }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { workspaceId: string; state: SidebarOrganizationState },
    ) => {
      callback(payload);
    };

    ipcRenderer.on("browser:sidebar-organization-state-applied", listener);

    return () => {
      ipcRenderer.removeListener("browser:sidebar-organization-state-applied", listener);
    };
  },

  // Tab management
  tabCreate: (windowId: number, url?: string) =>
    ipcRenderer.invoke("tab:create", windowId, url) as Promise<WindowTabSummary>,
  tabClose: (windowId: number, tabId: string) =>
    ipcRenderer.invoke("tab:close", windowId, tabId) as Promise<{ activeTabId: string }>,
  tabSetActive: (
    windowId: number,
    tabId: string,
    sidebarWidth?: number,
    urlBarHeight?: number,
    rightPanelWidth?: number,
  ) =>
    ipcRenderer.invoke(
      "tab:set-active",
      windowId,
      tabId,
      sidebarWidth,
      urlBarHeight,
      rightPanelWidth,
    ) as Promise<void>,
  tabApplyLayout: (
    windowId: number,
    input: TabLayoutUpdateInput,
    sidebarWidth?: number,
    urlBarHeight?: number,
  ) =>
    ipcRenderer.invoke(
      "tab:apply-layout",
      windowId,
      input,
      sidebarWidth,
      urlBarHeight,
    ) as Promise<void>,
  tabNavigate: (windowId: number, tabId: string, url: string) =>
    ipcRenderer.invoke("tab:navigate", windowId, tabId, url) as Promise<void>,
  tabGoBack: (windowId: number, tabId: string) =>
    ipcRenderer.invoke("tab:go-back", windowId, tabId) as Promise<void>,
  tabGoForward: (windowId: number, tabId: string) =>
    ipcRenderer.invoke("tab:go-forward", windowId, tabId) as Promise<void>,
  tabReload: (windowId: number, tabId: string) =>
    ipcRenderer.invoke("tab:reload", windowId, tabId) as Promise<void>,
  tabReorder: (windowId: number, orderedTabIds: string[]) =>
    ipcRenderer.invoke("tab:reorder", windowId, orderedTabIds) as Promise<void>,
  tabSetSidebarDragState: (windowId: number, tabId?: string | null) =>
    ipcRenderer.invoke("tab:set-sidebar-drag-state", windowId, tabId ?? null) as Promise<void>,
  splitViewShowMenu: (input: SplitViewMenuInput) =>
    ipcRenderer.invoke("split-view:show-menu", input) as Promise<SplitViewMenuAction | null>,
  tabShowItemMenu: (tabId: string, x?: number, y?: number) =>
    ipcRenderer.invoke("tab:show-item-menu", { tabId, x, y }) as Promise<void>,
  tabUpdateBounds: (windowId: number, sidebarWidth: number, urlBarHeight: number, rightPanelWidth?: number) =>
    ipcRenderer.invoke("tab:update-bounds", windowId, sidebarWidth, urlBarHeight, rightPanelWidth) as Promise<void>,
  tabSetCustomBounds: (windowId: number, tabId: string, bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("tab:set-custom-bounds", windowId, tabId, bounds) as Promise<void>,
  tabCapturePage: (windowId: number, tabId?: string) =>
    ipcRenderer.invoke("tab:capture-page", windowId, tabId) as Promise<{
      success: boolean;
      dataUrl?: string;
      width?: number;
      height?: number;
      title?: string;
      url?: string;
      error?: string;
    }>,
  tabGetPageTelemetry: (windowId: number, tabId?: string) =>
    ipcRenderer.invoke("tab:get-page-telemetry", windowId, tabId) as Promise<{
      success: boolean;
      url: string;
      title: string;
      wordCount: number;
      readingTimeMin: number;
      headings: string[];
      linksCount: number;
      imagesCount: number;
      metaDescription: string;
      ogImage?: string;
      security: {
        isHttps: boolean;
        protocol: string;
      };
      dimensions: {
        innerWidth: number;
        innerHeight: number;
        scrollHeight: number;
        devicePixelRatio: number;
      };
      performance: {
        loadTimeMs: number;
        domContentLoadedMs: number;
      };
      snippet: string;
      error?: string;
    }>,
  executeBrowserAction: (windowId: number, tabId: string, action: string, params?: Record<string, unknown>) =>
    ipcRenderer.invoke("tab:execute-browser-action", windowId, tabId, action, params) as Promise<{ success: boolean; result?: any; error?: string }>,
  tabGetCodingContext: (windowId: number, tabId?: string) =>
    ipcRenderer.invoke("tab:get-coding-context", windowId, tabId) as Promise<{
      isCodingSite: boolean;
      platform: string;
      problemTitle: string;
      problemDescription: string;
      detectedLanguage: string;
      starterCode: string;
      editorType: string;
      url: string;
      error?: string;
    }>,
  tabInjectCode: (windowId: number, tabId: string, code: string) =>
    ipcRenderer.invoke("tab:inject-code", windowId, tabId, code) as Promise<{
      success: boolean;
      methodUsed: string;
      codeLength: number;
      message: string;
      error?: string;
    }>,
  tabRunCode: (windowId: number, tabId: string) =>
    ipcRenderer.invoke("tab:run-code", windowId, tabId) as Promise<{
      clicked: boolean;
      target?: string;
      message?: string;
      error?: string;
    }>,
  onSplitViewDragPreview: (callback: (payload: SplitViewDragPreviewPayload) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: SplitViewDragPreviewPayload,
    ) => {
      callback(payload);
    };

    ipcRenderer.on("tab:split-drag-preview", listener);

    return () => {
      ipcRenderer.removeListener("tab:split-drag-preview", listener);
    };
  },
  onSplitViewDragClear: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("tab:split-drag-clear", listener);

    return () => {
      ipcRenderer.removeListener("tab:split-drag-clear", listener);
    };
  },
  onSplitViewDragDrop: (callback: (payload: SplitViewDragDropPayload) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: SplitViewDragDropPayload,
    ) => {
      callback(payload);
    };

    ipcRenderer.on("tab:split-drag-drop", listener);

    return () => {
      ipcRenderer.removeListener("tab:split-drag-drop", listener);
    };
  },
  onTabStateUpdate: (callback: (payload: TabStateUpdate) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: TabStateUpdate,
    ) => {
      callback(payload);
    };

    ipcRenderer.on("tab:state-update", listener);

    return () => {
      ipcRenderer.removeListener("tab:state-update", listener);
    };
  },
  pageSearchFind: (input: {
    tabId: string;
    query: string;
    findNext?: boolean;
    forward?: boolean;
  }) =>
    ipcRenderer.invoke("page-search:find", input) as Promise<void>,
  pageSearchStop: (
    tabId: string,
    action?: "clearSelection" | "keepSelection" | "activateSelection",
  ) =>
    ipcRenderer.invoke(
      "page-search:stop",
      tabId,
      action ?? "clearSelection",
    ) as Promise<void>,
  pageSearchOverlayGetState: () =>
    ipcRenderer.invoke("page-search-overlay:get-state") as Promise<{
      visible: boolean;
      tabId: string;
      query: string;
      result: {
        tabId: string;
        query: string;
        activeMatchOrdinal: number;
        matches: number;
        finalUpdate: boolean;
      } | null;
      focusInput: boolean;
    }>,
  pageSearchOverlayClose: () =>
    ipcRenderer.invoke("page-search-overlay:close") as Promise<void>,
  onPageSearchOverlayState: (callback: (payload: {
      visible: boolean;
      tabId: string;
      query: string;
      result: {
        tabId: string;
        query: string;
        activeMatchOrdinal: number;
        matches: number;
        finalUpdate: boolean;
      } | null;
      focusInput: boolean;
    }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        visible: boolean;
        tabId: string;
        query: string;
        result: {
          tabId: string;
          query: string;
          activeMatchOrdinal: number;
          matches: number;
          finalUpdate: boolean;
        } | null;
        focusInput: boolean;
      },
    ) => {
      callback(payload);
    };

    ipcRenderer.on("browser:page-search-overlay-state", listener);

    return () => {
      ipcRenderer.removeListener("browser:page-search-overlay-state", listener);
    };
  },
  onPageSearchRequested: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("browser:open-page-search-requested", listener);

    return () => {
      ipcRenderer.removeListener("browser:open-page-search-requested", listener);
    };
  },
  onPageSearchResult: (callback: (payload: {
    tabId: string;
    query: string;
    activeMatchOrdinal: number;
    matches: number;
    finalUpdate: boolean;
  }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        tabId: string;
        query: string;
        activeMatchOrdinal: number;
        matches: number;
        finalUpdate: boolean;
      },
    ) => {
      callback(payload);
    };

    ipcRenderer.on("browser:page-search-result", listener);

    return () => {
      ipcRenderer.removeListener("browser:page-search-result", listener);
    };
  },

  // Bookmarks
  bookmarksList: () =>
    ipcRenderer.invoke("bookmarks:list") as Promise<BookmarkRecord[]>,
  bookmarksGetState: () =>
    ipcRenderer.invoke("bookmarks:get-state") as Promise<{
      bookmarks: BookmarkRecord[];
      folders: BookmarkFolderRecord[];
    }>,
  bookmarksFoldersList: () =>
    ipcRenderer.invoke("bookmarks:folders:list") as Promise<BookmarkFolderRecord[]>,
  bookmarksFolderCreate: (name: string, parentId?: string | null) =>
    ipcRenderer.invoke("bookmarks:folders:create", name, parentId) as Promise<{
      bookmarks: BookmarkRecord[];
      folders: BookmarkFolderRecord[];
    }>,
  bookmarksFolderUpdate: (id: string, input: { name?: string; parentId?: string | null }) =>
    ipcRenderer.invoke("bookmarks:folders:update", id, input) as Promise<{
      bookmarks: BookmarkRecord[];
      folders: BookmarkFolderRecord[];
    }>,
  bookmarksFolderRemove: (id: string) =>
    ipcRenderer.invoke("bookmarks:folders:remove", id) as Promise<{
      bookmarks: BookmarkRecord[];
      folders: BookmarkFolderRecord[];
    }>,
  bookmarksAdd: (title: string, url: string, favicon?: string, folderId?: string | null) =>
    ipcRenderer.invoke("bookmarks:add", title, url, favicon, folderId) as Promise<BookmarkRecord[]>,
  bookmarksUpdate: (id: string, input: { title: string; url: string; favicon?: string; folderId?: string | null }) =>
    ipcRenderer.invoke("bookmarks:update", id, input) as Promise<BookmarkRecord[]>,
  bookmarksUpdateFavicons: (updates: Array<{ id: string; favicon: string }>) =>
    ipcRenderer.invoke("bookmarks:update-favicons", updates) as Promise<BookmarkRecord[]>,
  bookmarksRemove: (id: string) =>
    ipcRenderer.invoke("bookmarks:remove", id) as Promise<BookmarkRecord[]>,
  bookmarksClear: () =>
    ipcRenderer.invoke("bookmarks:clear") as Promise<BookmarkRecord[]>,
  bookmarksImportListSources: () =>
    ipcRenderer.invoke("bookmarks:import-sources:list") as Promise<BookmarkImportSource[]>,
  bookmarksImportSource: (sourceId: string) =>
    ipcRenderer.invoke("bookmarks:import-source", sourceId) as Promise<BookmarkImportResult>,
  bookmarksImportFile: () =>
    ipcRenderer.invoke("bookmarks:import-file") as Promise<BookmarkImportResult | null>,

  // History
  historyList: () =>
    ipcRenderer.invoke("history:list") as Promise<HistoryRecord[]>,
  historyGetState: () =>
    ipcRenderer.invoke("history:get-state") as Promise<{
      records: HistoryRecord[];
    }>,
  historyImportListSources: () =>
    ipcRenderer.invoke("history:import-sources:list") as Promise<HistoryImportSource[]>,
  historyImportSource: (sourceId: string) =>
    ipcRenderer.invoke("history:import-source", sourceId) as Promise<HistoryImportResult>,
  historyShowItemMenu: (url: string) =>
    ipcRenderer.invoke("history:show-item-menu", { url }) as Promise<void>,
  historyUpdate: (id: string, input: { title: string; url: string; favicon?: string }) =>
    ipcRenderer.invoke("history:update", id, input) as Promise<HistoryRecord[]>,
  historyRemove: (id: string) =>
    ipcRenderer.invoke("history:remove", id) as Promise<HistoryRecord[]>,
  historyClear: () =>
    ipcRenderer.invoke("history:clear") as Promise<HistoryRecord[]>,

  // Downloads
  downloadsList: () =>
    ipcRenderer.invoke("downloads:list") as Promise<DownloadRecord[]>,
  downloadsGetState: () =>
    ipcRenderer.invoke("downloads:get-state") as Promise<{
      records: DownloadRecord[];
    }>,
  downloadsCreate: (input: {
    url: string;
    source?: "manual" | "browser";
    sourcePageUrl?: string;
    partition?: string;
    headers?: Record<string, string>;
    filename?: string;
    directory?: string;
    targetPath?: string;
    threadCount?: number;
    mimeType?: string;
    totalBytes?: number | null;
    finalUrl?: string;
  }) =>
    ipcRenderer.invoke("downloads:create", input) as Promise<DownloadRecord>,
  downloadsPause: (id: string) =>
    ipcRenderer.invoke("downloads:pause", id) as Promise<DownloadRecord>,
  downloadsResume: (id: string) =>
    ipcRenderer.invoke("downloads:resume", id) as Promise<DownloadRecord>,
  downloadsCancel: (id: string) =>
    ipcRenderer.invoke("downloads:cancel", id) as Promise<DownloadRecord>,
  downloadsRetry: (id: string) =>
    ipcRenderer.invoke("downloads:retry", id) as Promise<DownloadRecord>,
  downloadsRemove: (id: string, deleteFile?: boolean) =>
    ipcRenderer.invoke("downloads:remove", id, deleteFile) as Promise<DownloadRecord[]>,
  downloadsDeleteFile: (id: string) =>
    ipcRenderer.invoke("downloads:delete-file", id) as Promise<DownloadRecord>,
  downloadsShowInFolder: (id: string) =>
    ipcRenderer.invoke("downloads:show-in-folder", id) as Promise<string>,
  downloadsShowSaveDialog: (input?: { filename?: string }) =>
    ipcRenderer.invoke("downloads:show-save-dialog", input) as Promise<string | null>,
  downloadsShowDirectoryDialog: (input?: { defaultPath?: string }) =>
    ipcRenderer.invoke("downloads:show-directory-dialog", input) as Promise<string | null>,
  downloadsGetPreferences: () =>
    ipcRenderer.invoke("downloads:get-preferences") as Promise<{
      defaultDirectory: string;
      hasCustomDirectory: boolean;
      defaultThreadCount: number;
      defaultHeadersText: string;
    }>,
  downloadsSetPreferences: (input?: {
    defaultDirectory?: string | null;
    defaultThreadCount?: number;
    defaultHeadersText?: string;
  }) =>
    ipcRenderer.invoke("downloads:set-preferences", input) as Promise<{
      defaultDirectory: string;
      hasCustomDirectory: boolean;
      defaultThreadCount: number;
      defaultHeadersText: string;
    }>,

  // Extensions
  extensionsList: () =>
    ipcRenderer.invoke("extensions:list") as Promise<BrowserExtensionSummary[]>,
  extensionsPickUnpackedDirectory: () =>
    ipcRenderer.invoke("extensions:pick-unpacked-directory") as Promise<string | null>,
  extensionsInstallFromStore: (input: string) =>
    ipcRenderer.invoke("extensions:install-from-store", input) as Promise<BrowserExtensionSummary>,
  extensionsInstallUnpacked: (extensionPath: string) =>
    ipcRenderer.invoke("extensions:install-unpacked", extensionPath) as Promise<BrowserExtensionSummary>,
  extensionsSetEnabled: (extensionId: string, enabled: boolean) =>
    ipcRenderer.invoke("extensions:set-enabled", extensionId, enabled) as Promise<BrowserExtensionSummary>,
  extensionsRemove: (extensionId: string) =>
    ipcRenderer.invoke("extensions:remove", extensionId) as Promise<void>,
  extensionsReload: (extensionId: string) =>
    ipcRenderer.invoke("extensions:reload", extensionId) as Promise<BrowserExtensionSummary>,
  extensionsReveal: (extensionId: string) =>
    ipcRenderer.invoke("extensions:reveal", extensionId) as Promise<string>,
  extensionsOpenActionPopup: (
    extensionId: string,
    anchor?: { left: number; top: number; width: number; height: number },
  ) =>
    ipcRenderer.invoke(
      "extensions:open-action-popup",
      extensionId,
      anchor,
    ) as Promise<BrowserExtensionActionSummary>,
  extensionsShowToolbarMenu: (input?: ExtensionsToolbarMenuInput) =>
    ipcRenderer.invoke("extensions:show-toolbar-menu", input) as Promise<void>,
  onExtensionsChanged: (callback: (payload: { profileId: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { profileId: string },
    ) => {
      callback(payload);
    };

    ipcRenderer.on("extensions:changed", listener);

    return () => {
      ipcRenderer.removeListener("extensions:changed", listener);
    };
  },

  // User scripts
  userScriptsList: () =>
    ipcRenderer.invoke("user-scripts:list") as Promise<UserScriptRecord[]>,
  userScriptsCreate: (input: UserScriptCreateInput) =>
    ipcRenderer.invoke("user-scripts:create", input) as Promise<UserScriptRecord>,
  userScriptsUpdate: (scriptId: string, input: UserScriptUpdateInput) =>
    ipcRenderer.invoke("user-scripts:update", scriptId, input) as Promise<UserScriptRecord>,
  userScriptsRemove: (scriptId: string) =>
    ipcRenderer.invoke("user-scripts:remove", scriptId) as Promise<void>,
  userScriptsSetEnabled: (scriptId: string, enabled: boolean) =>
    ipcRenderer.invoke("user-scripts:set-enabled", scriptId, enabled) as Promise<UserScriptRecord>,
  userScriptsRunNow: (scriptId: string) =>
    ipcRenderer.invoke("user-scripts:run-now", scriptId) as Promise<UserScriptRunResult>,
  userScriptsRunTest: (scriptId: string) =>
    ipcRenderer.invoke("user-scripts:run-test", scriptId) as Promise<UserScriptTestResult>,
  userScriptsAgentGenerate: (input: UserScriptAgentGenerateInput) =>
    ipcRenderer.invoke("user-scripts:agent-generate", input) as Promise<UserScriptAgentGenerateResult>,
  userScriptsShowToolbarPopup: (input: UserScriptsToolbarPopupInput) =>
    ipcRenderer.invoke("user-scripts:show-toolbar-popup", input) as Promise<void>,
  onUserScriptsChanged: (callback: (payload: { profileId: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { profileId: string },
    ) => {
      callback(payload);
    };

    ipcRenderer.on("user-scripts:changed", listener);

    return () => {
      ipcRenderer.removeListener("user-scripts:changed", listener);
    };
  },

  // Search overlay
  searchOpen: () =>
    ipcRenderer.invoke("search:open") as Promise<void>,
  searchGetOverlayData: () =>
    ipcRenderer.invoke("search:get-overlay-data") as Promise<{
      tabs: WindowTabSummary[];
      bookmarks: BookmarkRecord[];
      history: HistoryRecord[];
      activeTabId: string;
    }>,
  searchQuery: (query: string) =>
    ipcRenderer.invoke("search:query", query) as Promise<{
      tabs: WindowTabSummary[];
      bookmarks: BookmarkRecord[];
      history: HistoryRecord[];
      activeTabId: string;
    }>,
  searchClose: () =>
    ipcRenderer.invoke("search:close") as Promise<void>,
  aiSidebarGetState: () =>
    ipcRenderer.invoke("ai-sidebar:get-state") as Promise<{ visible: boolean; windowId: number | null; tabId: string | null }>,
  aiSidebarToggle: () =>
    ipcRenderer.invoke("ai-sidebar:toggle") as Promise<{ visible: boolean; windowId: number | null; tabId: string | null }>,
  aiSidebarClose: (input?: { windowId?: number | null; tabId?: string | null } | null) =>
    ipcRenderer.invoke("ai-sidebar:close", input ?? null) as Promise<{ visible: boolean; windowId: number | null; tabId: string | null }>,
  onAiSidebarStateChanged: (callback: (state: { visible: boolean; windowId: number | null; tabId: string | null }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: { visible: boolean; windowId: number | null; tabId: string | null },
    ) => {
      callback(state);
    };

    ipcRenderer.on("browser:ai-sidebar-state", listener);

    return () => {
      ipcRenderer.removeListener("browser:ai-sidebar-state", listener);
    };
  },
  onAiSidebarCloseRequested: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("browser:ai-sidebar-close-requested", listener);

    return () => {
      ipcRenderer.removeListener("browser:ai-sidebar-close-requested", listener);
    };
  },
  searchSelectTab: (tabId: string) =>
    ipcRenderer.invoke("search:select-tab", tabId) as Promise<void>,
  searchNavigate: (url: string) =>
    ipcRenderer.invoke("search:navigate-url", url) as Promise<void>,
  searchRemoveBookmark: (id: string) =>
    ipcRenderer.invoke("search:remove-bookmark", id) as Promise<BookmarkRecord[]>,
  startPageGetAppearance: () =>
    ipcRenderer.invoke("start-page:get-appearance") as Promise<StartPageAppearance>,
  startPageGetShellLayout: () =>
    ipcRenderer.invoke("start-page:get-shell-layout") as Promise<StartPageShellLayout | null>,
  startPageSetAppearance: (input?: Partial<StartPageAppearance> | null) =>
    ipcRenderer.invoke("start-page:set-appearance", input) as Promise<StartPageAppearance>,
  startPageGetDockItems: () =>
    ipcRenderer.invoke("start-page:get-dock-items") as Promise<StartPageDockItem[]>,
  startPageGetWidgets: () =>
    ipcRenderer.invoke("start-page:get-widgets") as Promise<StartPageWidgetsState>,
  startPageGetWidgetRefreshes: () =>
    ipcRenderer.invoke("start-page:get-widget-refreshes") as Promise<StartPageWidgetRefreshEvent[]>,
  startPageWidgetAutomationCall: (input: { source: string; widgetId: string; tool: string; input?: unknown }) =>
    ipcRenderer.invoke("start-page:widget-automation-call", input) as Promise<unknown>,
  startPageSetWidgets: (input?: StartPageWidget[] | null) =>
    ipcRenderer.invoke("start-page:set-widgets", input) as Promise<StartPageWidgetsState>,
  startPageSetDockItemFavicon: (id: string, favicon: string) =>
    ipcRenderer.invoke("start-page:set-dock-item-favicon", id, favicon) as Promise<StartPageDockItem[]>,
  startPageRemoveDockItem: (id: string) =>
    ipcRenderer.invoke("start-page:remove-dock-item", id) as Promise<StartPageDockItem[]>,
  startPageClearDockItems: () =>
    ipcRenderer.invoke("start-page:clear-dock-items") as Promise<StartPageDockItem[]>,
  widgetRegistryGetRootDirectory: () =>
    ipcRenderer.invoke("widget-registry:get-root-directory") as Promise<string>,
  widgetRegistryListPackages: () =>
    ipcRenderer.invoke("widget-registry:list-packages") as Promise<Array<{
      defaultSize: { h: number; w: number };
      defaultTitle: string;
      description?: string;
      entry: string;
      id: string;
      name: string;
      permissions: {
        network: boolean;
        openExternal: boolean;
      };
      rootPath: string;
      version: string;
    }>>,
  widgetRegistryGetPackage: (packageId: string) =>
    ipcRenderer.invoke("widget-registry:get-package", packageId) as Promise<{
      defaultSize: { h: number; w: number };
      defaultTitle: string;
      description?: string;
      entry: string;
      id: string;
      name: string;
      permissions: {
        network: boolean;
        openExternal: boolean;
      };
      rootPath: string;
      version: string;
    } | null>,
  widgetRegistryGetPackageManifest: (packageId: string) =>
    ipcRenderer.invoke("widget-registry:get-package-manifest", packageId) as Promise<{
      id: string;
      name: string;
      version: string;
      entry: string;
      description?: string;
      defaultTitle?: string;
      defaultSize?: {
        h?: number;
        w?: number;
      };
      permissions?: {
        network?: boolean;
        openExternal?: boolean;
      };
    } | null>,
  widgetRegistryPickPackageDirectory: () =>
    ipcRenderer.invoke("widget-registry:pick-package-directory") as Promise<string | null>,
  widgetRegistryInspectPackageDirectory: (directoryPath: string) =>
    ipcRenderer.invoke("widget-registry:inspect-package-directory", directoryPath) as Promise<{
      defaultSize: { h: number; w: number };
      defaultTitle: string;
      description?: string;
      entry: string;
      id: string;
      name: string;
      permissions: {
        network: boolean;
        openExternal: boolean;
      };
      rootPath: string;
      version: string;
    }>,
  widgetRegistryInstallPackageFromDirectory: (directoryPath: string) =>
    ipcRenderer.invoke("widget-registry:install-package-directory", directoryPath) as Promise<{
      defaultSize: { h: number; w: number };
      defaultTitle: string;
      description?: string;
      entry: string;
      id: string;
      name: string;
      permissions: {
        network: boolean;
        openExternal: boolean;
      };
      rootPath: string;
      version: string;
    }>,
  widgetRegistryRemovePackage: (packageId: string) =>
    ipcRenderer.invoke("widget-registry:remove-package", packageId) as Promise<string>,
  widgetRegistryRevealPackage: (packageId: string) =>
    ipcRenderer.invoke("widget-registry:reveal-package", packageId) as Promise<string>,
  widgetRegistryCreateStarterPackage: () =>
    ipcRenderer.invoke("widget-registry:create-starter-package") as Promise<{
      defaultSize: { h: number; w: number };
      defaultTitle: string;
      description?: string;
      entry: string;
      id: string;
      name: string;
      permissions: {
        network: boolean;
        openExternal: boolean;
      };
      rootPath: string;
      version: string;
    }>,
  widgetRegistryRevealRootDirectory: () =>
    ipcRenderer.invoke("widget-registry:reveal-root-directory") as Promise<string>,

  // Settings / Theme
  settingsGetTheme: () =>
    ipcRenderer.invoke("settings:get-theme") as Promise<string>,
  settingsSetTheme: (theme: string) =>
    ipcRenderer.invoke("settings:set-theme", theme) as Promise<string>,
  settingsGetLanguage: () =>
    ipcRenderer.invoke("settings:get-language") as Promise<string>,
  settingsGetDefaultBrowserStatus: () =>
    ipcRenderer.invoke("settings:get-default-browser-status") as Promise<{
      http: boolean;
      https: boolean;
      isDefaultBrowser: boolean;
      canSetAsDefaultBrowser: boolean;
      manualActionRequired: boolean;
      reason: "ready" | "packaged_build_required" | "manual_confirmation_required";
    }>,
  settingsSetLanguage: (language: string) =>
    ipcRenderer.invoke("settings:set-language", language) as Promise<string>,
  settingsSetDefaultBrowser: () =>
    ipcRenderer.invoke("settings:set-default-browser") as Promise<{
      http: boolean;
      https: boolean;
      isDefaultBrowser: boolean;
      canSetAsDefaultBrowser: boolean;
      manualActionRequired: boolean;
      reason: "ready" | "packaged_build_required" | "manual_confirmation_required";
      updated: boolean;
    }>,
  settingsExportAllData: (input?: {
    rendererSettings?: Record<string, unknown> | null;
  } | null) =>
    ipcRenderer.invoke("settings:export-all-data", input) as Promise<{
      canceled: boolean;
      filePath?: string;
      bytesWritten?: number;
      exportedAt?: string;
    }>,
  llmGetProviders: () =>
    ipcRenderer.invoke("llm:get-providers") as Promise<Array<{
      id: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      models: string[];
      extraBodyEnabled: boolean;
      extraBody: Record<string, unknown>;
      extraHeadersEnabled: boolean;
      extraHeaders: Record<string, string>;
      extractThinkingContent: boolean;
      thinkingContentTagName: string;
      interleavedThinkingEnabled: boolean;
      interleavedThinkingFieldName: string;
      modelSettings: Record<string, {
        extraBodyEnabled: boolean;
        extraBody: Record<string, unknown>;
        extraHeadersEnabled: boolean;
        extraHeaders: Record<string, string>;
        extractThinkingContent: boolean;
        thinkingContentTagName: string;
        interleavedThinkingEnabled: boolean;
        interleavedThinkingFieldName: string;
      }>;
    }>>,
  agentGetPreferences: () =>
    ipcRenderer.invoke("agent:get-preferences") as Promise<{
      providerId: string;
      model: string;
      mcpToolExportEnabled: boolean;
      profileInstructions: string;
      interactionBlacklistDomains: string[];
    }>,
  imageAgentGetPreferences: () =>
    ipcRenderer.invoke("image-agent:get-preferences") as Promise<{
      providerId: string;
      model: string;
    }>,
  learningGetPreferences: () =>
    ipcRenderer.invoke("learning:get-preferences") as Promise<{
      mode: "off" | "on";
      providerId: string;
      model: string;
      redactTextInput: boolean;
      retentionDays: number;
      blacklistDomains: string[];
    }>,
  llmSetProviders: (
    input?: Array<{
      id: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      models: string[];
      extraBodyEnabled: boolean;
      extraBody: Record<string, unknown>;
      extraHeadersEnabled: boolean;
      extraHeaders: Record<string, string>;
      extractThinkingContent: boolean;
      thinkingContentTagName: string;
      interleavedThinkingEnabled: boolean;
      interleavedThinkingFieldName: string;
      modelSettings: Record<string, {
        extraBodyEnabled: boolean;
        extraBody: Record<string, unknown>;
        extraHeadersEnabled: boolean;
        extraHeaders: Record<string, string>;
        extractThinkingContent: boolean;
        thinkingContentTagName: string;
        interleavedThinkingEnabled: boolean;
        interleavedThinkingFieldName: string;
      }>;
    }> | null,
  ) =>
    ipcRenderer.invoke("llm:set-providers", input) as Promise<Array<{
      id: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      models: string[];
      extraBodyEnabled: boolean;
      extraBody: Record<string, unknown>;
      extraHeadersEnabled: boolean;
      extraHeaders: Record<string, string>;
      extractThinkingContent: boolean;
      thinkingContentTagName: string;
      interleavedThinkingEnabled: boolean;
      interleavedThinkingFieldName: string;
      modelSettings: Record<string, {
        extraBodyEnabled: boolean;
        extraBody: Record<string, unknown>;
        extraHeadersEnabled: boolean;
        extraHeaders: Record<string, string>;
        extractThinkingContent: boolean;
        thinkingContentTagName: string;
        interleavedThinkingEnabled: boolean;
        interleavedThinkingFieldName: string;
      }>;
    }>>,
  agentSetPreferences: (
    input?: Partial<{
      providerId: string;
      model: string;
      mcpToolExportEnabled: boolean;
      profileInstructions: string;
      interactionBlacklistDomains: string[];
    }> | null,
  ) =>
    ipcRenderer.invoke("agent:set-preferences", input) as Promise<{
      providerId: string;
      model: string;
      mcpToolExportEnabled: boolean;
      profileInstructions: string;
      interactionBlacklistDomains: string[];
    }>,
  imageAgentSetPreferences: (
    input?: Partial<{
      providerId: string;
      model: string;
    }> | null,
  ) =>
    ipcRenderer.invoke("image-agent:set-preferences", input) as Promise<{
      providerId: string;
      model: string;
    }>,
  learningSetPreferences: (
    input?: Partial<{
      mode: "off" | "on";
      providerId: string;
      model: string;
      redactTextInput: boolean;
      retentionDays: number;
      blacklistDomains: string[];
    }> | null,
  ) =>
    ipcRenderer.invoke("learning:set-preferences", input) as Promise<{
      mode: "off" | "on";
      providerId: string;
      model: string;
      redactTextInput: boolean;
      retentionDays: number;
      blacklistDomains: string[];
    }>,
  learningClearState: () =>
    ipcRenderer.invoke("learning:clear-state") as Promise<{
      success: boolean;
    }>,
  learningFlushNow: () =>
    ipcRenderer.invoke("learning:flush-now") as Promise<LearningFlushResult>,
  learningDeleteSite: (siteId: string) =>
    ipcRenderer.invoke("learning:delete-site", siteId) as Promise<{
      success: boolean;
    }>,
  learningDeleteGuidance: (guidanceId: string) =>
    ipcRenderer.invoke("learning:delete-guidance", guidanceId) as Promise<{
      success: boolean;
    }>,
  learningDeleteSiteSkill: (skillId: string) =>
    ipcRenderer.invoke("learning:delete-site-skill", skillId) as Promise<{
      success: boolean;
    }>,
  learningDeleteHistorySite: (domain: string) =>
    ipcRenderer.invoke("learning:delete-history-site", domain) as Promise<{
      success: boolean;
    }>,
  learningDeleteStyleProfile: (profileId: string) =>
    ipcRenderer.invoke("learning:delete-style-profile", profileId) as Promise<{
      success: boolean;
    }>,
  learningDeletePreferenceProfile: (profileId: string) =>
    ipcRenderer.invoke("learning:delete-preference-profile", profileId) as Promise<{
      success: boolean;
    }>,
  learningUpsertUserMemory: (input: LearningUserMemoryUpsertInput) =>
    ipcRenderer.invoke("learning:upsert-user-memory", input) as Promise<{
      success: boolean;
      profile?: LearningPreferenceProfileSummary;
      signal?: LearningPreferenceSignal;
    }>,
  learningDeleteUserMemory: (input: LearningUserMemorySignalInput) =>
    ipcRenderer.invoke("learning:delete-user-memory", input) as Promise<{
      success: boolean;
      profile?: LearningPreferenceProfileSummary;
      signal?: LearningPreferenceSignal;
    }>,
  learningRejectUserMemory: (input: LearningUserMemorySignalInput) =>
    ipcRenderer.invoke("learning:reject-user-memory", input) as Promise<{
      success: boolean;
      profile?: LearningPreferenceProfileSummary;
      signal?: LearningPreferenceSignal;
    }>,
  learningGetSummary: (
    input?: {
      workspaceId?: string;
      activeUrl?: string;
    } | null,
  ) =>
    ipcRenderer.invoke("learning:get-summary", input) as Promise<{
      rawEventCount: number;
      pendingEventCount: number;
      pageSnapshotCount: number;
      observationCount: number;
      episodeCount: number;
      actionStrategyCount: number;
      guidanceCount: number;
      siteSkillCount: number;
      feedbackCount: number;
      styleProfileCount: number;
      preferenceProfileCount: number;
      historyRecordCount: number;
      historySiteCount: number;
      historyVisitCount: number;
      topHistorySites: LearningHistorySiteSummary[];
      recentActionStrategies: Array<{
        guidanceId: string;
        domain: string;
        pageType?: string;
        intentKey: string;
        intentLabel: string;
        purposeKey: "retrieve_data" | "submit_data" | "authenticate" | "download_export" | "navigate_workflow" | "other";
        purposeLabel: string;
        goalSummary: string;
        keywords: string[];
        preferredTargets: string[];
        recommendedSteps: string[];
        recoveryHints: string[];
        support: number;
        successRate: number;
        confidence: number;
        feedbackCount: number;
        lastSeenAt: number;
      }>;
      recentGuidance: Array<{
        guidanceId: string;
        domain: string;
        pageType?: string;
        intentKey: string;
        intentLabel: string;
        purposeKey: "retrieve_data" | "submit_data" | "authenticate" | "download_export" | "navigate_workflow" | "other";
        purposeLabel: string;
        goalSummary: string;
        keywords: string[];
        preferredTargets: string[];
        recommendedSteps: string[];
        recoveryHints: string[];
        support: number;
        successRate: number;
        confidence: number;
        feedbackCount: number;
        lastSeenAt: number;
      }>;
      lastUpdatedAt?: number;
    }>,
  learningGetCatalog: () =>
    ipcRenderer.invoke("learning:get-catalog") as Promise<{
      rawEventCount: number;
      pendingEventCount: number;
      pageSnapshotCount: number;
      observationCount: number;
      episodeCount: number;
      actionStrategyCount: number;
      guidanceCount: number;
      siteSkillCount: number;
      feedbackCount: number;
      styleProfileCount: number;
      preferenceProfileCount: number;
      historyRecordCount: number;
      historySiteCount: number;
      historyVisitCount: number;
      historyTopSites: LearningHistorySiteSummary[];
      styleProfiles: LearningStyleProfileSummary[];
      preferenceProfiles: LearningPreferenceProfileSummary[];
      siteCount: number;
      activeProgress: LearningProgressItem[];
      taskStatus: LearningTaskStatus;
      sites: Array<{
        siteId: string;
        domain: string;
        scheme?: string;
        actionStrategyCount: number;
        guidanceCount: number;
        siteSkillCount: number;
        feedbackCount: number;
        totalSupport: number;
        lastSeenAt: number;
        history?: LearningHistorySiteSummary | null;
        actionStrategies: Array<{
          guidanceId: string;
          pageType?: string;
          intentKey: string;
          intentLabel: string;
          purposeKey: "retrieve_data" | "submit_data" | "authenticate" | "download_export" | "navigate_workflow" | "other";
          purposeLabel: string;
          goalSummary: string;
          keywords: string[];
          preferredTargets: string[];
          recommendedSteps: string[];
          recoveryHints: string[];
          support: number;
          successRate: number;
          confidence: number;
          feedbackCount: number;
          lastSeenAt: number;
        }>;
        behaviors: Array<{
          guidanceId: string;
          pageType?: string;
          intentKey: string;
          intentLabel: string;
          purposeKey: "retrieve_data" | "submit_data" | "authenticate" | "download_export" | "navigate_workflow" | "other";
          purposeLabel: string;
          goalSummary: string;
          keywords: string[];
          preferredTargets: string[];
          recommendedSteps: string[];
          recoveryHints: string[];
          support: number;
          successRate: number;
          confidence: number;
          feedbackCount: number;
          lastSeenAt: number;
        }>;
        siteSkills: Array<{
          skillId: string;
          domain: string;
          pageType?: string;
          patternKey:
            | "confirm_after_typing"
            | "scroll_before_primary_action"
            | "dialog_interruption"
            | "navigation_after_click"
            | "download_requires_verification"
            | "llm_inferred";
          patternLabel: string;
          rule: string;
          evidence: string[];
          support: number;
          successRate: number;
          confidence: number;
          lastSeenAt: number;
        }>;
      }>;
      lastUpdatedAt?: number;
    }>,
  translationGetPreferences: () =>
    ipcRenderer.invoke("translation:get-preferences") as Promise<{
      provider: "openai-compatible" | "google-basic" | "google-system" | "baidu-standard";
      targetLanguage: "system" | "en-US" | "zh-CN";
      requestConcurrency: number;
      autoTranslateDomains: string[];
      sources: {
        "openai-compatible": {
          providerId: string;
          endpoint: string;
          apiKey: string;
          model: string;
          extraBodyEnabled: boolean;
          extraBody: Record<string, unknown>;
          extraHeadersEnabled: boolean;
          extraHeaders: Record<string, string>;
          extractThinkingContent: boolean;
          thinkingContentTagName: string;
          interleavedThinkingEnabled: boolean;
          interleavedThinkingFieldName: string;
        };
        "google-basic": {
          endpoint: string;
          apiKey: string;
        };
        "google-system": {
          endpoint: string;
        };
        "baidu-standard": {
          endpoint: string;
          appId: string;
          apiKey: string;
        };
      };
    }>,
  translationSetPreferences: (
    input?: Partial<{
      provider: "openai-compatible" | "google-basic" | "google-system" | "baidu-standard";
      targetLanguage: "system" | "en-US" | "zh-CN";
      requestConcurrency: number;
      autoTranslateDomains: string[];
      sources: Partial<{
        "openai-compatible": Partial<{
          providerId: string;
          endpoint: string;
          apiKey: string;
          model: string;
          extraBodyEnabled: boolean;
          extraBody: Record<string, unknown>;
          extraHeadersEnabled: boolean;
          extraHeaders: Record<string, string>;
          extractThinkingContent: boolean;
          thinkingContentTagName: string;
          interleavedThinkingEnabled: boolean;
          interleavedThinkingFieldName: string;
        }>;
        "google-basic": Partial<{
          endpoint: string;
          apiKey: string;
        }>;
        "google-system": Partial<{
          endpoint: string;
        }>;
        "baidu-standard": Partial<{
          endpoint: string;
          appId: string;
          apiKey: string;
        }>;
      }>;
    }> | null,
  ) =>
    ipcRenderer.invoke("translation:set-preferences", input) as Promise<{
      provider: "openai-compatible" | "google-basic" | "google-system" | "baidu-standard";
      targetLanguage: "system" | "en-US" | "zh-CN";
      requestConcurrency: number;
      autoTranslateDomains: string[];
      sources: {
        "openai-compatible": {
          providerId: string;
          endpoint: string;
          apiKey: string;
          model: string;
          extraBodyEnabled: boolean;
          extraBody: Record<string, unknown>;
          extraHeadersEnabled: boolean;
          extraHeaders: Record<string, string>;
          extractThinkingContent: boolean;
          thinkingContentTagName: string;
          interleavedThinkingEnabled: boolean;
          interleavedThinkingFieldName: string;
        };
        "google-basic": {
          endpoint: string;
          apiKey: string;
        };
        "google-system": {
          endpoint: string;
        };
        "baidu-standard": {
          endpoint: string;
          appId: string;
          apiKey: string;
        };
      };
    }>,
  agentEnsureSession: (input: { workspaceId: string; windowId: number }) =>
    ipcRenderer.invoke("agent:ensure-session", input) as Promise<AgentSessionSnapshot>,
  agentListSessions: (input: { workspaceId: string; windowId: number }) =>
    ipcRenderer.invoke("agent:list-sessions", input) as Promise<AgentSessionListItem[]>,
  agentCreateSession: (
    input: {
      workspaceId: string;
      windowId: number;
      scope?: "default" | "current-tab";
      tabId?: string;
      content?: string;
      privacyMode?: boolean;
      profile?: "default" | "organizer" | "widget-builder";
    },
  ) =>
    ipcRenderer.invoke("agent:create-session", input) as Promise<AgentSessionSnapshot>,
  agentGetSession: (sessionId: string) =>
    ipcRenderer.invoke("agent:get-session", sessionId) as Promise<AgentSessionSnapshot | null>,
  agentGetSessionForTab: (input: { windowId?: number; tabId: string }) =>
    ipcRenderer.invoke("agent:get-session-for-tab", input) as Promise<AgentSessionSnapshot | null>,
  agentRebindSessionToTab: (input: { sessionId: string; workspaceId: string; windowId: number; tabId: string }) =>
    ipcRenderer.invoke("agent:rebind-session-to-tab", input) as Promise<AgentSessionSnapshot>,
  agentSendMessage: (input: { sessionId: string; content: string }) =>
    ipcRenderer.invoke("agent:send-message", input) as Promise<AgentSessionSnapshot>,
  agentSetSessionSchedule: (input: { sessionId: string; cronExpression: string; prompt?: string }) =>
    ipcRenderer.invoke("agent:set-session-schedule", input) as Promise<AgentSessionSnapshot>,
  agentClearSessionSchedule: (sessionId: string) =>
    ipcRenderer.invoke("agent:clear-session-schedule", sessionId) as Promise<AgentSessionSnapshot>,
  agentListLaunchSchedules: () =>
    ipcRenderer.invoke("agent:list-launch-schedules") as Promise<AgentLaunchScheduleSnapshot[]>,
  agentGetLaunchSchedule: (triggerId: string) =>
    ipcRenderer.invoke("agent:get-launch-schedule", triggerId) as Promise<AgentLaunchScheduleSnapshot | undefined>,
  agentSetLaunchSchedule: (input: {
    workspaceId?: string;
    windowId?: number;
    cronExpression: string;
    prompt: string;
    privacyMode?: boolean;
    profile?: "default" | "organizer" | "widget-builder";
    scope?: "default" | "current-tab";
    tabId?: string;
    title?: string;
    triggerId?: string;
  }) =>
    ipcRenderer.invoke("agent:set-launch-schedule", input) as Promise<AgentLaunchScheduleSnapshot>,
  agentClearLaunchSchedule: (triggerId: string) =>
    ipcRenderer.invoke("agent:clear-launch-schedule", triggerId) as Promise<AgentLaunchScheduleSnapshot | null | undefined>,
  agentInterruptSession: (sessionId: string) =>
    ipcRenderer.invoke("agent:interrupt-session", sessionId) as Promise<AgentSessionSnapshot>,
  agentResumeSession: (sessionId: string) =>
    ipcRenderer.invoke("agent:resume-session", sessionId) as Promise<AgentSessionSnapshot>,
  agentDeleteSession: (sessionId: string) =>
    ipcRenderer.invoke("agent:delete-session", sessionId) as Promise<AgentSessionDeleteResult>,
  agentGetMcpExport: (sessionId: string) =>
    ipcRenderer.invoke("agent:get-mcp-export", sessionId) as Promise<AgentMcpServerExport>,
  agentCallMcpTool: (input: AgentMcpToolCallInput) =>
    ipcRenderer.invoke("agent:call-mcp-tool", input) as Promise<unknown>,
  agentGetMcpHttpAddress: () =>
    ipcRenderer.invoke("agent:get-mcp-http-address") as Promise<string | null>,
  onAgentSessionUpdate: (callback: (update: AgentSessionUpdate) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      update: AgentSessionUpdate,
    ) => {
      callback(update);
    };

    ipcRenderer.on("agent:session-update", listener);

    return () => {
      ipcRenderer.removeListener("agent:session-update", listener);
    };
  },
  onThemeChanged: (callback: (theme: string) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      theme: string,
    ) => {
      callback(theme);
    };

    ipcRenderer.on("theme:changed", listener);

    return () => {
      ipcRenderer.removeListener("theme:changed", listener);
    };
  },
  onLanguageChanged: (callback: (language: string) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      language: string,
    ) => {
      callback(language);
    };

    ipcRenderer.on("language:changed", listener);

    return () => {
      ipcRenderer.removeListener("language:changed", listener);
    };
  },
  onStartPageDockChanged: (callback: (items: StartPageDockItem[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      items: StartPageDockItem[],
    ) => {
      callback(items);
    };

    ipcRenderer.on("start-page:dock-changed", listener);

    return () => {
      ipcRenderer.removeListener("start-page:dock-changed", listener);
    };
  },
  onStartPageWidgetsChanged: (callback: (state: StartPageWidgetsState) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: StartPageWidgetsState,
    ) => {
      callback(state);
    };

    ipcRenderer.on("start-page:widgets-changed", listener);

    return () => {
      ipcRenderer.removeListener("start-page:widgets-changed", listener);
    };
  },
  onStartPageWidgetRefresh: (callback: (event: StartPageWidgetRefreshEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      event: StartPageWidgetRefreshEvent,
    ) => {
      callback(event);
    };

    ipcRenderer.on("start-page:widget-refresh", listener);

    return () => {
      ipcRenderer.removeListener("start-page:widget-refresh", listener);
    };
  },
  onStartPageAppearanceChanged: (callback: (appearance: StartPageAppearance) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      appearance: StartPageAppearance,
    ) => {
      callback(appearance);
    };

    ipcRenderer.on("start-page:appearance-changed", listener);

    return () => {
      ipcRenderer.removeListener("start-page:appearance-changed", listener);
    };
  },
  onStartPageAddProtocolWidgetRequested: (callback: (payload: {
    source: string;
    title?: string | null;
    skipIfExists?: boolean;
  }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        source: string;
        title?: string | null;
        skipIfExists?: boolean;
      },
    ) => {
      callback(payload);
    };

    ipcRenderer.on("start-page:add-protocol-widget-requested", listener);

    return () => {
      ipcRenderer.removeListener("start-page:add-protocol-widget-requested", listener);
    };
  },
};

if (shouldExposeBrowserShell()) {
  // Forward bookmarks:changed event from main process
  ipcRenderer.on("bookmarks:changed", () => {
    window.dispatchEvent(new Event("bookmarks:changed"));
  });
  ipcRenderer.on("history:changed", () => {
    window.dispatchEvent(new Event("history:changed"));
  });
  ipcRenderer.on("downloads:changed", () => {
    window.dispatchEvent(new Event("downloads:changed"));
  });
  ipcRenderer.on("extensions:changed", (_event, payload: { profileId: string }) => {
    window.dispatchEvent(new CustomEvent("extensions:changed", {
      detail: payload,
    }));
  });
  ipcRenderer.on("user-scripts:changed", (_event, payload: { profileId: string }) => {
    window.dispatchEvent(new CustomEvent("user-scripts:changed", {
      detail: payload,
    }));
  });
  ipcRenderer.on("browser:open-search-overlay-requested", () => {
    window.dispatchEvent(new Event("browser:open-search-overlay-requested"));
  });
  ipcRenderer.on("browser:focus-address-bar-requested", () => {
    window.dispatchEvent(new Event("browser:focus-address-bar-requested"));
  });
  ipcRenderer.on("browser:toggle-shell-chrome-requested", () => {
    window.dispatchEvent(new Event("browser:toggle-shell-chrome-requested"));
  });

  contextBridge.exposeInMainWorld("browserShell", browserShell);
}

if (isTabViewContext) {
  installTabTitleTracking();
  installLinkPreviewPointerTracking();
  installTabLinkPreviewTracking();
  installLinkPreviewBackdropMask();
  installTabViewInteractionTracking();
} else if (isLinkPreviewShellContext) {
  installLinkPreviewShellUi();
}

installChromeWebStorePageIntegration();
runWhenDocumentElementReady(installInputWritingAssistIntegration);
runWhenDocumentElementReady(installContextIntelligenceIntegration);
