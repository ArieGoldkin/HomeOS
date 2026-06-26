import { describe, expect, it } from "vitest";
import { hintLikeGroups, likeArg } from "../../../src/db/event-store/hint-match.ts";

// The FROZEN cancel/edit title tokenizer (#125/G22): findEventsByRef (the deterministic DESTRUCTIVE path)
// builds its LIKE clause from these, so the escaping + variant rules are security-relevant. Before the
// #229-era split these were covered only transitively through event-store.test.ts; now that hint-match.ts
// is its own module, lock the behavior directly so a regression breaks HERE, not a downstream cancel.
describe("hint-match — the frozen cancel/edit LIKE tokenizer (#125/G22)", () => {
  describe("likeArg — LIKE-metachar escaping (#125/F3)", () => {
    it("wraps the term in % … % for a substring match", () => {
      expect(likeArg("פגישה")).toBe("%פגישה%");
    });
    it("escapes %, _ and backslash so a literal metachar can't widen a destructive match", () => {
      expect(likeArg("50%")).toBe("%50\\%%");
      expect(likeArg("a_b")).toBe("%a\\_b%");
      expect(likeArg("c\\d")).toBe("%c\\\\d%");
    });
  });

  describe("hintLikeGroups — per-word AND-of-OR variants", () => {
    it("ORs the original word with its ה/ו-stripped variant (the live definite-article cancel miss)", () => {
      // "הפגישה" must also match a bare stored title "פגישה".
      expect(hintLikeGroups("הפגישה")).toEqual([["%הפגישה%", "%פגישה%"]]);
    });
    it("keeps the original form so a word that legitimately starts with ה still matches", () => {
      expect(hintLikeGroups("הורים")).toEqual([["%הורים%", "%ורים%"]]);
    });
    it("emits one AND'd group per content word, dropping stopwords", () => {
      // עם is a stopword → dropped; the two content words each become their own group.
      expect(hintLikeGroups("פגישה עם רות")).toEqual([["%פגישה%"], ["%רות%"]]);
    });
    it("returns [] when nothing usable remains (caller falls back to the raw hint — never 'match everything')", () => {
      expect(hintLikeGroups("עם את")).toEqual([]); // all stopwords
      expect(hintLikeGroups("א ב")).toEqual([]); // all sub-2-char tokens
    });
    it("omits the stripped variant when stripping would leave < 2 chars", () => {
      // "הא" → strip ה → "א" (1 char) → only the original variant survives.
      expect(hintLikeGroups("הא")).toEqual([["%הא%"]]);
    });
  });
});
