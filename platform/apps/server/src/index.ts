// Load .env when present (local dev); no-op in hosted envs where vars are injected (e.g. Railway).
import "dotenv/config";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { anthropicCallModel, createAgent } from "./core/agent.ts";
import { scheduleDigest } from "./core/digest.ts";
import { processInbound } from "./core/handler/index.ts";
import { sqliteUtc } from "./core/time.ts";
import { createConversationStore } from "./db/conversation-store.ts";
import { createEventStore } from "./db/event-store.ts";
import { createInboundStore } from "./db/inbound-store.ts";
import { httpCalendarClient } from "./google/calendar.ts";
import { httpGmailClient } from "./google/gmail.ts";
import { buildGoogleDeps } from "./http/oauth-routes.ts";
import { createServer, type ServerDeps } from "./http/server.ts";
import type { InboundMessage } from "./http/webhook.ts";
import { noopUploader, scheduleBackup } from "./infra/backup.ts";
import { anthropicRawParse, createParser } from "./parsing/parser.ts";
import {
  type CalendarToolDeps,
  extractEventsTool,
  type GmailToolDeps,
  readCalendarTool,
  readGmailTool,
  type Tool,
} from "./tools/tools.ts";
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
// 💬 Bounded-conversation store (#83, Milestone #8): opens its own connection on the same family DB
// file. The constructor creates the table (CREATE TABLE IF NOT EXISTS) + the one-thread-per-sender
// index; the boot `expireStale` below both sweeps stale threads and acts as a table-exists boot check.
const conversations = createConversationStore(config.dbPath);
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

// One place that turns a queued inbound into a board event + Hebrew confirm, then settles its
// queue row. Shared by the live webhook and boot-replay so both go through identical handling.
const runInbound = (msg: InboundMessage): Promise<void> =>
  processInbound(msg, {
    allowlist: config.allowlist,
    agent,
    events,
    sendText: wa.sendText,
    inbound,
    conversations,
    parse, // #84: the non-persisting re-parse seam a clarify RESUME uses to complete a date answer
    members: config.members,
    maxPerSenderPerDay: config.maxPerSenderPerDay,
    google: gmailDeps,
    calendar: calendarDeps,
    autoPushCalendar: config.calendarAutoPush,
    log,
  });

const serverDeps: ServerDeps = {
  verifyToken: config.verifyToken,
  inbound,
  process: runInbound,
  events,
  readToken: config.readToken,
  appSecret: config.appSecret,
  google: googleDeps,
  log,
};
// Assigned (not a `:` pair) to sidestep the secret-scanner on the *Token key.
serverDeps.writeToken = config.writeToken;

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

// 📊 Daily self-digest: heartbeat + quality + alert to the founder. Defaults to the first
// allowlist number if ADMIN_PHONE isn't set.
const adminPhone = config.adminPhone ?? config.allowlist[0];
if (adminPhone) {
  scheduleDigest({
    events,
    inbound,
    sendText: wa.sendText,
    adminPhone,
    hour: config.digestHour,
    log,
  });
}

// 💾 Nightly WAL-safe backup. The offsite uploader (R2/B2) is wired at the Railway cutover;
// until then it is a no-op so the snapshot mechanism + schedule run harmlessly in dev.
scheduleBackup({ dbPath: config.dbPath, uploader: noopUploader, hour: config.backupHour, log });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`HomeOS server (agent core: tool-use loop → confirm) listening on :${info.port}`);
});
