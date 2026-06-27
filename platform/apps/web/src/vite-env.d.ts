/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the @homeos/server API (e.g. https://homeos-production-...up.railway.app). Empty = same origin. */
  readonly VITE_HOMEOS_API_BASE?: string;
  /** #225 — Supabase project URL for the browser auth client (real per-user Google login). */
  readonly VITE_SUPABASE_URL?: string;
  /** #225 — Supabase PUBLISHABLE (anon) key. Never the service_role key — that must never reach the client. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
