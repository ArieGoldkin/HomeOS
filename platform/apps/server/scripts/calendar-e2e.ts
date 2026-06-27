// Load .env (GOOGLE_* bundle + ANTHROPIC_API_KEY) for local runs.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../src/config.ts";
import { anthropicCallModel, createAgent } from "../src/core/agent/index.ts";
import { handleInbound } from "../src/core/handler.ts";
import { createEventStore } from "../src/db/event-store/index.ts";
import { FAMILY_ID } from "../src/db/schema.ts";
import { httpCalendarClient } from "../src/google/calendar.ts";
import { buildGoogleDeps } from "../src/http/oauth-routes.ts";
import { anthropicRawParse, createParser } from "../src/parsing/parser.ts";
import {
  type CalendarToolDeps,
  extractEventsTool,
  pushSavedEventsToCalendar,
  readCalendarTool,
} from "../src/tools/index.ts";

/**
 * Local end-to-end harness for the Calendar read sync (#18, chunk 1) — runs the FULL pipeline
 * WITHOUT WhatsApp:
 *
 *   handleInbound("סנכרן יומן")  →  agent forces read_calendar  →  REAL Calendar list
 *      →  mapCalendarEvent (Asia/Jerusalem)  →  saveEvent(gcal:<id>, source_provider:"google")
 *      →  Hebrew confirm
 *
 * It reads your REAL connected Google Calendar (bounded by CALENDAR_MAX_EVENTS / CALENDAR_WINDOW_DAYS),
 * but the board lives in an IN-MEMORY store — nothing is written to your real DB. Read-only: there is
 * NO model call (calendar data is already structured) and NO write to Google. The Google CREDENTIAL is
 * read from your real DB (config.dbPath), exactly where `/connect/google` stored it; an expired access
 * token is refreshed for real.
 *
 * Prereqs (one-time): the GOOGLE_* bundle + ANTHROPIC_API_KEY in .env, and a connected account —
 * start the server (`pnpm dev`) and run, with your ADMIN_TOKEN:
 *   curl -sI -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/connect/google
 * open the `location:` URL, approve all scopes, then come back here.
 *
 * Run:  pnpm --filter @homeos/server calendar:e2e   (optionally append a sender, default = allowlist[0])
 */

const log = (msg: string, meta?: Record<string, unknown>) =>
  console.log(`   · ${msg}${meta ? ` ${JSON.stringify(meta)}` : ""}`);

async function main() {
  const config = loadConfig();

  if (!config.google) {
    console.error(
      "❌ The GOOGLE_* bundle is not set in .env — Calendar can't be synced.\n" +
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

  // Calendar read needs no model, but the agent loop + extract_events tool still want a parser.
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the env
  const parse = createParser(anthropicRawParse(anthropic, config.anthropicModel));
  const calendarDeps: CalendarToolDeps = {
    client: httpCalendarClient(),
    oauthClient: googleDeps.client,
    credentials: googleDeps.credentials,
    calendarId: config.calendarId,
    windowDays: config.calendarWindowDays,
    maxEvents: config.calendarMaxEvents,
    log,
  };
  const agent = createAgent({
    callModel: anthropicCallModel(anthropic, config.anthropicModel),
    tools: [extractEventsTool(parse), readCalendarTool()],
    log,
  });

  const replies: string[] = [];
  const sendText = async (to: string, body: string) => {
    replies.push(body);
    console.log(`\n📤 WhatsApp reply → ${to}:\n   ${body.replace(/\n/g, "\n   ")}\n`);
  };

  // `--write` opts into the WRITE phase (auto-push a forwarded event to your REAL calendar). Default
  // = read-only (safe). The sender is the first non-flag arg, else the first allowlist number.
  const doWrite = process.argv.includes("--write");
  const from = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? config.allowlist[0]!;
  const deps = {
    allowlist: config.allowlist,
    agent,
    events,
    sendText,
    members: config.members,
    calendar: calendarDeps,
    autoPushCalendar: doWrite, // only the forward path pushes; the read sync below ignores this
    log,
  };

  console.log("━".repeat(70));
  console.log(
    `📅 HomeOS Calendar E2E — real Google Calendar, in-memory board${doWrite ? " (READ + WRITE)" : " (read-only)"}`,
  );
  console.log(
    `   calendar=${config.calendarId} · windowDays=${config.calendarWindowDays} · maxEvents=${config.calendarMaxEvents}`,
  );
  console.log("━".repeat(70));
  console.log(`\n📨 Simulating WhatsApp:  "${from}"  →  "סנכרן יומן"\n`);

  await handleInbound({ id: `e2e-1-${Date.now()}`, from, type: "text", text: "סנכרן יומן" }, deps);

  const rows = events.listEvents();
  const calRows = rows.filter((r) => r.source_provider === "google");
  console.log(`📋 Board now has ${rows.length} event(s) — ${calRows.length} from Calendar:`);
  for (const r of calRows) {
    const when = `${r.date_iso}${r.time ? ` ${r.time}` : ""}`;
    const loc = r.location ? ` @ ${r.location}` : "";
    console.log(`   • [${r.kind}] ${r.title_he} — ${when}${loc}  (${r.source_provider})`);
  }
  if (calRows.length === 0) {
    console.log(
      "   (nothing in range — try a wider CALENDAR_WINDOW_DAYS, or check the calendar has upcoming events.)",
    );
  }

  // Prove idempotency (AC4): a second sync re-upserts the same gcal:<id> rows — count must not grow.
  console.log("\n🔁 Re-running to prove idempotency (gcal:<id>)…");
  await handleInbound({ id: `e2e-2-${Date.now()}`, from, type: "text", text: "סנכרן יומן" }, deps);
  const after = events.listEvents().filter((r) => r.source_provider === "google").length;
  console.log(
    `   Calendar rows: ${calRows.length} → ${after}  ${calRows.length === after ? "✅ idempotent" : "❌ DUPLICATED"}`,
  );

  // ── WRITE phase (opt-in via --write): auto-push a forwarded event to your REAL Google Calendar ──
  if (doWrite) {
    console.log(`\n${"━".repeat(70)}`);
    console.log("✍️  WRITE phase — auto-push a forwarded event to your REAL Google Calendar");
    console.log("━".repeat(70));
    const forward = "תזכורת מבחן HomeOS: פגישת צוות מחר בשעה 18:30 בזום";
    console.log(`\n📨 Simulating a forward:  "${from}"  →  "${forward}"\n`);

    const beforeForward = events.listEvents().filter((r) => r.source_provider === null).length;
    // The forward path runs REAL Claude (extract_events) then auto-pushes the saved rows to Calendar.
    await handleInbound({ id: `e2e-w1-${Date.now()}`, from, type: "text", text: forward }, deps);
    const boardForwards = events.listEvents().filter((r) => r.source_provider === null);
    const created = boardForwards.length - beforeForward;
    console.log(
      `📋 Parsed ${created} board event(s); each was auto-pushed (insert) to Google Calendar:`,
    );
    for (const r of boardForwards.slice(beforeForward)) {
      console.log(
        `   • ${r.title_he} — ${r.date_iso}${r.time ? ` ${r.time}` : ""} (homeosEventId=${r.id})`,
      );
    }

    // Idempotency (AC4): re-push the SAME board rows → find-by-homeosEventId → PATCH, never a duplicate.
    console.log(
      "\n🔁 Re-pushing the same board rows to prove write idempotency (patch, not duplicate)…",
    );
    const { pushed } = await pushSavedEventsToCalendar(boardForwards, calendarDeps, FAMILY_ID, log);
    console.log(
      `   re-pushed ${pushed} row(s) — each PATCHed its existing Google event (no duplicate).`,
    );

    console.log(
      "\n⚠️  A REAL event was created on your Google Calendar (labelled 'מבחן HomeOS'). The tool has no\n" +
        "   delete endpoint — remove it manually when you're done verifying.",
    );
  }

  // Prove the #61 disconnect-purge seam is activated by the google tag (in-memory board only).
  const purged = events.deleteByProvider("google");
  console.log(
    `\n🧹 deleteByProvider("google") purged ${purged} row(s) — the #61 disconnect seam works.`,
  );

  console.log(
    `\n✅ Done. (The board was in-memory — nothing was written to your real DB.${doWrite ? " A real Calendar event WAS created — see the warning above." : " Read-only: your Calendar was untouched."})`,
  );
}

main().catch((err) => {
  console.error("\n💥 E2E harness failed:", err);
  process.exit(1);
});
