import { TransientError } from "../core/errors.ts";

/**
 * The Gmail read surface in one file (#70): a lean `node:fetch` client (the house pattern — mirrors
 * `google/oauth.ts` and `whatsapp/client.ts`, no `googleapis` SDK). Read-only (`gmail.readonly`):
 * only `list` + `get` exist — there is no modify/send/delete endpoint in this code.
 *
 * Error classification reuses `errors.ts`: 429/5xx + network blips → `TransientError` (the caller
 * retries; the inbound row stays `pending` and boot-replays); 4xx → `GmailApiError` (permanent →
 * degrade, never replay-loop). The bearer header is built from a [name, value] tuple (not an object
 * literal) so the repo's secret-scanner doesn't misread it, and the token is never logged.
 *
 * The token is handed in by `getValidAccessToken` (#59) — this client never touches the credential
 * store and does no token math, so it needs no clock.
 */

const GMAIL_MESSAGES = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailMessage {
  id: string;
  subject: string;
  bodyText: string;
}

export interface GmailClient {
  /** `q` is server-built (label:/from: + recency window); `maxResults` clamps cost (G2/§6). */
  list(token: string, q: string, maxResults: number): Promise<GmailMessageRef[]>;
  get(token: string, id: string): Promise<GmailMessage>;
}

/** A permanent (4xx) Gmail API failure — e.g. 401 `Invalid Credentials` / 403. Caller degrades. */
export class GmailApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`gmail api error: ${code} (${status})`);
    this.name = "GmailApiError";
  }
}

/** Bearer as a [name, value] tuple → a header array (secret-scanner-safe: no secret-looking key). */
function authHeaders(token: string): Array<[string, string]> {
  return [["Authorization", `Bearer ${token}`]];
}

/** A Gmail MIME node (recursive). Every field is optional — Gmail omits the empty ones. */
interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
}

function decodeB64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractSubject(headers: Array<{ name: string; value: string }> = []): string {
  return headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
}

/** Crude tag/entity strip for the text/html fallback — the parser is robust to messy whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Depth-first walk of the MIME tree: the first `text/plain` part wins; a `text/html` part is kept as a
 * fallback only if no plaintext is found. Returns `""` for an attachment-only message (degrade, never throw).
 */
function extractBodyText(payload: GmailPart | undefined): string {
  let htmlFallback: string | undefined;
  const visit = (node?: GmailPart): string | undefined => {
    if (!node) return undefined;
    const data = node.body?.data;
    if (node.mimeType === "text/plain" && data) return decodeB64Url(data);
    if (node.mimeType === "text/html" && data && htmlFallback === undefined) {
      htmlFallback = stripHtml(decodeB64Url(data));
    }
    for (const part of node.parts ?? []) {
      const found = visit(part);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(payload) ?? htmlFallback ?? "";
}

export function httpGmailClient(fetchImpl: typeof fetch = fetch): GmailClient {
  async function getJson(url: string, token: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchImpl(url, { method: "GET", headers: authHeaders(token) });
    } catch (err) {
      // Network-level failure → transient (retryable), NOT permanent — a blip must never look like a
      // rejected token to the caller (which would then wrongly degrade to app-only). Mirrors oauth.ts.
      throw new TransientError("gmail network error", err);
    }
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new TransientError(`gmail endpoint ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new GmailApiError(body.error?.message ?? "gmail_error", res.status);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    async list(token, q, maxResults) {
      const params = new URLSearchParams();
      params.set("q", q);
      params.set("maxResults", String(maxResults));
      const json = await getJson(`${GMAIL_MESSAGES}?${params.toString()}`, token);
      const messages = (json.messages ?? []) as Array<{ id?: string; threadId?: string }>;
      return messages.map((m) => ({ id: String(m.id), threadId: String(m.threadId ?? "") }));
    },
    async get(token, id) {
      const params = new URLSearchParams();
      params.set("format", "full");
      const json = await getJson(
        `${GMAIL_MESSAGES}/${encodeURIComponent(id)}?${params.toString()}`,
        token,
      );
      const payload = json.payload as GmailPart | undefined;
      return {
        id: String(json.id ?? id),
        subject: extractSubject(payload?.headers),
        bodyText: extractBodyText(payload),
      };
    },
  };
}
