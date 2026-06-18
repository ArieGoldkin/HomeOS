import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCredentialStore, type StoredCredential } from "../../src/db/credential-store.ts";
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
});
