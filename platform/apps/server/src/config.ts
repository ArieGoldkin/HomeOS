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

const schema = z.object({
  VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_TOKEN: z.string().min(1),
  PHONE_NUMBER_ID: z.string().min(1),
  GRAPH_VERSION: z.string().min(1).default("v21.0"),
  // An empty allowlist means nobody could use the bot — treat it as misconfiguration.
  ALLOWLIST: csvList.pipe(z.array(z.string()).min(1)),
  PORT: z.coerce.number().int().positive().default(3000),
  // M2: Claude parsing model + SQLite store path. The Anthropic credential itself is read
  // straight from the environment by @anthropic-ai/sdk, so it is not modeled here.
  ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-4-5"),
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
});

export interface Config {
  verifyToken: string;
  whatsappToken: string;
  phoneNumberId: string;
  graphVersion: string;
  allowlist: string[];
  port: number;
  anthropicModel: string;
  dbPath: string;
  readToken?: string;
  appSecret?: string;
  adminPhone?: string;
  digestHour: number;
  backupHour: number;
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
    port: e.PORT,
    anthropicModel: e.ANTHROPIC_MODEL,
    dbPath: e.DB_PATH,
    readToken: e.READ_TOKEN,
    appSecret: e.APP_SECRET,
    adminPhone: e.ADMIN_PHONE,
    digestHour: e.DIGEST_HOUR,
    backupHour: e.BACKUP_HOUR,
  };
}
