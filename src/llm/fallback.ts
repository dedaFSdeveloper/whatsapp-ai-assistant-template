import type { Logger } from "pino";
import { LLMError, type AssistantTurn, type GenerateInput, type LLMAdapter } from "./types.js";

/** Tries each adapter in order and returns the first valid answer. */
export class FallbackChain implements LLMAdapter {
  readonly name: string;

  constructor(
    private readonly adapters: LLMAdapter[],
    private readonly logger?: Pick<Logger, "warn">,
  ) {
    if (adapters.length === 0) throw new Error("FallbackChain needs at least one adapter");
    this.name = adapters.map((a) => a.name).join(" -> ");
  }

  async generate(input: GenerateInput): Promise<AssistantTurn> {
    const errors: unknown[] = [];
    for (const adapter of this.adapters) {
      try {
        return await adapter.generate(input);
      } catch (error) {
        errors.push(error);
        this.logger?.warn({ provider: adapter.name, err: error }, "LLM provider failed, trying next");
      }
    }
    throw new LLMError("All LLM providers failed", this.name, { cause: new AggregateError(errors) });
  }
}
