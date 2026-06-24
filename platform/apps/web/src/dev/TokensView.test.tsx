import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokensView } from "./TokensView";

describe("TokensView", () => {
  it("renders the warm-paper palette tokens", () => {
    render(<TokensView />);
    expect(screen.getByText("צבעים · palette")).toBeInTheDocument();
    expect(screen.getByText("--primary")).toBeInTheDocument();
    expect(screen.getByText("--wa-green")).toBeInTheDocument();
  });

  it("shows the three card surfaces and the four button variants", () => {
    render(<TokensView />);
    expect(screen.getByText("surface")).toBeInTheDocument();
    expect(screen.getByText("muted")).toBeInTheDocument();
    expect(screen.getByText("glass")).toBeInTheDocument();
    for (const v of ["primary", "ink", "ghost", "dashed"]) {
      expect(screen.getByRole("button", { name: v })).toBeInTheDocument();
    }
  });

  it("previews dark mode via a local data-theme toggle (no global theme change)", () => {
    render(<TokensView />);
    const root = screen.getByTestId("tokens-root");
    expect(root).toHaveAttribute("data-theme", "light");
    fireEvent.click(screen.getByRole("button", { name: /תצוגה/ }));
    expect(root).toHaveAttribute("data-theme", "dark");
  });
});
