import { z } from "zod/v4";
import type { EventStore, SavedEvent } from "../db/event-store.ts";
import type { GmailClient } from "../google/gmail.ts";
import { type GetTokenDeps, getValidAccessToken } from "../google/oauth.ts";
import type { ParseMessage } from "../parsing/parser.ts";

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
