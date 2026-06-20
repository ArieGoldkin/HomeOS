import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionsView } from "./ConnectionsView";

describe("ConnectionsView", () => {
  it("renders the header and the placeholder connection cards", () => {
    render(<ConnectionsView />);
    expect(screen.getByText("חיבורים")).toBeInTheDocument();
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("Gmail")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "בקרוב" })).toHaveLength(2);
  });
});
