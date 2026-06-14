import { describe, it, expect } from "vitest";
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

  it("coerces PORT to a number and respects overrides", () => {
    const cfg = loadConfig({ ...base, PORT: "8080", GRAPH_VERSION: "v22.0" });
    expect(cfg.port).toBe(8080);
    expect(cfg.graphVersion).toBe("v22.0");
  });

  it("trims whitespace around allowlist entries", () => {
    const cfg = loadConfig({ ...base, ALLOWLIST: " 972501111111 , 972502222222 " });
    expect(cfg.allowlist).toEqual(["972501111111", "972502222222"]);
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
