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
});
