import type { EventStore, SavedEvent } from "../db/event-store/index.ts";
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
  /**
   * #134 — offsite-backup freshness probe. Returns a Hebrew warning line when the offsite copy is
   * stale/missing, else null. Kept as a thunk so the digest stays decoupled from the uploader; absent
   * (no offsite configured) ⇒ no backup line. A thrown probe degrades to a "couldn't verify" line.
   */
  backupHealth?: () => Promise<string | null>;
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
export function buildDigest(
  stats: DigestStats,
  reminders: SavedEvent[] = [],
  healthLine: string | null = null,
): string {
  const lines = [
    "📊 סיכום יומי",
    `אירועים שנוספו: ${stats.events}`,
    `הודעות שטופלו: ${stats.handled}`,
    `שגיאות: ${stats.errors}`,
  ];
  if (stats.pending > 0) lines.push(`ממתינות: ${stats.pending}`);
  // #134 — surface a stale/missing offsite backup on the daily heartbeat (only when unhealthy).
  if (healthLine) lines.push("", healthLine);
  if (reminders.length > 0) {
    lines.push("", "🔔 תזכורות להיום");
    // #224 — a standing daily reminder surfaces here every in-window day; tag it "(יומי)" so a recurring
    // nudge reads as intentional, not a duplicate.
    for (const r of reminders) {
      lines.push(`• ${r.time ? `${r.time} ` : ""}${r.title_he}${r.standing ? " (יומי)" : ""}`);
    }
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
  // #134 — probe offsite-backup freshness; a thrown probe degrades to a "couldn't verify" line so the
  // digest (the heartbeat) still goes out.
  let healthLine: string | null = null;
  if (deps.backupHealth) {
    try {
      healthLine = await deps.backupHealth();
    } catch (err) {
      deps.log?.("backup health check failed", { error: String(err) });
      healthLine = "⚠️ לא ניתן לאמת את הגיבוי החיצוני";
    }
  }
  deps.log?.("daily digest", { ...stats, reminders: reminders.length, backupAlert: !!healthLine });
  await deps.sendText(deps.adminPhone, buildDigest(stats, reminders, healthLine));
}

/** Schedule the digest at `hour` Asia/Jerusalem, then daily — via the shared scheduler. */
export function scheduleDigest(deps: DigestDeps): { stop: () => void } {
  return scheduleDaily(deps.hour, () => runDigestOnce(deps), {
    now: deps.now,
    onError: (err) => deps.log?.("digest send failed", { error: String(err) }),
  });
}
