// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseTimecode, secondsToTimecode } from "@/lib/timecode";
import {
  anchoredScroll,
  contentWidth,
  rulerLabel,
  rulerScale,
  rulerTicks,
  sliderToZoom,
  timeToX,
  trackIndexAt,
  visibleRange,
  xToTime,
  zoomStep,
  zoomToFit,
  zoomToSlider,
} from "./geometry";

const fps30 = { num: 30, den: 1 };
const fps2997 = { num: 30000, den: 1001 };

describe("px ↔ time", () => {
  it("round-trips", () => {
    expect(timeToX(2.5, 100)).toBe(250);
    expect(xToTime(250, 100)).toBe(2.5);
    expect(xToTime(10, 0)).toBe(0);
  });

  it("computes the visible range with overscan, never before 0", () => {
    expect(visibleRange(1000, 500, 100)).toEqual({ start: 10, end: 15 });
    expect(visibleRange(50, 500, 100, 100)).toEqual({ start: 0, end: 6.5 });
  });

  it("finds the track row under a y coordinate", () => {
    expect(trackIndexAt(0, 64, 3)).toBe(0);
    expect(trackIndexAt(130, 64, 3)).toBe(2);
    expect(trackIndexAt(200, 64, 3)).toBe(-1);
    expect(trackIndexAt(-1, 64, 3)).toBe(-1);
  });
});

describe("ruler", () => {
  it("labels every second or more when zoomed out", () => {
    const scale = rulerScale(100 / 15, fps30);
    expect(scale.major * (100 / 15)).toBeGreaterThanOrEqual(72);
    expect(scale.showFrames).toBe(false);
    expect(scale.major).toBe(15);
  });

  it("switches to frame labels when zoomed in far", () => {
    const scale = rulerScale(900, fps30);
    expect(scale.showFrames).toBe(true);
    expect(scale.major).toBeCloseTo(5 / 30);
    expect(scale.minor).toBeCloseTo(1 / 30);
    expect(rulerLabel(1 + 12 / 30, scale, fps30)).toBe("0:01:12");
  });

  it("keeps minor ticks an exact division of majors, also at 29.97 fps", () => {
    for (const pps of [2, 7, 30, 100, 150, 400, 900]) {
      for (const fps of [fps30, fps2997, { num: 24, den: 1 }]) {
        const { major, minor } = rulerScale(pps, fps);
        const ratio = major / minor;
        expect(Math.abs(ratio - Math.round(ratio)), `${pps} px/s`).toBeLessThan(1e-6 * ratio);
        expect(minor * pps).toBeGreaterThanOrEqual(minor === major ? 0 : 7);
      }
    }
  });

  it("formats hours", () => {
    expect(rulerLabel(3723, rulerScale(1, fps30), fps30)).toBe("1:02:03");
    expect(rulerLabel(65, rulerScale(10, fps30), fps30)).toBe("1:05");
  });

  it("emits ticks with majors at the major interval", () => {
    const ticks = rulerTicks({ start: 0, end: 10 }, { major: 5, minor: 1, showFrames: false });
    expect(ticks).toHaveLength(11);
    expect(ticks.filter((t) => t.major).map((t) => t.t)).toEqual([0, 5, 10]);
  });
});

describe("zoom", () => {
  it("steps and clamps", () => {
    expect(zoomStep(100, 1)).toBe(150);
    expect(zoomStep(100, -1)).toBeCloseTo(66.667, 2);
    expect(zoomStep(1200, 1)).toBe(1200);
  });

  it("fits a duration into the viewport", () => {
    expect(zoomToFit(60, 1000) * 60).toBeCloseTo(940);
  });

  it("maps the slider logarithmically and back", () => {
    for (const pps of [0.5, 3, 100 / 15, 50, 400, 1200]) expect(sliderToZoom(zoomToSlider(pps))).toBeCloseTo(pps, 6);
  });

  it("keeps the anchor time under the cursor", () => {
    // 10 s is at x = 300 in the viewport; after zooming to 50 px/s it stays at 300.
    expect(anchoredScroll(10, 300, 50)).toBe(200);
    expect(anchoredScroll(1, 300, 50)).toBe(0);
  });

  it("sizes the scrollable content with trailing room", () => {
    expect(contentWidth(60, 10, 500)).toBe(900);
    expect(contentWidth(1, 10, 500)).toBe(500);
  });
});

describe("timecode (desktop time_parts.py)", () => {
  it("formats HH:MM:SS:FF", () => {
    expect(secondsToTimecode(0, fps30)).toBe("00:00:00:00");
    expect(secondsToTimecode(3723.5, fps30)).toBe("01:02:03:15");
    expect(secondsToTimecode(59.999, fps30)).toBe("00:00:59:29");
    expect(secondsToTimecode(1 + 1001 / 30000, fps2997)).toBe("00:00:01:01");
  });

  it("parses typed times", () => {
    expect(parseTimecode("00:00:02:15", fps30)).toBe(2.5);
    expect(parseTimecode("1:30", fps30)).toBe(90);
    expect(parseTimecode("12.5", fps30)).toBe(12.5);
    expect(parseTimecode("90s", fps30)).toBe(90);
    expect(parseTimecode("abc", fps30)).toBeNull();
  });
});
