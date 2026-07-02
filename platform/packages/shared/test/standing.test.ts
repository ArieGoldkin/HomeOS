import { describe, expect, it } from "vitest";
import { isStandingDueOn, type StandingDueInput, savedStandingSchema } from "../src/index.ts";

// #284 — the TS mirror of the event-store's remindersDueStmt STANDING branch. The SQL is authoritative;
// apps/server/test pins SQL ≡ TS with an equivalence matrix over in-memory SQLite. These specs pin the
// predicate's own semantics table-driven, including the deliberately mirrored quirks:
// no done-exclusion, inclusive window ends, missing `until` → not due.

const base: StandingDueInput = {
  kind: "reminder",
  date_iso: "2026-07-01",
  source_provider: null,
  standing: { cadence: "daily", until: "2026-07-31" },
};

describe("isStandingDueOn (#284)", () => {
  it.each([
    // [name, event overrides, dayIso, expected]
    ["mid-window day", {}, "2026-07-15", true],
    ["anchor day itself (inclusive start)", {}, "2026-07-01", true],
    ["window end day (inclusive end)", {}, "2026-07-31", true],
    ["day before the anchor", {}, "2026-06-30", false],
    ["day after the window end", {}, "2026-08-01", false],
    ["not a reminder (task)", { kind: "task" }, "2026-07-15", false],
    ["not a reminder (event)", { kind: "event" }, "2026-07-15", false],
    ["synced provider row excluded", { source_provider: "google" }, "2026-07-15", false],
    ["no standing signal", { standing: null }, "2026-07-15", false],
    ["standing undefined", { standing: undefined }, "2026-07-15", false],
    [
      "missing until (pre-#284 payload) → not due, never re-derived",
      { standing: { cadence: "daily" as const } },
      "2026-07-15",
      false,
    ],
  ])("%s", (_name, over, dayIso, expected) => {
    expect(isStandingDueOn({ ...base, ...over }, dayIso)).toBe(expected);
  });

  it("has NO done-exclusion — a done status is invisible to the predicate (the series survives)", () => {
    // StandingDueInput deliberately has no status field; a full SavedEvent with status:"done" still
    // matches structurally and stays due — mirroring the SQL branch, which never checks status.
    const done = { ...base, status: "done" };
    expect(isStandingDueOn(done, "2026-07-15")).toBe(true);
  });
});

describe("savedStandingSchema (#284)", () => {
  it("round-trips the served shape with until", () => {
    expect(savedStandingSchema.parse({ cadence: "daily", until: "2026-07-31" })).toEqual({
      cadence: "daily",
      until: "2026-07-31",
    });
  });

  it("stays valid without until (old-server payload during the deploy window)", () => {
    expect(savedStandingSchema.parse({ cadence: "daily" })).toEqual({ cadence: "daily" });
  });

  it("rejects a malformed until", () => {
    expect(savedStandingSchema.safeParse({ cadence: "daily", until: "31/07/2026" }).success).toBe(
      false,
    );
  });
});
