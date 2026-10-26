import { describe, expect, it } from "vitest";
import { tokenizeLine, typeSeconds, typeTimes } from "./syntax.js";

const kinds = (line: string, lang: Parameters<typeof tokenizeLine>[1] = "ts"): string =>
  tokenizeLine(line, lang)
    .filter((t) => t.text.trim())
    .map((t) => `${t.kind}:${t.text.trim()}`)
    .join(" ");

describe("code_card syntax", () => {
  it("colours keywords, strings, numbers, calls, types and comments", () => {
    expect(kinds('const teaser = await cut("a.mov", { length: 30 });')).toBe("keyword:const plain:teaser punct:= keyword:await function:cut punct:( string:\"a.mov\" punct:, punct:{ plain:length punct:: number:30 punct:});");
    expect(kinds("// keep the laughs")).toBe("comment:// keep the laughs");
    expect(kinds("let clip: Clip = x2;")).toBe("keyword:let plain:clip punct:: type:Clip punct:= plain:x2 punct:;");
    expect(kinds("def cut(clip): # trim", "python")).toBe("keyword:def function:cut punct:( plain:clip punct:): comment:# trim");
    expect(kinds("reel cut --length 30 in.mov", "shell")).toBe("function:reel plain:cut punct:-- plain:length number:30 keyword:in punct:. plain:mov");
  });
  it("keeps every character, in order", () => {
    const line = '  keep: ["laughs", "best line"], // two';
    expect(tokenizeLine(line, "ts").map((t) => t.text).join("")).toBe(line);
  });
  it("types indentation at once and pauses at line ends", () => {
    const times = typeTimes("a\n  b", 10, 1);
    expect(times).toHaveLength(5);
    expect(times[0]).toBeCloseTo(1.1);
    expect(times[1]).toBeCloseTo(1.2);
    expect(times[2]).toBe(times[1]);
    expect(times[3]).toBe(times[1]);
    expect(times[4]).toBeCloseTo(1.3);
    expect(typeSeconds("a\n  b", 10)).toBeCloseTo(0.3);
  });
});
