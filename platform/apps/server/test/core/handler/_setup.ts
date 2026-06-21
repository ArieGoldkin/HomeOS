import type { ParsedEvent } from "@homeos/shared";
import { vi } from "vitest";
import type { AgentResult } from "../../../src/core/agent.ts";
import type { HandlerDeps } from "../../../src/core/handler/index.ts";
import type { ConversationStore } from "../../../src/db/conversation-store.ts";
import type { SavedEvent } from "../../../src/db/event-store.ts";
import type { InboundStore } from "../../../src/db/inbound-store.ts";
import type { InboundMessage } from "../../../src/http/webhook.ts";
import type {
  CalendarToolDeps,
  ClarifyResult,
  GmailToolDeps,
  ToolContext,
} from "../../../src/tools/tools.ts";

export const allowlist = ["972501234567"];

export const sampleEvent: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: null,
  recurrence: null,
  source_text: "אסיפת הורים מחר ב-18:30",
};
// #71: the agent now returns the rows a tool already PERSISTED (SavedEvent), not raw ParsedEvent.
export const sampleSaved: SavedEvent = { id: 7, source_provider: null, ...sampleEvent };

export function makeDeps(
  opts: {
    saved?: SavedEvent[] | null;
    cancelCount?: number;
    agentThrows?: unknown;
    members?: Record<string, string>;
    /** G16: when set, wires the ceiling + an inbound counter stub returning `senderCount`. */
    maxPerSenderPerDay?: number;
    senderCount?: number;
    /** #72: when defined, wires deps.google with a credential present (true) or absent (false). */
    google?: boolean;
    /** #72: what the agent's read_gmail run returns on the sync path (default [sampleSaved]). */
    syncSaved?: SavedEvent[] | null;
    /** #18: when defined, wires deps.calendar with a credential present (true) or absent (false). */
    calendar?: boolean;
    /** #18: what the agent's read_calendar run returns on the sync path (default [sampleSaved]). */
    calSyncSaved?: SavedEvent[] | null;
    /** #18 chunk 2: enable auto-push of forwarded events to Google Calendar. */
    autoPush?: boolean;
    /** #83: wire an open-thread store so the RESUME branch engages (omitted ⇒ branch inert). */
    conversations?: ConversationStore;
    /** #84: when set, agent.run (the main path) returns this clarify arm instead of saved rows. */
    clarifyResult?: ClarifyResult;
    /** #84: when defined, wires deps.parse (the clarify-resume re-parse seam) to return this. */
    parseReturns?: ParsedEvent[] | null;
    /** #84/F2: when set, deps.parse throws this (e.g. a TransientError) — proves the thread survives. */
    parseThrows?: unknown;
    /** #87/G24: override the open-thread TTL (ms). `0` makes a thread expire immediately at open. */
    conversationTtlMs?: number;
  } = {},
) {
  const sendText = vi.fn(async (_to: string, _body: string) => {});
  // The store stub stays for the ביטול undo path; #71 means the HANDLER no longer calls saveEvent.
  const events = {
    saveEvent: vi.fn(
      (
        e: ParsedEvent,
        m: { fromPhone: string; waMessageId: string; seq?: number },
      ): SavedEvent => ({
        id: 7 + (m.seq ?? 0),
        source_provider: null,
        ...e,
      }),
    ),
    listEvents: vi.fn(() => []),
    deleteLastFromSender: vi.fn((_from: string) => opts.cancelCount ?? 1),
    countSince: vi.fn(() => 0),
    deleteByProvider: vi.fn(() => 0),
    deleteById: vi.fn(() => 1),
    findEventsByRef: vi.fn((): SavedEvent[] => []),
    updateEvent: vi.fn((): SavedEvent | null => null),
    findSlotConflict: vi.fn((): SavedEvent | null => null),
  };
  // The handler depends on the agent; run() returns persisted SavedEvent[], a {clarify} arm (#84), or
  // null. The sync path is distinguished by opts.forceTool === "read_gmail" (3rd arg), so it can branch.
  const run = vi.fn(
    async (
      _text: string,
      _ctx: ToolContext,
      runOpts?: { forceTool?: string },
    ): Promise<AgentResult> => {
      if (opts.agentThrows) throw opts.agentThrows;
      if (runOpts?.forceTool === "read_gmail") {
        return opts.syncSaved === undefined ? [sampleSaved] : opts.syncSaved;
      }
      if (runOpts?.forceTool === "read_calendar") {
        return opts.calSyncSaved === undefined ? [sampleSaved] : opts.calSyncSaved;
      }
      // #84: the main forward path returns a clarify arm when the parse flagged a required slot.
      if (opts.clarifyResult) return { clarify: opts.clarifyResult };
      return opts.saved === undefined ? [sampleSaved] : opts.saved;
    },
  );
  const agent = { run };
  // #72: a fake Gmail seam. `google: true` → a stored credential; `google: false` → none (not connected).
  const google: GmailToolDeps | undefined =
    opts.google === undefined
      ? undefined
      : ({
          client: { list: vi.fn(), get: vi.fn() },
          oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
          credentials: {
            get: vi.fn(() =>
              opts.google
                ? { accessToken: "a", refreshToken: "r", expiry: "2099-01-01 00:00:00", scopes: [] }
                : null,
            ),
            updateTokens: vi.fn(),
            delete: vi.fn(),
          },
          maxMessages: 10,
          queryWindow: "newer_than:7d",
          allowedLabels: [],
        } as unknown as GmailToolDeps);
  // #18: a fake Calendar seam. `calendar: true` → a stored credential; `false` → none (not connected).
  const calendar: CalendarToolDeps | undefined =
    opts.calendar === undefined
      ? undefined
      : ({
          client: {
            list: vi.fn(),
            findEventIdByPrivateProp: vi.fn(async () => null),
            insertEvent: vi.fn(async () => ({ id: "gcal-new" })),
            patchEvent: vi.fn(async () => ({ id: "gcal-p" })),
          },
          oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
          credentials: {
            get: vi.fn(() =>
              opts.calendar
                ? { accessToken: "a", refreshToken: "r", expiry: "2099-01-01 00:00:00", scopes: [] }
                : null,
            ),
            updateTokens: vi.fn(),
            delete: vi.fn(),
          },
          calendarId: "primary",
          windowDays: 30,
          maxEvents: 20,
        } as unknown as CalendarToolDeps);
  // G16 counter stub — only attached when the ceiling is configured, so the rate gate stays off
  // for every other test (the production path always wires both via index.ts).
  const countFromSenderSince = vi.fn((_from: string, _since: string) => opts.senderCount ?? 0);
  const deps: HandlerDeps = {
    allowlist,
    events,
    agent,
    sendText,
    members: opts.members,
    google,
    calendar,
    autoPushCalendar: opts.autoPush,
    ...(opts.conversations ? { conversations: opts.conversations } : {}),
    ...(opts.conversationTtlMs !== undefined ? { conversationTtlMs: opts.conversationTtlMs } : {}),
    ...(opts.parseThrows !== undefined
      ? {
          parse: vi.fn(async () => {
            throw opts.parseThrows;
          }),
        }
      : opts.parseReturns !== undefined
        ? { parse: vi.fn(async () => opts.parseReturns ?? null) }
        : {}),
    now: () => new Date("2026-06-20T09:00:00Z"), // → 2026-06-20 in Asia/Jerusalem (IDT)
    ...(opts.maxPerSenderPerDay !== undefined
      ? {
          maxPerSenderPerDay: opts.maxPerSenderPerDay,
          inbound: { countFromSenderSince } as unknown as InboundStore,
        }
      : {}),
  };
  return { sendText, events, agent, deps, countFromSenderSince };
}

export const textMsg: InboundMessage = {
  id: "wamid.1",
  from: "972501234567",
  type: "text",
  text: "אסיפת הורים מחר ב-18:30",
};
