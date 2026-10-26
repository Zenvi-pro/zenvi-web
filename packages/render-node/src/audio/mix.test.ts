import path from "node:path";
import { measureLoudness, type AudioPlan, type AudioSegment, type FramePlan, type Project } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { createRgba } from "../image/rgba.js";
import type { RenderEngine } from "../render/engine.js";
import { renderProject } from "../render/render-project.js";
import { makeAudio, makeTempDir, removeDir } from "../test-support/fixtures.js";
import { loudnormPass2, renderMixPcm } from "./mix.js";

let dir: string;
let quiet: string;
let other: string;

const SECONDS = 6;

function project(): Project {
  const clip = (id: string, file: string) => ({ id, file_id: file, position: 0, start: 0, end: SECONDS, layer: 1000000 });
  return {
    id: "MIXPROJ001",
    fps: { num: 25, den: 1 },
    display_ratio: { num: 16, den: 9 },
    pixel_ratio: { num: 1, den: 1 },
    width: 160,
    height: 90,
    sample_rate: 48000,
    channels: 2,
    channel_layout: 3,
    settings: {},
    clips: [clip("C1", "F1"), clip("C2", "F2")],
    effects: [],
    files: [],
    duration: 300,
    scale: 15,
    tick_pixels: 100,
    playhead_position: 0,
    profile: "test",
    export_settings: null,
    export_overrides: {},
    layers: [],
    markers: [],
    progress: [],
    history: { undo: [], redo: [] },
    version: {},
  } as unknown as Project;
}

function segment(clipId: string, file: string): AudioSegment {
  return { clipId, fileId: clipId === "C1" ? "F1" : "F2", path: file, timelineStart: 0, sourceStart: 0, duration: SECONDS, rate: 1, gain: [{ t: 0, gain: 1 }], effects: [] };
}

/** An engine that plans two audio segments and paints black video. */
function engine(): RenderEngine {
  return {
    planFrame(_p, frame, size): FramePlan {
      return { frame, time: (frame - 1) / 25, width: size.width, height: size.height, background: [0, 0, 0, 255], layers: [] };
    },
    planAudio(_p, range): AudioPlan {
      return { sampleRate: 48000, channels: 2, start: range.start, end: range.end, segments: [segment("C1", quiet), segment("C2", other)] };
    },
    compositeFrame: (plan) => createRgba(plan.width, plan.height),
    createState: () => ({}),
  };
}

async function decodeStereo(file: string) {
  const { stdout } = await runBinary(resolveBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "f32le", "-ac", "2", "-ar", "48000", "pipe:1"]);
  const all = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length - (stdout.length % 8)));
  const frames = all.length / 2;
  return [0, 1].map((c) => Float32Array.from({ length: frames }, (_, i) => all[i * 2 + c]!));
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-mix-");
  // Mono sines at amplitude 0.05 (-26 dBFS): -3 dB per channel on the stereo upmix = about -29 LUFS each.
  quiet = await makeAudio(dir, "quiet.wav", { hz: 1000, duration: SECONDS, amplitude: 0.05, channels: 1 });
  other = await makeAudio(dir, "other.wav", { hz: 1700, duration: SECONDS, amplitude: 0.05, channels: 1 });
}, 60_000);

afterAll(() => removeDir(dir));

describe("renderMixPcm", () => {
  it("renders the mix at the project's rate and layout, in loudness the engine meter reads", async () => {
    const mix = await renderMixPcm(project(), { resolveMedia: (p) => p, engine: engine() });
    expect(mix.sampleRate).toBe(48000);
    expect(mix.channels).toHaveLength(2);
    expect(mix.channels[0]!.length).toBeGreaterThan(SECONDS * 48000 - 100);
    const stem = await renderMixPcm(project(), { resolveMedia: (p) => p, engine: engine(), clipIds: ["C1"] });
    const one = measureLoudness(stem.channels, stem.sampleRate).integrated;
    // 0.05 mono -> -3 dB per channel on the upmix: -26 - 3 = -29 dBFS per channel = -29 LUFS.
    expect(one).toBeGreaterThan(-29.5);
    expect(one).toBeLessThan(-28.5);
    // Two uncorrelated tones add 3 dB (the second sits a little higher on the K-weighting shelf).
    const gain = measureLoudness(mix.channels, mix.sampleRate).integrated - one;
    expect(gain).toBeGreaterThan(3);
    expect(gain).toBeLessThan(4.5);
  });

  it("refuses an empty timeline and one past the limit", async () => {
    await expect(renderMixPcm({ ...project(), clips: [] }, { resolveMedia: (p) => p, engine: engine() })).rejects.toThrow(/empty/);
    await expect(renderMixPcm(project(), { resolveMedia: (p) => p, engine: engine(), maxSeconds: 2 })).rejects.toThrow(/limited/);
  });
});

describe("export loudness normalisation", () => {
  it("brings a quiet mix to the target with the true peak under the ceiling, and leaves it alone otherwise", async () => {
    const plain = path.join(dir, "plain.wav");
    const normalized = path.join(dir, "normalized.wav");
    const base = { format: "wav" as const, width: 160, height: 90, fps: { num: 25, den: 1 } };
    await renderProject(project(), { resolveMedia: (p) => p, output: plain, options: base, engine: engine() });
    const result = await renderProject(project(), {
      resolveMedia: (p) => p,
      output: normalized,
      options: { ...base, loudness: { targetLufs: -14, truePeakDbtp: -1 } },
      engine: engine(),
    });
    expect(result.warnings.join(" ")).not.toMatch(/skipped/);
    const before = measureLoudness(await decodeStereo(plain), 48000);
    const after = measureLoudness(await decodeStereo(normalized), 48000);
    expect(before.integrated).toBeLessThan(-24);
    expect(after.integrated).toBeGreaterThan(-14.6);
    expect(after.integrated).toBeLessThan(-13.4);
    expect(after.truePeakDb).toBeLessThanOrEqual(-0.8);
  }, 60_000);

  it("normalizes the audio of a video export, whose sources start after the picture input", async () => {
    const out = path.join(dir, "normalized.mp4");
    await renderProject(project(), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 }, quality: "low", loudness: { targetLufs: -16, truePeakDbtp: -1 } },
      engine: engine(),
    });
    const after = measureLoudness(await decodeStereo(out), 48000);
    expect(after.integrated).toBeGreaterThan(-16.8);
    expect(after.integrated).toBeLessThan(-15.2);
  }, 60_000);

  it("skips a silent mix with a warning", async () => {
    const silent: RenderEngine = { ...engine(), planAudio: (_p, range) => ({ sampleRate: 48000, channels: 2, start: range.start, end: range.end, segments: [] }) };
    const out = path.join(dir, "silent.wav");
    const result = await renderProject(project(), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "wav", width: 160, height: 90, fps: { num: 25, den: 1 }, loudness: { targetLufs: -14, truePeakDbtp: -1 } },
      engine: silent,
    });
    expect(result.warnings.join(" ")).toMatch(/silent/);
  });

  it("builds the second pass from the first pass's readings", () => {
    const pass2 = loudnormPass2({ inputI: -27.6, inputTp: -9.1, inputLra: 3.2, inputThresh: -38, targetOffset: 0.3 }, { targetLufs: -14, truePeakDbtp: -1 }, 44100);
    expect(pass2).toContain("I=-14:TP=-2");
    expect(pass2).toContain("measured_I=-27.6:measured_TP=-9.1:measured_LRA=3.2:measured_thresh=-38:offset=0.3:linear=true");
    expect(pass2).toContain("aresample=44100");
    expect(pass2).toContain("alimiter=limit=0.79433:level=disabled");
  });
});
