import type { InboundOutcome } from "@homeos/shared";

/**
 * The handled-vs-fall-through protocol for the inbound spine's phase helpers (the components/ split of
 * the former 404-LOC inbound.ts; see docs/refactor/server-decomposition-plan.md, P2). A phase either
 * HANDLED the message — the spine returns its {@link InboundOutcome}, OR `undefined`, which is itself a
 * real "replied, no disposition recorded" outcome (the not-connected sync paths `return;` like that) —
 * or it signals {@link CONTINUE} to fall through to the next phase. Because `undefined` is a valid
 * handled outcome, it can't double as "fall through"; CONTINUE is a distinct sentinel. The spine's
 * uniform check is therefore `if (r !== CONTINUE) return r;`.
 */
export const CONTINUE = Symbol("inbound.continue");

/** A phase result: a handled {@link InboundOutcome} (incl. `undefined`), or {@link CONTINUE}. */
export type PhaseResult = InboundOutcome | undefined | typeof CONTINUE;
