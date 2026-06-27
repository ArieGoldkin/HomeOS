/**
 * Raised when a provider call (Claude / Graph) fails transiently after retries — i.e. the
 * request was fine, the service just hiccuped. The handler turns this into a "try again"
 * reply (never "rephrase"), and `processInbound` leaves the inbound row `pending` so boot-replay
 * retries it — as opposed to a permanent failure, which is settled as `failed`.
 */
export class TransientError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause }); // Error.cause (ES2022) — preserves the underlying provider error
    this.name = "TransientError";
  }
}

/**
 * Transient = worth retrying: HTTP 429 or any 5xx, or a network-level error with no HTTP status
 * (connection reset/timeout). A 4xx (other than 429) is permanent — retrying won't help.
 */
export function isTransient(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return true; // no HTTP status → network/connection error → retryable
}

/**
 * Programming bugs (not provider blips) must settle as PERMANENT, never be retried or wrapped as
 * `TransientError` — otherwise `isTransient` (true for any no-status error) would replay them forever
 * on every boot (G10/OG10). Always check this BEFORE `isTransient` at a provider call site: a
 * statusless `TypeError`/`RangeError`/`ReferenceError`/`SyntaxError` would otherwise look "transient".
 * Shared by `agent/loop.ts` (the model call) and `parser.ts` (the parse call). #57.
 */
export function isProgrammingError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError
  );
}
