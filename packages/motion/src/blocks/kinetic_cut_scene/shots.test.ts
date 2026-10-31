import { describe, expect, it } from "vitest";
import { countText } from "./draw.js";
import { parseShot, scheduleShots, shotCues, shotHits, strobeStep, type ShotSpec } from "./shots.js";

const spec = (line: string): ShotSpec => {
  const s = parseShot(line);
  if (typeof s === "string") throw new Error(s);
  return s;
};

describe("storyboard lines", () => {
  it("read beats, entrance, lines, sub, layout, ground, layers and the climax", () => {
    expect(spec("2 slam LAUNCH / DAY | 12.03 @bleed #accent +rings +rays !")).toEqual({
      beats: 2,
      entrance: "slam",
      lines: ["LAUNCH", "DAY"],
      sub: "12.03",
      layout: "bleed",
      ground: "accent",
      layers: ["rings", "rays"],
      climax: true,
    });
  });

  it("default to two beats, a slam, centred on the dark ground; text that looks like a modifier stays text", () => {
    expect(spec("WE ARE #1")).toMatchObject({ beats: 2, entrance: "slam", lines: ["WE ARE #1"], layout: "center", ground: "dark" });
    expect(spec("0.5b strobe A B").beats).toBe(0.5);
  });

  it("refuse unknown layouts and layers, empty text, and silly lengths", () => {
    expect(parseShot("2 slam HI @middle")).toMatch(/unknown layout @middle/);
    expect(parseShot("2 slam HI +sparkles")).toMatch(/unknown layer \+sparkles/);
    expect(parseShot("2 slam")).toMatch(/no text/);
    expect(parseShot("2 none +tunnel")).toMatchObject({ entrance: "none", layers: ["tunnel"] });
    expect(parseShot("64 slam HI")).toMatch(/beats/);
  });
});

describe("the schedule", () => {
  const shots = scheduleShots([spec("2 slam A"), spec("1 strobe ONE TWO THREE FOUR"), spec("4 count 120 BPM !")], 120, 4);

  it("lays shots on the beat grid and holds the last to the end", () => {
    expect(shots.map((s) => [s.start, s.end])).toEqual([[0, 1], [1, 1.5], [1.5, 4]]);
    expect(scheduleShots([spec("8 slam A"), spec("2 slam B")], 120, 3)).toHaveLength(1);
  });

  it("hits every cut, every strobe word at half strength, the climax hardest with a shake", () => {
    const hits = shotHits(shots, 120);
    expect(hits.filter((h) => h.strength === 1).map((h) => h.t)).toEqual([0, 1]);
    expect(hits.find((h) => h.t === 1.5)).toEqual({ t: 1.5, strength: 1.35, shake: 20 });
    // Four words in half a second: a word a quarter beat is too fast, so each gets a half beat.
    expect(strobeStep(shots[1]!, 120)).toBe(0.25);
    expect(hits.filter((h) => h.strength === 0.55).map((h) => h.t)).toEqual([1.25]);
  });

  it("keeps flashes 3 a second or fewer, the climax and the full cuts first (WCAG 2.3.1)", () => {
    // Half-beat cuts at 120 BPM and a strobe at 200 BPM: hits every 0.15-0.25 s.
    const fast = scheduleShots([spec("0.5 slam A"), spec("0.5 slam B"), spec("0.5 slam C !"), spec("2 strobe ONE TWO THREE FOUR FIVE SIX")], 120, 3);
    const hits = shotHits(fast, 120);
    expect(hits.find((h) => h.t === 0.25)!.flash).toBe(0);
    expect(hits.find((h) => h.strength === 1.35)!.flash).toBeUndefined();
    const flashing = hits.filter((h) => h.flash !== 0).map((h) => h.t).sort((a, b) => a - b);
    for (let i = 1; i < flashing.length; i += 1) expect(flashing[i]! - flashing[i - 1]!).toBeGreaterThanOrEqual(1 / 3 - 1e-6);
    expect(flashing.length).toBeGreaterThan(2);
  });

  it("cues a sound on every cut and a tick run while the number counts", () => {
    const cues = shotCues(shots, 120);
    for (const s of shots) expect(cues.some((c) => c.t === s.start && (c.kind === "impact" || c.kind === "whoosh"))).toBe(true);
    expect(cues.find((c) => c.kind === "tick")).toMatchObject({ t: 1.56, rate: 14 });
    expect(cues.map((c) => c.t)).toEqual([...cues.map((c) => c.t)].sort((a, b) => a - b));
  });
});

describe("counting", () => {
  it("rolls the first number with its decimals and grouping, keeping the words", () => {
    expect(countText("2.4M users", 0, 2)).toBe("0.0M users");
    expect(countText("2.4M users", 5, 2)).toBe("2.4M users");
    expect(countText("12,500 runners", 5, 2)).toBe("12,500 runners");
    expect(countText("NO DIGITS", 1, 2)).toBe("NO DIGITS");
  });
});
