import { describe, expect, it } from "vitest";
import {
  CONNECT_OUTCOMES,
  type ConnectionStatus,
  type ConnectOutcome,
  connectionStatusSchema,
  connectOutcomeSchema,
} from "../src/index.ts";

// Fixtures mirror the server's GET /oauth/google/status payload (#108). The `: ConnectionStatus`
// annotation is the compile-time half — it fails typecheck if the schema/type drift from the served shape.
const disconnected: ConnectionStatus = { connected: false };
const connected: ConnectionStatus = {
  connected: true,
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
  expiresAt: "2026-06-25T09:00:00Z",
};

describe("connectionStatusSchema (the served GET /oauth/google/status payload)", () => {
  it("parses the disconnected shape { connected: false }", () => {
    expect(connectionStatusSchema.parse(disconnected)).toEqual({ connected: false });
  });

  it("parses the connected shape with scopes + expiresAt", () => {
    expect(connectionStatusSchema.parse(connected)).toMatchObject({
      connected: true,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    });
  });

  it("rejects extra fields (shape-drift fails loudly)", () => {
    expect(() => connectionStatusSchema.parse({ connected: false, token: "leak" })).toThrow();
    expect(() => connectionStatusSchema.parse({ ...connected, refresh: "leak" })).toThrow();
  });

  it("rejects a connected payload missing scopes or expiresAt", () => {
    expect(() => connectionStatusSchema.parse({ connected: true, scopes: ["x"] })).toThrow();
    expect(() => connectionStatusSchema.parse({ connected: true, expiresAt: "x" })).toThrow();
  });

  it("rejects a missing/invalid discriminator", () => {
    expect(() => connectionStatusSchema.parse({})).toThrow();
    expect(() => connectionStatusSchema.parse({ connected: "yes" })).toThrow();
  });
});

describe("connectOutcomeSchema (the ?status= banner slugs — one source of truth, server + web)", () => {
  it("parses every valid outcome, including the new bad_account", () => {
    for (const outcome of CONNECT_OUTCOMES) {
      expect(connectOutcomeSchema.parse(outcome)).toBe(outcome);
    }
    expect(CONNECT_OUTCOMES).toContain("bad_account");
  });

  it("rejects an unknown outcome", () => {
    expect(() => connectOutcomeSchema.parse("hijacked")).toThrow();
  });

  it("is usable as a type by both consumers", () => {
    const slug: ConnectOutcome = "connected";
    expect(connectOutcomeSchema.parse(slug)).toBe("connected");
  });
});
