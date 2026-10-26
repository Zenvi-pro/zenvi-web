/**
 * Seeded randomness. Blocks never call Math.random: every random choice is
 * a pure function of a seed and integers, so a frame is the same however
 * often and in whatever order it is rendered.
 */

/** A 32-bit hash of integers (murmur3 finalizer over a running mix). */
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** A number in [0, 1) for `(seed, ...values)`. */
export function random01(seed: number, ...values: number[]): number {
  return hashInts(seed, ...values) / 4294967296;
}

/** A string seed (a block id, a word) as an integer. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A sequential generator (mulberry32) for build-time layout; never use it inside a per-frame track. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
