import { Hono } from "hono";
import type { InboundStore } from "../db/inbound-store.ts";
import { extractMessages, verifyChallenge, type InboundMessage } from "./webhook.ts";

export interface ServerDeps {
  verifyToken: string;
  /** Durable inbound queue — dedupe + crash-safety live here, not in memory. */
  inbound: InboundStore;
  /** Persist-then-process one inbound (handler + queue settle). Injected so the server stays thin. */
  process: (msg: InboundMessage) => Promise<void>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * The HomeOS WhatsApp webhook service. Routes:
 *   GET  /health   — liveness
 *   GET  /webhook  — Meta verification handshake (echo hub.challenge)
 *   POST /webhook  — inbound messages: ⚡ persist + dedupe, ack 200, then process async
 */
export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? (() => {});

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/webhook", (c) => {
    const challenge = verifyChallenge(c.req.query(), deps.verifyToken);
    if (challenge === null) return c.text("Forbidden", 403);
    return c.text(challenge, 200);
  });

  app.post("/webhook", async (c) => {
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = null; // malformed body → no messages, still ack 200 (Meta retries non-200)
    }

    // ⚡ Persist-before-ack: each message is durably queued (and de-duped on wa_message_id)
    // BEFORE the 200, then processed off the ack path. A crash after the ack is recovered by
    // boot-replaying `pending` rows — Meta only retries non-2xx, so the queue is our safety net.
    for (const msg of extractMessages(body)) {
      if (!deps.inbound.enqueue(msg)) {
        log("skipped duplicate message", { id: msg.id });
        continue;
      }
      void deps.process(msg).catch((err: unknown) => {
        log("process failed", { id: msg.id, error: String(err) });
      });
    }

    return c.text("OK", 200);
  });

  return app;
}
