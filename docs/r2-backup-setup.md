# Offsite backup setup — Cloudflare R2 (#134)

The server takes a WAL-safe `VACUUM INTO` snapshot of the SQLite DB every `BACKUP_INTERVAL_HOURS`
(default 6, plus once at boot) and streams it to a private **Cloudflare R2** bucket. This closes the
single-volume data-loss SPOF. The feature **ships dark** — until the four `R2_*` Railway vars below are
set, the uploader is a no-op (the local snapshot still runs harmlessly).

> The DB carries **app-encrypted** Google tokens, so only ciphertext ever leaves the box. Still: keep
> the bucket **private** and the API token **least-privilege**. EU jurisdiction keeps data residency in
> the EU (feeds #29).

## 1. Create the bucket (Cloudflare dashboard)

1. Cloudflare dashboard → **R2** → **Create bucket**.
2. Name: `homeos-db` (or your choice → set `R2_BUCKET`).
3. **Location / jurisdiction: European Union (EU)** — for data residency.
4. Leave public access **OFF** (private bucket).

## 2. Create a least-privilege API token

1. R2 → **Manage R2 API Tokens** → **Create API token**.
2. Permissions: **Object Read & Write** (covers PUT / GET / List / Delete).
3. Scope it to **the `homeos-db` bucket only** (not "all buckets").
4. Create → copy the **Access Key ID** and **Secret Access Key** (shown once).
5. Note the **S3 endpoint** for your account — for an EU-jurisdiction bucket it looks like
   `https://<account-id>.eu.r2.cloudflarestorage.com` (no bucket in the path).

## 3. Set the Railway vars (production)

All-or-nothing — set all four creds or none (a half-set bundle fails fast at boot):

```bash
railway variables --set R2_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com \
  --set R2_BUCKET=homeos-db \
  --set R2_ACCESS_KEY_ID=<access-key-id> \
  --set R2_SECRET_ACCESS_KEY=<secret-access-key>
# optional overrides (defaults shown):
# --set R2_PREFIX=default --set BACKUP_INTERVAL_HOURS=6 --set BACKUP_RETENTION_DAYS=14
```

(Or paste them into the Railway dashboard → Variables.) Deploys from the `production` branch as usual.

## 4. Verify after deploy

1. Railway logs should show `nightly backup uploaded` within `BACKUP_INTERVAL_HOURS` (and ~immediately
   at boot from the boot-kick).
2. R2 → the bucket → an object `default/homeos-<timestamp>.db` appears.
3. The next **daily digest** (WhatsApp to the founder) shows **no** backup warning line. A warning —
   `⚠️ הגיבוי לא עודכן…` / `⚠️ אין גיבוי עדכני…` — means the offsite copy is stale or missing.

## Restore

Download the newest `homeos-<timestamp>.db` from the bucket and point `DB_PATH` at it — it's a complete,
consistent SQLite file (produced via `VACUUM INTO`, not a torn copy).

## Notes

- `aws4fetch` (pinned) signs the S3 requests; `region` is `auto` (R2 ignores it). Local dev stays a
  no-op with the bundle unset.
- "One replica prefix per family file": today the single `family_id` `"default"` → `R2_PREFIX=default`.
  When multi-tenant lands (>1 family), each family's snapshots get their own prefix.
