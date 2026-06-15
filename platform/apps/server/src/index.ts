// Load .env when present (local dev); no-op in hosted envs where vars are injected (e.g. Railway).
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { createEventStore } from "./db/event-store.ts";
import { createInboundStore } from "./db/inbound-store.ts";
import { processInbound } from "./core/handler.ts";
import { anthropicRawParse, createParser } from "./parsing/parser.ts";
import { createServer } from "./http/server.ts";
import type { InboundMessage } from "./http/webhook.ts";
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

// One place that turns a queued inbound into a board event + Hebrew confirm, then settles its
// queue row. Shared by the live webhook and boot-replay so both go through identical handling.
const runInbound = (msg: InboundMessage): Promise<void> =>
  processInbound(msg, {
    allowlist: config.allowlist,
    parse,
    events,
    sendText: wa.sendText,
    inbound,
    log,
  });

const app = createServer({ verifyToken: config.verifyToken, inbound, process: runInbound, log });

// 🔁 Boot-replay: re-process anything persisted but never finished before the last shutdown
// or crash (the ack-then-process window). Meta only retries non-2xx, so this is our safety net.
const backlog = inbound.pending();
if (backlog.length > 0) {
  log("replaying pending inbound on boot", { count: backlog.length });
  for (const msg of backlog) void runInbound(msg);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`HomeOS server (M2: parse → confirm) listening on :${info.port}`);
});
