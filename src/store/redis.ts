import type { Conversation, ConversationStore } from "./types.js";

/**
 * The few Redis commands this store needs. `ioredis` satisfies it as is;
 * any other client can be wrapped in a small object with these methods.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
}

/** Persists conversations as JSON with a TTL, so state survives restarts and is shared across replicas. */
export class RedisConversationStore implements ConversationStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlSeconds: number,
    private readonly prefix = "wa-assistant",
  ) {}

  async get(waId: string): Promise<Conversation | null> {
    const raw = await this.redis.get(this.key(waId));
    return raw ? (JSON.parse(raw) as Conversation) : null;
  }

  async save(conversation: Conversation): Promise<void> {
    await this.redis.set(this.key(conversation.waId), JSON.stringify(conversation), "EX", this.ttlSeconds);
    const handoffs = `${this.prefix}:handoffs`;
    if (conversation.handoff.active) await this.redis.sadd(handoffs, conversation.waId);
    else await this.redis.srem(handoffs, conversation.waId);
  }

  async listHandoffs(): Promise<Conversation[]> {
    const ids = await this.redis.smembers(`${this.prefix}:handoffs`);
    const conversations = await Promise.all(ids.map((id) => this.get(id)));
    return conversations.filter((c): c is Conversation => c?.handoff.active === true);
  }

  private key(waId: string): string {
    return `${this.prefix}:conv:${waId}`;
  }
}
