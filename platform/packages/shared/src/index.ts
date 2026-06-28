// Zod v4 API (via the subpath zod 3.25+ ships): required so @anthropic-ai/sdk's
// zodOutputFormat can convert this schema to JSON Schema for structured outputs.
import { z } from "zod/v4";

/** The kinds of thing a forwarded message can become on the family board. */
export const EVENT_KINDS = ["event", "task", "reminder"] as const;
export const eventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof eventKindSchema>;

const dateIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date_iso must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "date_iso must be a real calendar date");

const timeHm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (24h)");

/**
 * G15 — codepoints that must never appear in a user-facing field: C0/DEL/C1 control chars (incl.
 * newlines that fake bot UI), zero-width + directional marks (U+200B–200F), and bidi-control
 * overrides/embeddings (U+202A–202E) and isolates (U+2066–2069). In a Hebrew (RTL) product these
 * let forwarded text spoof or garble the confirm. Code-based (no literal control bytes in source).
 */
/** The single G15 codepoint predicate — both the validation refine and the sanitizer below derive from it. */
function isUnsafeCodePoint(c: number): boolean {
  if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true; // C0 / DEL / C1 controls
  if (c >= 0x200b && c <= 0x200f) return true; // zero-width + LRM/RLM
  if (c >= 0x202a && c <= 0x202e) return true; // bidi embeddings/overrides
  if (c >= 0x2066 && c <= 0x2069) return true; // bidi isolates
  return false;
}

function hasUnsafeChars(s: string): boolean {
  for (const ch of s) if (isUnsafeCodePoint(ch.codePointAt(0) ?? 0)) return true;
  return false;
}

/**
 * Strip the G15-forbidden control/bidi codepoints from text that did NOT pass through the model — e.g.
 * a Google Calendar summary the user typed (#18). The parser's output is *validated* (rejected) by the
 * schema refine; provider text mapped straight to a `ParsedEvent` is *sanitized* here instead, so a
 * legitimate Hebrew title carrying a stray directional mark is cleaned rather than silently dropped.
 * Same codepoint set as `hasUnsafeChars` — one source of truth. Length/trim/whitespace are the caller's job.
 */
export function sanitizeUserText(s: string): string {
  let out = "";
  for (const ch of s) if (!isUnsafeCodePoint(ch.codePointAt(0) ?? 0)) out += ch;
  return out;
}

/**
 * G1 — title_he/location/assignee are MODEL-authored from untrusted forwarded text and round-trip to
 * the family's WhatsApp via the confirm, so the structured channel is really a prose channel. The
 * `.max` length bound stops a 4000-char essay / phishing dump from round-tripping (and is emitted as
 * maxLength in the structured-output JSON Schema, guiding Claude). The bidi/control refine (G15) is a
 * post-hoc backstop. An abusive value fails validation → null → "please rephrase", never reaching the user.
 */
const boundedLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !hasUnsafeChars(s), "control or bidirectional characters are not allowed");

/**
 * Weekly recurrence (covers חוגים / after-school activities). `weekday` is 0=Sunday … 6=Saturday
 * (the Israeli week starts Sunday). Deliberately not a full RRULE — weekly-by-weekday is enough
 * for the family domain; richer recurrence can extend this later.
 */
export const recurrenceSchema = z.object({
  freq: z.literal("weekly"),
  weekday: z.number().int().min(0).max(6),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

/**
 * #84 — the confidence signal the MODEL emits as a CONSTRAINED ENUM (never free prose): it flags a
 * parse whose required slot is a guess so the handler can ask ONE templated Hebrew question. The
 * deterministic code gate (extract_events) decides whether to ACT on it — only required-slot reasons
 * (`missing_date`/`ambiguous_title`) open a thread; `missing_time` is optional and never asks. Keeping
 * this an enum (not a model-authored question string) is the Meta-2026 single-purpose red line.
 */
export const CLARIFY_REASONS = ["missing_date", "missing_time", "ambiguous_title"] as const;
export const clarifyReasonSchema = z.enum(CLARIFY_REASONS);
export type ClarifyReason = z.infer<typeof clarifyReasonSchema>;

export const needsClarificationSchema = z.object({ reason: clarifyReasonSchema });
export type NeedsClarification = z.infer<typeof needsClarificationSchema>;

/**
 * The contract: the structured shape Claude extracts from a forwarded Hebrew message, produced
 * by the server/agent and consumed by the family app's board. Dates are anchored to
 * Asia/Jerusalem upstream; `time`/`location`/`assignee`/`recurrence` are null when absent.
 * `assignee` is the family member it's for/assigned to (a name for now; a richer member model
 * comes with the multi-user work). New nullable fields default to null so the contract stays
 * robust if the model omits them. The user-facing string fields are content-bound (G1/G15).
 */
export const parsedEventSchema = z.object({
  kind: eventKindSchema,
  title_he: boundedLine(80),
  date_iso: dateIso,
  time: timeHm.nullable(),
  location: boundedLine(120).nullable(),
  assignee: boundedLine(40).nullable().default(null),
  recurrence: recurrenceSchema.nullable().default(null),
  // Verbatim original slice for this item (not rendered in the confirm) — bound length only, since
  // it may legitimately contain newlines. The handler's input cap (G2) bounds the message as a whole.
  source_text: z.string().max(2000),
  // #84: `.nullish()` (optional + nullable) so the field is backward-compatible in BOTH runtime and
  // TYPE — the model omits it for a clear parse (→ undefined) or may send null, and every existing
  // ParsedEvent/SavedEvent literal stays valid (a `.default(null)` would force it required in the
  // inferred output type and break those literals). The PROMPT + the code gate enforce
  // conservativeness, not the schema. The gate treats null/undefined alike via a truthy check.
  needs_clarification: needsClarificationSchema.nullish(),
});
export type ParsedEvent = z.infer<typeof parsedEventSchema>;

/**
 * One forwarded message can contain several items (the weekly gan newsletter is the canonical
 * case), so the parse result is a list. The object wrapper (vs a bare array) is what the LLM
 * structured-output format expects and keeps room for message-level fields later.
 */
export const parsedMessageSchema = z.object({
  events: z.array(parsedEventSchema),
});
export type ParsedMessage = z.infer<typeof parsedMessageSchema>;

/**
 * #151 — where a served row originated, for the UI's provenance badge + detail view. DERIVED
 * server-side in `rowToSaved` from the `wa_message_id` prefix (`gmail:`/`gcal:`/`web:` → that source;
 * otherwise a forwarded WhatsApp message) — NOT a stored column. `source_provider` only distinguishes
 * google-derived from local rows; this enum is finer (web-added vs forwarded both have a null provider).
 */
export const SAVED_EVENT_SOURCES = ["whatsapp", "web", "gmail", "gcal"] as const;
export const savedEventSourceSchema = z.enum(SAVED_EVENT_SOURCES);
export type SavedEventSource = z.infer<typeof savedEventSourceSchema>;

/**
 * #19 — a board item's completion state. A TASK toggles open↔done. This is BOARD STATE the family sets,
 * NOT a parsed field: it lives on the served/stored row (like `source`/`created_at`/`source_provider`),
 * never on {@link parsedEventSchema} — so the model never authors it and `POST /events` can't create a
 * row "done". The column is universal (every row has one, defaulting open); only the `task` kind surfaces
 * the toggle in the UI.
 */
export const EVENT_STATUSES = ["open", "done"] as const;
export const eventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof eventStatusSchema>;

/**
 * The shape the server SERVES from `GET /events` (one row): a {@link ParsedEvent} plus the DB-assigned
 * `id` and the `source_provider` that `event-store.ts`'s `rowToSaved` attaches (`source_provider` is
 * null for forwarded WhatsApp events, a provider name like `"google"` for gcal/gmail-derived rows). This
 * is the ONE row contract the server produces and the web app (`useEvents`) consumes — keeping a single
 * definition so the two can't drift. The endpoint wraps rows as `{ events: SavedEvent[] }`.
 *
 * #151: `source` (derived provenance) + `created_at` are now part of the served row. Both are
 * `.optional()` so older payloads/fixtures stay valid — the server always populates them, and the UI
 * degrades gracefully when absent (no badge, no created-at line). `created_at` is an ISO-8601 UTC string
 * (e.g. `2026-06-21T18:03:59Z`) — the server normalizes SQLite's space-separated UTC form so a consumer's
 * `new Date(...)` reads the right instant (F1); render it in Asia/Jerusalem for display.
 */
export const savedEventSchema = parsedEventSchema.extend({
  id: z.number().int(),
  source_provider: z.string().nullable(),
  source: savedEventSourceSchema.optional(),
  created_at: z.string().optional(),
  // #19 — open/done completion state. `.optional()` (like source/created_at): the server always populates
  // it (defaulting legacy NULL rows to "open"), older fixtures/payloads stay valid, and the UI treats
  // absence as "open".
  status: eventStatusSchema.optional(),
});
export type SavedEvent = z.infer<typeof savedEventSchema>;

/**
 * The `GET /events` response envelope: rows wrapped as `{ events: SavedEvent[] }` (NOT a bare array).
 * The web data layer (`useEvents`) parses against this so any shape drift fails loudly at the boundary.
 */
export const savedEventsResponseSchema = z.object({
  events: z.array(savedEventSchema),
});
export type SavedEventsResponse = z.infer<typeof savedEventsResponseSchema>;

/**
 * #19 — the body of `PATCH /events/:id`: the ONLY board-state mutation a client may apply to an existing
 * row (the open/done toggle). Deliberately minimal — NOT a ParsedEvent patch (title/date/location edits
 * are handler-level over WhatsApp, #86) — so the authenticated web surface can flip done-state without
 * forking the mutation path. Validated server-side: an unknown field is stripped, a bad status → 400.
 */
export const eventStatusPatchSchema = z.object({ status: eventStatusSchema });
export type EventStatusPatch = z.infer<typeof eventStatusPatchSchema>;

/**
 * #135 [D2] — the disposition recorded for an inbound message at its terminal handler branch. Finer than
 * the queue's coarse `status` (pending|done|failed): a `done` row could be a parsed event, a clarify
 * question, an unparseable→rephrase, an allowlist refusal, a rate-limit, or a text-only reply — all
 * indistinguishable by `status` alone.
 *
 * #159 — extended to the COMMAND paths so the feed shows what the bot DID, not a blank pill: `cancelled`
 * (cancel-by-ref / bare-ביטול undo), `edited` (edit-by-ref / in-place correction), `synced` (mail/calendar
 * sync), `aborted` (an open thread closed by ביטול), `resumed` (a reply that answered an open clarify /
 * disambiguation / confirm thread). Null now means only a row with no recorded disposition — a historical
 * row from before #135, or a still-pending/failed one — which the web renders as a neutral marker.
 */
export const INBOUND_OUTCOMES = [
  "parsed",
  "clarified",
  "rephrase",
  "refused",
  "rate_limited",
  "text_only",
  "cancelled",
  "edited",
  "synced",
  "aborted",
  "resumed",
  // #228 — a wa.me phone-binding message: a valid HOME-XXXXX code bound the sender's number to a family.
  "bound",
] as const;
export const inboundOutcomeSchema = z.enum(INBOUND_OUTCOMES);
export type InboundOutcome = z.infer<typeof inboundOutcomeSchema>;

/**
 * #135 [D2] — one row of the raw inbound-message feed served by `GET /messages`: the "what did the bot
 * receive and what happened" audit/inbox surface, complementary to the structured events board. This is
 * its OWN contract, deliberately **NOT** a {@link SavedEvent}: a non-text / unparseable / refused message
 * has no event at all, and this carries the raw `text`, `from_phone`, `received_at`, media `type`, queue
 * `status`, and disposition `outcome` that an event row has no place for.
 *
 * `family_id` is tenant-ready NOW (default `"default"`) so D3 (#136, the real `family_id` column) is
 * purely additive — the served shape doesn't change when the column lands. The text fields are the
 * VERBATIM forwarded message (other people's words, persisted BEFORE the allowlist gate), so this feed is
 * allowlist-filtered server-side and a client holding only the board read token must never reach it (a
 * separate `MESSAGES_TOKEN`, a higher privilege the family app's read-only board surfaces never carry).
 */
export const inboundMessageSchema = z.object({
  wa_message_id: z.string(),
  from_phone: z.string(),
  type: z.string(),
  text: z.string().nullable(),
  status: z.string(),
  outcome: inboundOutcomeSchema.nullable(),
  received_at: z.string(),
  processed_at: z.string().nullable(),
  family_id: z.string().default("default"),
});
export type InboundMessageDTO = z.infer<typeof inboundMessageSchema>;

/**
 * The `GET /messages` response envelope: rows wrapped as `{ messages: InboundMessageDTO[] }` (NOT a bare
 * array). The web data layer (`useMessages`) parses against this so any shape drift fails loudly here.
 */
export const inboundMessagesResponseSchema = z.object({
  messages: z.array(inboundMessageSchema),
});
export type InboundMessagesResponse = z.infer<typeof inboundMessagesResponseSchema>;

/**
 * #10 — the connection outcome slugs shared by the OAuth callback (server) and the web `?status=` banner.
 * Making this ONE source of truth means the server can only bounce a slug the web knows how to render, and
 * the web maps an allowlisted enum value rather than a raw request param (OG21-OR, open-redirect-safe).
 * `bad_account` is the account-identity-pin outcome (#109): the consenting Google account didn't match
 * `ALLOWED_GOOGLE_EMAIL`, or a present credential row would have been silently overwritten.
 */
export const CONNECT_OUTCOMES = [
  "connected",
  "cancelled",
  "no_refresh",
  "bad_scope",
  "bad_state",
  "error",
  "bad_account",
] as const;
export const connectOutcomeSchema = z.enum(CONNECT_OUTCOMES);
export type ConnectOutcome = z.infer<typeof connectOutcomeSchema>;

/**
 * #10 — the `GET /oauth/google/status` payload the web Connect screen polls. A discriminated union on
 * `connected`: disconnected is the bare `{ connected: false }`; connected adds the granted `scopes` and
 * the access-token `expiresAt` (ISO) for the "מחובר · פג תוקף …" line. Both members are strict so any
 * extra field — above all a leaked token/refresh/enc-key (OG3) — fails parsing loudly rather than reaching
 * the client. Mirrors the {@link savedEventsResponseSchema} shape-drift-fails-loudly contract.
 */
export const connectionStatusSchema = z.discriminatedUnion("connected", [
  z.strictObject({ connected: z.literal(false) }),
  z.strictObject({
    connected: z.literal(true),
    scopes: z.array(z.string()),
    expiresAt: z.string(),
  }),
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/**
 * #235 — one family-roster member as served by `GET /family`: a display `name` (sourced from the #14
 * `config.members` map, NOT the placeholder `user_id`) + a free-text `role` ("owner"/"member" today).
 * `name` is a Hebrew display string; render numerals/phones LTR-wrapped per the RTL rules.
 */
export const familyMemberSchema = z.object({
  name: z.string(),
  role: z.string(),
});
export type FamilyMember = z.infer<typeof familyMemberSchema>;

/**
 * #235 — the `GET /family` response envelope (server produces, web consumes): the single dogfood family's
 * `display_name` + its members. The web data layer (`useFamily`) parses against this so any shape drift
 * fails loudly at the boundary, exactly like {@link savedEventsResponseSchema}. `family_id` is intentionally
 * NOT served — the route is already `familyId`-scoped server-side (N=1 `FAMILY_ID`), and a tenant id on the
 * wire is noise the single-family web app never needs (it stays additive for Phase-B/RLS).
 */
export const familyRosterResponseSchema = z.object({
  family: z.object({ display_name: z.string() }),
  members: z.array(familyMemberSchema),
});
export type FamilyRosterResponse = z.infer<typeof familyRosterResponseSchema>;
