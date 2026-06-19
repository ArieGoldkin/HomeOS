import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokensView } from "./TokensView";

describe("TokensView", () => {
  it("renders the ocean primary swatch", () => {
    render(<TokensView />);
    expect(screen.getByText("primary (ocean)")).toBeInTheDocument();
    expect(screen.getByText("--primary")).toBeInTheDocument();
  });
});
