/**
 * A least-recently-used cache with an entry cap and a cost budget.
 *
 * Decoded frames are GPU textures (`ImageBitmap`) that must be closed
 * deterministically, so eviction goes through `onEvict` instead of being left
 * to the garbage collector.
 */

export interface LruOptions<K, V> {
  /** Maximum number of entries. Default: unbounded. */
  maxEntries?: number;
  /** Maximum total cost (e.g. bytes). Default: unbounded. */
  maxCost?: number;
  /** Cost of one value. Default: 1. */
  cost?: (value: V, key: K) => number;
  /** Called for every value that leaves the cache (evicted, replaced, deleted, cleared). */
  onEvict?: (value: V, key: K) => void;
}

interface Slot<V> {
  value: V;
  cost: number;
}

export class LruCache<K, V> {
  // A Map iterates in insertion order; re-inserting on access keeps the most
  // recently used entry last.
  private readonly slots = new Map<K, Slot<V>>();
  private cost = 0;

  constructor(private readonly options: LruOptions<K, V> = {}) {}

  get size(): number {
    return this.slots.size;
  }

  get totalCost(): number {
    return this.cost;
  }

  has(key: K): boolean {
    return this.slots.has(key);
  }

  /** Returns the value and marks it most recently used. */
  get(key: K): V | undefined {
    const slot = this.slots.get(key);
    if (!slot) return undefined;
    this.slots.delete(key);
    this.slots.set(key, slot);
    return slot.value;
  }

  /** Returns the value without touching recency. */
  peek(key: K): V | undefined {
    return this.slots.get(key)?.value;
  }

  /** First entry (most recently used first) matching `predicate`; marks it used. */
  find(predicate: (value: V, key: K) => boolean): { key: K; value: V } | undefined {
    const entries = [...this.slots.entries()];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const [key, slot] = entries[i]!;
      if (predicate(slot.value, key)) {
        this.get(key);
        return { key, value: slot.value };
      }
    }
    return undefined;
  }

  set(key: K, value: V): void {
    const previous = this.slots.get(key);
    if (previous) {
      this.slots.delete(key);
      this.cost -= previous.cost;
      if (previous.value !== value) this.options.onEvict?.(previous.value, key);
    }
    const cost = this.options.cost ? this.options.cost(value, key) : 1;
    this.slots.set(key, { value, cost });
    this.cost += cost;
    this.trim();
  }

  delete(key: K): boolean {
    const slot = this.slots.get(key);
    if (!slot) return false;
    this.slots.delete(key);
    this.cost -= slot.cost;
    this.options.onEvict?.(slot.value, key);
    return true;
  }

  /** Delete every entry whose key matches. */
  deleteWhere(predicate: (key: K, value: V) => boolean): number {
    let removed = 0;
    for (const [key, slot] of [...this.slots.entries()]) {
      if (predicate(key, slot.value)) {
        this.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    const entries = [...this.slots.entries()];
    this.slots.clear();
    this.cost = 0;
    for (const [key, slot] of entries) this.options.onEvict?.(slot.value, key);
  }

  keys(): K[] {
    return [...this.slots.keys()];
  }

  private trim(): void {
    const { maxEntries = Infinity, maxCost = Infinity } = this.options;
    // Keep at least the newest entry even if it alone exceeds the budget: the
    // caller is about to use it.
    while (this.slots.size > 1 && (this.slots.size > maxEntries || this.cost > maxCost)) {
      const oldest = this.slots.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }
}
