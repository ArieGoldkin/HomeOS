import type { InboundMessage } from "../../http/webhook.ts";
import type { ToolContext } from "../../tools/tools.ts";
import type { AgentResult } from "../agent.ts";
import { TransientError } from "../errors.ts";
import {
  formatConfirm,
  type HandlerDeps,
  SYNC_FAILED_HE,
  savedOf,
  TRANSIENT_HE,
} from "./shared/index.ts";

/**
 * Shared provider-sync run (Gmail #72 / Calendar #18): force the given tool on an agent run (turn 0,
 * G4), then confirm the saved rows, reply "nothing new", or — on error — tell the user (transient →
 * "try again", permanent → "failed") and rethrow so the inbound row settles correctly (pending vs
 * failed). The provider seam (`google`/`calendar`) is already wired into `ctx` — the G8 capability gate.
 */
export async function runSyncIntent(
  deps: HandlerDeps,
  msg: InboundMessage,
  intent: string,
  forceTool: string,
  noneReply: string,
  ctx: ToolContext,
): Promise<void> {
  const log = deps.log ?? (() => {});
  let result: AgentResult;
  try {
    result = await deps.agent.run(intent, ctx, { forceTool });
  } catch (err) {
    if (err instanceof TransientError) {
      // A provider blip (429/5xx/network) → "try again" and rethrow so the row stays pending for replay.
      log("transient provider sync", { id: msg.id, tool: forceTool });
      await deps.sendText(msg.from, TRANSIENT_HE);
    } else {
      // A permanent failure (e.g. a 4xx on a token rejected mid-run) — acknowledge the user's explicit
      // command instead of leaving them in silence, then rethrow so the row settles as failed (G10).
      log("provider sync failed (permanent)", { id: msg.id, tool: forceTool, error: String(err) });
      await deps.sendText(msg.from, SYNC_FAILED_HE);
    }
    throw err;
  }
  // The sync tools (read_gmail/read_calendar) only ever return saved rows — never a clarify; narrow
  // defensively so a clarify (which the gate can't produce here) degrades to "nothing new", not a throw.
  const synced = savedOf(result);
  if (!synced || synced.length === 0) {
    await deps.sendText(msg.from, noneReply);
    return;
  }
  log("synced provider events", { from: msg.from, tool: forceTool, count: synced.length });
  await deps.sendText(msg.from, formatConfirm(synced));
}
