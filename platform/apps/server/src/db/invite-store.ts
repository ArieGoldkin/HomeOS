import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { normalizeEmail } from "../core/allowlist.ts";
import { sqliteUtc } from "../core/time.ts";
import {
  CREATE_FAMILY_INVITES_EMAIL_INDEX,
  CREATE_FAMILY_INVITES_TABLE,
  type InviteRow,
} from "./schema.ts";

// node:sqlite is a newer builtin bundlers don't externalize cleanly — load via createRequire (as the
// other stores do) so Node resolves it directly at runtime.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/** ~14-day TTL — long enough for an owner to relay the login out-of-band, short enough to bound a stale grant. */
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Owner-issued, email-scoped invite store (#250, Slice 2 — the self-serve login-allowlist seam). Mirrors
 * `binding-store`/`credential-store`: its own `node:sqlite` connection on the shared family DB file,
 * prepared statements, read-time TTL, injected clock. The DURABLE outcome is a claimed invite + (via the
 * claim orchestrator) a real-`auth.uid()` `family_members` row — but this store owns ONLY `family_invites`;
 * the member write lives on the FamilyStore connection (the one that ran the `email` ALTER), so the claim is
 * deliberately split across two connections (no single transaction until the RLS migration).
 *
 * The security boundary is the email-pin, NOT this store: `findPendingByEmail` returns a pending, unexpired
 * invite for a verified email, and the gate only claims it because Supabase already proved the caller owns
 * that email. Every statement is parameterized; `email` is stored + matched lower+trimmed.
 */
export interface InviteStore {
  /**
   * Mint a fresh `pending` invite scoped to `familyId`, superseding any prior pending invite for the same
   * (family, email) so an owner re-inviting just refreshes the TTL/role rather than stacking duplicates.
   * `email` is normalized on write; `role` is the caller-validated role (default `member`). Returns the row.
   */
  createInvite(params: {
    familyId: string;
    email: string;
    role?: string;
    invitedBy?: string;
  }): InviteRow;
  /** Pending, unexpired invites for `familyId`, newest first (the owner's GET /invites view). */
  listPending(familyId: string): InviteRow[];
  /**
   * The gate lookup: the most-recent pending, unexpired invite whose `email` matches (lower+trimmed), or
   * null. Deterministic `ORDER BY created_at DESC LIMIT 1`. An empty email never resolves.
   */
  findPendingByEmail(email: string): InviteRow | null;
  /**
   * Claim a pending invite for the real `auth.uid()` — `pending → claimed`, recording the uid + timestamp
   * (audit + future RLS). Returns true iff a pending row was claimed (false if already claimed/revoked/gone),
   * so the orchestrator can stay idempotent under a retried first login.
   */
  claimInvite(inviteId: string, userId: string): boolean;
  /**
   * Owner-revoke a pending invite, scoped to `familyId` so an owner can only revoke into their own family
   * (a cross-family id silently matches nothing). Returns true iff a pending row was revoked.
   */
  revokeInvite(inviteId: string, familyId: string): boolean;
}

export function createInviteStore(dbPath: string, now: () => Date = () => new Date()): InviteStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_FAMILY_INVITES_TABLE);
  db.exec(CREATE_FAMILY_INVITES_EMAIL_INDEX);

  // Re-invite supersedes: drop any prior pending invite for the same (family, email) so listPending stays
  // one-row-per-invitee and the gate's most-recent pick is unambiguous. Claimed/revoked rows are kept (audit).
  const supersedeStmt = db.prepare(
    "DELETE FROM family_invites WHERE family_id = ? AND email = ? AND status = 'pending';",
  );
  // `created_at` is written from the INJECTED clock (not the DDL's `datetime('now')`, which is real-time
  // second-granular) so listPending/findPendingByEmail ordering is deterministic + testable under a fake clock.
  const insertStmt = db.prepare(
    "INSERT INTO family_invites (invite_id, family_id, email, role, token, invited_by, status, expires_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?);",
  );
  const getStmt = db.prepare("SELECT * FROM family_invites WHERE invite_id = ?;");
  const listPendingStmt = db.prepare(
    "SELECT * FROM family_invites WHERE family_id = ? AND status = 'pending' AND expires_at > ? " +
      "ORDER BY created_at DESC, invite_id;",
  );
  const findByEmailStmt = db.prepare(
    "SELECT * FROM family_invites WHERE email = ? AND status = 'pending' AND expires_at > ? " +
      "ORDER BY created_at DESC, invite_id LIMIT 1;",
  );
  const claimStmt = db.prepare(
    "UPDATE family_invites SET status = 'claimed', claimed_user_id = ?, claimed_at = ? " +
      "WHERE invite_id = ? AND status = 'pending';",
  );
  const revokeStmt = db.prepare(
    "UPDATE family_invites SET status = 'revoked' WHERE invite_id = ? AND family_id = ? AND status = 'pending';",
  );

  return {
    createInvite({ familyId, email, role = "member", invitedBy }) {
      const normalized = normalizeEmail(email);
      const inviteId = randomUUID();
      // A second unguessable secret reserved for the future shareable-link UX (option B); the email-pinned
      // claim never reads it, so it's purely additive — minted now so the column is populated from day one.
      const token = randomUUID();
      const nowDate = now();
      const expiresAt = sqliteUtc(new Date(nowDate.getTime() + INVITE_TTL_MS));
      supersedeStmt.run(familyId, normalized);
      insertStmt.run(
        inviteId,
        familyId,
        normalized,
        role,
        token,
        invitedBy ?? null,
        expiresAt,
        sqliteUtc(nowDate),
      );
      return getStmt.get(inviteId) as unknown as InviteRow;
    },
    listPending(familyId) {
      return listPendingStmt.all(familyId, sqliteUtc(now())) as unknown as InviteRow[];
    },
    findPendingByEmail(email) {
      const normalized = normalizeEmail(email);
      if (normalized === "") return null; // empty/garbage email never resolves (mirrors the resolver guard)
      const row = findByEmailStmt.get(normalized, sqliteUtc(now())) as unknown as
        | InviteRow
        | undefined;
      return row ?? null;
    },
    claimInvite(inviteId, userId) {
      const res = claimStmt.run(userId, sqliteUtc(now()), inviteId);
      return res.changes > 0;
    },
    revokeInvite(inviteId, familyId) {
      const res = revokeStmt.run(inviteId, familyId);
      return res.changes > 0;
    },
  };
}
