import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth surface ProfileCard consumes (no live Supabase). h.user is swapped per test.
const h = vi.hoisted(() => {
  type User = {
    status: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
  const user: User = {
    status: "authenticated",
    full_name: "נועה לוי",
    email: "noa@example.com",
    avatar_url: null,
  };
  return { user, updateDisplayName: vi.fn() };
});

vi.mock("@shared/auth", () => ({
  useCurrentUser: () => h.user,
  updateDisplayName: h.updateDisplayName,
}));

import { ProfileCard } from "./ProfileCard";

describe("ProfileCard (#230 — identity from session)", () => {
  beforeEach(() => {
    h.updateDisplayName.mockReset().mockResolvedValue(undefined);
    Object.assign(h.user, {
      status: "authenticated",
      full_name: "נועה לוי",
      email: "noa@example.com",
      avatar_url: null,
    });
  });

  it("renders the session name + email and an edit affordance", () => {
    render(<ProfileCard />);
    expect(screen.getByText("נועה לוי")).toBeInTheDocument();
    expect(screen.getByText("noa@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "עריכה" })).toBeInTheDocument();
  });

  it("renders the Google avatar image when avatar_url is present", () => {
    h.user.avatar_url = "https://lh3.googleusercontent.com/a.png";
    render(<ProfileCard />);
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute(
      "src",
      "https://lh3.googleusercontent.com/a.png",
    );
  });

  it("falls back to the email as the name when full_name is null (no hardcoded name)", () => {
    h.user.full_name = null;
    render(<ProfileCard />);
    // email stands in for the name → it appears as both the name and the email line; never a fake name.
    expect(screen.getAllByText("noa@example.com").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("אמא")).not.toBeInTheDocument();
  });

  it("shows a skeleton (no name) while the session is loading", () => {
    h.user.status = "loading";
    render(<ProfileCard />);
    expect(screen.getByTestId("profile-card")).toBeInTheDocument();
    expect(screen.queryByText("נועה לוי")).not.toBeInTheDocument();
  });

  it("edits the name: עריכה → input → שמירה calls updateDisplayName with the new value", async () => {
    render(<ProfileCard />);
    fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
    const input = screen.getByLabelText("שם");
    fireEvent.change(input, { target: { value: "נועה כהן" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(h.updateDisplayName).toHaveBeenCalledWith("נועה כהן"));
  });

  it("surfaces a failure message when the save throws", async () => {
    h.updateDisplayName.mockRejectedValue(new Error("nope"));
    render(<ProfileCard />);
    fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(/השמירה נכשלה/)).toBeInTheDocument();
  });
});
