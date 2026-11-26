import { describe, expect, it } from "vitest";
import { InMemoryConversationStore } from "../src/store/memory.js";
import { RedisConversationStore, type RedisLike } from "../src/store/redis.js";
import { appendHistory, newConversation, type ConversationStore } from "../src/store/types.js";

/** Minimal in-process stand-in for the Redis commands the store uses. */
class FakeRedis implements RedisLike {
  readonly values = new Map<string, { value: string; ttl: number }>();
  readonly sets = new Map<string, Set<string>>();
  async get(key: string) {
    return this.values.get(key)?.value ?? null;
  }
  async set(key: string, value: string, _mode: "EX", seconds: number) {
    this.values.set(key, { value, ttl: seconds });
    return "OK";
  }
  async sadd(key: string, member: string) {
    this.sets.set(key, (this.sets.get(key) ?? new Set()).add(member));
    return 1;
  }
  async srem(key: string, member: string) {
    this.sets.get(key)?.delete(member);
    return 1;
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
}

const stores: [string, () => ConversationStore][] = [
  ["InMemoryConversationStore", () => new InMemoryConversationStore()],
  ["RedisConversationStore", () => new RedisConversationStore(new FakeRedis(), 3600)],
];

describe.each(stores)("%s", (_name, create) => {
  it("saves and loads a conversation", async () => {
    const store = create();
    expect(await store.get("1")).toBeNull();
    const conversation = appendHistory(newConversation("1"), [{ role: "user", content: "hi" }], 10);
    await store.save(conversation);
    expect(await store.get("1")).toEqual(conversation);
  });

  it("lists only conversations in handoff", async () => {
    const store = create();
    const active = { ...newConversation("1"), handoff: { active: true, reason: "keyword", since: "now" } };
    await store.save(active);
    await store.save(newConversation("2"));
    expect((await store.listHandoffs()).map((c) => c.waId)).toEqual(["1"]);

    await store.save({ ...active, handoff: { active: false, reason: null, since: null } });
    expect(await store.listHandoffs()).toEqual([]);
  });
});

it("RedisConversationStore sets a TTL on every save", async () => {
  const redis = new FakeRedis();
  await new RedisConversationStore(redis, 120).save(newConversation("1"));
  expect(redis.values.get("wa-assistant:conv:1")?.ttl).toBe(120);
});
