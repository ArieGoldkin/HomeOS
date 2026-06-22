/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the @homeos/server API (e.g. https://homeos-production-...up.railway.app). Empty = same origin. */
  readonly VITE_HOMEOS_API_BASE?: string;
  /** Family-only read token for the Bearer-gated GET /events (embedded in the static build — not real auth). */
  readonly VITE_HOMEOS_READ_TOKEN?: string;
  /** Distinct write token for POST /events (the add-event seam). Must equal the server's write token;
   *  falls back to the read token for local dev only. Embedded in the static build — not real auth. */
  readonly VITE_HOMEOS_WRITE_TOKEN?: string;
  /** #135 — distinct token for GET /messages (the raw inbound feed). Must equal the server's
   *  MESSAGES_TOKEN; NO read-token fallback (the raw feed is a separate privilege). Build-embedded. */
  readonly VITE_HOMEOS_MESSAGES_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
