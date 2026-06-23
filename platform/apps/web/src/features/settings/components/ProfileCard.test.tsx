import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileCard } from "./ProfileCard";

describe("ProfileCard", () => {
  it("renders the profile name, email, and an edit affordance", () => {
    render(<ProfileCard />);
    expect(screen.getByText("אמא")).toBeInTheDocument();
    expect(screen.getByText("ima@mishpachat-homeos.co.il")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "עריכה" })).toBeInTheDocument();
  });
});
