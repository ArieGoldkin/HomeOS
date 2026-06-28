import { supabase } from "./supabase-client";

/**
 * #230 — update the signed-in user's display name (Google-sourced `full_name`). Writes to the Supabase
 * user_metadata; on success Supabase fires a USER_UPDATED event that {@link AuthProvider} observes, so
 * `useCurrentUser()` re-renders with the new name (no manual cache invalidation). Throws on failure so
 * the caller can surface it.
 */
export async function updateDisplayName(fullName: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { full_name: fullName } });
  if (error) throw error;
}
