import { z } from "zod/v4";
import type { EventStore, SavedEvent } from "../db/event-store.ts";
import type { ParseMessage } from "../parsing/parser.ts";

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
}

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
  inputSchema: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<{ saved: SavedEvent[] }>;
}

/**
 * Defense-in-depth cap on the model-echoed text (the authoritative cap is the handler's pre-model
 * input cap, G2). Generous vs the handler's MAX_INPUT so a legitimate forward isn't double-rejected.
 */
const MAX_TOOL_TEXT = 8000;

/**
 * The only tool for #13: re-runs the existing extractor (`parser.ts`) so the proven retry/validation/
 * TransientError seam — and its test net — is preserved verbatim. `parse` throwing a TransientError
 * propagates out (→ the agent loop → handler → row stays pending).
 *
 * #71: persists each parsed event itself under the inbound's own key — `waMessageId`/`seq` exactly as
 * the handler did before, `source_provider` left null (a forward, not a provider-derived row) — so
 * behaviour is identical; the one `saveEvent` line just moved down a layer.
 */
export function extractEventsTool(parse: ParseMessage): Tool<{ text: string }> {
  return {
    name: "extract_events",
    description:
      "Extract calendar items (events, tasks, reminders) from the forwarded family message text.",
    inputSchema: z.object({ text: z.string().min(1).max(MAX_TOOL_TEXT) }),
    async run({ text }, ctx) {
      const events = await parse(text, ctx.todayIso, ctx.senderName);
      // One message → several events, each under its own seq (idempotent on (wa_message_id, seq)).
      const saved = (events ?? []).map((event, seq) =>
        ctx.events.saveEvent(event, { fromPhone: ctx.from, waMessageId: ctx.waMessageId, seq }),
      );
      return { saved }; // empty list = "nothing to schedule"
    },
  };
}
