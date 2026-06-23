import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarScreen } from "./CalendarScreen";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

const noop = () => {};

describe("CalendarScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("renders the month + accent year header", () => {
    render(wrap(<CalendarScreen dateIso="2026-06-21" onSelectDate={noop} onChangeWeek={noop} />));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("יוני");
    expect(h1).toHaveTextContent("2026");
  });

  it("renders the data-connected week (an event) and the New event button", async () => {
    render(wrap(<CalendarScreen dateIso="2026-06-21" onSelectDate={noop} onChangeWeek={noop} />));
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "+ אירוע חדש" })).toBeInTheDocument();
  });

  it("re-anchors to the next week from the nav (2026-06-21 → 2026-06-28)", () => {
    const onChangeWeek = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CalendarScreen dateIso="2026-06-21" onSelectDate={noop} onChangeWeek={onChangeWeek} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "שבוע הבא" }));
    expect(onChangeWeek).toHaveBeenCalledWith("2026-06-28");
  });

  it("opens the add-event modal from New event", async () => {
    render(wrap(<CalendarScreen dateIso="2026-06-21" onSelectDate={noop} onChangeWeek={noop} />));
    fireEvent.click(screen.getByRole("button", { name: "+ אירוע חדש" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });
});
