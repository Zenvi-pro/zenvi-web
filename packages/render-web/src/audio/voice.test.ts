import { describe, expect, it } from "vitest";
import type { AudioPlan, AudioSegment } from "@zenvi/engine/render";
import { AudioPlayback } from "./playback.js";
import type { AudioRenderer, PreparedPiece } from "./renderer.js";
import { segmentPiece } from "./schedule.js";
import { scheduleVoice } from "./voice.js";
import { FakeAudioContext } from "../test-support/fake-audio.js";

const segment = (overrides: Partial<AudioSegment> = {}): AudioSegment => ({
  clipId: "C1",
  fileId: "F1",
  path: "a.wav",
  timelineStart: 10,
  sourceStart: 0,
  duration: 4,
  rate: 1,
  gain: [],
  effects: [],
  ...overrides,
});

function prepared(seg: AudioSegment, from: number, to: number, sampleRate = 1000, speed?: number): PreparedPiece {
  const piece = segmentPiece(seg, from, to, sampleRate)!;
  const frames = piece.endFrame - piece.startFrame;
  return { piece, channels: [new Float32Array(frames), new Float32Array(frames)], sampleRate, speed: speed ?? piece.speed };
}

const asContext = (ctx: FakeAudioContext) => ctx as unknown as BaseAudioContext;
const asNode = (ctx: FakeAudioContext) => ctx.destination as unknown as AudioNode;

describe("scheduleVoice", () => {
  it("starts the buffer at the context time of its timeline position", () => {
    const ctx = new FakeAudioContext();
    const anchor = { timeline: 9, context: 100, rate: 1 };
    const voice = scheduleVoice(asContext(ctx), asNode(ctx), prepared(segment(), 10.5, 12), anchor)!;
    const source = ctx.sources[0]!;
    expect(source.started).toEqual({ when: 101.5, offset: 0, duration: 1.5 });
    expect(source.playbackRate.value).toBe(1);
    expect(source.connections[0]).toBe(ctx.destination);
    expect(source.buffer).toMatchObject({ numberOfChannels: 2, length: 1500, sampleRate: 1000 });
    expect(voice.endsAt).toBeCloseTo(103, 9);
  });

  it("automates the gain envelope in context time, at the player's rate and the clip's speed", () => {
    const ctx = new FakeAudioContext();
    const fade = segment({ rate: 2, gain: [{ t: 0, gain: 0 }, { t: 1, gain: 1 }, { t: 4, gain: 0.5 }] });
    const anchor = { timeline: 10, context: 50, rate: 2 };
    scheduleVoice(asContext(ctx), asNode(ctx), prepared(fade, 10.5, 12), anchor);
    const source = ctx.sources[0]!;
    expect(source.playbackRate.value).toBe(4); // speed 2 × player rate 2
    expect(source.started).toEqual({ when: 50.25, offset: 0, duration: 3 });
    const gain = ctx.gains[0]!;
    expect(source.connections[0]).toBe(gain);
    expect(gain.gain.events).toEqual([
      { kind: "set", value: 0.5, time: 50.25 },
      { kind: "ramp", value: 1, time: 50.5 },
      { kind: "ramp", value: 1 - (0.5 * 1) / 3, time: 51 },
    ]);
  });

  it("skips what should already have played when it is scheduled late", () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 101;
    scheduleVoice(asContext(ctx), asNode(ctx), prepared(segment(), 10, 12), { timeline: 10, context: 100, rate: 1 });
    expect(ctx.sources[0]!.started).toEqual({ when: 101, offset: 1, duration: 1 });
    ctx.currentTime = 200;
    expect(scheduleVoice(asContext(ctx), asNode(ctx), prepared(segment(), 10, 12), { timeline: 10, context: 100, rate: 1 })).toBeNull();
  });
});

describe("AudioPlayback", () => {
  function fakeRenderer(log: [string, number, number][]): AudioRenderer {
    return {
      async render(seg: AudioSegment, from: number, to: number) {
        log.push([seg.clipId, from, to]);
        const piece = segmentPiece(seg, from, to, 1000);
        return piece ? { piece, channels: [new Float32Array(piece.endFrame - piece.startFrame)], sampleRate: 1000, speed: piece.speed } : null;
      },
      async reset() {},
      async releaseEnded() {},
      async dispose() {},
    } as unknown as AudioRenderer;
  }

  const plan: AudioPlan = { sampleRate: 48000, channels: 2, start: 0, end: 30, segments: [segment({ timelineStart: 0, duration: 20 }), segment({ clipId: "C2", timelineStart: 3, duration: 2 })] };

  it("schedules contiguous windows up to the lookahead, then tops up as time passes", async () => {
    const ctx = new FakeAudioContext();
    const log: [string, number, number][] = [];
    const playback = new AudioPlayback({ context: ctx as unknown as AudioContext, renderer: fakeRenderer(log), lookahead: 2, window: 1 });
    playback.start(plan, { timeline: 1, context: 0.1, rate: 1 }, { num: 30, den: 1 });
    for (let i = 0; i < 5; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
      playback.pump();
    }
    const c1 = log.filter(([id]) => id === "C1").map(([, a, b]) => [a, b]);
    // The first window is short (0.25 s), ending on the 30 fps audio frame grid (1600 samples at 48 kHz).
    expect(c1[0]![0]).toBe(1);
    expect(Math.round(c1[0]![1]! * 48000)).toBe(37 * 1600);
    for (let i = 1; i < c1.length; i += 1) {
      expect(c1[i]![0]).toBe(c1[i - 1]![1]!);
      expect(Math.round(c1[i]![0]! * 48000) % 1600).toBe(0);
    }
    // Scheduled through the 2 s lookahead, overshooting by at most one window.
    expect(c1.at(-1)![1]).toBeGreaterThanOrEqual(3);
    expect(c1.at(-1)![1]).toBeLessThanOrEqual(3 + 1);
    const scheduledBefore = ctx.sources.length;
    ctx.currentTime = 2.1; // one second audible later
    for (let i = 0; i < 5; i += 1) {
      playback.pump();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(ctx.sources.length).toBeGreaterThan(scheduledBefore);
    expect(log.some(([id, a]) => id === "C2" && a >= 3)).toBe(true);
    playback.stop();
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    playback.dispose();
  });

  it("drops windows that finish decoding after a stop", async () => {
    const ctx = new FakeAudioContext();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const renderer = {
      async render(seg: AudioSegment, from: number, to: number) {
        await gate;
        const piece = segmentPiece(seg, from, to, 1000)!;
        return { piece, channels: [new Float32Array(piece.endFrame - piece.startFrame)], sampleRate: 1000, speed: 1 };
      },
      async reset() {},
      async releaseEnded() {},
    } as unknown as AudioRenderer;
    const playback = new AudioPlayback({ context: ctx as unknown as AudioContext, renderer });
    playback.start(plan, { timeline: 0, context: 0, rate: 1 }, { num: 30, den: 1 });
    playback.stop();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.sources).toHaveLength(0);
  });
});
