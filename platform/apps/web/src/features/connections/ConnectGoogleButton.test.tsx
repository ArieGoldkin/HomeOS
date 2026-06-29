import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { ConnectGoogleButton } from "./ConnectGoogleButton";

// jsdom's window.location.assign throws "Not implemented"; stub it so the success path is observable.
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assignSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: assignSpy },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function clickConnect() {
  await userEvent.click(screen.getByTestId("connect-google-open"));
}

describe("ConnectGoogleButton (#231 — session-gated, no setup code)", () => {
  it("renders a plain 'חבר Google' button with no setup-code input", () => {
    render(<ConnectGoogleButton />);
    expect(screen.getByRole("button", { name: /חבר Google/ })).toBeInTheDocument();
    expect(screen.queryByTestId("setup-code-input")).not.toBeInTheDocument();
  });

  it("on click exchanges the session and navigates to the consent URL", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () =>
        HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?ok=1" }),
      ),
    );
    render(<ConnectGoogleButton />);
    await clickConnect();
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?ok=1"),
    );
  });

  it("maps 401 to the no-session message", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 401 })),
    );
    render(<ConnectGoogleButton />);
    await clickConnect();
    await waitFor(() => expect(screen.getByText("ההתחברות פגה, התחברו מחדש")).toBeInTheDocument());
  });

  it("maps 403 to the no-session message", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 403 })),
    );
    render(<ConnectGoogleButton />);
    await clickConnect();
    await waitFor(() => expect(screen.getByText("ההתחברות פגה, התחברו מחדש")).toBeInTheDocument());
  });

  it("maps 429 to the too-many-attempts message", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 429 })),
    );
    render(<ConnectGoogleButton />);
    await clickConnect();
    await waitFor(() =>
      expect(screen.getByText("יותר מדי ניסיונות, נסו שוב מאוחר יותר")).toBeInTheDocument(),
    );
  });

  it("maps 503 to 'Google לא מוגדר בשרת' and does not navigate", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 503 })),
    );
    render(<ConnectGoogleButton />);
    await clickConnect();
    await waitFor(() => expect(screen.getByText("Google לא מוגדר בשרת")).toBeInTheDocument());
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
