import { Button } from "@shared/ui";
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
  /** Called when the user finishes the last step (the final CTA). */
  onDone?: () => void;
}

/**
 * First-run onboarding: a 4-step flow (welcome → connect WhatsApp → invite family → done) with forward
 * and back navigation and a StepDots progress indicator. Presentational; `onDone` is wired by the route
 * to enter the board. Internal step atoms live in components/.
 */
export function Onboarding({ onDone }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;
  const current = STEPS[step] ?? STEPS[0]!;

  const next = () => (step >= last ? onDone?.() : setStep((s) => Math.min(s + 1, last)));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center"
      data-testid="onboarding"
    >
      <ArtGlyph glyph={current.art} />
      <StepDots total={STEPS.length} active={step} />
      <h2 className="font-display font-bold text-[22px] text-foreground">{current.title}</h2>
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
  );
}
