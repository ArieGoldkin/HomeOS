import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useCurrentUser } from "./AuthProvider";

// A controllable fake Supabase client: getClaims seeds the initial state; the captured onAuthStateChange
// callback (h.emit) drives live sign-in / sign-out events. No live network.
const h = vi.hoisted(() => {
  type Cb = (event: string, session: unknown) => void;
  let cb: Cb | null = null;
  const getClaims = vi.fn();
  const onAuthStateChange = vi.fn((fn: Cb) => {
    cb = fn;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  return {
    supabase: { auth: { getClaims, onAuthStateChange, signOut } },
    getClaims,
    onAuthStateChange,
    signOut,
    emit: (event: string, session: unknown) => cb?.(event, session),
  };
});

vi.mock("./supabase-client", () => ({ supabase: h.supabase }));

function Probe() {
  const { status, isAuthenticated, isLoading, userId, email, full_name, avatar_url, signOut } =
    useCurrentUser();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="flags">{`${isLoading}|${isAuthenticated}`}</span>
      <span data-testid="uid">{userId ?? ""}</span>
      <span data-testid="email">{email ?? ""}</span>
      <span data-testid="name">{full_name ?? ""}</span>
      <span data-testid="avatar">{avatar_url ?? ""}</span>
      <button type="button" onClick={() => signOut()}>
        out
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider / useCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no session unless a test overrides getClaims.
    h.getClaims.mockResolvedValue({ data: null, error: null });
  });

  it("resolves to authenticated from the verified claims (mapping the user fields)", async () => {
    h.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "user-1",
          email: "fam@homeos.test",
          user_metadata: { full_name: "אבא", avatar_url: "https://img/avatar.png" },
        },
      },
      error: null,
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("flags")).toHaveTextContent("false|true");
    expect(screen.getByTestId("uid")).toHaveTextContent("user-1");
    expect(screen.getByTestId("email")).toHaveTextContent("fam@homeos.test");
    expect(screen.getByTestId("name")).toHaveTextContent("אבא");
    expect(screen.getByTestId("avatar")).toHaveTextContent("https://img/avatar.png");
  });

  it("resolves to unauthenticated when there is no session", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(screen.getByTestId("uid")).toHaveTextContent("");
  });

  it("falls back to name/picture metadata keys when full_name/avatar_url are absent", async () => {
    h.getClaims.mockResolvedValue({
      data: {
        claims: { sub: "u2", email: "x@y.z", user_metadata: { name: "נועה", picture: "pic" } },
      },
      error: null,
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("נועה"));
    expect(screen.getByTestId("avatar")).toHaveTextContent("pic");
  });

  it("goes authenticated on a live SIGNED_IN event (subscribes to onAuthStateChange)", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(h.onAuthStateChange).toHaveBeenCalledTimes(1);

    act(() => {
      h.emit("SIGNED_IN", {
        user: { id: "u9", email: "new@homeos.test", user_metadata: { full_name: "אמא" } },
      });
    });

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("email")).toHaveTextContent("new@homeos.test");
    expect(screen.getByTestId("name")).toHaveTextContent("אמא");
  });

  it("goes unauthenticated on a live SIGNED_OUT event", async () => {
    h.getClaims.mockResolvedValue({
      data: { claims: { sub: "u3", email: "a@b.c", user_metadata: {} } },
      error: null,
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    act(() => h.emit("SIGNED_OUT", null));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
  });

  it("signOut delegates to supabase.auth.signOut", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    act(() => screen.getByText("out").click());
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it("throws when useCurrentUser is used outside the provider", () => {
    // Silence the expected React error boundary logging for this render.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within <AuthProvider>/);
    spy.mockRestore();
  });
});
