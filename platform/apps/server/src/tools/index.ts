// Public surface of the tool registry (split out of the former 528-LOC tools.ts; see
// docs/refactor/server-decomposition-plan.md, P1). Tool modules import the leaf `context.ts` (the G8
// ToolContext + Tool/ToolResult contracts) directly, never through this barrel, so it stays a pure
// re-export and can't form a cycle. `limits.ts` (the cross-module MAX_TOOL_TEXT) is deliberately NOT
// re-exported here — it stays internal to the folder, exactly as the old `const MAX_TOOL_TEXT` was.
//   - context.ts       — ToolContext (G8 server-supplied context) + Tool/ToolResult/ClarifyResult + the provider dep types
//   - extract.ts       — extract_events (the forward parser tool)
//   - search.ts        — search_events (the #147 cancel/edit resolve tool)
//   - gmail.ts         — read_gmail + buildGmailQuery (#72)
//   - calendar-read.ts — read_calendar + mapCalendarEvent (#18 chunk 1)
//   - calendar-push.ts — pushSavedEventsToCalendar + deleteFromCalendar + mapToCalendarWrite (#18 chunk 2 / #85)
export * from "./calendar-push.ts";
export * from "./calendar-read.ts";
export * from "./context.ts";
export * from "./extract.ts";
export * from "./gmail.ts";
export * from "./search.ts";
