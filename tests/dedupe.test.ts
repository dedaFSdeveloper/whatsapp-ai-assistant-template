import { describe, expect, it } from "vitest";
import { MessageDeduper } from "../src/core/dedupe.js";

describe("MessageDeduper", () => {
  it("accepts an id once and rejects retries", () => {
    const deduper = new MessageDeduper(60_000);
    expect(deduper.isFirstSeen("wamid.1")).toBe(true);
    expect(deduper.isFirstSeen("wamid.1")).toBe(false);
    expect(deduper.isFirstSeen("wamid.2")).toBe(true);
  });

  it("forgets ids after the TTL", () => {
    let now = 0;
    const deduper = new MessageDeduper(1_000, () => now);
    expect(deduper.isFirstSeen("wamid.1")).toBe(true);
    now = 999;
    expect(deduper.isFirstSeen("wamid.1")).toBe(false);
    now = 1_000;
    expect(deduper.isFirstSeen("wamid.1")).toBe(true);
  });

  it("evicts expired entries and caps memory", () => {
    let now = 0;
    const deduper = new MessageDeduper(10, () => now, 3);
    ["a", "b", "c", "d"].forEach((id) => deduper.isFirstSeen(id));
    expect(deduper.size).toBe(3);
    now = 100;
    deduper.isFirstSeen("e");
    expect(deduper.size).toBe(1);
  });
});
