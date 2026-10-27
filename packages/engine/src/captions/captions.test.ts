import { beforeAll, describe, expect, it } from "vitest";
import { FONT_FAMILY_IDS } from "../typography/families.js";
import { FontLibrary } from "../typography/library.js";
import { readBundledFont } from "../typography/test-fonts.js";
import type { Box } from "../typography/typeset.js";
import { buildKineticCaptions, captionSafe, scrambled, type AvoidBox } from "./build.js";
import type { CaptionScene, CostGrid } from "./space.js";
import { CAPTION_ANIMATION_IDS, CAPTION_ANIMATIONS, CAPTION_STYLE_IDS, CAPTION_STYLES } from "./styles.js";
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

  it("holds a group until the next one while the speaker goes on: no blank frames between phrases", () => {
    // Sentences 0.52 s apart: no gap on screen. A real pause (1 s): the group leaves after its tail.
    const words = spoken("One idea. Two words. Then");
    const groups = groupWords(words, RULES);
    expect(groups.length).toBe(3);
    expect(groups[0]!.stop).toBeCloseTo(groups[1]!.start, 9);
    expect(groups[1]!.stop).toBeCloseTo(groups[2]!.start, 9);
    const paused = [...spoken("Done here."), ...spoken("Later on", 3)];
    const g = groupWords(paused, RULES);
    expect(g[0]!.stop).toBeCloseTo(paused[1]!.end + RULES.tail, 9);
    expect(g[1]!.start - g[0]!.stop).toBeGreaterThan(0.6);
  });

  it("shows a group until the next one starts, or its tail; never shorter than minHold", () => {
    const words = [...spoken("Hello there."), ...spoken("Bye.", 2.5)];
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
      it(`${style} at ${frame.width}x${frame.height}: in the platform/title-safe area, off the face, on the word times, no gaps`, () => {
        const words = spoken(SCRIPT);
        const built = buildKineticCaptions({ frame, words, style, emphasis: "auto", avoid: [FACE], lib });
        const safe = captionSafe(frame);
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
        // The script never pauses longer than HOLD_GAP: each group hands over to the next on the same frame.
        for (let i = 1; i < built.groups.length; i += 1) expect(built.groups[i]!.start).toBeCloseTo(built.groups[i - 1]!.stop, 9);
        for (const g of built.groups) expect(inside(g.box, safe), `${style} group ${g.text}`).toBe(true);
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

/** Points of a keyframe property of a layer. */
const pointsOf = (props: Record<string, unknown>, key: string): { co: { X: number; Y: number }; interpolation: number }[] => (props[key] as { Points: { co: { X: number; Y: number }; interpolation: number }[] }).Points;

describe("caption animations", () => {
  const words = () => spoken("we made 3 million dollars in one year");
  const build = (animation: (typeof CAPTION_ANIMATION_IDS)[number], extra: Partial<Parameters<typeof buildKineticCaptions>[0]> = {}) =>
    buildKineticCaptions({ frame: VERTICAL, words: words(), style: "creator", emphasis: ["million"], avoid: [], motion: CAPTION_ANIMATIONS[animation].motion, lib, ...extra });

  it("every preset builds a plan whose words appear on their times", () => {
    for (const id of CAPTION_ANIMATION_IDS) {
      const built = build(id);
      const first = built.groups[0]!;
      expect(first.words.map((w) => w.text), id).toEqual(["we", "made", "3", "million"]);
      expect(built.plan.layers.length, id).toBeGreaterThanOrEqual(words().length);
    }
  });

  it("tilt swings words in and leaves emphasis words turned, alternating sides", () => {
    const built = build("tilt");
    const word = (name: string) => built.plan.layers.find((l) => l.name === name)!;
    const emphasis = built.plan.layers.find((l) => l.source.kind === "svg" && l.source.svg.includes("#ff2d2d"))!;
    const turns = pointsOf(emphasis.props, "rotation").map((p) => p.co.Y);
    expect(Math.abs(turns[0]!)).toBeCloseTo(18, 6);
    expect(Math.abs(turns[turns.length - 1]!)).toBeCloseTo(7, 6);
    const connector = pointsOf(word("g0w0").props, "rotation").map((p) => p.co.Y);
    expect(Math.abs(connector[0]!)).toBeCloseTo(9, 6);
    expect(connector[connector.length - 1]).toBe(0);
    expect(Math.sign(pointsOf(word("g0w0").props, "rotation")[0]!.co.Y)).not.toBe(Math.sign(pointsOf(word("g0w1").props, "rotation")[0]!.co.Y));
  });

  it("typewriter types each word with a stepping Crop, one clip a word, no fade", () => {
    const built = build("typewriter");
    expect(built.plan.layers).toHaveLength(words().length);
    // One-letter words ("3") just appear.
    for (const layer of built.plan.layers.filter((l) => l.name !== "g0w2")) {
      const crop = layer.effects.find((e) => e.type === "Crop")!;
      const right = (crop.right as { Points: { co: { X: number; Y: number }; interpolation: number }[] }).Points;
      expect(right.every((p) => p.interpolation === 2), layer.name).toBe(true);
      expect(right.at(-1)!.co.Y).toBe(0);
      for (let i = 1; i < right.length; i += 1) {
        expect(right[i]!.co.X).toBeGreaterThan(right[i - 1]!.co.X);
        expect(right[i]!.co.Y).toBeLessThan(right[i - 1]!.co.Y);
      }
      // No fade: alpha is not keyed (1 throughout).
      expect(layer.props.alpha === undefined || pointsOf(layer.props, "alpha").every((p) => p.co.Y === 1)).toBe(true);
    }
  });

  it("scramble decodes the emphasis word through random drawings on its track; connectors pop", () => {
    const built = build("scramble");
    const million = built.groups.flatMap((g) => g.words).findIndex((w) => w.text === "million");
    expect(million).toBeGreaterThan(-1);
    const steps = built.plan.layers.filter((l) => /w\d+s\d+$/.test(l.name));
    // Up to 4 steps of 2 frames, fewer when the word is on screen briefly.
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.length).toBeLessThanOrEqual(4);
    const word = built.plan.layers.find((l) => l.name === steps[0]!.name.replace(/s0$/, ""))!;
    expect(new Set([...steps, word].map((l) => l.track)).size).toBe(1);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]!.start).toBe(steps[i - 1]!.start + steps[i - 1]!.frames);
    expect(word.start).toBe(steps.at(-1)!.start + steps.at(-1)!.frames);
    expect(built.plan.layers.length).toBe(words().length + steps.length);
    // Letters resolve from the left; the kind of each character is kept.
    const next = () => 0.5;
    expect(scrambled("MILLION", 3, next)).toMatch(/^MIL[A-Z]{4}$/);
    expect(scrambled("491GB", 0, next)).toMatch(/^\d{3}[A-Z]{2}$/);
  });

  it("letters gives each letter of the emphasis word its own clip and track, staggered", () => {
    const built = build("letters");
    const letters = built.plan.layers.filter((l) => /l\d+$/.test(l.name));
    expect(letters).toHaveLength("MILLION".length);
    expect(new Set(letters.map((l) => l.track)).size).toBe(letters.length);
    for (let i = 1; i < letters.length; i += 1) expect(letters[i]!.start).toBeGreaterThan(letters[i - 1]!.start);
    // Every letter of a title moves (letterWords all): one clip per letter of every word.
    const title = buildKineticCaptions({ frame: VERTICAL, words: spoken("no brakes"), style: "stack", emphasis: "none", avoid: [], motion: CAPTION_ANIMATIONS.letters.motion, letterWords: "all", groups: [{ first: 0, end: 2, start: 0.5, stop: 2.5 }], lib });
    expect(title.plan.layers).toHaveLength("nobrakes".length);
    expect(title.groups).toHaveLength(1);
  });
});

describe("placement over the shots", () => {
  const HEAD: AvoidBox = { x: 0.5, y: 0.42, w: 0.24, h: 0.16 };
  /** A grid over the vertical frame, cost 1 except where `calm` (frame shares) is 0. */
  function grid(calm: (x: number, y: number) => boolean): CostGrid {
    const cols = 9;
    const rows = 16;
    return { cols, rows, cells: Array.from({ length: cols * rows }, (_, k) => (calm(((k % cols) + 0.5) / cols, (Math.floor(k / cols) + 0.5) / rows) ? 0 : 1)) };
  }

  it("keeps off the shot's head and takes the calm spot over the preferred one", () => {
    const words = spoken("plain words on screen now");
    const plain = buildKineticCaptions({ frame: VERTICAL, words, style: "documentary", emphasis: "none", avoid: [], lib });
    // The style's first spot (low) is busy, its second (high) calm.
    const scene: CaptionScene = { from: 0, to: 10, head: HEAD, cost: grid((_, y) => y < 0.5) };
    const moved = buildKineticCaptions({ frame: VERTICAL, words, style: "documentary", emphasis: "none", avoid: [], scenes: [scene], lib });
    expect(plain.groups[0]!.box.y).toBeGreaterThan(VERTICAL.height / 2);
    for (const g of moved.groups) {
      expect(g.box.y + g.box.height).toBeLessThan(VERTICAL.height / 2);
      expect(hits(g.box, HEAD, VERTICAL)).toBe(false);
    }
  });

  it("keeps clear of where a moving head goes while the group shows", () => {
    const words = spoken("one two three");
    const scenes: CaptionScene[] = [
      { from: 0, to: 0.8, head: { x: 0.3, y: 0.66, w: 0.2, h: 0.14 } },
      { from: 0.8, to: 5, head: { x: 0.7, y: 0.66, w: 0.2, h: 0.14 } },
    ];
    const built = buildKineticCaptions({ frame: VERTICAL, words, style: "documentary", emphasis: "none", avoid: [], scenes, lib });
    for (const s of scenes) expect(hits(built.groups[0]!.box, s.head!, VERTICAL)).toBe(false);
  });

  it("puts emphasis words behind the head, under the cut-out, and the rest in front, clear of both", () => {
    const words = spoken("we made 3 million dollars");
    const built = buildKineticCaptions({ frame: WIDE, words, style: "creator", emphasis: ["million"], avoid: [], behind: "emphasis", scenes: [{ from: 0, to: 10, head: { x: 0.5, y: 0.45, w: 0.12, h: 0.22 } }], lib });
    expect(built.under).toBe(1);
    const million = built.groups.flatMap((g) => g.words).find((w) => w.text === "million")!;
    const headTop = (0.45 - 0.11) * WIDE.height;
    // The head hides the word's lower part: it ends below the head's top, starts above it.
    expect(million.box.y).toBeLessThan(headTop);
    expect(million.box.y + million.box.height).toBeGreaterThan(headTop);
    const underTracks = built.plan.layers.filter((l) => l.track < built.under);
    expect(underTracks.length).toBeGreaterThan(0);
    expect(underTracks.every((l) => l.source.kind === "svg" && l.source.svg.includes("#ff2d2d"))).toBe(true);
    const group = built.groups.find((g) => g.words.some((w) => w.text === "million"))!;
    for (const w of group.words.filter((x) => !x.emphasis)) expect(hits(w.box, { x: 0.5, y: 0.45, w: 0.12, h: 0.22 }, WIDE)).toBe(false);
  });

  it("keeps an emphasis word in front when the subject would hide too much of it", () => {
    // The subject covers the whole frame's top half: nothing to read behind it.
    const subject: CostGrid = { cols: 16, rows: 9, cells: Array.from({ length: 144 }, (_, k) => (Math.floor(k / 16) < 5 ? 1 : 0)) };
    const built = buildKineticCaptions({ frame: WIDE, words: spoken("we made 3 million dollars"), style: "creator", emphasis: ["million"], avoid: [], behind: "emphasis", scenes: [{ from: 0, to: 10, head: { x: 0.5, y: 0.45, w: 0.12, h: 0.22 }, subject }], lib });
    expect(built.under).toBe(0);
  });
});
