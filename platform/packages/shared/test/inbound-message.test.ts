import { describe, expect, it } from "vitest";
import {
  type InboundMessageDTO,
  inboundMessageSchema,
  inboundMessagesResponseSchema,
} from "../src/index.ts";

// Fixtures mirror the server's rowToInbound() output (apps/server/src/db/inbound-store.ts):
// one served row of the GET /messages feed. The `: InboundMessageDTO` annotations are the compile-time
// half of the contract — they fail typecheck if the schema/type drift from the served shape.
const parsedRow: InboundMessageDTO = {
  wa_message_id: "wamid.ABC",
  from_phone: "972500000001",
  type: "text",
  text: "פגישה עם יונתן מחר ב-12:00",
  status: "done",
  outcome: "parsed",
  received_at: "2026-06-22T07:14:00Z",
  processed_at: "2026-06-22T07:15:00Z",
  family_id: "default",
};

// A non-text message that never became an event — exactly why this is NOT a SavedEvent (no event exists).
const textOnlyRow: InboundMessageDTO = {
  ...parsedRow,
  wa_message_id: "wamid.VOICE",
  type: "audio",
  text: null,
  outcome: "text_only",
};

describe("inboundMessageSchema (the served GET /messages row)", () => {
  it("parses a real parsed-event row", () => {
    expect(inboundMessageSchema.parse(parsedRow)).toMatchObject({
      wa_message_id: "wamid.ABC",
      outcome: "parsed",
    });
  });

  it("parses a non-text row with null text + null outcome path", () => {
    const parsed = inboundMessageSchema.parse({ ...textOnlyRow, text: null });
    expect(parsed.text).toBeNull();
    expect(parsed.type).toBe("audio");
  });

  it("defaults family_id to 'default' when omitted (tenant-ready, D3-additive)", () => {
    const { family_id: _omitted, ...withoutFamily } = parsedRow;
    expect(inboundMessageSchema.parse(withoutFamily).family_id).toBe("default");
  });

  it("requires outcome to be present (nullable, not optional) and accepts null", () => {
    const { outcome: _omitted, ...withoutOutcome } = parsedRow;
    expect(() => inboundMessageSchema.parse(withoutOutcome)).toThrow();
    expect(inboundMessageSchema.parse({ ...parsedRow, outcome: null }).outcome).toBeNull();
  });

  it("parses each valid outcome and rejects an unknown one", () => {
    for (const outcome of [
      "parsed",
      "clarified",
      "rephrase",
      "refused",
      "rate_limited",
      "text_only",
    ] as const) {
      expect(inboundMessageSchema.parse({ ...parsedRow, outcome }).outcome).toBe(outcome);
    }
    expect(() => inboundMessageSchema.parse({ ...parsedRow, outcome: "exploded" })).toThrow();
  });

  it("requires text to be present (nullable, not optional)", () => {
    const { text: _omitted, ...withoutText } = parsedRow;
    expect(() => inboundMessageSchema.parse(withoutText)).toThrow();
  });
});

describe("inboundMessagesResponseSchema (the GET /messages envelope)", () => {
  it("parses the wrapped { messages: [...] } shape", () => {
    const parsed = inboundMessagesResponseSchema.parse({ messages: [parsedRow, textOnlyRow] });
    expect(parsed.messages).toHaveLength(2);
  });

  it("rejects a bare array — the payload must be wrapped", () => {
    expect(() => inboundMessagesResponseSchema.parse([parsedRow])).toThrow();
  });
});
