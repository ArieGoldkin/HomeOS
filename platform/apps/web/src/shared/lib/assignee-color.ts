export interface AssigneeColor {
  light: string;
  night: string;
  /** Precomputed chip-wash hexes — the fallback where CSS `color-mix(oklab)` is unavailable (< Chrome 111). */
  lightWash: string;
  nightWash: string;
}

// The prototype's 5 assignee pairs (web-architecture-plan §5) + precomputed pale washes.
// assignee is a free-form bounded string (@homeos/shared), so this is a RUNTIME concern, never a token.
const PALETTE: readonly AssigneeColor[] = [
  { light: "#2F7DA6", night: "#7FB8D6", lightWash: "#E4EEF4", nightWash: "#1E2C36" }, // blue
  { light: "#C26A72", night: "#E29AA0", lightWash: "#F4E6E7", nightWash: "#362426" }, // rose
  { light: "#2E8C7A", night: "#6FC2B0", lightWash: "#E2F0EC", nightWash: "#1C302B" }, // teal
  { light: "#6E78C4", night: "#A6AEE6", lightWash: "#E8E9F5", nightWash: "#25283A" }, // indigo
  { light: "#6B7D86", night: "#8FA3AD", lightWash: "#E9EDEF", nightWash: "#232C31" }, // slate (neutral / unassigned)
];

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
  כולם: 4,
  all: 4,
};

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** Map a free-form assignee to a STABLE color (deterministic). null/empty → the neutral slate slot. */
export function assigneeColor(assignee: string | null | undefined): AssigneeColor {
  const name = assignee?.trim();
  if (!name) return PALETTE[4] as AssigneeColor;
  const idx = SEED[name] ?? hash(name) % PALETTE.length;
  return PALETTE[idx] as AssigneeColor;
}
