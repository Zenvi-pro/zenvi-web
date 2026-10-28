import { describe, expect, it } from "vitest";
import { alignText, wordKey } from "./align.js";
import type { TimedText } from "./transcription.js";

const heard = (items: [string, number, number][]): TimedText[] => items.map(([text, startSec, endSec]) => ({ text, startSec, endSec }));

describe("alignText", () => {
  it("gives each word of the text the time of the word heard for it, keeping the text's spelling", () => {
    const got = alignText("Hello, Zenvi!\nEdit with taste.", heard([["hello", 0.5, 0.9], ["zenvie", 1.0, 1.5], ["edit", 2.0, 2.3], ["with", 2.3, 2.5], ["taste", 2.5, 3.0]]));
    expect(got.words.map((w) => [w.text, w.startSec, w.endSec, w.line, w.heard])).toEqual([
      ["Hello,", 0.5, 0.9, 0, true],
      ["Zenvi!", 1.0, 1.5, 0, true],
      ["Edit", 2.0, 2.3, 1, true],
      ["with", 2.3, 2.5, 1, true],
      ["taste.", 2.5, 3.0, 1, true],
    ]);
    expect(got.lines.map((l) => [l.text, l.startSec, l.endSec])).toEqual([
      ["Hello, Zenvi!", 0.5, 1.5],
      ["Edit with taste.", 2.0, 3.0],
    ]);
    expect(got.heardRatio).toBe(1);
  });

  it("spreads words recognition misheard over the heard words between their matched neighbours", () => {
    // The famous mondegreen: "the sky" heard as "this guy" shares its time.
    const got = alignText("kiss the sky tonight", heard([["kiss", 0, 0.3], ["this", 0.4, 0.6], ["guy", 0.6, 1.0], ["tonight", 1.1, 1.6]]));
    const the = got.words[1]!;
    const sky = got.words[2]!;
    expect(the.heard).toBe(false);
    expect(the.startSec).toBe(0.4);
    expect(sky.endSec).toBe(1);
    expect(the.endSec).toBe(sky.startSec);
    expect(got.heardRatio).toBe(0.5);
  });

  it("puts an unheard line just before the next heard word, not across an instrumental break", () => {
    const got = alignText("first line here\nsecond line\nthird line", heard([["first", 1, 1.3], ["line", 1.3, 1.6], ["here", 1.6, 2], ["third", 20, 20.4], ["line", 20.4, 20.8]]));
    const second = got.lines[1]!;
    expect(second.endSec).toBe(20);
    expect(second.startSec).toBeGreaterThan(18.5);
    expect(got.lines[2]!.startSec).toBe(20);
  });

  it("keeps the order: a repeated word matches the occurrence in sequence", () => {
    const got = alignText("la la la stop", heard([["la", 0, 0.2], ["la", 0.3, 0.5], ["la", 0.6, 0.8], ["stop", 2, 2.4]]));
    expect(got.words.map((w) => w.startSec)).toEqual([0, 0.3, 0.6, 2]);
  });

  it("times every word within the range when nothing was heard", () => {
    const got = alignText("nothing heard at all", [], { start: 5, end: 6 });
    expect(got.heardRatio).toBe(0);
    expect(got.words[0]!.startSec).toBe(5);
    expect(got.words.at(-1)!.endSec).toBeLessThanOrEqual(6);
  });

  it("aligns long texts in a band without losing the matches", () => {
    const n = 1500;
    const words = Array.from({ length: n }, (_, i) => `w${i}`);
    const got = alignText(words.join(" "), heard(words.map((w, i) => [w, i * 0.4, i * 0.4 + 0.3])));
    expect(got.heardRatio).toBe(1);
    expect(got.words[n - 1]!.startSec).toBeCloseTo((n - 1) * 0.4, 3);
  });

  it("compares letters and digits, folding case and accents", () => {
    expect(wordKey("Café!")).toBe("cafe");
    expect(wordKey("—")).toBe("");
  });
});
