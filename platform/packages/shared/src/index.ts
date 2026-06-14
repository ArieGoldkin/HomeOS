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
 * The M2 contract: the structured shape Claude extracts from a forwarded Hebrew message,
 * produced by the server and (in P1) consumed by the kitchen display. Dates are anchored
 * to Asia/Jerusalem upstream; `time`/`location` are null when absent (all-day / no place).
 */
export const parsedEventSchema = z.object({
  kind: eventKindSchema,
  title_he: z.string().min(1),
  date_iso: dateIso,
  time: timeHm.nullable(),
  location: z.string().min(1).nullable(),
  source_text: z.string(),
});
export type ParsedEvent = z.infer<typeof parsedEventSchema>;
