import { describe, expect, it } from "vitest";
import { containsKeyword, evaluateRules } from "../src/core/rules.js";
import { newConversation } from "../src/store/types.js";
import { business, turn } from "./helpers.js";

const base = () => newConversation("5491100000000");

describe("evaluateRules", () => {
  it("qualifies a lead only when name, a real service and a time are known", () => {
    const decision = evaluateRules({
      turn: turn({ intent: "book_appointment", lead: { name: "Ana", serviceId: "checkup", preferredTime: "Tuesday morning" } }),
      userText: "I'm Ana, a cleaning on Tuesday morning",
      conversation: base(),
      business,
    });
    expect(decision.qualifiedLead).toBe(true);
    expect(decision.newlyQualified).toBe(true);
    expect(decision.handoff.required).toBe(false);
  });

  it("ignores service ids the model invented", () => {
    const decision = evaluateRules({
      turn: turn({ lead: { name: "Ana", serviceId: "brain-surgery", preferredTime: "Friday" } }),
      userText: "",
      conversation: base(),
      business,
    });
    expect(decision.lead.serviceId).toBeNull();
    expect(decision.qualifiedLead).toBe(false);
  });

  it("accumulates lead data across turns and fires 'newly qualified' only once", () => {
    let conversation = base();
    conversation.lead = { name: "Ana", serviceId: "whitening", preferredTime: null };
    const first = evaluateRules({
      turn: turn({ lead: { name: null, serviceId: null, preferredTime: "tomorrow 10am" } }),
      userText: "tomorrow 10am",
      conversation,
      business,
    });
    expect(first.lead).toEqual({ name: "Ana", serviceId: "whitening", preferredTime: "tomorrow 10am" });
    expect(first.newlyQualified).toBe(true);

    conversation = { ...conversation, lead: first.lead, qualifiedAt: "2026-11-25T10:00:00.000Z" };
    const second = evaluateRules({ turn: turn(), userText: "thanks", conversation, business });
    expect(second.qualifiedLead).toBe(true);
    expect(second.newlyQualified).toBe(false);
  });

  it("hands off on a keyword even if the model missed it", () => {
    const decision = evaluateRules({ turn: turn(), userText: "Quiero hablar con una PERSONA", conversation: base(), business });
    expect(decision.handoff).toEqual({ required: true, reason: "keyword" });
  });

  it("hands off when the model reports the customer wants a human", () => {
    const decision = evaluateRules({ turn: turn({ wantsHuman: true }), userText: "can someone call me?", conversation: base(), business });
    expect(decision.handoff).toEqual({ required: true, reason: "customer_request" });
  });

  it("hands off on configured intents such as emergencies", () => {
    const decision = evaluateRules({ turn: turn({ intent: "emergency" }), userText: "my tooth broke", conversation: base(), business });
    expect(decision.handoff).toEqual({ required: true, reason: "intent:emergency" });
  });

  it("hands off after too many answers the bot could not give", () => {
    const conversation = { ...base(), consecutiveUnknown: 1 };
    const decision = evaluateRules({
      turn: turn({ intent: "unknown", answeredFromKnowledge: false }),
      userText: "do you sell toothbrushes?",
      conversation,
      business,
    });
    expect(decision.consecutiveUnknown).toBe(2);
    expect(decision.handoff).toEqual({ required: true, reason: "unknown_streak" });
  });

  it("resets the unknown streak after a good answer", () => {
    const decision = evaluateRules({ turn: turn({ intent: "faq" }), userText: "hours?", conversation: { ...base(), consecutiveUnknown: 1 }, business });
    expect(decision.consecutiveUnknown).toBe(0);
    expect(decision.handoff.required).toBe(false);
  });
});

describe("containsKeyword", () => {
  it("matches whole words, ignoring case and accents", () => {
    expect(containsKeyword("¿Puedo hablar con un OPERADOR?", ["operador"])).toBe(true);
    expect(containsKeyword("Necesito un asesór", ["asesor"])).toBe(true);
    expect(containsKeyword("I want a real person please", ["real person"])).toBe(true);
  });

  it("does not match inside other words", () => {
    expect(containsKeyword("personal hygiene tips", ["persona"])).toBe(false);
    expect(containsKeyword("humanity", ["human"])).toBe(false);
  });
});
