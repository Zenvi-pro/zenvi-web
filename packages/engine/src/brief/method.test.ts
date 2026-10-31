import { describe, expect, it } from "vitest";
import { METHOD } from "../tools/test-support/brief-fixture.js";
import { briefSchema, type Brief } from "./brief.js";
import { DIRECTION_AXES, drawDirection, methodProblems, repeatedAxes } from "./method.js";

const base = { goal: "g", platform: "Reels", aspect: "9:16", length_seconds: 24, style: "hype-reel", hook: "h", beats: [{ start: 0, end: 24, name: "all" }] };
const brief = (extra: Record<string, unknown> = {}): Brief => briefSchema.parse({ ...base, ...METHOD, ...extra });

describe("the motif method's rules", () => {
  it("passes a varied storyboard grown from its motifs", () => {
    expect(methodProblems(brief())).toEqual([]);
  });

  it("advises only from 20 s, or when asked", () => {
    const short = briefSchema.parse({ ...base, length_seconds: 19, beats: [{ start: 0, end: 19, name: "all" }] });
    expect(methodProblems(short)).toEqual([]);
    expect(methodProblems(short, { force: true }).join(" ")).toContain("motifs: 0 of the 8-12");
  });

  it("asks for motifs, a through-line, a storyboard, the reskin test and a draw", () => {
    const text = methodProblems(briefSchema.parse(base)).join("\n");
    for (const part of ["motifs: 0 of the 8-12", "through_line:", "storyboard: 0 rows", "reskin:", "direction: 0 axes"]) expect(text).toContain(part);
  });

  it("refuses the repetition the extra columns exist to show", () => {
    const same = METHOD.storyboard.map((r) => ({ ...r, beats: 4, composition: "centred", text_entrance: "slam", tone: "dark navy", climax: undefined }));
    const text = methodProblems(brief({ storyboard: [...same.slice(0, 4), { ...same[0]!, start: 5 }] })).join("\n");
    expect(text).toContain("every shot is 4 beats");
    expect(text).toContain("centred x5");
    expect(text).toContain("1 text entrance");
    expect(text).toContain("no shot on a bright ground");
    expect(text).toContain("exactly one climax row (0 marked)");
  });

  it("opens and closes on the through-line; the climax's tone is its own", () => {
    const rows = METHOD.storyboard.map((r, i) => (i === 4 ? { ...r, motif: "mud spray" } : i === 3 ? { ...r, tone: "bright paper" } : r));
    const text = methodProblems(brief({ storyboard: rows })).join("\n");
    expect(text).toContain('first and the last shot grow from the through-line "lugged sole"');
    expect(text).toContain('the climax\'s tone "bright paper" repeats');
  });

  it("the reskin test fails a plan where over a third would work for any subject", () => {
    expect(methodProblems(brief({ reskin: { generic: 2 } })).join("\n")).toContain("2 of 5 shots would work for any subject (over a third)");
    expect(methodProblems(brief({ reskin: { generic: 1 } }))).toEqual([]);
  });
});

describe("the creative-direction draw", () => {
  it("draws one option per axis, the same for a seed, never the last edit's pick", () => {
    const last = drawDirection(7);
    expect(Object.keys(last)).toEqual(Object.keys(DIRECTION_AXES));
    expect(drawDirection(7)).toEqual(last);
    for (let seed = 1; seed < 40; seed += 1) {
      const next = drawDirection(seed, last);
      for (const axis of Object.keys(last)) expect(next[axis], axis).not.toBe(last[axis]);
    }
  });

  it("names the axes a brief repeats from the last edit", () => {
    expect(repeatedAxes(brief(), { "art style": "Blueprint line drawing", rhythm: "countdown" })).toEqual(["art style"]);
  });
});
