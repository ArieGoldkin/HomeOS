import { beforeEach, describe, expect, it, vi } from "vitest";

// A controllable fake Supabase client (no live network) — mirrors AuthProvider.test's pattern.
const h = vi.hoisted(() => {
  const updateUser = vi.fn();
  return { supabase: { auth: { updateUser } }, updateUser };
});

vi.mock("./supabase-client", () => ({ supabase: h.supabase }));

import { updateDisplayName } from "./update-profile";

describe("updateDisplayName (#230)", () => {
  beforeEach(() => {
    h.updateUser.mockReset();
  });

  it("writes the name to user_metadata.full_name", async () => {
    h.updateUser.mockResolvedValue({ data: {}, error: null });
    await updateDisplayName("נועה לוי");
    expect(h.updateUser).toHaveBeenCalledWith({ data: { full_name: "נועה לוי" } });
  });

  it("throws when Supabase returns an error", async () => {
    h.updateUser.mockResolvedValue({ data: null, error: new Error("nope") });
    await expect(updateDisplayName("x")).rejects.toThrow(/nope/);
  });
});
