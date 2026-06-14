import { describe, it, expect, vi } from "vitest";
import { createWhatsAppClient } from "../src/whatsapp.ts";

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

  it("throws when the Graph API responds non-2xx", async () => {
    const fetchMock = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(new Response("bad", { status: 400, statusText: "Bad Request" })),
    );
    const client = createWhatsAppClient(config, fetchMock as unknown as typeof fetch);

    await expect(client.sendText("x", "y")).rejects.toThrow(/400/);
  });
});
