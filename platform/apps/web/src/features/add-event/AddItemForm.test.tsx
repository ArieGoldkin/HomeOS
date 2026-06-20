import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddItemForm } from "./AddItemForm";

describe("AddItemForm", () => {
  it("rejects an invalid date_iso and does not emit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AddItemForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("כותרת"), "ארוחת ערב");
    // Force a malformed date (no real calendar day) — the schema must reject it.
    fireEvent.change(screen.getByLabelText("תאריך"), { target: { value: "2026-13-45" } });
    await user.click(screen.getByRole("button", { name: "הוספה" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a blank/whitespace title, does not emit, and shows a title error", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AddItemForm onSubmit={onSubmit} />);

    // Leave the title empty (date defaults to today, which is valid) — the most likely real user error.
    await user.click(screen.getByRole("button", { name: "הוספה" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("כותרת")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("emits a schema-valid ParsedEvent with synthesized source_text on a valid submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AddItemForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("כותרת"), "ארוחת ערב");
    // date_iso defaults to today (valid); leave it.
    await user.click(screen.getByRole("button", { name: "הוספה" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const event = onSubmit.mock.calls[0]?.[0];
    expect(event.kind).toBe("event");
    expect(event.title_he).toBe("ארוחת ערב");
    expect(event.source_text).toBe("ארוחת ערב"); // synthesized from the title
    expect(event.time).toBeNull();
    expect(event.location).toBeNull();
    expect(event.assignee).toBeNull();
  });

  it("reuses PersonChip as the assignee selector", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AddItemForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("כותרת"), "חוג");
    const chip = screen.getByRole("button", { name: /אמא/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "הוספה" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0].assignee).toBe("אמא");
  });

  it("disables the submit button while submitting (double-submit guard)", () => {
    render(<AddItemForm submitting onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: "הוספה" })).toBeDisabled();
  });

  it("enables the submit button when not submitting", () => {
    render(<AddItemForm onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: "הוספה" })).toBeEnabled();
  });
});
