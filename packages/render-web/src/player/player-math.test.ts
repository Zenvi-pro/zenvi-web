import { describe, expect, it } from "vitest";
import { audioClock, audibleContextTime, performanceClock } from "./clock.js";
import { fitViewport, previewPlanSize } from "./layout.js";

describe("previewPlanSize (Timeline::SetMaxSize)", () => {
  it("fits the project into the canvas keeping aspect, never above project size", () => {
    expect(previewPlanSize({ width: 1920, height: 1080 }, { width: 800, height: 800 })).toEqual({ width: 800, height: 450 });
    expect(previewPlanSize({ width: 1920, height: 1080 }, { width: 4000, height: 3000 })).toEqual({ width: 1920, height: 1080 });
    expect(previewPlanSize({ width: 1080, height: 1920 }, { width: 1000, height: 500 })).toEqual({ width: 281, height: 500 });
    expect(previewPlanSize({ width: 1280, height: 720 }, { width: 641.7, height: 360.2 })).toEqual({ width: 640, height: 360 });
  });
});

describe("fitViewport", () => {
  it("centers the frame and scales plan pixels to canvas pixels", () => {
    expect(fitViewport({ width: 1000, height: 1000 }, { width: 1920, height: 1080 }, { width: 960, height: 540 })).toEqual({ x: 0, y: 218.75, scale: 1000 / 960 });
    const v = fitViewport({ width: 400, height: 1000 }, { width: 1080, height: 1920 }, { width: 400, height: 711 });
    expect(v.y).toBeCloseTo((1000 - 1920 * (400 / 1080)) / 2, 9);
  });
});

describe("clocks", () => {
  it("performance clock advances with wall time at the rate", () => {
    let ms = 1000;
    const clock = performanceClock({ timeline: 5, performanceMs: 1000, rate: 2 }, () => ms);
    ms = 1500;
    expect(clock.now()).toBe(6);
    expect(clock.kind).toBe("performance");
  });

  it("audio clock follows the heard sample, holds before the start and never goes back", () => {
    let ms = 0;
    const context = {
      currentTime: 0,
      stamp: { contextTime: 9.9, performanceTime: 1 },
      getOutputTimestamp() {
        return this.stamp;
      },
    };
    const clock = audioClock({ timeline: 30, context: 10, rate: 1 }, context, () => ms);
    ms = 1;
    expect(clock.now()).toBe(30); // context 9.9 heard: still before the anchor
    context.stamp = { contextTime: 10.5, performanceTime: 1000 };
    ms = 1100; // 0.1 s after that output timestamp
    expect(clock.now()).toBeCloseTo(30.6, 9);
    context.stamp = { contextTime: 10.4, performanceTime: 1100 }; // jitter backwards
    expect(clock.now()).toBeCloseTo(30.6, 9);
  });

  it("falls back to currentTime minus output latency without output timestamps", () => {
    expect(audibleContextTime({ currentTime: 2, outputLatency: 0.05 }, () => 0)).toBeCloseTo(1.95, 9);
    expect(audibleContextTime({ currentTime: 2, baseLatency: 0.01 }, () => 0)).toBeCloseTo(1.99, 9);
  });
});
