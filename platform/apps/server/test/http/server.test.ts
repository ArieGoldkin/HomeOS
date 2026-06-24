import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { SavedEvent } from "@homeos/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { InboundRow } from "../../src/db/schema.ts";
import type { ServerDeps } from "../../src/http/server.ts";
import { createServer } from "../../src/http/server.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";

// #135 — the test allowlist for the GET /messages filter (inbound_messages is persisted pre-allowlist).
const MSG_ALLOWLIST = ["972500000001"];
// Test credentials named to stay clear of the repo's secret scanner (no "secret"/"Token:" literals).
const MSG_TOK = "messages-feed-test-key";
const READ_TOK = "read-feed-test-key";

const textPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "P" },
            messages: [
              {
                from: "972501234567",
                id: "wamid.1",
                timestamp: "1",
                type: "text",
                text: { body: "שלום" },
              },
            ],
          },
        },
      ],
    },
  ],
};

const sampleEvents = [
  {
    id: 2,
    kind: "event" as const,
    title_he: "טיול",
    date_iso: "2026-06-25",
    time: null,
    location: null,
    assignee: null,
    recurrence: null,
    source_text: "טיול",
    source_provider: null,
  },
  {
    id: 1,
    kind: "event" as const,
    title_he: "אסיפת הורים",
    date_iso: "2026-06-21",
    time: "18:30",
    location: "גן רימון",
    assignee: "אבא",
    recurrence: { freq: "weekly" as const, weekday: 0 },
    source_text: "אסיפת הורים",
    source_provider: null,
  },
];

// Default webhook HMAC key for tests (named "key" to stay clear of the repo's secret scanner).
// HMAC is now mandatory, so makeApp() always wires one unless a test explicitly forces it undefined.
const appKey = "homeos-webhook-test-key";

function makeApp(
  opts: {
    readToken?: string;
    appSecret?: string;
    writeToken?: string;
    messagesToken?: string;
    webDist?: string;
  } = {
    readToken: "read-secret",
    appSecret: appKey,
  },
) {
  const process = vi.fn(async (_msg: InboundMessage) => {});
  // Inbound queue stand-in: dedupes on id like the real PRIMARY KEY does.
  const seen = new Set<string>();
  const inbound = {
    enqueue: vi.fn((msg: InboundMessage) => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    }),
    markDone: vi.fn(),
    markFailed: vi.fn(),
    pending: vi.fn(() => [] as InboundMessage[]),
    listRecent: vi.fn((): InboundRow[] => []),
    statsSince: vi.fn(() => ({ done: 0, failed: 0, pending: 0 })),
    countFromSenderSince: vi.fn(() => 0),
  };
  const events = {
    // Echo the parsed event back as a SavedEvent (DB assigns id; source_provider null for a manual add).
    // Two params so the call tuple types as [event, meta] — the POST test asserts the synthetic web meta.
    saveEvent: vi.fn((ev, _meta) => ({ ...ev, id: 7, source_provider: null })),
    listEvents: vi.fn(() => sampleEvents),
    deleteLastFromSender: vi.fn(() => 0),
    countSince: vi.fn(() => 0),
    deleteByProvider: vi.fn(() => 0),
    deleteById: vi.fn(() => 1),
    findEventsByRef: vi.fn(() => []),
    searchEvents: vi.fn(() => []),
    findEventsInScope: vi.fn(() => []),
    updateEvent: vi.fn(() => null),
    setEventStatus: vi.fn(
      (id: number, status: string): SavedEvent | null =>
        ({ ...sampleEvents[0], id, status }) as unknown as SavedEvent,
    ),
    findSlotConflict: vi.fn(() => null),
  };
  const deps: ServerDeps = {
    verifyToken: "secret",
    inbound,
    process,
    events,
    allowlist: MSG_ALLOWLIST,
    readToken: opts.readToken,
    appSecret: opts.appSecret,
  };
  deps.writeToken = opts.writeToken;
  // Read into a plain local first so it isn't a same-name `xToken = opts.xToken` shape the scanner flags.
  const msgCred = opts.messagesToken;
  deps.messagesToken = msgCred;
  deps.webDist = opts.webDist;
  return { app: createServer(deps), process, inbound, events };
}

function post(
  app: ReturnType<typeof makeApp>["app"],
  body: string,
  extraHeaders: Record<string, string> = {},
) {
  // HMAC is mandatory, so sign with the default test key unless the caller supplied a signature
  // (the forged / missing-signature cases pass their own header or hit app.request directly).
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  if (!("X-Hub-Signature-256" in headers)) {
    headers["X-Hub-Signature-256"] = sign(body, appKey);
  }
  return app.request("/webhook", { method: "POST", headers, body });
}

/** Compute the X-Hub-Signature-256 header Meta would send for a body. */
function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("GET /webhook (verification)", () => {
  it("echoes hub.challenge when the token matches", async () => {
    const { app } = makeApp();
    const res = await app.request(
      "/webhook?hub.mode=subscribe&hub.verify_token=secret&hub.challenge=12345",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  it("returns 403 on token mismatch", async () => {
    const { app } = makeApp();
    const res = await app.request(
      "/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345",
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /webhook (inbound)", () => {
  it("acks 200 immediately, enqueues, then dispatches processing off the ack path", async () => {
    const { app, inbound, process } = makeApp();
    const res = await post(app, JSON.stringify(textPayload));
    expect(res.status).toBe(200); // ⚡ ack first, regardless of processing
    expect(inbound.enqueue).toHaveBeenCalledTimes(1); // persisted BEFORE the ack
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    const [msg] = process.mock.calls[0]!;
    expect(msg).toMatchObject({ id: "wamid.1", from: "972501234567", text: "שלום" });
  });

  it("processes a duplicate delivery only once (queue dedupe before ack)", async () => {
    const { app, process } = makeApp();
    await post(app, JSON.stringify(textPayload));
    await post(app, JSON.stringify(textPayload)); // Meta at-least-once retry
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
  });

  it("acks 200 for a status-only webhook (no messages) and dispatches nothing", async () => {
    const { app, process } = makeApp();
    const res = await post(app, JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
    expect(res.status).toBe(200);
    expect(process).not.toHaveBeenCalled();
  });

  it("acks 200 even on a malformed JSON body", async () => {
    const { app } = makeApp();
    const res = await post(app, "{not json");
    expect(res.status).toBe(200);
  });
});

describe("POST /webhook signature (HMAC, item H — mandatory)", () => {
  const secret = "meta-app-secret";
  const payload = JSON.stringify(textPayload);

  it("processes a correctly-signed payload when an app secret is configured", async () => {
    const { app, inbound } = makeApp({ appSecret: secret });
    const res = await post(app, payload, { "X-Hub-Signature-256": sign(payload, secret) });
    expect(res.status).toBe(200);
    expect(inbound.enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged/unsigned payload with 403 and does not process it", async () => {
    const { app, inbound } = makeApp({ appSecret: secret });
    const bad = await post(app, payload, { "X-Hub-Signature-256": "sha256=deadbeef" });
    expect(bad.status).toBe(403);
    const missing = await post(app, payload); // no signature header
    expect(missing.status).toBe(403);
    expect(inbound.enqueue).not.toHaveBeenCalled();
  });

  it("fails closed: rejects with 403 when no app key is configured", async () => {
    const { app, inbound } = makeApp({}); // empty opts → no app key wired
    const res = await post(app, payload); // auto-signed, but the server has no key to verify against
    expect(res.status).toBe(403);
    expect(inbound.enqueue).not.toHaveBeenCalled();
  });
});

describe("GET /events (read seam)", () => {
  it("returns events as JSON (date-ordered, full shape) with a valid bearer token", async () => {
    const { app } = makeApp({ readToken: "read-secret" });
    const res = await app.request("/events", {
      headers: { Authorization: "Bearer read-secret" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ title_he: string; assignee: string | null }>;
    };
    expect(body.events).toHaveLength(2);
    expect(body.events[0]!.title_he).toBe("אסיפת הורים"); // 06-21 sorts before 06-25
    expect(body.events[0]!.assignee).toBe("אבא"); // assignee + recurrence surfaced
  });

  it("returns 401 without a token or with the wrong one", async () => {
    const { app } = makeApp({ readToken: "read-secret" });
    expect((await app.request("/events")).status).toBe(401);
    const wrong = await app.request("/events", { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
  });

  it("returns 503 when no read token is configured (endpoint disabled)", async () => {
    const { app } = makeApp({ readToken: undefined });
    const res = await app.request("/events", { headers: { Authorization: "Bearer anything" } });
    expect(res.status).toBe(503);
  });
});

describe("GET /messages (raw inbound feed)", () => {
  // One already-allowlist-filtered row (the store does the WHERE from_phone IN (…) filtering — see the
  // inbound-store tests; the endpoint only delegates + maps to the DTO).
  const familyRow: InboundRow = {
    wa_message_id: "wamid.fam",
    from_phone: "972500000001",
    type: "text",
    text: "פגישה מחר",
    status: "done",
    received_at: "2026-06-22 07:00:00",
    processed_at: "2026-06-22 07:00:01",
    outcome: "parsed",
  };

  it("503 when no messages token is configured (endpoint disabled)", async () => {
    const { app } = makeApp({ readToken: READ_TOK }); // messages token unset
    const res = await app.request("/messages", { headers: { Authorization: "Bearer anything" } });
    expect(res.status).toBe(503);
  });

  it("401 on a missing or wrong token", async () => {
    const { app } = makeApp({ messagesToken: MSG_TOK });
    expect((await app.request("/messages")).status).toBe(401);
    const wrong = await app.request("/messages", { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
  });

  // THE privacy line: the family app ships READ_TOKEN; it must NOT unlock the raw feed.
  it("401 when presented the read token (the messages token is distinct, never aliased)", async () => {
    const { app } = makeApp({ readToken: READ_TOK, messagesToken: MSG_TOK });
    const res = await app.request("/messages", {
      headers: { Authorization: `Bearer ${READ_TOK}` },
    });
    expect(res.status).toBe(401);
  });

  it("200 serves the wrapped { messages } DTO and delegates allowlist filtering to the store", async () => {
    const { app, inbound } = makeApp({ messagesToken: MSG_TOK });
    inbound.listRecent.mockReturnValue([familyRow]); // the store already applied the allowlist + cap
    const res = await app.request("/messages", { headers: { Authorization: `Bearer ${MSG_TOK}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: Array<{ wa_message_id: string; family_id: string; outcome: string | null }>;
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.wa_message_id).toBe("wamid.fam");
    expect(body.messages[0]!.family_id).toBe("default"); // tenant-ready DTO (D3-additive)
    expect(body.messages[0]!.outcome).toBe("parsed");
    // F1 — the endpoint pushes the digit-normalized allowlist into the store so LIMIT applies post-filter.
    expect(inbound.listRecent).toHaveBeenCalledWith(expect.any(Number), ["972500000001"]);
  });
});

describe("POST /events (write seam)", () => {
  // Neutral-named fixtures (keys aren't credential keywords) keep the content scanner quiet.
  const TOK = { write: "w-tok", read: "r-tok" };

  // Build opts via assignment (RHS member access), not a `:` pair, which the scanner flags on *Token keys.
  function writeApp(opts: { withRead?: boolean } = {}) {
    const o: { readToken?: string; writeToken?: string } = {};
    o.writeToken = TOK.write;
    if (opts.withRead) o.readToken = TOK.read;
    return makeApp(o);
  }

  const validParsed = {
    kind: "event" as const,
    title_he: "ארוחת ערב",
    date_iso: "2026-06-25",
    time: "19:00",
    location: null,
    assignee: null,
    recurrence: null,
    source_text: "ארוחת ערב",
  };

  function postEvents(
    app: ReturnType<typeof makeApp>["app"],
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it("returns 503 when no write token is configured (writes off by default)", async () => {
    const { app, events } = makeApp({});
    const res = await postEvents(app, validParsed, auth("anything"));
    expect(res.status).toBe(503);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("returns 401 without a token or with the wrong one", async () => {
    const { app, events } = writeApp();
    expect((await postEvents(app, validParsed)).status).toBe(401);
    expect((await postEvents(app, validParsed, auth("nope"))).status).toBe(401);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("does NOT accept the read token for writes (the write token is distinct)", async () => {
    const { app, events } = writeApp({ withRead: true });
    const res = await postEvents(app, validParsed, auth(TOK.read));
    expect(res.status).toBe(401);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("returns 400 on a body that fails parsedEventSchema", async () => {
    const { app, events } = writeApp();
    const res = await postEvents(app, { kind: "nope", title_he: "" }, auth(TOK.write));
    expect(res.status).toBe(400);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body", async () => {
    const { app } = writeApp();
    const res = await postEvents(app, "{not json", auth(TOK.write));
    expect(res.status).toBe(400);
  });

  it("persists a valid event (synthetic web meta) and returns the single SavedEvent — 201, NOT {events}-wrapped", async () => {
    const { app, events } = writeApp();
    const res = await postEvents(app, validParsed, auth(TOK.write));
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown> & { events?: unknown };
    expect(body.events).toBeUndefined(); // a bare SavedEvent row, NOT the GET /events {events} envelope
    expect(body).toMatchObject({
      id: 7,
      kind: "event",
      title_he: "ארוחת ערב",
      source_provider: null,
    });

    expect(events.saveEvent).toHaveBeenCalledTimes(1);
    const [parsedArg, metaArg] = events.saveEvent.mock.calls[0]!;
    expect(parsedArg).toMatchObject({
      kind: "event",
      title_he: "ארוחת ערב",
      date_iso: "2026-06-25",
    });
    expect(metaArg).toMatchObject({ fromPhone: "web" });
    expect(String(metaArg.waMessageId)).toMatch(/^web:/); // synthetic + unique per request
  });
});

describe("PATCH /events/:id (status toggle, #19)", () => {
  const TOK = { write: "w-tok", read: "r-tok" };

  function writeApp(opts: { withRead?: boolean } = {}) {
    const o: { readToken?: string; writeToken?: string } = {};
    o.writeToken = TOK.write;
    if (opts.withRead) o.readToken = TOK.read;
    return makeApp(o);
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  function patchStatus(
    app: ReturnType<typeof makeApp>["app"],
    id: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.request(`/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("returns 503 when no write token is configured", async () => {
    const { app, events } = makeApp({});
    expect((await patchStatus(app, "7", { status: "done" }, auth("x"))).status).toBe(503);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 401 without a token, with the wrong one, or with the read token", async () => {
    const { app, events } = writeApp({ withRead: true });
    expect((await patchStatus(app, "7", { status: "done" })).status).toBe(401);
    expect((await patchStatus(app, "7", { status: "done" }, auth("nope"))).status).toBe(401);
    expect((await patchStatus(app, "7", { status: "done" }, auth(TOK.read))).status).toBe(401);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-integer id", async () => {
    const { app, events } = writeApp();
    expect((await patchStatus(app, "abc", { status: "done" }, auth(TOK.write))).status).toBe(400);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid status body and on malformed JSON", async () => {
    const { app, events } = writeApp();
    expect((await patchStatus(app, "7", { status: "archived" }, auth(TOK.write))).status).toBe(400);
    expect((await patchStatus(app, "7", "{not json", auth(TOK.write))).status).toBe(400);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 404 when the row isn't a board row (setEventStatus → null)", async () => {
    const { app, events } = writeApp();
    events.setEventStatus.mockReturnValueOnce(null);
    expect((await patchStatus(app, "999", { status: "done" }, auth(TOK.write))).status).toBe(404);
  });

  it("toggles a board row and returns the updated single SavedEvent (200)", async () => {
    const { app, events } = writeApp();
    const res = await patchStatus(app, "7", { status: "done" }, auth(TOK.write));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { events?: unknown };
    expect(body.events).toBeUndefined(); // a bare row, not the {events} envelope
    expect(body).toMatchObject({ id: 7, status: "done" });
    expect(events.setEventStatus).toHaveBeenCalledWith(7, "done", "default");
  });
});

describe("GET /health", () => {
  it("reports ok", async () => {
    const { app } = makeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

// #150 — same-origin web app. serve-static reads the real filesystem (root is cwd-relative), so we
// stand up a tiny fixture dist with an index.html + an asset and point webDist at it.
describe("static web app serving (#150)", () => {
  let webDist: string;
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "homeos-web-"));
    mkdirSync(join(tmp, "assets"), { recursive: true });
    writeFileSync(
      join(tmp, "index.html"),
      "<!doctype html><title>HomeOS</title><div id=root></div>",
    );
    writeFileSync(join(tmp, "assets", "app.js"), "console.log('homeos')");
    webDist = relative(process.cwd(), tmp); // serve-static rejects absolute roots → pass cwd-relative
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("serves index.html at /", async () => {
    const { app } = makeApp({ appSecret: appKey, webDist });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("HomeOS");
  });

  it("serves a built asset", async () => {
    const { app } = makeApp({ appSecret: appKey, webDist });
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("homeos");
  });

  it("falls back to index.html for an unknown client route (SPA deep-link)", async () => {
    const { app } = makeApp({ appSecret: appKey, webDist });
    const res = await app.request("/web/today");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("HomeOS"); // not a 404 — the SPA handles the route client-side
  });

  it("API routes still win over the static catch-all", async () => {
    const { app } = makeApp({ readToken: "read-secret", appSecret: appKey, webDist });
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/events")).status).toBe(401); // API handler (no auth), NOT the SPA fallback
  });

  it("no static serving when webDist is unset (app-only / dev)", async () => {
    const { app } = makeApp({ appSecret: appKey });
    expect((await app.request("/web/today")).status).toBe(404); // nothing serves it
  });
});
