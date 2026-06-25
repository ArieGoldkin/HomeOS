import { ThemeProvider } from "@shared/theme";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { SettingsView } from "./SettingsView";

// SettingsView consumes useTheme(), so every render needs the provider. A fresh provider re-seeds from
// localStorage / the data-theme attribute, both reset below so theme assertions don't leak across tests.
function wrap(node: ReactNode) {
  return <ThemeProvider>{node}</ThemeProvider>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("SettingsView", () => {
  it("renders the heading", () => {
    render(wrap(<SettingsView />));
    expect(screen.getByText("ההגדרות")).toBeInTheDocument();
    expect(screen.getByText("שלי")).toBeInTheDocument();
  });

  it("renders the profile card (name + email + edit)", () => {
    render(wrap(<SettingsView />));
    expect(screen.getByTestId("profile-card")).toBeInTheDocument();
    expect(screen.getByText("ima@mishpachat-homeos.co.il")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "עריכה" })).toBeInTheDocument();
  });

  it("renders the Appearance theme toggle with both options", () => {
    render(wrap(<SettingsView />));
    expect(screen.getByText("מראה")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "ערכת נושא" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "בהיר" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "כהה" })).toBeInTheDocument();
  });

  it("flips the theme to dark and persists it when the dark segment is chosen", async () => {
    render(wrap(<SettingsView />));
    await userEvent.click(screen.getByRole("radio", { name: "כהה" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("homeos-theme")).toBe("dark");
  });

  it("renders the notification switches and toggles one (mock, client-only)", async () => {
    render(wrap(<SettingsView />));
    expect(screen.getByText("התראות")).toBeInTheDocument();
    const sys = screen.getByRole("switch", { name: "עדכוני מערכת" });
    expect(sys).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sys);
    expect(sys).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the static General rows", () => {
    render(wrap(<SettingsView />));
    expect(screen.getByText("כללי")).toBeInTheDocument();
    expect(screen.getByText("שפה")).toBeInTheDocument();
    expect(screen.getByText("עברית")).toBeInTheDocument();
    expect(screen.getByText("אזור זמן")).toBeInTheDocument();
    expect(screen.getByText("ירושלים")).toBeInTheDocument();
  });

  it("keeps the static About rows", () => {
    render(wrap(<SettingsView />));
    expect(screen.getByText("אודות")).toBeInTheDocument();
    expect(screen.getByText("גרסה")).toBeInTheDocument();
    expect(screen.getByText("0.0.0")).toBeInTheDocument();
    expect(screen.getByText("HomeOS")).toBeInTheDocument();
  });

  it("leaves layout (dir) to the AppShell — no redundant dir on the root", () => {
    render(wrap(<SettingsView />));
    expect(screen.getByTestId("settings-view")).not.toHaveAttribute("dir");
  });
});
