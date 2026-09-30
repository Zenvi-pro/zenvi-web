import { describe, expect, it } from "vitest";
import { FrameCache, type FrameKey } from "./frame-cache.js";
import { SharedBitmap } from "./shared-bitmap.js";

class FakeBitmap {
  closed = false;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  close() {
    if (this.closed) throw new Error("closed twice");
    this.closed = true;
  }
}

const key = (media = "file:A"): FrameKey => ({ media, version: 1, width: 10, height: 10, rotated: true });

describe("SharedBitmap", () => {
  it("closes only after the owner and every borrower let go", () => {
    const image = new FakeBitmap(2, 2);
    const shared = new SharedBitmap(image);
    const a = shared.retain();
    const b = shared.retain();
    shared.drop();
    a.release();
    a.release(); // idempotent
    expect(image.closed).toBe(false);
    b.release();
    expect(image.closed).toBe(true);
    expect(() => shared.retain()).toThrow();
  });
});

describe("FrameCache", () => {
  it("hits any timestamp inside a cached picture's interval, per size and media", () => {
    const cache = new FrameCache<FakeBitmap>();
    const borrowed = cache.insert(key(), { start: 1, end: 1.04 }, new FakeBitmap(10, 10));
    borrowed.release();
    const hit = cache.lookup(key(), 1.03);
    expect(hit).not.toBeNull();
    hit!.release();
    expect(cache.lookup(key(), 1.04)).toBeNull();
    expect(cache.lookup({ ...key(), width: 20 }, 1.02)).toBeNull();
    expect(cache.lookup(key("file:B"), 1.02)).toBeNull();
    expect(cache.lookup({ ...key(), version: 2 }, 1.02)).toBeNull();
  });

  it("evicts by byte budget without closing pictures still borrowed", () => {
    const cache = new FrameCache<FakeBitmap>(10 * 10 * 4 * 2);
    const images = [0, 1, 2].map(() => new FakeBitmap(10, 10));
    const held = cache.insert(key(), { start: 0, end: 1 }, images[0]!);
    cache.insert(key(), { start: 1, end: 2 }, images[1]!).release();
    cache.insert(key(), { start: 2, end: 3 }, images[2]!).release();
    // images[0] was evicted but is still held by a renderer.
    expect(cache.lookup(key(), 0.5)).toBeNull();
    expect(images[0]!.closed).toBe(false);
    held.release();
    expect(images[0]!.closed).toBe(true);
    expect(cache.bytes).toBe(800);
  });

  it("evictMedia drops one file's pictures", () => {
    const cache = new FrameCache<FakeBitmap>();
    const a = new FakeBitmap(10, 10);
    const b = new FakeBitmap(10, 10);
    cache.insert(key("file:A"), { start: 0, end: 1 }, a).release();
    cache.insert(key("file:B"), { start: 0, end: 1 }, b).release();
    cache.evictMedia("file:A");
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(false);
    cache.clear();
    expect(b.closed).toBe(true);
  });
});
