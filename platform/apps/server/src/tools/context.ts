import type { ClarifyReason, ParsedEvent } from "@homeos/shared";
import type { ZodType } from "zod/v4";
import type { EventStore, SavedEvent } from "../db/event-store/index.ts";
import type { CalendarClient } from "../google/calendar.ts";
import type { GmailClient } from "../google/gmail.ts";
import type { GetTokenDeps } from "../google/oauth.ts";

/**
 * The Gmail seam a connected-provider tool reads (#72), handed in via `ToolContext.google` ONLY on the
 * sync path — so `read_gmail` is inert on a normal forward (G8: capability gated by server context, not
 * the model). Extends `GetTokenDeps` so `getValidAccessToken(familyId, ctx.google)` works directly;
 * adds the read client + the cost/scope clamps (server-owned, never model-chosen).
 */
export interface GmailToolDeps extends GetTokenDeps {
  client: GmailClient;
  /** Hard cap on emails fetched+parsed per sync run (cost ceiling, §6). */
  maxMessages: number;
  /** Server-side recency clamp baked into every query, e.g. "newer_than:7d". */
  queryWindow: string;
  /** Allowlist the model's optional `label` hint is clamped into (empty = no label filtering). */
  allowedLabels?: readonly string[];
}

/**
 * The Calendar seam a connected-provider tool reads (#18), handed in via `ToolContext.calendar` ONLY on
 * the `סנכרן יומן` sync path — so `read_calendar` is inert on a normal forward (G8). Extends
 * `GetTokenDeps` so `getValidAccessToken(familyId, ctx.calendar)` works directly; adds the read client +
 * the server-owned read clamps (which calendar, how far ahead, how many — never model-chosen).
 */
export interface CalendarToolDeps extends GetTokenDeps {
  client: CalendarClient;
  /** Which calendar to read (server-owned; config default "primary"). */
  calendarId: string;
  /** How many days ahead to read (`timeMax = now + windowDays`). */
  windowDays: number;
  /** Hard cap on events fetched per sync run (cost ceiling, §6). */
  maxEvents: number;
}

/**
 * Server-supplied context handed to a tool's `run` — NEVER taken from the model's tool input.
 * This closes the date-spoof / sender-impersonation surface (G8): forwarded text cannot move the
 * Asia/Jerusalem anchor or impersonate a family member. `from` is also the #14 first-person→assignee
 * source (added when direct commands land).
 *
 * A tool persists its OWN rows through `events` (#71 contract change): the tool owns its idempotency
 * key + provenance, which the flattened agent loop can't carry. `familyId` keys the credential a
 * connected-provider tool reads (today the single-family `FAMILY_ID`). The `google?` Gmail seam is
 * added by #72 alongside `read_gmail`.
 */
export interface ToolContext {
  /** Today in Asia/Jerusalem (YYYY-MM-DD), for relative-date resolution. */
  todayIso: string;
  /** Sender phone — server-supplied, never model-supplied. */
  from: string;
  waMessageId: string;
  /** The sender's family-member name (from the MEMBERS map), if known — first-person → assignee (#14). */
  senderName?: string;
  /** The family whose data/credentials a tool acts on (today: the single-family `FAMILY_ID`). */
  familyId: string;
  /** Persistence seam — tools save their own events here (#71); the handler no longer persists. */
  events: EventStore;
  /** Gmail seam for `read_gmail` (#72) — set by the handler ONLY on the sync path; absent → tool no-ops. */
  google?: GmailToolDeps;
  /** Calendar seam for `read_calendar` (#18) — set by the handler ONLY on the `סנכרן יומן` path; absent → no-op. */
  calendar?: CalendarToolDeps;
  /**
   * Slot-dedup sink — when the handler provides it, the extract tool does NOT re-add a TIMED event whose
   * (date, time) slot is already on the board; the existing row is pushed here instead so the handler can
   * reply "already on the board". A mutable side-channel (like the clarify arm) keeps the agent contract
   * unchanged. Absent ⇒ dedup is OFF (older callers/tests save every parsed event, exactly as before).
   */
  duplicates?: SavedEvent[];
  /**
   * #147 — server-resolved date/time for the agentic cancel/edit resolve fallback. The MODEL supplies the
   * reference's text terms (`search_events`'s `titleHint`); the HANDLER supplies the deterministically
   * resolved date/time here (from `extractCancelRef`), so the model never needs today's date and can't
   * spoof the anchor (G8). Read ONLY by `search_events`; absent on every other path.
   */
  resolveRef?: { dateIso?: string; time?: string };
}

/**
 * #84 — the clarify draft a tool surfaces INSTEAD of saving when a required slot is an unconfirmed
 * guess. It crosses tool → agent → handler via this typed arm and is NEVER serialized into a
 * `tool_result` or any `messages[]` entry (G17): the agent captures it in a side-channel and the
 * tool_result stays a content-free ack. The handler asks ONE templated question and resumes (#84/§4.A).
 */
export interface ClarifyResult {
  draft: ParsedEvent;
  reason: ClarifyReason;
}

/**
 * A tool either persisted rows (`saved`), is requesting a clarification (`clarify`, #84), or RESOLVED a
 * cancel/edit reference to candidate board rows (`resolved`, #147 — read-only, the handler decides 0/1/N
 * and executes the write). Exactly one arm.
 */
export type ToolResult =
  | { saved: SavedEvent[] }
  | { clarify: ClarifyResult }
  | { resolved: SavedEvent[] };

/**
 * The declarative registry seam: a tool is `{ name, description, inputSchema, run }`. Appending a
 * Tool to the array passed to `createAgent` registers it — there is no separate registry layer.
 * `inputSchema` is re-validated against the model's (untrusted) tool input before `run` (G6).
 *
 * `run` returns the rows it PERSISTED (`saved`), not raw events: the tool stamps its own idempotency
 * key + `source_provider`, so per-tool provenance survives the agent loop's flattening (#71/§1).
 */
export interface Tool<I = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}
