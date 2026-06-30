import type { InboundOutcome } from "@homeos/shared";
import type { ConversationRow } from "../../../../db/schema.ts";
import type { InboundMessage } from "../../../../http/webhook.ts";
import { isAllowed } from "../../../allowlist.ts";
import { jerusalemDayStartSqlite } from "../../../time.ts";
import { type HandlerDeps, RATE_LIMIT_HE } from "../../shared/index.ts";
import { CONTINUE } from "./phase.ts";

/**
 * 🔒🔑 #259/#229 — the inbound admission gate AND the family resolve, unified into ONE step (run right
 * after the #228 binding branch, BEFORE any write/model call). Returns the per-request deps clone carrying
 * the resolved `familyId` (read downstream via `familyOf`), or `"refused"` to SKIP (the caller sends the
 * Hebrew refusal and writes nothing — NEVER falls through to FAMILY_ID="default").
 *
 * When a resolver IS wired (prod), `family_phones` is the DB-backed allowlist: a phone is admitted iff it
 * resolves to a family. This is the cross-tenant chokepoint with NO RLS backstop — and it's why a phone
 * bound via the #228 ceremony gains bot access with NO `ALLOWLIST` redeploy (the static env list seeds
 * `family_phones` at boot but no longer gates here). When NO resolver is wired (app-only dev / unit tests)
 * it falls back to the static `ALLOWLIST` so the gate still bounds *who* is processed; `familyId` stays
 * unset ⇒ `familyOf` degrades to FAMILY_ID, i.e. the exact prior behavior.
 */
export function resolveFamilyOrSkip(
  msg: InboundMessage,
  deps: HandlerDeps,
): HandlerDeps | "refused" {
  const log = deps.log ?? (() => {});
  if (deps.familyResolver) {
    const resolved = deps.familyResolver.resolveFamilyByPhone(msg.from);
    if (resolved === null) {
      log("sender does not resolve to a family — refusing (no write)", { from: msg.from });
      return "refused";
    }
    return { ...deps, familyId: resolved };
  }
  // No resolver wired (app-only dev / unit tests): fall back to the static ALLOWLIST.
  if (!isAllowed(msg.from, deps.allowlist)) {
    log("rejected non-allowlisted sender", { from: msg.from });
    return "refused";
  }
  return deps;
}

/**
 * G16: per-sender daily ceiling — the allowlist bounds *who* and the input cap (G2) bounds message
 * *size*; this bounds *rate*, the last unbounded cost axis vs ≤$100/mo. Checked after the allowlist (so
 * non-family senders are never counted) and before any model call. The message is already enqueued
 * (persist-before-ack), so the count includes it; resets at Jerusalem midnight. Off unless both the
 * ceiling and the inbound counter are wired.
 */
export async function enforceRateCeiling(
  msg: InboundMessage,
  deps: HandlerDeps,
  now: Date,
  pending: ConversationRow | null,
): Promise<InboundOutcome | typeof CONTINUE> {
  const log = deps.log ?? (() => {});
  if (deps.maxPerSenderPerDay !== undefined && deps.inbound) {
    const since = jerusalemDayStartSqlite(now);
    const count = deps.inbound.countFromSenderSince(msg.from, since);
    if (count > deps.maxPerSenderPerDay) {
      // G23: a resume-answer is NOT a new intent. If the sender has a LIVE open thread (the `pending`
      // looked up above), exempt them from the ceiling so their answer still resolves/expires the thread
      // — otherwise a rate-limited reply would strand it until TTL (clarify #84 / disambiguation #85-86
      // never closes). An already-expired thread is `null` here (swept above + read-time TTL), so it does
      // NOT grant the exemption: that sender is sending something genuinely new and stays rate-limited.
      if (pending == null) {
        log("per-sender daily ceiling hit", {
          from: msg.from,
          count,
          max: deps.maxPerSenderPerDay,
        });
        await deps.sendText(msg.from, RATE_LIMIT_HE);
        return "rate_limited";
      }
      log("ceiling hit but sender has an open thread — exempting the resume (G23)", {
        from: msg.from,
        count,
      });
    }
  }
  return CONTINUE;
}
