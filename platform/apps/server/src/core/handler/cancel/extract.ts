import {
  addDaysIso,
  BULK_QUANTIFIER_RE,
  CANCEL_VERB_STRIP_RE,
  HEBREW_WEEKDAYS,
  TIME_RE,
  WEEKDAY_RE,
  weekdayOfIso,
} from "../shared/index.ts";

/**
 * #85/#163 — pull a relative scope (an explicit HH:MM time + a relative Hebrew DATE: היום/מחר/מחרתיים or
 * a weekday → its NEXT occurrence, #125/F2) out of the verb-stripped remainder, REMOVING the matched words
 * so they don't pollute a downstream title hint. Returns the extracted fields + the leftover `rest`. The
 * single source of the date/time cascade, shared by `extractCancelRef` (single-target) and
 * `extractBulkCancel` (bulk). (The 12h/24h expansion — "3:30" also matching 15:30 — stays a #87
 * refinement; today a low bare hour matches its 24h form.)
 */
function stripDateTime(
  text: string,
  todayIso: string,
): { dateIso?: string; time?: string; rest: string } {
  let rest = text;

  let time: string | undefined;
  const tm = TIME_RE.exec(rest);
  if (tm?.[1] && tm[2]) {
    time = `${String(Number(tm[1])).padStart(2, "0")}:${tm[2]}`;
    rest = rest.replace(TIME_RE, " ");
  }

  // מחרתיים is tested BEFORE מחר; a weekday name resolves to its NEXT occurrence (0 = today, never past).
  let dateIso: string | undefined;
  if (/(?<!\p{L})היום(?!\p{L})/u.test(rest)) {
    dateIso = todayIso;
    rest = rest.replace(/(?<!\p{L})היום(?!\p{L})/u, " ");
  } else if (/(?<!\p{L})מחרתיים(?!\p{L})/u.test(rest)) {
    dateIso = addDaysIso(todayIso, 2);
    rest = rest.replace(/(?<!\p{L})מחרתיים(?!\p{L})/u, " ");
  } else if (/(?<!\p{L})מחר(?!\p{L})/u.test(rest)) {
    dateIso = addDaysIso(todayIso, 1);
    rest = rest.replace(/(?<!\p{L})מחר(?!\p{L})/u, " ");
  } else {
    const wd = WEEKDAY_RE.exec(rest);
    const target = wd?.[1] !== undefined ? HEBREW_WEEKDAYS[wd[1]] : undefined;
    if (wd && target !== undefined) {
      dateIso = addDaysIso(todayIso, (target - weekdayOfIso(todayIso) + 7) % 7);
      rest = rest.replace(wd[0], " ");
    }
  }

  return { ...(dateIso ? { dateIso } : {}), ...(time ? { time } : {}), rest };
}

/**
 * #85 — extract a cancel REFERENCE server-side (NO model call): strip the verb, pull the date/time scope,
 * and treat the remaining content words as a title substring hint. Exported so the extraction contract is
 * unit-tested.
 */
export function extractCancelRef(
  text: string,
  todayIso: string,
): { dateIso?: string; time?: string; titleHint?: string } {
  const { dateIso, time, rest } = stripDateTime(text.replace(CANCEL_VERB_STRIP_RE, ""), todayIso);
  const titleHint = rest
    .replace(/(?<!\p{L})את(?!\p{L})/gu, " ")
    .replace(/(?<!\p{L})יום(?!\p{L})/gu, " ")
    .replace(/[-־]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return {
    ...(dateIso ? { dateIso } : {}),
    ...(time ? { time } : {}),
    ...(titleHint ? { titleHint } : {}),
  };
}

/**
 * #163 — detect a BULK cancel ("בטל את כל הפגישות מחר") and extract its date/time SCOPE. Strips the verb +
 * a leading "את", then requires the bulk quantifier (`כל ה…`/`הכל`/`כולם`) to LEAD the cancel object
 * (`BULK_QUANTIFIER_RE`, anchored) — so a mid-sentence "כל" ("…עם כל המשפחה") is NOT bulk. Returns the
 * scope, or `null` when it isn't a bulk request OR carries no date/time scope (a scopeless "בטל הכל" must
 * never offer a whole-board wipe — it falls through to the single-target path → not-found). Kind-agnostic
 * by design: the quantifier's noun ("פגישות") is a bulk marker, not a kind filter.
 */
export function extractBulkCancel(
  text: string,
  todayIso: string,
): { dateIso?: string; time?: string } | null {
  const afterVerb = text.replace(CANCEL_VERB_STRIP_RE, "").replace(/^\s*את\s+/u, "");
  if (!BULK_QUANTIFIER_RE.test(afterVerb)) return null;
  const { dateIso, time } = stripDateTime(afterVerb, todayIso);
  if (!dateIso && !time) return null; // require a scope — never a whole-board wipe
  return { ...(dateIso ? { dateIso } : {}), ...(time ? { time } : {}) };
}
