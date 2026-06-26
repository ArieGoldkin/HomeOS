import type { ParsedEvent } from "@homeos/shared";
import type { SavedEvent } from "../../../db/event-store/index.ts";
import { ALREADY_HE, CANCEL_NONE_HE } from "./messages.ts";

const hebrewDate = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * The confirm is the product's most-seen surface in a Hebrew family product, so render the
 * resolved date in Hebrew ("יום ראשון, 21 ביוני · 18:30"), not robotic ISO. Anchoring the Date
 * at UTC noon keeps the calendar day stable across the Asia/Jerusalem offset. Appends the
 * assignee and a weekly-recurrence marker when present.
 */
export function formatWhen(event: ParsedEvent): string {
  const dateHe = hebrewDate.format(new Date(`${event.date_iso}T12:00:00Z`));
  const parts = [event.time ? `${dateHe} · ${event.time}` : dateHe];
  if (event.recurrence) parts.push("(שבועי)");
  if (event.assignee) parts.push(`— ${event.assignee}`);
  return parts.join(" ");
}

/** One message can yield several events; confirm a single item inline, or list a count + bullets. */
export function formatConfirm(events: SavedEvent[]): string {
  if (events.length === 1) {
    const e = events[0]!;
    return `הוספתי ליומן ✓\n${e.title_he} · ${formatWhen(e)}`;
  }
  const lines = events.map((e) => `• ${e.title_he} · ${formatWhen(e)}`).join("\n");
  return `הוספתי ${events.length} פריטים ליומן ✓\n${lines}`;
}

/** Slot dedup — the "already on the board" reply, listing the existing slot(s) so the user knows the
 *  meeting is there and no second copy was made. Mirrors `formatConfirm`'s single-vs-list shape. */
export function formatAlready(events: SavedEvent[]): string {
  if (events.length === 1) {
    const e = events[0]!;
    return `${ALREADY_HE}\n${e.title_he} · ${formatWhen(e)}`;
  }
  const lines = events.map((e) => `• ${e.title_he} · ${formatWhen(e)}`).join("\n");
  return `${ALREADY_HE}\n${lines}`;
}

export function cancelReply(count: number): string {
  if (count === 0) return CANCEL_NONE_HE;
  return count === 1 ? "בוטל ✓" : `בוטלו ${count} פריטים ✓`;
}

/** #147 — confirm-before-destroy prompt for an agentic 1-match cancel (the model resolved ONE candidate). */
export function cancelConfirmPrompt(e: SavedEvent): string {
  return `לבטל את "${e.title_he}" · ${formatWhen(e)}? השב/י כן לאישור`;
}
/** #147 — confirm-before-destroy prompt for an agentic 1-match edit (the model resolved ONE candidate). */
export function editConfirmPrompt(e: SavedEvent): string {
  return `לעדכן את "${e.title_he}" · ${formatWhen(e)}? השב/י כן לאישור`;
}
/**
 * #163 — confirm-before-destroy prompt for a BULK cancel: list the whole in-scope set so the family SEES
 * exactly what a כן will delete, then ask for a single yes/no (fail-closed via isAffirmative). Bullets (not a
 * numbered list) signal "this is a yes/no over all of them", not a pick-some disambiguation.
 */
export function bulkCancelConfirmPrompt(events: SavedEvent[]): string {
  const list = events.map((e) => `• ${e.title_he} · ${formatWhen(e)}`).join("\n");
  return `לבטל את כל ${events.length} הפריטים הבאים? השב/י כן לאישור\n${list}`;
}
