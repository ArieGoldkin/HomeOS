import { cancelPayloadSchema } from "../../../db/conversation-store.ts";
import type { ConversationRow } from "../../../db/schema.ts";
import type { InboundMessage } from "../../../http/webhook.ts";
import {
  CONFIRM_ABORT_HE,
  type HandlerDeps,
  isAffirmative,
  REPHRASE_HE,
  safeJsonParse,
} from "../shared/index.ts";
import { cancelMany, cancelOne } from "./delete.ts";
import { parseSelection } from "./selection.ts";

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
  // #163 — a BULK confirm-before-destroy (every in-scope row): FAIL-CLOSED yes/no over the WHOLE set, not a
  // numbered pick. Only an anchored כן deletes all; לא / a non-answer / anything else aborts with no write
  // (G20). Checked before the length branches so a bulk set of any size routes here (never to the picker).
  if (parsed.data.confirmAll) {
    if (isAffirmative(reply)) {
      await cancelMany(deps, msg, ids);
    } else {
      log("bulk cancel declined / non-affirmative — no delete (fail-closed)", { from: msg.from });
      await deps.sendText(msg.from, CONFIRM_ABORT_HE);
    }
    return;
  }
  // #147 — a SINGLE-candidate thread is a confirm-before-destroy (the agentic 1-match): FAIL-CLOSED, only
  // an anchored כן deletes; לא / a non-answer / anything else aborts with no write (G20).
  if (ids.length === 1) {
    if (isAffirmative(reply)) {
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
