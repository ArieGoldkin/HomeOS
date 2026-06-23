import { Button, Card } from "@shared/ui";
import { useState } from "react";
import { ArtGlyph } from "./components/ArtGlyph";
import { MemberInviteRow } from "./components/MemberInviteRow";
import { QRConnectBlock } from "./components/QRConnectBlock";
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

const ROSTER = [
  { name: "אבא", role: "הורה" },
  { name: "אמא", role: "הורה" },
  { name: "יואב", role: "ילד" },
  { name: "נועה", role: "ילדה" },
];

export interface OnboardingProps {
  /** Called when the user finishes the last step (the final CTA) or dismisses via the close X. */
  onDone?: () => void;
}

/**
 * First-run onboarding (#185) — a 4-step flow (welcome → connect WhatsApp → invite family → done) in the
 * paper modal-card chrome: an art-panel header + StepDots + a sans title + step content + a primary CTA /
 * Back, with a close X that dismisses to the board. A standalone no-shell route (/welcome); `onDone` is
 * wired by the route to enter the board (→ /today). Internal step atoms live in components/.
 */
export function Onboarding({ onDone }: OnboardingProps) {
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

          {step === 1 && <QRConnectBlock phone="+972 53-800-1200" />}
          {step === 2 && (
            <div className="flex w-full flex-col gap-2">
              {ROSTER.map((m) => (
                <MemberInviteRow key={m.name} name={m.name} role={m.role} />
              ))}
            </div>
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
