import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { sqliteUtc } from "../core/time.ts";
import { decrypt, encrypt } from "../google/crypto.ts";
import {
  CREATE_CREDENTIALS_TABLE,
  CREATE_KEY_CANARY_TABLE,
  CREATE_OAUTH_STATE_TABLE,
  type CredentialRow,
} from "./schema.ts";

// node:sqlite is a newer builtin bundlers don't externalize cleanly — load via createRequire (as
// event-store.ts does) so Node resolves it directly at runtime.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/** Hard-coded provider; bound as a `?` param everywhere (no injection surface). */
const PROVIDER = "google";
/** Env var name holding the AES key — referenced in the boot-canary error (named, not a value). */
const ENC_KEY_ENV = "GOOGLE_TOKEN_ENC_KEY";
/** Fixed plaintext marker the boot canary encrypts/verifies (MF4). Not a secret. */
const CANARY_MARKER = "homeos.google.oauth.canary.v1";
/** OAuth `state` TTL — ~10 min, plenty for a consent round-trip (OG7). */
const STATE_TTL_MS = 10 * 60 * 1000;

export interface StoredCredential {
  refreshToken: string;
  accessToken: string;
  /** SQLite-UTC string, lexicographically comparable; not a secret, stored plaintext. */
  expiry: string;
  scopes: string[];
}

/**
 * Per-family encrypted credential store (#58). Tokens are AES-256-GCM at rest (OG1) — this is NOT
 * the EventStore and NOT plaintext config. `get` decrypts and, on any decrypt failure (tamper /
 * wrong key / corruption), returns `null` so the caller degrades to app-only and the pipeline never
 * crashes. The one place a decrypt failure DOES surface loudly is the boot key-canary.
 */
export interface CredentialStore {
  get(familyId: string): StoredCredential | null;
  upsert(familyId: string, cred: StoredCredential): void;
  /** Refresh path: rewrite only the access token + expiry; the refresh token is left untouched. */
  updateTokens(familyId: string, accessToken: string, expiry: string): void;
  /** Disconnect / revoke / degrade. Returns the number of rows removed. */
  delete(familyId: string): number;
  // --- OAuth state / CSRF (OG7), folded in over the same DB handle ---
  /** Mint a single-use, family-bound, ~10-min `state` for the consent redirect. */
  issueState(familyId: string): string;
  /** Atomically consume a `state` — true iff it was valid, unexpired, and bound to `familyId`. */
  consumeState(state: string, familyId: string): boolean;
}

export function createCredentialStore(
  dbPath: string,
  key: Buffer,
  now: () => Date = () => new Date(),
): CredentialStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_CREDENTIALS_TABLE);
  db.exec(CREATE_KEY_CANARY_TABLE);
  db.exec(CREATE_OAUTH_STATE_TABLE);

  // Boot key-canary (MF4): written once on first init, verified on every later boot. A changed key
  // fails LOUD here instead of letting every credential silently degrade-to-app-only (which would
  // look like "nobody connected"). Matches OG12 — a changed key is a misconfig → re-consent.
  const canary = db.prepare("SELECT enc_canary FROM credential_key_canary WHERE id = 1;").get() as
    | { enc_canary: string }
    | undefined;
  if (canary) {
    let ok = false;
    try {
      ok = decrypt(canary.enc_canary, key) === CANARY_MARKER;
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new Error(
        `Encryption key mismatch: the configured ${ENC_KEY_ENV} cannot decrypt this database. ` +
          "Refusing to boot — stored credentials would all silently degrade to app-only. Restore the " +
          "original key, or delete the credentials to re-consent.",
      );
    }
  } else {
    db.prepare("INSERT INTO credential_key_canary (id, enc_canary) VALUES (1, ?);").run(
      encrypt(CANARY_MARKER, key),
    );
  }

  const selectStmt = db.prepare("SELECT * FROM credentials WHERE family_id = ? AND provider = ?;");
  // Upsert as update-then-insert (every value bound; no self-referential ON CONFLICT clause).
  const updateAllStmt = db.prepare(
    `UPDATE credentials
       SET enc_refresh_token = ?, enc_access_token = ?, access_token_expiry = ?, scopes = ?,
           updated_at = datetime('now')
     WHERE family_id = ? AND provider = ?;`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO credentials
       (family_id, provider, enc_refresh_token, enc_access_token, access_token_expiry, scopes)
     VALUES (?, ?, ?, ?, ?, ?);`,
  );
  const updateTokensStmt = db.prepare(
    `UPDATE credentials
       SET enc_access_token = ?, access_token_expiry = ?, updated_at = datetime('now')
     WHERE family_id = ? AND provider = ?;`,
  );
  const deleteStmt = db.prepare("DELETE FROM credentials WHERE family_id = ? AND provider = ?;");

  const insertStateStmt = db.prepare(
    "INSERT INTO oauth_state (state, family_id, expires_at) VALUES (?, ?, ?);",
  );
  // Atomic single-use: delete-and-return in one step (no read-then-delete race), bound to the family
  // and unexpired. A returned row ⇒ the state was valid and is now gone (OG7).
  const consumeStateStmt = db.prepare(
    "DELETE FROM oauth_state WHERE state = ? AND family_id = ? AND expires_at > ? RETURNING state;",
  );

  return {
    get(familyId) {
      const row = selectStmt.get(familyId, PROVIDER) as unknown as CredentialRow | undefined;
      if (!row) return null;
      try {
        return {
          refreshToken: decrypt(row.enc_refresh_token, key),
          accessToken: decrypt(row.enc_access_token, key),
          expiry: row.access_token_expiry,
          scopes: row.scopes ? row.scopes.split(",") : [],
        };
      } catch {
        return null; // corrupt / wrong-key blob → degrade to app-only, never throw into the pipeline
      }
    },
    upsert(familyId, cred) {
      const encRefresh = encrypt(cred.refreshToken, key);
      const encAccess = encrypt(cred.accessToken, key);
      const scopesCsv = cred.scopes.join(",");
      const changed = Number(
        updateAllStmt.run(encRefresh, encAccess, cred.expiry, scopesCsv, familyId, PROVIDER)
          .changes,
      );
      if (changed === 0) {
        insertStmt.run(familyId, PROVIDER, encRefresh, encAccess, cred.expiry, scopesCsv);
      }
    },
    updateTokens(familyId, accessToken, expiry) {
      updateTokensStmt.run(encrypt(accessToken, key), expiry, familyId, PROVIDER);
    },
    delete(familyId) {
      return Number(deleteStmt.run(familyId, PROVIDER).changes);
    },
    issueState(familyId) {
      const state = randomBytes(32).toString("base64url"); // unguessable
      const expiresAt = sqliteUtc(new Date(now().getTime() + STATE_TTL_MS));
      insertStateStmt.run(state, familyId, expiresAt);
      return state;
    },
    consumeState(state, familyId) {
      return consumeStateStmt.get(state, familyId, sqliteUtc(now())) !== undefined;
    },
  };
}

/**
 * Is a stored access token expired (or within `skewSeconds` of it)? Pure + injectable-clock so the
 * refresh decision is fake-clock testable. `expiry` is a SQLite-UTC string (fixed-width), so the
 * comparison is a plain lexicographic `>=`.
 */
export function isAccessTokenExpired(
  expiry: string,
  now: () => Date = () => new Date(),
  skewSeconds = 60,
): boolean {
  return sqliteUtc(new Date(now().getTime() + skewSeconds * 1000)) >= expiry;
}
