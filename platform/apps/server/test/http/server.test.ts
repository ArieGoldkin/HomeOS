import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ServerDeps } from "../../src/http/server.ts";
import { createServer } from "../../src/http/server.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";

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
  },
];

function makeApp(opts: { readToken?: string; appSecret?: string } = { readToken: "read-secret" }) {
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
    statsSince: vi.fn(() => ({ done: 0, failed: 0, pending: 0 })),
  };
  const events = {
    saveEvent: vi.fn(),
    listEvents: vi.fn(() => sampleEvents),
    deleteLastFromSender: vi.fn(() => 0),
    countSince: vi.fn(() => 0),
  };
  const deps: ServerDeps = {
    verifyToken: "secret",
    inbound,
    process,
    events,
    readToken: opts.readToken,
    appSecret: opts.appSecret,
  };
  return { app: createServer(deps), process, inbound, events };
}

function post(
  app: ReturnType<typeof makeApp>["app"],
  body: string,
  extraHeaders: Record<string, string> = {},
) {
  return app.request("/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body,
  });
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

describe("POST /webhook signature (HMAC, item H)", () => {
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

  it("skips verification when no app secret is set (test number)", async () => {
    const { app, inbound } = makeApp({ appSecret: undefined });
    const res = await post(app, payload); // unsigned
    expect(res.status).toBe(200);
    expect(inbound.enqueue).toHaveBeenCalledTimes(1);
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

describe("GET /health", () => {
  it("reports ok", async () => {
    const { app } = makeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
