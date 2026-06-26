import type { ClarifyReason } from "@homeos/shared";
import { z } from "zod/v4";
import type { SavedEvent } from "../db/event-store/index.ts";
import type { ParseMessage } from "../parsing/parser.ts";
import type { Tool } from "./context.ts";
import { MAX_TOOL_TEXT } from "./limits.ts";

/**
 * The only tool for #13: re-runs the existing extractor (`parser.ts`) so the proven retry/validation/
 * TransientError seam — and its test net — is preserved verbatim. `parse` throwing a TransientError
 * propagates out (→ the agent loop → handler → row stays pending).
 *
 * #71: persists each parsed event itself under the inbound's own key — `waMessageId`/`seq` exactly as
 * the handler did before, `source_provider` left null (a forward, not a provider-derived row) — so
 * behaviour is identical; the one `saveEvent` line just moved down a layer.
 */
/**
 * #84 confidence gate — DETERMINISTIC + conservative: only a REQUIRED-slot gap opens a clarify thread.
 * `missing_time` is intentionally excluded (time is optional → never ask), so a clear-but-timeless parse
 * still auto-adds and keeps the instant magic. The model EMITS the enum flag; this code decides to act.
 */
const CLARIFY_REQUIRED_REASONS: ReadonlySet<ClarifyReason> = new Set([
  "missing_date",
  "ambiguous_title",
]);

export function extractEventsTool(parse: ParseMessage): Tool<{ text: string }> {
  return {
    name: "extract_events",
    description:
      "Extract calendar items (events, tasks, reminders) from the forwarded family message text.",
    inputSchema: z.object({ text: z.string().min(1).max(MAX_TOOL_TEXT) }),
    async run({ text }, ctx) {
      const events = await parse(text, ctx.todayIso, ctx.senderName);
      // #84: if the model flagged an event's required slot as a guess, ask ONE question instead of
      // saving. Gate on the conservative reason set (code-decided) and surface the FIRST flagged draft —
      // it goes ONLY to the handler via the clarify arm, never into the model loop. Save NOTHING.
      const flagged = (events ?? []).find(
        (e) => e.needs_clarification && CLARIFY_REQUIRED_REASONS.has(e.needs_clarification.reason),
      );
      if (flagged?.needs_clarification) {
        return { clarify: { draft: flagged, reason: flagged.needs_clarification.reason } };
      }
      // One message → several events, each under its own seq (idempotent on (wa_message_id, seq)). When
      // the handler wires `ctx.duplicates`, a TIMED event is deduped on its (date, time) slot:
      //  • cross-message — a board row from a DIFFERENT message already holds the slot → push the existing
      //    row to the sink ("already on the board") and don't re-add it.
      //  • intra-message (F1) — an earlier event in THIS SAME forward already took the slot → collapse to
      //    one row silently (the user sent it once; no "already" notice).
      // A null-time item has no slot → always saved. Absent sink ⇒ dedup off (additive, pre-PR behavior).
      const saved: SavedEvent[] = [];
      const seenSlots = new Set<string>();
      let seq = 0;
      for (const event of events ?? []) {
        if (ctx.duplicates && event.time != null) {
          const dup = ctx.events.findSlotConflict(ctx.familyId, {
            dateIso: event.date_iso,
            time: event.time,
            excludeWaMessageId: ctx.waMessageId,
          });
          if (dup) {
            ctx.duplicates.push(dup);
            continue;
          }
          const slotKey = `${event.date_iso}|${event.time}`;
          if (seenSlots.has(slotKey)) continue; // F1: same slot twice in one forward → one row
          seenSlots.add(slotKey);
        }
        saved.push(
          ctx.events.saveEvent(event, { fromPhone: ctx.from, waMessageId: ctx.waMessageId, seq }),
        );
        seq += 1;
      }
      return { saved }; // empty list = "nothing to schedule" (or every event was a duplicate)
    },
  };
}
