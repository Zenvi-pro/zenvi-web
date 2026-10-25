/**
 * CPython `difflib.get_close_matches` (Lib/difflib.py, 3.12), for the
 * "did you mean …" hints of the desktop's editor tools (unknown effect,
 * property or LUT names).
 *
 * `SequenceMatcher(None, a, b)` with autojunk: elements of `b` that occur in
 * more than 1% of it (+1) are "popular" and never start a match once `b` has
 * 200 or more elements. Strings are compared by code point, as in Python.
 */

class SequenceMatcher {
  private readonly a: string[];
  private readonly b: string[];
  private readonly b2j = new Map<string, number[]>();
  private readonly popular = new Set<string>();
  private fullBCount: Map<string, number> | null = null;

  constructor(a: string, b: string) {
    this.a = Array.from(a);
    this.b = Array.from(b);
    // __chain_b
    this.b.forEach((elt, i) => {
      const list = this.b2j.get(elt);
      if (list) list.push(i);
      else this.b2j.set(elt, [i]);
    });
    const n = this.b.length;
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of this.b2j) {
        if (idxs.length > ntest) this.popular.add(elt);
      }
      for (const elt of this.popular) this.b2j.delete(elt);
    }
  }

  private findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
    const { a, b } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i += 1) {
      const newj2len = new Map<number, number>();
      for (const j of this.b2j.get(a[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // No junk function, so bjunk is empty: only the two "non-junk" extension loops can move.
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    return [besti, bestj, bestsize];
  }

  private matches(): number {
    const queue: [number, number, number, number][] = [[0, this.a.length, 0, this.b.length]];
    let total = 0;
    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi);
      if (k) {
        total += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    return total;
  }

  private static calculateRatio(matches: number, length: number): number {
    return length ? (2.0 * matches) / length : 1.0;
  }

  ratio(): number {
    return SequenceMatcher.calculateRatio(this.matches(), this.a.length + this.b.length);
  }

  quickRatio(): number {
    if (!this.fullBCount) {
      this.fullBCount = new Map();
      for (const elt of this.b) this.fullBCount.set(elt, (this.fullBCount.get(elt) ?? 0) + 1);
    }
    const avail = new Map<string, number>();
    let matches = 0;
    for (const elt of this.a) {
      const numb = avail.has(elt) ? avail.get(elt)! : (this.fullBCount.get(elt) ?? 0);
      avail.set(elt, numb - 1);
      if (numb > 0) matches += 1;
    }
    return SequenceMatcher.calculateRatio(matches, this.a.length + this.b.length);
  }

  realQuickRatio(): number {
    const la = this.a.length;
    const lb = this.b.length;
    return SequenceMatcher.calculateRatio(Math.min(la, lb), la + lb);
  }
}

/** Python string order (by code point). */
function compareCodePoints(x: string, y: string): number {
  const a = Array.from(x);
  const b = Array.from(y);
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const d = a[i]!.codePointAt(0)! - b[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** `SequenceMatcher(None, a, b).ratio()`. */
export function sequenceRatio(a: string, b: string): number {
  return new SequenceMatcher(a, b).ratio();
}

/**
 * `difflib.get_close_matches(word, possibilities, n, cutoff)`: the best `n`
 * possibilities scoring at least `cutoff`, best first (ties: the larger
 * string first, as `heapq.nlargest` orders the `(score, x)` tuples).
 */
export function getCloseMatches(word: string, possibilities: Iterable<string>, n = 3, cutoff = 0.6): string[] {
  if (!(n > 0)) throw new RangeError(`n must be > 0: ${n}`);
  if (!(cutoff >= 0 && cutoff <= 1)) throw new RangeError(`cutoff must be in [0.0, 1.0]: ${cutoff}`);
  const result: [number, string][] = [];
  for (const x of possibilities) {
    const s = new SequenceMatcher(x, word);
    if (s.realQuickRatio() >= cutoff && s.quickRatio() >= cutoff) {
      const score = s.ratio();
      if (score >= cutoff) result.push([score, x]);
    }
  }
  result.sort((p, q) => q[0] - p[0] || compareCodePoints(q[1], p[1]));
  return result.slice(0, n).map(([, x]) => x);
}
