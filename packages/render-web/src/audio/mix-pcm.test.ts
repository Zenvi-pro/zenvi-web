import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@zenvi/engine";
import type { AudioSegment } from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import { MediaRegistry } from "../media/registry.js";
import { FakeOfflineAudioContext } from "../test-support/fake-audio.js";
import { makeWav } from "../test-support/wav.js";
import { renderMixPcm } from "./mix-pcm.js";

const RATE = 8000;
const SECONDS = 12;

/** The int16 sample makeWav writes for frame i of a `frequency` tone. */
const sampleAt = (i: number, frequency: number) => Math.round(Math.sin((2 * Math.PI * frequency * i) / RATE) * 0.5 * 32767) / 32768;

const project = { fps: { num: 25, den: 1 }, sample_rate: RATE, channels: 2 } as unknown as Project;

const segment = (clipId: string, fileId: string, overrides: Partial<AudioSegment> = {}): AudioSegment => ({
  clipId,
  fileId,
  path: `${fileId}.wav`,
  timelineStart: 0,
  sourceStart: 0,
  duration: SECONDS,
  rate: 1,
  gain: [],
  effects: [],
  ...overrides,
});

function setup() {
  const media = new MediaRegistry();
  media.register("A", { kind: "blob", blob: new File([makeWav({ seconds: SECONDS, sampleRate: RATE, frequency: 440 }) as BlobPart], "A.wav") });
  media.register("B", { kind: "blob", blob: new File([makeWav({ seconds: SECONDS, sampleRate: RATE, frequency: 1000 }) as BlobPart], "B.wav") });
  const segments = [segment("C1", "A"), segment("C2", "B", { timelineStart: 2, duration: 10, gain: [{ t: 0, gain: 0.5 }] })];
  const engine = {
    planAudio: (_p: Project, range: { start: number; end: number }) => ({ sampleRate: RATE, channels: 2, start: range.start, end: range.end, segments }),
    lastFrame: () => SECONDS * 25,
    frameTime: (_p: Project, frame: number) => (frame - 1) / 25,
    getAudioKernel: () => undefined,
  } as unknown as RenderEngine;
  return { media, engine };
}

describe("renderMixPcm (the editor's AudioHost.mixPcm)", () => {
  const real = (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
  beforeEach(() => {
    (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOfflineAudioContext;
  });
  afterEach(() => {
    (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = real;
  });

  it("renders the whole mix at the project's rate, continuous across the export's windows", async () => {
    const { media, engine } = setup();
    const mix = await renderMixPcm(project, media, { engine });
    expect(mix.sampleRate).toBe(RATE);
    expect(mix.channels).toHaveLength(2);
    expect(mix.channels[0]!.length).toBe(SECONDS * RATE);
    // Past the first 10 s window: both clips, the second at half gain from 2 s.
    for (const i of [RATE, 3 * RATE, 10 * RATE - 1, 10 * RATE, 11 * RATE + 17]) {
      const expected = sampleAt(i, 440) + (i >= 2 * RATE ? 0.5 * sampleAt(i - 2 * RATE, 1000) : 0);
      expect(mix.channels[0]![i]).toBeCloseTo(expected, 5);
      expect(mix.channels[1]![i]).toBeCloseTo(expected, 5);
    }
    media.dispose();
  });

  it("renders a stem of the named clips only", async () => {
    const { media, engine } = setup();
    const stem = await renderMixPcm(project, media, { engine, clipIds: ["C2"] });
    expect(stem.channels[0]![RATE]).toBe(0);
    expect(stem.channels[0]![5 * RATE + 3]).toBeCloseTo(0.5 * sampleAt(3 * RATE + 3, 1000), 5);
    media.dispose();
  });

  it("refuses an empty timeline and one past the limit", async () => {
    const { media, engine } = setup();
    await expect(renderMixPcm(project, media, { engine: { ...engine, lastFrame: () => 0 } })).rejects.toThrow(/empty/);
    await expect(renderMixPcm(project, media, { engine, maxSeconds: 5 })).rejects.toThrow(/limited to 5 s/);
    media.dispose();
  });
});
