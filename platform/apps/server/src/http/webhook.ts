import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Normalized inbound message — the seam M2's parser will consume. */
export interface InboundMessage {
  id: string;
  from: string;
  type: string;
  text?: string;
}

const rawMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
});

// Lenient envelope: we only assert the path down to `messages`; everything else
// (contacts, metadata, statuses, future fields) is ignored so unexpected shapes
// degrade to "no messages" rather than throwing.
const envelopeSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({ value: z.object({ messages: z.array(z.unknown()).optional() }).optional() }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/** Extract inbound messages from a Meta webhook body. Returns [] for status-only or malformed payloads. */
export function extractMessages(payload: unknown): InboundMessage[] {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) return [];

  const out: InboundMessage[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const raw of change.value?.messages ?? []) {
        const msg = rawMessageSchema.safeParse(raw);
        if (!msg.success) continue;
        out.push({
          id: msg.data.id,
          from: msg.data.from,
          type: msg.data.type,
          ...(msg.data.text ? { text: msg.data.text.body } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * Meta webhook verification handshake (GET /webhook). Returns the challenge to echo
 * back when mode and token match, otherwise null (caller responds 403).
 */
export function verifyChallenge(
  query: Record<string, string | undefined>,
  verifyToken: string,
): string | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === verifyToken && challenge !== undefined) {
    return challenge;
  }
  return null;
}

/**
 * Verify Meta's X-Hub-Signature-256 header against an HMAC-SHA256 of the RAW request body
 * (keyed with the app secret), timing-safe. The body must be the exact bytes Meta sent — hence
 * the raw-text seam in the POST handler, since `c.req.json()` would re-serialize and not match.
 */
export function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const got = Buffer.from(header);
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}
