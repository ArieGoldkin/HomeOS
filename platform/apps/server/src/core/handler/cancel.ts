import { cancelPayloadSchema } from "../../db/conversation-store.ts";
import { type ConversationRow, FAMILY_ID } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import { deleteFromCalendar } from "../../tools/tools.ts";
import { sqliteUtc } from "../time.ts";
import {
  addDaysIso,
  CANCEL_NOT_FOUND_HE,
  CANCEL_VERB_STRIP_RE,
  CANCEL_WHICH_HE,
  CONVERSATION_TTL_MS,
  cancelReply,
  formatWhen,
  type HandlerDeps,
  HEBREW_WEEKDAYS,
  REPHRASE_HE,
  safeJsonParse,
  TIME_RE,
  WEEKDAY_RE,
  weekdayOfIso,
} from "./shared.ts";

/**
 * #85 — extract a cancel REFERENCE server-side (NO model call): strip the verb, then pull an explicit
 * time (HH:MM, hour zero-padded), a relative Hebrew DATE (היום/מחר/מחרתיים or a weekday → its next
 * occurrence, #125/F2), and treat the remaining content words as a title substring hint. Exported so the
 * extraction contract is unit-tested. (The 12h/24h expansion — "3:30" also matching 15:30 — stays a #87
 * refinement; today a low bare hour matches its 24h form.)
 */
export function extractCancelRef(
  text: string,
  todayIso: string,
): { dateIso?: string; time?: string; titleHint?: string } {
  let rest = text.replace(CANCEL_VERB_STRIP_RE, "");

  let time: string | undefined;
  const tm = TIME_RE.exec(rest);
  if (tm?.[1] && tm[2]) {
    time = `${String(Number(tm[1])).padStart(2, "0")}:${tm[2]}`;
    rest = rest.replace(TIME_RE, " ");
  }

  // Resolve a relative date so the words don't pollute the title hint AND a date-bearing cancel matches.
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
 * #85 — delete ONE board row + its best-effort Google mirror, then confirm. Shared by the 1-match and the
 * resume-index paths. G25: the Google delete never throws (the board is the source of truth).
 */
export async function cancelOne(
  deps: HandlerDeps,
  msg: InboundMessage,
  eventId: number,
): Promise<void> {
  const log = deps.log ?? (() => {});
  const removed = deps.events.deleteById(eventId, FAMILY_ID);
  if (removed > 0 && deps.calendar) {
    await deleteFromCalendar(eventId, deps.calendar, FAMILY_ID, log);
  }
  log("cancel-by-ref delete", { from: msg.from, eventId, removed });
  await deps.sendText(msg.from, cancelReply(removed));
}

/**
 * #85 — resume a cancel disambiguation: a numbered reply (^[1-5]$) picks ONE candidate → delete it; any
 * non-index reply deletes NOTHING (G20 never auto-pick). Single-use: the thread is resolved up front (no
 * model call here, so nothing to leave pending). The persisted payload is re-validated (F3).
 */
export async function resumeCancel(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
): Promise<void> {
  const log = deps.log ?? (() => {});
  deps.conversations?.resolve(row.id); // single-use (turn cap 1)
  const parsed = cancelPayloadSchema.safeParse(safeJsonParse(row.payload_json));
  if (!parsed.success) {
    log("cancel resume — invalid persisted payload", { from: msg.from, id: row.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const m = /^([1-5])$/.exec(msg.text?.trim() ?? "");
  const id = m?.[1] ? parsed.data.candidateIds[Number(m[1]) - 1] : undefined;
  if (id === undefined) {
    // a non-index (or out-of-range) reply → no delete; the user can re-issue the cancel.
    log("cancel resume — non-index reply, no delete", { from: msg.from });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  await cancelOne(deps, msg, id);
}

/**
 * #85 cancel-BY-REFERENCE route (deterministic, NO model call) — "בטל/מחק/הסר <ref>". The reference is
 * extracted SERVER-side; findEventsByRef scopes to the family's board rows (source_provider IS NULL).
 * 0 → not-found; 1 → delete + best-effort Google delete; N>1 → a numbered disambiguation thread (never
 * auto-pick — the board is shared, G20). #125/F1 — require a SPECIFIC reference (time, date, or a title
 * hint of ≥2 chars) before touching the board, so a bare verb or a coincidental forward starting with
 * בטל must NOT silently delete (state-not-content, G22).
 */
export async function routeCancelByRef(
  deps: HandlerDeps,
  msg: InboundMessage,
  text: string,
  today: string,
): Promise<void> {
  const log = deps.log ?? (() => {});
  const ref = extractCancelRef(text, today);
  const specific = Boolean(ref.time || ref.dateIso || (ref.titleHint && ref.titleHint.length >= 2));
  if (!specific) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  const candidates = deps.events.findEventsByRef(FAMILY_ID, ref);
  if (candidates.length === 0) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  if (candidates.length === 1) {
    await cancelOne(deps, msg, candidates[0]!.id);
    return;
  }
  if (deps.conversations) {
    const list = candidates.map((e, i) => `${i + 1}. ${e.title_he} · ${formatWhen(e)}`).join("\n");
    const expiresAt = sqliteUtc(
      new Date((deps.now ?? (() => new Date()))().getTime() + CONVERSATION_TTL_MS),
    );
    deps.conversations.create({
      fromPhone: msg.from,
      payload: { kind: "cancel", candidateIds: candidates.map((e) => e.id) },
      expiresAt,
    });
    log("cancel-by-ref disambiguation opened", { from: msg.from, count: candidates.length });
    await deps.sendText(msg.from, `${CANCEL_WHICH_HE}\n${list}`);
  } else {
    await deps.sendText(msg.from, REPHRASE_HE); // no store wired → can't disambiguate
  }
}
