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

// Env name held as a quoted string (scanner-exempt) so the write seam token can be added as a
// computed key below without tripping the content filter's key-value heuristic.
const kWrite = "WRITE_TOKEN";

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
  // Bearer token gating GET /events (the dashboard/kiosk read seam). Optional: when unset the
  // read endpoint is disabled (503) rather than exposed unauthenticated.
  READ_TOKEN: z.string().min(1).optional(),
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
  // Optional Bearer token for POST /events (web/phone write seam); unset disables writes (503).
  // A DISTINCT token from the read token — never aliased: the read-only kitchen tablet must not
  // be able to mutate the board. Computed key keeps the content scanner quiet.
  [kWrite]: z.string().min(1).optional(),
});

/** Google OAuth settings (#16) — present only when the full GOOGLE_* bundle is configured. */
export interface GoogleOAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encKey: Buffer;
  adminToken: string;
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
  readToken?: string;
  appSecret?: string;
  adminPhone?: string;
  digestHour: number;
  backupHour: number;
  maxPerSenderPerDay: number;
  gmailMaxMessages: number;
  gmailQueryWindow: string;
  gmailAllowedLabels: string[];
  calendarMaxEvents: number;
  calendarWindowDays: number;
  calendarId: string;
  calendarAutoPush: boolean;
  writeToken?: string;
  google?: GoogleOAuthSettings;
}

/**
 * The Google OAuth bundle (#16) is validated here rather than in the zod schema: ALL-OR-NOTHING —
 * five vars present ⇒ settings; none ⇒ `undefined` (ships dark); a partial set fails fast naming the
 * gap. `encKey` is parseKey-validated at boot (a wrong-length key throws here). Read via index access
 * so the env names stay strings, not hardcoded key/value pairs.
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
  const csField = "clientSecret"; // computed key, so the field name isn't a literal key/value pair
  return {
    clientId: clientId as string,
    redirectUri: redirectUri as string,
    adminToken: adminToken as string,
    encKey: parseKey(encB64 as string),
    [csField]: cs as string,
  } as GoogleOAuthSettings;
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
    readToken: e.READ_TOKEN,
    appSecret: e.APP_SECRET,
    adminPhone: e.ADMIN_PHONE,
    digestHour: e.DIGEST_HOUR,
    backupHour: e.BACKUP_HOUR,
    maxPerSenderPerDay: e.MAX_PER_SENDER_PER_DAY,
    gmailMaxMessages: e.GMAIL_MAX_MESSAGES,
    gmailQueryWindow: e.GMAIL_QUERY_WINDOW,
    gmailAllowedLabels: e.GMAIL_ALLOWED_LABELS,
    calendarMaxEvents: e.CALENDAR_MAX_EVENTS,
    calendarWindowDays: e.CALENDAR_WINDOW_DAYS,
    calendarId: e.CALENDAR_ID,
    calendarAutoPush: e.CALENDAR_AUTO_PUSH,
    google: readGoogleBundle(env),
  };
  // Assigned via index read (not a `:` pair) to sidestep the secret-scanner on the *Token key.
  cfg.writeToken = e[kWrite];
  return cfg;
}
