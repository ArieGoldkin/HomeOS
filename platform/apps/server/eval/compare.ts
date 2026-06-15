import type { ParsedEvent } from "@homeos/shared";

/**
 * A hand-labeled expectation for one parsed event. Only the fields worth asserting are required;
 * `date_iso` is the strict gate (the wedge is Hebrew date resolution), everything else is compared
 * and reported but does NOT fail a case (kind/time/etc. carry genuine ambiguity).
 */
export interface ExpectedEvent {
  kind?: ParsedEvent["kind"];
  date_iso: string;
  time?: string | null;
  assignee?: string | null;
  recurrence?: ParsedEvent["recurrence"];
  title_he?: string;
}

export interface GoldenCase {
  name: string;
  input: string;
  /** Today's date (YYYY-MM-DD) the relative dates resolve against. */
  today: string;
  expected: ExpectedEvent[];
}

/** Only `date_iso` gates pass/fail; the rest are soft (reported, non-failing). */
const STRICT_FIELDS: ReadonlyArray<keyof ExpectedEvent> = ["date_iso"];
const COMPARED_FIELDS: ReadonlyArray<keyof ExpectedEvent> = [
  "date_iso",
  "kind",
  "time",
  "assignee",
  "recurrence",
  "title_he",
];

export interface FieldDiff {
  field: string;
  expected: unknown;
  actual: unknown;
  strict: boolean;
}

export interface EventComparison {
  matched: boolean; // no strict diffs
  diffs: FieldDiff[];
}

export function compareEvent(
  expected: ExpectedEvent,
  actual: ParsedEvent | undefined,
): EventComparison {
  if (!actual) {
    return {
      matched: false,
      diffs: [{ field: "(missing)", expected, actual: undefined, strict: true }],
    };
  }
  const diffs: FieldDiff[] = [];
  for (const field of COMPARED_FIELDS) {
    if (!(field in expected)) continue;
    const exp = expected[field];
    const act = (actual as Record<string, unknown>)[field];
    if (JSON.stringify(exp) !== JSON.stringify(act)) {
      diffs.push({ field, expected: exp, actual: act, strict: STRICT_FIELDS.includes(field) });
    }
  }
  return { matched: diffs.every((d) => !d.strict), diffs };
}

export interface MessageComparison {
  pass: boolean;
  events: EventComparison[];
  countExpected: number;
  countActual: number;
}

/** Compare a case's expected events against the parser output (aligned by order). */
export function compareMessage(
  expected: ExpectedEvent[],
  actual: ParsedEvent[] | null,
): MessageComparison {
  const acts = actual ?? [];
  const events = expected.map((e, i) => compareEvent(e, acts[i]));
  const pass = acts.length === expected.length && events.every((e) => e.matched);
  return { pass, events, countExpected: expected.length, countActual: acts.length };
}
