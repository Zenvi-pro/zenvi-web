/**
 * Shot embeddings: unit vectors from an image–text model (SigLIP), one per
 * keyframe of a file. Two frames look alike when their vectors point the
 * same way (cosine near 1); a text query matches the frames whose vectors
 * point its way. Pure math, no model: hosts compute the vectors.
 */

export type Vector = Float32Array;

export function dot(a: Vector, b: Vector): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!;
  return s;
}

/** `v` scaled to length 1 (a copy); the zero vector stays zero. */
export function normalize(v: ArrayLike<number>): Vector {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) s += v[i]! * v[i]!;
  const k = s > 0 ? 1 / Math.sqrt(s) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = v[i]! * k;
  return out;
}

/** Direction of the mean of unit vectors: what a run of frames shows overall. */
export function meanDirection(vectors: readonly Vector[]): Vector {
  if (vectors.length === 0) throw new Error("meanDirection of no vectors");
  const sum = new Float32Array(vectors[0]!.length);
  for (const v of vectors) for (let i = 0; i < sum.length; i += 1) sum[i]! += v[i]!;
  return normalize(sum);
}

/** Cosine of two unit vectors, clamped to [-1, 1]. */
export function cosine(a: Vector, b: Vector): number {
  return Math.max(-1, Math.min(1, dot(a, b)));
}

/**
 * SigLIP's image–text head: the chance that a frame shows the text,
 * sigmoid(cosine × scale + bias). Image–image cosines have no such head;
 * they are compared to `NEAR_DUPLICATE`.
 */
export function matchProbability(cos: number, head: { logitScale: number; logitBias: number }): number {
  return 1 / (1 + Math.exp(-(cos * head.logitScale + head.logitBias)));
}

/**
 * Two shots at or above this cosine read as the same shot: the same take a
 * moment later, or the same set-up from almost the same place. SigLIP base
 * on the re-edit bench (47 edits, 678 cuts, the editors' own shot order):
 * keyframes 0.5 s apart in one shot sit at 0.96 (median); editors cut
 * between shots this alike 5 % of the time (0.9 would flag 19 % of their
 * cuts, mostly new angles on one scene in hype and fitness edits).
 */
export const NEAR_DUPLICATE = 0.95;
