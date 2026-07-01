import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { normalizeEmail, normalizePhone } from "../core/allowlist.ts";
import { sqliteUtc } from "../core/time.ts";
import {
  ADD_FAMILY_MEMBERS_DISPLAY_NAME,
  ADD_FAMILY_MEMBERS_EMAIL,
  CREATE_CONSENTS_TABLE,
  CREATE_FAMILIES_TABLE,
  CREATE_FAMILY_MEMBERS_TABLE,
  CREATE_FAMILY_PHONES_TABLE,
  type FamilyMemberRow,
  type FamilyPhoneRow,
  type FamilyRow,
} from "./schema.ts";

// node:sqlite is a newer builtin bundlers don't externalize cleanly — load via createRequire (as
// credential-store.ts / event-store.ts do) so Node resolves it directly at runtime.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/**
 * #266 — the `user_id` prefix for a member row whose real `auth.uid()` is not yet known. Two conventions
 * have used it: the email-genesis owner (`placeholder:email:<email>`, written at boot from
 * `ALLOWED_LOGIN_EMAILS[0]`) and the LEGACY phone seed (`placeholder:<phone>`, retired). Either is upgraded
 * to the real `auth.uid()` on first login by {@link FamilyStore.reconcileMemberUid}. EXPORTED so index.ts's
 * genesis seed and the reconcile share ONE source of truth.
 */
export const PLACEHOLDER_USER_ID_PREFIX = "placeholder:";

/**
 * One-time, idempotent seed for our single dogfood family (#227). The composition root (index.ts) writes the
 * genesis OWNER from `ALLOWED_LOGIN_EMAILS[0]` (email-keyed, `userId = placeholder:email:<email>`) — #266
 * retired the phone-keyed `MEMBERS`/`MEMBER_EMAILS` identity seed. `phones` is optional and intended ONLY for
 * a dogfood bootstrap of `family_phones` — the real path earns bindings through the wa.me/OTP ceremony (#228).
 */
export interface FamilySeed {
  family: { familyId: string; displayName: string };
  /** #266 — optional: genesis seeds the OWNER via {@link FamilyStore.addMember} (not this array), so a seed
   *  may carry only `{ family }`. Kept for tests + any future config-seeded member set. */
  members?: Array<{ userId: string; role: string; displayName: string; email?: string }>;
  phones?: Array<{ fromPhone: string; verifiedAt: string }>;
}

/**
 * Read-shaped identity store (#227). Mirrors `createCredentialStore`: its own `node:sqlite` connection
 * on the shared family DB file, prepared statements, no ORM. Mostly reads; the few writes are the boot
 * seed, the `addMember` claim (#250), the `reconcileMemberUid` upgrade (#266), and `unbindPhone` (#262 —
 * owner-driven de-authorization). At N=1 every lookup is `WHERE family_id = ?`, which is trivially correct
 * with no second tenant to leak to (no RLS needed; that's deferred).
 */
export interface FamilyStore {
  getFamily(familyId: string): FamilyRow | null;
  listMembers(familyId: string): FamilyMemberRow[];
  listPhones(familyId: string): FamilyPhoneRow[];
  /**
   * #262 — revoke a WhatsApp sender: DELETE its `family_phones` row, scoped to `familyId` so an owner can
   * only ever unbind within their own family (a foreign `family_id` matches nothing → false, never a
   * cross-family revoke). `fromPhone` is digit-normalized on the way in (the same `normalizePhone` the seed
   * and resolver use) so a formatted number matches the stored digit form. Returns true iff a row was
   * deleted (false for an unknown/already-unbound phone — fail-closed, idempotent). Once the row is gone the
   * #229 resolver (its own connection on the same DB file) no longer resolves the sender → the next inbound
   * forward from it is refused with no write. This is a PHONE-only revoke: `family_members` is untouched (the
   * two identities are independent, joined by `family_id`, not by a person — revoking a sender must not
   * silently revoke a web login).
   */
  unbindPhone(familyId: string, fromPhone: string): boolean;
  /**
   * #266 — upgrade a member's PLACEHOLDER `user_id` to the real `auth.uid()` in place, matched by
   * `(family_id, LOWER(email))`. Matches BOTH the email-genesis owner (`placeholder:email:<email>`) AND the
   * legacy `placeholder:<phone>` row (so the live prod owner is upgraded on next login) via
   * `user_id LIKE 'placeholder:%'`. IDEMPOTENT: once the uid is real it no longer matches the LIKE, so a
   * retried/concurrent reconcile is a no-op. Returns true iff a row was upgraded. This lights up the deferred
   * `auth.uid() = user_id` RLS NOW — no placeholder backfill needed at the Postgres migration.
   */
  reconcileMemberUid(member: { familyId: string; email: string; userId: string }): boolean;
  /**
   * #266 heal — attach the genesis owner `email` to a pre-existing **email-LESS** owner row. The genesis seed
   * (index.ts) only writes the email-carrying owner when NO owner exists yet; a migrated DB whose owner row
   * came from the retired phone seed (`placeholder:<phone>`, email null) short-circuits that guard, leaving an
   * owner who never resolves via membership-by-email → `requireOwner` 403s (they can't mint invites). This sets
   * the email ON THAT owner row (scoped `role='owner' AND email IS NULL`), so it never overwrites a genuine
   * non-null email (a different real owner is left for a human). Returns true iff a row was healed. Idempotent:
   * once the email is set the row no longer matches. MUST run on THIS connection (the one that ran the `email`
   * ALTER). `email` is normalized on write so it can't drift from the resolver's `LOWER(email)` key.
   */
  healOwnerEmail(familyId: string, email: string): boolean;
  /**
   * #250 (Slice 2) — upsert a member, exposing the boot-seed upsert for the claim-on-first-login path. Runs
   * the EXACT same `INSERT … ON CONFLICT(family_id, user_id) DO UPDATE` as the seed (role FIRST-WINS;
   * display_name + email upserted), and MUST run on THIS store's connection — the one that ran the
   * self-healing `email`/`display_name` ALTERs (the resolver's own connection has not). The claim writes the
   * real `auth.uid()` as `user_id` (no placeholder), lighting up the deferred `auth.uid() = user_id` RLS.
   * `email` is normalized on write (trim + lower) so it can never drift from the resolver's `LOWER(email)` key.
   */
  addMember(member: {
    familyId: string;
    userId: string;
    role: string;
    displayName?: string | null;
    email?: string | null;
  }): void;
  /**
   * #270 — record that `email` (the session's verified login) accepted terms `version` for `familyId`, NOW.
   * Upsert on the email PK so re-consent (a new version) overwrites the prior record — we only track the
   * LATEST accepted version. `email` is normalized (trim + lower) on write so it can't drift from the
   * `getConsentVersion` read key. Idempotent under retry.
   */
  recordConsent(params: { email: string; familyId: string; version: string }): void;
  /**
   * #270 — the terms version `email` last accepted, or null if it has never consented. The consent route
   * compares this to `CURRENT_TERMS_VERSION`: equal ⇒ consented; different/null ⇒ re-prompt. Matched
   * case-insensitively (`LOWER(email)`), like the membership resolver. An empty email never resolves.
   */
  getConsentVersion(email: string): string | null;
}

export function createFamilyStore(dbPath: string, seed?: FamilySeed): FamilyStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_FAMILIES_TABLE);
  db.exec(CREATE_FAMILY_MEMBERS_TABLE);
  db.exec(CREATE_FAMILY_PHONES_TABLE);
  db.exec(CREATE_CONSENTS_TABLE); // #270 — the Terms/Privacy opt-in record (keyed by email)
  // #235: ensure `display_name` exists on a PRE-EXISTING family_members table (#227 seeded it before this
  // column existed; CREATE IF NOT EXISTS won't add it). Fresh DBs get it from the DDL; older DBs here. The
  // seed below upserts the real name, so this backfills on the same boot (mirrors event-store/index.ts).
  const memberCols = db.prepare("PRAGMA table_info(family_members);").all() as Array<{
    name: string;
  }>;
  if (!memberCols.some((c) => c.name === "display_name")) db.exec(ADD_FAMILY_MEMBERS_DISPLAY_NAME);
  // uid↔member binding — same self-healing ALTER for the `email` column (independent of display_name; the
  // PRAGMA snapshot above predates BOTH ALTERs, so each guard is correct even for a DB migrated by #235).
  if (!memberCols.some((c) => c.name === "email")) db.exec(ADD_FAMILY_MEMBERS_EMAIL);

  // #235/#250: role stays FIRST-WINS (frozen at first boot, NOT in the DO UPDATE set), but `display_name` +
  // `email` are upserted so a config.members change reflects on the next boot AND rows seeded before those
  // columns existed (#227) get backfilled. ON CONFLICT targets the (family_id, user_id) PK. Hoisted out of
  // the seed block (#250) so the boot seed AND the `addMember` claim path share ONE prepared statement.
  const insertMemberStmt = db.prepare(
    "INSERT INTO family_members (family_id, user_id, role, display_name, email) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(family_id, user_id) DO UPDATE SET display_name = excluded.display_name, " +
      "email = excluded.email;",
  );

  // Idempotent seed — `INSERT OR IGNORE` (= ON CONFLICT DO NOTHING on the PKs) is safe on every boot,
  // the same posture as the credential_key_canary seed. Re-running never duplicates or overwrites.
  if (seed) {
    db.prepare("INSERT OR IGNORE INTO families (family_id, display_name) VALUES (?, ?);").run(
      seed.family.familyId,
      seed.family.displayName,
    );
    for (const m of seed.members ?? []) {
      // role stays first-wins (frozen); display_name + email are upserted so a config change reflects on
      // the next boot (uid↔member binding — the email is the membership-by-email match key, normalized on
      // write so the stored column can never drift from the resolver's LOWER(email) match).
      insertMemberStmt.run(
        seed.family.familyId,
        m.userId,
        m.role,
        m.displayName,
        m.email == null ? null : normalizeEmail(m.email),
      );
    }
    // 🔒 family_phones is only ever a commented dogfood bootstrap here — the honest binding path is the
    // ceremony (#228). `from_phone` is stored digit-normalized so the resolver (#229) compares exactly.
    if (seed.phones) {
      const insertPhone = db.prepare(
        "INSERT OR IGNORE INTO family_phones (family_id, from_phone, verified_at) VALUES (?, ?, ?);",
      );
      for (const p of seed.phones) {
        insertPhone.run(seed.family.familyId, normalizePhone(p.fromPhone), p.verifiedAt);
      }
    }
  }

  const getFamilyStmt = db.prepare("SELECT * FROM families WHERE family_id = ?;");
  const listMembersStmt = db.prepare(
    "SELECT * FROM family_members WHERE family_id = ? ORDER BY created_at, user_id;",
  );
  const listPhonesStmt = db.prepare(
    "SELECT * FROM family_phones WHERE family_id = ? ORDER BY created_at, from_phone;",
  );
  // #266 — flip a placeholder member to the real auth.uid in place. The `LIKE 'placeholder:%'` guard makes it
  // idempotent (a real uid never matches) and scopes it to un-reconciled rows; matched by family + email.
  const reconcileUidStmt = db.prepare(
    "UPDATE family_members SET user_id = ? WHERE family_id = ? AND LOWER(email) = ? AND user_id LIKE 'placeholder:%';",
  );
  // #266 heal — attach the genesis email to an email-LESS owner row (the legacy phone-seed case). Scoped to
  // `role='owner' AND email IS NULL` so it heals ONLY email-less owner rows (exactly one at N=1) and NEVER
  // overwrites a real email.
  const healOwnerEmailStmt = db.prepare(
    "UPDATE family_members SET email = ? WHERE family_id = ? AND role = 'owner' AND email IS NULL;",
  );
  // #262 — owner-driven unbind. Scoped by (family_id, from_phone) — the PK — so it deletes at most the one
  // targeted row and never reaches another family. `from_phone` is bound digit-normalized (see unbindPhone).
  const unbindPhoneStmt = db.prepare(
    "DELETE FROM family_phones WHERE family_id = ? AND from_phone = ?;",
  );
  // #270 — upsert the opt-in on the email PK (re-consent overwrites → latest version wins). Email normalized
  // on write; consented_at from the current instant (the value isn't a match key, so no injected clock).
  const recordConsentStmt = db.prepare(
    "INSERT INTO consents (email, family_id, consented_at, consent_version) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(email) DO UPDATE SET family_id = excluded.family_id, " +
      "consented_at = excluded.consented_at, consent_version = excluded.consent_version;",
  );
  // No LOWER() — the email is stored already-normalized (lower+trimmed), so a plain equality on the PK
  // column hits the primary-key index; wrapping it in LOWER() would defeat that index for no gain.
  const getConsentStmt = db.prepare("SELECT consent_version FROM consents WHERE email = ?;");

  return {
    getFamily(familyId) {
      return (getFamilyStmt.get(familyId) as unknown as FamilyRow | undefined) ?? null;
    },
    listMembers(familyId) {
      return listMembersStmt.all(familyId) as unknown as FamilyMemberRow[];
    },
    listPhones(familyId) {
      return listPhonesStmt.all(familyId) as unknown as FamilyPhoneRow[];
    },
    unbindPhone(familyId, fromPhone) {
      return unbindPhoneStmt.run(familyId, normalizePhone(fromPhone)).changes > 0;
    },
    recordConsent({ email, familyId, version }) {
      const normalized = normalizeEmail(email);
      if (normalized === "") return; // never write a blank shared '' PK (mirrors the getConsentVersion guard)
      recordConsentStmt.run(normalized, familyId, sqliteUtc(new Date()), version);
    },
    getConsentVersion(email) {
      const normalized = normalizeEmail(email);
      if (normalized === "") return null; // empty/garbage email never resolves (mirrors the resolver guard)
      const row = getConsentStmt.get(normalized) as { consent_version: string } | undefined;
      return row?.consent_version ?? null;
    },
    reconcileMemberUid({ familyId, email, userId }) {
      return reconcileUidStmt.run(userId, familyId, normalizeEmail(email)).changes > 0;
    },
    healOwnerEmail(familyId, email) {
      const normalized = normalizeEmail(email);
      if (normalized === "") return false; // never heal to a blank email (mirrors the resolver guard)
      return healOwnerEmailStmt.run(normalized, familyId).changes > 0;
    },
    addMember({ familyId, userId, role, displayName, email }) {
      insertMemberStmt.run(
        familyId,
        userId,
        role,
        displayName ?? null,
        email == null ? null : normalizeEmail(email),
      );
    },
  };
}
