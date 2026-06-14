import { describe, it, expect, vi } from "vitest";
import type { ParsedEvent } from "@homeos/shared";
import { handleInbound } from "../src/handler.ts";
import type { HandlerDeps } from "../src/handler.ts";
import type { InboundMessage } from "../src/webhook.ts";

const allowlist = ["972501234567"];

const sampleEvent: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  source_text: "אסיפת הורים מחר ב-18:30",
};

function makeDeps(opts: { seen?: boolean; parsed?: ParsedEvent | null } = {}) {
  const sendText = vi.fn(async (_to: string, _body: string) => {});
  const store = { seen: vi.fn(() => opts.seen ?? false) };
  const events = {
    saveEvent: vi.fn((e: ParsedEvent, _m: { fromPhone: string; waMessageId: string }) => ({
      id: 7,
      ...e,
    })),
    listEvents: vi.fn(() => []),
  };
  const parse = vi.fn(
    async (_text: string, _today: string): Promise<ParsedEvent | null> =>
      opts.parsed === undefined ? sampleEvent : opts.parsed,
  );
  const deps: HandlerDeps = {
    allowlist,
    store,
    events,
    parse,
    sendText,
    now: () => new Date("2026-06-20T09:00:00Z"), // → 2026-06-20 in Asia/Jerusalem (IDT)
  };
  return { sendText, store, events, parse, deps };
}

const textMsg: InboundMessage = {
  id: "wamid.1",
  from: "972501234567",
  type: "text",
  text: "אסיפת הורים מחר ב-18:30",
};

describe("handleInbound (M2)", () => {
  it("parses, persists, and sends a Hebrew confirmation", async () => {
    const { sendText, events, parse, deps } = makeDeps();
    await handleInbound(textMsg, deps);
    expect(parse).toHaveBeenCalledWith("אסיפת הורים מחר ב-18:30", "2026-06-20"); // Jerusalem today
    expect(events.saveEvent).toHaveBeenCalledTimes(1);
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toContain("הוספתי ליומן");
    expect(body).toContain("אסיפת הורים");
  });

  it("asks to rephrase when parsing fails, without persisting", async () => {
    const { sendText, events, deps } = makeDeps({ parsed: null });
    await handleInbound(textMsg, deps);
    expect(events.saveEvent).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/לנסח|להבין/);
  });

  it("refuses a non-allowlisted sender before parsing", async () => {
    const { sendText, parse, deps } = makeDeps();
    await handleInbound({ ...textMsg, from: "972509999999" }, deps);
    expect(parse).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/הרשאה|מצטער/);
  });

  it("skips duplicates (idempotent on wa_message_id)", async () => {
    const { sendText, parse, deps } = makeDeps({ seen: true });
    await handleInbound(textMsg, deps);
    expect(parse).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("replies text-only for a non-text message (voice deferred to M2b)", async () => {
    const { sendText, parse, deps } = makeDeps();
    await handleInbound({ id: "wamid.2", from: "972501234567", type: "image" }, deps);
    expect(parse).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/טקסט/);
  });
});
