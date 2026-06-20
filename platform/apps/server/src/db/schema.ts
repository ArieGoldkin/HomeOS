/**
 * Single-family events table. DDL kept as plain SQL for node:sqlite; a query builder
 * (Drizzle) can be layered later behind the EventStore interface without touching callers.
 * One message can yield several events, so each row carries a `seq` (its index within the
 * message) and uniqueness is on `(wa_message_id, seq)` — re-processing the same inbound (e.g.
 * boot-replay) is a no-op upsert per event rather than a duplicate row. Weekly `recurrence`
 * is stored as freq + weekday columns; `assignee` is the family member it's for.
 */
export const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    kind               TEXT    NOT NULL,
    title_he           TEXT    NOT NULL,
    date_iso           TEXT    NOT NULL,
    time               TEXT,
    location           TEXT,
    assignee           TEXT,
    recurrence_freq    TEXT,
    recurrence_weekday INTEGER,
    source_text        TEXT    NOT NULL,
    from_phone         TEXT    NOT NULL,
    wa_message_id      TEXT    NOT NULL,
    seq                INTEGER NOT NULL DEFAULT 0,
    source_provider    TEXT,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(wa_message_id, seq)
  );
`;

/**
 * Idempotent migration: add `source_provider` to a PRE-EXISTING events table (#61/MF5). `CREATE TABLE
 * IF NOT EXISTS` won't alter a live table, so fresh DBs get the column from the DDL above and older DBs
 * get it here. Nullable: forwarded/WhatsApp rows stay null; #17/#18 tag derived rows so disconnect purges them.
 */
export const ADD_EVENTS_SOURCE_PROVIDER = "ALTER TABLE events ADD COLUMN source_provider TEXT;";

/**
 * Inbound queue: every webhook message is persisted here BEFORE the 200 ack, so a crash
 * between ack and completion never silently drops it (boot-replays `status = 'pending'`).
 * The `wa_message_id` PRIMARY KEY is also the durable dedupe (Meta delivers at-least-once),
 * replacing the in-memory idempotency store. `status`: pending → done | failed.
 */
export const CREATE_INBOUND_TABLE = `
  CREATE TABLE IF NOT EXISTS inbound_messages (
    wa_message_id TEXT PRIMARY KEY,
    from_phone    TEXT NOT NULL,
    type          TEXT NOT NULL,
    text          TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    received_at   TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at  TEXT
  );
`;

export interface EventRow {
  id: number;
  kind: string;
  title_he: string;
  date_iso: string;
  time: string | null;
  location: string | null;
  assignee: string | null;
  recurrence_freq: string | null;
  recurrence_weekday: number | null;
  source_text: string;
  from_phone: string;
  wa_message_id: string;
  seq: number;
  source_provider: string | null;
  created_at: string;
}

export interface InboundRow {
  wa_message_id: string;
  from_phone: string;
  type: string;
  text: string | null;
  status: string;
  received_at: string;
  processed_at: string | null;
}

/**
 * Per-family Google OAuth credential (#16/#58), AES-256-GCM encrypted at rest — NOT the EventStore,
 * NOT plaintext config. `(family_id, provider)` PK reserves multi-family + multi-provider isolation
 * (OG9) with no identity logic built now; `enc_key_version` reserves key-rotation schema with NO
 * rotation code (OG12 — key loss ⇒ re-consent, never a plaintext fallback). `access_token_expiry` is
 * a lexicographically-comparable SQLite-UTC string. Both token columns hold a base64 `iv|tag|ct` blob.
 */
export const CREATE_CREDENTIALS_TABLE = `
  CREATE TABLE IF NOT EXISTS credentials (
    family_id           TEXT    NOT NULL DEFAULT 'default',
    provider            TEXT    NOT NULL DEFAULT 'google',
    enc_refresh_token   TEXT    NOT NULL,
    enc_access_token    TEXT    NOT NULL,
    access_token_expiry TEXT    NOT NULL,
    scopes              TEXT    NOT NULL,
    enc_key_version     INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (family_id, provider)
  );
`;

/**
 * Single-row key canary (MF4). On first init the store writes one encrypted canary; every later boot
 * decrypts it and FAILS LOUD if the key changed — instead of letting every credential silently
 * degrade-to-app-only (which would look like "nobody connected"). CHECK(id = 1) keeps it a single row.
 */
export const CREATE_KEY_CANARY_TABLE = `
  CREATE TABLE IF NOT EXISTS credential_key_canary (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    enc_canary TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

export interface CredentialRow {
  family_id: string;
  provider: string;
  enc_refresh_token: string;
  enc_access_token: string;
  access_token_expiry: string;
  scopes: string;
  enc_key_version: number;
  created_at: string;
  updated_at: string;
}

/**
 * The single family id used everywhere until Phase 8. A constant, NOT a resolved identity — named
 * explicitly so OG9 ("per-family isolation") isn't hand-wavy. Phase 8 swaps it for a real resolver;
 * the `(family_id, provider)` PK and `WHERE family_id = ?` queries are already isolation-ready.
 */
export const FAMILY_ID = "default";

/**
 * Short-lived OAuth `state` rows (#59) — the CSRF control (OG7). Issued at /connect, consumed once at
 * the callback via an atomic `DELETE … RETURNING` (no read-then-delete race), family-bound and
 * expiry-checked. `expires_at` is a SQLite-UTC string from the injected clock (MF2), so single-use
 * survives a Railway redeploy mid-grant (an in-memory Map would be lost).
 */
export const CREATE_OAUTH_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS oauth_state (
    state      TEXT PRIMARY KEY,
    family_id  TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export interface OAuthStateRow {
  state: string;
  family_id: string;
  expires_at: string;
  created_at: string;
}

/**
 * Bounded multi-turn conversation thread (#83, Milestone #8) — the "ask → wait → resume" primitive
 * for clarify/cancel/edit, mirroring `inbound_messages`' pending→replay model. Slim 7 columns: the
 * per-kind variant lives in one `payload_json` blob (NOT typed columns), and `status` is pinned to
 * 'pending' because resolution DELETEs (single-use, like `oauth_state`) — only pending rows ever
 * exist. `expires_at` (SQLite-UTC, injected clock) is the TTL, checked at READ time so a stale
 * question never resumes. `kind`/`status` CHECKs keep the row well-formed at the DB layer.
 */
export const CREATE_CONVERSATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS conversations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    from_phone   TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK(kind IN ('clarify','cancel','edit')),
    payload_json TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending' CHECK(status = 'pending'),
    expires_at   TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * DB-layer enforcement of "at most ONE open thread per sender" — the SQLite analogue of
 * `inbound_messages`' wa_message_id dedupe. Because resolution DELETEs, only pending rows exist, so a
 * plain UNIQUE on `from_phone` suffices; `create` uses INSERT OR REPLACE to overwrite a prior thread.
 */
export const CREATE_CONVERSATIONS_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_pending_per_sender
    ON conversations(from_phone);
`;

export interface ConversationRow {
  id: number;
  from_phone: string;
  kind: string;
  payload_json: string;
  status: string;
  expires_at: string;
  created_at: string;
}
