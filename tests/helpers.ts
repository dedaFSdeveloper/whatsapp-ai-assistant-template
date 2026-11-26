import { loadBusiness } from "../src/business/business.js";
import type { AssistantTurn, GenerateInput, LLMAdapter } from "../src/llm/types.js";

export const business = loadBusiness("config/business.example.json");

export const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

export function turn(overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  return {
    reply: "Hi! How can I help you?",
    intent: "greeting",
    answeredFromKnowledge: true,
    wantsHuman: false,
    lead: { name: null, serviceId: null, preferredTime: null },
    ...overrides,
  };
}

/** LLM stub that returns queued turns and records what it was asked. */
export class FakeLLM implements LLMAdapter {
  readonly name = "fake";
  readonly calls: GenerateInput[] = [];
  constructor(private readonly turns: (AssistantTurn | Error)[]) {}

  async generate(input: GenerateInput): Promise<AssistantTurn> {
    this.calls.push(structuredClone(input));
    const next = this.turns.shift() ?? turn();
    if (next instanceof Error) throw next;
    return next;
  }
}

export function webhookPayload(messages: { id: string; from: string; text: string }[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: "PHONE_ID" },
              contacts: messages.map((m) => ({ wa_id: m.from, profile: { name: "Test User" } })),
              messages: messages.map((m) => ({
                id: m.id,
                from: m.from,
                timestamp: "1764000000",
                type: "text",
                text: { body: m.text },
              })),
            },
          },
        ],
      },
    ],
  };
}
