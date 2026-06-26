// ⚠️ FROZEN matcher internals (#125/G22): `findEventsByRef` (the deterministic DESTRUCTIVE cancel/edit
// path) builds its title clause from these helpers, so broadening anything here widens that fast path.
// `searchEvents` (the agentic, confirm-gated fallback) shares the SAME tokenizer but ORs across three
// columns in its own per-call SQL — that column-broadening lives in the query, never here. Change with care.

/** Stopwords a cancel/edit title hint carries but a stored title rarely does — dropped so they don't
 *  over-broaden (or, when alone, accidentally null out) the match. */
const HINT_STOPWORDS = new Set(["עם", "את", "של", "או", "גם", "יום"]);
/** Escape LIKE metacharacters so a hint like "50%" matches literally, not as a wildcard (#125/F3). */
export const likeArg = (s: string): string => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * #85 — turn a free-text title hint into per-WORD LIKE variants, AND-ed by the caller. Each word also
 * yields a ה/ו-stripped variant (OR-ed with the original) so a hint carrying the Hebrew definite article
 * — "הפגישה" — matches a bare stored title "פגישה" (a live cancel miss), WITHOUT dropping a word that
 * legitimately starts with ה (e.g. "הורים" still matches via its original form). Stopwords + sub-2-char
 * tokens are removed. Returns `[]` when nothing usable remains so the caller can fall back to the raw hint
 * (never broadening a hint-bearing lookup into "match everything").
 */
export function hintLikeGroups(hint: string): string[][] {
  const groups: string[][] = [];
  for (const word of hint.split(/\s+/u)) {
    if (word.length < 2 || HINT_STOPWORDS.has(word)) continue;
    const variants = new Set([word]);
    const stripped = word.replace(/^[הו]/u, "");
    if (stripped.length >= 2) variants.add(stripped);
    groups.push([...variants].map(likeArg));
  }
  return groups;
}
