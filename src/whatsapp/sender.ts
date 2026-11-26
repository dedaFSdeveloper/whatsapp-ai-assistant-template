import type { Logger } from "pino";
import { maskPhone } from "../logger.js";

export interface MessageSender {
  sendText(to: string, body: string): Promise<void>;
}

export interface CloudApiSenderOptions {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  fetchImpl?: typeof fetch;
}

/** Sends text messages through the WhatsApp Cloud API (Graph API). */
export class CloudApiSender implements MessageSender {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CloudApiSenderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendText(to: string, body: string): Promise<void> {
    const { graphApiVersion, phoneNumberId, accessToken } = this.options;
    const res = await this.fetchImpl(`https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`WhatsApp send failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
  }
}

/** Used when no access token is configured: logs replies instead of sending them. */
export class DryRunSender implements MessageSender {
  readonly sent: { to: string; body: string }[] = [];

  constructor(private readonly logger?: Pick<Logger, "info">) {}

  async sendText(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
    this.logger?.info({ to: maskPhone(to), body }, "[dry-run] reply not sent");
  }
}
