// Public surface of the inbound message handler (Milestone #8). Internal modules import each
// other directly (never through this barrel) so this file stays a pure contract and can't form
// an import cycle. Only these symbols are meant to leave the folder:
//   - processInbound  — the composition-root entry (index.ts wires it onto the inbound queue)
//   - handleInbound   — the message pipeline (tested directly)
//   - extractCancelRef — exported so the server-side cancel-reference extraction is unit-tested
//   - extractBulkCancel — exported so the #163 bulk-cancel detection + scope extraction is unit-tested
//   - parseSelection — exported so the #161 multi-select disambiguation parser (shared by cancel + edit)
//     is unit-tested
//   - HandlerDeps / ProcessDeps — the dependency contracts callers construct
export { extractBulkCancel, extractCancelRef, parseSelection } from "./cancel.ts";
export { handleInbound, processInbound } from "./inbound.ts";
export type { HandlerDeps, ProcessDeps } from "./shared/index.ts";
