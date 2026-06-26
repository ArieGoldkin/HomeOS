import { describe, expect, it } from "vitest";
import { handleInbound } from "../../../src/core/handler/index.ts";
import {
  BIND_INVALID_HE,
  BIND_OK_HE,
  BIND_WRONG_FAMILY_HE,
  REFUSAL_HE,
  TEXT_ONLY_HE,
} from "../../../src/core/handler/shared/index.ts";
import { createBindingStore } from "../../../src/db/binding-store.ts";
import { FAMILY_ID } from "../../../src/db/schema.ts";
import type { InboundMessage } from "../../../src/http/webhook.ts";
import { makeDeps } from "./_setup.ts";

// A number deliberately NOT on the allowlist (["972501234567"]) — binding must work BEFORE the allowlist
// gate, because binding is what would CREATE the allowlist entry.
const STRANGER = "972559999999";
const textFrom = (from: string, text: string | undefined, type = "text"): InboundMessage => ({
  id: "wamid.bind",
  from,
  type,
  text,
});

describe("#228 phone-binding ceremony — the pre-allowlist branch", () => {
  it("a valid code from a NON-allowlisted phone binds + replies the Hebrew confirm, before the allowlist", async () => {
    const bindings = createBindingStore(":memory:");
    const code = bindings.issueBinding(FAMILY_ID);
    const { sendText, agent, deps } = makeDeps({ bindings });

    const outcome = await handleInbound(textFrom(STRANGER, `הקוד שלי לחיבור: ${code}`), deps);

    expect(outcome).toBe("bound");
    expect(sendText).toHaveBeenCalledWith(STRANGER, BIND_OK_HE);
    expect(agent.run).not.toHaveBeenCalled(); // a successful bind short-circuits all command routing
  });

  it("tolerates surrounding prose / lowercase (only HOME-XXXXX is load-bearing)", async () => {
    const bindings = createBindingStore(":memory:");
    const code = bindings.issueBinding(FAMILY_ID);
    const { sendText, deps } = makeDeps({ bindings });

    // Lowercased + padded + trailing Hebrew — the handler upper-cases before matching.
    const outcome = await handleInbound(
      textFrom(STRANGER, `   ${code.toLowerCase()}  תודה!`),
      deps,
    );

    expect(outcome).toBe("bound");
    expect(sendText).toHaveBeenCalledWith(STRANGER, BIND_OK_HE);
  });

  it("an invalid/never-issued code replies the Hebrew invalid message (NOT the allowlist refusal)", async () => {
    const bindings = createBindingStore(":memory:");
    const { sendText, agent, deps } = makeDeps({ bindings });

    const outcome = await handleInbound(textFrom(STRANGER, "קוד: HOME-ZZZZZ"), deps);

    expect(outcome).toBe("refused");
    expect(sendText).toHaveBeenCalledWith(STRANGER, BIND_INVALID_HE);
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("a phone already bound to ANOTHER family is rejected (wrong_family), never silently re-bound", async () => {
    const bindings = createBindingStore(":memory:");
    // Bind STRANGER to the default family first (directly via the store).
    expect(bindings.matchBinding(bindings.issueBinding(FAMILY_ID), STRANGER)?.status).toBe("bound");
    // Now a code for a DIFFERENT family arrives from the same phone.
    const otherCode = bindings.issueBinding("fam-2");
    const { sendText, deps } = makeDeps({ bindings });

    const outcome = await handleInbound(textFrom(STRANGER, otherCode), deps);

    expect(outcome).toBe("refused");
    expect(sendText).toHaveBeenCalledWith(STRANGER, BIND_WRONG_FAMILY_HE);
  });

  it("a message with NO code from a non-allowlisted phone falls through to the unchanged allowlist refusal", async () => {
    const bindings = createBindingStore(":memory:");
    const { sendText, deps } = makeDeps({ bindings });

    const outcome = await handleInbound(textFrom(STRANGER, "שלום, מה קורה?"), deps);

    expect(outcome).toBe("refused");
    expect(sendText).toHaveBeenCalledWith(STRANGER, REFUSAL_HE); // the ALLOWLIST refusal, not a binding reply
  });

  it("a non-text inbound (no body) from an allowlisted sender falls through to the TEXT_ONLY path", async () => {
    const bindings = createBindingStore(":memory:");
    const { sendText, deps } = makeDeps({ bindings });

    const outcome = await handleInbound(textFrom("972501234567", undefined, "image"), deps);

    expect(outcome).toBe("text_only");
    expect(sendText).toHaveBeenCalledWith("972501234567", TEXT_ONLY_HE);
  });

  it("is fully additive — with no bindings store wired, a HOME-looking message routes to the agent as before", async () => {
    const { agent, deps } = makeDeps(); // no bindings
    const outcome = await handleInbound(textFrom("972501234567", "HOME-ABCDE קבע פגישה"), deps);

    expect(agent.run).toHaveBeenCalled(); // branch inert → normal forward path
    expect(outcome).toBe("parsed");
  });
});
