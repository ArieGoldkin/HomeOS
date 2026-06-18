import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, parseKey } from "../../src/google/crypto.ts";

const key = randomBytes(32);

describe("crypto — AES-256-GCM at rest (OG1/OG2/OG11)", () => {
  it("round-trips plaintext, including Hebrew and a long token", () => {
    for (const plain of ["secret-token", "רענן את הטוקן", "x".repeat(4096)]) {
      expect(decrypt(encrypt(plain, key), key)).toBe(plain);
    }
  });

  it("uses a fresh IV per call — two encrypts of the same plaintext differ, both decrypt", () => {
    const a = encrypt("same", key);
    const b = encrypt("same", key);
    expect(a).not.toBe(b); // distinct IV ⇒ distinct blob (OG11: IV reuse under GCM is catastrophic)
    expect(decrypt(a, key)).toBe("same");
    expect(decrypt(b, key)).toBe("same");
  });

  it("throws on a tampered blob (auth tag verified — OG2)", () => {
    const buf = Buffer.from(encrypt("secret", key), "base64");
    const last = buf.length - 1;
    buf.writeUInt8(buf.readUInt8(last) ^ 0xff, last); // flip the last ciphertext byte
    expect(() => decrypt(buf.toString("base64"), key)).toThrow();
  });

  it("throws when decrypting with the wrong key", () => {
    const blob = encrypt("secret", key);
    expect(() => decrypt(blob, randomBytes(32))).toThrow();
  });

  it("throws on a too-short blob (no room for iv+tag)", () => {
    expect(() => decrypt(randomBytes(8).toString("base64"), key)).toThrow();
  });
});

describe("parseKey", () => {
  it("returns a 32-byte buffer for a valid base64 key", () => {
    expect(parseKey(randomBytes(32).toString("base64"))).toHaveLength(32);
  });

  it("throws on a wrong-length key (fail-fast at boot, names the var)", () => {
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/GOOGLE_TOKEN_ENC_KEY/);
    expect(() => parseKey("")).toThrow(/GOOGLE_TOKEN_ENC_KEY/);
  });
});
