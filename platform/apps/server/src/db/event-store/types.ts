import type { EventStatus, ParsedEvent, SavedEventSource } from "@homeos/shared";

/** #86 — the fields a `שנה <ref>` / correction may change in place. A subset of ParsedEvent; merged
 *  onto the target row and re-validated (G20) before the write. */
export type EventPatch = Partial<
  Pick<ParsedEvent, "date_iso" | "time" | "location" | "title_he" | "assignee" | "recurrence">
>;

/**
 * #163 — the ceiling on a single bulk-cancel ("בטל את כל הפגישות מחר"): caps both the in-scope query
 * (`findEventsInScope` LIMIT) AND the persisted confirm-thread payload (`cancelPayloadSchema.max`), so a
 * pathologically busy day can never blow up the confirm message or the stored blob. A family's day-scope
 * realistically holds far fewer; 25 is a generous bound that keeps the listing readable.
 */
export const BULK_CANCEL_MAX = 25;

export interface EventMeta {
  fromPhone: string;
  waMessageId: string;
  /** Index of this event within its message (0-based); distinguishes multi-event rows. */
  seq?: number;
  /** Provider that produced the row ('google' for Gmail/Calendar-derived); null for forwards (#61/MF5). */
  sourceProvider?: string;
}

export interface SavedEvent extends ParsedEvent {
  id: number;
  /** null for forwarded events; the provider name for derived rows (#61). */
  source_provider: string | null;
  /** #151 — derived provenance for the UI (gmail/gcal/web/whatsapp), from the wa_message_id prefix. */
  source?: SavedEventSource;
  /** #151 — the row's SQLite datetime, now part of the served contract (for the event-detail view). */
  created_at?: string;
  /** #19 — open/done completion state; the server always populates it (legacy NULL rows → "open"). */
  status?: EventStatus;
}

/** Persistence seam — handlers depend on this, not on the driver. */
export interface EventStore {
  saveEvent(event: ParsedEvent, meta: EventMeta): SavedEvent;
  listEvents(): SavedEvent[];
  /** Delete all events from the sender's most recent message (the `ביטול` undo). Returns the count. */
  deleteLastFromSender(fromPhone: string): number;
  /** Count events created at/after `sinceIso` (SQLite UTC datetime). Feeds the daily digest. */
  countSince(sinceIso: string): number;
  /** Purge every row tagged with `provider` — the disconnect deletion seam (#61/MF5). Returns the count. */
  deleteByProvider(provider: string): number;
  /**
   * #85 — delete ONE board row by id. FAMILY-scoped (`source_provider IS NULL` only: a board row, never a
   * gcal/gmail-derived row); `familyId` is the reserved Phase-8 contract. Returns the count (0 or 1).
   */
  deleteById(id: number, familyId: string): number;
  /**
   * #85 — FAMILY-scoped reference lookup for `בטל <ref>` (board rows only, `source_provider IS NULL`).
   * ANDs the provided fields (date_iso = / time = / title_he LIKE %hint%), newest-first (ORDER BY id DESC),
   * capped at 5 with NO speculative ranking — N>1 goes to a disambiguation thread. `familyId` is reserved.
   */
  findEventsByRef(
    familyId: string,
    ref: { dateIso?: string; time?: string; titleHint?: string },
  ): SavedEvent[];
  /**
   * #147 — BROADER-field resolve for the agentic fallback (the live bug: the disambiguating word lives in
   * **location** or **assignee**, not the title). Same board-only (`source_provider IS NULL`), family-scoped,
   * date/time-exact, newest-first, cap-5 base as `findEventsByRef`, but each `titleHint` word matches
   * `title_he OR location OR assignee`. Read-only; used ONLY behind the model fallback + confirm gate.
   * `findEventsByRef` stays the STRICT title-only matcher guarding the deterministic destructive path
   * (#125/G22) — this is a deliberately separate seam, so broadening here can't widen the fast path.
   */
  searchEvents(
    familyId: string,
    query: { dateIso?: string; time?: string; titleHint?: string },
  ): SavedEvent[];
  /**
   * #163 — list EVERY board row in a date/time SCOPE for bulk cancel ("בטל את כל הפגישות מחר"). Same
   * board-only (`source_provider IS NULL`), family-scoped, date/time-exact, newest-first base as
   * `findEventsByRef`, but with NO title clause (the quantifier "כל ה…" is not a title — kind-agnostic by
   * design) and capped at `BULK_CANCEL_MAX` (not 5: a bulk op must see the whole day, not a sample). The
   * caller (`routeBulkCancel`) requires a non-empty scope before calling, so this never wipes the board;
   * a scope matching nothing returns `[]`. Read-only; the destructive step is confirm-gated. `familyId`
   * is the reserved Phase-8 contract.
   */
  findEventsInScope(familyId: string, scope: { dateIso?: string; time?: string }): SavedEvent[];
  /**
   * #28 — the OPEN reminders due on `dateIso` (board rows only, `source_provider IS NULL`), earliest-time
   * first (untimed last). The daily digest surfaces these as a morning nudge: a reminder set "for
   * tomorrow" lands dated tomorrow and shows up in tomorrow's digest. A `done` reminder is excluded, so it
   * fires once on its day and is not re-surfaced after being acted on (#28 AC). `familyId` is the reserved
   * Phase-8 contract (today: board rows are family-shared).
   */
  remindersDueOn(familyId: string, dateIso: string): SavedEvent[];
  /**
   * #86 — edit a board row in place. FAMILY-scoped (`source_provider IS NULL` only: a synced gcal/gmail
   * row is NEVER written, preventing a read→write loop). Merges `patch` onto the row, re-validates the
   * MERGED row via `parsedEventSchema` BEFORE the write (G20), and returns the updated `SavedEvent` — or
   * null if the target isn't a board row or the merge is invalid (no write happens).
   */
  updateEvent(id: number, patch: EventPatch, familyId: string): SavedEvent | null;
  /**
   * #19 — set a board row's open/done `status` (the task done-toggle). FAMILY-scoped (`source_provider
   * IS NULL` only: a synced gcal/gmail row is never toggled), separate from `updateEvent` so the #86
   * edit/destructive seam stays untouched. Returns the updated `SavedEvent`, or null if the target isn't
   * a board row (synced / nonexistent) — no write happens. `familyId` is the reserved Phase-8 contract.
   */
  setEventStatus(id: number, status: EventStatus, familyId: string): SavedEvent | null;
  /**
   * Slot dedup — an existing BOARD row (`source_provider IS NULL`) at the same `(date_iso, time)`,
   * excluding the caller's own `excludeWaMessageId` so a boot-replay of a message never collides with
   * the rows it already saved (those upsert on `(wa_message_id, seq)`). Returns the existing row or
   * null. `familyId` is the reserved Phase-8 contract; the caller passes a NON-NULL time (a null-time
   * item has no "slot" and is never deduped).
   */
  findSlotConflict(
    familyId: string,
    slot: { dateIso: string; time: string; excludeWaMessageId: string },
  ): SavedEvent | null;
}
