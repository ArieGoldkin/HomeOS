import { Hono } from "hono";
import { handleInbound } from "../core/handler.ts";
import type { HandlerDeps } from "../core/handler.ts";
import { extractMessages, verifyChallenge } from "./webhook.ts";

export interface ServerDeps {
  verifyToken: string;
  handler: HandlerDeps;
}

/**
 * The HomeOS WhatsApp webhook service. Routes:
 *   GET  /health   — liveness
 *   GET  /webhook  — Meta verification handshake (echo hub.challenge)
 *   POST /webhook  — inbound messages: ⚡ ack 200 first, then process async
 */
export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();
  const log = deps.handler.log ?? (() => {});

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

    // ⚡ Ack-then-process: kick off handling without awaiting, so the 200 returns
    // immediately. In M2 this is what keeps Whisper+Claude (seconds) off the ack path.
    for (const msg of extractMessages(body)) {
      void handleInbound(msg, deps.handler).catch((err: unknown) => {
        log("handleInbound failed", { id: msg.id, error: String(err) });
      });
    }

    return c.text("OK", 200);
  });

  return app;
}
