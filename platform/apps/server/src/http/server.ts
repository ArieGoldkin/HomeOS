import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { EventStore } from "../db/event-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
import { extractMessages, type InboundMessage, verifyChallenge } from "./webhook.ts";

export interface ServerDeps {
  verifyToken: string;
  /** Durable inbound queue — dedupe + crash-safety live here, not in memory. */
  inbound: InboundStore;
  /** Persist-then-process one inbound (handler + queue settle). Injected so the server stays thin. */
  process: (msg: InboundMessage) => Promise<void>;
  /** Read model for GET /events (the dashboard/kiosk seam). */
  events: EventStore;
  /** Bearer token gating GET /events. When undefined the endpoint is disabled (503). */
  readToken?: string;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Constant-time bearer check (avoids leaking the token via timing). */
function bearerMatches(header: string | undefined, token: string): boolean {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
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

  // The read seam the dashboard + kitchen-tablet kiosk consume. Token-gated; the events are
  // returned in the shared SavedEvent[] shape (incl. assignee/recurrence), ordered by date.
  app.get("/events", (c) => {
    if (deps.readToken === undefined) return c.text("Read API disabled", 503);
    if (!bearerMatches(c.req.header("authorization"), deps.readToken)) {
      return c.text("Unauthorized", 401);
    }
    const events = [...deps.events.listEvents()].sort(
      (a, b) => a.date_iso.localeCompare(b.date_iso) || (a.time ?? "").localeCompare(b.time ?? ""),
    );
    return c.json({ events });
  });

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
