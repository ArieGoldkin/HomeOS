import { createBrowserClient } from "@supabase/ssr";

/**
 * The single browser Supabase client (#225) — real per-user auth replacing the old build-embedded family
 * bearer tokens. `createBrowserClient` keeps the PKCE session in a COOKIE (not localStorage) so the
 * same-origin Hono server reads it on every request; the cookie storage is wired automatically.
 *
 * 🔒 Only the publishable (anon) key may live client-side — NEVER the `service_role` key.
 *
 * The empty-env fallbacks keep this module import-safe in unit tests (which mock this module); in the
 * browser the two `VITE_SUPABASE_*` vars are injected at build time, so the real client is always
 * configured against the live project.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const supabase = createBrowserClient(
  supabaseUrl || "http://localhost:54321",
  publishableKey || "anon-placeholder-key",
  { auth: { flowType: "pkce" } },
);
