import { describe, expect, it, vi } from "vitest";
import { TransientError } from "../../../src/core/errors.ts";
import type { ProcessDeps } from "../../../src/core/handler/index.ts";
import { processInbound } from "../../../src/core/handler/index.ts";
import { makeDeps, textMsg } from "./_setup.ts";

describe("processInbound (queue settle)", () => {
  function makeInbound() {
    return {
      enqueue: vi.fn(() => true),
      markDone: vi.fn(),
      markFailed: vi.fn(),
      pending: vi.fn(() => []),
      statsSince: vi.fn(() => ({ done: 0, failed: 0, pending: 0 })),
      countFromSenderSince: vi.fn(() => 0),
    };
  }

  it("marks the row done after a successful handle", async () => {
    const { deps } = makeDeps();
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps);
    expect(inbound.markDone).toHaveBeenCalledWith("wamid.1");
    expect(inbound.markFailed).not.toHaveBeenCalled();
  });

  it("marks the row failed (not done) when handling throws a non-transient error", async () => {
    const { deps, sendText } = makeDeps();
    sendText.mockRejectedValueOnce(new Error("boom")); // a plain (permanent) failure
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps); // never throws
    expect(inbound.markFailed).toHaveBeenCalledWith("wamid.1");
    expect(inbound.markDone).not.toHaveBeenCalled();
  });

  it("leaves the row pending on a transient error (replayable, not failed)", async () => {
    const { deps } = makeDeps({ agentThrows: new TransientError("blip") });
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps); // never throws
    expect(inbound.markDone).not.toHaveBeenCalled();
    expect(inbound.markFailed).not.toHaveBeenCalled(); // stays pending → boot-replay retries
  });
});
