import { z } from "zod/v4";
import type { Tool } from "./context.ts";

/**
 * #147 — the agentic resolve tool: on a deterministic 0-match for a cancel/edit reference, a BOUNDED
 * resolve-agent run (forced to THIS tool on turn 0 — never `extract_events`, so a cancel can't create a
 * junk event, AC#3) hands the model the request text and the model emits the key reference TERMS. The tool
 * does the broad board search (`searchEvents` over title+location+assignee) and returns the candidates via
 * the `resolved` arm — read-only, NEVER deletes/edits (the handler confirms + executes). The date/time
 * anchor is SERVER-supplied (`ctx.resolveRef`), never model-supplied (G8). The candidates ride the agent's
 * side-channel to the handler and are NEVER echoed back into the model loop (G7).
 */
export function searchEventsTool(): Tool<{ titleHint: string }> {
  return {
    name: "search_events",
    description:
      "Find existing family calendar items matching a cancel or edit reference. Pass the key reference terms only — the event's title words, the person's name, and/or the place — dropping the command verb (בטל/שנה…) and any filler. Returns the matching board items.",
    inputSchema: z.object({ titleHint: z.string().min(1).max(200) }),
    async run({ titleHint }, ctx) {
      const found = ctx.events.searchEvents(ctx.familyId, {
        titleHint,
        ...(ctx.resolveRef?.dateIso ? { dateIso: ctx.resolveRef.dateIso } : {}),
        ...(ctx.resolveRef?.time ? { time: ctx.resolveRef.time } : {}),
      });
      return { resolved: found };
    },
  };
}
