import { readFileSync } from "node:fs";
import { z } from "zod";

export const BusinessSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  assistantName: z.string().min(1),
  tone: z.string(),
  language: z.string(),
  contact: z.object({
    address: z.string(),
    phone: z.string(),
    hours: z.string(),
  }),
  services: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        price: z.string(),
        duration: z.string().optional(),
      }),
    )
    .min(1),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  rules: z.object({
    qualifiedLead: z.object({
      requireName: z.boolean(),
      requireService: z.boolean(),
      requirePreferredTime: z.boolean(),
    }),
    handoffKeywords: z.array(z.string()),
    handoffIntents: z.array(z.string()),
    maxConsecutiveUnknown: z.number().int().positive(),
    messages: z.object({
      handoff: z.string(),
      error: z.string(),
    }),
  }),
});

export type Business = z.infer<typeof BusinessSchema>;

export function parseBusiness(data: unknown): Business {
  return BusinessSchema.parse(data);
}

export function loadBusiness(path: string): Business {
  const raw = readFileSync(path, "utf8");
  return parseBusiness(JSON.parse(raw));
}
