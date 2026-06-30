import type { InboundOutcome } from "@homeos/shared";
import type { InboundMessage } from "../../../../http/webhook.ts";
import {
  BIND_INVALID_HE,
  BIND_OK_HE,
  BIND_WRONG_FAMILY_HE,
  BINDING_CODE_RE,
  type HandlerDeps,
} from "../../shared/index.ts";
import { CONTINUE } from "./phase.ts";

/**
 * 🔗 #228 phone-binding ceremony — the ONE deliberate pre-gate branch: a not-yet-bound phone is by
 * definition not on the allowlist, and binding is the act that CREATES the allowlist entry (the
 * `family_phones` row the #259 resolver gate now reads), so it must be handled before the gate would reject
 * it. Cheap on the miss path (one regex; the indexed lookup runs ONLY when a code-shaped token is present),
 * so it doesn't widen the pre-auth cost surface. Only a VALID pending code writes anything; a valid bind
 * short-circuits all command routing. Fully additive: unset `deps.bindings` ⇒ no branch. No code ⇒ CONTINUE
 * to the admission gate.
 */
export async function tryBindPhone(
  msg: InboundMessage,
  deps: HandlerDeps,
): Promise<InboundOutcome | typeof CONTINUE> {
  const log = deps.log ?? (() => {});
  if (deps.bindings) {
    const code = msg.text?.toUpperCase().match(BINDING_CODE_RE)?.[0];
    if (code) {
      const result = deps.bindings.matchBinding(code, msg.from);
      if (result?.status === "bound") {
        log("phone bound", { from: msg.from, familyId: result.familyId });
        await deps.sendText(msg.from, BIND_OK_HE);
        return "bound";
      }
      if (result?.status === "wrong_family") {
        log("phone bind rejected — already bound to another family", { from: msg.from });
        await deps.sendText(msg.from, BIND_WRONG_FAMILY_HE);
        return "refused";
      }
      log("phone bind failed — invalid or expired code", { from: msg.from });
      await deps.sendText(msg.from, BIND_INVALID_HE);
      return "refused";
    }
  }
  return CONTINUE;
}
