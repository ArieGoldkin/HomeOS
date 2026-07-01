import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type ParsedEvent, parsedMessageSchema } from "@homeos/shared";
import { isProgrammingError, isTransient, TransientError } from "../core/errors.ts";
import { detectStandingDaily } from "./standing.ts";

/**
 * #224 — the DETERMINISTIC standing-reminder gate, applied to every parsed event. `standing` is set iff the
 * event is a `reminder` whose text carries a daily-cadence phrase (see {@link detectStandingDaily}) — and
 * explicitly set to null otherwise, so a model-hallucinated value is scrubbed. This keeps a runaway recurring
 * reminder impossible from a stray parse; the gate, not the model, owns the field.
 */
function applyStandingGate(events: ParsedEvent[]): ParsedEvent[] {
  return events.map((ev) => ({
    ...ev,
    standing:
      ev.kind === "reminder" && detectStandingDaily(ev.source_text)
        ? ({ cadence: "daily" } as const)
        : null,
  }));
}

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
    `Today is ${todayIso} in the Asia/Jerusalem timezone. Resolve every relative date against this date.`,
    "Hebrew weekday names are DAYS OF THE WEEK, not a count of days from today: " +
      "יום ראשון=Sunday, יום שני=Monday, יום שלישי=Tuesday, יום רביעי=Wednesday, יום חמישי=Thursday, יום שישי=Friday, שבת=Saturday. " +
      'So "ביום שלישי" is the next date that falls on Tuesday (it is NOT today+3). The Israeli week starts on Sunday; ' +
      "for a weekday that already passed earlier this week, use the upcoming occurrence.",
    'Other relative terms: "מחר"=tomorrow (+1 day), "מחרתיים"=day after tomorrow (+2 days), ' +
      '"בעוד שבוע"=+7 days, "יום ראשון הבא"=Sunday of next week.',
    'Return an object: { "events": [ ... ] }. Each event has:',
    '- kind: one of "event" (happens at a set time/place — a meeting, appointment, class), "task" ' +
      '(something to do, with no fixed time), or "reminder" (the SENDER asking to be reminded to do ' +
      'something). Imperative/meta framing — "תזכיר לי…", "להזכיר לי…", "תעשה לי תזכורת…", "תוסיף תזכורת…", ' +
      '"אל תשכח…" — is a "reminder" even when it carries a time (the time goes in `time`, not the title).',
    "- title_he: a short, clear Hebrew title naming WHAT the item is — the core action or subject ONLY " +
      '(e.g. "לקנות מגן למסך"). STRIP the imperative/meta framing ("תעשה לי תזכורת ש…", "תזכיר לי…", ' +
      '"תוסיף…", "אל תשכח…") and any date/time words ("היום", "מחר", "בשעה 18:00") out of the title — ' +
      "those belong in date_iso/time, not title_he. NEVER copy the whole sentence into title_he.",
    "- date_iso: the resolved date as YYYY-MM-DD.",
    '- time: "HH:MM" (24h) if a specific time is given, otherwise null.',
    "- location: the place if mentioned, otherwise null.",
    assigneeRule,
    '- recurrence: { "freq": "weekly", "weekday": 0-6 } if it repeats weekly (e.g. חוגים; ' +
      "0=Sunday … 6=Saturday), otherwise null.",
    "- source_text: the original text for this item, copied verbatim.",
    // #84: the model's only confidence signal — a CONSTRAINED ENUM the server turns into ONE templated
    // Hebrew question (the model NEVER writes the question itself; that is the single-purpose red line).
    // Be CONSERVATIVE: a clear parse must auto-add instantly (the product's "instant magic"), so
    // over-flagging is the main failure to avoid — when in doubt, OMIT the field and just parse.
    "- needs_clarification: OMIT this field entirely for a clear parse. Set it ONLY when a REQUIRED " +
      'slot is genuinely a guess, as { "reason": <one of the values below> }:',
    '  - "missing_date": the message gives NO discernible date or day and you would otherwise be ' +
      'GUESSING the date. Relative dates ARE discernible — "מחר", "מחרתיים", "ביום ראשון", ' +
      '"בשבוע הבא", a weekday name, or an explicit date all resolve to a real date, so do NOT flag those.',
    '  - "ambiguous_title": you cannot tell WHAT the event is — there is no sensible Hebrew title to give it.',
    "  NEVER set needs_clarification for a missing time or any other optional field (time, location, " +
      'assignee, recurrence are allowed to be null — a missing time is normal, never "missing_time" here). ' +
      "NEVER invent a reason outside the two values above, and NEVER write a free-text question.",
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
        // valid call, bad shape → rephrase; otherwise apply the #224 deterministic standing gate.
        return result.success ? applyStandingGate(result.data.events) : null;
      } catch (err) {
        if (isProgrammingError(err)) throw err; // programming bug → permanent + visible → markFailed (OG10/#57)
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
      // Deterministic extraction: date arithmetic + structured output want greedy decoding, not
      // creative variance. Temperature 0 makes parses reproducible (so the eval is stable) and
      // measurably tightens relative-date resolution.
      temperature: 0,
      system,
      messages: [{ role: "user", content: userText }],
      output_config: { format: zodOutputFormat(parsedMessageSchema) },
    });
    return res.parsed_output;
  };
}
