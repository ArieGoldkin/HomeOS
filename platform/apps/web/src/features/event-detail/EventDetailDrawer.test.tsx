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

describe("EventDetailDrawer (#153)", () => {
  it("renders nothing open when event is null", () => {
    render(<EventDetailDrawer event={null} onClose={() => {}} surface="phone" />);
    expect(screen.queryByText("ORIGINAL_FORWARDED_TEXT")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the EventDetail body (original text) when an event is provided — phone Sheet", () => {
    render(<EventDetailDrawer event={event} onClose={() => {}} surface="phone" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("ORIGINAL_FORWARDED_TEXT")).toBeInTheDocument();
    // phone host = bottom sheet (anchored to the viewport bottom)
    expect(document.querySelector(".bottom-0")).not.toBeNull();
  });

  it("uses the centered Modal host on web", () => {
    render(<EventDetailDrawer event={event} onClose={() => {}} surface="web" />);
    expect(screen.getByText("ORIGINAL_FORWARDED_TEXT")).toBeInTheDocument();
    // web host = centered modal (vertically centered, not bottom-anchored)
    expect(document.querySelector(".top-1\\/2")).not.toBeNull();
    expect(document.querySelector(".bottom-0")).toBeNull();
  });

  it("calls onClose when the close button is activated", () => {
    const onClose = vi.fn();
    render(<EventDetailDrawer event={event} onClose={onClose} surface="phone" />);
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onClose).toHaveBeenCalled();
  });
});
