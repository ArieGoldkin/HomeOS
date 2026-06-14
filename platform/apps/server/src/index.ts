// Load .env when present (local dev); no-op in hosted envs where vars are injected (e.g. Railway).
import "dotenv/config";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { createIdempotencyStore } from "./idempotency.ts";
import { createServer } from "./server.ts";
import { createWhatsAppClient } from "./whatsapp.ts";

// Fail fast if the environment is misconfigured (missing token, empty allowlist, …).
const config = loadConfig();

const wa = createWhatsAppClient(config);
const store = createIdempotencyStore();

const app = createServer({
  verifyToken: config.verifyToken,
  handler: {
    allowlist: config.allowlist,
    store,
    sendText: wa.sendText,
    log: (msg, meta) => console.log(JSON.stringify({ msg, ...meta })),
  },
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`HomeOS server (M1 echo bot) listening on :${info.port}`);
});
