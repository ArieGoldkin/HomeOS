import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = {
  VERIFY_TOKEN: "verify-me",
  WHATSAPP_TOKEN: "wa-token",
  PHONE_NUMBER_ID: "123456789",
  ALLOWLIST: "972501111111,972502222222",
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
    expect(loadConfig(base).anthropicModel).toBe("claude-haiku-4-5");
    expect(loadConfig(base).dbPath).toBe("./data/homeos.db");
    const cfg = loadConfig({ ...base, ANTHROPIC_MODEL: "claude-opus-4-8", DB_PATH: "/tmp/h.db" });
    expect(cfg.anthropicModel).toBe("claude-opus-4-8");
    expect(cfg.dbPath).toBe("/tmp/h.db");
  });

  it("leaves READ_TOKEN undefined when unset, and passes it through when set", () => {
    expect(loadConfig(base).readToken).toBeUndefined();
    expect(loadConfig({ ...base, READ_TOKEN: "read-secret" }).readToken).toBe("read-secret");
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
});
