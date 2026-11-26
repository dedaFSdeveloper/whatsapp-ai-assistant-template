import { describe, expect, it } from "vitest";
import { ConversationService } from "../src/core/conversation.js";
import { NoopEventSink } from "../src/core/events.js";
import { InMemoryConversationStore } from "../src/store/memory.js";
import { DryRunSender } from "../src/whatsapp/sender.js";
import type { AssistantTurn } from "../src/llm/types.js";
import { business, FakeLLM, silentLogger, turn } from "./helpers.js";

const WA_ID = "5491100000000";

function setup(turns: (AssistantTurn | Error)[], historyLimit = 6) {
  const store = new InMemoryConversationStore();
  const llm = new FakeLLM(turns);
  const sender = new DryRunSender();
  const events = new NoopEventSink();
  const service = new ConversationService({ store, llm, sender, events, business, historyLimit, logger: silentLogger });
  return { store, llm, sender, events, service };
}

describe("ConversationService", () => {
  it("answers with the model reply and joins debounced messages into one turn", async () => {
    const { service, sender, llm } = setup([turn({ reply: "We open at 9:00." })]);
    const result = await service.handle(WA_ID, ["hi", "what time do you open?"]);
    expect(result.action).toBe("replied");
    expect(sender.sent).toEqual([{ to: WA_ID, body: "We open at 9:00." }]);
    expect(llm.calls[0]?.history).toEqual([{ role: "user", content: "hi\nwhat time do you open?" }]);
  });

  it("emits lead.qualified once when code decides the lead is complete", async () => {
    const complete = { name: "Ana", serviceId: "checkup", preferredTime: "Monday 10am" };
    const { service, events } = setup([turn({ intent: "book_appointment", lead: complete }), turn()]);
    await service.handle(WA_ID, ["I'm Ana, cleaning on Monday 10am"]);
    await service.handle(WA_ID, ["thanks!"]);
    expect(events.events.filter((e) => e.type === "lead.qualified")).toHaveLength(1);
  });

  it("activates handoff, notifies the team and then stays silent", async () => {
    const { service, sender, events, llm, store } = setup([turn()]);
    const result = await service.handle(WA_ID, ["I want to talk to a human"]);
    expect(result).toMatchObject({ action: "handoff", reason: "keyword" });
    expect(sender.sent.at(-1)?.body).toBe(business.rules.messages.handoff);
    expect(events.events.at(-1)).toMatchObject({ type: "handoff.requested", reason: "keyword" });

    const next = await service.handle(WA_ID, ["hello?"]);
    expect(next.action).toBe("skipped_handoff");
    expect(sender.sent).toHaveLength(1);
    expect(llm.calls).toHaveLength(1);
    // The message is still stored so the human sees it.
    expect((await store.get(WA_ID))?.history.at(-1)).toEqual({ role: "user", content: "hello?" });
  });

  it("gives the conversation back to the bot after release", async () => {
    const { service, sender } = setup([turn(), turn({ reply: "Welcome back!" })]);
    await service.handle(WA_ID, ["agent please"]);
    expect(await service.releaseHandoff(WA_ID)).toBe(true);
    const result = await service.handle(WA_ID, ["hi again"]);
    expect(result.action).toBe("replied");
    expect(sender.sent.at(-1)?.body).toBe("Welcome back!");
    expect(await service.releaseHandoff(WA_ID)).toBe(false);
  });

  it("keeps the model reply and appends the handoff note for emergencies", async () => {
    const { service, sender } = setup([turn({ intent: "emergency", reply: "Sorry to hear that. We have urgent visits today." })]);
    await service.handle(WA_ID, ["my tooth broke and it hurts"]);
    expect(sender.sent[0]?.body).toBe(`Sorry to hear that. We have urgent visits today.\n\n${business.rules.messages.handoff}`);
  });

  it("hands off with a safe message when every LLM provider fails", async () => {
    const { service, sender, events } = setup([new Error("provider down")]);
    const result = await service.handle(WA_ID, ["hi"]);
    expect(result).toMatchObject({ action: "handoff", reason: "llm_error" });
    expect(sender.sent[0]?.body).toBe(business.rules.messages.error);
    expect(events.events[0]).toMatchObject({ type: "handoff.requested", reason: "llm_error" });
  });

  it("keeps only the last N messages of history", async () => {
    const { service, store } = setup([], 4);
    for (let i = 1; i <= 5; i++) await service.handle(WA_ID, [`message ${i}`]);
    const history = (await store.get(WA_ID))?.history ?? [];
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: "user", content: "message 4" });
  });

  it("processes turns of the same user one at a time", async () => {
    const { service, llm } = setup([turn({ reply: "first" }), turn({ reply: "second" })]);
    await Promise.all([service.handle(WA_ID, ["a"]), service.handle(WA_ID, ["b"])]);
    // The second call must see the first exchange in its history.
    expect(llm.calls[1]?.history.map((m) => m.content)).toEqual(["a", "first", "b"]);
  });
});
