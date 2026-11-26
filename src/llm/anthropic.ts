import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AssistantTurnSchema, LLMError, type AssistantTurn, type GenerateInput, type LLMAdapter } from "./types.js";

export interface AnthropicAdapterOptions {
  apiKey?: string;
  model: string;
  effort: "low" | "medium" | "high";
  /** Injected in tests. */
  client?: Anthropic;
}

/**
 * Claude adapter using structured outputs: the response is validated against
 * the same zod schema the rest of the app uses, so callers get a typed object
 * or an error, never free text to regex.
 */
export class AnthropicAdapter implements LLMAdapter {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicAdapterOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 30_000 });
  }

  async generate({ system, history }: GenerateInput): Promise<AssistantTurn> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.options.model,
        max_tokens: 4096,
        system,
        messages: history,
        output_config: {
          effort: this.options.effort,
          format: betaZodOutputFormat(AssistantTurnSchema),
        },
        // If a safety classifier declines, the API retries on a recommended model server-side.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (error) {
      throw new LLMError("Anthropic request failed", this.name, { cause: error });
    }

    if (response.stop_reason === "refusal") {
      throw new LLMError("Anthropic declined the request", this.name);
    }
    if (response.stop_reason === "max_tokens") {
      throw new LLMError("Anthropic response was cut off (max_tokens)", this.name);
    }
    if (!response.parsed_output) {
      throw new LLMError("Anthropic returned no parsable output", this.name);
    }
    return response.parsed_output;
  }
}
