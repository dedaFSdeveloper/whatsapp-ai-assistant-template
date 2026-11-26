import type { Logger } from "pino";
import type { LeadInfo } from "../store/types.js";

export type AssistantEvent =
  | { type: "lead.qualified"; waId: string; lead: LeadInfo; at: string }
  | { type: "handoff.requested"; waId: string; reason: string; lastMessage: string; at: string };

export interface EventSink {
  emit(event: AssistantEvent): Promise<void>;
}

export class NoopEventSink implements EventSink {
  readonly events: AssistantEvent[] = [];
  async emit(event: AssistantEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * POSTs events as JSON to a URL (an n8n/Make workflow, a CRM, a Slack relay...).
 * Failures are logged and swallowed: a down CRM must not break the chat.
 */
export class WebhookEventSink implements EventSink {
  constructor(
    private readonly url: string,
    private readonly logger: Pick<Logger, "warn">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async emit(event: AssistantEvent): Promise<void> {
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      this.logger.warn({ err, type: event.type }, "Could not deliver event");
    }
  }
}
