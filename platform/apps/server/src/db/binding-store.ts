import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { normalizePhone } from "../core/allowlist.ts";
import { sqliteUtc } from "../core/time.ts";
import { CREATE_FAMILY_PHONES_TABLE, CREATE_PHONE_BINDING_TABLE } from "./schema.ts";

// node:sqlite is a newer builtin bundlers don't externalize cleanly — load via createRequire (as the
// other stores do) so Node resolves it directly at runtime.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/** ~10-min TTL — long enough to copy the code from the browser to WhatsApp, short enough to bound a leak. */
const BINDING_TTL_MS = 10 * 60 * 1000;
/** Code length after the `HOME-` prefix. */
const CODE_LEN = 5;
/** Unambiguous alphabet — no 0/O, 1/I/L (the user retypes the code, so glyph confusion is a real cost). */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** Bound the (astronomically unlikely) PK-collision retry so a pathological RNG can't loop forever. */
const MINT_ATTEMPTS = 5;

/**
 * The result of consuming a binding code (#228) — rich enough to drive the three distinct Hebrew replies
 * the ceremony needs and to keep the cross-tenant safety explicit:
 *  - `bound`        — a valid pending code; the phone is now (or was already) bound to `familyId`.
 *  - `wrong_family` — a valid pending code, but this phone is ALREADY bound to a DIFFERENT family; rejected.
 *  - `null`         — no valid pending code (wrong / expired / already-consumed); nothing written.
 */
export type BindResult = { status: "bound"; familyId: string } | { status: "wrong_family" } | null;

/**
 * Phone-binding ceremony store (#228) — the SECURITY CHOKEPOINT that turns a web-session code + a
 * WhatsApp echo into a durable `from_phone → family_id` mapping (the bot write path's PRIMARY guard, no
 * RLS backstop). Mirrors `credential-store`'s `oauth_state` primitive: own `node:sqlite` connection,
 * single-use `DELETE … RETURNING`, read-time TTL, injected clock. It owns the ephemeral `phone_binding`
 * table AND writes the durable `family_phones` row (precedent: `credential-store` owns `credentials` +
 * `oauth_state` over one handle). Deliberately NO single-family guard here (unlike `credential-store`):
 * this is the seam every future tenant routes through, built correct from day one — safety comes from the
 * code's unguessability + TTL + single-use consumption, not a `FAMILY_ID` assert.
 */
export interface BindingStore {
  /** Mint a single-use `HOME-XXXXX` code for `familyId`, persisted with a ~10-min TTL. */
  issueBinding(familyId: string): string;
  /**
   * Consume a code echoed from `fromPhone`: single-use + read-time-TTL'd (`DELETE … RETURNING`). On a
   * valid pending code, bind the (normalized) phone to the code's family — unless the phone is already
   * bound to a different family. The phone is normalized identically to the allowlist/resolver path so
   * the binding actually resolves later (#229).
   */
  matchBinding(code: string, fromPhone: string): BindResult;
}

export function createBindingStore(
  dbPath: string,
  now: () => Date = () => new Date(),
): BindingStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_PHONE_BINDING_TABLE);
  // Idempotent — we WRITE the durable result here. The table is owned by #227's schema; ensuring it
  // exists keeps this store self-contained regardless of store construction order.
  db.exec(CREATE_FAMILY_PHONES_TABLE);

  const insertCodeStmt = db.prepare(
    "INSERT INTO phone_binding (code, family_id, expires_at) VALUES (?, ?, ?);",
  );
  // Peek a code's family WITHOUT consuming — so a cross-family echo is rejected before we burn the
  // legitimate family's single-use code (otherwise the real member would have to re-issue).
  const peekCodeStmt = db.prepare(
    "SELECT family_id FROM phone_binding WHERE code = ? AND expires_at > ?;",
  );
  // Single-use + read-time TTL: delete-and-return in one step (no read-then-delete race), exactly the
  // `oauth_state` consumeState shape. A returned row ⇒ the code was valid and is now gone.
  const consumeCodeStmt = db.prepare(
    "DELETE FROM phone_binding WHERE code = ? AND expires_at > ? RETURNING family_id;",
  );
  const existingPhoneStmt = db.prepare("SELECT family_id FROM family_phones WHERE from_phone = ?;");
  const bindPhoneStmt = db.prepare(
    "INSERT OR IGNORE INTO family_phones (family_id, from_phone, verified_at) VALUES (?, ?, ?);",
  );

  function mintCode(): string {
    let code = "HOME-";
    // charAt (not [i]) returns a definite string under noUncheckedIndexedAccess; randomInt is uniform.
    for (let i = 0; i < CODE_LEN; i++)
      code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
    return code;
  }

  return {
    issueBinding(familyId) {
      const expiresAt = sqliteUtc(new Date(now().getTime() + BINDING_TTL_MS));
      // Retry ONLY on the (astronomically unlikely) PK collision; never loops on anything else.
      for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
        const code = mintCode();
        try {
          insertCodeStmt.run(code, familyId, expiresAt);
          return code;
        } catch (err) {
          // Retry ONLY a PK collision (two mints landing on the same code); rethrow anything else at once.
          const isCollision = err instanceof Error && /UNIQUE constraint/i.test(err.message);
          if (!isCollision || attempt === MINT_ATTEMPTS - 1) throw err;
        }
      }
      throw new Error("failed to mint a unique binding code"); // unreachable; satisfies the type checker
    },
    matchBinding(code, fromPhone) {
      const phone = normalizePhone(fromPhone);
      const nowSqlite = sqliteUtc(now());
      // This function's own wrong-family rejection + the (family_id, from_phone) PK maintain the
      // "one family per phone" invariant, so this unscoped lookup returns at most one row.
      const existing = existingPhoneStmt.get(phone) as unknown as { family_id: string } | undefined;
      // Peek the code's family BEFORE consuming, so a cross-family echo is rejected without burning the
      // legitimate single-use code.
      const pending = peekCodeStmt.get(code, nowSqlite) as unknown as
        | { family_id: string }
        | undefined;
      if (!pending) return null; // wrong / expired / already-consumed → nothing written
      if (existing && existing.family_id !== pending.family_id) return { status: "wrong_family" };
      // Valid + same/new family → NOW consume (single-use) and bind. A lost peek→consume race (another
      // process consumed in between) returns null here — benign, never a double-bind.
      const consumed = consumeCodeStmt.get(code, nowSqlite) as unknown as
        | { family_id: string }
        | undefined;
      if (!consumed) return null;
      // New bind, or an idempotent re-bind to the SAME family (INSERT OR IGNORE on the PK).
      bindPhoneStmt.run(consumed.family_id, phone, nowSqlite);
      return { status: "bound", familyId: consumed.family_id };
    },
  };
}
