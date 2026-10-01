import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@zenvi/engine";
import type { FramePlan } from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import { MediaRegistry } from "../media/registry.js";
import { FakeOffscreenCanvas, installFakeCanvas } from "../test-support/fake-canvas.js";
import { PreviewPlayer, type PlayerState } from "./preview-player.js";

const FPS = 30;

/** Color layers only (no media), 3 s long; records what it was asked to plan. */
function engine(planned: { frame: number; width: number; height: number; preview: boolean }[]): RenderEngine {
  return {
    planFrame(_project, frame, size, options): FramePlan {
      planned.push({ frame, width: size.width, height: size.height, preview: options?.preview === true });
      return { frame, time: (frame - 1) / FPS, width: 160, height: 90, background: [0, 0, 0, 255], layers: [] };
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

const project = { width: 160, height: 90, fps: { num: FPS, den: 1 }, duration: 300 } as unknown as Project;

let uninstall: () => void;
beforeEach(() => {
  uninstall = installFakeCanvas();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
  uninstall();
});

function setup() {
  const planned: { frame: number; width: number; height: number; preview: boolean }[] = [];
  const canvas = new FakeOffscreenCanvas(320, 180) as unknown as OffscreenCanvas;
  const media = new MediaRegistry();
  const player = new PreviewPlayer(canvas, { media, engine: engine(planned) });
  const states: PlayerState[] = [];
  player.onState((s) => states.push(s));
  player.setProject(project);
  return { player, planned, states, media };
}

describe("PreviewPlayer", () => {
  it("plans frames for the canvas as a preview box and renders a seek", async () => {
    const { player, planned } = setup();
    await player.seek(1);
    expect(planned.at(-1)).toEqual({ frame: 31, width: 320, height: 180, preview: true });
    expect(player.frame).toBe(31);
    expect(player.time).toBe(1);
    expect(player.duration).toBe(3);
    player.dispose();
  });

  it("coalesces rapid seeks: only the latest waiting request renders", async () => {
    const { player, planned } = setup();
    await vi.advanceTimersByTimeAsync(0);
    planned.length = 0;
    const seeks = [0.1, 0.5, 1.0, 1.5, 2.0].map((t) => player.seek(t));
    await Promise.all(seeks);
    // The first starts rendering at once; the next three are replaced by the last.
    expect(planned.map((p) => p.frame)).toEqual([4, 61]);
    expect(player.frame).toBe(61);
    player.dispose();
  });

  it("plays on the wall clock without audio and pauses on the start of the shown frame", async () => {
    const { player, states } = setup();
    await player.seek(0.5);
    player.play();
    expect(player.isPlaying).toBe(true);
    await vi.advanceTimersByTimeAsync(510);
    const t = player.time;
    expect(t).toBeGreaterThan(0.95);
    expect(t).toBeLessThan(1.1);
    player.pause();
    expect(player.isPlaying).toBe(false);
    // Snapped back to the start of the frame on screen.
    expect(Number.isInteger(Math.round(player.time * FPS * 1e6) / 1e6)).toBe(true);
    expect(player.time).toBeLessThanOrEqual(t);
    expect(states.some((s) => s.playing)).toBe(true);
    expect(states.at(-1)?.playing).toBe(false);
    player.dispose();
  });

  it("stops on the last frame at the end, or loops", async () => {
    const { player } = setup();
    await player.seek(2.8);
    player.play();
    await vi.advanceTimersByTimeAsync(400);
    expect(player.isPlaying).toBe(false);
    expect(player.time).toBeCloseTo(89 / FPS, 9);
    await vi.advanceTimersByTimeAsync(50);
    expect(player.frame).toBe(90);

    player.loop = true;
    await player.seek(2.8);
    player.play();
    await vi.advanceTimersByTimeAsync(400);
    expect(player.isPlaying).toBe(true);
    expect(player.time).toBeLessThan(0.5);
    player.pause();
    player.dispose();
  });

  it("restarts from the beginning when play is pressed at the end, and plays backwards at negative rates", async () => {
    const { player } = setup();
    await player.seek(3);
    player.play();
    expect(player.time).toBeLessThan(0.1);
    player.pause();
    await player.seek(2);
    player.rate = -1;
    player.play();
    await vi.advanceTimersByTimeAsync(500);
    expect(player.time).toBeLessThan(1.6);
    expect(player.time).toBeGreaterThan(1.4);
    player.pause();
    player.dispose();
  });

  it("re-renders the current frame when the project changes and ignores calls after dispose", async () => {
    const { player, planned } = setup();
    await player.seek(1);
    const before = planned.length;
    player.setProject({ ...project } as Project);
    await vi.advanceTimersByTimeAsync(0);
    expect(planned.length).toBe(before + 1);
    expect(planned.at(-1)?.frame).toBe(31);
    player.dispose();
    expect(() => player.seek(2)).toThrow(/disposed/);
  });
});
