import { describe, expect, it, vi } from "vitest";
import { createWhatsAppClient } from "../../src/whatsapp/client.ts";

const config = { whatsappToken: "TOKEN", phoneNumberId: "PNID", graphVersion: "v21.0" };

describe("createWhatsAppClient.sendText", () => {
  it("POSTs a text message to the Graph API with auth + correct body", async () => {
    const fetchMock = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(
          new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 }),
        ),
    );
    const client = createWhatsAppClient(config, fetchMock as unknown as typeof fetch);

    await client.sendText("972501234567", "hi");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/PNID/messages");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TOKEN");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972501234567",
      type: "text",
      text: { body: "hi" },
    });
  });

  it("throws immediately on a permanent 4xx (no retry)", async () => {
    const fetchMock = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(new Response("bad", { status: 400, statusText: "Bad Request" })),
    );
    const client = createWhatsAppClient(config, fetchMock as unknown as typeof fetch, {
      sleep: () => Promise.resolve(),
    });

    await expect(client.sendText("x", "y")).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 4xx is permanent — not retried
  });

  it("retries a transient 5xx and succeeds on a later attempt", async () => {
    let n = 0;
    const fetchMock = vi.fn(
      (_i: string | URL | Request, _init?: RequestInit): Promise<Response> => {
        n += 1;
        return Promise.resolve(
          n < 3
            ? new Response("oops", { status: 503, statusText: "Service Unavailable" })
            : new Response("{}", { status: 200 }),
        );
      },
    );
    const client = createWhatsAppClient(config, fetchMock as unknown as typeof fetch, {
      sleep: () => Promise.resolve(),
    });

    await expect(client.sendText("x", "y")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3); // 503, 503, 200
  });

  it("gives up after exhausting retries on a persistent 5xx", async () => {
    const fetchMock = vi.fn(
      (_i: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(new Response("down", { status: 500, statusText: "Server Error" })),
    );
    const client = createWhatsAppClient(config, fetchMock as unknown as typeof fetch, {
      retries: 2,
      sleep: () => Promise.resolve(),
    });

    await expect(client.sendText("x", "y")).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries a network error then rethrows if it persists", async () => {
    const fetchMock = vi.fn((): Promise<Response> => Promise.reject(new Error("ECONNRESET")));
    const client = createWhatsAppClient(config, fetchMock as unknown as typeof fetch, {
      retries: 1,
      sleep: () => Promise.resolve(),
    });

    await expect(client.sendText("x", "y")).rejects.toThrow(/ECONNRESET/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
