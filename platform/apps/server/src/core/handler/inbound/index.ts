// Public surface of the inbound handler (split out of the former 404-LOC inbound.ts; see
// docs/refactor/server-decomposition-plan.md, P2 — the one components/ case). The ordered spine
// (handleInbound) + processInbound live in inbound.ts; the phase helpers live in components/ behind a
// CONTINUE-sentinel handled/fall-through protocol (components/phase.ts). This barrel re-exports the
// EXACT prior public surface so importers only repoint the path.
export { handleInbound, processInbound } from "./inbound.ts";
