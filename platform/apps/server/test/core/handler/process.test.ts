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
      listRecent: vi.fn(() => []),
      statsSince: vi.fn(() => ({ done: 0, failed: 0, pending: 0 })),
      countFromSenderSince: vi.fn(() => 0),
      outcomeCountsSince: vi.fn(() => ({})),
      forwardsByDaySince: vi.fn(() => []),
    };
  }

  it("marks the row done with the 'parsed' outcome after a successful handle", async () => {
    const { deps } = makeDeps();
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps);
    expect(inbound.markDone).toHaveBeenCalledWith("wamid.1", "parsed");
    expect(inbound.markFailed).not.toHaveBeenCalled();
  });

  // #135 — the finer disposition the handler reached is threaded into markDone for the messages feed.
  it("records the terminal outcome per branch (refused / text_only / rephrase / command)", async () => {
    // refused — a non-allowlisted sender
    const refused = makeDeps();
    const ri = makeInbound();
    await processInbound({ ...textMsg, from: "999" }, {
      ...refused.deps,
      inbound: ri,
    } as ProcessDeps);
    expect(ri.markDone).toHaveBeenCalledWith("wamid.1", "refused");

    // text_only — a non-text message
    const text = makeDeps();
    const ti = makeInbound();
    await processInbound({ id: "wamid.1", from: "972501234567", type: "image" }, {
      ...text.deps,
      inbound: ti,
    } as ProcessDeps);
    expect(ti.markDone).toHaveBeenCalledWith("wamid.1", "text_only");

    // rephrase — the agent parsed nothing
    const reph = makeDeps({ saved: [] });
    const pi = makeInbound();
    await processInbound(textMsg, { ...reph.deps, inbound: pi } as ProcessDeps);
    expect(pi.markDone).toHaveBeenCalledWith("wamid.1", "rephrase");

    // command (bare ביטול undo) — #159: now carries a "cancelled" disposition (no longer a blank pill)
    const cmd = makeDeps();
    const ci = makeInbound();
    await processInbound({ ...textMsg, text: "ביטול" }, {
      ...cmd.deps,
      inbound: ci,
    } as ProcessDeps);
    expect(ci.markDone).toHaveBeenCalledWith("wamid.1", "cancelled");
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
