import { describe, it, expect, vi } from "vitest";
import { handleInbound } from "../src/handler.ts";
import type { HandlerDeps } from "../src/handler.ts";
import type { InboundMessage } from "../src/webhook.ts";

const allowlist = ["972501234567"];

function makeDeps(seenReturn = false) {
  const sendText = vi.fn(async (_to: string, _body: string) => {});
  const store = { seen: vi.fn(() => seenReturn) };
  const deps: HandlerDeps = { allowlist, store, sendText };
  return { sendText, store, deps };
}

const msg: InboundMessage = { id: "wamid.1", from: "972501234567", type: "text", text: "שלום" };

describe("handleInbound", () => {
  it("echoes a text message from an allowlisted sender", async () => {
    const { sendText, deps } = makeDeps(false);
    await handleInbound(msg, deps);
    expect(sendText).toHaveBeenCalledWith("972501234567", "שלום");
  });

  it("refuses (in Hebrew) a non-allowlisted sender and does not echo", async () => {
    const { sendText, deps } = makeDeps(false);
    await handleInbound({ ...msg, from: "972509999999" }, deps);
    expect(sendText).toHaveBeenCalledTimes(1);
    const [to, body] = sendText.mock.calls[0]!;
    expect(to).toBe("972509999999");
    expect(body).not.toBe("שלום"); // not an echo
    expect(body).toMatch(/הרשאה|מצטער/); // a Hebrew refusal
  });

  it("skips duplicate deliveries (idempotent on wa_message_id)", async () => {
    const { sendText, deps } = makeDeps(true);
    await handleInbound(msg, deps);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("echoes empty string for a non-text message", async () => {
    const { sendText, deps } = makeDeps(false);
    const noText: InboundMessage = { id: "wamid.2", from: "972501234567", type: "image" };
    await handleInbound(noText, deps);
    expect(sendText).toHaveBeenCalledWith("972501234567", "");
  });
});
