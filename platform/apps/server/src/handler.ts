import { isAllowed } from "./allowlist.ts";
import type { IdempotencyStore } from "./idempotency.ts";
import type { InboundMessage } from "./webhook.ts";
import type { SendText } from "./whatsapp.ts";

export interface HandlerDeps {
  allowlist: readonly string[];
  store: IdempotencyStore;
  sendText: SendText;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Polite Hebrew refusal for senders outside the family allowlist. */
const REFUSAL_HE = "מצטערים, אין לך הרשאה להשתמש בשירות הזה.";

/**
 * M1 inbound handling: dedupe → allowlist gate → echo.
 *
 * 🌱 M2 graft point: replace the echo line with `parse → persist event → Hebrew confirm`.
 * The dedupe and allowlist guardrails above stay exactly as-is.
 */
export async function handleInbound(msg: InboundMessage, deps: HandlerDeps): Promise<void> {
  const log = deps.log ?? (() => {});

  // ⚡ Dedupe first — Meta retries deliveries; act at most once per wa_message_id
  // (covers refusals too, so a stranger is never re-pinged on retry).
  if (deps.store.seen(msg.id)) {
    log("skipped duplicate message", { id: msg.id });
    return;
  }

  // 🔒 Allowlist gate — only family numbers are processed; others get a polite refusal.
  if (!isAllowed(msg.from, deps.allowlist)) {
    log("rejected non-allowlisted sender", { from: msg.from });
    await deps.sendText(msg.from, REFUSAL_HE);
    return;
  }

  // M1: echo the text back, proving receive→send end-to-end.
  await deps.sendText(msg.from, msg.text ?? "");
}
