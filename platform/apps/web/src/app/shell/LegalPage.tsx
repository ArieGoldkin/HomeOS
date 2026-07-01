import { CURRENT_TERMS_VERSION } from "@homeos/shared";

export interface LegalPageProps {
  /** Which legal doc — drives the heading + the placeholder body. */
  kind: "terms" | "privacy";
}

const COPY = {
  terms: {
    title: "תנאי שימוש",
    intro: "השימוש ב-HomeOS כפוף לתנאים הבאים.",
  },
  privacy: {
    title: "מדיניות פרטיות",
    intro: "כך אנו אוספים, שומרים ומשתמשים במידע שלכם.",
  },
} as const;

/**
 * #270 — a standalone Terms / Privacy page (no shell chrome), linked from the consent screen. The body is a
 * PLACEHOLDER: the real legal text must be supplied by the product owner (a lawyer) — this ships the
 * mechanism + a versioned shell, not binding legal content. `kind` selects the doc; the version stamp ties
 * the page to the consent record so an audit can tell which text a user accepted.
 */
export function LegalPage({ kind }: LegalPageProps) {
  const copy = COPY[kind];
  return (
    <div className="paper-grain min-h-dvh px-6 py-10">
      <div className="mx-auto max-w-[680px]">
        {/* No in-page back link: this page is opened in a NEW TAB from the consent screen (target=_blank),
            so "back" has no sensible target — the user closes the tab. Direct visitors use the browser back. */}
        <h1 className="font-display font-extrabold text-[30px] text-[color:var(--ink)] leading-tight">
          {copy.title}
        </h1>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
          גרסה {CURRENT_TERMS_VERSION}
        </p>
        <p className="mt-5 text-[15px] text-[color:var(--ink-2)]">{copy.intro}</p>

        {/* PLACEHOLDER — replace with the real, lawyer-approved Hebrew text before go-live. */}
        <div
          data-testid="legal-placeholder"
          className="mt-4 rounded-[var(--radius)] border border-[var(--line)] border-dashed bg-card/40 p-5 text-[14px] text-muted-foreground leading-relaxed"
        >
          <p className="font-semibold text-[color:var(--ink-2)]">[טקסט זמני — למילוי]</p>
          <p className="mt-2">
            כאן ייכנס הנוסח המשפטי המלא של {copy.title} (לאישור עורך/ת דין). המסמך מתוארך ומקושר
            לרשומת ההסכמה, כך שניתן לדעת לאיזו גרסה המשתמש/ת הסכימ/ה.
          </p>
        </div>
      </div>
    </div>
  );
}
