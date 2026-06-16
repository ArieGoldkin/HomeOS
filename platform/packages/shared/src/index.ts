// Zod v4 API (via the subpath zod 3.25+ ships): required so @anthropic-ai/sdk's
// zodOutputFormat can convert this schema to JSON Schema for structured outputs.
import { z } from "zod/v4";

/** The kinds of thing a forwarded message can become on the family board. */
export const EVENT_KINDS = ["event", "task", "reminder"] as const;
export const eventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof eventKindSchema>;

const dateIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date_iso must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "date_iso must be a real calendar date");

const timeHm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (24h)");

/**
 * G15 — codepoints that must never appear in a user-facing field: C0/DEL/C1 control chars (incl.
 * newlines that fake bot UI), zero-width + directional marks (U+200B–200F), and bidi-control
 * overrides/embeddings (U+202A–202E) and isolates (U+2066–2069). In a Hebrew (RTL) product these
 * let forwarded text spoof or garble the confirm. Code-based (no literal control bytes in source).
 */
function hasUnsafeChars(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true; // C0 / DEL / C1 controls
    if (c >= 0x200b && c <= 0x200f) return true; // zero-width + LRM/RLM
    if (c >= 0x202a && c <= 0x202e) return true; // bidi embeddings/overrides
    if (c >= 0x2066 && c <= 0x2069) return true; // bidi isolates
  }
  return false;
}

/**
 * G1 — title_he/location/assignee are MODEL-authored from untrusted forwarded text and round-trip to
 * the family's WhatsApp via the confirm, so the structured channel is really a prose channel. The
 * `.max` length bound stops a 4000-char essay / phishing dump from round-tripping (and is emitted as
 * maxLength in the structured-output JSON Schema, guiding Claude). The bidi/control refine (G15) is a
 * post-hoc backstop. An abusive value fails validation → null → "please rephrase", never reaching the user.
 */
const boundedLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !hasUnsafeChars(s), "control or bidirectional characters are not allowed");

/**
 * Weekly recurrence (covers חוגים / after-school activities). `weekday` is 0=Sunday … 6=Saturday
 * (the Israeli week starts Sunday). Deliberately not a full RRULE — weekly-by-weekday is enough
 * for the family domain; richer recurrence can extend this later.
 */
export const recurrenceSchema = z.object({
  freq: z.literal("weekly"),
  weekday: z.number().int().min(0).max(6),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

/**
 * The contract: the structured shape Claude extracts from a forwarded Hebrew message, produced
 * by the server/agent and consumed by the dashboard + kiosk. Dates are anchored to
 * Asia/Jerusalem upstream; `time`/`location`/`assignee`/`recurrence` are null when absent.
 * `assignee` is the family member it's for/assigned to (a name for now; a richer member model
 * comes with the multi-user work). New nullable fields default to null so the contract stays
 * robust if the model omits them. The user-facing string fields are content-bound (G1/G15).
 */
export const parsedEventSchema = z.object({
  kind: eventKindSchema,
  title_he: boundedLine(80),
  date_iso: dateIso,
  time: timeHm.nullable(),
  location: boundedLine(120).nullable(),
  assignee: boundedLine(40).nullable().default(null),
  recurrence: recurrenceSchema.nullable().default(null),
  // Verbatim original slice for this item (not rendered in the confirm) — bound length only, since
  // it may legitimately contain newlines. The handler's input cap (G2) bounds the message as a whole.
  source_text: z.string().max(2000),
});
export type ParsedEvent = z.infer<typeof parsedEventSchema>;

/**
 * One forwarded message can contain several items (the weekly gan newsletter is the canonical
 * case), so the parse result is a list. The object wrapper (vs a bare array) is what the LLM
 * structured-output format expects and keeps room for message-level fields later.
 */
export const parsedMessageSchema = z.object({
  events: z.array(parsedEventSchema),
});
export type ParsedMessage = z.infer<typeof parsedMessageSchema>;
