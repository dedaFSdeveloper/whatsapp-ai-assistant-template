import { z } from "zod";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const INTENTS = [
  "greeting",
  "faq",
  "pricing",
  "book_appointment",
  "emergency",
  "complaint",
  "human_request",
  "unknown",
] as const;

/**
 * What the model returns on every turn. The model *describes* the conversation
 * (intent, data it extracted, whether it could answer); code decides what to do
 * with it (qualified lead, handoff). See src/core/rules.ts.
 */
export const AssistantTurnSchema = z.object({
  reply: z.string().describe("The WhatsApp message to send to the customer."),
  intent: z.enum(INTENTS).describe("Main intent of the customer's latest messages."),
  answeredFromKnowledge: z
    .boolean()
    .describe("True if the reply only uses facts from the business information. False if you had to say you don't know."),
  wantsHuman: z.boolean().describe("True if the customer explicitly asks to talk to a person."),
  lead: z.object({
    name: z.string().nullable().describe("Customer name if they said it, otherwise null."),
    serviceId: z.string().nullable().describe("Id of the service they are interested in (from the services list), otherwise null."),
    preferredTime: z.string().nullable().describe("Day/time they would like to come, as they said it, otherwise null."),
  }),
});

export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

export interface GenerateInput {
  system: string;
  history: ChatMessage[];
}

export interface LLMAdapter {
  readonly name: string;
  generate(input: GenerateInput): Promise<AssistantTurn>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LLMError";
  }
}
