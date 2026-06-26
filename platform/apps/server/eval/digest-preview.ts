/**
 * Preview the daily digest (item D) against your REAL local DB — without sending WhatsApp or
 * calling Claude. Reads DB_PATH (default ./data/homeos.db) and prints the Hebrew summary that the
 * scheduled job would send. Run after some local activity to eyeball the counts + wording:
 *
 *   pnpm digest:preview        (from platform/)
 */
import "dotenv/config";
import { runDigestOnce } from "../src/core/digest.ts";
import { createEventStore } from "../src/db/event-store/index.ts";
import { createInboundStore } from "../src/db/inbound-store.ts";
import { FAMILY_ID } from "../src/db/schema.ts";

const dbPath = process.env.DB_PATH ?? "./data/homeos.db";
const events = createEventStore(dbPath);
const inbound = createInboundStore(dbPath);

await runDigestOnce({
  events,
  inbound,
  // Preview sink: print instead of sending over WhatsApp.
  sendText: async (to, body) => {
    console.log(`\n--- digest → ${to} (preview, not sent) ---\n${body}\n`);
  },
  adminPhone: "preview",
  familyId: FAMILY_ID,
  hour: 0,
});
