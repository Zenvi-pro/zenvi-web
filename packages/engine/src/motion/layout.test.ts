import { describe, expect, it } from "vitest";
import { centredWidth, fitType, fitWrapped, layoutOf, opticalCentre, typeSize, wrapLines } from "./layout.js";
import { textWidth } from "./text.js";

const VERTICAL = layoutOf({ width: 1080, height: 1920, fps: 30 });
const WIDE = layoutOf({ width: 1920, height: 1080, fps: 30 });
const FEED = layoutOf({ width: 1080, height: 1350, fps: 30 });

describe("layout rules", () => {
  it("set the smallest type of each role from the frame's short side, in either orientation", () => {
    for (const layout of [VERTICAL, WIDE, FEED]) {
      // label 3 %, body 4 %, heading 7.5 % of 1080.
      expect(layout.type).toEqual({ label: 33, body: 44, heading: 81 });
    }
    const small = layoutOf({ width: 720, height: 1280, fps: 30 });
    expect(small.type.label).toBeGreaterThanOrEqual(0.03 * 720);
    expect(small.type.body).toBeGreaterThanOrEqual(0.04 * 720);
    expect(small.type.heading).toBeGreaterThanOrEqual(0.075 * 720);
    expect(typeSize(VERTICAL, "body", 20)).toBe(44);
    expect(typeSize(VERTICAL, "body", 60)).toBe(60);
  });

  it("keep 9:16 words out of the platforms' bands: the top 8 %, the bottom 15 % and the right-hand buttons", () => {
    expect(VERTICAL.tall).toBe(true);
    expect(VERTICAL.safe).toEqual({ left: 64, top: 154, right: 1080 - 119, bottom: 1920 - 288 });
    // Groups centre on the safe area's middle, above the frame's; a centred line clears the buttons.
    expect(opticalCentre(VERTICAL)).toBeCloseTo(893, 0);
    expect(centredWidth(VERTICAL)).toBe(2 * (540 - 119));
  });

  it("keep only the margins on landscape, square and 4:5 frames", () => {
    for (const layout of [WIDE, FEED, layoutOf({ width: 1080, height: 1080, fps: 30 })]) {
      expect(layout.tall).toBe(false);
      expect(layout.safe).toEqual({ left: layout.m, top: layout.m, right: layout.W - layout.m, bottom: layout.H - layout.m });
      expect(opticalCentre(layout)).toBe(layout.H / 2);
    }
  });

  it("fit text at its role's size or larger: more lines first, then an ellipsis, never smaller type", () => {
    const style = { font: "sans" as const, bold: true };
    const roomy = fitType(VERTICAL, "heading", "Film better reels", style, { width: 840, max: 120 });
    expect(roomy.lines).toHaveLength(1);
    expect(roomy.size).toBeGreaterThan(81);
    // Too wide for one line at the heading floor: two balanced lines.
    const two = fitType(VERTICAL, "heading", "Film better reels at home tonight", style, { width: 840, max: 120, maxLines: 2 });
    expect(two.lines).toHaveLength(2);
    expect(two.size).toBeGreaterThanOrEqual(81);
    for (const line of two.lines) expect(textWidth(line, { ...style, size: two.size })).toBeLessThanOrEqual(840);
    // Too long even for two lines: the floor, the last line cut.
    const cut = fitType(VERTICAL, "heading", "An unusually long heading that cannot possibly fit two lines here", style, { width: 840, max: 120, maxLines: 2 });
    expect(cut.size).toBe(81);
    expect(cut.lines).toHaveLength(2);
    expect(cut.lines[1]).toMatch(/…$/);
    for (const line of cut.lines) expect(textWidth(line, { ...style, size: 81 })).toBeLessThanOrEqual(840);
  });

  it("wrap like a text box: greedy lines, a second line only for clearly bigger type, null under the floor", () => {
    const style = { font: "sans" as const };
    const one = fitWrapped(VERTICAL, "body", "Plan a trip", style, { width: 600, max: 84, maxLines: 2 });
    expect(one?.lines).toEqual(["Plan a trip"]);
    const two = fitWrapped(VERTICAL, "body", "Plan a slower morning|", style, { width: 527, max: 84, maxLines: 2 });
    expect(two?.lines).toEqual(["Plan a slower", "morning|"]);
    expect(two!.size).toBeGreaterThan(60);
    expect(fitWrapped(VERTICAL, "body", "x".repeat(60), style, { width: 527, max: 84, maxLines: 2 })).toBeNull();
    // Monospace at 10 px: 6 px a letter, 55 px holds 9.
    expect(wrapLines("one two three four", { size: 10, font: "mono" }, 55, 2)).toEqual(["one two", "three fo…"]);
  });
});
