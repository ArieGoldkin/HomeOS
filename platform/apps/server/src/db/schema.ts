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
    status             TEXT    NOT NULL DEFAULT 'open',
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
 * #19 — idempotent migration: add the `status` column to a PRE-EXISTING events table (mirrors
 * ADD_EVENTS_SOURCE_PROVIDER). Fresh DBs get it from the DDL above; older DBs get it here. `NOT NULL
 * DEFAULT 'open'` is legal for SQLite ADD COLUMN precisely because the default backfills existing rows —
 * so every legacy task lands as "open" with no data-migration step.
 */
export const ADD_EVENTS_STATUS =
  "ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'open';";

/**
 * Inbound queue: every webhook message is persisted here BEFORE the 200 ack, so a crash
 * between ack and completion never silently drops it (boot-replays `status = 'pending'`).
 * The `wa_message_id` PRIMARY KEY is also the durable dedupe (Meta delivers at-least-once),
 * replacing the in-memory idempotency store. `status`: pending → done | failed.
 *
 * #135 — `outcome` is the FINER terminal disposition (parsed|clarified|rephrase|refused|rate_limited|
 * text_only) the coarse `status` can't express (all those settle as `done`). Nullable: command paths
 * (ביטול/sync/cancel/edit) and pending/failed rows leave it null. Set by `markDone(id, outcome)`.
 */
export const CREATE_INBOUND_TABLE = `
  CREATE TABLE IF NOT EXISTS inbound_messages (
    wa_message_id TEXT PRIMARY KEY,
    from_phone    TEXT NOT NULL,
    type          TEXT NOT NULL,
    text          TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    received_at   TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at  TEXT,
    outcome       TEXT
  );
`;

/**
 * #135 — idempotent migration: add `outcome` to a PRE-EXISTING inbound_messages table (mirrors
 * ADD_EVENTS_SOURCE_PROVIDER). Fresh DBs get it from the DDL above; older DBs get it here. Nullable.
 */
export const ADD_INBOUND_OUTCOME = "ALTER TABLE inbound_messages ADD COLUMN outcome TEXT;";

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
  status: string;
}

export interface InboundRow {
  wa_message_id: string;
  from_phone: string;
  type: string;
  text: string | null;
  status: string;
  received_at: string;
  processed_at: string | null;
  outcome: string | null;
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
 * Default / fallback family id for E2E scripts and tests; production resolves the family per request via
 * the {@link createFamilyResolver | FamilyResolver} (#229) — `from_phone → family_id` on the bot write
 * path, `user_id → family_id` on the browser read path. This is NO LONGER read on a production handler
 * path: the bot threads the resolved id from `handleInbound`, and the constant survives only as the
 * `familyOf` test/dev fallback, the composition-root seed/digest scope, and the E2E harnesses (which have
 * no session/phone to resolve from). The `(family_id, …)` PKs and `WHERE family_id = ?` queries are
 * isolation-ready; the browser/OAuth call sites finish threading when a real session lands (#226).
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
    email      TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * #231 — idempotent migration: add the connect-initiator `email` to a PRE-EXISTING oauth_state table
 * (CREATE IF NOT EXISTS won't alter it). Nullable: a state minted post-migration always carries the
 * session email (the callback enforces connected-email == this); pre-migration rows are transient
 * (TTL'd minutes) and fail closed at the callback.
 */
export const ADD_OAUTH_STATE_EMAIL = "ALTER TABLE oauth_state ADD COLUMN email TEXT;";

export interface OAuthStateRow {
  state: string;
  family_id: string;
  email: string | null;
  expires_at: string;
  created_at: string;
}

/**
 * Identity spine (#227, milestone #13) — three plain tables that replace the implicit single-tenancy
 * of {@link FAMILY_ID} with a real, queryable model for our one dogfood family. Schema + idempotent
 * seed ONLY: no resolver, no Postgres, no RLS, no Realtime (all deferred). At N=1, app-layer
 * `WHERE family_id = ?` is trivially correct — what would force Supabase-Postgres is cross-family RLS,
 * which one family never needs. Mirrors the already-`family_id`-keyed `credentials` / `oauth_state` shape.
 */
export const CREATE_FAMILIES_TABLE = `
  CREATE TABLE IF NOT EXISTS families (
    family_id    TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * `family_members(family_id, user_id, role)` — keyed to the Supabase `auth.uid()` so the browser read
 * path (`auth.uid() → family_members → family_id`) has something to resolve against (#226/#230). PK
 * `(family_id, user_id)` matches the `credentials` `(family_id, provider)` convention. `user_id` is a
 * PLACEHOLDER until the Supabase-login issue (#225) supplies the real `auth.uid()` — that issue is the
 * one seam this row completes. Absorbs the `family_members` concept as identity plumbing only (NOT the
 * closed #23 per-person-items feature).
 */
export const CREATE_FAMILY_MEMBERS_TABLE = `
  CREATE TABLE IF NOT EXISTS family_members (
    family_id    TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    role         TEXT NOT NULL,
    display_name TEXT,
    email        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (family_id, user_id)
  );
`;

/**
 * #235 — idempotent migration: add the `display_name` column to a PRE-EXISTING family_members table
 * (mirrors ADD_EVENTS_SOURCE_PROVIDER). Fresh DBs get it from the DDL above; older DBs (seeded by #227
 * before this column existed) get it here. Nullable — the boot seed upserts the real name from the #14
 * `config.members` map (`ON CONFLICT … DO UPDATE SET display_name`), so it backfills on the same boot.
 */
export const ADD_FAMILY_MEMBERS_DISPLAY_NAME =
  "ALTER TABLE family_members ADD COLUMN display_name TEXT;";

/**
 * uid↔member binding — idempotent migration: add the `email` column to a PRE-EXISTING family_members
 * table (same self-healing pattern as display_name). This is the login-identity link: the session's
 * verified, allowlisted email is matched against it (`resolveMembershipByEmail`) to derive the member's
 * real `{familyId, role}` — retiring the placeholder `user_id` for membership resolution. Nullable; the
 * boot seed upserts it from the new `MEMBER_EMAILS` (phone:email) config so it backfills on the same boot.
 */
export const ADD_FAMILY_MEMBERS_EMAIL = "ALTER TABLE family_members ADD COLUMN email TEXT;";

/**
 * `family_phones(family_id, from_phone, verified_at)` — the DURABLE result of the wa.me/OTP binding
 * ceremony (#228): a row here means "this WhatsApp number is proven to belong to this family." It is
 * what the bot write path (`from_phone → family_phones → family_id`) resolves against (#229) — the
 * security chokepoint with NO RLS backstop, so `from_phone` is stored digit-normalized (the same
 * `normalizePhone` the allowlist/inbound path uses) to keep resolver comparisons exact. PK
 * `(family_id, from_phone)` enforces one binding per phone per family. Seeded with NOTHING by default —
 * bindings are earned through the ceremony, never hardcoded.
 */
export const CREATE_FAMILY_PHONES_TABLE = `
  CREATE TABLE IF NOT EXISTS family_phones (
    family_id    TEXT NOT NULL,
    from_phone   TEXT NOT NULL,
    verified_at  TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (family_id, from_phone)
  );
`;

export interface FamilyRow {
  family_id: string;
  display_name: string;
  created_at: string;
}

export interface FamilyMemberRow {
  family_id: string;
  /** Supabase `auth.uid()`; a placeholder until #225 lands. */
  user_id: string;
  role: string;
  /** #235 — display name from the #14 `config.members` map; nullable column, but the boot seed upserts it
   *  for every config member, so it's populated for every seeded row (null only for a hypothetical
   *  non-config member written by a future path). */
  display_name: string | null;
  /** uid↔member binding — the member's login email (from the new `MEMBER_EMAILS` config), matched against
   *  the session's verified email to resolve real membership. Nullable: a member with no configured email
   *  isn't bindable yet and falls back. Stored as configured; matched case-insensitively. */
  email: string | null;
  created_at: string;
}

export interface FamilyPhoneRow {
  family_id: string;
  /** Digit-normalized (`normalizePhone`), as the resolver compares. */
  from_phone: string;
  verified_at: string;
  created_at: string;
}

/**
 * Ephemeral phone-binding claim (#228) — sibling to `oauth_state`: a single-use, TTL'd, family-bound
 * `DELETE … RETURNING` primitive. A `HOME-XXXXX` code is minted from the authenticated browser session
 * (`issueBinding`), the user echoes it to the bot over WhatsApp, and `matchBinding` consumes it to write
 * the DURABLE `family_phones` row. The web-session code IS the OTP; the WhatsApp echo IS the proof — no
 * restricted WhatsApp OTP template needed. `code` is the PK (short + human-typable, unguessable for a
 * 10-min TTL); `expires_at` is a SQLite-UTC string from the injected clock, checked at READ time so a
 * stale claim never binds. Single-use consumption + TTL + per-family scope bound the brute-force surface.
 */
export const CREATE_PHONE_BINDING_TABLE = `
  CREATE TABLE IF NOT EXISTS phone_binding (
    code       TEXT PRIMARY KEY,
    family_id  TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export interface PhoneBindingRow {
  code: string;
  family_id: string;
  expires_at: string;
  created_at: string;
}

/**
 * Owner-issued, email-scoped invite (#250, Slice 2) — the self-serve login-allowlist seam. An owner mints
 * a `pending` row scoped to their `family_id`; on the invitee's next Google login `requireSession` matches
 * the verified `email` against a pending row and CLAIMS it (writes the real-`auth.uid()` member row, marks
 * the invite `claimed`) — admission self-populates with no env edit. The security boundary is the email-pin:
 * the claim fires only when `claims.email` equals a pending invite's `email` AND Supabase proved control of
 * it (verified Google login), and lands in *that invite's* family — never a self-chosen one. `invite_id` is
 * an unguessable PK (the audit id + the DELETE handle); `email` is stored lower+trimmed (the claim match key
 * mirrors `family_members.email`); `expires_at` is a SQLite-UTC string checked at READ time (~14d TTL), so a
 * stale invite never claims. `token` is reserved from day one for the future shareable-link UX (option B) —
 * UNUSED by the email-pinned claim, purely additive later. Mirrors the `oauth_state`/`phone_binding` posture:
 * own connection, family-scoped, injected clock.
 */
export const CREATE_FAMILY_INVITES_TABLE = `
  CREATE TABLE IF NOT EXISTS family_invites (
    invite_id       TEXT PRIMARY KEY,
    family_id       TEXT NOT NULL,
    email           TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',
    token           TEXT,
    invited_by      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    expires_at      TEXT NOT NULL,
    claimed_user_id TEXT,
    claimed_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * The gate's pending-by-email lookup index (`findPendingByEmail` filters `email` + `status`). The
 * one-pending-per-(family,email) invariant is held in application code (`createInvite` supersedes any prior
 * pending row) rather than a partial UNIQUE — deferred to the RLS migration with the other constraints.
 */
export const CREATE_FAMILY_INVITES_EMAIL_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_family_invites_email ON family_invites(email, status);
`;

export interface InviteRow {
  invite_id: string;
  family_id: string;
  /** Lower+trimmed on write — the claim match key (mirrors `family_members.email`). */
  email: string;
  role: string;
  /** Reserved for the future shareable-link UX (option B); unused by the email-pinned claim. */
  token: string | null;
  /** Owner email/uid that minted the invite (audit). */
  invited_by: string | null;
  /** pending | claimed | revoked. */
  status: string;
  expires_at: string;
  /** The real `auth.uid()` the invite was claimed by (audit + future RLS). */
  claimed_user_id: string | null;
  claimed_at: string | null;
  created_at: string;
}

/**
 * Bounded multi-turn conversation thread (#83, Milestone #8) — the "ask → wait → resume" primitive
 * for clarify/cancel/edit, mirroring `inbound_messages`' pending→replay model. Slim 8 columns: the
 * per-kind variant lives in one `payload_json` blob (NOT typed columns), and `status` is pinned to
 * 'pending' because resolution DELETEs (single-use, like `oauth_state`) — only pending rows ever
 * exist. `expires_at` (SQLite-UTC, injected clock) is the TTL, checked at READ time so a stale
 * question never resumes. `kind`/`status` CHECKs keep the row well-formed at the DB layer.
 *
 * #232 — `family_id` (DEFAULT 'default') makes the table tenant-shaped. Inert at N=1, but it pivots
 * the one-pending-per-sender uniqueness to `(family_id, from_phone)` so a second family's pending
 * thread can never silently `INSERT OR REPLACE` over the first family's (a cross-tenant corruption the
 * moment the resolver #229 introduces a real second `family_id`). The `ConversationStore` signatures
 * stay unchanged — `create` omits the column, so every N=1 row falls to 'default'.
 */
export const CREATE_CONVERSATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS conversations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id    TEXT    NOT NULL DEFAULT 'default',
    from_phone   TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK(kind IN ('clarify','cancel','edit')),
    payload_json TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending' CHECK(status = 'pending'),
    expires_at   TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * #232 — idempotent migration: add `family_id` to a PRE-EXISTING conversations table (mirrors
 * ADD_EVENTS_STATUS). `NOT NULL DEFAULT 'default'` backfills every existing row to the constant in one
 * step — no separate UPDATE pass. Fresh DBs get the column from the DDL above; older DBs get it here.
 */
export const ADD_CONVERSATIONS_FAMILY_ID =
  "ALTER TABLE conversations ADD COLUMN family_id TEXT NOT NULL DEFAULT 'default';";

/**
 * #232 — drop the OLD single-column index so the composite one below can take its name. `CREATE … IF
 * NOT EXISTS` is a no-op when the index *name* already exists, so on an upgraded DB the old
 * `(from_phone)` index would otherwise persist and the pivot would silently not happen. The store runs
 * this whenever the live index isn't already the `(family_id, from_phone)` shape (PRAGMA index_info),
 * so the pivot self-heals even after a crash mid-migration.
 */
export const DROP_CONVERSATIONS_INDEX =
  "DROP INDEX IF EXISTS conversations_one_pending_per_sender;";

/**
 * DB-layer enforcement of "at most ONE open thread per sender" — the SQLite analogue of
 * `inbound_messages`' wa_message_id dedupe. Because resolution DELETEs, only pending rows exist, so a
 * UNIQUE on the sender suffices; `create` uses INSERT OR REPLACE to overwrite a prior thread. #232
 * pivots it to `(family_id, from_phone)` — same index name, scoped per family (inert at N=1, where
 * family_id is always 'default', so it's a superset of the old `(from_phone)` key).
 */
export const CREATE_CONVERSATIONS_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_pending_per_sender
    ON conversations(family_id, from_phone);
`;

export interface ConversationRow {
  id: number;
  /** #232 — tenant column; DEFAULT 'default' at N=1 until the resolver (#229) threads a real value. */
  family_id: string;
  from_phone: string;
  kind: string;
  payload_json: string;
  status: string;
  expires_at: string;
  created_at: string;
}
