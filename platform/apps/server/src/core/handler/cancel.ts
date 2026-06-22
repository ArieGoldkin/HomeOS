import { cancelPayloadSchema } from "../../db/conversation-store.ts";
import type { SavedEvent } from "../../db/event-store.ts";
import { type ConversationRow, FAMILY_ID } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import { deleteFromCalendar } from "../../tools/tools.ts";
import {
  AFFIRM_RE,
  addDaysIso,
  CANCEL_NOT_FOUND_HE,
  CANCEL_VERB_STRIP_RE,
  CANCEL_WHICH_HE,
  CONFIRM_ABORT_HE,
  cancelConfirmPrompt,
  cancelReply,
  conversationExpiresAt,
  formatWhen,
  type HandlerDeps,
  HEBREW_WEEKDAYS,
  REPHRASE_HE,
  resolveCandidates,
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
 * agentic-confirm paths. G25: the Google delete never throws (the board is the source of truth).
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
 * #161 — delete one OR MORE selected board rows (+ their best-effort Google mirrors), then send ONE
 * summary confirm (cancelReply pluralizes) instead of a burst of N messages. G25: each Google delete is
 * best-effort and never throws (the board is the source of truth). Drives the multi-select resume path.
 */
async function cancelMany(
  deps: HandlerDeps,
  msg: InboundMessage,
  eventIds: number[],
): Promise<void> {
  const log = deps.log ?? (() => {});
  let removed = 0;
  for (const id of eventIds) {
    const n = deps.events.deleteById(id, FAMILY_ID);
    removed += n;
    if (n > 0 && deps.calendar) {
      await deleteFromCalendar(id, deps.calendar, FAMILY_ID, log);
    }
  }
  log("cancel multi-select delete", { from: msg.from, eventIds, removed });
  await deps.sendText(msg.from, cancelReply(removed));
}

/**
 * #161 — parse a numbered-disambiguation selection (shared by the cancel AND edit resume paths). Accepts
 * one or MORE 1-based indices in a single reply ("1", "1,2", "1 ו-2", "1 2") or an "all" word (הכל/כולם →
 * every candidate). The whole reply must be selection-shaped (digits + the separators a person uses for a
 * list, or an all-word) so an arbitrary sentence with an incidental number is NOT treated as a pick (G20).
 * Returns the chosen indices, deduped and clamped to [1..count] in reply order; an empty array means "no
 * valid selection" (the caller deletes/edits nothing).
 */
export function parseSelection(reply: string, count: number): number[] {
  const r = reply.trim();
  if (/^(?:הכל|כולם)$/u.test(r)) return Array.from({ length: count }, (_, i) => i + 1);
  // Selection-shaped only: digits + list separators (comma, vav, hyphen/maqaf ־, plus, whitespace).
  if (!/^[\d\s,+ו־-]+$/u.test(r)) return [];
  const seen = new Set<number>();
  const picks: number[] = [];
  for (const match of r.matchAll(/\d+/gu)) {
    const n = Number(match[0]);
    if (n >= 1 && n <= count && !seen.has(n)) {
      seen.add(n);
      picks.push(n);
    }
  }
  return picks;
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
  const ids = parsed.data.candidateIds;
  const reply = msg.text?.trim() ?? "";
  // #147 — a SINGLE-candidate thread is a confirm-before-destroy (the agentic 1-match): FAIL-CLOSED, only
  // an anchored כן deletes; לא / a non-answer / anything else aborts with no write (G20).
  if (ids.length === 1) {
    if (AFFIRM_RE.test(reply)) {
      await cancelOne(deps, msg, ids[0]!);
    } else {
      log("cancel confirm declined / non-affirmative — no delete (fail-closed)", {
        from: msg.from,
      });
      await deps.sendText(msg.from, CONFIRM_ABORT_HE);
    }
    return;
  }
  // N>1 — a disambiguation thread (#161): a SINGLE reply may pick one OR MORE candidates ("1", "1,2",
  // "1 ו-2") or הכל/כולם (every candidate); any non-selection reply deletes nothing (G20 never auto-pick).
  const picks = parseSelection(reply, ids.length);
  if (picks.length === 0) {
    log("cancel resume — non-selection reply, no delete", { from: msg.from });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  await cancelMany(
    deps,
    msg,
    picks.map((n) => ids[n - 1]!),
  );
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
  const ref = extractCancelRef(text, today);
  const specific = Boolean(ref.time || ref.dateIso || (ref.titleHint && ref.titleHint.length >= 2));
  if (!specific) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  const candidates = deps.events.findEventsByRef(FAMILY_ID, ref);
  // Deterministic exact-match path (Option B — UNCHANGED): 1 → delete immediately; N>1 → numbered thread.
  if (candidates.length === 1) {
    await cancelOne(deps, msg, candidates[0]!.id);
    return;
  }
  if (candidates.length > 1) {
    await openCancelDisambiguation(deps, msg, candidates);
    return;
  }
  // 0 deterministic matches → AGENTIC fallback (#147): the model resolves the reference over
  // title+location+assignee (the live bug), then we CONFIRM before destroying. resolveAgent unwired ⇒
  // `null` ⇒ behave exactly as before (not-found). A TransientError propagates (→ pending/replay).
  const resolved = await resolveCandidates(deps, msg, text, ref, today);
  if (resolved === null || resolved.length === 0) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  if (resolved.length === 1) {
    await openCancelConfirm(deps, msg, resolved[0]!);
    return;
  }
  await openCancelDisambiguation(deps, msg, resolved);
}

/**
 * #147 — open a CONFIRM-before-destroy thread for an agentic 1-match cancel: a single-candidate `cancel`
 * thread (reuses the existing kind — no migration) + a `כן/לא` prompt. Resolved by `resumeCancel`'s
 * fail-closed `AFFIRM_RE`. No conversations store ⇒ we can't confirm, so we DON'T delete (rephrase).
 */
async function openCancelConfirm(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidate: SavedEvent,
): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!deps.conversations) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "cancel", candidateIds: [candidate.id] },
    expiresAt: conversationExpiresAt(deps),
  });
  log("cancel confirm opened (agentic 1-match)", { from: msg.from, id: candidate.id });
  await deps.sendText(msg.from, cancelConfirmPrompt(candidate));
}

/** #85/#147 — open a numbered disambiguation thread (N>1), shared by the deterministic and agentic paths. */
async function openCancelDisambiguation(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidates: SavedEvent[],
): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!deps.conversations) {
    await deps.sendText(msg.from, REPHRASE_HE); // no store wired → can't disambiguate
    return;
  }
  const list = candidates.map((e, i) => `${i + 1}. ${e.title_he} · ${formatWhen(e)}`).join("\n");
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "cancel", candidateIds: candidates.map((e) => e.id) },
    expiresAt: conversationExpiresAt(deps),
  });
  log("cancel-by-ref disambiguation opened", { from: msg.from, count: candidates.length });
  await deps.sendText(msg.from, `${CANCEL_WHICH_HE}\n${list}`);
}
