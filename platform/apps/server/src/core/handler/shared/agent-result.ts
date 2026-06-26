import type { SavedEvent } from "../../../db/event-store/index.ts";
import type { InboundMessage } from "../../../http/webhook.ts";
import type { ClarifyResult } from "../../../tools/index.ts";
import type { AgentResult } from "../../agent.ts";
import { familyOf, type HandlerDeps } from "./deps.ts";

/** JSON.parse that returns null instead of throwing on a corrupt blob (paired with clarifyPayloadSchema). */
export function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** #84/#147: narrow the agent's arms. `clarify` → the request to ask; `resolved` → cancel/edit candidates
 *  (#147, only the resolve agent returns it); otherwise saved rows (or null). */
export function clarifyOf(r: AgentResult): ClarifyResult | null {
  return r && "clarify" in r ? r.clarify : null;
}
export function savedOf(r: AgentResult): SavedEvent[] | null {
  if (!r || "clarify" in r || "resolved" in r) return null;
  return r;
}
/** #147: narrow the resolve agent's `{resolved}` arm → the matched candidate rows, or null if it's any
 *  other arm. An empty array (found nothing) is a valid `resolved` value the caller treats as not-found. */
export function resolvedOf(r: AgentResult): SavedEvent[] | null {
  return r && "resolved" in r ? r.resolved : null;
}

/**
 * #147 — the agentic resolve fallback shared by the cancel + edit routes. On a deterministic 0-match for a
 * SPECIFIC reference, run the bounded resolve agent (forced to `search_events` on turn 0 — it has no
 * `extract_events`, so it can never create an event, AC#3) with the SERVER-resolved date/time pinned via
 * `ctx.resolveRef` (the model supplies only the text terms; it never sees today's date, G8). Returns the
 * matched board rows (possibly empty), or `null` when no resolve agent is wired — the caller then behaves
 * exactly as before (not-found). A TransientError propagates so the inbound stays pending for boot-replay.
 */
export async function resolveCandidates(
  deps: HandlerDeps,
  msg: InboundMessage,
  text: string,
  ref: { dateIso?: string; time?: string },
  today: string,
): Promise<SavedEvent[] | null> {
  if (!deps.resolveAgent) return null;
  const result = await deps.resolveAgent.run(
    text,
    {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: familyOf(deps),
      events: deps.events,
      resolveRef: {
        ...(ref.dateIso ? { dateIso: ref.dateIso } : {}),
        ...(ref.time ? { time: ref.time } : {}),
      },
    },
    { forceTool: "search_events" },
  );
  return resolvedOf(result) ?? [];
}
