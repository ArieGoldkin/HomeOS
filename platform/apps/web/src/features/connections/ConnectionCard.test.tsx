import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionCard } from "./ConnectionCard";

describe("ConnectionCard", () => {
  it("renders the name + description and a disabled action when not connected", () => {
    render(<ConnectionCard name="Google Calendar" description="אירועים מהיומן ללוח" />);
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("אירועים מהיומן ללוח")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "בקרוב" })).toBeDisabled();
  });

  it("shows a connected indicator (no action) when connected", () => {
    render(<ConnectionCard name="Google Calendar" connected />);
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
