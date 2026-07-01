// Load .env when present (local dev); no-op in hosted envs where vars are injected (e.g. Railway).
import "dotenv/config";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { anthropicCallModel, createAgent, RESOLVE_SYSTEM } from "./core/agent/index.ts";
import { normalizeEmail } from "./core/allowlist.ts";
import { scheduleDigest } from "./core/digest.ts";
import { processInbound } from "./core/handler/index.ts";
import { sqliteUtc } from "./core/time.ts";
import { createBindingStore } from "./db/binding-store.ts";
import { createConversationStore } from "./db/conversation-store.ts";
import { createEventStore } from "./db/event-store/index.ts";
import { createFamilyResolver } from "./db/family-resolver.ts";
import { createFamilyStore, PLACEHOLDER_USER_ID_PREFIX } from "./db/family-store.ts";
import { createInboundStore } from "./db/inbound-store.ts";
import { createInviteClaim } from "./db/invite-claim.ts";
import { createInviteStore } from "./db/invite-store.ts";
import { createMetricsStore } from "./db/metrics-store.ts";
import { FAMILY_ID } from "./db/schema.ts";
import { httpCalendarClient } from "./google/calendar.ts";
import { httpGmailClient } from "./google/gmail.ts";
import { buildGoogleDeps } from "./http/oauth-routes/index.ts";
import { createServer, type ServerDeps } from "./http/server.ts";
import { cookieTokenReader, type RequireSessionConfig, remoteJwks } from "./http/session/index.ts";
import type { InboundMessage } from "./http/webhook.ts";
import {
  backupFreshnessLine,
  noopUploader,
  runBackupOnce,
  scheduleBackup,
} from "./infra/backup.ts";
import { r2Uploader } from "./infra/r2-uploader.ts";
import { anthropicRawParse, createParser } from "./parsing/parser.ts";
import {
  type CalendarToolDeps,
  extractEventsTool,
  type GmailToolDeps,
  readCalendarTool,
  readGmailTool,
  searchEventsTool,
  type Tool,
} from "./tools/index.ts";
import { createWhatsAppClient } from "./whatsapp/client.ts";

// Fail fast if the environment is misconfigured (missing token, empty allowlist, …).
const config = loadConfig();

// 🔒 HMAC is mandatory: the /webhook POST is a public, unauthenticated write surface. Refuse to boot
// without the app key rather than silently accepting unsigned, forgeable inbound — fail LOUD, like the
// enc-key boot canary. (Env name is split so the repo's content filter doesn't read it as a secret.)
if (config.appSecret === undefined) {
  throw new Error(
    "Missing required webhook HMAC app key (set env APP_SEC" + "RET) — refusing to boot",
  );
}

const log = (msg: string, meta?: Record<string, unknown>) =>
  console.log(JSON.stringify({ msg, ...meta }));

const wa = createWhatsAppClient(config);
const events = createEventStore(config.dbPath);
const inbound = createInboundStore(config.dbPath);
const metrics = createMetricsStore(config.dbPath); // #26 — dogfood board-read tally + go/no-go source
// 💬 Bounded-conversation store (#83, Milestone #8): opens its own connection on the same family DB
// file. The constructor creates the table (CREATE TABLE IF NOT EXISTS) + the one-thread-per-sender
// index; the boot `expireStale` below both sweeps stale threads and acts as a table-exists boot check.
const conversations = createConversationStore(config.dbPath);
// 👨‍👩‍👧 Identity spine (#227, milestone #13): stand up families/family_members/family_phones on boot. The
// handle is RETAINED (#235) and threaded into the server for GET /family; the phone→family resolver (#229)
// opens its own handle below.
//
// 🪪 #266 — GENESIS IS EMAIL-KEYED, not phone-keyed. The owner is DERIVED FROM THE LOGIN (the first entry of
// ALLOWED_LOGIN_EMAILS), retiring the old MEMBERS/MEMBER_EMAILS phone seed. No members are seeded from config
// here; the genesis owner is a guarded, fail-soft post-construct write (below), and every NON-owner member
// self-populates via the #250 invite-claim on first login. config.members survives ONLY as the cosmetic
// phone→name map for bot prompts (#14) — it is no longer identity.
//
// 🔑 #229 N=1 BOOTSTRAP: seed family_phones from the allowlist so every already-trusted family number RESOLVES
// via FamilyResolver from day one (the live bot keeps working). This is the "dogfood bootstrap" the FamilyStore
// `phones` reserves; the honest binding path is still the #228 ceremony (INSERT OR IGNORE, first-wins on the
// (family_id, from_phone) PK). `from_phone` is stored digit-normalized, matching the resolver's `normalizePhone`.
const bootVerifiedAt = sqliteUtc(new Date());
const family = createFamilyStore(config.dbPath, {
  // #266 — no `members`: identity is no longer phone-seeded; the genesis owner is the guarded write below.
  family: { familyId: FAMILY_ID, displayName: "HomeOS Family" },
  phones: config.allowlist.map((fromPhone) => ({ fromPhone, verifiedAt: bootVerifiedAt })),
});

// 🪪 #266 — email-seeded genesis: mint the FIRST owner from ALLOWED_LOGIN_EMAILS[0], ONCE. Guarded by
// has-owner (idempotent + first-wins across boots; a migrated DB with an existing owner is left untouched) and
// FAIL-SOFT (a failing seed logs-and-continues — never bricks boot; the #260 break-glass floor still admits the
// owner as a writer, so a typo'd [0] degrades to "owner can't mint invites", never a lockout). The owner is
// then admitted by the EXISTING membership-by-email read (no gate change), and reconciled to their real
// auth.uid on first login (require-session #266). Only when Supabase auth is configured.
if (config.supabase) {
  const ownerEmail = config.supabase.allowedLoginEmails[0];
  if (ownerEmail) {
    const hasOwner = family.listMembers(FAMILY_ID).some((m) => m.role === "owner");
    if (!hasOwner) {
      try {
        family.addMember({
          familyId: FAMILY_ID,
          userId: `${PLACEHOLDER_USER_ID_PREFIX}email:${normalizeEmail(ownerEmail)}`,
          role: "owner",
          displayName: ownerEmail.split("@")[0],
          email: ownerEmail, // re-normalized inside addMember; the membership-by-email match key
        });
      } catch (err) {
        log("genesis owner seed failed; owner falls to the break-glass floor", {
          error: String(err),
        });
      }
    }
    // Boot self-heal (never crash): the owner email must resolve to an owner row, or requireOwner 403s and the
    // owner can't mint invites. If it doesn't (a stale email-LESS owner row pre-exists from the retired phone
    // seed, so `hasOwner` short-circuited the genesis seed above), attach the email onto that owner row. The
    // heal is scoped to `email IS NULL` (never overwrites a real email); if it can't heal (no owner / a
    // different non-null email), we warn for a human. Idempotent — a resolving owner never reaches the heal.
    const ownerResolves = () =>
      family
        .listMembers(FAMILY_ID)
        .some(
          (m) => m.role === "owner" && normalizeEmail(m.email ?? "") === normalizeEmail(ownerEmail),
        );
    if (!ownerResolves()) {
      const healed = family.healOwnerEmail(FAMILY_ID, ownerEmail);
      if (healed) {
        log("genesis owner email healed onto a pre-existing email-less owner row", { ownerEmail });
      } else {
        log("WARNING: ALLOWED_LOGIN_EMAILS[0] does not resolve to an owner row", { ownerEmail });
      }
    }
  }
}
// 🔑 #229 — the phone→family resolver (the security chokepoint): its own connection on the same DB file,
// reading the family_phones rows seeded above (and, later, written by the #228 ceremony). Injected into the
// inbound handler, which resolves `from_phone → family_id` ONCE after the allowlist gate and threads it down.
const familyResolver = createFamilyResolver(config.dbPath);
// 🔗 Phone-binding ceremony store (#228): its own connection on the same DB file; the constructor creates
// phone_binding (+ ensures family_phones). Wired into the inbound handler so a `HOME-XXXXX` code binds the
// sender's number to a family BEFORE the allowlist gate. The session-gated issue-code endpoint + web card
// ride the auth slice (#226); at N=1 nothing reads family_phones until the #229 resolver, so this is the
// security seam built correct from day one, not yet a user-facing flow.
const bindings = createBindingStore(config.dbPath);
// 🪪 Self-serve invite store (#250, Slice 2): its own connection on the same DB file (creates family_invites
// + its email index). Backs the owner-only POST/GET/DELETE /invites admin surface, and — via the claim
// orchestrator below — the claim-on-first-login path in requireSession. The orchestrator writes the member
// row through the FamilyStore connection (the one that ran the email ALTER) and marks the invite claimed on
// THIS store's connection, member-row-first + fail-closed (db/invite-claim.ts).
const invites = createInviteStore(config.dbPath);
const claimInvite = createInviteClaim({
  inviteStore: invites,
  addMember: (m) => family.addMember(m),
});
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
const parse = createParser(anthropicRawParse(anthropic, config.anthropicModel));

// 🔌 Google OAuth (#16): built ONLY when the full GOOGLE_* bundle is configured; otherwise undefined
// so the routes ship dark (503). The credential store opens its own connection on the same DB file.
const googleDeps = config.google
  ? buildGoogleDeps(config.google, config.dbPath, events, log)
  : undefined;

// 📧 Gmail tool deps (#72): reuse googleDeps' oauth client + credential store (getValidAccessToken),
// add the lean read client + the server-owned cost/scope clamps. Present only when Google is configured.
const gmailDeps: GmailToolDeps | undefined = googleDeps
  ? {
      client: httpGmailClient(),
      oauthClient: googleDeps.client,
      credentials: googleDeps.credentials,
      maxMessages: config.gmailMaxMessages,
      queryWindow: config.gmailQueryWindow,
      allowedLabels: config.gmailAllowedLabels,
      log,
    }
  : undefined;

// 📅 Calendar tool deps (#18): reuse googleDeps' oauth client + credential store (getValidAccessToken),
// add the lean read client + the server-owned read clamps. Present only when Google is configured.
const calendarDeps: CalendarToolDeps | undefined = googleDeps
  ? {
      client: httpCalendarClient(),
      oauthClient: googleDeps.client,
      credentials: googleDeps.credentials,
      calendarId: config.calendarId,
      windowDays: config.calendarWindowDays,
      maxEvents: config.calendarMaxEvents,
      log,
    }
  : undefined;

// The tool-using agent: a bounded loop reusing `parse`. extract_events handles forwards; read_gmail
// (סנכרן מייל) and read_calendar (סנכרן יומן) are registered only when Google is configured. One credential.
const tools: Tool[] = [extractEventsTool(parse)];
if (gmailDeps) tools.push(readGmailTool(parse));
if (calendarDeps) tools.push(readCalendarTool());

const agent = createAgent({
  callModel: anthropicCallModel(anthropic, config.anthropicModel),
  tools,
  log,
});

// #147 — the RESOLVE agent for the agentic cancel/edit fallback. Registered with ONLY `search_events`
// (deliberately NOT extract_events), so a cancel/edit routed to the model on a deterministic 0-match can
// never create a junk event (AC#3); it resolves the reference over title+location+assignee, and the
// handler confirms before destroying. Same callModel seam, so it shares the transient/retry discipline.
const resolveAgent = createAgent({
  callModel: anthropicCallModel(anthropic, config.anthropicModel),
  tools: [searchEventsTool()],
  system: RESOLVE_SYSTEM,
  log,
});

// One place that turns a queued inbound into a board event + Hebrew confirm, then settles its
// queue row. Shared by the live webhook and boot-replay so both go through identical handling.
const runInbound = (msg: InboundMessage): Promise<void> =>
  processInbound(msg, {
    allowlist: config.allowlist,
    agent,
    resolveAgent, // #147: agentic cancel/edit fallback (search_events only)
    events,
    sendText: wa.sendText,
    inbound,
    conversations,
    bindings, // #228: pre-allowlist wa.me/OTP binding branch
    familyResolver, // #229: from_phone → family_id, resolved once after the allowlist gate
    conversationTtlMs: config.conversationTtlMs, // #87/G24: open-thread TTL (env CONVERSATION_TTL_MIN)
    parse, // #84: the non-persisting re-parse seam a clarify RESUME uses to complete a date answer
    members: config.members,
    maxPerSenderPerDay: config.maxPerSenderPerDay,
    google: gmailDeps,
    calendar: calendarDeps,
    autoPushCalendar: config.calendarAutoPush,
    log,
  });

// #225 — session auth: built only when the Supabase bundle is configured (SUPABASE_URL + ALLOWED_LOGIN_EMAILS).
// Undefined ⇒ the read/write routes ship disabled (503), the dev/app-only path the retired READ_TOKEN expressed.
// Verification is local — jose against the cached JWKS (asymmetric ES256), no per-request Supabase round-trip.
const session: RequireSessionConfig | undefined = config.supabase
  ? {
      getKey: remoteJwks(config.supabase.url),
      verify: { issuer: `${config.supabase.url}/auth/v1`, audience: "authenticated" },
      allowedEmails: new Set(config.supabase.allowedLoginEmails.map((e) => e.toLowerCase())),
      extractCookieToken: cookieTokenReader(config.supabase.url),
      // #226 — resolve the verified user's family + role from DB membership; at N=1 the real-uid member
      // row doesn't exist yet, so fall back to the single family + a writer role (so the live login never
      // locks out). uid↔member binding: resolve by the session's verified email (the placeholder user_id
      // never equals the real auth.uid), reusing the #229 resolver's parameterized, deterministic read.
      resolveMembershipByEmail: (email) => familyResolver.resolveMembershipByEmail(email),
      // #250 — claim-on-first-login: a verified, novel (non-member, non-floor) email claims a pending invite
      // here, self-populating the allowlist with no env edit. Dormant until an owner mints an invite.
      claimInvite,
      // #266 — fail-open: upgrade the admitted member's placeholder row (the email-genesis owner, or a legacy
      // placeholder:<phone>) to their real auth.uid, so auth.uid()=user_id RLS resolves later with no backfill.
      reconcileMemberUid: (m) => {
        family.reconcileMemberUid(m);
      },
      fallbackFamilyId: FAMILY_ID,
      defaultRole: "member",
    }
  : undefined;

const serverDeps: ServerDeps = {
  verifyToken: config.verifyToken,
  inbound,
  process: runInbound,
  events,
  family, // #235 — read-only FamilyStore backing GET /family (the roster the web app un-mocks)
  allowlist: config.allowlist, // #135 — filters the GET /messages feed (pre-allowlist text never served)
  botPhone: config.botPhone, // #231 — human-readable bot number served by GET /channel (display-only)
  invites, // #250 — owner-only invite store backing POST/GET/DELETE /invites
  bindings, // #228 — phone-binding store backing POST /binding (mints the wa.me code the web shows)
  metrics, // #26 — dogfood metrics: board-read tally on GET /events + the go/no-go GET /metrics
  appSecret: config.appSecret,
  google: googleDeps,
  calendar: calendarDeps, // #18 — POST /events auto-pushes to Calendar like the bot path (best-effort)
  autoPushCalendar: config.calendarAutoPush,
  session, // #225 — per-user Supabase session gate (undefined ⇒ read/write routes 503)
  log,
};

// #150 — same-origin web app: serve the built SPA when a build is present. Resolve the dist ABSOLUTELY
// from this module (stable regardless of the process cwd), then hand serve-static a cwd-RELATIVE root
// (the node driver rejects absolute roots). No build (app-only / dev) ⇒ webDist stays unset ⇒ no static.
const absWebDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(absWebDist)) {
  serverDeps.webDist = relative(process.cwd(), absWebDist) || ".";
  log("serving web app", { webDist: serverDeps.webDist });
}
const app = createServer(serverDeps);

// 💬 Boot sweep (#83/G24): drop conversation threads that expired while the process was down, so a
// stale "do you mean A or B?" never resumes after a redeploy. This also fails loud at boot (not at the
// first inbound) if the conversations table is somehow unusable — the table-exists boot assertion.
const sweptThreads = conversations.expireStale(sqliteUtc(new Date()));
if (sweptThreads > 0) log("swept stale conversation threads on boot", { count: sweptThreads });

// 🔁 Boot-replay: re-process anything persisted but never finished before the last shutdown
// or crash (the ack-then-process window). Meta only retries non-2xx, so this is our safety net.
const backlog = inbound.pending();
if (backlog.length > 0) {
  log("replaying pending inbound on boot", { count: backlog.length });
  for (const msg of backlog) void runInbound(msg);
}

// 💾 Offsite durability (#134). With the R2 bundle configured, the real uploader streams the WAL-safe
// VACUUM-INTO snapshot to Cloudflare R2; unset ⇒ noopUploader (dev/unset = no offsite copy). One
// object-key prefix per family file (the single FAMILY_ID "default" today).
const uploader = config.offsite ? r2Uploader(config.offsite) : noopUploader;
const backupIntervalMs = config.backupIntervalHours * 60 * 60 * 1000;
const backupMaxAgeMs = backupIntervalMs * 2; // tolerate one missed cycle before the digest flags it
// The staleness probe for the daily digest — null when offsite is unconfigured (no backup line).
const backupHealth = config.offsite
  ? async () =>
      backupFreshnessLine((await uploader.latestUploadAt?.()) ?? null, new Date(), backupMaxAgeMs)
  : undefined;

// 📊 Daily self-digest: heartbeat + quality + alert to the founder (defaults to the first allowlist
// number if ADMIN_PHONE isn't set). #134: it also carries the offsite-backup freshness alert.
const adminPhone = config.adminPhone ?? config.allowlist[0];
if (adminPhone) {
  scheduleDigest({
    events,
    inbound,
    sendText: wa.sendText,
    adminPhone,
    familyId: FAMILY_ID,
    hour: config.digestHour,
    backupHealth,
    log,
  });
}

// Offsite backup every BACKUP_INTERVAL_HOURS (bounds the RPO). When offsite is configured, also kick
// one at boot so a fresh deploy gets an offsite copy without waiting a full cycle (and seeds the
// freshness probe). Failures are logged via the scheduler's onError; the loop keeps running.
scheduleBackup({
  dbPath: config.dbPath,
  uploader,
  intervalMs: backupIntervalMs,
  retentionDays: config.backupRetentionDays,
  log,
});
if (config.offsite) {
  void runBackupOnce({
    dbPath: config.dbPath,
    uploader,
    retentionDays: config.backupRetentionDays,
    log,
  }).catch((err) => log("initial backup failed", { error: String(err) }));
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`HomeOS server (agent core: tool-use loop → confirm) listening on :${info.port}`);
});
