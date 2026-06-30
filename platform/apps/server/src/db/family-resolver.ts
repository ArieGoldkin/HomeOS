import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { normalizeEmail, normalizePhone } from "../core/allowlist.ts";
import {
  CREATE_FAMILIES_TABLE,
  CREATE_FAMILY_MEMBERS_TABLE,
  CREATE_FAMILY_PHONES_TABLE,
} from "./schema.ts";

// node:sqlite is a newer builtin bundlers don't externalize cleanly — load via createRequire (as
// credential-store.ts / family-store.ts do) so Node resolves it directly at runtime.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/**
 * #229 — the phone→family / user→family resolver: the security CHOKEPOINT for the auth/identity
 * milestone. It turns the implicit single-tenancy of `FAMILY_ID` ("default") into a value DERIVED per
 * request — `resolveFamilyByPhone` on the bot WRITE path (the inbound `from_phone`), `resolveFamilyByUser`
 * on the browser READ path (the session `auth.uid()`). There is NO RLS backstop on the bot write path
 * (the bot writes with full DB privileges; RLS — when the Supabase migration lands — only guards the
 * browser read), so app-layer `WHERE family_id = ?` is the PRIMARY guard and THIS is where its input is
 * computed. A wrong `from_phone → family_id` mapping leaks or corrupts data across families, so:
 * comparisons are on the digit-NORMALIZED phone (the same `normalizePhone` the allowlist/inbound/binding
 * paths use — a normalization mismatch here is a silent cross-tenant bug), and every statement is
 * parameterized (no string interpolation of `from_phone`/`user_id`). Both methods return `null` on no
 * match; the caller decides the failure response (bot: log + skip without writing; browser: 403).
 */
export interface FamilyResolver {
  /** Bot write path: from_phone → family_id, or null if the phone is unbound. Compared on `normalizePhone`. */
  resolveFamilyByPhone(fromPhone: string): string | null;
  /** Browser read path: user_id (from session) → family_id, or null if not a member. */
  resolveFamilyByUser(userId: string): string | null;
  /**
   * #226 — browser read path: user_id (session auth.uid) → the member's `{familyId, role}`, or null if not
   * a member. `role` drives the read/write gate (requireWrite); `familyId` scopes the request. Same
   * deterministic `ORDER BY family_id LIMIT 1` as resolveFamilyByUser — a chokepoint with no RLS backstop
   * must never flap between families across calls if the one-member-row invariant is ever broken upstream.
   */
  resolveMembership(userId: string): { familyId: string; role: string } | null;
  /**
   * uid↔member binding — browser read path: the session's verified login EMAIL → the member's
   * `{familyId, role}`, or null if no member carries that email. This is what `requireSession` actually
   * calls: the placeholder `user_id` never equals the real `auth.uid()`, so membership is keyed on the
   * email the JWT already carries (and the allowlist already trusts). Matched case-insensitively
   * (`LOWER(email)`, input lower+trimmed); same deterministic `ORDER BY family_id LIMIT 1`. An empty email
   * never resolves. null → the caller's N=1 fallback (the single family + a writer role; no lockout).
   */
  resolveMembershipByEmail(email: string): { familyId: string; role: string } | null;
}

/**
 * Read-only resolver over the #227 identity tables. Mirrors `createFamilyStore`: its own `node:sqlite`
 * connection on the shared family DB file, prepared statements, no ORM. `CREATE TABLE IF NOT EXISTS` makes
 * it self-standing (and harmless when family-store already created the tables — same DDL, same file). At
 * N=1 every lookup resolves to our one real family; the seam is what lets "one family → many" become a
 * data change, not a code change.
 */
export function createFamilyResolver(dbPath: string): FamilyResolver {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_FAMILIES_TABLE);
  db.exec(CREATE_FAMILY_MEMBERS_TABLE);
  db.exec(CREATE_FAMILY_PHONES_TABLE);

  // Parameterized: the PK `(family_id, from_phone)` makes a phone unique per family, and a phone never
  // legitimately belongs to two families (the binding ceremony rejects a cross-family re-bind), so there is
  // at most one row. `from_phone` is bound digit-normalized — the single read-side guard that keeps the
  // comparison exact against the normalized form the binding/seed wrote.
  //
  // `ORDER BY family_id` before `LIMIT 1` makes the result DETERMINISTIC even IF that one-family-per-phone
  // invariant is ever broken upstream: a chokepoint with no RLS backstop must never silently flap between
  // families across calls. A DB-level `UNIQUE(from_phone)`/`UNIQUE(user_id)` would enforce the invariant
  // outright, but that touches the #228 ceremony + seed write contracts — deferred to the N>1/RLS hardening.
  const byPhoneStmt = db.prepare(
    "SELECT family_id FROM family_phones WHERE from_phone = ? ORDER BY family_id LIMIT 1;",
  );
  const byUserStmt = db.prepare(
    "SELECT family_id, role FROM family_members WHERE user_id = ? ORDER BY family_id LIMIT 1;",
  );
  // uid↔member binding — match on the LOWER-cased email so a config "Arie@Gmail.com" resolves the JWT's
  // "arie@gmail.com". Parameterized + deterministic, exactly like byUserStmt (the cross-tenant chokepoint).
  // The `email` column is added by createFamilyStore's self-healing ALTER on a pre-existing (#235-era) table;
  // this resolver's CREATE-IF-NOT-EXISTS won't add it, so it relies on the store booting FIRST (index.ts
  // builds the store before the resolver). Fresh DBs get the column straight from the CREATE DDL above.
  const byEmailStmt = db.prepare(
    "SELECT family_id, role FROM family_members WHERE LOWER(email) = ? ORDER BY family_id LIMIT 1;",
  );

  // #226 — one lookup feeds both the familyId scope and the role gate; resolveFamilyByUser delegates to it.
  // A plain local fn (not a `this.` method) so destructured callers keep working.
  function resolveMembership(userId: string): { familyId: string; role: string } | null {
    const row = byUserStmt.get(userId) as { family_id: string; role: string } | undefined;
    return row ? { familyId: row.family_id, role: row.role } : null;
  }

  return {
    resolveFamilyByPhone(fromPhone) {
      const normalized = normalizePhone(fromPhone);
      if (normalized === "") return null; // empty/garbage phone never resolves (mirrors isAllowed)
      const row = byPhoneStmt.get(normalized) as { family_id: string } | undefined;
      return row?.family_id ?? null;
    },
    resolveFamilyByUser(userId) {
      return resolveMembership(userId)?.familyId ?? null;
    },
    resolveMembership,
    resolveMembershipByEmail(email) {
      const normalized = normalizeEmail(email);
      if (normalized === "") return null; // empty/garbage email never resolves (mirrors the phone guard)
      const row = byEmailStmt.get(normalized) as { family_id: string; role: string } | undefined;
      return row ? { familyId: row.family_id, role: row.role } : null;
    },
  };
}
