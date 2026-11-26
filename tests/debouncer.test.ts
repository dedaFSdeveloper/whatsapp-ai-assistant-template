import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Debouncer } from "../src/core/debouncer.js";

describe("Debouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(waitMs = 3_500, maxWaitMs = 15_000) {
    const flushed: { key: string; items: string[] }[] = [];
    const debouncer = new Debouncer<string>({ waitMs, maxWaitMs }, (key, items) => {
      flushed.push({ key, items });
    });
    return { debouncer, flushed };
  }

  it("merges consecutive messages from the same user", async () => {
    const { debouncer, flushed } = setup();
    debouncer.push("5491100000000", "hi");
    await vi.advanceTimersByTimeAsync(2_000);
    debouncer.push("5491100000000", "I need a cleaning");
    await vi.advanceTimersByTimeAsync(3_499);
    expect(flushed).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(flushed).toEqual([{ key: "5491100000000", items: ["hi", "I need a cleaning"] }]);
  });

  it("keeps users independent", async () => {
    const { debouncer, flushed } = setup();
    debouncer.push("a", "1");
    debouncer.push("b", "2");
    await vi.advanceTimersByTimeAsync(3_500);
    expect(flushed).toHaveLength(2);
    expect(debouncer.pendingKeys).toBe(0);
  });

  it("flushes at maxWait even if the user keeps typing", async () => {
    const { debouncer, flushed } = setup(3_500, 5_000);
    debouncer.push("a", "1");
    await vi.advanceTimersByTimeAsync(3_000);
    debouncer.push("a", "2");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(flushed).toEqual([{ key: "a", items: ["1", "2"] }]);
  });

  it("reports handler errors without throwing", async () => {
    const onError = vi.fn();
    const debouncer = new Debouncer<string>({ waitMs: 10, maxWaitMs: 100, onError }, () => {
      throw new Error("boom");
    });
    debouncer.push("a", "1");
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "a");
  });

  it("flushAll answers pending users immediately (graceful shutdown)", async () => {
    const { debouncer, flushed } = setup();
    debouncer.push("a", "1");
    await debouncer.flushAll();
    expect(flushed).toHaveLength(1);
  });
});
