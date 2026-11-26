import { z } from "zod";
import { AssistantTurnSchema, LLMError, type AssistantTurn, type GenerateInput, type LLMAdapter } from "./types.js";

export interface OpenAICompatibleOptions {
  /** e.g. https://generativelanguage.googleapis.com/v1beta/openai for Gemini. */
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

const jsonSchema = JSON.stringify(z.toJSONSchema(AssistantTurnSchema));

/**
 * Fallback adapter for any OpenAI-compatible Chat Completions endpoint
 * (Gemini, OpenAI, Groq, a local model...). Uses JSON mode, which is widely
 * supported, and validates the result with the same zod schema.
 */
export class OpenAICompatibleAdapter implements LLMAdapter {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.name = `openai-compatible:${options.model}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate({ system, history }: GenerateInput): Promise<AssistantTurn> {
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const body = {
      model: this.options.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${system}\n\nRespond with a single JSON object that matches this JSON Schema:\n${jsonSchema}`,
        },
        ...history,
      ],
    };

    let raw: unknown;
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (error) {
      throw new LLMError("Fallback request failed", this.name, { cause: error });
    }

    const completion = ChatCompletionSchema.safeParse(raw);
    const content = completion.success ? completion.data.choices[0]?.message.content : null;
    if (!content) throw new LLMError("Fallback returned an empty response", this.name);

    try {
      return AssistantTurnSchema.parse(JSON.parse(stripCodeFence(content)));
    } catch (error) {
      throw new LLMError("Fallback returned invalid JSON for the schema", this.name, { cause: error });
    }
  }
}

function stripCodeFence(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  return match?.[1] ?? text;
}
