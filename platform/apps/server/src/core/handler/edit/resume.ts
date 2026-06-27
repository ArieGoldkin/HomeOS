import { editPayloadSchema } from "../../../db/conversation-store.ts";
import type { ConversationRow } from "../../../db/schema.ts";
import type { InboundMessage } from "../../../http/webhook.ts";
import { parseSelection } from "../cancel/index.ts";
import {
  CONFIRM_ABORT_HE,
  type HandlerDeps,
  isAffirmative,
  REPHRASE_HE,
  safeJsonParse,
} from "../shared/index.ts";
import { applyPatchToId, applyPatchToMany } from "./apply.ts";

/**
 * #86 — resume an edit disambiguation: a numbered reply picks ONE candidate → apply the held patch
 * (updateEvent enforces board-only, so a synced id can't be written). Non-index → no write. Single-use.
 */
export async function resumeEdit(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
): Promise<void> {
  const log = deps.log ?? (() => {});
  deps.conversations?.resolve(row.id); // single-use (turn cap 1)
  const parsed = editPayloadSchema.safeParse(safeJsonParse(row.payload_json));
  if (!parsed.success) {
    log("edit resume — invalid persisted payload", { from: msg.from, id: row.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const ids = parsed.data.candidateIds;
  const reply = msg.text?.trim() ?? "";
  // #147 — a SINGLE-candidate thread is a confirm-before-edit (the agentic 1-match): FAIL-CLOSED, only an
  // anchored כן applies the held patch; לא / a non-answer aborts with no write (applyPatchToId is also
  // board-only, so a synced id could never be written even if it slipped in).
  if (ids.length === 1) {
    if (isAffirmative(reply)) {
      await applyPatchToId(deps, msg, ids[0]!, parsed.data.patch);
    } else {
      log("edit confirm declined / non-affirmative — no write (fail-closed)", { from: msg.from });
      await deps.sendText(msg.from, CONFIRM_ABORT_HE);
    }
    return;
  }
  // N>1 — a disambiguation thread (#161): a SINGLE reply may pick one OR MORE candidates ("1", "1,2",
  // "1 ו-2") or הכל/כולם → apply the held patch to ALL of them; any non-selection reply writes nothing.
  const picks = parseSelection(reply, ids.length);
  if (picks.length === 0) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  await applyPatchToMany(
    deps,
    msg,
    picks.map((n) => ids[n - 1]!),
    parsed.data.patch,
  );
}
