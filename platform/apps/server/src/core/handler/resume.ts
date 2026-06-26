import type { ConversationRow } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import { resumeCancel } from "./cancel.ts";
import { resumeClarify } from "./clarify.ts";
import { resumeEdit } from "./edit.ts";
import { type HandlerDeps, REPHRASE_HE } from "./shared/index.ts";

/**
 * Resume an open conversation thread (#83, Milestone #8 foundation). Routes the sender's next message
 * to the deterministic resolution for the thread's `kind` — NEVER back through `agent.run` (G17: a
 * clarify answer must not be re-parsed as a fresh forward, nor enter an auto agent turn). The thread is
 * consumed up front (`resolve` DELETEs it — single-use, G24), so a Meta at-least-once redelivery finds
 * nothing pending and falls through to the normal path. For #83 the `clarify` arm is a trivial ECHO
 * STUB that proves ask→wait→resume end-to-end; #84 replaces it with the slot-merge + re-validation,
 * and #85/#86 add the `cancel`/`edit` arms.
 */
export async function handleResume(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
): Promise<void> {
  const log = deps.log ?? (() => {});
  switch (row.kind) {
    case "clarify":
      // resumeClarify OWNS the resolve so a TRANSIENT re-parse error leaves the thread intact for
      // boot-replay (F2) — resolving up front would drop the held draft on a provider blip.
      return resumeClarify(deps, msg, row);
    case "cancel":
      return resumeCancel(deps, msg, row);
    case "edit":
      return resumeEdit(deps, msg, row);
    default:
      // an unknown/forward-incompatible kind: consume defensively and ask to rephrase rather than
      // silently drop an answer to a thread this version doesn't know how to resume.
      deps.conversations?.resolve(row.id);
      log("resume — unimplemented kind", { from: msg.from, id: row.id, kind: row.kind });
      await deps.sendText(msg.from, REPHRASE_HE);
      return;
  }
}
