import { describe, expect, it } from "vitest";
import { LruCache } from "./lru.js";

describe("LruCache", () => {
  it("evicts the least recently used entry past maxEntries", () => {
    const evicted: string[] = [];
    const lru = new LruCache<string, number>({ maxEntries: 2, onEvict: (_v, k) => evicted.push(k) });
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.get("a")).toBe(1); // a is now most recent
    lru.set("c", 3);
    expect(evicted).toEqual(["b"]);
    expect(lru.keys()).toEqual(["a", "c"]);
  });

  it("enforces a cost budget but always keeps the newest entry", () => {
    const evicted: string[] = [];
    const lru = new LruCache<string, number>({ maxCost: 10, cost: (v) => v, onEvict: (_v, k) => evicted.push(k) });
    lru.set("a", 4);
    lru.set("b", 4);
    lru.set("c", 4);
    expect(evicted).toEqual(["a"]);
    expect(lru.totalCost).toBe(8);
    lru.set("huge", 50);
    expect(lru.keys()).toEqual(["huge"]);
    expect(lru.totalCost).toBe(50);
  });

  it("disposes a replaced value but not a re-set identical value", () => {
    const evicted: number[] = [];
    const lru = new LruCache<string, number>({ onEvict: (v) => evicted.push(v) });
    lru.set("a", 1);
    lru.set("a", 1);
    lru.set("a", 2);
    expect(evicted).toEqual([1]);
    expect(lru.size).toBe(1);
  });

  it("peek does not change recency; find does", () => {
    const lru = new LruCache<string, number>({ maxEntries: 2 });
    lru.set("a", 1);
    lru.set("b", 2);
    lru.peek("a");
    lru.set("c", 3);
    expect(lru.has("a")).toBe(false);
    const found = lru.find((v) => v === 2);
    expect(found?.key).toBe("b");
    lru.set("d", 4);
    expect(lru.keys()).toEqual(["b", "d"]);
  });

  it("clear and deleteWhere call onEvict for every value", () => {
    const evicted: number[] = [];
    const lru = new LruCache<string, number>({ onEvict: (v) => evicted.push(v) });
    lru.set("x1", 1);
    lru.set("y2", 2);
    lru.set("x3", 3);
    expect(lru.deleteWhere((k) => k.startsWith("x"))).toBe(2);
    lru.clear();
    expect(evicted.sort()).toEqual([1, 2, 3]);
    expect(lru.size).toBe(0);
    expect(lru.totalCost).toBe(0);
  });
});
