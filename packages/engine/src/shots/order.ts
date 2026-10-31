/**
 * An order of shots in which each looks like the one before: the path
 * through a similarity matrix with the largest sum of neighbour
 * similarities (a travelling-salesman path). Greedy nearest neighbour from
 * the first shot, then 2-opt reversals until no reversal helps; with at most
 * 60 shots that is a few milliseconds.
 */

export interface ChainOptions {
  /** Keep shot 0 first (the opener). */
  fixFirst?: boolean;
  /** Keep the last shot last (the payoff). */
  fixLast?: boolean;
}

/** Sum of similarities between neighbours along `order`. */
export function chainScore(sim: readonly (readonly number[])[], order: readonly number[]): number {
  let s = 0;
  for (let i = 1; i < order.length; i += 1) s += sim[order[i - 1]!]![order[i]!]!;
  return s;
}

/** Indices 0..n-1 in chain order. `sim` is symmetric, n × n. */
export function chainOrder(sim: readonly (readonly number[])[], options: ChainOptions = {}): number[] {
  const n = sim.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const last = n - 1;
  const left = new Set(Array.from({ length: n }, (_, i) => i));
  const order: number[] = [];
  const take = (i: number): void => {
    order.push(i);
    left.delete(i);
  };
  if (options.fixLast) left.delete(last);
  if (options.fixFirst) take(0);
  else {
    // Open on the shot least like the rest, so the chain does not strand it in the middle.
    let start = -1;
    let best = Infinity;
    for (const i of left) {
      let s = 0;
      for (const j of left) if (j !== i) s += sim[i]![j]!;
      if (s < best) [best, start] = [s, i];
    }
    take(start);
  }
  while (left.size > 0) {
    const from = order[order.length - 1]!;
    let next = -1;
    let best = -Infinity;
    for (const j of left) if (sim[from]![j]! > best) [best, next] = [sim[from]![j]!, j];
    take(next);
  }
  if (options.fixLast) order.push(last);

  // 2-opt: reverse order[i..j] when that raises the two edges it changes.
  const lo = options.fixFirst ? 1 : 0;
  const hi = options.fixLast ? n - 2 : n - 1;
  const edge = (a: number | undefined, b: number | undefined): number => (a === undefined || b === undefined ? 0 : sim[a]![b]!);
  for (let improved = true, rounds = 0; improved && rounds < 50; rounds += 1) {
    improved = false;
    for (let i = lo; i < hi; i += 1) {
      for (let j = i + 1; j <= hi; j += 1) {
        const before = edge(order[i - 1], order[i]) + edge(order[j], order[j + 1]);
        const after = edge(order[i - 1], order[j]) + edge(order[i], order[j + 1]);
        if (after > before + 1e-9) {
          order.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return order;
}
