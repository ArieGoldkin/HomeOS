import { describe, expect, it, vi } from "vitest";
import { handleInbound } from "../../../src/core/handler/index.ts";
import { FAMILY_ID } from "../../../src/db/schema.ts";
import { makeDeps, sampleSaved, textMsg } from "./_setup.ts";

// A resolved family id that is DELIBERATELY not "default", so a test fails if any site still reads the
// constant instead of the threaded value. textMsg.from ("972501234567") is on the _setup allowlist.
const RESOLVED = "fam-resolved";
const STRANGER = "972559999999"; // not on the allowlist

describe("#229 phone→family resolution — bot write path threading", () => {
  it("resolves from_phone after the allowlist gate and threads the RESOLVED family into the agent ToolContext", async () => {
    const { agent, deps } = makeDeps({ familyResolves: RESOLVED });

    const outcome = await handleInbound(textMsg, deps);

    expect(outcome).toBe("parsed");
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.run.mock.calls[0]?.[1].familyId).toBe(RESOLVED); // the resolved value, NOT FAMILY_ID
  });

  it("threads the resolved family into a destructive store call (cancel-by-ref → findEventsByRef + deleteById)", async () => {
    const { events, deps } = makeDeps({ familyResolves: RESOLVED });
    events.findEventsByRef.mockReturnValue([sampleSaved]); // 1 deterministic match → immediate delete

    await handleInbound({ ...textMsg, text: "בטל פגישה ב-3:30" }, deps);

    expect(events.findEventsByRef).toHaveBeenCalledWith(RESOLVED, expect.anything());
    expect(events.deleteById).toHaveBeenCalledWith(sampleSaved.id, RESOLVED);
  });

  it("an allowlisted-but-UNBOUND phone is skipped without writing — no model call, no event write, no reply", async () => {
    const { agent, events, sendText, deps } = makeDeps({ familyResolves: null });

    const outcome = await handleInbound(textMsg, deps);

    expect(outcome).toBe("refused");
    expect(agent.run).not.toHaveBeenCalled(); // never reaches a model call
    expect(events.saveEvent).not.toHaveBeenCalled(); // never falls through to FAMILY_ID="default"
    expect(events.deleteById).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled(); // a config/bootstrap error → silent skip, no confusing reply
  });

  it("the resolver runs AFTER the allowlist gate — a non-allowlisted phone is refused and never hits the resolver", async () => {
    const { agent, deps } = makeDeps({ familyResolves: RESOLVED });

    const outcome = await handleInbound({ ...textMsg, from: STRANGER }, deps);

    expect(outcome).toBe("refused");
    expect(agent.run).not.toHaveBeenCalled();
    // Security ordering: a stranger is rejected by the allowlist before the resolver is ever consulted.
    expect(vi.mocked(deps.familyResolver!.resolveFamilyByPhone)).not.toHaveBeenCalled();
  });

  it("is fully additive — with NO resolver wired, the ToolContext family degrades to FAMILY_ID (prior behavior)", async () => {
    const { agent, deps } = makeDeps(); // no familyResolves key ⇒ no resolver

    await handleInbound(textMsg, deps);

    expect(agent.run.mock.calls[0]?.[1].familyId).toBe(FAMILY_ID);
  });
});
