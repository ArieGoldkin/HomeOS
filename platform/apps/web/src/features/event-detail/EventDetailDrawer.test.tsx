import type { SavedEvent } from "@homeos/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventDetailDrawer } from "./EventDetailDrawer";

const event: SavedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: "אבא",
  recurrence: null,
  source_text: "ORIGINAL_FORWARDED_TEXT",
  id: 7,
  source_provider: null,
  source: "whatsapp",
  created_at: "2026-06-20T06:00:00Z",
};

describe("EventDetailDrawer (one responsive host, no surface prop)", () => {
  it("renders nothing open when event is null", () => {
    render(<EventDetailDrawer event={null} onClose={() => {}} />);
    expect(screen.queryByText("ORIGINAL_FORWARDED_TEXT")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the EventDetail body (original forwarded text) when an event is provided", () => {
    render(<EventDetailDrawer event={event} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("ORIGINAL_FORWARDED_TEXT")).toBeInTheDocument();
  });

  it("calls onClose when the close button is activated", () => {
    const onClose = vi.fn();
    render(<EventDetailDrawer event={event} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onClose).toHaveBeenCalled();
  });
});
