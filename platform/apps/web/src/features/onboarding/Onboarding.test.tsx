import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("navigates forward through all 4 steps and calls onDone at the end", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    expect(screen.getByText("ברוכים הבאים ל-HomeOS")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "בואו נתחיל" }));
    expect(screen.getByText("חברו את הוואטסאפ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "המשך" }));
    expect(screen.getByText("הזמינו את המשפחה")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "המשך" }));
    expect(screen.getByText("הכול מוכן")).toBeInTheDocument();

    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "לפתיחת הלוח" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("goes back to the previous step", async () => {
    const user = userEvent.setup();
    render(<Onboarding />);

    await user.click(screen.getByRole("button", { name: "בואו נתחיל" }));
    expect(screen.getByText("חברו את הוואטסאפ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "חזרה" }));
    expect(screen.getByText("ברוכים הבאים ל-HomeOS")).toBeInTheDocument();
  });

  it("dismisses to the board (onDone) when the close X is clicked", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  // Gap #3 de-fang: the WhatsApp-connect step routes to the real Connections screen instead of a fake
  // QR + hardcoded bot number.
  it("step 1 routes to the real connections screen, with no fake QR/bot number", async () => {
    const onGoToConnections = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onGoToConnections={onGoToConnections} />);

    await user.click(screen.getByRole("button", { name: "בואו נתחיל" }));
    expect(screen.getByText("חברו את הוואטסאפ")).toBeInTheDocument();
    // The old hardcoded bot number (+972 53-800-1200) must be gone.
    expect(screen.queryByText(/53-800-1200/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /לחיבור הוואטסאפ/ }));
    expect(onGoToConnections).toHaveBeenCalledOnce();
  });

  // Gap #3 de-fang: the invite step routes to the real Connections screen instead of a fake roster with
  // inert invite buttons.
  it("step 2 routes to connections, with no fake roster / inert invite buttons", async () => {
    const onGoToConnections = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onGoToConnections={onGoToConnections} />);

    await user.click(screen.getByRole("button", { name: "בואו נתחיל" }));
    await user.click(screen.getByRole("button", { name: "המשך" }));
    expect(screen.getByText("הזמינו את המשפחה")).toBeInTheDocument();
    // The fake per-member inert "הזמנה" buttons must be gone.
    expect(screen.queryByRole("button", { name: "הזמנה" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /להזמנת המשפחה/ }));
    expect(onGoToConnections).toHaveBeenCalledOnce();
  });
});
