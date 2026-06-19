import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabletShell } from "./TabletShell";

const noonUTC = new Date("2026-06-20T12:00:00Z"); // 15:00 Jerusalem (afternoon)

describe("TabletShell", () => {
  it("shows the Jerusalem clock dir=ltr + tabular-nums", () => {
    render(
      <TabletShell now={noonUTC}>
        <div />
      </TabletShell>,
    );
    const clock = screen.getByText("15:00");
    expect(clock).toHaveAttribute("dir", "ltr");
    expect(clock.className).toMatch(/tabular-nums/);
  });

  it("greets by time of day (afternoon)", () => {
    render(
      <TabletShell now={noonUTC}>
        <div />
      </TabletShell>,
    );
    expect(screen.getByText("צהריים טובים")).toBeInTheDocument();
  });

  it("runs the night theme (always-on tablet)", () => {
    const { container } = render(
      <TabletShell now={noonUTC}>
        <div />
      </TabletShell>,
    );
    expect(container.firstChild).toHaveAttribute("data-theme", "night");
  });

  it("renders its children (the board)", () => {
    render(
      <TabletShell now={noonUTC}>
        <p>לוח</p>
      </TabletShell>,
    );
    expect(screen.getByText("לוח")).toBeInTheDocument();
  });

  it("shows the footer only when weather/shabbat are provided", () => {
    const { rerender } = render(
      <TabletShell now={noonUTC}>
        <div />
      </TabletShell>,
    );
    expect(screen.queryByText(/שבת שלום/)).toBeNull();

    rerender(
      <TabletShell now={noonUTC} weather="☀ 29°" shabbat="כניסת שבת 19:34 · שבת שלום">
        <div />
      </TabletShell>,
    );
    expect(screen.getByText(/שבת שלום/)).toBeInTheDocument();
    expect(screen.getByText("☀ 29°")).toBeInTheDocument();
  });
});
