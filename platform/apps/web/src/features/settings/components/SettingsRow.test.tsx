import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsRow } from "./SettingsRow";

describe("SettingsRow", () => {
  it("renders the label", () => {
    render(<SettingsRow label="שפה" />);
    expect(screen.getByText("שפה")).toBeInTheDocument();
  });

  it("renders a value when provided", () => {
    render(<SettingsRow label="שפה" value="עברית" />);
    expect(screen.getByText("עברית")).toBeInTheDocument();
  });

  it("renders a control node when provided", () => {
    render(<SettingsRow label="התראות" control={<input type="checkbox" aria-label="toggle" />} />);
    expect(screen.getByRole("checkbox", { name: "toggle" })).toBeInTheDocument();
  });

  it("renders as a <button> when onClick is provided", () => {
    render(<SettingsRow label="שפה" onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("fires the onClick callback when the button is clicked", async () => {
    const handler = vi.fn();
    render(<SettingsRow label="שפה" onClick={handler} />);
    await userEvent.click(screen.getByRole("button"));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("is NOT a button when onClick is absent", () => {
    render(<SettingsRow label="שפה" value="עברית" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a chevron affordance when onClick is provided", () => {
    render(<SettingsRow label="שפה" onClick={() => {}} />);
    // The chevron character should be present in the document
    expect(screen.getByRole("button").textContent).toContain("‹");
  });
});
