import type { InboundMessage } from "../../../http/webhook.ts";
import { deleteFromCalendar } from "../../../tools/index.ts";
import { cancelReply, familyOf, type HandlerDeps } from "../shared/index.ts";

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
  const family = familyOf(deps);
  const removed = deps.events.deleteById(eventId, family);
  if (removed > 0 && deps.calendar) {
    await deleteFromCalendar(eventId, deps.calendar, family, log);
  }
  log("cancel-by-ref delete", { from: msg.from, eventId, removed });
  await deps.sendText(msg.from, cancelReply(removed));
}

/**
 * #161 — delete one OR MORE selected board rows (+ their best-effort Google mirrors), then send ONE
 * summary confirm (cancelReply pluralizes) instead of a burst of N messages. G25: each Google delete is
 * best-effort and never throws (the board is the source of truth). Drives the multi-select resume path.
 */
export async function cancelMany(
  deps: HandlerDeps,
  msg: InboundMessage,
  eventIds: number[],
): Promise<void> {
  const log = deps.log ?? (() => {});
  const family = familyOf(deps);
  let removed = 0;
  for (const id of eventIds) {
    const n = deps.events.deleteById(id, family);
    removed += n;
    if (n > 0 && deps.calendar) {
      await deleteFromCalendar(id, deps.calendar, family, log);
    }
  }
  log("cancel multi-select delete", { from: msg.from, eventIds, removed });
  await deps.sendText(msg.from, cancelReply(removed));
}
