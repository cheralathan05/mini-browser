import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  dialog,
  safeStorage,
  type BrowserWindow,
  type MessageBoxOptions,
} from "electron";

type PasskeyLocale = "zh-CN" | "en-US";
type UserVerificationRequirement = "required" | "preferred" | "discouraged";
type ResidentKeyRequirement = "required" | "preferred" | "discouraged";

interface StoredPasskeyCredential {
  id: string;
  rpId: string;
  rpName?: string;
  userId: string;
  userName?: string;
  userDisplayName?: string;
  alg: number;
  privateKeyData: string;
  privateKeyEncoding: "safeStorage" | "plain";
  publicKeySpki: string;
  publicKeyX: string;
  publicKeyY: string;
  signCount: number;
  discoverable: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

interface PasskeyStorePayload {
  version: number;
  profiles: Record<string, StoredPasskeyCredential[]>;
}

export interface SerializedCredentialDescriptor {
  type?: string;
  id: string;
  transports?: string[];
}

export interface PasskeyCreateRequest {
  origin: string;
  rpId?: string;
  rpName?: string;
  user: {
    id: string;
    name?: string;
    displayName?: string;
  };
  challenge: string;
  pubKeyCredParams?: Array<{
    type?: string;
    alg?: number;
  }>;
  excludeCredentials?: SerializedCredentialDescriptor[];
  residentKey?: ResidentKeyRequirement;
  requireResidentKey?: boolean;
  userVerification?: UserVerificationRequirement;
  authenticatorAttachment?: string;
  attestation?: string;
}

export interface PasskeyGetRequest {
  origin: string;
  rpId?: string;
  challenge: string;
  allowCredentials?: SerializedCredentialDescriptor[];
  userVerification?: UserVerificationRequirement;
  mediation?: string;
}

export interface SerializedAttestationCredential {
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

export interface SerializedAssertionCredential {
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

export interface PasskeyOperationError {
  name: string;
  message: string;
}

export type PasskeyOperationResult<T> =
  | {
      ok: true;
      credential: T;
    }
  | {
      ok: false;
      error: PasskeyOperationError;
    };

interface PasskeyManagerContext {
  getStoragePath: () => string;
  getLocale: () => string;
}

class PasskeyManagerError extends Error {
  name: string;

  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

function toBase64Url(value: Uint8Array | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function encodeUtf8(value: string) {
  return Buffer.from(value, "utf8");
}

function sha256(value: Uint8Array | Buffer | string) {
  return createHash("sha256").update(value).digest();
}

function writeUint16(value: number) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

function writeUint32(value: number) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function isLocalhostLike(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function isIpAddress(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function isSecureOrigin(originUrl: URL) {
  return originUrl.protocol === "https:" || (originUrl.protocol === "http:" && isLocalhostLike(originUrl.hostname));
}

function normalizeRpIdForOrigin(origin: URL, requestedRpId?: string) {
  const hostname = origin.hostname.toLowerCase();
  const normalizedRequested = typeof requestedRpId === "string" ? requestedRpId.trim().toLowerCase() : "";

  if (!normalizedRequested) {
    return hostname;
  }

  if (
    normalizedRequested.includes("://")
    || normalizedRequested.includes("/")
    || normalizedRequested.includes("?")
    || normalizedRequested.includes("#")
    || normalizedRequested.includes("@")
    || normalizedRequested.startsWith(".")
    || normalizedRequested.endsWith(".")
  ) {
    throw new PasskeyManagerError("SecurityError", "The relying party identifier is invalid for the current origin.");
  }

  if (isIpAddress(normalizedRequested) || isIpAddress(hostname)) {
    if (normalizedRequested !== hostname) {
      throw new PasskeyManagerError("SecurityError", "The relying party identifier is invalid for the current origin.");
    }
    return normalizedRequested;
  }

  if (normalizedRequested === hostname || hostname.endsWith(`.${normalizedRequested}`)) {
    return normalizedRequested;
  }

  throw new PasskeyManagerError("SecurityError", "The relying party identifier is invalid for the current origin.");
}

function resolveRequestOrigin(origin: string) {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new PasskeyManagerError("SecurityError", "The current page is not a valid relying party origin.");
  }

  if (!isSecureOrigin(parsedOrigin)) {
    throw new PasskeyManagerError("SecurityError", "Passkeys are only available in secure browsing contexts.");
  }

  return parsedOrigin;
}

function resolveLocale(value: string): PasskeyLocale {
  return value.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function cborEncode(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([cborEncodeHead(2, value.length), value]);
  }

  if (value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    return Buffer.concat([cborEncodeHead(2, buffer.length), buffer]);
  }

  if (typeof value === "string") {
    const encoded = encodeUtf8(value);
    return Buffer.concat([cborEncodeHead(3, encoded.length), encoded]);
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError("CBOR encoder only supports integer numbers.");
    }

    if (value >= 0) {
      return cborEncodeHead(0, value);
    }

    return cborEncodeHead(1, -1 - value);
  }

  if (Array.isArray(value)) {
    const entries = value.map((entry) => cborEncode(entry));
    return Buffer.concat([cborEncodeHead(4, entries.length), ...entries]);
  }

  if (value instanceof Map) {
    const entries: Buffer[] = [];
    for (const [key, entryValue] of value.entries()) {
      entries.push(cborEncode(key));
      entries.push(cborEncode(entryValue));
    }
    return Buffer.concat([cborEncodeHead(5, value.size), ...entries]);
  }

  if (value && typeof value === "object") {
    const objectEntries = Object.entries(value as Record<string, unknown>);
    const encodedEntries = objectEntries.flatMap(([key, entryValue]) => [
      cborEncode(key),
      cborEncode(entryValue),
    ]);
    return Buffer.concat([cborEncodeHead(5, objectEntries.length), ...encodedEntries]);
  }

  if (value === false) {
    return Buffer.from([0xf4]);
  }

  if (value === true) {
    return Buffer.from([0xf5]);
  }

  if (value === null) {
    return Buffer.from([0xf6]);
  }

  throw new TypeError("Unsupported CBOR value.");
}

function cborEncodeHead(majorType: number, value: number) {
  if (value < 24) {
    return Buffer.from([(majorType << 5) | value]);
  }

  if (value < 0x100) {
    return Buffer.from([(majorType << 5) | 24, value]);
  }

  if (value < 0x10000) {
    const buffer = Buffer.allocUnsafe(3);
    buffer[0] = (majorType << 5) | 25;
    buffer.writeUInt16BE(value, 1);
    return buffer;
  }

  if (value <= 0xffffffff) {
    const buffer = Buffer.allocUnsafe(5);
    buffer[0] = (majorType << 5) | 26;
    buffer.writeUInt32BE(value, 1);
    return buffer;
  }

  const buffer = Buffer.allocUnsafe(9);
  buffer[0] = (majorType << 5) | 27;
  buffer.writeBigUInt64BE(BigInt(value), 1);
  return buffer;
}

function buildCoseEncodedPublicKey(x: string, y: string) {
  return cborEncode(
    new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, fromBase64Url(x)],
      [-3, fromBase64Url(y)],
    ]),
  );
}

function buildAuthenticatorData(
  rpId: string,
  options: {
    userVerified: boolean;
    signCount: number;
    attestedCredentialData?: {
      credentialId: string;
      publicKeyX: string;
      publicKeyY: string;
    };
  },
) {
  const rpIdHash = sha256(rpId);
  let flags = 0x01;
  if (options.userVerified) {
    flags |= 0x04;
  }

  const parts: Buffer[] = [
    rpIdHash,
    Buffer.from([flags]),
    writeUint32(options.signCount),
  ];

  if (options.attestedCredentialData) {
    flags |= 0x40;
    parts[1] = Buffer.from([flags]);
    const credentialId = fromBase64Url(options.attestedCredentialData.credentialId);
    parts.push(Buffer.alloc(16));
    parts.push(writeUint16(credentialId.length));
    parts.push(credentialId);
    parts.push(
      buildCoseEncodedPublicKey(
        options.attestedCredentialData.publicKeyX,
        options.attestedCredentialData.publicKeyY,
      ),
    );
  }

  return Buffer.concat(parts);
}

function buildClientDataJson(type: "webauthn.create" | "webauthn.get", challenge: string, origin: string) {
  return encodeUtf8(JSON.stringify({
    type,
    challenge,
    origin,
    crossOrigin: false,
  }));
}

function buildAttestationObject(authenticatorData: Buffer) {
  return cborEncode({
    fmt: "none",
    attStmt: {},
    authData: authenticatorData,
  });
}

function sanitizeStoredCredential(candidate: unknown): StoredPasskeyCredential | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Partial<StoredPasskeyCredential>;
  if (
    typeof record.id !== "string"
    || typeof record.rpId !== "string"
    || typeof record.userId !== "string"
    || typeof record.privateKeyData !== "string"
    || (record.privateKeyEncoding !== "safeStorage" && record.privateKeyEncoding !== "plain")
    || typeof record.publicKeySpki !== "string"
    || typeof record.publicKeyX !== "string"
    || typeof record.publicKeyY !== "string"
    || typeof record.alg !== "number"
    || typeof record.signCount !== "number"
    || typeof record.discoverable !== "boolean"
    || typeof record.createdAt !== "number"
    || typeof record.updatedAt !== "number"
  ) {
    return null;
  }

  return {
    id: record.id,
    rpId: record.rpId,
    rpName: typeof record.rpName === "string" ? record.rpName : undefined,
    userId: record.userId,
    userName: typeof record.userName === "string" ? record.userName : undefined,
    userDisplayName: typeof record.userDisplayName === "string" ? record.userDisplayName : undefined,
    alg: record.alg,
    privateKeyData: record.privateKeyData,
    privateKeyEncoding: record.privateKeyEncoding,
    publicKeySpki: record.publicKeySpki,
    publicKeyX: record.publicKeyX,
    publicKeyY: record.publicKeyY,
    signCount: Math.max(0, Math.trunc(record.signCount)),
    discoverable: record.discoverable,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: typeof record.lastUsedAt === "number" ? record.lastUsedAt : undefined,
  };
}

function makeCredentialLabel(credential: StoredPasskeyCredential, index: number) {
  const primaryLabel = credential.userDisplayName?.trim()
    || credential.userName?.trim()
    || `Passkey ${index + 1}`;
  const secondaryLabel = credential.userName?.trim()
    && credential.userDisplayName?.trim()
    && credential.userDisplayName.trim() !== credential.userName.trim()
    ? ` (${credential.userName.trim()})`
    : "";
  return `${primaryLabel}${secondaryLabel}`;
}

function normalizeCredentialDescriptorIds(credentials?: SerializedCredentialDescriptor[]) {
  if (!Array.isArray(credentials)) {
    return new Set<string>();
  }

  return new Set(
    credentials
      .filter((descriptor) => Boolean(descriptor) && (!descriptor.type || descriptor.type === "public-key"))
      .map((descriptor) => String(descriptor.id ?? "").trim())
      .filter(Boolean),
  );
}

function createErrorResult<T>(name: string, message: string): PasskeyOperationResult<T> {
  return {
    ok: false,
    error: {
      name,
      message,
    },
  };
}

function createSuccessResult<T>(credential: T): PasskeyOperationResult<T> {
  return {
    ok: true,
    credential,
  };
}

async function showMessageBoxForWindow(ownerWindow: BrowserWindow | null, options: MessageBoxOptions) {
  if (ownerWindow && !ownerWindow.isDestroyed()) {
    return dialog.showMessageBox(ownerWindow, options);
  }

  return dialog.showMessageBox(options);
}

function serializePrivateKeyPem(privateKeyPem: string) {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      privateKeyData: toBase64Url(safeStorage.encryptString(privateKeyPem)),
      privateKeyEncoding: "safeStorage" as const,
    };
  }

  return {
    privateKeyData: privateKeyPem,
    privateKeyEncoding: "plain" as const,
  };
}

function deserializePrivateKeyPem(credential: StoredPasskeyCredential) {
  if (credential.privateKeyEncoding === "plain") {
    return credential.privateKeyData;
  }

  return safeStorage.decryptString(fromBase64Url(credential.privateKeyData));
}

export function createPasskeyManager(context: PasskeyManagerContext) {
  const recordsByProfileId = new Map<string, StoredPasskeyCredential[]>();
  let didLoadStore = false;

  function ensureStoreLoaded() {
    if (didLoadStore) {
      return;
    }

    didLoadStore = true;
    const storagePath = context.getStoragePath();
    if (!existsSync(storagePath)) {
      return;
    }

    try {
      const raw = readFileSync(storagePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PasskeyStorePayload>;
      const profiles = parsed.profiles && typeof parsed.profiles === "object"
        ? parsed.profiles
        : {};

      for (const [profileId, storedRecords] of Object.entries(profiles)) {
        if (!Array.isArray(storedRecords)) {
          continue;
        }

        const sanitized = storedRecords
          .map((record) => sanitizeStoredCredential(record))
          .filter((record): record is StoredPasskeyCredential => Boolean(record));
        recordsByProfileId.set(profileId, sanitized);
      }
    } catch (error) {
      console.error("[Passkeys] Failed to load stored credentials.", error);
    }
  }

  function saveStore() {
    const storagePath = context.getStoragePath();
    const parentDirectory = path.dirname(storagePath);
    mkdirSync(parentDirectory, { recursive: true });

    const payload: PasskeyStorePayload = {
      version: 1,
      profiles: Object.fromEntries(
        Array.from(recordsByProfileId.entries()).map(([profileId, records]) => [
          profileId,
          records,
        ]),
      ),
    };

    writeFileSync(storagePath, JSON.stringify(payload, null, 2), "utf8");
  }

  function getProfileCredentials(profileId: string) {
    ensureStoreLoaded();
    const existing = recordsByProfileId.get(profileId);
    if (existing) {
      return existing;
    }

    const nextRecords: StoredPasskeyCredential[] = [];
    recordsByProfileId.set(profileId, nextRecords);
    return nextRecords;
  }

  async function promptCreatePasskey(
    ownerWindow: BrowserWindow | null,
    locale: PasskeyLocale,
    request: PasskeyCreateRequest,
    rpId: string,
  ) {
    const isChinese = locale === "zh-CN";
    const userLabel = request.user.displayName?.trim() || request.user.name?.trim() || "Unknown user";

    const result = await showMessageBoxForWindow(ownerWindow, {
      type: "question",
      buttons: isChinese ? ["创建", "取消"] : ["Create", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: isChinese ? "创建 passkey" : "Create a passkey",
      detail: isChinese
        ? `站点 ${request.rpName?.trim() || rpId} 想为 ${userLabel} 创建新的 passkey。`
        : `${request.rpName?.trim() || rpId} wants to create a new passkey for ${userLabel}.`,
      noLink: true,
    });

    return result.response === 0;
  }

  async function promptUseSinglePasskey(
    ownerWindow: BrowserWindow | null,
    locale: PasskeyLocale,
    credential: StoredPasskeyCredential,
    rpName: string,
  ) {
    const isChinese = locale === "zh-CN";
    const result = await showMessageBoxForWindow(ownerWindow, {
      type: "question",
      buttons: isChinese ? ["继续", "取消"] : ["Continue", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: isChinese ? "使用 passkey 登录" : "Use a passkey to sign in",
      detail: isChinese
        ? `使用 ${makeCredentialLabel(credential, 0)} 登录 ${rpName}。`
        : `Use ${makeCredentialLabel(credential, 0)} to sign in to ${rpName}.`,
      noLink: true,
    });

    return result.response === 0;
  }

  async function promptSelectPasskey(
    ownerWindow: BrowserWindow | null,
    locale: PasskeyLocale,
    credentials: StoredPasskeyCredential[],
    rpName: string,
  ) {
    const isChinese = locale === "zh-CN";
    const buttons = credentials.map((credential, index) => makeCredentialLabel(credential, index));
    buttons.push(isChinese ? "取消" : "Cancel");

    const result = await showMessageBoxForWindow(ownerWindow, {
      type: "question",
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      message: isChinese ? "选择要使用的 passkey" : "Choose a passkey",
      detail: isChinese
        ? `请选择一个用于登录 ${rpName} 的 passkey。`
        : `Choose which passkey to use for ${rpName}.`,
      noLink: true,
    });

    if (result.response < 0 || result.response >= credentials.length) {
      return null;
    }

    return credentials[result.response];
  }

  function buildSupportedAlgorithm(request: PasskeyCreateRequest) {
    const parameters = Array.isArray(request.pubKeyCredParams) ? request.pubKeyCredParams : [];
    const supported = parameters.find((entry) => entry?.type === "public-key" && entry.alg === -7);
    if (!supported) {
      throw new PasskeyManagerError("NotSupportedError", "This browser currently supports ES256 passkeys only.");
    }

    return supported.alg ?? -7;
  }

  async function createCredential(
    profileId: string,
    request: PasskeyCreateRequest,
    ownerWindow: BrowserWindow | null,
  ): Promise<PasskeyOperationResult<SerializedAttestationCredential>> {
    try {
      const locale = resolveLocale(context.getLocale());
      const origin = resolveRequestOrigin(request.origin);
      const rpId = normalizeRpIdForOrigin(origin, request.rpId);
      const userId = String(request.user?.id ?? "").trim();
      const challenge = String(request.challenge ?? "").trim();
      if (!userId || !challenge) {
        throw new PasskeyManagerError("TypeError", "The passkey registration request is missing required fields.");
      }

      const algorithm = buildSupportedAlgorithm(request);
      const profileCredentials = getProfileCredentials(profileId);
      const excludeCredentialIds = normalizeCredentialDescriptorIds(request.excludeCredentials);
      const excludedCredential = profileCredentials.find(
        (credential) => credential.rpId === rpId && excludeCredentialIds.has(credential.id),
      );
      if (excludedCredential) {
        throw new PasskeyManagerError("InvalidStateError", "A matching passkey already exists for this account.");
      }

      const approved = await promptCreatePasskey(
        ownerWindow,
        locale,
        request,
        request.rpName?.trim() || rpId,
      );
      if (!approved) {
        return createErrorResult("NotAllowedError", "Passkey creation was canceled.");
      }

      const { publicKey, privateKey } = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
      });
      const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
      if (
        typeof publicJwk.x !== "string"
        || typeof publicJwk.y !== "string"
      ) {
        throw new PasskeyManagerError("UnknownError", "Failed to export the generated passkey.");
      }

      const credentialId = toBase64Url(randomBytes(32));
      const residentKey = request.residentKey ?? (request.requireResidentKey ? "required" : "discouraged");
      const userVerified = request.userVerification === "required" || request.userVerification === "preferred";
      const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const serializedPrivateKey = serializePrivateKeyPem(privateKeyPem);
      const clientDataJSON = buildClientDataJson("webauthn.create", challenge, origin.origin);
      const authenticatorData = buildAuthenticatorData(rpId, {
        signCount: 0,
        userVerified,
        attestedCredentialData: {
          credentialId,
          publicKeyX: publicJwk.x,
          publicKeyY: publicJwk.y,
        },
      });
      const attestationObject = buildAttestationObject(authenticatorData);
      const now = Date.now();

      profileCredentials.push({
        id: credentialId,
        rpId,
        rpName: request.rpName?.trim() || undefined,
        userId,
        userName: request.user.name?.trim() || undefined,
        userDisplayName: request.user.displayName?.trim() || undefined,
        alg: algorithm,
        privateKeyData: serializedPrivateKey.privateKeyData,
        privateKeyEncoding: serializedPrivateKey.privateKeyEncoding,
        publicKeySpki: toBase64Url(publicKey.export({ type: "spki", format: "der" })),
        publicKeyX: publicJwk.x,
        publicKeyY: publicJwk.y,
        signCount: 0,
        discoverable: residentKey !== "discouraged",
        createdAt: now,
        updatedAt: now,
      });
      saveStore();

      return createSuccessResult({
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          attestationObject: toBase64Url(attestationObject),
          authenticatorData: toBase64Url(authenticatorData),
          publicKey: toBase64Url(publicKey.export({ type: "spki", format: "der" })),
          publicKeyAlgorithm: algorithm,
          transports: ["internal"],
        },
      });
    } catch (error) {
      if (error instanceof PasskeyManagerError) {
        return createErrorResult(error.name, error.message);
      }

      console.error("[Passkeys] Failed to create passkey.", error);
      return createErrorResult("UnknownError", "Failed to create a passkey for this site.");
    }
  }

  async function getAssertion(
    profileId: string,
    request: PasskeyGetRequest,
    ownerWindow: BrowserWindow | null,
  ): Promise<PasskeyOperationResult<SerializedAssertionCredential>> {
    try {
      const locale = resolveLocale(context.getLocale());
      const origin = resolveRequestOrigin(request.origin);
      const rpId = normalizeRpIdForOrigin(origin, request.rpId);
      const challenge = String(request.challenge ?? "").trim();
      if (!challenge) {
        throw new PasskeyManagerError("TypeError", "The passkey sign-in request is missing a challenge.");
      }

      const allowCredentialIds = normalizeCredentialDescriptorIds(request.allowCredentials);
      const profileCredentials = getProfileCredentials(profileId);
      const candidateCredentials = profileCredentials.filter((credential) => {
        if (credential.rpId !== rpId) {
          return false;
        }

        if (allowCredentialIds.size > 0) {
          return allowCredentialIds.has(credential.id);
        }

        return credential.discoverable;
      });

      if (candidateCredentials.length === 0) {
        return createErrorResult("NotAllowedError", "No matching passkey is available for this site.");
      }

      let selectedCredential: StoredPasskeyCredential | null;
      if (candidateCredentials.length === 1) {
        const approved = await promptUseSinglePasskey(
          ownerWindow,
          locale,
          candidateCredentials[0],
          request.rpId?.trim() || rpId,
        );
        selectedCredential = approved ? candidateCredentials[0] : null;
      } else {
        selectedCredential = await promptSelectPasskey(
          ownerWindow,
          locale,
          candidateCredentials,
          request.rpId?.trim() || rpId,
        );
      }

      if (!selectedCredential) {
        return createErrorResult("NotAllowedError", "Passkey sign-in was canceled.");
      }

      const userVerified = request.userVerification === "required" || request.userVerification === "preferred";
      const nextSignCount = selectedCredential.signCount + 1;
      const clientDataJSON = buildClientDataJson("webauthn.get", challenge, origin.origin);
      const authenticatorData = buildAuthenticatorData(rpId, {
        signCount: nextSignCount,
        userVerified,
      });
      const signedPayload = Buffer.concat([
        authenticatorData,
        sha256(clientDataJSON),
      ]);
      const signature = sign("sha256", signedPayload, deserializePrivateKeyPem(selectedCredential));

      selectedCredential.signCount = nextSignCount;
      selectedCredential.updatedAt = Date.now();
      selectedCredential.lastUsedAt = selectedCredential.updatedAt;
      saveStore();

      return createSuccessResult({
        id: selectedCredential.id,
        rawId: selectedCredential.id,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          authenticatorData: toBase64Url(authenticatorData),
          signature: toBase64Url(signature),
          userHandle: selectedCredential.userId || null,
        },
      });
    } catch (error) {
      if (error instanceof PasskeyManagerError) {
        return createErrorResult(error.name, error.message);
      }

      console.error("[Passkeys] Failed to resolve passkey assertion.", error);
      return createErrorResult("UnknownError", "Failed to sign in with a passkey for this site.");
    }
  }

  return {
    createCredential,
    getAssertion,
  };
}
