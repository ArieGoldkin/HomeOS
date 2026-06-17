import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type ParsedEvent, parsedMessageSchema } from "@homeos/shared";
import { isTransient, TransientError } from "../core/errors.ts";

/** Raw extraction call: (system, userText) → the model's structured object (or null). */
export type RawParse = (system: string, userText: string) => Promise<unknown>;

/**
 * High-level parser the handler depends on: (text, today) → validated events, or `null` when the
 * call succeeded but the message couldn't be turned into a valid event (→ "please rephrase").
 * Throws `TransientError` when the provider hiccuped even after a retry (→ "try again", replayable).
 */
export type ParseMessage = (
  text: string,
  todayIso: string,
  senderName?: string,
) => Promise<ParsedEvent[] | null>;

interface ParserOptions {
  /** Extra attempts on a transient error (default 1 → up to 2 calls total). */
  retries?: number;
  /** Injectable backoff sleep (tests pass an instant no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export function buildSystemPrompt(todayIso: string, senderName?: string): string {
  // #14: when the sender is a known family member, first-person/imperative phrasing assigns the item
  // to them. Server-supplied name (never model-invented), so it can't be spoofed via the text (G8).
  const assigneeRule = senderName
    ? `- assignee: who the item is for. The sender of this message is "${senderName}"; if it is a first-person request or instruction from them (e.g. "יש לי", "תכניס לי", "תזכיר לי", "אני צריך"), set assignee to "${senderName}". Otherwise the named family member (e.g. a child's name), or null.`
    : '- assignee: the family member it is for/assigned to if named (e.g. "אבא", a child\'s name), otherwise null.';
  return [
    "You convert a Hebrew (or mixed Hebrew/English) family message — forwarded OR a direct request/instruction from the sender — into a list of structured calendar items.",
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
    assigneeRule,
    '- recurrence: { "freq": "weekly", "weekday": 0-6 } if it repeats weekly (e.g. חוגים; ' +
      "0=Sunday … 6=Saturday), otherwise null.",
    "- source_text: the original text for this item, copied verbatim.",
  ].join("\n");
}

/**
 * Orchestrates extraction: build the prompt with today's Jerusalem date, call the injected raw
 * parser, and validate against the shared message schema. A valid call with a bad/empty shape →
 * `null` (rephrase). A transient provider error → one backoff retry, then `TransientError` (the
 * caller must distinguish "the API hiccuped" from "the user said something unparseable").
 */
export function createParser(rawParse: RawParse, opts: ParserOptions = {}): ParseMessage {
  const retries = opts.retries ?? 1;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  return async function parseMessage(
    text: string,
    todayIso: string,
    senderName?: string,
  ): Promise<ParsedEvent[] | null> {
    const system = buildSystemPrompt(todayIso, senderName);
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await rawParse(system, text);
        const result = parsedMessageSchema.safeParse(raw);
        return result.success ? result.data.events : null; // valid call, bad shape → rephrase
      } catch (err) {
        if (!isTransient(err)) return null; // permanent (e.g. 4xx) → rephrase fallback
        lastErr = err;
        if (attempt < retries) await sleep(200 * (attempt + 1)); // backoff, then retry
      }
    }
    throw new TransientError("parse failed after transient retries", lastErr);
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
