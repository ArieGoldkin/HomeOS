/**
 * #147/#164 — FAIL-CLOSED affirmative for the confirm-before-destroy gate. An ANCHORED affirmative at the
 * START of the reply executes the destroy; anything not clearly affirmative ABORTs with no write (G20).
 * #164 broadened the set from bare `כן` to the forms real users actually type (`בטח`/`בטוח`/`אישור`/
 * `אוקיי`) + the high-confidence `קן`→`כן` typo. `(?!\p{L})` keeps each a whole word ("כן"/"כן בבקשה" pass,
 * a longer word merely starting with those letters does not). Anchored at start is load-bearing: a rambly
 * reply that merely CONTAINS "בטוח" must not confirm. `סבבה` is deliberately OUT — each token in a
 * destructive-yes set is a risk, so the set stays tight to what dogfooding observed.
 */
export const AFFIRM_RE = /^(?:כן|קן|בטח|בטוח|אישור|אוקיי?|אוקי)(?!\p{L})/u;
/**
 * #164 — the UNCERTAINTY / NEGATION guard. Even an affirmative-looking reply ABORTs when it carries a
 * negation or hedge anywhere — `לא בטוח` ("not sure"), `אולי` ("maybe"), the verbatim dogfood `אוי לא
 * בטוף אני רוצה לבטל`, and the affirmative-at-start-but-negated `בטוח שלא רוצה` (caught via `שלא`).
 * Word-boundaried so it never trips on a letter-substring. The destructive default stays NO: when in
 * doubt, don't.
 */
export const NEGATION_RE = /(?<!\p{L})(?:לא|אל|אולי|שלא)(?!\p{L})/u;
/**
 * #164 — the fail-closed confirm predicate used by every confirm-before-destroy gate (cancel single +
 * bulk, edit). Affirmative AND not negated/hedged. Exported so the truth table is unit-tested directly.
 */
export function isAffirmative(reply: string): boolean {
  return AFFIRM_RE.test(reply) && !NEGATION_RE.test(reply);
}
