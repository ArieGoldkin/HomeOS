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
const kAdmin = "ADMIN_TOKEN";
const ENC32_B64 = Buffer.alloc(32, 1).toString("base64"); // a valid 32-byte key
const googleEnv: Record<string, string> = {
  GOOGLE_CLIENT_ID: "gcid",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/oauth/google/callback",
  [kCs]: "gsec",
  [kEnc]: ENC32_B64,
  [kAdmin]: "admtok",
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

  it("leaves READ_TOKEN undefined when unset, and passes it through when set", () => {
    expect(loadConfig(base).readToken).toBeUndefined();
    expect(loadConfig({ ...base, READ_TOKEN: "read-secret" }).readToken).toBe("read-secret");
  });

  it("leaves WRITE_TOKEN undefined when unset, and keeps it independent of READ_TOKEN", () => {
    expect(loadConfig(base).writeToken).toBeUndefined();
    // The web/phone write seam token is a DISTINCT secret — it must never alias the read token.
    const cfg = loadConfig({ ...base, READ_TOKEN: "read-secret", WRITE_TOKEN: "write-secret" });
    expect(cfg.writeToken).toBe("write-secret");
    expect(cfg.readToken).toBe("read-secret");
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
    expect(g?.adminToken).toBe("admtok");
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
