import { createHmac } from "node:crypto";
import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { type CallModel, createAgent } from "../../src/core/agent.ts";
import { processInbound } from "../../src/core/handler/index.ts";
import { createEventStore } from "../../src/db/event-store.ts";
import { createInboundStore } from "../../src/db/inbound-store.ts";
import { createServer } from "../../src/http/server.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";
import type { ParseMessage } from "../../src/parsing/parser.ts";
import { extractEventsTool, type GmailToolDeps, readGmailTool } from "../../src/tools/tools.ts";

// Webhook HMAC is mandatory; integration posts are signed with this test key (named "key" to avoid
// the repo's secret scanner). The same key is wired into createServer below.
const appKey = "homeos-webhook-test-key";

/**
 * Integration harness: the REAL stores (in-memory SQLite), the REAL agent loop + processInbound +
 * handler, and the REAL Hono server, wired exactly like index.ts — only the two Claude surfaces are
 * stubbed (the agent's `callModel` loop AND the extractor's `parse`) and sendText is recorded, so
 * there's no live network. Exercises the Phase 3 + agent wiring the unit tests mock away:
 * persist-before-ack → queue → agent → multi-event save under seq → confirm → GET /events → ביטול
 * undo → dedup → boot-replay → seq-stability.
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

// Stub extractor: "multi" → two events, otherwise → one. Keyed on the message text.
const parse: ParseMessage = async (text: string) => (text.includes("multi") ? [evB, evC] : [evA]);

/**
 * Stub the agent's model loop: turn 0 emits a tool_use for extract_events with the forwarded text;
 * once a tool_result comes back, end_turn. The extractor's own Claude call is stubbed by `parse`.
 */
const callModel: CallModel = async (req) => {
  const last = req.messages.at(-1);
  if (
    Array.isArray(last?.content) &&
    (last.content[0] as { type?: string })?.type === "tool_result"
  ) {
    return { stop_reason: "end_turn", content: [] };
  }
  // Honour turn-0 forced tool: the sync intent forces read_gmail.
  const forced = req.tool_choice.type === "tool" ? req.tool_choice.name : "extract_events";
  if (forced === "read_gmail") {
    return {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_gmail", name: "read_gmail", input: {} }],
    };
  }
  const wrapped = typeof req.messages[0]?.content === "string" ? req.messages[0].content : "";
  const text = wrapped
    .replace(/^Forwarded message to process:\n<forwarded>\n/, "")
    .replace(/\n<\/forwarded>$/, "");
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "tu_int", name: "extract_events", input: { text } }],
  };
};

function makeSystem(
  parseImpl: ParseMessage = parse,
  members: Record<string, string> = {},
  google?: GmailToolDeps,
) {
  const events = createEventStore(":memory:");
  const inbound = createInboundStore(":memory:");
  const sent: Array<{ to: string; body: string }> = [];
  const sendText = async (to: string, body: string) => {
    sent.push({ to, body });
  };
  const agent = createAgent({
    callModel,
    tools: google
      ? [extractEventsTool(parseImpl), readGmailTool(parseImpl)]
      : [extractEventsTool(parseImpl)],
  });
  const runInbound = (msg: InboundMessage): Promise<void> =>
    processInbound(msg, {
      allowlist,
      agent,
      events,
      sendText,
      inbound,
      members,
      google,
      now: () => new Date("2026-06-20T09:00:00Z"),
    });
  const app = createServer({
    verifyToken: "verify",
    inbound,
    process: runInbound,
    events,
    readToken: "read-secret",
    appSecret: appKey,
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
  const signature = `sha256=${createHmac("sha256", appKey).update(body, "utf8").digest("hex")}`;
  return app.request("/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body,
  });
}

describe("integration: webhook → queue → store → confirm → read → undo", () => {
  it("runs the full Phase 3 flow against real stores", async () => {
    const sys = makeSystem();

    // 1) A single-event forward → one row, Hebrew confirm with the assignee.
    // #71: the tool persists DURING the agent loop (before the final model turn + confirm), so wait
    // on the confirm — the true LAST side-effect — not on the row, to avoid racing the send.
    expect((await post(sys.app, webhook("wamid.1", "single"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(1));
    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.sent.at(-1)?.body).toContain("אסיפת הורים");
    expect(sys.sent.at(-1)?.body).toContain("אבא"); // assignee surfaced

    // 2) A multi-event forward → two more rows under distinct seq, "2 פריטים" summary.
    expect((await post(sys.app, webhook("wamid.multi", "multi"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(2));
    expect(sys.events.listEvents()).toHaveLength(3);
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
    await vi.waitFor(() => expect(sys.sent).toHaveLength(3));
    expect(sys.events.listEvents()).toHaveLength(1);
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

  it("re-running the same wa_message_id with a reordered extraction adds NO duplicate rows (G-seq)", async () => {
    // A boot-replay (or Meta retry) re-extracts; a non-deterministic model could return the same
    // events in a DIFFERENT order. saveEvent dedups on (wa_message_id, seq), so the row count must
    // stay stable — the single-extraction invariant + composite key guard against duplicates.
    let call = 0;
    const flip: ParseMessage = async () => (call++ === 0 ? [evB, evC] : [evC, evB]);
    const sys = makeSystem(flip);
    const msg: InboundMessage = {
      id: "wamid.seq",
      from: "972501234567",
      type: "text",
      text: "two",
    };

    await sys.runInbound(msg);
    expect(sys.events.listEvents()).toHaveLength(2);

    await sys.runInbound(msg); // replay — extraction returns the reversed order this time
    expect(sys.events.listEvents()).toHaveLength(2); // no duplicate rows
  });

  it("a direct first-person command resolves the assignee to the sender (#14)", async () => {
    // Extractor stub that mirrors the prompt nuance: first-person → assignee = the server-supplied
    // sender name (which threads handler → agent → extract_events → parse via ToolContext).
    const directParse: ParseMessage = async (_text, _today, senderName) => [
      { ...evA, title_he: "פיזיותרפיה", assignee: senderName ?? null },
    ];
    const sys = makeSystem(directParse, { "972501234567": "אבא" });

    await sys.runInbound({
      id: "wamid.cmd",
      from: "972501234567",
      type: "text",
      text: "יש לי פיזיותרפיה מחר, תכניס ליומן",
    });

    expect(sys.events.listEvents()[0]?.assignee).toBe("אבא");
  });

  it("syncs Gmail on 'סנכרן מייל' → board rows tagged google, idempotent on re-run, purgeable (#72)", async () => {
    const emails = [
      { id: "g1", subject: "אסיפת הורים", bodyText: "מחר ב-18:30" },
      { id: "g2", subject: "חוג כדורגל", bodyText: "ביום שלישי" },
    ];
    const gmail = {
      client: {
        list: async () => emails.map((m) => ({ id: m.id, threadId: "t" })),
        get: async (_t: string, id: string) => emails.find((m) => m.id === id),
      },
      oauthClient: {
        exchangeCode: async () => ({}),
        refresh: async () => ({}),
        revoke: async () => {},
      },
      credentials: {
        get: () => ({
          accessToken: "acc",
          refreshToken: "ref",
          expiry: "2099-01-01 00:00:00",
          scopes: [],
        }),
        updateTokens: () => {},
        delete: () => {},
      },
      maxMessages: 10,
      queryWindow: "newer_than:7d",
      allowedLabels: [],
    } as unknown as GmailToolDeps;
    const sys = makeSystem(parse, {}, gmail);

    // First sync → two rows (one per email), both tagged source_provider="google".
    expect((await post(sys.app, webhook("wamid.s1", "סנכרן מייל"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(1));
    const rows = sys.events.listEvents();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source_provider === "google")).toBe(true);
    expect(sys.sent.at(-1)?.body).toContain("הוספתי");

    // Re-sync (same gmail ids) → idempotent on gmail:<id>: still two rows (AC4).
    expect((await post(sys.app, webhook("wamid.s2", "סנכרן מייל"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(2));
    expect(sys.events.listEvents()).toHaveLength(2);

    // Disconnect purge — the #61 seam, now activated by the google tag.
    expect(sys.events.deleteByProvider("google")).toBe(2);
    expect(sys.events.listEvents()).toHaveLength(0);
  });
});
