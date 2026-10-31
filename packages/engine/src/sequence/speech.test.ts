import { describe, expect, it } from "vitest";
import { findSpoken, spokenTokens } from "./speech.js";

const words = "So here is the thing nobody tells you about editing: the cut is where the story happens."
  .split(" ")
  .map((text, k) => ({ text, startSec: k * 0.4, endSec: k * 0.4 + 0.35 }));

describe("findSpoken", () => {
  it("finds a caption's words in the voice and returns where they are said", () => {
    const found = findSpoken(words, "NOBODY TELLS YOU");
    expect(found).toEqual({ start: 2, end: expect.closeTo(3.15) as number, score: 1 });
  });

  it("tolerates a missing or misheard word", () => {
    const found = findSpoken(words, "the cut is where the stories happen");
    expect(found?.start).toBeCloseTo(4);
    expect(found!.score).toBeGreaterThanOrEqual(0.6);
  });

  it("returns null when the line is not in the voice", () => {
    expect(findSpoken(words, "buy now and save twenty percent")).toBeNull();
    expect(findSpoken([], "anything")).toBeNull();
  });

  it("drops punctuation and case", () => {
    expect(spokenTokens("Editing: the CUT, isn't it?")).toEqual(["editing", "the", "cut", "isn't", "it"]);
  });
});
