/**
 * #284 — the standing-due predicate, the TS mirror of the event-store's `remindersDueStmt` standing
 * branch (`standing_cadence = 'daily' AND date_iso <= d AND standing_until >= d`, board rows +
 * reminders only). The SQL stays authoritative; an equivalence test in apps/server pins the two
 * together so they cannot drift. Semantics deliberately mirrored:
 *  - NO done-exclusion — marking a standing reminder done never ends the series (#224 folded fix);
 *  - `until` is INCLUSIVE on both ends;
 *  - a missing `until` (pre-#284 payload) → NOT due (honest degrade, never re-derive the window).
 */

/** Structural input — any SavedEvent satisfies it (kept local to avoid a barrel cycle). */
export interface StandingDueInput {
  kind: string;
  date_iso: string;
  source_provider: string | null;
  standing?: { cadence: "daily"; until?: string } | null;
}

export function isStandingDueOn(event: StandingDueInput, dayIso: string): boolean {
  if (event.kind !== "reminder") return false;
  if (event.source_provider != null) return false;
  if (event.standing?.cadence !== "daily") return false;
  const until = event.standing.until;
  if (!until) return false;
  return event.date_iso <= dayIso && dayIso <= until;
}
