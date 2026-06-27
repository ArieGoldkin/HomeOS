import { sanitizeUserText } from "@homeos/shared";
import type { EventPatch } from "../../../db/event-store/index.ts";
import { extractCancelRef } from "../cancel/index.ts";
import { EDIT_DAY_RE, EDIT_LOCATION_RE, EDIT_TIME_RE } from "../shared/index.ts";

/**
 * #86 — extract an explicit-edit REFERENCE + a field DELTA from a fixed vocabulary (server-side, NO
 * model call). Returns null when no recognized delta is present, so "שנה X" without a `ל-<field>` is a
 * miss (not a no-op write). "ל-DD" resolves to that day of TODAY's month (cross-month is a #87 item).
 */
export function extractEditDelta(
  text: string,
  todayIso: string,
): { ref: { dateIso?: string; time?: string; titleHint?: string }; patch: EventPatch } | null {
  let rest = text.replace(/^(שנה|ערוך|תקן|עדכן)\s+/u, "");
  const patch: EventPatch = {};
  const loc = EDIT_LOCATION_RE.exec(rest);
  if (loc?.[1]) {
    patch.location = sanitizeUserText(loc[1].trim());
    rest = rest.replace(EDIT_LOCATION_RE, " ");
  }
  const tm = EDIT_TIME_RE.exec(rest);
  if (tm?.[1] && tm[2]) {
    patch.time = `${String(Number(tm[1])).padStart(2, "0")}:${tm[2]}`;
    rest = rest.replace(EDIT_TIME_RE, " ");
  }
  const dy = EDIT_DAY_RE.exec(rest);
  if (dy?.[1]) {
    patch.date_iso = `${todayIso.slice(0, 8)}${String(Number(dy[1])).padStart(2, "0")}`;
    rest = rest.replace(EDIT_DAY_RE, " ");
  }
  if (Object.keys(patch).length === 0) return null;
  return { ref: extractCancelRef(rest, todayIso), patch };
}
