import { existsSync } from "node:fs";
import { Redis } from "ioredis";
import { loadBusiness } from "./business/business.js";
import { loadEnv } from "./config.js";
import { ConversationService } from "./core/conversation.js";
import { Debouncer } from "./core/debouncer.js";
import { MessageDeduper } from "./core/dedupe.js";
import { NoopEventSink, WebhookEventSink } from "./core/events.js";
import { AnthropicAdapter } from "./llm/anthropic.js";
import { FallbackChain } from "./llm/fallback.js";
import { OpenAICompatibleAdapter } from "./llm/openai-compatible.js";
import type { LLMAdapter } from "./llm/types.js";
import { createLogger, maskPhone } from "./logger.js";
import { createApp } from "./server.js";
import { InMemoryConversationStore } from "./store/memory.js";
import { RedisConversationStore } from "./store/redis.js";
import type { ConversationStore } from "./store/types.js";
import { CloudApiSender, DryRunSender, type MessageSender } from "./whatsapp/sender.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const business = loadBusiness(env.BUSINESS_CONFIG_PATH);

function buildLLM(): LLMAdapter {
  const adapters: LLMAdapter[] = [];
  const anthropic =
    env.ANTHROPIC_API_KEY &&
    new AnthropicAdapter({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, effort: env.ANTHROPIC_EFFORT });
  const fallback =
    env.FALLBACK_BASE_URL &&
    env.FALLBACK_API_KEY &&
    env.FALLBACK_MODEL &&
    new OpenAICompatibleAdapter({ baseUrl: env.FALLBACK_BASE_URL, apiKey: env.FALLBACK_API_KEY, model: env.FALLBACK_MODEL });

  if (env.LLM_PROVIDER === "anthropic") adapters.push(...[anthropic, fallback].filter((a) => !!a));
  else adapters.push(...[fallback, anthropic].filter((a) => !!a));

  if (adapters.length === 0) {
    throw new Error("Configure ANTHROPIC_API_KEY and/or FALLBACK_BASE_URL + FALLBACK_API_KEY + FALLBACK_MODEL");
  }
  return new FallbackChain(adapters, logger);
}

let redis: Redis | undefined;
let store: ConversationStore;
if (env.REDIS_URL) {
  redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  store = new RedisConversationStore(redis, env.CONVERSATION_TTL_SECONDS);
} else {
  logger.warn("REDIS_URL not set: using in-memory store (state is lost on restart)");
  store = new InMemoryConversationStore();
}

let sender: MessageSender;
if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
  sender = new CloudApiSender({
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    graphApiVersion: env.GRAPH_API_VERSION,
  });
} else {
  logger.warn("WhatsApp credentials not set: dry-run mode, replies are only logged");
  sender = new DryRunSender(logger);
}

if (!env.WHATSAPP_APP_SECRET) {
  logger.warn("WHATSAPP_APP_SECRET not set: webhook signatures are NOT verified");
}

const conversations = new ConversationService({
  store,
  llm: buildLLM(),
  sender,
  events: env.EVENTS_WEBHOOK_URL ? new WebhookEventSink(env.EVENTS_WEBHOOK_URL, logger) : new NoopEventSink(),
  business,
  historyLimit: env.HISTORY_LIMIT,
  logger,
});

const debouncer = new Debouncer<string>(
  {
    waitMs: env.DEBOUNCE_MS,
    maxWaitMs: env.DEBOUNCE_MAX_WAIT_MS,
    onError: (err, waId) => logger.error({ err, waId: maskPhone(waId) }, "Failed to handle conversation turn"),
  },
  async (waId, texts) => {
    await conversations.handle(waId, texts);
  },
);

const app = createApp({
  verifyToken: env.WHATSAPP_VERIFY_TOKEN,
  appSecret: env.WHATSAPP_APP_SECRET,
  adminToken: env.ADMIN_TOKEN,
  deduper: new MessageDeduper(env.DEDUPE_TTL_SECONDS * 1000),
  debouncer,
  conversations,
  store,
  logger,
  healthChecks: redis ? { redis: async () => (await redis.ping()) === "PONG" } : {},
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, business: business.name }, "WhatsApp assistant listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down: answering pending messages first");
  server.close();
  await debouncer.flushAll();
  await redis?.quit();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
