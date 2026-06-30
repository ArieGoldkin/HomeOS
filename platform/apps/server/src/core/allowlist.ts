/** Reduce a phone number to comparable digits (drop +, spaces, dashes, etc.). */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Reduce a login email to its comparable form (trim + lower-case) — the membership/invite match key. The
 * ONE source of truth for the identity gate: the resolver matches `LOWER(email)` against this, and the
 * stores write this, so a stored email can never carry whitespace/case the matcher would silently miss
 * (uid↔member binding + #250 security item: trim the *stored* column, not just the input).
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Allowlist gate (🔒 M1 guardrail): only pre-approved family numbers are processed.
 * Both sides are normalized to digits, so a stored "+972 50-123 4567" matches the
 * "972501234567" form WhatsApp delivers. Empty/garbage input is never allowed.
 */
export function isAllowed(phone: string, allowlist: readonly string[]): boolean {
  const normalized = normalizePhone(phone);
  if (normalized === "") return false;
  return allowlist.some((entry) => normalizePhone(entry) === normalized);
}
