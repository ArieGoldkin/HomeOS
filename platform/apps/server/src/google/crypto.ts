import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM secret-at-rest primitive (OG1). Zero new deps (node:crypto). Each secret is one
 * self-framing base64 blob `iv(12) | tag(16) | ciphertext`:
 *  - a FRESH 12-byte random IV per `encrypt` (OG11 — IV reuse under GCM is catastrophic);
 *  - the 16-byte auth tag is verified on `decrypt` (OG2 — skipping it turns GCM into unauthenticated CTR).
 * `decrypt` THROWS on tamper / wrong key / truncation; callers (CredentialStore.get) catch → degrade
 * to app-only (null), never crash the pipeline. Key loss ⇒ re-consent, never a plaintext fallback.
 */
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

/** base64 → 32-byte key; THROWS at boot (naming the env var) on the wrong length — fail-fast. */
export function parseKey(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(
      `GOOGLE_TOKEN_ENC_KEY must be a base64-encoded 32-byte key (got ${key.length} bytes). ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

/** plaintext → base64(iv | tag | ciphertext). Fresh IV every call. */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** base64(iv | tag | ciphertext) → plaintext. THROWS on tamper / wrong key / too-short. */
export function decrypt(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("ciphertext blob too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag); // final() throws if the tag doesn't verify
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
