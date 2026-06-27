// Public surface of the agent core (split out of the former 303-LOC agent.ts; see
// docs/refactor/server-decomposition-plan.md, P2 — a "light" split). The contract types,
// the two system prompts, and the isolated SDK seam are extracted; the bounded tool-use loop
// (createAgent + its G3/G4/G7/G9/G13/G17 invariants) stays whole in loop.ts. This barrel
// re-exports the EXACT prior public surface (13 symbols) so importers only repoint the path.
export { anthropicCallModel } from "./call-model.ts";
export { createAgent } from "./loop.ts";
export { AGENT_SYSTEM, RESOLVE_SYSTEM } from "./prompts.ts";
export type {
  Agent,
  AgentConfig,
  AgentResult,
  CallModel,
  ModelRequest,
  ModelResponse,
  ResponseBlock,
  ToolChoice,
  ToolSpec,
} from "./types.ts";
