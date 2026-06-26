import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBindingStore } from "../../src/db/binding-store.ts";
import { createFamilyStore } from "../../src/db/family-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";

const A = "+972 50-123 4567"; // raw form WhatsApp/admin might use
const A_NORM = "972501234567"; // digit-normalized, as the resolver compares
const B = "972500000002";

const tmpDirs: string[] = [];
function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "homeos-binding-"));
  tmpDirs.push(dir);
  return join(dir, "test.db");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Read the durable result through the real #227 read seam (proves write→read normalization matches). */
function boundPhones(path: string, familyId = FAMILY_ID) {
  return createFamilyStore(path).listPhones(familyId);
}

describe("BindingStore — issueBinding (#228)", () => {
  it("mints a HOME-XXXXX code with no ambiguous glyphs (0/O, 1/I/L)", () => {
    const store = createBindingStore(":memory:");
    const code = store.issueBinding(FAMILY_ID);
    expect(code).toMatch(/^HOME-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
  });

  it("mints distinct codes across calls", () => {
    const store = createBindingStore(":memory:");
    const codes = new Set(Array.from({ length: 20 }, () => store.issueBinding(FAMILY_ID)));
    expect(codes.size).toBe(20);
  });
});

describe("BindingStore — matchBinding security matrix (#228, the merge gate)", () => {
  it("a valid code binds the sender's NORMALIZED phone to the code's family", () => {
    const path = tmpDbPath();
    const store = createBindingStore(path);
    const code = store.issueBinding(FAMILY_ID);

    expect(store.matchBinding(code, A)).toEqual({ status: "bound", familyId: FAMILY_ID });

    const phones = boundPhones(path);
    expect(phones).toHaveLength(1);
    expect(phones[0]?.from_phone).toBe(A_NORM); // stored normalized, as #229 will compare
    expect(phones[0]?.verified_at).toBeTruthy();
  });

  it("is single-use — a replay or a SECOND phone cannot reuse a consumed code", () => {
    const path = tmpDbPath();
    const store = createBindingStore(path);
    const code = store.issueBinding(FAMILY_ID);

    expect(store.matchBinding(code, A)?.status).toBe("bound");
    // Replay (Meta at-least-once) and a different phone both find the code already gone.
    expect(store.matchBinding(code, A)).toBeNull();
    expect(store.matchBinding(code, B)).toBeNull();

    const phones = boundPhones(path);
    expect(phones.map((p) => p.from_phone)).toEqual([A_NORM]); // B was never mapped to the family
  });

  it("an expired code returns null and binds nothing (fake clock past the TTL)", () => {
    const path = tmpDbPath();
    let nowMs = Date.parse("2026-06-26T12:00:00Z");
    const store = createBindingStore(path, () => new Date(nowMs));
    const code = store.issueBinding(FAMILY_ID);

    nowMs += 11 * 60 * 1000; // 11 min later — past the ~10-min TTL
    expect(store.matchBinding(code, A)).toBeNull();
    expect(boundPhones(path)).toEqual([]);
  });

  it("re-binding the same phone to the SAME family is an idempotent no-op (still bound)", () => {
    const path = tmpDbPath();
    const store = createBindingStore(path);
    expect(store.matchBinding(store.issueBinding(FAMILY_ID), A)?.status).toBe("bound");
    expect(store.matchBinding(store.issueBinding(FAMILY_ID), A)?.status).toBe("bound");
    expect(boundPhones(path)).toHaveLength(1); // INSERT OR IGNORE on (family_id, from_phone) — no dup
  });

  it("rejects a code for a DIFFERENT family when the phone is already bound (wrong_family)", () => {
    const path = tmpDbPath();
    const store = createBindingStore(path);
    // A is bound to the default family first.
    expect(store.matchBinding(store.issueBinding(FAMILY_ID), A)?.status).toBe("bound");
    // A second family issues a code; A (already bound to default) tries it → rejected, not re-bound.
    const otherCode = store.issueBinding("fam-2");
    expect(store.matchBinding(otherCode, A)).toEqual({ status: "wrong_family" });

    expect(boundPhones(path, FAMILY_ID).map((p) => p.from_phone)).toEqual([A_NORM]); // A stays default
    expect(boundPhones(path, "fam-2")).toEqual([]); // A was NOT bound to fam-2

    // The wrong-family attempt did NOT burn fam-2's code (peek-before-consume) — a fresh phone can use it.
    expect(store.matchBinding(otherCode, B)).toEqual({ status: "bound", familyId: "fam-2" });
  });

  it("a wrong / never-issued code returns null", () => {
    const store = createBindingStore(":memory:");
    expect(store.matchBinding("HOME-ZZZZZ", A)).toBeNull();
  });
});
