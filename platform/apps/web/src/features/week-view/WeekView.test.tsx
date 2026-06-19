import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { WeekView } from "./WeekView";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

// 2026-06-21 is a Sunday in Jerusalem (UTC+3 in summer → 09:00 UTC = 12:00 Jerusalem).
// The sample MSW event id=1 is on 2026-06-21. Week is Sun 21 … Sat 27 June 2026.
describe("WeekView (data-connected, fixed clock)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    server.resetHandlers();
  });

  it("renders 7 day rows", async () => {
    render(wrap(<WeekView dateIso="2026-06-21" onSelectDate={vi.fn()} />));
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(7);
    });
  });

  it("the day 2026-06-21 shows a pip for the sample event", async () => {
    render(wrap(<WeekView dateIso="2026-06-21" onSelectDate={vi.fn()} />));

    // Wait for data to resolve (MSW delivers sample event on 2026-06-21)
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(7);
    });

    // The first button is Sunday 21 June (ראשון). It should have a pip (event id=1).
    // Pips are aria-hidden rounded-full spans inside that button.
    const [sundayButton] = screen.getAllByRole("button");
    if (!sundayButton) throw new Error("expected 7 day rows");
    const pip = sundayButton.querySelector("span[aria-hidden='true'][class*='rounded-full']");
    expect(pip).toBeInTheDocument();
  });

  it("clicking a day row calls onSelectDate with that ISO date", async () => {
    const onSelectDate = vi.fn();
    render(wrap(<WeekView dateIso="2026-06-21" onSelectDate={onSelectDate} />));

    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(7);
    });

    // Click the second button (Monday = שני, 2026-06-22)
    const mondayButton = screen.getAllByRole("button")[1];
    if (!mondayButton) throw new Error("expected 7 day rows");
    await userEvent.click(mondayButton);
    expect(onSelectDate).toHaveBeenCalledOnce();
    expect(onSelectDate).toHaveBeenCalledWith("2026-06-22");
  });
});
