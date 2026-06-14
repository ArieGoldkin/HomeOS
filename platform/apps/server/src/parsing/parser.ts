import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { parsedEventSchema, type ParsedEvent } from "@homeos/shared";

/** Raw extraction call: (system, userText) → the model's structured object (or null). */
export type RawParse = (system: string, userText: string) => Promise<unknown>;

/** High-level parser the handler depends on: (text, today) → validated event or null. */
export type ParseMessage = (text: string, todayIso: string) => Promise<ParsedEvent | null>;

export function buildSystemPrompt(todayIso: string): string {
  return [
    "You convert a forwarded Hebrew (or mixed Hebrew/English) family message into ONE structured calendar item.",
    `Today is ${todayIso} in the Asia/Jerusalem timezone. Resolve all relative dates ` +
      '(e.g. "מחר", "יום ראשון הבא", "בעוד שבוע") against this date.',
    "Fields:",
    '- kind: "event" (happens at a time/place), "task" (something to do), or "reminder".',
    "- title_he: a short, clear Hebrew title.",
    "- date_iso: the resolved date as YYYY-MM-DD.",
    '- time: "HH:MM" (24h) if a specific time is given, otherwise null.',
    "- location: the place if mentioned, otherwise null.",
    "- source_text: the original message, copied verbatim.",
  ].join("\n");
}

/**
 * Orchestrates extraction: build the prompt with today's Jerusalem date, call the injected
 * raw parser, and validate against the shared schema. Returns null when the message can't be
 * turned into a valid event (caller falls back to a "please rephrase" reply).
 */
export function createParser(rawParse: RawParse): ParseMessage {
  return async function parseMessage(text: string, todayIso: string): Promise<ParsedEvent | null> {
    let raw: unknown;
    try {
      raw = await rawParse(buildSystemPrompt(todayIso), text);
    } catch {
      return null;
    }
    const result = parsedEventSchema.safeParse(raw);
    return result.success ? result.data : null;
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
      output_config: { format: zodOutputFormat(parsedEventSchema) },
    });
    return res.parsed_output;
  };
}
