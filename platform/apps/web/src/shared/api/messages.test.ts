import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { fetchMessages } from "./messages";

describe("fetchMessages", () => {
  it("reads .messages from the wrapped payload and validates the rows", async () => {
    const messages = await fetchMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]?.outcome).toBe("parsed");
    // a non-text message has null text + a non-parse outcome
    expect(messages[1]?.text).toBeNull();
    expect(messages[1]?.outcome).toBe("text_only");
    // tenant-ready DTO — family_id is present (default "default")
    expect(messages[0]?.family_id).toBe("default");
  });

  it("throws on a 401 (missing/wrong messages token)", async () => {
    server.use(http.get("*/messages", () => new HttpResponse("Unauthorized", { status: 401 })));
    await expect(fetchMessages()).rejects.toThrow(/401/);
  });

  it("rejects a bare array (payload must be wrapped in { messages })", async () => {
    server.use(http.get("*/messages", () => HttpResponse.json([])));
    await expect(fetchMessages()).rejects.toThrow();
  });
});
