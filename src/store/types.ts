import type { ChatMessage } from "../llm/types.js";

export interface LeadInfo {
  name: string | null;
  serviceId: string | null;
  preferredTime: string | null;
}

export interface HandoffState {
  active: boolean;
  reason: string | null;
  since: string | null;
}

export interface Conversation {
  /** WhatsApp id of the customer (their phone number in international format). */
  waId: string;
  history: ChatMessage[];
  lead: LeadInfo;
  handoff: HandoffState;
  qualifiedAt: string | null;
  /** Turns in a row where the model could not answer from the business data. */
  consecutiveUnknown: number;
  updatedAt: string;
}

export interface ConversationStore {
  get(waId: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
  /** Used by the admin endpoint; implementations may return an empty list. */
  listHandoffs(): Promise<Conversation[]>;
}

export function newConversation(waId: string, now = new Date()): Conversation {
  return {
    waId,
    history: [],
    lead: { name: null, serviceId: null, preferredTime: null },
    handoff: { active: false, reason: null, since: null },
    qualifiedAt: null,
    consecutiveUnknown: 0,
    updatedAt: now.toISOString(),
  };
}

/** Appends messages and keeps only the last `limit`. */
export function appendHistory(conversation: Conversation, messages: ChatMessage[], limit: number): Conversation {
  return { ...conversation, history: [...conversation.history, ...messages].slice(-limit) };
}
