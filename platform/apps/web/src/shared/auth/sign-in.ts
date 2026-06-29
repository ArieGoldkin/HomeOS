import { supabase } from "./supabase-client";

/**
 * Start the Google OAuth round-trip (PKCE, #225). On success the browser navigates to Google; Supabase then
 * redirects back to `${origin}/today`, where the browser client exchanges the code for the COOKIE session
 * and fires a SIGNED_IN event the {@link AuthProvider} observes. Identity scopes only — Calendar/Gmail stay
 * on the separate Connect flow (`features/connections`), now gated by the SAME session cookie (#231).
 */
export async function signInWithGoogle(): Promise<void> {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: "openid email profile",
      redirectTo: `${window.location.origin}/today`,
    },
  });
}
