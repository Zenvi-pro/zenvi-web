import { describe, expect, it } from "vitest";
import type { AudioKernel, AudioSegment } from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import { MediaRegistry } from "../media/registry.js";
import { makeWav } from "../test-support/wav.js";
import { AudioRenderer } from "./renderer.js";

const RATE = 8000;
const FREQ = 440;

/** The int16 sample makeWav writes for frame i, as a decoder returns it. */
const sampleAt = (i: number) => Math.round(Math.sin((2 * Math.PI * FREQ * i) / RATE) * 0.5 * 32767) / 32768;

function setup(kernels: Record<string, AudioKernel> = {}) {
  const media = new MediaRegistry();
  media.register("F", { kind: "blob", blob: new File([makeWav({ seconds: 2, sampleRate: RATE, channels: 2, frequency: FREQ }) as BlobPart], "tone.wav") });
  const engine = { getAudioKernel: (type: string) => kernels[type] } as unknown as RenderEngine;
  return { media, renderer: new AudioRenderer({ media, engine }) };
}

const segment = (overrides: Partial<AudioSegment> = {}): AudioSegment => ({
  clipId: "C1",
  fileId: "F",
  path: "tone.wav",
  timelineStart: 1,
  sourceStart: 0.25,
  duration: 1,
  rate: 1,
  gain: [],
  effects: [],
  ...overrides,
});

describe("AudioRenderer (real decode of PCM in Node)", () => {
  it("returns the exact source samples of a window, at the clip's offset", async () => {
    const { media, renderer } = setup();
    const piece = (await renderer.render(segment(), 1.1, 1.3))!;
    expect(piece.sampleRate).toBe(RATE);
    expect([piece.piece.startFrame, piece.piece.endFrame]).toEqual([0.35 * RATE, 0.55 * RATE]);
    const first = piece.piece.startFrame;
    piece.channels[0]!.forEach((v, i) => expect(v).toBeCloseTo(sampleAt(first + i), 6));
    expect(piece.channels[1]![10]).toBeCloseTo(sampleAt(first + 10), 6);
    await renderer.dispose();
    media.dispose();
  });

  it("decodes adjacent windows as one continuous stream and plays reversed clips backwards", async () => {
    const { media, renderer } = setup();
    const a = (await renderer.render(segment(), 1, 1.37))!;
    const b = (await renderer.render(segment(), 1.37, 1.9))!;
    expect(b.piece.startFrame).toBe(a.piece.endFrame);
    const joined = [...a.channels[0]!, ...b.channels[0]!];
    joined.forEach((v, i) => expect(v).toBeCloseTo(sampleAt(0.25 * RATE + i), 6));

    const back = (await renderer.render(segment({ clipId: "R", rate: -1, sourceStart: 1.5 }), 1, 1.25))!;
    expect(back.piece.reversed).toBe(true);
    // Timeline order: source 1.5 s first, then backwards.
    expect(back.channels[0]![0]).toBeCloseTo(sampleAt(1.5 * RATE - 1), 6);
    expect(back.channels[0]!.at(-1)).toBeCloseTo(sampleAt(1.25 * RATE), 6);
    await renderer.dispose();
    media.dispose();
  });

  it("runs audio kernels with state carried across contiguous windows, reset after a jump", async () => {
    const seen: number[] = [];
    const counter: AudioKernel = (channels, _rate, params, state) => {
      const calls = ((state.get("calls") as number | undefined) ?? 0) + 1;
      state.set("calls", calls);
      seen.push(calls);
      const factor = params.factor as number;
      for (const channel of channels) for (let i = 0; i < channel.length; i += 1) channel[i]! *= factor;
    };
    const { media, renderer } = setup({ Counter: counter });
    const withEffect = segment({ effects: [{ id: "E", type: "Counter", frame: 1, params: { factor: 0.5 } }] });
    const a = (await renderer.render(withEffect, 1, 1.2))!;
    await renderer.render(withEffect, 1.2, 1.4);
    await renderer.render(withEffect, 1.7, 1.8); // a seek: state starts over
    expect(seen).toEqual([1, 2, 1]);
    expect(a.channels[0]![7]).toBeCloseTo(sampleAt(0.25 * RATE + 7) * 0.5, 6);
    await renderer.dispose();
    media.dispose();
  });

  it("time-stretches before kernels when the clip plays at another speed", async () => {
    const identity: AudioKernel = () => undefined;
    const { media, renderer } = setup({ Id: identity });
    const fast = segment({ rate: 2, sourceStart: 0, effects: [{ id: "I", type: "Id", frame: 1, params: {} }] });
    const piece = (await renderer.render(fast, 1, 1.25))!;
    // 0.5 s of source squeezed into 0.25 s of samples, played at speed 1.
    expect(piece.speed).toBe(1);
    expect(piece.channels[0]!.length).toBe(0.25 * RATE);
    expect(piece.channels[0]![100]).toBeCloseTo(sampleAt(200), 6);
    await renderer.dispose();
    media.dispose();
  });

  it("closes the decoders of clips playback has passed", async () => {
    const { media, renderer } = setup();
    const early = segment({ clipId: "A", timelineStart: 0, duration: 0.5 });
    const late = segment({ clipId: "B", timelineStart: 0.5, duration: 1 });
    await renderer.render(early, 0, 0.5);
    await renderer.render(late, 0.5, 0.8);
    const plan = { sampleRate: RATE, channels: 2, start: 0, end: 2, segments: [early, late] };
    const lanes = () => (renderer as unknown as { lanes: Map<string, unknown> }).lanes.size;
    expect(lanes()).toBe(2);
    await renderer.releaseEnded(plan, 0.6);
    expect(lanes()).toBe(1);
    await renderer.releaseEnded(plan, 2);
    expect(lanes()).toBe(0);
    media.dispose();
  });
});
