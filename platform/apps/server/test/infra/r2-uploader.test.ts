import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FetchLike, r2Uploader, snapshotKeyDate } from "../../src/infra/r2-uploader.ts";

const cfg = {
  endpoint: "https://acct.eu.r2.cloudflarestorage.com",
  bucket: "homeos-db",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
  prefix: "default",
};

/** A fake fetch that records every signed Request and replies from a method+url router. */
function fakeFetch(reply: (req: Request) => Response): { calls: Request[]; fetch: FetchLike } {
  const calls: Request[] = [];
  return {
    calls,
    fetch: async (req: Request) => {
      calls.push(req);
      return reply(req);
    },
  };
}

const listXml = (keys: string[]) =>
  `<?xml version="1.0"?><ListBucketResult>${keys
    .map((k) => `<Contents><Key>${k}</Key></Contents>`)
    .join("")}</ListBucketResult>`;

describe("snapshotKeyDate", () => {
  it("parses the UTC instant from a snapshot key (with or without a prefix)", () => {
    expect(snapshotKeyDate("default/homeos-2026-06-28-03-00-00.db")).toEqual(
      new Date("2026-06-28T03:00:00.000Z"),
    );
    expect(snapshotKeyDate("homeos-2026-01-02-23-59-59.db")).toEqual(
      new Date("2026-01-02T23:59:59.000Z"),
    );
  });
  it("returns null for a non-snapshot key", () => {
    expect(snapshotKeyDate("default/notes.txt")).toBeNull();
  });
});

describe("r2Uploader.upload", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "homeos-r2-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("PUTs the snapshot to <endpoint>/<bucket>/<prefix>/<key>, SigV4-signed, with the file body", async () => {
    const local = join(dir, "homeos-2026-06-28-03-00-00.db");
    writeFileSync(local, "hello-db-bytes");
    const f = fakeFetch(() => new Response("", { status: 200 }));

    await r2Uploader(cfg, f.fetch).upload(local, "homeos-2026-06-28-03-00-00.db");

    expect(f.calls).toHaveLength(1);
    const req = f.calls[0]!;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe(
      "https://acct.eu.r2.cloudflarestorage.com/homeos-db/default/homeos-2026-06-28-03-00-00.db",
    );
    expect(req.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
    expect(await req.text()).toBe("hello-db-bytes");
  });

  it("throws when R2 rejects the upload (surfaces to the scheduler's onError)", async () => {
    const local = join(dir, "homeos-2026-06-28-03-00-00.db");
    writeFileSync(local, "x");
    const f = fakeFetch(() => new Response("denied", { status: 403, statusText: "Forbidden" }));

    await expect(
      r2Uploader(cfg, f.fetch).upload(local, "homeos-2026-06-28-03-00-00.db"),
    ).rejects.toThrow(/403/);
  });
});

describe("r2Uploader.prune", () => {
  it("LISTs the prefix and DELETEs only snapshots older than the retention window", async () => {
    const keys = [
      "default/homeos-2026-06-01-03-00-00.db", // 27 days old → delete
      "default/homeos-2026-06-20-03-00-00.db", // 8 days old → keep
      "default/homeos-2026-06-28-03-00-00.db", // today → keep
    ];
    const f = fakeFetch((req) =>
      req.method === "GET"
        ? new Response(listXml(keys), { status: 200 })
        : new Response(null, { status: 204 }),
    );

    await r2Uploader(cfg, f.fetch).prune!(14, new Date("2026-06-28T03:00:00Z"));

    const deletes = f.calls.filter((c) => c.method === "DELETE").map((c) => c.url);
    expect(deletes).toEqual([
      "https://acct.eu.r2.cloudflarestorage.com/homeos-db/default/homeos-2026-06-01-03-00-00.db",
    ]);
  });
});

describe("r2Uploader.latestUploadAt", () => {
  it("returns the newest snapshot's timestamp", async () => {
    const keys = [
      "default/homeos-2026-06-20-03-00-00.db",
      "default/homeos-2026-06-28-09-00-00.db",
      "default/homeos-2026-06-25-03-00-00.db",
    ];
    const f = fakeFetch(() => new Response(listXml(keys), { status: 200 }));
    const latest = await r2Uploader(cfg, f.fetch).latestUploadAt!();
    expect(latest).toEqual(new Date("2026-06-28T09:00:00.000Z"));
  });

  it("returns null when the bucket is empty", async () => {
    const f = fakeFetch(() => new Response(listXml([]), { status: 200 }));
    expect(await r2Uploader(cfg, f.fetch).latestUploadAt!()).toBeNull();
  });
});
