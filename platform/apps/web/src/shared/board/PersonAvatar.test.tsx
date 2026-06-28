import { assigneeColor } from "@shared/lib";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PersonAvatar } from "./PersonAvatar";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

const styleOf = (el: ChildNode | null) =>
  (el instanceof Element ? (el.getAttribute("style") ?? "") : "").toLowerCase();
const rgb = (h: string) => {
  const n = Number.parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe("PersonAvatar", () => {
  it("shows the first letter of the name", () => {
    render(<PersonAvatar name="נועה" />);
    expect(screen.getByText("נ")).toBeInTheDocument();
  });

  it("fills with the assignee color (light) by default", () => {
    const { container } = render(<PersonAvatar name="אבא" />);
    expect(styleOf(container.firstChild)).toContain(rgb(assigneeColor("אבא").light));
  });

  it("uses the night color set under data-theme=dark", () => {
    document.documentElement.dataset.theme = "dark";
    const { container } = render(<PersonAvatar name="אבא" />);
    expect(styleOf(container.firstChild)).toContain(rgb(assigneeColor("אבא").night));
  });

  it("sizes via the size prop", () => {
    const { container } = render(<PersonAvatar name="x" size={32} />);
    const s = styleOf(container.firstChild);
    expect(s).toMatch(/width:\s*32px/);
    expect(s).toMatch(/height:\s*32px/);
  });

  // Always paired with a visible name in our layouts → decorative, so it isn't announced twice.
  it("is decorative by default (aria-hidden)", () => {
    const { container } = render(<PersonAvatar name="אבא" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to ? for an empty name", () => {
    render(<PersonAvatar name="  " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("merges a caller className", () => {
    const { container } = render(<PersonAvatar name="x" className="ring-2" />);
    expect((container.firstChild as HTMLElement).className).toContain("ring-2");
  });

  // #230 — when given a photo URL (the Google avatar), render the image instead of the initial.
  it("renders the image when imageUrl is set (alt = name), not the initial", () => {
    render(<PersonAvatar name="נועה" imageUrl="https://example.com/a.png" />);
    const img = screen.getByRole("img", { hidden: true });
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
    expect(img).toHaveAttribute("alt", "נועה");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer"); // Google avatars 403 on referrer
    expect(screen.queryByText("נ")).not.toBeInTheDocument();
  });

  // #230 fold — a failed avatar load (403/404) reverts to the initial rather than a broken-image glyph.
  it("falls back to the initial when the image fails to load", () => {
    render(<PersonAvatar name="נועה" imageUrl="https://example.com/dead.png" />);
    fireEvent.error(screen.getByRole("img", { hidden: true }));
    expect(screen.getByText("נ")).toBeInTheDocument();
  });

  it("falls back to the initial when imageUrl is null", () => {
    render(<PersonAvatar name="נועה" imageUrl={null} />);
    expect(screen.getByText("נ")).toBeInTheDocument();
  });
});
