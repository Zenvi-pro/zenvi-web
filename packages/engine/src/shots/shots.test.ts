import { describe, expect, it } from "vitest";
import { findMoments } from "./moments.js";
import { chainOrder, chainScore } from "./order.js";
import { canonicalText, siglipPixels, siglipTokenize, unigramEncode, unigramVocab } from "./siglip.js";
import { cosine, matchProbability, meanDirection, normalize } from "./vectors.js";

describe("shot vectors", () => {
  it("normalise, average directions and read SigLIP's head", () => {
    const a = normalize([3, 4]);
    expect(Array.from(a)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6)]);
    expect(Array.from(normalize([0, 0]))).toEqual([0, 0]);
    const mid = meanDirection([normalize([1, 0]), normalize([0, 1])]);
    expect(cosine(mid, normalize([1, 1]))).toBeCloseTo(1, 6);
    // SigLIP base: a cosine of 0.11 is an even chance.
    expect(matchProbability(12.93 / 117.33, { logitScale: 117.33, logitBias: -12.93 })).toBeCloseTo(0.5, 6);
  });
});

describe("findMoments", () => {
  const times = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];

  it("grows a moment around each peak while scores stay near it, best first, never overlapping", () => {
    const scores = [0.01, 0.02, 0.1, 0.105, 0.098, 0.03, 0.08, 0.02];
    const moments = findMoments(times, scores, { interval: 0.5, duration: 3.8, drop: 0.012, max: 3 });
    expect(moments[0]).toEqual({ start: 0.75, end: 2.25, peak: 1.5, score: 0.105 });
    expect(moments[1]).toEqual({ start: 2.75, end: 3.25, peak: 3, score: 0.08 });
    expect(moments[2]).toEqual({ start: 2.25, end: 2.75, peak: 2.5, score: 0.03 });
    expect(moments.every((m, i) => moments.every((n, j) => i === j || m.end <= n.start || n.end <= m.start))).toBe(true);
  });

  it("stops at the file's end and at max", () => {
    const moments = findMoments(times, [0, 0, 0, 0, 0, 0, 0, 0.5], { interval: 0.5, duration: 3.6, drop: 0.01, max: 1 });
    expect(moments).toEqual([{ start: 3.25, end: 3.6, peak: 3.5, score: 0.5 }]);
    expect(findMoments([0], [0.2], { interval: 0, duration: 0, drop: 0.01, max: 2 })).toEqual([{ start: 0, end: 0, peak: 0, score: 0.2 }]);
  });
});

describe("chainOrder", () => {
  /** Shots at positions on a line: neighbours on the line look alike. */
  const line = (xs: number[]): number[][] => xs.map((a) => xs.map((b) => 1 - Math.abs(a - b)));

  it("orders shots so each looks like the one before", () => {
    const xs = [0, 0.7, 0.2, 0.9, 0.4, 0.55, 0.1];
    const sim = line(xs);
    const order = chainOrder(sim, { fixFirst: true });
    expect(order[0]).toBe(0);
    expect(order.map((i) => xs[i])).toEqual([0, 0.1, 0.2, 0.4, 0.55, 0.7, 0.9]);
    expect(chainScore(sim, order)).toBeGreaterThan(chainScore(sim, xs.map((_, i) => i)));
  });

  it("keeps the opener and the payoff in place when asked", () => {
    const xs = [0.5, 0.1, 0.9, 0.2, 0.8, 0.45];
    const order = chainOrder(line(xs), { fixFirst: true, fixLast: true });
    expect(order[0]).toBe(0);
    expect(order[order.length - 1]).toBe(5);
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("opens on an end of the chain when the opener is free", () => {
    const xs = [0.5, 0, 1, 0.25, 0.75];
    const order = chainOrder(line(xs));
    expect(order.map((i) => xs[i])).toEqual(expect.arrayContaining([0, 0.25, 0.5, 0.75, 1]));
    expect([xs[order[0]!], xs[order[4]!]].sort()).toEqual([0, 1]);
  });
});

describe("SigLIP inputs", () => {
  // A tiny Unigram vocabulary in tokenizer.json's shape.
  const vocab = unigramVocab({
    model: {
      type: "Unigram",
      unk_id: 2,
      vocab: [["<pad>", 0], ["</s>", 0], ["<unk>", 0], ["▁", -2], ["▁a", -3], ["cat", -4], ["▁cat", -3.5], ["c", -6], ["a", -6], ["t", -6], ["▁the", -3]],
    },
  });

  it("canonicalises text like SiglipTokenizer: NFKC, lower case, no punctuation, single spaces", () => {
    expect(canonicalText("  A Close-up,  of HANDS!  ")).toBe("a closeup of hands");
    expect(canonicalText("ﬁne")).toBe("fine");
  });

  it("segments with the best-scoring pieces and fuses unknown characters", () => {
    expect(unigramEncode("▁cat", vocab)).toEqual([6]);
    expect(unigramEncode("▁acat", vocab)).toEqual([4, 5]);
    expect(unigramEncode("▁xyzcat", vocab)).toEqual([3, 2, 5]);
  });

  it("ends with </s> and pads with it to the model's length", () => {
    const ids = siglipTokenize("A cat.", vocab, 8);
    expect(ids).toEqual([4, 6, 1, 1, 1, 1, 1, 1]);
    expect(siglipTokenize("", vocab, 3)).toEqual([1, 1, 1]);
    expect(siglipTokenize("a a a a a a a a", vocab, 4)).toEqual([4, 4, 4, 1]);
  });

  it("refuses a tokenizer that is not Unigram", () => {
    expect(() => unigramVocab({ model: { type: "BPE", vocab: {} } })).toThrow(/Unigram/);
  });

  it("scales pixels to [-1, 1], planar RGB", () => {
    expect(() => siglipPixels(new Uint8Array(6), new Float32Array(6), 0, 1)).toThrow(/expected 3/);
    const two = new Float32Array(6);
    siglipPixels(new Uint8Array([0, 255, 51]), two, 3, 1);
    expect(Array.from(two)).toEqual([0, 0, 0, -1, 1, expect.closeTo(-0.6, 6)]);
  });
});
