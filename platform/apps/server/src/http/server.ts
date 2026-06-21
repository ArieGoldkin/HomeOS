import { randomUUID, timingSafeEqual } from "node:crypto";
import { parsedEventSchema } from "@homeos/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { EventStore } from "../db/event-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
import { type GoogleOAuthDeps, registerOAuthRoutes } from "./oauth-routes.ts";
import {
  extractMessages,
  type InboundMessage,
  verifyChallenge,
  verifySignature,
} from "./webhook.ts";

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
  /** Meta app secret. When set, POST /webhook enforces the X-Hub-Signature-256 HMAC; unset = skip (test number). */
  appSecret?: string;
  /** Google OAuth deps (#16). Undefined ⇒ the OAuth routes ship dark (503). */
  google?: GoogleOAuthDeps;
  /** Bearer token gating POST /events (the web/phone write seam). Undefined ⇒ disabled (503). A
   *  DISTINCT credential from the read token — never falls back to it (a read-only deploy can't mutate). */
  writeToken?: string;
  /** #150 — directory of the built web SPA (`apps/web/dist`), RELATIVE to the process cwd (the node
   *  serve-static driver rejects absolute roots). Undefined ⇒ no static serving (app-only / dev without a
   *  build / tests). When set, the SPA is served same-origin so the dashboard shares the API's origin. */
  webDist?: string;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Constant-time bearer check (avoids leaking the token via timing). Reused by the OAuth routes. */
export function bearerMatches(header: string | undefined, token: string): boolean {
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

  // 🔌 Issue #16: Google OAuth connect/callback/disconnect. Always mounted; returns 503 when
  // `google` is undefined (app-only deploys), exactly like the GET /events read seam.
  registerOAuthRoutes(app, deps.google);

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

  // The web/phone write seam backing the client createEvent contract. Gated by a DISTINCT write token
  // (never the read token) so the read-only kiosk can't mutate. A manual add has no WhatsApp message,
  // so synthesize a unique `web:<uuid>` key and reuse saveEvent verbatim (sourceProvider omitted →
  // source_provider null, calendar-pushable like a forward). Returns the SINGLE SavedEvent (bare row,
  // NOT {events}-wrapped) so the client's savedEventSchema.parse of one row succeeds.
  app.post("/events", async (c) => {
    if (deps.writeToken === undefined) return c.text("Write API disabled", 503);
    if (!bearerMatches(c.req.header("authorization"), deps.writeToken)) {
      return c.text("Unauthorized", 401);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.text("Invalid JSON", 400);
    }
    const parsed = parsedEventSchema.safeParse(body);
    if (!parsed.success) return c.text("Invalid event", 400);
    const saved = deps.events.saveEvent(parsed.data, {
      fromPhone: "web",
      waMessageId: `web:${randomUUID()}`,
    });
    return c.json(saved, 201);
  });

  app.get("/webhook", (c) => {
    const challenge = verifyChallenge(c.req.query(), deps.verifyToken);
    if (challenge === null) return c.text("Forbidden", 403);
    return c.text(challenge, 200);
  });

  app.post("/webhook", async (c) => {
    // Read the RAW body first — both for HMAC verification (must be the exact bytes Meta signed)
    // and to parse from the same string. c.req.json() would consume the body and re-serialize.
    const raw = await c.req.text();

    // 🔒 HMAC is MANDATORY: /webhook is a public, unauthenticated write surface, so a missing app key
    // OR a missing/forged X-Hub-Signature-256 is refused (403) BEFORE any persistence or processing —
    // fail closed, never silently accept unsigned (forgeable) inbound. Boot also refuses to start
    // without the key (see index.ts), so `appSecret === undefined` here is defence-in-depth.
    if (
      deps.appSecret === undefined ||
      !verifySignature(raw, c.req.header("x-hub-signature-256"), deps.appSecret)
    ) {
      log("rejected webhook: missing app key or invalid signature", {});
      return c.text("Forbidden", 403);
    }

    let body: unknown = null;
    try {
      body = JSON.parse(raw);
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

  // #150 — same-origin web app: serve the built SPA from `apps/web/dist`. Registered LAST so every API
  // route above wins (Hono runs handlers in registration order; the API routes respond without calling
  // next, so this middleware never shadows them). First mount serves real files (assets, /index.html);
  // serve-static calls next() on a miss, so the GET fallback then serves index.html for client-side
  // routes (/web/today, /phone/*, …) — standard SPA deep-link handling. Inert when `webDist` is unset.
  if (deps.webDist !== undefined) {
    const root = deps.webDist;
    app.use("/*", serveStatic({ root }));
    app.get("/*", serveStatic({ root, rewriteRequestPath: () => "/index.html" }));
  }

  return app;
}
