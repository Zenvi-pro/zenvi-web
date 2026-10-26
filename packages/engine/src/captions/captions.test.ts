import { beforeAll, describe, expect, it } from "vitest";
import { layoutOf } from "../motion/layout.js";
import { FONT_FAMILY_IDS } from "../typography/families.js";
import { FontLibrary } from "../typography/library.js";
import { readBundledFont } from "../typography/test-fonts.js";
import type { Box } from "../typography/typeset.js";
import { buildKineticCaptions, type AvoidBox } from "./build.js";
import { CAPTION_STYLE_IDS, CAPTION_STYLES } from "./styles.js";
import { emphasisScores, groupWords, pickEmphasis, type CaptionWord } from "./words.js";

/** Words at a steady pace (0.3 s each, gaps of 0.02 s) from `at`, a longer pause after sentences. */
function spoken(text: string, at = 0.5): CaptionWord[] {
  let t = at;
  return text.split(" ").map((word) => {
    const w = { text: word, start: t, end: t + 0.28 };
    t += /[.!?]$/.test(word) ? 0.8 : 0.3;
    return w;
  });
}

const SCRIPT = "Most people edit for hours. But the secret is simple: cut on every word, keep it under 10 seconds and make one idea feel huge. That's how you stop the scroll.";
const RULES = { maxWords: 4, maxChars: 26, maxGap: 0.45, tail: 0.35, minHold: 0.5 };
const texts = (words: readonly CaptionWord[], groups: { first: number; end: number }[]) => groups.map((g) => words.slice(g.first, g.end).map((w) => w.text).join(" "));

let lib: FontLibrary;
beforeAll(async () => {
  lib = await FontLibrary.load(readBundledFont, FONT_FAMILY_IDS);
});

describe("groupWords", () => {
  it("breaks at sentences, clauses, openers, pauses and the size limits, without orphans", () => {
    const words = spoken(SCRIPT);
    const groups = groupWords(words, RULES);
    expect(texts(words, groups)).toEqual([
      "Most people edit for hours.",
      "But the secret is simple:",
      "cut on every word,",
      "keep it under 10 seconds",
      "and make one idea",
      "feel huge.",
      "That's how you stop",
      "the scroll.",
    ]);
    for (const g of groups) expect(g.end - g.first).toBeLessThanOrEqual(RULES.maxWords + 1);
    const paused = [...spoken("one two"), ...spoken("three four", 2)];
    expect(texts(paused, groupWords(paused, RULES))).toEqual(["one two", "three four"]);
  });

  it("shows a group until the next one starts, or its tail; never shorter than minHold", () => {
    const words = spoken("Hello there. Bye.");
    const groups = groupWords(words, RULES);
    expect(groups[0]!.stop).toBeCloseTo(words[1]!.end + RULES.tail, 6);
    expect(groups[1]!.stop).toBeCloseTo(words[2]!.end + RULES.tail, 6);
    const close = [{ text: "one", start: 0, end: 0.3 }, { text: "two.", start: 0.3, end: 0.5 }, { text: "three", start: 0.6, end: 0.9 }];
    expect(groupWords(close, RULES)[0]!.stop).toBeCloseTo(0.6, 6);
    const quick = groupWords([{ text: "Hi", start: 1, end: 1.05 }], RULES);
    expect(quick[0]!.stop).toBeCloseTo(1.5, 6);
  });
});

describe("emphasis", () => {
  it("prefers numbers and stressed content words, never stopwords", () => {
    const words = spoken("we made 3 million dollars and the team loved it");
    const scores = emphasisScores(words);
    const byWord = Object.fromEntries(words.map((w, i) => [w.text, scores[i]]));
    expect(byWord["3"]).toBeGreaterThan(byWord["dollars"]!);
    expect(byWord["million"]).toBeGreaterThanOrEqual(3);
    for (const stop of ["we", "and", "the", "it"]) expect(byWord[stop]).toBe(0);
    // A word held long is stressed.
    const held = [...spoken("this is so")].concat([{ text: "good", start: 1.4, end: 2.4 }]);
    const s = emphasisScores(held);
    expect(s[3]).toBeGreaterThan(emphasisScores(spoken("this is so good"))[3]!);
  });

  it("auto takes each group's best word above the floor; a list or none overrides", () => {
    const words = spoken(SCRIPT);
    const groups = groupWords(words, RULES);
    const auto = pickEmphasis(words, groups, "auto", 1);
    const picked = [...auto].map((i) => words[i]!.text);
    expect(picked).toContain("10");
    expect(picked.every((w) => !["the", "is", "and", "for", "on", "you"].includes(w))).toBe(true);
    for (const g of groups) expect([...auto].filter((i) => i >= g.first && i < g.end).length).toBeLessThanOrEqual(1);
    expect([...pickEmphasis(words, groups, ["SECRET", "scroll"], 1)].map((i) => words[i]!.text)).toEqual(["secret", "scroll."]);
    expect(pickEmphasis(words, groups, "none", 1).size).toBe(0);
    // A phrase in the list emphasises each of its words.
    expect([...pickEmphasis(words, groups, ["secret is"], 1)].map((i) => words[i]!.text)).toEqual(["secret", "is"]);
  });
});

const VERTICAL = { width: 1080, height: 1920, fps: 30 };
const WIDE = { width: 1920, height: 1080, fps: 25 };
const FACE: AvoidBox = { x: 0.5, y: 0.32, w: 0.36, h: 0.3 };

function inside(b: Box, s: { left: number; top: number; right: number; bottom: number }): boolean {
  return b.x >= s.left - 1 && b.y >= s.top - 1 && b.x + b.width <= s.right + 1 && b.y + b.height <= s.bottom + 1;
}

function hits(b: Box, a: AvoidBox, frame: { width: number; height: number }): boolean {
  const ax = (a.x - a.w / 2) * frame.width;
  const ay = (a.y - a.h / 2) * frame.height;
  return b.x < ax + a.w * frame.width && b.x + b.width > ax && b.y < ay + a.h * frame.height && b.y + b.height > ay;
}

describe("buildKineticCaptions", () => {
  for (const style of CAPTION_STYLE_IDS) {
    for (const frame of [VERTICAL, WIDE]) {
      it(`${style} at ${frame.width}x${frame.height}: in the safe area, off the face, on the word times`, () => {
        const words = spoken(SCRIPT);
        const built = buildKineticCaptions({ frame, words, style, emphasis: "auto", avoid: [FACE], lib });
        const { safe } = layoutOf(frame);
        expect(built.groups.length).toBeGreaterThan(3);
        for (const g of built.groups) {
          for (const w of g.words) {
            expect(inside(w.box, safe), `${style} ${w.text}`).toBe(true);
            expect(hits(w.box, FACE, frame), `${style} ${w.text} on the face`).toBe(false);
          }
        }
        // Every word clip starts within a frame of its word (word-by-word styles) and groups never overlap.
        const f0 = Math.round(built.start * frame.fps);
        const all = built.groups.flatMap((g) => g.words);
        expect(all.map((w) => w.text.toLowerCase().replace(/[^\w']/g, ""))).toEqual(words.map((w) => w.text.toLowerCase().replace(/[^\w']/g, "")));
        if (CAPTION_STYLES[style].reveal === "word") {
          for (const layer of built.plan.layers) {
            const [, g, j] = /^g(\d+)w(\d+)$/.exec(layer.name)!.map(Number);
            const word = words[built.groups.slice(0, g).reduce((n, x) => n + x.words.length, 0) + j!]!;
            expect(Math.abs(f0 + layer.start - word.start * frame.fps), `${layer.name}`).toBeLessThanOrEqual(1);
          }
        }
        for (let i = 1; i < built.groups.length; i += 1) expect(built.groups[i]!.start).toBeGreaterThanOrEqual(built.groups[i - 1]!.stop - 1e-9);
        // Each drawing is outlined type: paths, no <text>.
        for (const layer of built.plan.layers) {
          if (layer.source.kind !== "svg") continue;
          expect(layer.source.svg).toContain("<path");
          expect(layer.source.svg).not.toContain("<text");
        }
      });
    }
  }

  it("creator sets emphasis words far larger than connectors, in the accent", () => {
    const built = buildKineticCaptions({ frame: VERTICAL, words: spoken("we made 3 million dollars"), style: "creator", emphasis: "auto", avoid: [], lib });
    const words = built.groups.flatMap((g) => g.words);
    const big = words.filter((w) => w.emphasis);
    const small = words.filter((w) => !w.emphasis);
    expect(big.length).toBeGreaterThan(0);
    expect(Math.min(...big.map((w) => w.box.height))).toBeGreaterThan(2.5 * Math.max(...small.map((w) => w.box.height)));
    const svg = built.plan.layers.find((l) => l.source.kind === "svg" && l.source.svg.includes("#ff2d2d"));
    expect(svg).toBeDefined();
  });

  it("split puts the halves either side of the subject", () => {
    const built = buildKineticCaptions({ frame: VERTICAL, words: spoken("left right up down"), style: "split", emphasis: "auto", avoid: [FACE], lib });
    const faceLeft = (FACE.x - FACE.w / 2) * VERTICAL.width;
    const faceRight = (FACE.x + FACE.w / 2) * VERTICAL.width;
    for (const g of built.groups) {
      expect(g.words[0]!.box.x + g.words[0]!.box.width).toBeLessThanOrEqual(faceLeft);
      if (g.words[1]) expect(g.words[1].box.x).toBeGreaterThanOrEqual(faceRight);
    }
  });

  it("karaoke moves one marker through the words of each line, in order", () => {
    const built = buildKineticCaptions({ frame: VERTICAL, words: spoken("one two three four five six"), style: "karaoke", emphasis: "auto", avoid: [], lib });
    const markers = built.plan.layers.filter((l) => /m\d+$/.test(l.name));
    expect(markers).toHaveLength(6);
    for (let i = 1; i < markers.length; i += 1) expect(markers[i]!.start).toBeGreaterThanOrEqual(markers[i - 1]!.start + markers[i - 1]!.frames);
    expect(new Set(markers.map((m) => m.track)).size).toBe(1);
  });

  it("keeps clear of several boxes, setting the type smaller when it must", () => {
    const avoid: AvoidBox[] = [FACE, { x: 0.5, y: 0.7, w: 0.9, h: 0.2 }];
    const built = buildKineticCaptions({ frame: VERTICAL, words: spoken(SCRIPT), style: "documentary", emphasis: "auto", avoid, lib });
    for (const g of built.groups) for (const a of avoid) expect(hits(g.box, a, VERTICAL)).toBe(false);
  });
});
