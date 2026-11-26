import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export interface IncomingMessage {
  id: string;
  from: string;
  timestamp: number;
  text: string;
  profileName: string | null;
}

const MessageSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    button: z.object({ text: z.string() }).optional(),
    interactive: z
      .object({
        button_reply: z.object({ title: z.string() }).optional(),
        list_reply: z.object({ title: z.string() }).optional(),
      })
      .optional(),
  })
  .loose();

const PayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z
            .object({
              contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
              messages: z.array(MessageSchema).optional(),
            })
            .loose(),
        }),
      ),
    }),
  ),
});

/**
 * Extracts customer messages from a WhatsApp Cloud API webhook payload.
 * Status updates (sent/delivered/read) and unknown shapes are ignored.
 * Non-text messages become a short note so the model can answer politely.
 */
export function extractMessages(payload: unknown): IncomingMessage[] {
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return [];

  const result: IncomingMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const names = new Map(change.value.contacts?.map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const message of change.value.messages ?? []) {
        result.push({
          id: message.id,
          from: message.from,
          timestamp: Number(message.timestamp),
          text: messageText(message),
          profileName: names.get(message.from) ?? null,
        });
      }
    }
  }
  return result;
}

function messageText(message: z.infer<typeof MessageSchema>): string {
  if (message.type === "text" && message.text) return message.text.body;
  if (message.type === "button" && message.button) return message.button.text;
  const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
  if (message.type === "interactive" && reply) return reply.title;
  return `[The customer sent a message of type "${message.type}" that the assistant cannot read]`;
}

/** Validates Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export function isValidSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Handles the GET verification handshake. Returns the challenge to echo, or null to reject. */
export function verifySubscription(query: Record<string, unknown>, verifyToken: string): string | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") return challenge;
  return null;
}
