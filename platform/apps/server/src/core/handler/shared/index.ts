// Public surface of the handler's shared utilities (split out of the former 434-LOC shared.ts; see
// docs/refactor/server-decomposition-plan.md, P0). Sibling handler files import from this barrel; the
// modules below import each other DIRECTLY (never through this barrel) so it stays a pure re-export and
// can't form a cycle. Grouped by concern:
//   - deps.ts        — HandlerDeps / ProcessDeps contracts + the #229 familyOf reader
//   - messages.ts    — server-owned Hebrew reply strings + sync triggers/intents + CLARIFY_QUESTIONS + MAX_INPUT
//   - patterns.ts    — command/extraction regexes + stripLeadingFiller + the #228 BINDING_CODE_RE
//   - confirm.ts     — the fail-closed destroy gate (AFFIRM_RE / NEGATION_RE / isAffirmative)
//   - dates.ts       — Asia/Jerusalem date math + weekday matching + the open-thread TTL
//   - format.ts      — Hebrew confirm/already/cancel presentation
//   - agent-result.ts — AgentResult narrowers + the #147 resolveCandidates fallback + safeJsonParse
export * from "./agent-result.ts";
export * from "./confirm.ts";
export * from "./dates.ts";
export * from "./deps.ts";
export * from "./format.ts";
export * from "./messages.ts";
export * from "./patterns.ts";
