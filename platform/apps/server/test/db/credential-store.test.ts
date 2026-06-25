import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCredentialStore,
  isAccessTokenExpired,
  type StoredCredential,
} from "../../src/db/credential-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const key = randomBytes(32);
const sample: StoredCredential = {
  refreshToken: "1//refresh-abc",
  accessToken: "ya29.access-xyz",
  expiry: "2026-06-18 12:00:00",
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar",
  ],
};

const tmpDirs: string[] = [];
function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "homeos-cred-"));
  tmpDirs.push(dir);
  return join(dir, "test.db");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("CredentialStore", () => {
  it("upserts and gets a credential round-trip", () => {
    const store = createCredentialStore(":memory:", key);
    store.upsert(FAMILY_ID, sample);
    expect(store.get(FAMILY_ID)).toEqual(sample);
  });

  it("returns null for an unknown family (app-only path, no throw)", () => {
    const store = createCredentialStore(":memory:", key);
    expect(store.get("nobody")).toBeNull();
  });

  it("updateTokens replaces the access token + expiry, leaving the refresh token intact", () => {
    const store = createCredentialStore(":memory:", key);
    store.upsert(FAMILY_ID, sample);
    store.updateTokens(FAMILY_ID, "ya29.NEW", "2026-06-18 13:00:00");
    const got = store.get(FAMILY_ID);
    expect(got?.accessToken).toBe("ya29.NEW");
    expect(got?.expiry).toBe("2026-06-18 13:00:00");
    expect(got?.refreshToken).toBe(sample.refreshToken); // refresh path never rewrites the refresh token
    expect(got?.scopes).toEqual(sample.scopes);
  });

  it("delete removes the credential and returns the count (idempotent)", () => {
    const store = createCredentialStore(":memory:", key);
    store.upsert(FAMILY_ID, sample);
    expect(store.delete(FAMILY_ID)).toBe(1);
    expect(store.get(FAMILY_ID)).toBeNull();
    expect(store.delete(FAMILY_ID)).toBe(0);
  });

  it("stores tokens ENCRYPTED — the raw row never contains the plaintext (AC1/OG1)", () => {
    const path = tmpDbPath();
    const store = createCredentialStore(path, key);
    store.upsert(FAMILY_ID, sample);
    // Read the raw bytes on disk via a second connection — the store can't hide them from itself.
    const raw = new DatabaseSync(path)
      .prepare("SELECT enc_refresh_token, enc_access_token FROM credentials;")
      .get() as { enc_refresh_token: string; enc_access_token: string };
    expect(raw.enc_refresh_token).not.toContain(sample.refreshToken);
    expect(raw.enc_access_token).not.toContain(sample.accessToken);
    expect(store.get(FAMILY_ID)?.refreshToken).toBe(sample.refreshToken); // but still decrypts
  });

  it("degrades to null (no throw) when a stored blob is corrupt", () => {
    const path = tmpDbPath();
    createCredentialStore(path, key).upsert(FAMILY_ID, sample);
    new DatabaseSync(path).prepare("UPDATE credentials SET enc_refresh_token = 'garbage';").run();
    const store = createCredentialStore(path, key); // canary still valid (same key) → boots fine
    expect(store.get(FAMILY_ID)).toBeNull();
  });

  it("boots on the same key but THROWS LOUD if the key changed (canary, MF4)", () => {
    const path = tmpDbPath();
    createCredentialStore(path, key); // writes the canary
    expect(() => createCredentialStore(path, key)).not.toThrow();
    expect(() => createCredentialStore(path, randomBytes(32))).toThrow(/GOOGLE_TOKEN_ENC_KEY/);
  });

  it("NEVER writes the encryption key into the DB — env-only (#61/MF4)", () => {
    const path = tmpDbPath();
    const store = createCredentialStore(path, key);
    store.upsert(FAMILY_ID, sample);
    // Scan the persisted bytes (main file + WAL) — the key must not appear as raw bytes, base64, or hex.
    const files = [path, `${path}-wal`].filter(existsSync).map((p) => readFileSync(p));
    const all = Buffer.concat(files);
    expect(all.includes(key)).toBe(false);
    const text = all.toString("latin1");
    expect(text).not.toContain(key.toString("base64"));
    expect(text).not.toContain(key.toString("hex"));
  });
});

describe("single-family dogfood guard (#110 — Phase-8 trip-wire in code)", () => {
  it("upsert and issueState work unchanged for the default family", () => {
    const store = createCredentialStore(":memory:", key);
    expect(() => store.upsert(FAMILY_ID, sample)).not.toThrow();
    expect(store.get(FAMILY_ID)).toEqual(sample);
    expect(store.issueState(FAMILY_ID)).toBeTruthy();
  });

  it("upsert throws the named single-family error for any other family", () => {
    const store = createCredentialStore(":memory:", key);
    expect(() => store.upsert("another-family", sample)).toThrowError(/single-family/);
  });

  it("issueState throws the named single-family error for any other family", () => {
    const store = createCredentialStore(":memory:", key);
    expect(() => store.issueState("another-family")).toThrowError(/single-family/);
  });
});

describe("oauth_state — CSRF store (OG7, single-use, family-bound)", () => {
  it("issues a state that consumes exactly once (single-use)", () => {
    const store = createCredentialStore(":memory:", key);
    const state = store.issueState(FAMILY_ID);
    expect(store.consumeState(state, FAMILY_ID)).toBe(true);
    expect(store.consumeState(state, FAMILY_ID)).toBe(false); // reused → already deleted
  });

  it("rejects a forged / never-issued state", () => {
    const store = createCredentialStore(":memory:", key);
    expect(store.consumeState("not-a-real-state", FAMILY_ID)).toBe(false);
  });

  it("is family-bound — a valid state won't consume for a different family", () => {
    const store = createCredentialStore(":memory:", key);
    const state = store.issueState(FAMILY_ID);
    expect(store.consumeState(state, "other-family")).toBe(false);
    expect(store.consumeState(state, FAMILY_ID)).toBe(true); // the failed attempt didn't delete it
  });

  it("expires after its TTL (fake clock)", () => {
    let nowMs = Date.parse("2026-06-18T12:00:00Z");
    const store = createCredentialStore(":memory:", key, () => new Date(nowMs));
    const state = store.issueState(FAMILY_ID);
    nowMs += 11 * 60 * 1000; // 11 min later — past the ~10 min TTL
    expect(store.consumeState(state, FAMILY_ID)).toBe(false);
  });
});

describe("isAccessTokenExpired (pure, 60s skew)", () => {
  const now = () => new Date(Date.parse("2026-06-18T12:00:00Z"));
  it("false when the expiry is comfortably in the future", () => {
    expect(isAccessTokenExpired("2026-06-18 12:30:00", now)).toBe(false);
  });
  it("true once past the expiry", () => {
    expect(isAccessTokenExpired("2026-06-18 11:00:00", now)).toBe(true);
  });
  it("true within the 60s skew window (near-expiry counts as expired → refresh early)", () => {
    expect(isAccessTokenExpired("2026-06-18 12:00:30", now)).toBe(true); // 30s ahead < 60s skew
  });
});
