/** The outbound seam handlers depend on. M2 adds sendtemplate / media helpers alongside. */
export type SendText = (to: string, body: string) => Promise<void>;

export interface WhatsAppConfig {
  whatsappToken: string;
  phoneNumberId: string;
  graphVersion: string;
}

export interface WhatsAppClient {
  sendText: SendText;
}

export interface ClientOptions {
  /** Extra attempts on a transient send failure (default 2 → up to 3 sends total). */
  retries?: number;
  /** Injectable backoff sleep (tests pass an instant no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Minimal WhatsApp Cloud API client — no SDK, one POST to the Graph API.
 * `fetchImpl` is injectable so tests never hit the network. A transient send failure (429/5xx
 * or a network error) is retried with backoff, so a Graph blip doesn't leave the user with a
 * saved event but no confirm; a 4xx is permanent and throws immediately.
 */
export function createWhatsAppClient(
  config: WhatsAppConfig,
  fetchImpl: typeof fetch = fetch,
  opts: ClientOptions = {},
): WhatsAppClient {
  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  return {
    async sendText(to, body) {
      const payload = JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body },
      });
      const headers = {
        Authorization: `Bearer ${config.whatsappToken}`,
        "Content-Type": "application/json",
      };

      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(url, { method: "POST", headers, body: payload });
        } catch (err) {
          // Network-level failure → transient. Retry with backoff, else rethrow.
          if (attempt < retries) {
            await sleep(200 * (attempt + 1));
            continue;
          }
          throw err instanceof Error ? err : new Error(String(err));
        }

        if (res.ok) return;

        const detail = await res.text().catch(() => "");
        const message =
          `WhatsApp sendText failed: ${res.status} ${res.statusText} ${detail}`.trim();
        const transient = res.status === 429 || res.status >= 500;
        if (transient && attempt < retries) {
          await sleep(200 * (attempt + 1));
          continue;
        }
        throw new Error(message);
      }
    },
  };
}
