import { describe, expect, it } from "vitest";
import { FallbackChain } from "../src/llm/fallback.js";
import { OpenAICompatibleAdapter } from "../src/llm/openai-compatible.js";
import { buildSystemPrompt, prepareHistory } from "../src/llm/prompt.js";
import { LLMError } from "../src/llm/types.js";
import { business, FakeLLM, turn } from "./helpers.js";

const input = { system: "system", history: [{ role: "user" as const, content: "hi" }] };

function fakeFetch(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("prompt", () => {
  it("includes business data and every service id", () => {
    const prompt = buildSystemPrompt(business);
    expect(prompt).toContain(business.name);
    for (const service of business.services) expect(prompt).toContain(`id "${service.id}"`);
  });

  it("prepares history: last N, alternating roles, starting with the user", () => {
    const history = prepareHistory(
      [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
        { role: "user", content: "3" },
        { role: "user", content: "4" },
        { role: "assistant", content: "5" },
      ],
      4,
    );
    expect(history).toEqual([
      { role: "user", content: "3\n4" },
      { role: "assistant", content: "5" },
    ]);
  });
});

describe("OpenAICompatibleAdapter", () => {
  const options = { baseUrl: "https://example.test/v1/", apiKey: "test", model: "test-model" };

  it("parses and validates a JSON answer (even inside a code fence)", async () => {
    const content = "```json\n" + JSON.stringify(turn({ reply: "Hola" })) + "\n```";
    const adapter = new OpenAICompatibleAdapter({
      ...options,
      fetchImpl: fakeFetch(200, { choices: [{ message: { content } }] }),
    });
    expect((await adapter.generate(input)).reply).toBe("Hola");
  });

  it("rejects answers that do not match the schema", async () => {
    const adapter = new OpenAICompatibleAdapter({
      ...options,
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '{"reply": 42}' } }] }),
    });
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(LLMError);
  });

  it("wraps HTTP errors", async () => {
    const adapter = new OpenAICompatibleAdapter({ ...options, fetchImpl: fakeFetch(500, {}) });
    await expect(adapter.generate(input)).rejects.toThrow("Fallback request failed");
  });
});

describe("FallbackChain", () => {
  it("uses the next provider when the first one fails", async () => {
    const chain = new FallbackChain([new FakeLLM([new Error("down")]), new FakeLLM([turn({ reply: "from fallback" })])]);
    expect((await chain.generate(input)).reply).toBe("from fallback");
  });

  it("fails when every provider fails", async () => {
    const chain = new FallbackChain([new FakeLLM([new Error("a")]), new FakeLLM([new Error("b")])]);
    await expect(chain.generate(input)).rejects.toThrow("All LLM providers failed");
  });
});
