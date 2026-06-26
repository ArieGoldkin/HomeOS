// Load .env (GOOGLE_* bundle + ANTHROPIC_API_KEY) for local runs.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../src/config.ts";
import { anthropicCallModel, createAgent } from "../src/core/agent.ts";
import { handleInbound } from "../src/core/handler.ts";
import { createEventStore } from "../src/db/event-store/index.ts";
import { FAMILY_ID } from "../src/db/schema.ts";
import { httpGmailClient } from "../src/google/gmail.ts";
import { buildGoogleDeps } from "../src/http/oauth-routes.ts";
import { anthropicRawParse, createParser } from "../src/parsing/parser.ts";
import { extractEventsTool, type GmailToolDeps, readGmailTool } from "../src/tools/index.ts";

/**
 * Local end-to-end harness for the Gmail sync (#17) — runs the FULL pipeline WITHOUT WhatsApp:
 *
 *   handleInbound("סנכרן מייל")  →  agent forces read_gmail  →  REAL Gmail list/get
 *      →  REAL Claude parse  →  saveEvent(gmail:<id>, source_provider:"google")  →  Hebrew confirm
 *
 * It reads your REAL connected Gmail and calls REAL Claude (costs a few tokens, bounded by
 * GMAIL_MAX_MESSAGES), but the board lives in an IN-MEMORY store — so nothing is written to your
 * real DB. The Google CREDENTIAL is read from your real DB (config.dbPath), exactly where the
 * `/connect/google` flow stored it; an expired access token is refreshed for real.
 *
 * Prereqs (one-time): the GOOGLE_* bundle + ANTHROPIC_API_KEY in .env, and a connected account —
 * start the server (`pnpm dev`) and run, with your ADMIN_TOKEN:
 *   curl -sI -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/connect/google
 * open the `location:` URL, approve all scopes, then come back here.
 *
 * Run:  pnpm --filter @homeos/server gmail:e2e   (optionally append a sender, default = allowlist[0])
 */

const log = (msg: string, meta?: Record<string, unknown>) =>
  console.log(`   · ${msg}${meta ? ` ${JSON.stringify(meta)}` : ""}`);

async function main() {
  const config = loadConfig();

  if (!config.google) {
    console.error(
      "❌ The GOOGLE_* bundle is not set in .env — Gmail can't be synced.\n" +
        "   Set GOOGLE_CLIENT_ID / _SECRET / _REDIRECT_URI / _TOKEN_ENC_KEY + ADMIN_TOKEN (see docs/google-oauth-setup.md).",
    );
    process.exit(1);
  }

  // In-memory board (no pollution); the credential store opens your REAL db where /connect stored it.
  const events = createEventStore(":memory:");
  const googleDeps = buildGoogleDeps(config.google, config.dbPath, events, log);

  const cred = googleDeps.credentials.get(FAMILY_ID);
  if (!cred) {
    console.error(
      `❌ No Google credential stored for family "${FAMILY_ID}" in ${config.dbPath}.\n` +
        "   Connect first: start the server (pnpm dev), then with your ADMIN_TOKEN:\n" +
        '     curl -sI -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/connect/google\n' +
        "   open the redirect (location:) URL, approve, then re-run this script.",
    );
    process.exit(1);
  }

  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the env
  const parse = createParser(anthropicRawParse(anthropic, config.anthropicModel));
  const gmailDeps: GmailToolDeps = {
    client: httpGmailClient(),
    oauthClient: googleDeps.client,
    credentials: googleDeps.credentials,
    maxMessages: config.gmailMaxMessages,
    queryWindow: config.gmailQueryWindow,
    allowedLabels: config.gmailAllowedLabels,
    log,
  };
  const agent = createAgent({
    callModel: anthropicCallModel(anthropic, config.anthropicModel),
    tools: [extractEventsTool(parse), readGmailTool(parse)],
    log,
  });

  const replies: string[] = [];
  const sendText = async (to: string, body: string) => {
    replies.push(body);
    console.log(`\n📤 WhatsApp reply → ${to}:\n   ${body.replace(/\n/g, "\n   ")}\n`);
  };

  const from = process.argv[2] ?? config.allowlist[0]!;
  const deps = {
    allowlist: config.allowlist,
    agent,
    events,
    sendText,
    members: config.members,
    google: gmailDeps,
    log,
  };

  console.log("━".repeat(70));
  console.log("📧 HomeOS Gmail E2E — real Gmail + real Claude, in-memory board");
  console.log(
    `   model=${config.anthropicModel} · window=${config.gmailQueryWindow} · maxMessages=${config.gmailMaxMessages} · labels=[${config.gmailAllowedLabels.join(",")}]`,
  );
  console.log("━".repeat(70));
  console.log(`\n📨 Simulating WhatsApp:  "${from}"  →  "סנכרן מייל"\n`);

  await handleInbound({ id: `e2e-1-${Date.now()}`, from, type: "text", text: "סנכרן מייל" }, deps);

  const rows = events.listEvents();
  const gmailRows = rows.filter((r) => r.source_provider === "google");
  console.log(`📋 Board now has ${rows.length} event(s) — ${gmailRows.length} from Gmail:`);
  for (const r of gmailRows) {
    const when = `${r.date_iso}${r.time ? ` ${r.time}` : ""}`;
    const who = r.assignee ? ` · ${r.assignee}` : "";
    const loc = r.location ? ` @ ${r.location}` : "";
    console.log(`   • [${r.kind}] ${r.title_he} — ${when}${who}${loc}  (${r.source_provider})`);
  }
  if (gmailRows.length === 0) {
    console.log(
      "   (nothing matched — try a wider GMAIL_QUERY_WINDOW, or check the account has recent mail.)",
    );
  }

  // Prove idempotency (AC4): a second sync re-upserts the same gmail:<id> rows — count must not grow.
  console.log("\n🔁 Re-running to prove idempotency (gmail:<id>)…");
  await handleInbound({ id: `e2e-2-${Date.now()}`, from, type: "text", text: "סנכרן מייל" }, deps);
  const after = events.listEvents().filter((r) => r.source_provider === "google").length;
  console.log(
    `   Gmail rows: ${gmailRows.length} → ${after}  ${gmailRows.length === after ? "✅ idempotent" : "❌ DUPLICATED"}`,
  );

  // Prove the #61 disconnect-purge seam is activated by the google tag.
  const purged = events.deleteByProvider("google");
  console.log(
    `\n🧹 deleteByProvider("google") purged ${purged} row(s) — the #61 disconnect seam works.`,
  );

  console.log("\n✅ Done. (Nothing was written to your real DB — the board was in-memory.)");
}

main().catch((err) => {
  console.error("\n💥 E2E harness failed:", err);
  process.exit(1);
});
