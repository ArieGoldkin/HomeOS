import { describe, expect, it, vi } from "vitest";
import { handleInbound } from "../../../src/core/handler/index.ts";
import { REFUSAL_HE } from "../../../src/core/handler/shared/index.ts";
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

  it("#259 — a sender that does NOT resolve to a family is refused without writing (no model call, no event write), but the Hebrew refusal IS sent", async () => {
    const { agent, events, sendText, deps } = makeDeps({ familyResolves: null });

    const outcome = await handleInbound(textMsg, deps);

    expect(outcome).toBe("refused");
    expect(agent.run).not.toHaveBeenCalled(); // never reaches a model call
    expect(events.saveEvent).not.toHaveBeenCalled(); // never falls through to FAMILY_ID="default"
    expect(events.deleteById).not.toHaveBeenCalled();
    // #259: family_phones is now the source of truth — a non-resolving sender is treated as unknown and
    // gets the refusal (the prior silent skip only existed in the old static-allowlist-then-resolve model).
    expect(sendText).toHaveBeenCalledWith(textMsg.from, REFUSAL_HE);
  });

  it("#259 — the resolver IS the gate: a phone absent from family_phones is consulted, then refused", async () => {
    const { agent, sendText, deps } = makeDeps({ familyResolves: RESOLVED });

    const outcome = await handleInbound({ ...textMsg, from: STRANGER }, deps);

    expect(outcome).toBe("refused");
    expect(agent.run).not.toHaveBeenCalled();
    // The resolver is now the single admission gate, so it IS consulted for every sender; STRANGER is not
    // in family_phones → null → refused + refusal sent (no fall-through to FAMILY_ID="default").
    expect(vi.mocked(deps.familyResolver!.resolveFamilyByPhone)).toHaveBeenCalledWith(STRANGER);
    expect(sendText).toHaveBeenCalledWith(STRANGER, REFUSAL_HE);
  });

  it("#259 — a #228-bound phone ABSENT from the static allowlist is admitted with its resolved family (no ALLOWLIST redeploy)", async () => {
    const BOUND = "972587777777"; // NOT on the static _setup allowlist; bound via the #228 ceremony
    const { agent, deps } = makeDeps({ familyResolves: RESOLVED, boundPhones: [BOUND] });

    const outcome = await handleInbound({ ...textMsg, from: BOUND }, deps);

    expect(outcome).toBe("parsed"); // admitted — the activation gap closed
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.run.mock.calls[0]?.[1].familyId).toBe(RESOLVED); // the resolved family, threaded down
  });

  it("is fully additive — with NO resolver wired, the ToolContext family degrades to FAMILY_ID (prior behavior)", async () => {
    const { agent, deps } = makeDeps(); // no familyResolves key ⇒ no resolver

    await handleInbound(textMsg, deps);

    expect(agent.run.mock.calls[0]?.[1].familyId).toBe(FAMILY_ID);
  });
});
