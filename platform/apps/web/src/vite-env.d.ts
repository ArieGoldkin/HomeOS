/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the @homeos/server API (e.g. https://homeos-production-...up.railway.app). Empty = same origin. */
  readonly VITE_HOMEOS_API_BASE?: string;
  /** Family-only read token for the Bearer-gated GET /events (embedded in the static build — not real auth). */
  readonly VITE_HOMEOS_READ_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
