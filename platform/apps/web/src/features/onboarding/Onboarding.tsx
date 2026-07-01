import { Button, Card } from "@shared/ui";
import { useState } from "react";
import { ArtGlyph } from "./components/ArtGlyph";
import { StepDots } from "./components/StepDots";

interface OnboardStep {
  art: string;
  title: string;
  body: string;
  cta: string;
}

const STEPS: OnboardStep[] = [
  {
    art: "👋",
    title: "ברוכים הבאים ל-HomeOS",
    body: "הלוח המשפחתי שמתמלא לבד מהוואטסאפ.",
    cta: "בואו נתחיל",
  },
  {
    art: "💬",
    title: "חברו את הוואטסאפ",
    body: "מעבירים הודעה — היא הופכת לאירוע על הלוח.",
    cta: "המשך",
  },
  { art: "🧑‍🤝‍🧑", title: "הזמינו את המשפחה", body: "כל אחד רואה את מה שחשוב לו.", cta: "המשך" },
  { art: "✓", title: "הכול מוכן", body: "הלוח שלכם מחכה.", cta: "לפתיחת הלוח" },
];

export interface OnboardingProps {
  /** Called when the user finishes the last step (the final CTA) or dismisses via the close X. */
  onDone?: () => void;
  /**
   * Routes to the real Connections screen. The connect (step 1) and invite (step 2) steps link here
   * instead of showing fake widgets — the actual WhatsApp binding + family invites live on that page.
   */
  onGoToConnections?: () => void;
}

/**
 * First-run onboarding (#185) — a 4-step flow (welcome → connect WhatsApp → invite family → done) in the
 * paper modal-card chrome: an art-panel header + StepDots + a sans title + step content + a primary CTA /
 * Back, with a close X that dismisses to the board. A standalone no-shell route (/welcome); `onDone` is
 * wired by the route to enter the board (→ /today). Internal step atoms live in components/.
 */
export function Onboarding({ onDone, onGoToConnections }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;
  const current = STEPS[step] ?? STEPS[0]!;

  const next = () => (step >= last ? onDone?.() : setStep((s) => Math.min(s + 1, last)));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="paper-grain flex min-h-dvh items-center justify-center p-6">
      <Card
        className="relative w-full max-w-md overflow-hidden shadow-float"
        data-testid="onboarding"
      >
        <button
          type="button"
          onClick={() => onDone?.()}
          aria-label="סגירה"
          className="absolute end-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-card/70 text-ink-soft transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            ×
          </span>
        </button>

        {/* Art-panel header — a soft green band; the kept ArtGlyph tile sits centered. */}
        <div
          aria-hidden="true"
          className="flex h-[148px] items-center justify-center bg-primary/10"
        >
          <ArtGlyph glyph={current.art} />
        </div>

        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <StepDots total={STEPS.length} active={step} />
          <h2 className="font-sans font-bold text-[22px] text-[color:var(--ink)]">
            {current.title}
          </h2>
          <p className="text-[15px] text-muted-foreground">{current.body}</p>

          {(step === 1 || step === 2) && onGoToConnections && (
            <Button variant="ghost" onClick={onGoToConnections} className="w-full">
              {step === 1 ? "לחיבור הוואטסאפ →" : "להזמנת המשפחה →"}
            </Button>
          )}

          <div className="mt-2 flex w-full flex-col gap-2">
            <Button variant="primary" onClick={next} className="w-full">
              {current.cta}
            </Button>
            {step > 0 && (
              <Button variant="ghost" onClick={back}>
                חזרה
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
