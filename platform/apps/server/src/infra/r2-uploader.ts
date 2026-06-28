import { readFile } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
import type { Uploader } from "./backup.ts";

/**
 * #134 — the real offsite `Uploader` (replaces `noopUploader`). Sends the WAL-safe `VACUUM INTO`
 * snapshot to a Cloudflare R2 bucket (S3-compatible, EU jurisdiction) via SigV4. Each family's
 * snapshots live under their own `prefix` ("one replica prefix per family file") — today the single
 * `family_id` "default"; backup.ts stays tenant-agnostic and the prefix concern lives here.
 *
 * The DB carries app-encrypted Google tokens, so only ciphertext leaves the box; the bucket is
 * private and the token is least-privilege (object R/W/List/Delete on this one bucket).
 */
export interface R2Config {
  /** Account endpoint, no bucket, no trailing slash — e.g. `https://<acct>.eu.r2.cloudflarestorage.com`. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Object-key prefix = the `family_id` ("default" today). */
  prefix: string;
}

/** Injected so unit tests run fully offline (the signed `Request` is asserted, never sent). */
export type FetchLike = (input: Request) => Promise<Response>;

// Snapshot keys are `homeos-YYYY-MM-DD-HH-MM-SS.db` (UTC, from backupDatabase) — possibly behind a
// prefix. Parse the timestamp straight from the key so freshness/age never depend on the store's
// own LastModified clock.
const KEY_TS = /homeos-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.db$/;

/** The UTC instant encoded in a snapshot key, or `null` if the key isn't a snapshot. */
export function snapshotKeyDate(key: string): Date | null {
  const m = KEY_TS.exec(key);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
}

export function r2Uploader(cfg: R2Config, fetchImpl: FetchLike = (r) => fetch(r)): Uploader {
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto", // R2 ignores region but SigV4 requires one
  });
  const base = `${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}`;
  const objectKey = (key: string) => `${cfg.prefix}/${key}`;

  async function send(url: string, init: RequestInit): Promise<Response> {
    const signed = await aws.sign(url, init);
    const res = await fetchImpl(signed);
    if (!res.ok) {
      throw new Error(`R2 ${init.method ?? "GET"} ${url} → ${res.status} ${res.statusText}`);
    }
    return res;
  }

  // S3 ListObjectsV2 returns XML; we only need the <Key> values. Retention normally keeps the set
  // small (~4/day × 14d ≈ 56 ≪ the 1000-key page limit), but an aggressive cadence could exceed a
  // page — and since keys sort chronologically, a truncated first page would hold only the OLDEST
  // keys (false "stale" alert + incomplete prune). So follow the continuation token to the end.
  async function listKeys(): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const params = new URLSearchParams({ "list-type": "2", prefix: `${cfg.prefix}/` });
      if (token) params.set("continuation-token", token);
      const res = await send(`${base}?${params}`, { method: "GET" });
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]!);
      const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
      token = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml) && next ? next[1] : undefined;
    } while (token);
    return keys;
  }

  return {
    async upload(localPath: string, key: string): Promise<void> {
      const body = await readFile(localPath);
      await send(`${base}/${objectKey(key)}`, {
        method: "PUT",
        body,
        headers: { "content-type": "application/octet-stream" },
      });
    },

    async prune(retentionDays: number, now: Date): Promise<void> {
      const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
      for (const key of await listKeys()) {
        const ts = snapshotKeyDate(key);
        if (ts && ts.getTime() < cutoff) {
          await send(`${base}/${key}`, { method: "DELETE" });
        }
      }
    },

    async latestUploadAt(): Promise<Date | null> {
      let latest: number | null = null;
      for (const key of await listKeys()) {
        const ts = snapshotKeyDate(key);
        if (ts && (latest === null || ts.getTime() > latest)) latest = ts.getTime();
      }
      return latest === null ? null : new Date(latest);
    },
  };
}
