/**
 * Defense-in-depth cap on the model-echoed text (the authoritative cap is the handler's pre-model
 * input cap, G2). Generous vs the handler's MAX_INPUT so a legitimate forward isn't double-rejected.
 * Shared by the extract + gmail tools; kept in its own module (NOT re-exported by the barrel) so it
 * stays internal to the tools/ folder, exactly as it was before the split.
 */
export const MAX_TOOL_TEXT = 8000;
