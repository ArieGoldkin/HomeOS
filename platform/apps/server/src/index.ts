// Load .env when present (local dev); no-op in hosted envs where vars are injected (e.g. Railway).
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { createEventStore } from "./db.ts";
import { createIdempotencyStore } from "./idempotency.ts";
import { anthropicRawParse, createParser } from "./parse.ts";
import { createServer } from "./server.ts";
import { createWhatsAppClient } from "./whatsapp.ts";

// Fail fast if the environment is misconfigured (missing token, empty allowlist, …).
const config = loadConfig();

const wa = createWhatsAppClient(config);
const store = createIdempotencyStore();
const events = createEventStore(config.dbPath);
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
const parse = createParser(anthropicRawParse(anthropic, config.anthropicModel));

const app = createServer({
  verifyToken: config.verifyToken,
  handler: {
    allowlist: config.allowlist,
    store,
    parse,
    events,
    sendText: wa.sendText,
    log: (msg, meta) => console.log(JSON.stringify({ msg, ...meta })),
  },
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`HomeOS server (M2: parse → confirm) listening on :${info.port}`);
});
