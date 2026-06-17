import type { ParsedEvent } from "@homeos/shared";
import { z } from "zod/v4";
import type { ParseMessage } from "../parsing/parser.ts";

/**
 * Server-supplied context handed to a tool's `run` — NEVER taken from the model's tool input.
 * This closes the date-spoof / sender-impersonation surface (G8): forwarded text cannot move the
 * Asia/Jerusalem anchor or impersonate a family member. `from` is also the #14 first-person→assignee
 * source (added when direct commands land).
 */
export interface ToolContext {
  /** Today in Asia/Jerusalem (YYYY-MM-DD), for relative-date resolution. */
  todayIso: string;
  /** Sender phone — server-supplied, never model-supplied. */
  from: string;
  waMessageId: string;
}

/**
 * The declarative registry seam: a tool is `{ name, description, inputSchema, run }`. Appending a
 * Tool to the array passed to `createAgent` registers it — there is no separate registry layer.
 * `inputSchema` is re-validated against the model's (untrusted) tool input before `run` (G6).
 */
export interface Tool<I = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<{ events: ParsedEvent[] }>;
}

/**
 * Defense-in-depth cap on the model-echoed text (the authoritative cap is the handler's pre-model
 * input cap, G2). Generous vs the handler's MAX_INPUT so a legitimate forward isn't double-rejected.
 */
const MAX_TOOL_TEXT = 8000;

/**
 * The only tool for #13: re-runs the existing extractor (`parser.ts`) so the proven retry/validation/
 * TransientError seam — and its test net — is preserved verbatim. Still produces `ParsedEvent[]`.
 * `parse` throwing a TransientError propagates out (→ the agent loop → handler → row stays pending).
 */
export function extractEventsTool(parse: ParseMessage): Tool<{ text: string }> {
  return {
    name: "extract_events",
    description:
      "Extract calendar items (events, tasks, reminders) from the forwarded family message text.",
    inputSchema: z.object({ text: z.string().min(1).max(MAX_TOOL_TEXT) }),
    async run({ text }, ctx) {
      const events = await parse(text, ctx.todayIso);
      return { events: events ?? [] }; // empty list = "nothing to schedule"
    },
  };
}
