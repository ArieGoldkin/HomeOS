// Load .env when present (local dev); no-op in hosted envs where vars are injected (e.g. Railway).
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { anthropicCallModel, createAgent } from "./core/agent.ts";
import { scheduleDigest } from "./core/digest.ts";
import { processInbound } from "./core/handler.ts";
import { createEventStore } from "./db/event-store.ts";
import { createInboundStore } from "./db/inbound-store.ts";
import { httpGmailClient } from "./google/gmail.ts";
import { buildGoogleDeps } from "./http/oauth-routes.ts";
import { createServer } from "./http/server.ts";
import type { InboundMessage } from "./http/webhook.ts";
import { noopUploader, scheduleBackup } from "./infra/backup.ts";
import { anthropicRawParse, createParser } from "./parsing/parser.ts";
import { extractEventsTool, type GmailToolDeps, readGmailTool } from "./tools/tools.ts";
import { createWhatsAppClient } from "./whatsapp/client.ts";

// Fail fast if the environment is misconfigured (missing token, empty allowlist, …).
const config = loadConfig();

const log = (msg: string, meta?: Record<string, unknown>) =>
  console.log(JSON.stringify({ msg, ...meta }));

const wa = createWhatsAppClient(config);
const events = createEventStore(config.dbPath);
const inbound = createInboundStore(config.dbPath);
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

// The tool-using agent: a bounded loop reusing `parse`. extract_events handles forwards; read_gmail
// (registered only when Google is configured) handles the סנכרן מייל sync. Two model surfaces, one credential.
const agent = createAgent({
  callModel: anthropicCallModel(anthropic, config.anthropicModel),
  tools: gmailDeps ? [extractEventsTool(parse), readGmailTool(parse)] : [extractEventsTool(parse)],
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
    members: config.members,
    maxPerSenderPerDay: config.maxPerSenderPerDay,
    google: gmailDeps,
    log,
  });

const app = createServer({
  verifyToken: config.verifyToken,
  inbound,
  process: runInbound,
  events,
  readToken: config.readToken,
  appSecret: config.appSecret,
  google: googleDeps,
  log,
});

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
