import type { Business } from "../business/business.js";
import type { ChatMessage } from "./types.js";

/**
 * Builds the system prompt from business data only. Keep it stable across requests
 * (no timestamps, no per-user data) so providers can cache it.
 */
export function buildSystemPrompt(business: Business): string {
  const services = business.services
    .map((s) => `- id "${s.id}": ${s.name} | price: ${s.price}${s.duration ? ` | duration: ${s.duration}` : ""}`)
    .join("\n");
  const faq = business.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n");

  return `You are ${business.assistantName}, the WhatsApp assistant of ${business.name}.

<business>
${business.description}
Address: ${business.contact.address}
Phone: ${business.contact.phone}
Opening hours: ${business.contact.hours}
</business>

<services>
${services}
</services>

<faq>
${faq}
</faq>

How to reply:
- ${business.tone}
- ${business.language}
- Use only the information above. If something is not there (a price, a policy, availability), say you will check with the team. Never invent prices, dates or medical advice.
- You cannot book appointments yourself. To help the team book one, ask for the missing details: the customer's name, the service and a preferred day/time. Ask for at most one or two things per message.
- If the customer describes strong pain, bleeding, swelling or an accident, acknowledge it, share the urgent-visit option and set intent to "emergency".

Fill every field of the response schema. "reply" is the only text the customer will see.`;
}

/**
 * Prepares stored history for a chat API: drops leading assistant turns,
 * merges consecutive messages of the same role, and keeps the last `limit`.
 */
export function prepareHistory(history: ChatMessage[], limit: number): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of history.slice(-limit)) {
    const last = merged.at(-1);
    if (last && last.role === message.role) {
      last.content = `${last.content}\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }
  while (merged[0]?.role === "assistant") merged.shift();
  return merged;
}
