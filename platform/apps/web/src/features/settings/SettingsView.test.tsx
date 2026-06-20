import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("renders the general section heading", () => {
    render(<SettingsView />);
    expect(screen.getByText("כללי")).toBeInTheDocument();
  });

  it("renders שפה row with value עברית", () => {
    render(<SettingsView />);
    expect(screen.getByText("שפה")).toBeInTheDocument();
    expect(screen.getByText("עברית")).toBeInTheDocument();
  });

  it("renders אזור זמן row with value ירושלים", () => {
    render(<SettingsView />);
    expect(screen.getByText("אזור זמן")).toBeInTheDocument();
    expect(screen.getByText("ירושלים")).toBeInTheDocument();
  });

  it("renders the about section heading", () => {
    render(<SettingsView />);
    expect(screen.getByText("אודות")).toBeInTheDocument();
  });

  it("renders גרסה row with a version value", () => {
    render(<SettingsView />);
    expect(screen.getByText("גרסה")).toBeInTheDocument();
    expect(screen.getByText("0.0.0")).toBeInTheDocument();
  });

  it("renders HomeOS row", () => {
    render(<SettingsView />);
    expect(screen.getByText("HomeOS")).toBeInTheDocument();
  });

  it("leaves layout (dir/padding/background) to PhoneShell — no redundant dir on the root", () => {
    render(<SettingsView />);
    const root = screen.getByTestId("settings-view");
    expect(root).not.toHaveAttribute("dir");
  });
});
