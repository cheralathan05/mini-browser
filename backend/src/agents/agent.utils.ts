// NEXUS AGENT - STRING & DATA SANITIZATION UTILITIES
// Prevents encoding collisions on Windows databases (WIN1252 vs UTF-8)

export function sanitizeStringForDb(str: string): string {
  if (!str) return str;

  // 1. Canonical substitutions for Unicode symbols & quotes
  let s = str
    .replace(/[\uE000-\uF8FF]/g, "") // Private Use Area
    .replace(/[→⇒]/g, "->")
    .replace(/[←⇐]/g, "<-")
    .replace(/[↑▲]/g, "^")
    .replace(/[↓▼]/g, "v")
    .replace(/[✓✔]/g, "[v]")
    .replace(/[✕✖✗]/g, "[x]")
    .replace(/[●•◆■]/g, "*")
    .replace(/[○◇□]/g, "o")
    .replace(/[❮‹⟨]/g, "<")
    .replace(/[❯›⟩]/g, ">")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’`‛]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...");

  // 2. Strip any character not representable in Windows-1252
  // Windows-1252 consists of 0x00-0x7F, 0xA0-0xFF, and specific characters in 0x80-0x9F
  return s.replace(
    /[^\x00-\x7F\xA0-\xFF\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192]/g,
    ""
  );
}

export function sanitizeForDb<T>(val: T): T {
  if (val === null || val === undefined) return val;

  if (typeof val === "string") {
    return sanitizeStringForDb(val) as unknown as T;
  }

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeForDb(item)) as unknown as T;
  }

  if (typeof val === "object") {
    const res: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      res[key] = sanitizeForDb(value);
    }
    return res as unknown as T;
  }

  return val;
}
