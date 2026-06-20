import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemberListItem } from "./MemberListItem";

describe("MemberListItem", () => {
  it("renders the member name", () => {
    render(<MemberListItem name="אמא" />);
    expect(screen.getByText("אמא")).toBeInTheDocument();
  });

  it("renders an optional subtitle", () => {
    render(<MemberListItem name="יואב" subtitle="כיתה ב׳" />);
    expect(screen.getByText("כיתה ב׳")).toBeInTheDocument();
  });

  it("shows an offline presence dot by default", () => {
    render(<MemberListItem name="נועה" />);
    expect(screen.getByLabelText("לא מחובר")).toBeInTheDocument();
  });

  it("shows an online presence dot when online", () => {
    render(<MemberListItem name="אבא" online />);
    expect(screen.getByLabelText("מחובר")).toBeInTheDocument();
  });
});
