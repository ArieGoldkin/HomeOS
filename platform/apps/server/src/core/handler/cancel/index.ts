// Public surface of the cancel handler (split out of the former 383-LOC cancel.ts; see
// docs/refactor/server-decomposition-plan.md, P1). Sibling modules import each other directly
// (never through this barrel) so it stays a pure contract and can't form an import cycle. Only
// these symbols are meant to leave the folder — byte-identical to the prior cancel.ts surface:
//   - extractCancelRef / extractBulkCancel — the server-side reference + bulk-scope extraction (unit-tested)
//   - parseSelection — the #161 multi-select disambiguation parser (shared by cancel + edit; keep identical)
//   - cancelOne — the single-row delete seam
//   - resumeCancel — the disambiguation/confirm resume entry (wired by resume.ts)
//   - routeCancelByRef — the deterministic cancel-by-reference route (wired by inbound.ts)
// Internal-only (NOT re-exported): cancelMany, routeBulkCancel, the open* thread openers, stripDateTime.
export { cancelOne } from "./delete.ts";
export { extractBulkCancel, extractCancelRef } from "./extract.ts";
export { resumeCancel } from "./resume.ts";
export { routeCancelByRef } from "./route.ts";
export { parseSelection } from "./selection.ts";
