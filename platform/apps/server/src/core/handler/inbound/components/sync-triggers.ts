import type { InboundMessage } from "../../../../http/webhook.ts";
import {
  CAL_NOT_CONNECTED_HE,
  type HandlerDeps,
  NOT_CONNECTED_HE,
  SYNC_CAL_INTENT,
  SYNC_CAL_NONE_HE,
  SYNC_CAL_TRIGGER,
  SYNC_INTENT,
  SYNC_MAIL_TRIGGER,
  SYNC_NONE_HE,
} from "../../shared/index.ts";
import { runSyncIntent } from "../../sync.ts";
import { CONTINUE, type PhaseResult } from "./phase.ts";

/**
 * The bare sync commands (deterministic, siblings to ביטול). "סנכרן מייל" pulls the family's recent
 * matching emails (#72); "סנכרן יומן" pulls upcoming Google Calendar events (#18) — each via an agent run
 * that forces `read_gmail`/`read_calendar` on turn 0 (keeps G4). Opt-in: with no Google bundle or no
 * stored credential we reply "connect first" (a handled `undefined` outcome — replied, no disposition)
 * and make ZERO Gmail/Calendar/parse/model calls. Not a sync command ⇒ {@link CONTINUE}. Uses `deps`
 * (not the #229 clone) + an explicit `family` in the ToolContext, exactly as the unsplit handler did —
 * the G8 gate (`google`/`calendar` in the context) keeps each read inert off the sync path.
 */
export async function trySyncTriggers(
  deps: HandlerDeps,
  msg: InboundMessage,
  text: string,
  today: string,
  family: string,
): Promise<PhaseResult> {
  const log = deps.log ?? (() => {});
  if (text === SYNC_MAIL_TRIGGER) {
    if (!deps.google?.credentials.get(family)) {
      log("sync mail — not connected", { from: msg.from });
      await deps.sendText(msg.from, NOT_CONNECTED_HE);
      return;
    }
    await runSyncIntent(deps, msg, SYNC_INTENT, "read_gmail", SYNC_NONE_HE, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: family,
      events: deps.events,
      google: deps.google, // the G8 gate — read_gmail is inert unless this is set (sync path only)
    });
    return "synced";
  }

  if (text === SYNC_CAL_TRIGGER) {
    if (!deps.calendar?.credentials.get(family)) {
      log("sync calendar — not connected", { from: msg.from });
      await deps.sendText(msg.from, CAL_NOT_CONNECTED_HE);
      return;
    }
    await runSyncIntent(deps, msg, SYNC_CAL_INTENT, "read_calendar", SYNC_CAL_NONE_HE, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: family,
      events: deps.events,
      calendar: deps.calendar, // the G8 gate — read_calendar is inert unless this is set (sync path only)
    });
    return "synced";
  }

  return CONTINUE;
}
