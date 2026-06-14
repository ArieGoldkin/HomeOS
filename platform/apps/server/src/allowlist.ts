/** Reduce a phone number to comparable digits (drop +, spaces, dashes, etc.). */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
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
