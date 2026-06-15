import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { processInbound } from "../../src/core/handler.ts";
import { createEventStore } from "../../src/db/event-store.ts";
import { createInboundStore } from "../../src/db/inbound-store.ts";
import { createServer } from "../../src/http/server.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";
import type { ParseMessage } from "../../src/parsing/parser.ts";

/**
 * Integration harness: the REAL stores (in-memory SQLite), the REAL processInbound + handler, and
 * the REAL Hono server, wired exactly like index.ts — only the Claude parser is stubbed and
 * sendText is recorded (so there's still no live network). This exercises the Phase 3 wiring the
 * unit tests mock away: persist-before-ack → queue → multi-event save under seq → confirm →
 * GET /events → ביטול undo → dedup → boot-replay.
 */

const allowlist = ["972501234567"];

const evA: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: "אבא",
  recurrence: null,
  source_text: "single",
};
const evB: ParsedEvent = {
  ...evA,
  title_he: "טיול שנתי",
  date_iso: "2026-06-25",
  time: null,
  assignee: null,
};
const evC: ParsedEvent = {
  ...evA,
  title_he: "חוג כדורגל",
  date_iso: "2026-06-23",
  time: "16:30",
  recurrence: { freq: "weekly", weekday: 2 },
};

// Stub parser: "multi" → two events, "replay" → one, otherwise → one. Keyed on the message text.
const parse: ParseMessage = async (text: string) => (text.includes("multi") ? [evB, evC] : [evA]);

function makeSystem() {
  const events = createEventStore(":memory:");
  const inbound = createInboundStore(":memory:");
  const sent: Array<{ to: string; body: string }> = [];
  const sendText = async (to: string, body: string) => {
    sent.push({ to, body });
  };
  const runInbound = (msg: InboundMessage): Promise<void> =>
    processInbound(msg, {
      allowlist,
      parse,
      events,
      sendText,
      inbound,
      now: () => new Date("2026-06-20T09:00:00Z"),
    });
  const app = createServer({
    verifyToken: "verify",
    inbound,
    process: runInbound,
    events,
    readToken: "read-secret",
  });
  return { app, events, inbound, sent, runInbound };
}

function webhook(id: string, text: string, from = "972501234567"): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {},
              messages: [{ from, id, timestamp: "1", type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

function post(app: ReturnType<typeof makeSystem>["app"], body: string) {
  return app.request("/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("integration: webhook → queue → store → confirm → read → undo", () => {
  it("runs the full Phase 3 flow against real stores", async () => {
    const sys = makeSystem();

    // 1) A single-event forward → one row, Hebrew confirm with the assignee.
    expect((await post(sys.app, webhook("wamid.1", "single"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.events.listEvents()).toHaveLength(1));
    expect(sys.sent.at(-1)?.body).toContain("אסיפת הורים");
    expect(sys.sent.at(-1)?.body).toContain("אבא"); // assignee surfaced

    // 2) A multi-event forward → two more rows under distinct seq, "2 פריטים" summary.
    expect((await post(sys.app, webhook("wamid.multi", "multi"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.events.listEvents()).toHaveLength(3));
    expect(sys.sent.at(-1)?.body).toContain("2");
    expect(sys.sent.at(-1)?.body).toContain("חוג כדורגל");

    // 3) GET /events returns the board, token-gated, date-ordered, full shape.
    const unauth = await sys.app.request("/events");
    expect(unauth.status).toBe(401);
    const res = await sys.app.request("/events", {
      headers: { Authorization: "Bearer read-secret" },
    });
    expect(res.status).toBe(200);
    const board = (await res.json()) as { events: ParsedEvent[] };
    expect(board.events).toHaveLength(3);
    expect(board.events.map((e) => e.date_iso)).toEqual(["2026-06-21", "2026-06-23", "2026-06-25"]);
    expect(board.events[1]?.recurrence).toEqual({ freq: "weekly", weekday: 2 });

    // 4) ביטול removes the LAST message's events (the multi-event pair) → back to one.
    expect((await post(sys.app, webhook("wamid.cancel", "ביטול"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.events.listEvents()).toHaveLength(1));
    expect(sys.sent.at(-1)?.body).toMatch(/בוטל/);

    // 5) A duplicate delivery of wamid.1 is de-duped at the queue → no extra row.
    await post(sys.app, webhook("wamid.1", "single"));
    await new Promise((r) => setTimeout(r, 20));
    expect(sys.events.listEvents()).toHaveLength(1);
  });

  it("boot-replays a pending inbound (crash-window recovery)", async () => {
    const sys = makeSystem();
    // Persist an inbound but never process it — the ack-then-crash window.
    sys.inbound.enqueue({ id: "wamid.replay", from: "972501234567", type: "text", text: "replay" });
    expect(sys.inbound.pending()).toHaveLength(1);

    // Boot-replay (what index.ts does on startup).
    for (const msg of sys.inbound.pending()) await sys.runInbound(msg);

    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.inbound.pending()).toHaveLength(0); // settled
  });
});
