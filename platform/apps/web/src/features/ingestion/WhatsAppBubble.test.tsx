import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsAppBubble } from "./WhatsAppBubble";

/** Mock matchMedia to a fixed reduced-motion answer (jsdom has no matchMedia). */
function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("WhatsAppBubble", () => {
  it("uses LITERAL WA colors, never design tokens", () => {
    render(
      <>
        <WhatsAppBubble variant="user">forwarded</WhatsAppBubble>
        <WhatsAppBubble variant="bot">confirmed</WhatsAppBubble>
      </>,
    );
    const user = screen.getByText("forwarded");
    const bot = screen.getByText("confirmed");
    // Not a token (the AC: survives light mode) — and the bot is a literal gradient.
    expect(user.style.background).not.toContain("var(");
    expect(user.style.background).toBeTruthy();
    expect(bot.style.background).toContain("gradient");
    expect(bot.style.background).not.toContain("var(");
  });

  it("pops in by default (motion allowed)", () => {
    render(
      <WhatsAppBubble variant="bot" delayMs={150}>
        hi
      </WhatsAppBubble>,
    );
    expect(screen.getByText("hi").style.animation).toContain("pop");
  });

  it("disables the pop animation under prefers-reduced-motion", () => {
    mockReducedMotion(true);
    render(
      <WhatsAppBubble variant="bot" delayMs={150}>
        hi
      </WhatsAppBubble>,
    );
    expect(screen.getByText("hi").style.animation).toBe("");
  });
});
