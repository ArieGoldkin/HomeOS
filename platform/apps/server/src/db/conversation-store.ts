import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { clarifyReasonSchema, type ParsedEvent, parsedEventSchema } from "@homeos/shared";
import { z } from "zod/v4";
import { BULK_CANCEL_MAX, type EventPatch } from "./event-store.ts";
import {
  type ConversationRow,
  CREATE_CONVERSATIONS_INDEX,
  CREATE_CONVERSATIONS_TABLE,
} from "./schema.ts";

// node:sqlite is a newer builtin bundlers don't externalize cleanly — load via createRequire (as
// event-store.ts / credential-store.ts do) so Node resolves it directly at runtime.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/** The three bounded-conversation flows (#84 clarify, #85 cancel, #86 edit). Matches the table CHECK. */
export type ConversationKind = "clarify" | "cancel" | "edit";

/**
 * The per-kind variant, serialized into the single `payload_json` blob (over-engineering lens: one
 * column, not 6). Only the `clarify` arm exists in #83 (the foundation echo stub); #85/#86 widen this
 * union with their `cancel`/`edit` arms (candidate ids + patch). `reason` is a free string here; #84
 * narrows it to the `ClarifyReason` enum keying the server-owned question templates.
 */
export type ConversationPayload =
  | { kind: "clarify"; reason: string; draft: ParsedEvent }
  | { kind: "cancel"; candidateIds: number[]; confirmAll?: boolean }
  | { kind: "edit"; candidateIds: number[]; patch: EventPatch };

/**
 * #84/F3 — runtime guard for a persisted clarify payload before it drives a write. The DB row is
 * trusted-but-VERIFY: a corrupt, stale, or hand-tampered blob (e.g. an old schema, an invalid reason,
 * a draft missing a required slot) must degrade to "rephrase", never crash on access or save garbage.
 * The handler `safeParse`s `payload_json` through this before merging/saving.
 */
export const clarifyPayloadSchema = z.object({
  kind: z.literal("clarify"),
  reason: clarifyReasonSchema,
  draft: parsedEventSchema,
});

/**
 * #85/F3 — runtime guard for a persisted `cancel` disambiguation payload. `candidateIds` are the board
 * rows offered in the numbered list; a corrupt/stale blob degrades to "rephrase" rather than deleting.
 * #163 — `confirmAll` marks a BULK-cancel thread (every in-scope row): the resume then expects a
 * fail-closed כן/לא over the whole set, not a numbered pick. Absent/false ⇒ the existing single-confirm
 * (length 1) / numbered-disambiguation (length >1) behavior. The cap rises to BULK_CANCEL_MAX so a bulk
 * set fits; the disambiguation path is still bounded to 5 by findEventsByRef's own LIMIT.
 */
export const cancelPayloadSchema = z.object({
  kind: z.literal("cancel"),
  candidateIds: z.array(z.number().int()).min(1).max(BULK_CANCEL_MAX),
  confirmAll: z.boolean().optional(),
});

/** The fields an edit/correction may change — a partial of the relevant ParsedEvent fields (#86). */
const eventPatchSchema = parsedEventSchema
  .pick({
    date_iso: true,
    time: true,
    location: true,
    title_he: true,
    assignee: true,
    recurrence: true,
  })
  .partial();

/**
 * #86/F3 — runtime guard for a persisted `edit` disambiguation payload. `candidateIds` are the board
 * rows offered; `patch` is the held field delta re-applied on the picked index. A corrupt/stale blob
 * degrades to "rephrase" rather than writing garbage.
 */
export const editPayloadSchema = z.object({
  kind: z.literal("edit"),
  candidateIds: z.array(z.number().int()).min(1).max(5),
  patch: eventPatchSchema,
});

/**
 * The bounded-conversation seam (#83). Sibling to `EventStore`/`InboundStore`/`CredentialStore`: same
 * single family SQLite file, same `createXxxStore(dbPath)` factory + interface, WAL. The TTL is
 * caller-driven — `create` takes a pre-computed `expiresAt` and the read/sweep methods take `nowSqlite`
 * — so the store stays clock-agnostic (the handler owns the clock, like the G16 ceiling). Resolution
 * is `DELETE … RETURNING` (single-use), mirroring `oauth_state` consumeState.
 */
export interface ConversationStore {
  /**
   * Open a thread. INSERT OR REPLACE on the unique `from_phone` index overwrites a prior pending one.
   * The row `kind` is DERIVED from `payload.kind` (one discriminant, so a thread can't be opened with a
   * mismatched kind/payload — the /review-mr 123+124 carry-forward).
   */
  create(input: {
    fromPhone: string;
    payload: ConversationPayload;
    expiresAt: string;
  }): ConversationRow;
  /** The sender's open thread, or null if none OR it's expired (TTL checked at READ time via `nowSqlite`). */
  getPending(fromPhone: string, nowSqlite: string): ConversationRow | null;
  /** Single-use `DELETE … RETURNING`: returns the row, or null if already gone (a redelivered answer). */
  resolve(id: number): ConversationRow | null;
  /** Boot + per-inbound sweep: `DELETE WHERE expires_at <= now`. Returns the count removed. */
  expireStale(nowSqlite: string): number;
}

export function createConversationStore(dbPath: string): ConversationStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_CONVERSATIONS_TABLE);
  db.exec(CREATE_CONVERSATIONS_INDEX);

  // INSERT OR REPLACE on the unique `from_phone`: opening a new thread atomically overwrites a prior
  // pending one (one open thread per sender). `status`/`created_at` fall to their column defaults;
  // RETURNING * yields the freshly inserted row.
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO conversations (from_phone, kind, payload_json, expires_at)
     VALUES (?, ?, ?, ?) RETURNING *;`,
  );
  // TTL at READ time: an expired row is invisible (it must expire strictly AFTER now to be returned).
  const selectPendingStmt = db.prepare(
    "SELECT * FROM conversations WHERE from_phone = ? AND expires_at > ? LIMIT 1;",
  );
  // Single-use: delete-and-return in one step (mirrors oauth_state consumeState at schema.ts:143). A
  // redelivered answer finds the row already gone → undefined → null → no-op.
  const resolveStmt = db.prepare("DELETE FROM conversations WHERE id = ? RETURNING *;");
  // Sweep: `<= now` partitions cleanly against getPending's `> now`, so a row getPending hides as
  // expired is guaranteed swept on the next pass.
  const expireStaleStmt = db.prepare("DELETE FROM conversations WHERE expires_at <= ?;");

  return {
    create({ fromPhone, payload, expiresAt }) {
      // kind is the payload's discriminant — never passed separately, so it can't drift from the blob.
      return insertStmt.get(
        fromPhone,
        payload.kind,
        JSON.stringify(payload),
        expiresAt,
      ) as unknown as ConversationRow;
    },
    getPending(fromPhone, nowSqlite) {
      const row = selectPendingStmt.get(fromPhone, nowSqlite) as unknown as
        | ConversationRow
        | undefined;
      return row ?? null;
    },
    resolve(id) {
      const row = resolveStmt.get(id) as unknown as ConversationRow | undefined;
      return row ?? null;
    },
    expireStale(nowSqlite) {
      return Number(expireStaleStmt.run(nowSqlite).changes);
    },
  };
}
