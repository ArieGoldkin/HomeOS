import type { SavedEvent } from "@homeos/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventDetail } from "./EventDetail";

const make = (over: Partial<SavedEvent> = {}): SavedEvent => ({
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: "אבא",
  recurrence: null,
  source_text: "אסיפת הורים מחר ב-18:30 בגן רימון",
  id: 7,
  source_provider: null,
  source: "whatsapp",
  created_at: "2026-06-20T06:00:00Z", // 09:00 Asia/Jerusalem (IDT, +3)
  ...over,
});

describe("EventDetail (#153)", () => {
  it("shows the original forwarded text", () => {
    render(<EventDetail event={make()} />);
    expect(screen.getByText("אסיפת הורים מחר ב-18:30 בגן רימון")).toBeInTheDocument();
  });

  it("shows a human source label per source", () => {
    const { rerender } = render(<EventDetail event={make({ source: "whatsapp" })} />);
    expect(screen.getByText("וואטסאפ")).toBeInTheDocument();
    rerender(<EventDetail event={make({ source: "gmail" })} />);
    expect(screen.getByText("Gmail")).toBeInTheDocument();
    rerender(<EventDetail event={make({ source: "web" })} />);
    expect(screen.getByText("הוספה ידנית")).toBeInTheDocument();
    // gcal is the only multi-node label ("יומן " + <bdi>Google</bdi>) — assert both fragments (F4).
    rerender(<EventDetail event={make({ source: "gcal" })} />);
    expect(screen.getByText(/יומן/)).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
  });

  it("formats created_at as the Asia/Jerusalem wall-clock", () => {
    render(<EventDetail event={make({ created_at: "2026-06-20T06:00:00Z" })} />);
    // 06:00 UTC → 9:00 IDT (+3); he-IL renders "20 ביוני 2026 בשעה 9:00" in one node.
    expect(screen.getByText(/9:00/)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("degrades gracefully when source_text is empty (web/manual add)", () => {
    render(<EventDetail event={make({ source_text: "", source: "web" })} />);
    expect(screen.getByText("אין טקסט מקורי")).toBeInTheDocument();
  });

  it("treats a whitespace-only source_text as empty (F6)", () => {
    render(<EventDetail event={make({ source_text: "   \n\t" })} />);
    expect(screen.getByText("אין טקסט מקורי")).toBeInTheDocument();
  });

  it("omits the created line when created_at is absent", () => {
    render(<EventDetail event={make({ created_at: undefined })} />);
    expect(screen.queryByText("נוצר:")).toBeNull();
  });
});
