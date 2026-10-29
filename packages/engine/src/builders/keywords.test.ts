import { describe, expect, it } from "vitest";
import type { CaptionWord } from "../captions/words.js";
import { planKeywordBroll, punchWords, stem, termsOf } from "./keywords.js";

/** "word@start" tokens, each word 0.3 s long. */
function said(...tokens: string[]): CaptionWord[] {
  return tokens.map((t) => {
    const [text, at] = t.split("@");
    return { text: text!, start: Number(at), end: Number(at) + 0.3 };
  });
}

describe("keyword B-roll", () => {
  it("stems plurals and verb endings so the spoken word meets the file name", () => {
    expect(stem("Rockets,")).toBe("rocket");
    expect(stem("launching")).toBe("launch");
    expect(stem("cities")).toBe("city");
    expect(termsOf("rocket_launch 04", "A rocket lifting off at dawn")).toEqual(expect.arrayContaining(["rocket", "launch", "lift", "dawn"]));
  });

  it("cuts to the picture a word names, holds to the phrase's end, keeps the opening and the gaps", () => {
    const words = said("our@0", "rocket@0.4", "story@0.8", "starts@3", "with@3.4", "the@3.7", "ocean@4", "and@4.4", "a@4.7", "city@5", "of@8", "rockets@11");
    const media = [
      { fileId: "R", terms: termsOf("rocket") },
      { fileId: "O", terms: termsOf("ocean waves") },
      { fileId: "C", terms: termsOf("city night") },
    ];
    const hits = planKeywordBroll(words, media, [], { until: 12 });
    // rocket@0.4 is the hook (before 2 s); city (before a pause) is stronger than ocean, which is too close to it; rockets@11 is R's first use after the opening.
    expect(hits.map((h) => [h.text, h.fileId])).toEqual([
      ["city", "C"],
      ["rockets", "R"],
    ]);
    // "city" ends its phrase: the cutaway holds the shortest a cutaway reads.
    expect(hits[0]!.start).toBe(5);
    expect(hits[0]!.end).toBeCloseTo(6.4, 5);
    // Without city's picture, ocean's cutaway holds to its phrase's end ("ocean and a city").
    const ocean = planKeywordBroll(words, media.slice(0, 2), [], { until: 12, minHold: 1 })[0]!;
    expect([ocean.text, ocean.start, ocean.end]).toEqual(["ocean", 4, 5.3]);
  });

  it("a named keyword takes the picture it was given, wherever it matches nothing", () => {
    const words = said("we@0", "built@3", "everything@3.4", "here@6");
    const hits = planKeywordBroll(words, [], [{ word: "everything", fileId: "X" }], { until: 10 });
    expect(hits).toMatchObject([{ text: "everything", fileId: "X", source: "named" }]);
  });

  it("punches in on numbers and stressed words, at least the spacing apart", () => {
    const words = said("we@0", "grew@1.2", "300%@1.6", "in@2", "one@2.3", "MONTH@2.6", "and@7", "doubled@7.4");
    const picked = punchWords(words, 4).map((i) => words[i]!.text);
    expect(picked).toContain("300%");
    expect(picked).not.toContain("MONTH");
  });
});
