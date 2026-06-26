import { parsedEventSchema, sanitizeUserText } from "@homeos/shared";
import { clarifyPayloadSchema } from "../../db/conversation-store.ts";
import type { EventPatch } from "../../db/event-store.ts";
import type { ConversationRow } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import { pushSavedEventsToCalendar } from "../../tools/tools.ts";
import { familyOf, formatConfirm, type HandlerDeps, REPHRASE_HE, safeJsonParse } from "./shared.ts";

/**
 * #86 — extract the NEW field value from a terse correction ("לא ב-28, ב-21" → day 21; "לא בשעה 4:00" →
 * time; "לא במיקום X" → location). Takes the LAST value of each field (the ASSERTED one, after the
 * negated one). Day resolves to today's month (#87: cross-month). Null when no field is present.
 */
export function extractCorrectionDelta(text: string, todayIso: string): EventPatch | null {
  const patch: EventPatch = {};
  // #126/F2 — bounded so it can't swallow a trailing time/day token ("במיקום בית הספר בשעה 18:00").
  const loc = /במיקום\s+(.+?)(?=\s+בשעה|\s+[בל]-?\s*\d|$)/u.exec(text);
  if (loc?.[1]) patch.location = sanitizeUserText(loc[1].trim());
  const lastT = [...text.matchAll(/(\d{1,2}):(\d{2})/gu)].at(-1);
  if (lastT?.[1] && lastT[2])
    patch.time = `${String(Number(lastT[1])).padStart(2, "0")}:${lastT[2]}`;
  const lastD = [...text.matchAll(/ב-?(\d{1,2})(?![:\d])/gu)].at(-1);
  if (lastD?.[1])
    patch.date_iso = `${todayIso.slice(0, 8)}${String(Number(lastD[1])).padStart(2, "0")}`;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * #86 CORRECTION (the live 2-reminder bug fix) — apply a terse "לא …" correction to the held CLARIFY
 * draft IN PLACE (never a 2nd event): merge the new field value, re-validate, save + confirm. A clarify
 * draft was never persisted, so completing it here is one save, not a duplicate. Single-use.
 */
export async function applyCorrection(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
  todayIso: string,
): Promise<void> {
  const log = deps.log ?? (() => {});
  deps.conversations?.resolve(row.id);
  const parsed = clarifyPayloadSchema.safeParse(safeJsonParse(row.payload_json));
  const delta = extractCorrectionDelta(msg.text?.trim() ?? "", todayIso);
  // Corrections target a single held draft → clarify threads only; anything else degrades to rephrase.
  if (!parsed.success || !delta) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const validated = parsedEventSchema.safeParse({
    ...parsed.data.draft,
    ...delta,
    needs_clarification: undefined,
  });
  if (!validated.success) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const saved = deps.events.saveEvent(validated.data, { fromPhone: msg.from, waMessageId: msg.id });
  log("correction applied", { from: msg.from, id: saved.id });
  await deps.sendText(msg.from, formatConfirm([saved]));
  if (deps.autoPushCalendar && deps.calendar) {
    const { pushed } = await pushSavedEventsToCalendar([saved], deps.calendar, familyOf(deps), log);
    if (pushed > 0) log("auto-pushed correction", { id: msg.id, pushed });
  }
}
