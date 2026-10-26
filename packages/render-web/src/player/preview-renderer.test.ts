import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@zenvi/engine";
import type { FramePlan } from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import { MediaRegistry } from "../media/registry.js";
import { FakeOffscreenCanvas, installFakeCanvas } from "../test-support/fake-canvas.js";
import { bindCanvas } from "./canvas-binding.js";
import { PreviewRenderer } from "./preview-renderer.js";

const FPS = 30;

function engine(planned: { frame: number; width: number }[]): RenderEngine {
  return {
    planFrame(_project, frame, size): FramePlan {
      planned.push({ frame, width: size.width });
      return { frame, time: (frame - 1) / FPS, width: size.width, height: size.height, background: [0, 0, 0, 255], layers: [] };
    },
    planAudio: (_project, range) => ({ sampleRate: 48000, channels: 2, start: range.start, end: range.end, segments: [] }),
    applyVideoEffect: (image) => image,
    supportsVideoEffect: () => false,
    getAudioKernel: () => undefined,
    applyMask: () => undefined,
    frameAt: (_project, seconds) => Math.floor(seconds * FPS + 1e-9) + 1,
    frameTime: (_project, frame) => (frame - 1) / FPS,
    lastFrame: () => 3 * FPS,
  };
}

const project = { width: 320, height: 180, fps: { num: FPS, den: 1 } } as unknown as Project;

let uninstall: () => void;
beforeEach(() => {
  uninstall = installFakeCanvas();
});
afterEach(() => uninstall());

function renderer(options: { adaptive?: boolean } = {}) {
  const planned: { frame: number; width: number }[] = [];
  const surface = bindCanvas(new FakeOffscreenCanvas(320, 180) as unknown as OffscreenCanvas, { transparent: false });
  const r = new PreviewRenderer(surface, { media: new MediaRegistry(), engine: engine(planned), ...options });
  r.setProject(project);
  return { r, planned };
}

describe("PreviewRenderer", () => {
  it("does not want a frame that is on screen, waiting, or rendering", async () => {
    const { r, planned } = renderer();
    r.request(5, "sequential");
    // Frame 5 is rendering now: asking for it again would composite it twice.
    expect(r.wants(5)).toBe(false);
    r.request(6, "sequential");
    expect(r.wants(6)).toBe(false);
    expect(r.wants(7)).toBe(true);
    await r.whenIdle();
    expect(planned.map((p) => p.frame)).toEqual([5, 6]);
    expect(r.wants(6)).toBe(false);
    expect(r.wants(5)).toBe(true);
    r.dispose();
  });

  it("renders paused frames at full resolution whatever playback scaled to", async () => {
    const { r, planned } = renderer({ adaptive: true });
    const realNow = performance.now.bind(performance);
    let t = 0;
    // Every playback frame takes 200 ms: well over a 33 ms frame.
    performance.now = () => (t += 100);
    try {
      for (let frame = 1; frame <= 12; frame += 1) {
        r.request(frame, "sequential");
        await r.whenIdle();
      }
      expect(r.shownScale).toBeLessThan(1);
      expect(planned.at(-1)!.width).toBeLessThan(320);
      r.request(12, "seek");
      await r.whenIdle();
      expect(planned.at(-1)!.width).toBe(320);
      expect(r.shownScale).toBe(1);
    } finally {
      performance.now = realNow;
    }
    r.dispose();
  });
});
