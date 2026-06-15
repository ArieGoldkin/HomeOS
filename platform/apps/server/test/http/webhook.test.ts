import { describe, expect, it } from "vitest";
import { extractMessages, verifyChallenge } from "../../src/http/webhook.ts";

// Realistic WhatsApp Cloud API inbound text webhook (shape per Meta docs).
const textPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15551234567", phone_number_id: "PNID" },
            contacts: [{ profile: { name: "Hodaya" }, wa_id: "972501234567" }],
            messages: [
              {
                from: "972501234567",
                id: "wamid.HBgM",
                timestamp: "1718000000",
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

// Delivery/read receipts arrive as `statuses`, not `messages` — must yield nothing.
const statusPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15551234567", phone_number_id: "PNID" },
            statuses: [
              {
                id: "wamid.X",
                status: "delivered",
                timestamp: "1718000001",
                recipient_id: "972501234567",
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("verifyChallenge", () => {
  it("returns the challenge when mode and token match", () => {
    expect(
      verifyChallenge(
        { "hub.mode": "subscribe", "hub.verify_token": "secret", "hub.challenge": "12345" },
        "secret",
      ),
    ).toBe("12345");
  });
  it("returns null on token mismatch", () => {
    expect(
      verifyChallenge(
        { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "12345" },
        "secret",
      ),
    ).toBeNull();
  });
  it("returns null when mode is not subscribe", () => {
    expect(
      verifyChallenge(
        { "hub.mode": "unsubscribe", "hub.verify_token": "secret", "hub.challenge": "12345" },
        "secret",
      ),
    ).toBeNull();
  });
  it("returns null when challenge is missing", () => {
    expect(
      verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "secret" }, "secret"),
    ).toBeNull();
  });
});

describe("extractMessages", () => {
  it("extracts a text message into a normalized shape", () => {
    const msgs = extractMessages(textPayload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      id: "wamid.HBgM",
      from: "972501234567",
      type: "text",
      text: "שלום",
    });
  });
  it("returns [] for a status-only webhook", () => {
    expect(extractMessages(statusPayload)).toEqual([]);
  });
  it("returns [] for empty or malformed payloads", () => {
    expect(extractMessages({})).toEqual([]);
    expect(extractMessages(null)).toEqual([]);
    expect(extractMessages("nonsense")).toEqual([]);
  });
});
