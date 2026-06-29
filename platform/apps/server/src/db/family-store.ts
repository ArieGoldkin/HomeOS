import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { normalizePhone } from "../core/allowlist.ts";
import {
  ADD_FAMILY_MEMBERS_DISPLAY_NAME,
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
 * One-time, idempotent seed for our single dogfood family (#227). The composition root (index.ts)
 * builds `members` from the existing `config.members` (#14 phone:name) map, with a PLACEHOLDER
 * `userId` until the Supabase-login issue (#225) supplies the real `auth.uid()`. `phones` is optional
 * and intended ONLY for a commented dogfood bootstrap — the real path earns `family_phones` bindings
 * through the wa.me/OTP ceremony (#228), so production seeding leaves it empty.
 */
export interface FamilySeed {
  family: { familyId: string; displayName: string };
  members: Array<{ userId: string; role: string; displayName: string }>;
  phones?: Array<{ fromPhone: string; verifiedAt: string }>;
}

/**
 * Read-shaped identity store (#227). Mirrors `createCredentialStore`: its own `node:sqlite` connection
 * on the shared family DB file, prepared statements, no ORM. WRITES beyond the boot seed belong to the
 * binding ceremony (#228 → `family_phones`) and the phone→family resolver (#229 reads all three) — so
 * this issue's surface is deliberately read-only. At N=1 every lookup is `WHERE family_id = ?`, which
 * is trivially correct with no second tenant to leak to (no RLS needed; that's deferred).
 */
export interface FamilyStore {
  getFamily(familyId: string): FamilyRow | null;
  listMembers(familyId: string): FamilyMemberRow[];
  listPhones(familyId: string): FamilyPhoneRow[];
}

export function createFamilyStore(dbPath: string, seed?: FamilySeed): FamilyStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_FAMILIES_TABLE);
  db.exec(CREATE_FAMILY_MEMBERS_TABLE);
  db.exec(CREATE_FAMILY_PHONES_TABLE);
  // #235: ensure `display_name` exists on a PRE-EXISTING family_members table (#227 seeded it before this
  // column existed; CREATE IF NOT EXISTS won't add it). Fresh DBs get it from the DDL; older DBs here. The
  // seed below upserts the real name, so this backfills on the same boot (mirrors event-store/index.ts).
  const memberCols = db.prepare("PRAGMA table_info(family_members);").all() as Array<{
    name: string;
  }>;
  if (!memberCols.some((c) => c.name === "display_name")) db.exec(ADD_FAMILY_MEMBERS_DISPLAY_NAME);

  // Idempotent seed — `INSERT OR IGNORE` (= ON CONFLICT DO NOTHING on the PKs) is safe on every boot,
  // the same posture as the credential_key_canary seed. Re-running never duplicates or overwrites.
  if (seed) {
    db.prepare("INSERT OR IGNORE INTO families (family_id, display_name) VALUES (?, ?);").run(
      seed.family.familyId,
      seed.family.displayName,
    );
    // #235: role stays FIRST-WINS (frozen at first boot, NOT in the DO UPDATE set), but `display_name` is
    // upserted so a config.members rename reflects on the next boot AND so rows seeded before the column
    // existed (#227) get backfilled. ON CONFLICT targets the (family_id, user_id) PK.
    const insertMember = db.prepare(
      "INSERT INTO family_members (family_id, user_id, role, display_name) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(family_id, user_id) DO UPDATE SET display_name = excluded.display_name;",
    );
    for (const m of seed.members) {
      insertMember.run(seed.family.familyId, m.userId, m.role, m.displayName);
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
  };
}
