import type { Business } from "../business/business.js";
import type { AssistantTurn } from "../llm/types.js";
import type { Conversation, LeadInfo } from "../store/types.js";

export type HandoffReason = "keyword" | "customer_request" | `intent:${string}` | "unknown_streak";

export interface RuleDecision {
  lead: LeadInfo;
  qualifiedLead: boolean;
  /** True only on the turn the lead becomes qualified (fire events once). */
  newlyQualified: boolean;
  handoff: { required: boolean; reason: HandoffReason | null };
  consecutiveUnknown: number;
}

export interface RuleInput {
  turn: AssistantTurn;
  /** The customer's raw text for this turn (all debounced messages joined). */
  userText: string;
  conversation: Conversation;
  business: Business;
}

/**
 * Business rules live here, in plain code, not in the prompt.
 * The model only reports what it understood; this function decides what it means
 * for the business. That keeps decisions testable, auditable and stable across models.
 */
export function evaluateRules({ turn, userText, conversation, business }: RuleInput): RuleDecision {
  const lead = mergeLead(conversation.lead, turn.lead, business);
  const qualifiedLead = isQualified(lead, business);
  const newlyQualified = qualifiedLead && conversation.qualifiedAt === null;

  const consecutiveUnknown =
    turn.answeredFromKnowledge && turn.intent !== "unknown" ? 0 : conversation.consecutiveUnknown + 1;

  return {
    lead,
    qualifiedLead,
    newlyQualified,
    handoff: decideHandoff(turn, userText, consecutiveUnknown, business),
    consecutiveUnknown,
  };
}

function decideHandoff(
  turn: AssistantTurn,
  userText: string,
  consecutiveUnknown: number,
  business: Business,
): RuleDecision["handoff"] {
  const { rules } = business;
  if (containsKeyword(userText, rules.handoffKeywords)) return { required: true, reason: "keyword" };
  if (turn.wantsHuman || turn.intent === "human_request") return { required: true, reason: "customer_request" };
  if (rules.handoffIntents.includes(turn.intent)) return { required: true, reason: `intent:${turn.intent}` };
  if (consecutiveUnknown >= rules.maxConsecutiveUnknown) return { required: true, reason: "unknown_streak" };
  return { required: false, reason: null };
}

/** New non-empty values win; a service id is only accepted if it exists in the catalog. */
export function mergeLead(previous: LeadInfo, extracted: AssistantTurn["lead"], business: Business): LeadInfo {
  const clean = (value: string | null) => (value && value.trim() ? value.trim() : null);
  const serviceId = clean(extracted.serviceId);
  const validService = serviceId && business.services.some((s) => s.id === serviceId) ? serviceId : null;

  return {
    name: clean(extracted.name) ?? previous.name,
    serviceId: validService ?? previous.serviceId,
    preferredTime: clean(extracted.preferredTime) ?? previous.preferredTime,
  };
}

export function isQualified(lead: LeadInfo, business: Business): boolean {
  const req = business.rules.qualifiedLead;
  return (
    (!req.requireName || lead.name !== null) &&
    (!req.requireService || lead.serviceId !== null) &&
    (!req.requirePreferredTime || lead.preferredTime !== null)
  );
}

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function containsKeyword(text: string, keywords: string[]): boolean {
  const haystack = ` ${normalize(text).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return keywords.some((keyword) => {
    const needle = normalize(keyword).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return needle.length > 0 && haystack.includes(` ${needle} `);
  });
}
