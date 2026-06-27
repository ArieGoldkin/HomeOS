import type { InboundOutcome } from "@homeos/shared";
import type { SavedEvent } from "../../../../db/event-store/index.ts";
import type { InboundMessage } from "../../../../http/webhook.ts";
import { pushSavedEventsToCalendar } from "../../../../tools/index.ts";
import type { AgentResult } from "../../../agent/index.ts";
import { TransientError } from "../../../errors.ts";
import { openClarifyThread } from "../../clarify.ts";
import {
  clarifyOf,
  formatAlready,
  formatConfirm,
  type HandlerDeps,
  REPHRASE_HE,
  savedOf,
  TRANSIENT_HE,
} from "../../shared/index.ts";

/**
 * The agent (parse) path — the terminal phase, reached only when no deterministic route handled the
 * message. The agent decides parse-vs-act, runs a tool, and the TOOL persists its own rows (#71); the
 * handler no longer saves. Anchor + sender + familyId + the events store are server-supplied via
 * ToolContext (G8); senderName drives first-person → assignee (#14). Returns `clarified` (#84 templated
 * question + open thread, nothing saved), `rephrase` (unparseable), or `parsed` (saved and/or duplicate-
 * slot). A TransientError is re-thrown after a "retry" reply so the inbound row stays pending for
 * boot-replay (never lost, never markFailed). Uses `deps` (not the #229 clone) + an explicit `family`,
 * exactly as the unsplit handler did.
 */
export async function runParseAndConfirm(
  deps: HandlerDeps,
  msg: InboundMessage,
  text: string,
  today: string,
  family: string,
): Promise<InboundOutcome> {
  const log = deps.log ?? (() => {});
  // Slot-dedup sink (opt-in): the extract tool pushes an existing board row here instead of re-adding a
  // forward whose (date, time) slot is already taken, so a re-send isn't duplicated on the board.
  const duplicates: SavedEvent[] = [];
  let result: AgentResult;
  try {
    result = await deps.agent.run(text, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: family,
      events: deps.events,
      duplicates,
    });
  } catch (err) {
    if (err instanceof TransientError) {
      // The provider hiccuped — tell the user to retry (NOT "rephrase") and rethrow so the
      // inbound row stays `pending` for boot-replay rather than being lost or marked failed.
      log("transient parse error", { id: msg.id });
      await deps.sendText(msg.from, TRANSIENT_HE);
    }
    throw err;
  }

  // #84: the parse flagged a required-slot guess → ask ONE templated question + open a thread; save
  // NOTHING, no confirm. The next message resumes via the #83 RESUME branch above.
  const clarify = clarifyOf(result);
  if (clarify) {
    await openClarifyThread(deps, msg, clarify);
    return "clarified";
  }

  const saved = savedOf(result) ?? [];
  if (saved.length === 0 && duplicates.length === 0) {
    log("unparseable message", { id: msg.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return "rephrase";
  }

  // Slot dedup: a forward that ONLY duplicated existing slot(s) — nothing new saved — gets "already on
  // the board" (not a rephrase), so the user knows it's there and no second copy was made. It WAS a
  // parseable event (just already present), so the feed records it as `parsed`.
  if (saved.length === 0) {
    log("duplicate slot", { id: msg.id, count: duplicates.length });
    await deps.sendText(msg.from, formatAlready(duplicates));
    return "parsed";
  }

  // The tool already persisted each NEW event (idempotent on (wa_message_id, seq)); the handler is now
  // thin — confirm the new rows, and note any duplicates in the same message so nothing seems lost.
  log("saved events", { id: msg.id, count: saved.length, duplicates: duplicates.length });
  const confirm = formatConfirm(saved);
  await deps.sendText(
    msg.from,
    duplicates.length > 0 ? `${confirm}\n\n${formatAlready(duplicates)}` : confirm,
  );

  // #18 chunk 2: auto-push the new board events to Google Calendar — best-effort, AFTER the confirm.
  // The board is the source of truth; a push failure is logged, never fails the confirm or replays the
  // row. App-only / disabled ⇒ no-op; only board-originated rows are written (the push filters them).
  if (deps.autoPushCalendar && deps.calendar) {
    const { pushed } = await pushSavedEventsToCalendar(saved, deps.calendar, family, log);
    if (pushed > 0) log("auto-pushed to calendar", { id: msg.id, pushed });
  }

  return "parsed";
}
