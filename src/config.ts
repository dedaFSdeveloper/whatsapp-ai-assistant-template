import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "WHATSAPP_VERIFY_TOKEN is required"),
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  GRAPH_API_VERSION: z.string().default("v23.0"),

  LLM_PROVIDER: z.enum(["anthropic", "openai-compatible"]).default("anthropic"),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  FALLBACK_BASE_URL: optionalString,
  FALLBACK_API_KEY: optionalString,
  FALLBACK_MODEL: optionalString,

  BUSINESS_CONFIG_PATH: z.string().default("config/business.example.json"),
  DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(3500),
  DEBOUNCE_MAX_WAIT_MS: z.coerce.number().int().positive().default(15000),
  HISTORY_LIMIT: z.coerce.number().int().min(2).default(20),
  DEDUPE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

  REDIS_URL: optionalString,
  CONVERSATION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  EVENTS_WEBHOOK_URL: optionalString,
  ADMIN_TOKEN: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
