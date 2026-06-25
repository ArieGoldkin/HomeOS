import { type ConnectionStatus, connectionStatusSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";
/**
 * The connection STATUS is a non-secret read (a boolean + the granted scopes, never a token — the shared
 * `connectionStatusSchema` is a strictObject that fails loudly if a token ever leaks into it). It rides on
 * the existing build-embedded family READ token, like {@link fetchEvents}. The setup CODE that authorizes
 * the connect/disconnect MUTATIONS is a different, higher privilege — a RUNTIME argument the user types,
 * NEVER read from `import.meta.env` and NEVER bundled (see `startGoogleConnect`/`disconnectGoogle`).
 */
const READ_TOKEN = import.meta.env.VITE_HOMEOS_READ_TOKEN ?? "";

/**
 * #111 — the server answered `503 Service Unavailable`: Google OAuth is not configured on the server
 * (no client id/secret / encryption key). This is a NON-ACTIONABLE "dark" state, distinct from a real
 * error — the UI shows a muted "Google לא מוגדר" with no Connect button rather than a retry.
 */
export class GoogleNotConfiguredError extends Error {
  constructor(message = "Google OAuth is not configured on the server (503)") {
    super(message);
    this.name = "GoogleNotConfiguredError";
  }
}

/**
 * #111 — the typed `startGoogleConnect` failures the connect dialog maps to distinct Hebrew copy:
 * `auth` (401/403 — wrong setup code), `rate_limited` (429 — too many attempts), `not_configured`
 * (503 — server dark). `unknown` is any other non-2xx. The dialog switches on `reason`, never on a
 * raw status code or a parsed message string.
 */
export type ConnectErrorReason = "auth" | "rate_limited" | "not_configured" | "unknown";

export class GoogleConnectError extends Error {
  readonly reason: ConnectErrorReason;
  readonly status: number;
  constructor(reason: ConnectErrorReason, status: number) {
    super(`GET /oauth/google/connect-url failed (${status})`);
    this.name = "GoogleConnectError";
    this.reason = reason;
    this.status = status;
  }
}

function connectReasonForStatus(status: number): ConnectErrorReason {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 503) return "not_configured";
  return "unknown";
}

/**
 * #111 — GET `/oauth/google/status`: the connection status the Connect screen polls. Sends the
 * non-secret family READ token (status is a read, not a mutation). A `503` is the configured-dark state
 * surfaced as a distinguishable {@link GoogleNotConfiguredError} so the UI can show a non-actionable
 * "not configured" tile. The body is parsed with the shared `connectionStatusSchema` (a strictObject):
 * any shape drift — above all a leaked token — fails loudly here, never silently in the UI.
 */
export async function fetchConnectionStatus(signal?: AbortSignal): Promise<ConnectionStatus> {
  const res = await fetch(`${API_BASE}/oauth/google/status`, {
    headers: { Authorization: `Bearer ${READ_TOKEN}` },
    signal,
  });
  if (res.status === 503) {
    throw new GoogleNotConfiguredError();
  }
  if (!res.ok) {
    throw new Error(`GET /oauth/google/status failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return connectionStatusSchema.parse(data);
}

/**
 * #111 — GET `/oauth/google/connect-url`: exchange the user-typed setup CODE for the Google consent URL
 * the browser then navigates to. CRITICAL: `setupToken` is a RUNTIME ARGUMENT — the short-lived code the
 * user types into the dialog — and is NEVER read from `import.meta.env` / bundled. Distinct failures are
 * surfaced as a {@link GoogleConnectError} carrying a `reason` (auth/rate_limited/not_configured/unknown)
 * so the dialog can show distinct Hebrew messages. Returns the `{ url }` JSON on 200.
 */
export async function startGoogleConnect(setupToken: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE}/oauth/google/connect-url`, {
    headers: { Authorization: `Bearer ${setupToken}` },
  });
  if (!res.ok) {
    throw new GoogleConnectError(connectReasonForStatus(res.status), res.status);
  }
  const data = (await res.json()) as { url: string };
  return data;
}

/**
 * #111 — POST `/oauth/google/disconnect`: revoke + delete the stored Google credential. Like
 * `startGoogleConnect`, the setup CODE is a RUNTIME argument (the user re-types it to confirm a destroy),
 * NEVER from `import.meta.env`. Throws a {@link GoogleConnectError} (same typed reasons) on any non-2xx so
 * the confirm dialog can surface a distinct Hebrew message.
 */
export async function disconnectGoogle(setupToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/oauth/google/disconnect`, {
    method: "POST",
    headers: { Authorization: `Bearer ${setupToken}` },
  });
  if (!res.ok) {
    throw new GoogleConnectError(connectReasonForStatus(res.status), res.status);
  }
}
