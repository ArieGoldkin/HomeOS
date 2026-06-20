import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatsAppIngestion } from "./WhatsAppIngestion";

describe("WhatsAppIngestion", () => {
  it("shows the forward → board flow with a privacy footnote", () => {
    render(<WhatsAppIngestion />);
    // The forwarded user message and the bot confirmation bubbles.
    expect(screen.getByText(/תזכורת: אסיפת הורים/)).toBeInTheDocument();
    expect(screen.getByText(/הוספתי ליומן/)).toBeInTheDocument();
    // The resulting board event (EventCard preview).
    const board = screen.getByTestId("wa-ingestion");
    expect(board).toHaveTextContent("אסיפת הורים");
    expect(board).toHaveTextContent("גן רימון");
    // Privacy footnote present (the forward-only red line).
    expect(screen.getByTestId("privacy-footnote")).toBeInTheDocument();
  });
});
