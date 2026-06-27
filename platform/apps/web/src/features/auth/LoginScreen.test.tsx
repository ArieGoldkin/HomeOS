import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "./LoginScreen";

// LoginScreen's only side-effect is the OAuth kickoff — mock it (no live Supabase / no navigation).
const signInWithGoogle = vi.fn();
vi.mock("@shared/auth", () => ({ signInWithGoogle: () => signInWithGoogle() }));

describe("LoginScreen (#225)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithGoogle.mockResolvedValue(undefined);
  });

  it("renders the standalone login card with the Hebrew Google sign-in action", () => {
    render(<LoginScreen />);
    expect(screen.getByTestId("login-screen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /התחברות עם Google/ })).toBeInTheDocument();
  });

  it("kicks off the Google OAuth round-trip on click", async () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByTestId("google-signin"));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
  });

  it("re-enables the button when the sign-in kickoff fails (no redirect happened)", async () => {
    signInWithGoogle.mockRejectedValueOnce(new Error("network"));
    render(<LoginScreen />);
    const button = screen.getByTestId("google-signin");
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });
});
