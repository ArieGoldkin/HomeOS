import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";

describe("Field", () => {
  it("renders a label associated to the input via id/htmlFor", () => {
    render(<Field id="title" label="כותרת" />);
    // getByLabelText proves the association is correct
    expect(screen.getByLabelText("כותרת")).toBeInTheDocument();
  });

  it("input has the correct id attribute", () => {
    render(<Field id="title" label="כותרת" />);
    expect(screen.getByLabelText("כותרת")).toHaveAttribute("id", "title");
  });

  it("numeric=true sets dir=ltr on the input so digits are not reversed", () => {
    render(<Field id="time" label="שעה" numeric />);
    expect(screen.getByLabelText("שעה")).toHaveAttribute("dir", "ltr");
  });

  it("numeric=false (default) does not set dir on the input", () => {
    render(<Field id="name" label="שם" />);
    const input = screen.getByLabelText("שם");
    expect(input).not.toHaveAttribute("dir");
  });

  it("numeric=true adds tabular-nums class to the input", () => {
    render(<Field id="date" label="תאריך" numeric />);
    expect(screen.getByLabelText("תאריך").className).toMatch(/tabular-nums/);
  });

  it("with error: input has aria-invalid=true", () => {
    render(<Field id="email" label="אימייל" error="שדה חובה" />);
    expect(screen.getByLabelText("אימייל")).toHaveAttribute("aria-invalid", "true");
  });

  it("with error: input has aria-describedby pointing to the error paragraph", () => {
    render(<Field id="email" label="אימייל" error="שדה חובה" />);
    expect(screen.getByLabelText("אימייל")).toHaveAttribute("aria-describedby", "email-error");
  });

  it("with error: renders the error text in a role=alert element", () => {
    render(<Field id="email" label="אימייל" error="שדה חובה" />);
    expect(screen.getByRole("alert")).toHaveTextContent("שדה חובה");
  });

  it("without error: no aria-invalid and no alert element", () => {
    render(<Field id="name" label="שם" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("שם")).not.toHaveAttribute("aria-invalid");
  });

  it("passes through standard input props (placeholder, value, etc.)", async () => {
    const user = userEvent.setup();
    render(<Field id="search" label="חיפוש" placeholder="הקלד כאן..." />);
    const input = screen.getByLabelText("חיפוש");
    expect(input).toHaveAttribute("placeholder", "הקלד כאן...");
    await user.type(input, "שלום");
    expect(input).toHaveValue("שלום");
  });
});
