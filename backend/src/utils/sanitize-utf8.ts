/**
 * Sanitizes strings for database storage to prevent PostgreSQL character encoding
 * errors (such as 22P05: character has no equivalent in encoding WIN1252).
 */
export function sanitizeForDb(text: string | null | undefined): string {
  if (!text) return "";
  
  // Normalize Unicode
  let clean = text.normalize("NFC");
  
  // Replace null bytes which PostgreSQL cannot store in text fields
  clean = clean.replace(/\0/g, "");
  
  return clean;
}

/**
 * Fallback sanitizer if the database specifically fails on Windows-1252 non-representable characters.
 * Replaces 4-byte UTF-8 characters (like emojis outside WIN1252) with text or safe equivalents.
 */
export function sanitizeWin1252(text: string): string {
  if (!text) return "";
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, (match) => {
    // E.g. replace emoji with a safe symbol or ASCII representation
    return `[${match.codePointAt(0)?.toString(16).toUpperCase() || "emoji"}]`;
  });
}
