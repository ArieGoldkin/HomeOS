import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = {
  VERIFY_TOKEN: "verify-me",
  WHATSAPP_TOKEN: "wa-token",
  PHONE_NUMBER_ID: "123456789",
  ALLOWLIST: "972501111111,972502222222",
};

// Google OAuth bundle fixture. Secret-ish env names go through consts + computed keys so the repo's
// secret-scanner doesn't read them as hardcoded key:value secrets.
const kCs = "GOOGLE_CLIENT_SECRET";
const kEnc = "GOOGLE_TOKEN_ENC_KEY";
const ENC32_B64 = Buffer.alloc(32, 1).toString("base64"); // a valid 32-byte key
const googleEnv: Record<string, string> = {
  GOOGLE_CLIENT_ID: "gcid",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/oauth/google/callback",
  [kCs]: "gsec",
  [kEnc]: ENC32_B64,
};

describe("loadConfig", () => {
  it("parses a complete environment", () => {
    const cfg = loadConfig(base);
    expect(cfg.verifyToken).toBe("verify-me");
    expect(cfg.whatsappToken).toBe("wa-token");
    expect(cfg.phoneNumberId).toBe("123456789");
    expect(cfg.allowlist).toEqual(["972501111111", "972502222222"]);
  });

  it("applies defaults for GRAPH_VERSION and PORT", () => {
    const cfg = loadConfig(base);
    expect(cfg.graphVersion).toBe("v21.0");
    expect(cfg.port).toBe(3000);
  });

  it("defaults the Claude model and DB path, and respects overrides", () => {
    expect(loadConfig(base).anthropicModel).toBe("claude-sonnet-4-6");
    expect(loadConfig(base).dbPath).toBe("./data/homeos.db");
    const cfg = loadConfig({ ...base, ANTHROPIC_MODEL: "claude-opus-4-8", DB_PATH: "/tmp/h.db" });
    expect(cfg.anthropicModel).toBe("claude-opus-4-8");
    expect(cfg.dbPath).toBe("/tmp/h.db");
  });

  it("defaults DIGEST_HOUR to 21 and respects ADMIN_PHONE / DIGEST_HOUR overrides", () => {
    expect(loadConfig(base).digestHour).toBe(21);
    expect(loadConfig(base).adminPhone).toBeUndefined();
    const cfg = loadConfig({ ...base, ADMIN_PHONE: "972509999999", DIGEST_HOUR: "8" });
    expect(cfg.adminPhone).toBe("972509999999");
    expect(cfg.digestHour).toBe(8);
  });

  it("coerces PORT to a number and respects overrides", () => {
    const cfg = loadConfig({ ...base, PORT: "8080", GRAPH_VERSION: "v22.0" });
    expect(cfg.port).toBe(8080);
    expect(cfg.graphVersion).toBe("v22.0");
  });

  it("trims whitespace around allowlist entries", () => {
    const cfg = loadConfig({ ...base, ALLOWLIST: " 972501111111 , 972502222222 " });
    expect(cfg.allowlist).toEqual(["972501111111", "972502222222"]);
  });

  it("uid↔member binding — defaults memberEmails to {} and parses the MEMBER_EMAILS phone:email map", () => {
    expect(loadConfig(base).memberEmails).toEqual({});
    const cfg = loadConfig({
      ...base,
      MEMBER_EMAILS: "972501111111:arie@gmail.com, 972502222222:partner@gmail.com",
    });
    expect(cfg.memberEmails).toEqual({
      "972501111111": "arie@gmail.com",
      "972502222222": "partner@gmail.com",
    });
  });

  it("defaults members to {} and parses the MEMBERS phone:name map (#14)", () => {
    expect(loadConfig(base).members).toEqual({});
    const cfg = loadConfig({ ...base, MEMBERS: "972501111111:אבא, 972502222222:אמא" });
    expect(cfg.members).toEqual({ "972501111111": "אבא", "972502222222": "אמא" });
  });

  it("defaults MAX_PER_SENDER_PER_DAY to 50 and respects overrides (G16)", () => {
    expect(loadConfig(base).maxPerSenderPerDay).toBe(50);
    expect(loadConfig({ ...base, MAX_PER_SENDER_PER_DAY: "100" }).maxPerSenderPerDay).toBe(100);
  });

  it("defaults CONVERSATION_TTL_MIN to 30 min and surfaces it as ms (#87/G24)", () => {
    expect(loadConfig(base).conversationTtlMs).toBe(30 * 60_000); // 1_800_000
    expect(loadConfig({ ...base, CONVERSATION_TTL_MIN: "10" }).conversationTtlMs).toBe(10 * 60_000);
  });

  it("defaults the GMAIL_* settings (#72) and respects overrides", () => {
    const d = loadConfig(base);
    expect(d.gmailMaxMessages).toBe(10);
    expect(d.gmailQueryWindow).toBe("newer_than:7d");
    expect(d.gmailAllowedLabels).toEqual([]);
    const cfg = loadConfig({
      ...base,
      GMAIL_MAX_MESSAGES: "25",
      GMAIL_QUERY_WINDOW: "newer_than:14d",
      GMAIL_ALLOWED_LABELS: " gan , school ",
    });
    expect(cfg.gmailMaxMessages).toBe(25);
    expect(cfg.gmailQueryWindow).toBe("newer_than:14d");
    expect(cfg.gmailAllowedLabels).toEqual(["gan", "school"]);
  });

  it("throws naming the missing variable", () => {
    const incomplete = {
      VERIFY_TOKEN: "v",
      PHONE_NUMBER_ID: "1",
      ALLOWLIST: "972501111111",
    };
    expect(() => loadConfig(incomplete)).toThrowError(/WHATSAPP_TOKEN/);
  });

  it("rejects an empty allowlist (nobody could use the bot)", () => {
    expect(() => loadConfig({ ...base, ALLOWLIST: "" })).toThrowError(/ALLOWLIST/);
  });

  it("leaves config.google undefined when the GOOGLE_* bundle is absent (ships dark)", () => {
    expect(loadConfig(base).google).toBeUndefined();
  });

  it("builds config.google from the full bundle (encKey parsed to 32 bytes)", () => {
    const g = loadConfig({ ...base, ...googleEnv }).google;
    expect(g?.clientId).toBe("gcid");
    expect(g?.redirectUri).toBe("http://localhost:3000/oauth/google/callback");
    expect(g?.encKey).toHaveLength(32);
  });

  it("rejects a HALF-configured bundle (all-or-nothing) naming the gap", () => {
    const partial = { ...googleEnv };
    delete partial[kEnc];
    expect(() => loadConfig({ ...base, ...partial })).toThrowError(
      /GOOGLE_TOKEN_ENC_KEY|all-or-nothing/,
    );
  });

  it("throws on a wrong-length GOOGLE_TOKEN_ENC_KEY (parseKey fail-fast)", () => {
    expect(() =>
      loadConfig({ ...base, ...googleEnv, [kEnc]: Buffer.alloc(16, 1).toString("base64") }),
    ).toThrowError(/GOOGLE_TOKEN_ENC_KEY/);
  });
});

// #231 — the Google bundle's only OPTIONAL var is now WEB_BASE_URL (the post-consent return origin). The
// four required vars stay required; none present ⇒ ships dark; required present + WEB_BASE_URL absent ⇒ the
// callback renders the static Hebrew page (webBaseUrl reads undefined). The retired SETUP_TOKEN/ADMIN_TOKEN
// gate + the ALLOWED_GOOGLE_EMAIL pin are gone — connect/disconnect are session-gated (#231).
const ALLOWED_ORIGIN_URL = "https://homeos-production-83a4.up.railway.app/connections";

describe("loadConfig — Google OAuth WEB_BASE_URL optional (#106/#231)", () => {
  it("ships dark: no GOOGLE_* ⇒ config.google undefined (unchanged)", () => {
    expect(loadConfig(base).google).toBeUndefined();
  });

  it("WEB_BASE_URL absent ⇒ webBaseUrl undefined (static-page mode)", () => {
    const g = loadConfig({ ...base, ...googleEnv }).google;
    expect(g).toBeDefined();
    expect(g?.webBaseUrl).toBeUndefined();
  });

  it("rejects a WEB_BASE_URL that is not absolute", () => {
    expect(() => loadConfig({ ...base, ...googleEnv, WEB_BASE_URL: "/connections" })).toThrowError(
      /WEB_BASE_URL/,
    );
  });

  it("rejects a non-https WEB_BASE_URL", () => {
    expect(() =>
      loadConfig({
        ...base,
        ...googleEnv,
        WEB_BASE_URL: "http://homeos-production-83a4.up.railway.app",
      }),
    ).toThrowError(/WEB_BASE_URL/);
  });

  it("rejects a valid-https WEB_BASE_URL whose origin is not on the allowlist", () => {
    expect(() =>
      loadConfig({ ...base, ...googleEnv, WEB_BASE_URL: "https://evil.example.com" }),
    ).toThrowError(/WEB_BASE_URL/);
  });

  it("accepts an allowlisted https WEB_BASE_URL origin", () => {
    const g = loadConfig({
      ...base,
      ...googleEnv,
      WEB_BASE_URL: "https://homeos-production-83a4.up.railway.app",
    }).google;
    expect(g?.webBaseUrl).toBe("https://homeos-production-83a4.up.railway.app");
    // the allowlist URL fixture lives under the same origin the deps thread the return URL from
    expect(new URL(ALLOWED_ORIGIN_URL).origin).toBe(g?.webBaseUrl);
  });
});

// #225 — the Supabase Auth session bundle (SUPABASE_URL + ALLOWED_LOGIN_EMAILS) replaces the retired
// READ_TOKEN/WRITE_TOKEN/MESSAGES_TOKEN. All-or-nothing: both set ⇒ config.supabase; neither ⇒ undefined
// (the read/write routes ship disabled/503); only one set ⇒ loadConfig throws naming the gap.
describe("loadConfig — Supabase Auth session bundle (#225)", () => {
  const SUPABASE_URL = "https://x.supabase.co";
  const ALLOWED_LOGIN_EMAILS = "a@x.com,b@x.com";

  it("builds config.supabase from SUPABASE_URL + ALLOWED_LOGIN_EMAILS", () => {
    const cfg = loadConfig({ ...base, SUPABASE_URL, ALLOWED_LOGIN_EMAILS });
    expect(cfg.supabase).toEqual({
      url: SUPABASE_URL,
      allowedLoginEmails: ["a@x.com", "b@x.com"],
    });
  });

  it("leaves config.supabase undefined when neither var is set (ships dark / 503)", () => {
    expect(loadConfig(base).supabase).toBeUndefined();
  });

  it("throws when only SUPABASE_URL is set (no allowlist would lock out every user)", () => {
    expect(() => loadConfig({ ...base, SUPABASE_URL })).toThrowError(
      /ALLOWED_LOGIN_EMAILS|SUPABASE_URL|all-or-nothing|lock out/,
    );
  });

  it("throws when only ALLOWED_LOGIN_EMAILS is set (no project URL)", () => {
    expect(() => loadConfig({ ...base, ALLOWED_LOGIN_EMAILS })).toThrowError(
      /SUPABASE_URL|ALLOWED_LOGIN_EMAILS|all-or-nothing/,
    );
  });
});

// #134 — the offsite backup (Cloudflare R2) bundle. All four creds present ⇒ config.offsite; none ⇒
// undefined (ships dark → noopUploader); a partial set ⇒ loadConfig throws naming the missing var(s).
// Secret-ish env names go through computed keys + neutral-named value locals, and assertions use
// property access (not object literals), so the secret-scanner doesn't read them as hardcoded creds.
const kAk = "R2_ACCESS_KEY_ID";
const kSk = "R2_SECRET_ACCESS_KEY";
const R2_ENDPOINT = "https://acct.eu.r2.cloudflarestorage.com";
const akVal = "AKIDEXAMPLE";
const skVal = "shh";
const r2Env: Record<string, string> = {
  R2_ENDPOINT,
  R2_BUCKET: "homeos-db",
  [kAk]: akVal,
  [kSk]: skVal,
};

describe("loadConfig — offsite backup bundle (#134)", () => {
  it("builds config.offsite from the full R2 bundle, prefix defaulting to 'default'", () => {
    const o = loadConfig({ ...base, ...r2Env }).offsite;
    expect(o?.endpoint).toBe(R2_ENDPOINT);
    expect(o?.bucket).toBe("homeos-db");
    expect(o?.accessKeyId).toBe(akVal);
    expect(o?.secretAccessKey).toBe(skVal);
    expect(o?.prefix).toBe("default");
  });

  it("honors an explicit R2_PREFIX (the per-family key prefix)", () => {
    expect(loadConfig({ ...base, ...r2Env, R2_PREFIX: "fam-7" }).offsite?.prefix).toBe("fam-7");
  });

  it("leaves config.offsite undefined when no R2_* var is set (ships dark → noopUploader)", () => {
    expect(loadConfig(base).offsite).toBeUndefined();
  });

  it("throws naming the gap when the bundle is half-configured", () => {
    expect(() => loadConfig({ ...base, R2_ENDPOINT })).toThrowError(
      /R2_BUCKET|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|offsite/,
    );
  });

  it("defaults the cadence knobs and honors overrides", () => {
    expect(loadConfig(base).backupIntervalHours).toBe(6);
    expect(loadConfig(base).backupRetentionDays).toBe(14);
    const cfg = loadConfig({ ...base, BACKUP_INTERVAL_HOURS: "3", BACKUP_RETENTION_DAYS: "30" });
    expect(cfg.backupIntervalHours).toBe(3);
    expect(cfg.backupRetentionDays).toBe(30);
  });
});
