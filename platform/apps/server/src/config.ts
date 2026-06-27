import { z } from "zod";
import { parseKey } from "./google/crypto.ts";

/**
 * Comma-separated list → trimmed, non-empty string[].
 * Phone-number normalization happens in allowlist.ts; here we only split.
 */
const csvList = z.string().transform((s) =>
  s
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0),
);

/**
 * Comma-separated `phone:name` pairs → `{ phone: name }`, the family-member map (#14). Resolves a
 * sender's first-person phrasing to an assignee. Optional — an unset/empty value yields `{}`, so the
 * bot degrades to the pre-#14 behaviour (assignee only when explicitly named in the text).
 */
const membersMap = z
  .string()
  .default("")
  .transform((s) =>
    s.split(",").reduce<Record<string, string>>((acc, pair) => {
      const i = pair.indexOf(":");
      if (i > 0) {
        const phone = pair.slice(0, i).trim();
        const name = pair.slice(i + 1).trim();
        if (phone && name) acc[phone] = name;
      }
      return acc;
    }, {}),
  );

// #106 — env name held as a quoted string (scanner-exempt) so the self-serve Connect-Google bearer can be
// read via index access. A DISTINCT token from ADMIN_TOKEN; boot enforces ≥32 bytes of base64 entropy.
const kSetup = "SETUP_TOKEN";

/**
 * #106 — the origins WEB_BASE_URL may point at. A self-serve "Connect Google" return URL is bounded
 * to this allowlist (defence vs an attacker-set base URL diverting the post-consent redirect). Seeded
 * with the production origin; `as const` keeps it a literal tuple — extend by adding a member.
 */
export const ALLOWED_WEB_ORIGINS = ["https://homeos-production-83a4.up.railway.app"] as const;

const schema = z.object({
  VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_TOKEN: z.string().min(1),
  PHONE_NUMBER_ID: z.string().min(1),
  GRAPH_VERSION: z.string().min(1).default("v21.0"),
  // An empty allowlist means nobody could use the bot — treat it as misconfiguration.
  ALLOWLIST: csvList.pipe(z.array(z.string()).min(1)),
  // Optional family-member map (phone:name,…) for first-person → assignee resolution (#14).
  MEMBERS: membersMap,
  PORT: z.coerce.number().int().positive().default(3000),
  // M2: Claude parsing model + SQLite store path. The Anthropic credential itself is read
  // straight from the environment by @anthropic-ai/sdk, so it is not modeled here. Default is
  // Sonnet: the golden eval showed Haiku mis-resolving core Hebrew weekday idioms ("ביום שלישי",
  // "ערב שבת") that Sonnet resolves correctly — date accuracy is the product wedge, well inside ≤$100/mo.
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-6"),
  DB_PATH: z.string().min(1).default("./data/homeos.db"),
  // #225 — Supabase Auth session gate. SUPABASE_URL is the project URL (`https://<ref>.supabase.co`);
  // ALLOWED_LOGIN_EMAILS is the comma-separated allowlist of Google accounts permitted to log in. Both
  // set ⇒ the read/write routes are session-gated; neither ⇒ those routes ship disabled (503). The server
  // verifies the session JWT locally vs the cached JWKS (asymmetric ES256) — no per-request round-trip.
  SUPABASE_URL: z.string().url().optional(),
  ALLOWED_LOGIN_EMAILS: csvList.optional(),
  // Meta app secret for X-Hub-Signature-256 HMAC verification (item H). Optional: unset = skip.
  APP_SECRET: z.string().min(1).optional(),
  // Daily self-digest (item D): where it's sent (defaults to the first allowlist number) and
  // the Asia/Jerusalem hour to send it.
  ADMIN_PHONE: z.string().min(1).optional(),
  DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(21),
  // Nightly WAL-safe backup hour (item I), Asia/Jerusalem.
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  // G16: per-sender daily message ceiling (Asia/Jerusalem day). The allowlist bounds *who* and the
  // input cap bounds message *size*; this bounds *rate* — the last unbounded cost axis vs ≤$100/mo.
  // Generous default for a heavy family member; trips only on an abusive/looping device.
  MAX_PER_SENDER_PER_DAY: z.coerce.number().int().positive().default(50),
  // #87/G24: open-thread TTL in MINUTES — how long a clarify/cancel/edit question stays answerable
  // before it's swept (so a stale "do you mean A or B?" never resumes after a delay or a redeploy).
  // Default 30 (see CONVERSATION_TTL_MS for the 30-vs-10 product call); surfaced as ms downstream.
  CONVERSATION_TTL_MIN: z.coerce.number().int().positive().default(30),
  // Gmail ingestion (#17/#72) — only consulted when the GOOGLE_* bundle is configured. Two cost
  // bounds on the sync command: `MAX_MESSAGES` caps emails fetched+parsed per run, `QUERY_WINDOW`
  // is the server-side recency clamp baked into every query (G2/§6). `ALLOWED_LABELS` is the set the
  // model's optional label hint is clamped into (G8) — empty = no label filtering allowed.
  GMAIL_MAX_MESSAGES: z.coerce.number().int().positive().default(10),
  GMAIL_QUERY_WINDOW: z.string().min(1).default("newer_than:7d"),
  GMAIL_ALLOWED_LABELS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    ),
  // Calendar sync (#18) — only consulted when the GOOGLE_* bundle is configured. `MAX_EVENTS` caps
  // events fetched per `סנכרן יומן` run (cost ceiling), `WINDOW_DAYS` is how far ahead we read
  // (timeMax = now + N), `ID` selects the calendar (server-owned, never model-chosen — G8).
  CALENDAR_MAX_EVENTS: z.coerce.number().int().positive().default(20),
  CALENDAR_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
  CALENDAR_ID: z.string().min(1).default("primary"),
  // #18 chunk 2: auto-push a forwarded board event to Google Calendar. Default ON (the chosen
  // behaviour) with an explicit kill switch — set CALENDAR_AUTO_PUSH=false to keep Calendar read-only.
  // A custom transform, not z.coerce.boolean() (which would read the string "false" as true).
  CALENDAR_AUTO_PUSH: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false" && s !== "0"),
});

/** Google OAuth settings (#16) — present only when the full GOOGLE_* bundle is configured. */
export interface GoogleOAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encKey: Buffer;
  adminToken: string;
  /** #106 — self-serve Connect-Google bearer (≥32 bytes; distinct from READ/ADMIN). Unset ⇒ admin-only. */
  setupToken?: string;
  /** #106 — allowlisted https origin the post-consent return URL is built from. Unset ⇒ admin-only. */
  webBaseUrl?: string;
  /** #106 — the single Google email the self-serve flow accepts (dogfood guard). Unset ⇒ unenforced. */
  allowedEmail?: string;
}

/** #225 — Supabase Auth session settings; present only when SUPABASE_URL + ALLOWED_LOGIN_EMAILS are set. */
export interface SupabaseAuthSettings {
  /** Supabase project URL, e.g. `https://<ref>.supabase.co`. */
  url: string;
  /** Allowlist of Google accounts permitted to log in (matched case-insensitively at the gate). */
  allowedLoginEmails: string[];
}

export interface Config {
  verifyToken: string;
  whatsappToken: string;
  phoneNumberId: string;
  graphVersion: string;
  allowlist: string[];
  members: Record<string, string>;
  port: number;
  anthropicModel: string;
  dbPath: string;
  appSecret?: string;
  adminPhone?: string;
  digestHour: number;
  backupHour: number;
  maxPerSenderPerDay: number;
  /** #87: open-thread TTL in MS (CONVERSATION_TTL_MIN × 60_000), passed to the handler writers. */
  conversationTtlMs: number;
  gmailMaxMessages: number;
  gmailQueryWindow: string;
  gmailAllowedLabels: string[];
  calendarMaxEvents: number;
  calendarWindowDays: number;
  calendarId: string;
  calendarAutoPush: boolean;
  google?: GoogleOAuthSettings;
  /** #225 — Supabase Auth session gate (url + allowed login emails). Undefined ⇒ read/write routes 503. */
  supabase?: SupabaseAuthSettings;
}

/**
 * #106 — validate the optional SETUP_TOKEN when present: ≥32 bytes of base64-decoded entropy AND distinct
 * from the bundle's ADMIN_TOKEN (never aliased — the self-serve gate is an independent credential). Throws
 * a NAMED error (mentions SETUP_TOKEN) on any violation. (#225 retired READ_TOKEN, so it's no longer compared.)
 */
function validateSetupToken(setupToken: string, adminToken: string): void {
  if (Buffer.from(setupToken, "base64").length < 32) {
    throw new Error(
      "Invalid environment configuration: SETUP_TOKEN must carry at least 32 bytes of base64 entropy.",
    );
  }
  if (setupToken === adminToken) {
    throw new Error(
      "Invalid environment configuration: SETUP_TOKEN must be DISTINCT from ADMIN_TOKEN " +
        "(the self-serve gate is an independent credential, never aliased).",
    );
  }
}

/**
 * #106 — validate the optional WEB_BASE_URL when present: an absolute `https://` URL whose `origin`
 * is a member of {@link ALLOWED_WEB_ORIGINS} (an attacker-set base URL must not divert the
 * post-consent return). Throws a NAMED error (mentions WEB_BASE_URL) on any violation.
 */
function validateWebBaseUrl(webBaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(webBaseUrl);
  } catch {
    throw new Error(
      "Invalid environment configuration: WEB_BASE_URL must be an absolute https:// URL.",
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `Invalid environment configuration: WEB_BASE_URL must use https (got ${url.protocol}).`,
    );
  }
  if (!(ALLOWED_WEB_ORIGINS as readonly string[]).includes(url.origin)) {
    throw new Error(
      `Invalid environment configuration: WEB_BASE_URL origin ${url.origin} is not on the allowlist.`,
    );
  }
}

/**
 * The Google OAuth bundle (#16) is validated here rather than in the zod schema: ALL-OR-NOTHING —
 * five REQUIRED vars present ⇒ settings; none ⇒ `undefined` (ships dark); a partial set fails fast
 * naming the gap. `encKey` is parseKey-validated at boot (a wrong-length key throws here). Read via
 * index access so the env names stay strings, not hardcoded key/value pairs.
 *
 * #106 — three OPTIONAL self-serve vars (SETUP_TOKEN / WEB_BASE_URL / ALLOWED_GOOGLE_EMAIL) ride
 * alongside: each absent ⇒ admin-only mode (the field reads undefined); each present is boot-validated.
 */
function readGoogleBundle(
  env: Record<string, string | undefined>,
): GoogleOAuthSettings | undefined {
  const clientId = env.GOOGLE_CLIENT_ID;
  const cs = env["GOOGLE_CLIENT_SECRET"];
  const redirectUri = env.GOOGLE_REDIRECT_URI;
  const encB64 = env["GOOGLE_TOKEN_ENC_KEY"];
  const adminToken = env["ADMIN_TOKEN"];
  const vals = [clientId, cs, redirectUri, encB64, adminToken];
  const present = vals.filter((v) => v && v.length > 0).length;
  if (present === 0) return undefined; // ships dark
  if (present < vals.length) {
    throw new Error(
      "Invalid environment configuration: the Google OAuth bundle is all-or-nothing — set every " +
        "GOOGLE_* var (GOOGLE_CLIENT_ID/_SECRET/_REDIRECT_URI/_TOKEN_ENC_KEY + ADMIN_TOKEN) or none.",
    );
  }
  const admin = adminToken as string;
  const setupToken = env[kSetup];
  if (setupToken) validateSetupToken(setupToken, admin);
  const webBaseUrl = env.WEB_BASE_URL;
  if (webBaseUrl) validateWebBaseUrl(webBaseUrl);
  const allowedEmail = env.ALLOWED_GOOGLE_EMAIL;

  const csField = "clientSecret"; // computed key, so the field name isn't a literal key/value pair
  return {
    clientId: clientId as string,
    redirectUri: redirectUri as string,
    adminToken: admin,
    encKey: parseKey(encB64 as string),
    [csField]: cs as string,
    setupToken: setupToken || undefined,
    webBaseUrl: webBaseUrl || undefined,
    allowedEmail: allowedEmail || undefined,
  } as GoogleOAuthSettings;
}

/**
 * #225 — the Supabase Auth bundle is all-or-nothing: both SUPABASE_URL and a non-empty ALLOWED_LOGIN_EMAILS
 * present ⇒ settings (session gate active); neither ⇒ undefined (the read/write routes ship disabled/503,
 * the dev/app-only path the retired READ_TOKEN expressed); a partial set fails fast naming the gap. An empty
 * allowlist alongside a URL is rejected — it would lock out every web user.
 */
function readSupabaseBundle(
  url: string | undefined,
  emails: string[] | undefined,
): SupabaseAuthSettings | undefined {
  if (!url && (!emails || emails.length === 0)) return undefined; // ships dark
  if (!url) {
    throw new Error(
      "Invalid environment configuration: ALLOWED_LOGIN_EMAILS is set but SUPABASE_URL is missing.",
    );
  }
  if (!emails || emails.length === 0) {
    throw new Error(
      "Invalid environment configuration: SUPABASE_URL is set but ALLOWED_LOGIN_EMAILS is empty " +
        "(an empty allowlist would lock out every web user).",
    );
  }
  return { url, allowedLoginEmails: emails };
}

/**
 * Parse and validate the environment, failing fast with a message that names the
 * offending variable(s). Inject `env` in tests; defaults to `process.env`.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  const cfg: Config = {
    verifyToken: e.VERIFY_TOKEN,
    whatsappToken: e.WHATSAPP_TOKEN,
    phoneNumberId: e.PHONE_NUMBER_ID,
    graphVersion: e.GRAPH_VERSION,
    allowlist: e.ALLOWLIST,
    members: e.MEMBERS,
    port: e.PORT,
    anthropicModel: e.ANTHROPIC_MODEL,
    dbPath: e.DB_PATH,
    appSecret: e.APP_SECRET,
    adminPhone: e.ADMIN_PHONE,
    digestHour: e.DIGEST_HOUR,
    backupHour: e.BACKUP_HOUR,
    maxPerSenderPerDay: e.MAX_PER_SENDER_PER_DAY,
    conversationTtlMs: e.CONVERSATION_TTL_MIN * 60_000,
    gmailMaxMessages: e.GMAIL_MAX_MESSAGES,
    gmailQueryWindow: e.GMAIL_QUERY_WINDOW,
    gmailAllowedLabels: e.GMAIL_ALLOWED_LABELS,
    calendarMaxEvents: e.CALENDAR_MAX_EVENTS,
    calendarWindowDays: e.CALENDAR_WINDOW_DAYS,
    calendarId: e.CALENDAR_ID,
    calendarAutoPush: e.CALENDAR_AUTO_PUSH,
    google: readGoogleBundle(env),
    supabase: readSupabaseBundle(e.SUPABASE_URL, e.ALLOWED_LOGIN_EMAILS),
  };
  return cfg;
}
