import type { Logger } from "pino";
import type { Business } from "../business/business.js";
import { maskPhone } from "../logger.js";
import { buildSystemPrompt, prepareHistory } from "../llm/prompt.js";
import type { LLMAdapter } from "../llm/types.js";
import { appendHistory, newConversation, type Conversation, type ConversationStore } from "../store/types.js";
import type { MessageSender } from "../whatsapp/sender.js";
import type { EventSink } from "./events.js";
import { evaluateRules, type RuleDecision } from "./rules.js";

export type HandleResult =
  | { action: "replied"; reply: string; decision: RuleDecision }
  | { action: "handoff"; reply: string; reason: string }
  | { action: "skipped_handoff" };

export interface ConversationServiceDeps {
  store: ConversationStore;
  llm: LLMAdapter;
  sender: MessageSender;
  events: EventSink;
  business: Business;
  historyLimit: number;
  logger: Pick<Logger, "info" | "warn" | "error">;
  now?: () => Date;
}

/**
 * One customer turn: load state -> ask the model -> apply business rules ->
 * reply -> persist -> emit events. Turns for the same customer run one at a time.
 */
export class ConversationService {
  private readonly systemPrompt: string;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => Date;

  constructor(private readonly deps: ConversationServiceDeps) {
    this.systemPrompt = buildSystemPrompt(deps.business);
    this.now = deps.now ?? (() => new Date());
  }

  handle(waId: string, texts: string[]): Promise<HandleResult> {
    return this.serialize(waId, () => this.process(waId, texts.join("\n")));
  }

  /** Gives the conversation back to the bot after a human finished. */
  async releaseHandoff(waId: string): Promise<boolean> {
    return this.serialize(waId, async () => {
      const conversation = await this.deps.store.get(waId);
      if (!conversation?.handoff.active) return false;
      await this.deps.store.save({
        ...conversation,
        handoff: { active: false, reason: null, since: null },
        consecutiveUnknown: 0,
        updatedAt: this.now().toISOString(),
      });
      return true;
    });
  }

  private async process(waId: string, userText: string): Promise<HandleResult> {
    const { store, llm, sender, events, business, historyLimit, logger } = this.deps;
    const at = this.now().toISOString();
    let conversation = (await store.get(waId)) ?? newConversation(waId, this.now());
    conversation = appendHistory(conversation, [{ role: "user", content: userText }], historyLimit);

    // A person is handling this chat: keep the history, stay silent.
    if (conversation.handoff.active) {
      await store.save({ ...conversation, updatedAt: at });
      return { action: "skipped_handoff" };
    }

    let turn;
    try {
      turn = await llm.generate({ system: this.systemPrompt, history: prepareHistory(conversation.history, historyLimit) });
    } catch (err) {
      logger.error({ err, waId: maskPhone(waId) }, "LLM failed, handing off");
      return this.handOff(conversation, "llm_error", business.rules.messages.error, userText, at);
    }

    const decision = evaluateRules({ turn, userText, conversation, business });
    conversation = {
      ...conversation,
      lead: decision.lead,
      consecutiveUnknown: decision.consecutiveUnknown,
      qualifiedAt: decision.newlyQualified ? at : conversation.qualifiedAt,
    };

    if (decision.newlyQualified) {
      await events.emit({ type: "lead.qualified", waId, lead: decision.lead, at });
    }

    if (decision.handoff.required && decision.handoff.reason) {
      // When the customer asked for a person, the model's own answer is redundant.
      const askedForHuman = decision.handoff.reason === "keyword" || decision.handoff.reason === "customer_request";
      const reply = askedForHuman ? business.rules.messages.handoff : `${turn.reply}\n\n${business.rules.messages.handoff}`;
      return this.handOff(conversation, decision.handoff.reason, reply, userText, at);
    }

    conversation = appendHistory(conversation, [{ role: "assistant", content: turn.reply }], historyLimit);
    await store.save({ ...conversation, updatedAt: at });
    await sender.sendText(waId, turn.reply);
    logger.info({ waId: maskPhone(waId), intent: turn.intent, qualified: decision.qualifiedLead }, "Replied");
    return { action: "replied", reply: turn.reply, decision };
  }

  private async handOff(
    conversation: Conversation,
    reason: string,
    reply: string,
    userText: string,
    at: string,
  ): Promise<HandleResult> {
    const { store, sender, events, historyLimit, logger } = this.deps;
    const updated = appendHistory(
      { ...conversation, handoff: { active: true, reason, since: at }, updatedAt: at },
      [{ role: "assistant", content: reply }],
      historyLimit,
    );
    await store.save(updated);
    await sender.sendText(conversation.waId, reply);
    await events.emit({ type: "handoff.requested", waId: conversation.waId, reason, lastMessage: userText, at });
    logger.info({ waId: maskPhone(conversation.waId), reason }, "Handed off to a human");
    return { action: "handoff", reply, reason };
  }

  private serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined).finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    this.queues.set(key, tail);
    return run;
  }
}
