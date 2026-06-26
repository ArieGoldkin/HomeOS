import { z } from "zod/v4";
import type { SavedEvent } from "../db/event-store/index.ts";
import { getValidAccessToken } from "../google/oauth.ts";
import type { ParseMessage } from "../parsing/parser.ts";
import type { Tool } from "./context.ts";
import { MAX_TOOL_TEXT } from "./limits.ts";

/**
 * Compose the Gmail search `q` SERVER-side (G8): the recency window is always applied; the model's
 * optional `label` hint is honoured only if it's in the configured allowlist; `fromSender` is
 * sanitised to a safe address charset + bounded. The model can never issue an arbitrary search.
 */
export function buildGmailQuery(
  input: { label?: string; fromSender?: string },
  deps: { queryWindow: string; allowedLabels?: readonly string[] },
): string {
  const parts = [deps.queryWindow];
  if (input.label && deps.allowedLabels?.includes(input.label)) parts.push(`label:${input.label}`);
  if (input.fromSender) {
    const safe = input.fromSender.replace(/[^A-Za-z0-9._@+-]/g, "").slice(0, 128);
    if (safe) parts.push(`from:${safe}`);
  }
  return parts.join(" ");
}

/**
 * The Gmail tool (#72): on the deterministic `סנכרן מייל` sync intent, read the family's OWN recent
 * matching emails and extract calendar items from them via the SAME `parse` path. Read-only.
 * - Opt-in / app-only → `ctx.google` absent OR `getValidAccessToken` not "ok" ⇒ `{ saved: [] }` with
 *   ZERO Gmail and ZERO parse calls (the AC: app-only families are completely untouched).
 * - Idempotency (AC4): each row persists under `waMessageId="gmail:<id>"` so a re-run upserts the same
 *   rows as no-ops. Provenance: `sourceProvider:"google"` activates #61's disconnect purge.
 * - Result is the COUNT of saved rows; email bodies never re-enter the model loop (G7).
 */
export function readGmailTool(parse: ParseMessage): Tool<{ label?: string; fromSender?: string }> {
  return {
    name: "read_gmail",
    description:
      "Read the family's own recent matching emails and extract calendar items (events, tasks, reminders) from them.",
    inputSchema: z.object({
      label: z.string().max(64).optional(),
      fromSender: z.string().max(128).optional(),
    }),
    async run(input, ctx) {
      const g = ctx.google;
      if (!g) return { saved: [] }; // not wired / not the sync path → no-op, zero calls
      const tok = await getValidAccessToken(ctx.familyId, g);
      if (tok.status !== "ok") return { saved: [] }; // not connected → ZERO Gmail/parse calls
      const q = buildGmailQuery(input, g);
      const refs = await g.client.list(tok.token, q, g.maxMessages);
      const saved: SavedEvent[] = [];
      for (const ref of refs) {
        const msg = await g.client.get(tok.token, ref.id);
        // Subject carries the event as often as the body; cap to the parser's bound (G2 spirit).
        const text = `${msg.subject}\n${msg.bodyText}`.slice(0, MAX_TOOL_TEXT);
        const events = await parse(text, ctx.todayIso, ctx.senderName);
        (events ?? []).forEach((event, seq) => {
          saved.push(
            ctx.events.saveEvent(event, {
              fromPhone: ctx.from,
              waMessageId: `gmail:${ref.id}`,
              seq,
              sourceProvider: "google",
            }),
          );
        });
      }
      return { saved };
    },
  };
}
