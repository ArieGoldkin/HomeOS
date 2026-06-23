export interface AssigneeColor {
  light: string;
  night: string;
  /** Precomputed chip-wash hexes — the fallback where CSS `color-mix(oklab)` is unavailable (< Chrome 111). */
  lightWash: string;
  nightWash: string;
}

// The prototype's 5 assignee pairs (web-architecture-plan §5) + precomputed pale washes.
// assignee is a free-form bounded string (@homeos/shared), so this is a RUNTIME concern, never a token.
// The 5 design-system living accents (#173, retuned from the old blue/rose/teal/indigo/slate to
// match HomeOS-Design-System.dc.html + the Modern prototype's member colors), with derived dark
// variants + precomputed pale washes (the fallback where CSS `color-mix(oklab)` is unavailable).
const PALETTE: readonly AssigneeColor[] = [
  { light: "#1E9E6F", night: "#3FBF94", lightWash: "#E3F2EC", nightWash: "#15271F" }, // green
  { light: "#3686D8", night: "#6FA8E4", lightWash: "#E4EEF8", nightWash: "#16222F" }, // blue
  { light: "#B57BD6", night: "#C9A0E2", lightWash: "#F2E9F7", nightWash: "#241B2C" }, // violet
  { light: "#D9543F", night: "#E68471", lightWash: "#F8E6E2", nightWash: "#2C1A16" }, // coral
  { light: "#C99A2E", night: "#E0B65A", lightWash: "#F5ECD8", nightWash: "#292112" }, // amber
];

// Neutral (warm gray) for the unassigned / "everyone" case — not one of the per-person accents.
const NEUTRAL: AssigneeColor = {
  light: "#8A8579",
  night: "#A39E92",
  lightWash: "#ECEAE3",
  nightWash: "#26241F",
};

// Known family terms → a fixed palette slot, so the same person is always the same color.
const SEED: Record<string, number> = {
  אבא: 0,
  aba: 0,
  אמא: 1,
  ima: 1,
  יואב: 2,
  yoav: 2,
  נועה: 3,
  noa: 3,
};

// "Everyone" is not a single person → render it neutral, not a per-person accent.
const NEUTRAL_TERMS = new Set(["כולם", "all"]);

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** Map a free-form assignee to a STABLE color (deterministic). null/empty/"everyone" → neutral. */
export function assigneeColor(assignee: string | null | undefined): AssigneeColor {
  const name = assignee?.trim();
  if (!name || NEUTRAL_TERMS.has(name)) return NEUTRAL;
  const idx = SEED[name] ?? hash(name) % PALETTE.length;
  return PALETTE[idx] as AssigneeColor;
}
