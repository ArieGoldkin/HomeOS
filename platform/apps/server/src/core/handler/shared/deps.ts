import type { BindingStore } from "../../../db/binding-store.ts";
import type { ConversationStore } from "../../../db/conversation-store.ts";
import type { EventStore } from "../../../db/event-store/index.ts";
import type { FamilyResolver } from "../../../db/family-resolver.ts";
import type { InboundStore } from "../../../db/inbound-store.ts";
import { FAMILY_ID } from "../../../db/schema.ts";
import type { ParseMessage } from "../../../parsing/parser.ts";
import type { CalendarToolDeps, GmailToolDeps } from "../../../tools/index.ts";
import type { SendText } from "../../../whatsapp/client.ts";
import type { Agent } from "../../agent/index.ts";

export interface HandlerDeps {
  allowlist: readonly string[];
  agent: Agent;
  /**
   * #147 — the bounded RESOLVE agent for the agentic cancel/edit fallback. Registered with ONLY
   * `search_events` (NOT `extract_events`), so a cancel routed here can never create an event (AC#3).
   * Optional: unwired ⇒ a deterministic 0-match just replies not-found, exactly as before (fully additive).
   */
  resolveAgent?: Agent;
  events: EventStore;
  sendText: SendText;
  /** Optional phone→family-member-name map; resolves the sender for first-person → assignee (#14). */
  members?: Record<string, string>;
  /**
   * G16 — per-sender daily message ceiling (Asia/Jerusalem day). Unset → no limit. Enforced only
   * when both this and `inbound` (the counter) are wired, so unit tests stay off by default.
   */
  maxPerSenderPerDay?: number;
  /** Inbound queue — also the per-sender daily counter for G16. Required by `ProcessDeps`; optional here. */
  inbound?: InboundStore;
  /** Gmail tool deps (#72) — present only when the GOOGLE_* bundle is configured. Drives the `סנכרן מייל` sync. */
  google?: GmailToolDeps;
  /** Calendar tool deps (#18) — present only when the GOOGLE_* bundle is configured. Drives the `סנכרן יומן` sync. */
  calendar?: CalendarToolDeps;
  /** #18 chunk 2: auto-push forwarded board events to Google Calendar. Off (or no `calendar`) ⇒ read-only. */
  autoPushCalendar?: boolean;
  /**
   * #83 (Milestone #8) — bounded-conversation store. When wired, an open thread routes the sender's
   * next message to the deterministic RESUME branch (clarify/cancel/edit) instead of `agent.run`.
   * Optional so the branch is fully additive: unset ⇒ the handler behaves exactly as before.
   */
  conversations?: ConversationStore;
  /**
   * #228 — phone-binding ceremony store. When wired, a message carrying a valid `HOME-XXXXX` code is
   * processed BEFORE the admission gate (the one deliberate exception — binding CREATES the `family_phones`
   * entry the #259 resolver gate reads) and writes the durable `from_phone → family_id` mapping.
   * Optional/additive: unset ⇒ no binding branch, the handler behaves exactly as before.
   */
  bindings?: BindingStore;
  /**
   * #229/#259 — the phone→family resolver (the security chokepoint) AND, when wired, the admission gate
   * itself: `handleInbound` resolves the sender's `from_phone → family_id` ONCE and threads the resolved
   * value down — a phone that does NOT resolve to a family is refused without writing. Optional/additive:
   * unwired ⇒ the gate falls back to the static `ALLOWLIST` and every handler degrades to the
   * {@link FAMILY_ID} fallback via {@link familyOf}, i.e. the exact prior behavior.
   */
  familyResolver?: FamilyResolver;
  /**
   * #229 — the PER-REQUEST resolved family, set by `handleInbound` on a `{...deps, familyId}` clone after
   * resolving (never injected at the composition root). Downstream handlers read it via {@link familyOf};
   * unset (direct-handler tests / app-only dev) ⇒ the {@link FAMILY_ID} fallback. This is a resolved value,
   * NOT the constant — that distinction is the whole point of the chokepoint.
   */
  familyId?: string;
  /**
   * #87/G24 — open-thread TTL in ms, injected so it's a single configured constant (not a magic number
   * scattered across the clarify/cancel/edit writers) and so a test can force expiry with `0`. Unset ⇒
   * `CONVERSATION_TTL_MS` (30 min). The store stays clock-agnostic (it takes a pre-computed `expiresAt`);
   * this is the one place the duration lives, read at thread-CREATE time by every writer.
   */
  conversationTtlMs?: number;
  /**
   * #84 — the non-persisting parse seam, used by a clarify RESUME to re-resolve a free-form Hebrew date
   * answer ("ביום ראשון בשמונה") into the held draft WITHOUT saving (a single structured call, never an
   * auto agent turn — G17). Optional: a `missing_date` resume degrades to REPHRASE when it's unwired.
   */
  parse?: ParseMessage;
  /** Injectable clock (default: now) so date anchoring is testable. */
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ProcessDeps extends HandlerDeps {
  inbound: InboundStore;
}

/**
 * #229 — the SINGLE seam every bot-write site reads its family from, so no handler hard-codes the
 * constant. In production `handleInbound` has already resolved `deps.familyId` (via the FamilyResolver gate,
 * #259) and threaded it on a per-request deps clone, so this returns the resolved value. The `?? FAMILY_ID`
 * is the ONE documented fallback for the no-resolver paths (direct-handler unit tests / app-only dev) — it
 * is NOT a production code path, which is why the chokepoint's correctness lives in the resolver + the
 * resolve-once-then-refuse-if-unresolved logic, not here.
 */
export function familyOf(deps: Pick<HandlerDeps, "familyId">): string {
  return deps.familyId ?? FAMILY_ID;
}
