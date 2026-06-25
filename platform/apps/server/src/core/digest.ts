import type { EventStore, SavedEvent } from "../db/event-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
import type { SendText } from "../whatsapp/client.ts";
import { scheduleDaily } from "./scheduler.ts";
import { jerusalemWallClock, sqliteUtc } from "./time.ts";

// Re-exported so existing importers keep their path; the helper now lives in the shared scheduler.
export { msUntilNextRun } from "./scheduler.ts";

export interface DigestDeps {
  events: EventStore;
  inbound: InboundStore;
  sendText: SendText;
  /** Where the digest is sent (the founder's number). */
  adminPhone: string;
  /** The family whose board reminders the digest surfaces (#28). Today: the single-family `FAMILY_ID`. */
  familyId: string;
  /** Hour of day (0–23) to send, in Asia/Jerusalem. */
  hour: number;
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface DigestStats {
  events: number;
  handled: number;
  errors: number;
  pending: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The daily Hebrew summary. Sent even on a quiet day (all zeros) so its *absence* is the alert
 * that the bot is down — heartbeat + quality monitor + error alert in one message. #28: when there are
 * reminders due today it also lists them (the morning nudge — "remind me tomorrow" surfaces here).
 */
export function buildDigest(stats: DigestStats, reminders: SavedEvent[] = []): string {
  const lines = [
    "📊 סיכום יומי",
    `אירועים שנוספו: ${stats.events}`,
    `הודעות שטופלו: ${stats.handled}`,
    `שגיאות: ${stats.errors}`,
  ];
  if (stats.pending > 0) lines.push(`ממתינות: ${stats.pending}`);
  if (reminders.length > 0) {
    lines.push("", "🔔 תזכורות להיום");
    for (const r of reminders) lines.push(`• ${r.time ? `${r.time} ` : ""}${r.title_he}`);
  }
  return lines.join("\n");
}

/** Compute the last-24h stats and send one digest. Exposed for testing + boot. */
export async function runDigestOnce(deps: DigestDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const since = sqliteUtc(new Date(now.getTime() - DAY_MS));
  const counts = deps.inbound.statsSince(since);
  const stats: DigestStats = {
    events: deps.events.countSince(since),
    handled: counts.done,
    errors: counts.failed,
    pending: counts.pending,
  };
  // #28: reminders due TODAY (Asia/Jerusalem at send time) — a "remind me tomorrow" item, dated tomorrow,
  // surfaces in tomorrow's digest. Open-only, so it fires once and drops once acted on.
  const reminders = deps.events.remindersDueOn(deps.familyId, jerusalemWallClock(now).dateIso);
  deps.log?.("daily digest", { ...stats, reminders: reminders.length });
  await deps.sendText(deps.adminPhone, buildDigest(stats, reminders));
}

/** Schedule the digest at `hour` Asia/Jerusalem, then daily — via the shared scheduler. */
export function scheduleDigest(deps: DigestDeps): { stop: () => void } {
  return scheduleDaily(deps.hour, () => runDigestOnce(deps), {
    now: deps.now,
    onError: (err) => deps.log?.("digest send failed", { error: String(err) }),
  });
}
