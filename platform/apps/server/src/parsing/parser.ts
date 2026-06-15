import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { parsedMessageSchema, type ParsedEvent } from "@homeos/shared";

/** Raw extraction call: (system, userText) → the model's structured object (or null). */
export type RawParse = (system: string, userText: string) => Promise<unknown>;

/** High-level parser the handler depends on: (text, today) → validated events (or null on failure). */
export type ParseMessage = (text: string, todayIso: string) => Promise<ParsedEvent[] | null>;

export function buildSystemPrompt(todayIso: string): string {
  return [
    "You convert a forwarded Hebrew (or mixed Hebrew/English) family message into a list of structured calendar items.",
    "A single message may contain SEVERAL items (e.g. a weekly gan newsletter) — extract each as its own event. " +
      "If there is nothing to schedule, return an empty list.",
    `Today is ${todayIso} in the Asia/Jerusalem timezone. Resolve all relative dates ` +
      '(e.g. "מחר", "יום ראשון הבא", "בעוד שבוע") against this date.',
    'Return an object: { "events": [ ... ] }. Each event has:',
    '- kind: "event" (happens at a time/place), "task" (something to do), or "reminder".',
    "- title_he: a short, clear Hebrew title.",
    "- date_iso: the resolved date as YYYY-MM-DD.",
    '- time: "HH:MM" (24h) if a specific time is given, otherwise null.',
    "- location: the place if mentioned, otherwise null.",
    '- assignee: the family member it is for/assigned to if named (e.g. "אבא", a child\'s name), otherwise null.',
    '- recurrence: { "freq": "weekly", "weekday": 0-6 } if it repeats weekly (e.g. חוגים; ' +
      "0=Sunday … 6=Saturday), otherwise null.",
    "- source_text: the original text for this item, copied verbatim.",
  ].join("\n");
}

/**
 * Orchestrates extraction: build the prompt with today's Jerusalem date, call the injected raw
 * parser, and validate against the shared message schema. Returns the events list (possibly empty),
 * or null when the call failed / the shape was invalid (caller falls back to "please rephrase").
 */
export function createParser(rawParse: RawParse): ParseMessage {
  return async function parseMessage(text: string, todayIso: string): Promise<ParsedEvent[] | null> {
    let raw: unknown;
    try {
      raw = await rawParse(buildSystemPrompt(todayIso), text);
    } catch {
      return null;
    }
    const result = parsedMessageSchema.safeParse(raw);
    return result.success ? result.data.events : null;
  };
}

/** Production RawParse backed by Claude structured outputs (@anthropic-ai/sdk). */
export function anthropicRawParse(client: Anthropic, model: string): RawParse {
  return async (system, userText) => {
    const res = await client.messages.parse({
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userText }],
      output_config: { format: zodOutputFormat(parsedMessageSchema) },
    });
    return res.parsed_output;
  };
}
