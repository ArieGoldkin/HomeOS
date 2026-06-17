import { z } from "zod";

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
});

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
  return {
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
  };
}
