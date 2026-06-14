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

/**
 * Minimal WhatsApp Cloud API client — no SDK, one POST to the Graph API.
 * `fetchImpl` is injectable so tests never hit the network.
 */
export function createWhatsAppClient(
  config: WhatsAppConfig,
  fetchImpl: typeof fetch = fetch,
): WhatsAppClient {
  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;

  return {
    async sendText(to, body) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `WhatsApp sendText failed: ${res.status} ${res.statusText} ${detail}`.trim(),
        );
      }
    },
  };
}
