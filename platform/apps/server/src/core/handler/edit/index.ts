// Public surface of the edit handler (split out of the former 267-LOC edit.ts; see
// docs/refactor/server-decomposition-plan.md, P2). Sibling modules import each other directly
// (never through this barrel) so it stays a pure contract and can't form an import cycle. Only
// these symbols are meant to leave the folder — byte-identical to the prior edit.ts surface:
//   - extractEditDelta — the server-side reference + field-delta extraction (#86)
//   - applyPatchToId / applyEdit — the single-row patch seams (board-only via updateEvent, G20/G19)
//   - resumeEdit — the disambiguation/confirm resume entry (wired by resume.ts)
//   - routeEditByRef — the deterministic explicit-edit route (wired by inbound.ts)
// Internal-only (NOT re-exported): applyPatchToMany, openEditConfirm, openEditDisambiguation.
// parseSelection/extractCancelRef come from ../cancel/index.ts (cross-folder, via that barrel).
export { applyEdit, applyPatchToId } from "./apply.ts";
export { extractEditDelta } from "./extract.ts";
export { resumeEdit } from "./resume.ts";
export { routeEditByRef } from "./route.ts";
