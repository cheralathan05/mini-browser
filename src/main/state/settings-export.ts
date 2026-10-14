const REDACTED_VALUE = "[REDACTED]";

export function isSensitiveExportKey(key: string) {
  const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalizedKey.endsWith("apikey")
    || normalizedKey.endsWith("password")
    || normalizedKey.endsWith("secret")
    || normalizedKey.endsWith("token")
    || normalizedKey === "authorization"
    || normalizedKey === "cookie"
    || normalizedKey === "cookies"
    || normalizedKey === "credential"
    || normalizedKey === "credentials"
    || normalizedKey === "extraheaders"
    || normalizedKey === "extraheaderstext"
    || normalizedKey === "defaultheaderstext"
    || normalizedKey === "downloadheaderstext";
}

function isEmptyValue(value: unknown) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0;
}

export function redactSensitiveSettings(value: unknown, key = ""): unknown {
  if (key && isSensitiveExportKey(key)) {
    return isEmptyValue(value) ? value : REDACTED_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveSettings(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(
      ([entryKey, entryValue]) => [entryKey, redactSensitiveSettings(entryValue, entryKey)],
    ));
  }
  return value;
}
