import type { Conversation, ConversationStore } from "./types.js";

/** Default store: fine for local development and a single instance. Lost on restart. */
export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  async get(waId: string): Promise<Conversation | null> {
    const found = this.conversations.get(waId);
    return found ? structuredClone(found) : null;
  }

  async save(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.waId, structuredClone(conversation));
  }

  async listHandoffs(): Promise<Conversation[]> {
    return [...this.conversations.values()].filter((c) => c.handoff.active).map((c) => structuredClone(c));
  }
}
