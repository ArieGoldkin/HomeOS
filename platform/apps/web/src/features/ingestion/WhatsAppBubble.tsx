import { usePrefersReducedMotion } from "@shared/hooks";
import type { ReactNode } from "react";

/**
 * LITERAL WhatsApp brand colors — intentionally NOT design tokens, so the bubbles render in WhatsApp's
 * own palette regardless of the app's light/dark theme (#98 AC: "literal WA colors, not tokens, so they
 * don't break in light mode"). Do not replace these with `var(--…)`.
 */
const WA = {
  user: "#056452",
  botFrom: "#10231b",
  botTo: "#0f1d18",
  text: "#eafff4",
} as const;

export interface WhatsAppBubbleProps {
  variant: "user" | "bot";
  children: ReactNode;
  /** Animation delay in ms — the bot bubble pops +150ms after the user's (prototype: .15s). */
  delayMs?: number;
}

/**
 * One WhatsApp chat bubble (user = trailing green, bot = leading dark gradient) for the educational
 * ingestion demo. Pops in via the `pop` keyframe unless the user prefers reduced motion (then no
 * animation — the AC). Colors are literal WA hex, never tokens.
 */
export function WhatsAppBubble({ variant, children, delayMs = 0 }: WhatsAppBubbleProps) {
  const reduced = usePrefersReducedMotion();
  const isUser = variant === "user";

  return (
    <div
      data-variant={variant}
      className="rounded-[11px] px-3 py-2 text-[13.5px] leading-relaxed"
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: isUser ? "82%" : "84%",
        background: isUser ? WA.user : `linear-gradient(180deg, ${WA.botFrom}, ${WA.botTo})`,
        color: WA.text,
        animation: reduced ? undefined : `pop 0.35s ${delayMs}ms both`,
      }}
    >
      {children}
    </div>
  );
}
