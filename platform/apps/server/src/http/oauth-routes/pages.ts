import { CONNECT_OUTCOMES, type ConnectOutcome } from "@homeos/shared";
import type { Context } from "hono";
import type { GoogleOAuthDeps } from "./deps.ts";

// #10 — the page table is keyed off the SHARED {@link ConnectOutcome} (so the static fallback and the
// web `?status=` banner can only ever render the same allowlisted slug). The `Record<ConnectOutcome, …>`
// makes PAGES exhaustive by type; this runtime assert keeps the imported tuple load-bearing and fails
// loudly at module load if a new outcome slug is added to the shared enum without a page here.
const PAGES: Record<
  ConnectOutcome,
  { status: 200 | 400 | 403 | 502; title: string; body: string }
> = {
  connected: { status: 200, title: "מחובר ✅", body: "חשבון Google חובר בהצלחה." },
  cancelled: { status: 200, title: "בוטל", body: "החיבור בוטל. אפשר לנסות שוב בכל עת." },
  no_refresh: {
    status: 400,
    title: "צריך לאשר מחדש",
    body: "לא התקבל אישור קבוע. התחברו שוב ואשרו את כל ההרשאות המבוקשות.",
  },
  bad_scope: {
    status: 400,
    title: "הרשאות חסרות",
    body: "לא כל ההרשאות אושרו. התחברו שוב ואשרו את הגישה ל-Gmail וליומן.",
  },
  bad_state: {
    status: 403,
    title: "בקשה לא תקפה",
    body: "הבקשה פגה או אינה תקפה. התחילו את החיבור מחדש.",
  },
  bad_account: {
    status: 403,
    title: "חשבון לא תואם",
    body: "החשבון שאושר אינו החשבון המוגדר למשפחה. התחברו עם החשבון הנכון, או נתקו תחילה.",
  },
  error: {
    status: 502,
    title: "שגיאה",
    body: "אירעה שגיאה בחיבור ל-Google. נסו שוב מאוחר יותר.",
  },
};

// Fail loudly at module load if the shared enum gains an outcome with no page (defence-in-depth on top
// of the `Record<ConnectOutcome, …>` type — keeps the imported tuple load-bearing).
for (const outcome of CONNECT_OUTCOMES) {
  if (!PAGES[outcome]) throw new Error(`oauth-routes: missing page for outcome "${outcome}"`);
}

/** Static Hebrew RTL page from the allowlisted enum (no query interpolation) + strict CSP (OG16). */
function page(c: Context, outcome: ConnectOutcome): Response {
  const p = PAGES[outcome];
  const html =
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">` +
    `<title>${p.title}</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem">` +
    `<h1>${p.title}</h1><p>${p.body}</p></body></html>`;
  c.header("Content-Security-Policy", "default-src 'none'");
  return c.html(html, p.status);
}

/**
 * #109 — the terminal step of the callback (and the new routes' page-rendering paths). When the
 * self-serve return URL is configured, bounce the browser back to the web app with ONLY the
 * server-constructed `?status=<outcome>` slug (an allowlisted {@link ConnectOutcome}) — NEVER forward
 * `code`/`state`/`error` from the inbound query (open-redirect-safe, OG21-OR) — and set
 * `Referrer-Policy: no-referrer` so the slug-bearing URL can't leak via the Referer header. In
 * admin-only mode (no return URL) fall back to the static Hebrew page (the ships-dark / curl path).
 */
export function finish(c: Context, deps: GoogleOAuthDeps, outcome: ConnectOutcome): Response {
  if (deps.webReturnUrl) {
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(`${deps.webReturnUrl}?status=${outcome}`, 302);
  }
  return page(c, outcome);
}
