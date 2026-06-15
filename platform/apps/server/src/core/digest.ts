import type { EventStore } from "../db/event-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
import type { SendText } from "../whatsapp/client.ts";

export interface DigestDeps {
  events: EventStore;
  inbound: InboundStore;
  sendText: SendText;
  /** Where the digest is sent (the founder's number). */
  adminPhone: string;
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

/** SQLite stores datetimes as UTC 'YYYY-MM-DD HH:MM:SS' (via datetime('now')); match that format. */
function sqliteUtc(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * The daily Hebrew summary. Sent even on a quiet day (all zeros) so its *absence* is the alert
 * that the bot is down — heartbeat + quality monitor + error alert in one message.
 */
export function buildDigest(stats: DigestStats): string {
  const lines = [
    "📊 סיכום יומי",
    `אירועים שנוספו: ${stats.events}`,
    `הודעות שטופלו: ${stats.handled}`,
    `שגיאות: ${stats.errors}`,
  ];
  if (stats.pending > 0) lines.push(`ממתינות: ${stats.pending}`);
  return lines.join("\n");
}

/** ms from `now` until the next `hour:00` in Asia/Jerusalem (wraps to tomorrow if already past). */
export function msUntilNextRun(now: Date, hour: number): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // en-GB 24h renders "HH:MM:SS"; "24" at midnight → normalize to 0.
  const parts = fmt.format(now).split(":").map(Number);
  const h = (parts[0] ?? 0) % 24;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  let secondsUntil = (hour - h) * 3600 - m * 60 - s;
  if (secondsUntil <= 0) secondsUntil += 24 * 3600;
  return secondsUntil * 1000;
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
  deps.log?.("daily digest", { ...stats });
  await deps.sendText(deps.adminPhone, buildDigest(stats));
}

/**
 * Schedule the digest at `hour` Asia/Jerusalem, then every 24h. Returns a stop() to cancel the
 * timer (used in shutdown/tests). A send failure is swallowed (logged) so the loop keeps running.
 */
export function scheduleDigest(deps: DigestDeps): { stop: () => void } {
  const now = deps.now ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout>;

  const tick = async () => {
    try {
      await runDigestOnce(deps);
    } catch (err) {
      deps.log?.("digest send failed", { error: String(err) });
    }
    timer = setTimeout(() => void tick(), DAY_MS);
  };

  timer = setTimeout(() => void tick(), msUntilNextRun(now(), deps.hour));
  return { stop: () => clearTimeout(timer) };
}
