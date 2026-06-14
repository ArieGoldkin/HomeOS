import { describe, it, expect, vi } from "vitest";
import { createServer } from "../src/server.ts";
import type { ServerDeps } from "../src/server.ts";

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
              { from: "972501234567", id: "wamid.1", timestamp: "1", type: "text", text: { body: "שלום" } },
            ],
          },
        },
      ],
    },
  ],
};

function makeApp() {
  const sendText = vi.fn(async () => {});
  const store = { seen: vi.fn(() => false) };
  const deps: ServerDeps = {
    verifyToken: "secret",
    handler: { allowlist: ["972501234567"], store, sendText },
  };
  return { app: createServer(deps), sendText };
}

function post(app: ReturnType<typeof makeApp>["app"], body: string) {
  return app.request("/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
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
  it("acks 200 immediately and then echoes asynchronously", async () => {
    const { app, sendText } = makeApp();
    const res = await post(app, JSON.stringify(textPayload));
    expect(res.status).toBe(200); // ⚡ ack first, regardless of processing
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledWith("972501234567", "שלום"));
  });

  it("acks 200 for a status-only webhook (no messages)", async () => {
    const { app, sendText } = makeApp();
    const res = await post(app, JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
    expect(res.status).toBe(200);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("acks 200 even on a malformed JSON body", async () => {
    const { app } = makeApp();
    const res = await post(app, "{not json");
    expect(res.status).toBe(200);
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
