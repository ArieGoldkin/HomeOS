import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { ConnectGoogleButton } from "./ConnectGoogleButton";

const SETUP_CODE = "super-secret-setup-code";

// jsdom's window.location.assign throws "Not implemented"; stub it so the success path is observable.
let assignSpy: ReturnType<typeof vi.fn>;
let localSetSpy: ReturnType<typeof vi.spyOn>;
let sessionSetSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  assignSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: assignSpy },
  });
  localSetSpy = vi.spyOn(Storage.prototype, "setItem");
  sessionSetSpy = vi.spyOn(Object.getPrototypeOf(window.sessionStorage), "setItem");
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openAndSubmit(code: string) {
  await userEvent.click(screen.getByTestId("connect-google-open"));
  await userEvent.type(screen.getByTestId("setup-code-input"), code);
  await userEvent.click(screen.getByRole("button", { name: "המשך לחיבור" }));
}

describe("ConnectGoogleButton (#112 — dialog, error mapping, token never persisted)", () => {
  it("opens the dialog with a dir=ltr setup-code field", async () => {
    render(<ConnectGoogleButton />);
    await userEvent.click(screen.getByTestId("connect-google-open"));
    const input = screen.getByTestId("setup-code-input");
    expect(input).toHaveAttribute("dir", "ltr");
    expect(input).toHaveAttribute("type", "password");
  });

  it("on success exchanges the code and navigates to the consent URL", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () =>
        HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?ok=1" }),
      ),
    );
    render(<ConnectGoogleButton />);
    await openAndSubmit(SETUP_CODE);
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?ok=1"),
    );
  });

  it("maps 401 to 'קוד שגוי'", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 401 })),
    );
    render(<ConnectGoogleButton />);
    await openAndSubmit("wrong");
    await waitFor(() => expect(screen.getByText("קוד שגוי")).toBeInTheDocument());
  });

  it("maps 403 to 'קוד שגוי'", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 403 })),
    );
    render(<ConnectGoogleButton />);
    await openAndSubmit("wrong");
    await waitFor(() => expect(screen.getByText("קוד שגוי")).toBeInTheDocument());
  });

  it("maps 429 to the too-many-attempts message", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 429 })),
    );
    render(<ConnectGoogleButton />);
    await openAndSubmit("code");
    await waitFor(() =>
      expect(screen.getByText("יותר מדי ניסיונות, נסו שוב מאוחר יותר")).toBeInTheDocument(),
    );
  });

  it("maps 503 to 'Google לא מוגדר בשרת'", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 503 })),
    );
    render(<ConnectGoogleButton />);
    await openAndSubmit("code");
    await waitFor(() => expect(screen.getByText("Google לא מוגדר בשרת")).toBeInTheDocument());
  });

  it("NEVER persists the setup code to localStorage or sessionStorage", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () =>
        HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?ok=1" }),
      ),
    );
    render(<ConnectGoogleButton />);
    await openAndSubmit(SETUP_CODE);
    await waitFor(() => expect(assignSpy).toHaveBeenCalled());

    // No persistence call carried the secret code (nor any value at all, for this flow).
    for (const call of localSetSpy.mock.calls) {
      expect(call[1]).not.toContain(SETUP_CODE);
    }
    for (const call of sessionSetSpy.mock.calls) {
      expect(call[1]).not.toContain(SETUP_CODE);
    }
    expect(window.localStorage.getItem("google-setup-code")).toBeNull();
    expect(window.sessionStorage.getItem("google-setup-code")).toBeNull();
  });

  it("clears the code from the field when the dialog is closed", async () => {
    render(<ConnectGoogleButton />);
    await userEvent.click(screen.getByTestId("connect-google-open"));
    await userEvent.type(screen.getByTestId("setup-code-input"), SETUP_CODE);
    // close via the dialog's close button
    await userEvent.click(screen.getByRole("button", { name: "סגירה" }));
    // re-open: the field is empty again (in-memory state was cleared)
    await userEvent.click(screen.getByTestId("connect-google-open"));
    expect(screen.getByTestId("setup-code-input")).toHaveValue("");
  });
});
