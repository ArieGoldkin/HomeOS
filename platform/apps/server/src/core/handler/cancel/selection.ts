/**
 * #161 — parse a numbered-disambiguation selection (shared by the cancel AND edit resume paths). Accepts
 * one or MORE 1-based indices in a single reply ("1", "1,2", "1 ו-2", "1 2") or an "all" word (הכל/כולם →
 * every candidate). The whole reply must be selection-shaped (digits + the separators a person uses for a
 * list, or an all-word) so an arbitrary sentence with an incidental number is NOT treated as a pick (G20).
 * Returns the chosen indices, deduped and clamped to [1..count] in reply order; an empty array means "no
 * valid selection" (the caller deletes/edits nothing).
 */
export function parseSelection(reply: string, count: number): number[] {
  const r = reply.trim();
  if (/^(?:הכל|כולם)$/u.test(r)) return Array.from({ length: count }, (_, i) => i + 1);
  // Selection-shaped only: digits + list separators (comma, vav, hyphen/maqaf ־, plus, whitespace).
  if (!/^[\d\s,+ו־-]+$/u.test(r)) return [];
  const seen = new Set<number>();
  const picks: number[] = [];
  for (const match of r.matchAll(/\d+/gu)) {
    const n = Number(match[0]);
    if (n >= 1 && n <= count && !seen.has(n)) {
      seen.add(n);
      picks.push(n);
    }
  }
  return picks;
}
