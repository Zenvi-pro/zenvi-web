import path from "node:path";
import { measureLoudness, type AudioPlan, type AudioSegment, type FramePlan, type Project } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { createRgba } from "../image/rgba.js";
import type { RenderEngine } from "../render/engine.js";
import { renderProject } from "../render/render-project.js";
import { makeAudio, makeTempDir, removeDir } from "../test-support/fixtures.js";
import { loudnormPass2, renderMixPcm, truePeakLimiterFilter } from "./mix.js";

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

describe("export true-peak limiter", () => {
  it("oversamples to the meter's rate and asks for latency compensation only where ffmpeg has it", () => {
    expect(truePeakLimiterFilter(48000, -2, 7)).toBe("aresample=192000,alimiter=limit=0.78524:attack=5:release=50:level=disabled:latency=1,aresample=48000");
    expect(truePeakLimiterFilter(192000, -1, 4)).toBe("alimiter=limit=0.88105:attack=5:release=50:level=disabled");
  });

  // Both sines at gain 20 (amplitude 1 each on the upmix): about +3 dBTP summed.
  const loud: () => RenderEngine = () => ({
    ...engine(),
    planAudio: (_p, range) => ({
      sampleRate: 48000,
      channels: 2,
      start: range.start,
      end: range.end,
      segments: [segment("C1", quiet), segment("C2", other)].map((s) => ({ ...s, gain: [{ t: 0, gain: 20 }] })),
    }),
  });
  const base = { width: 160, height: 90, fps: { num: 25, den: 1 } };

  it("holds an over-loud mix under -1 dBTP in a WAV and in an AAC file, unless turned off", async () => {
    const wav = path.join(dir, "loud.wav");
    const mp4 = path.join(dir, "loud.mp4");
    const raw = path.join(dir, "loud-raw.wav");
    await renderProject(project(), { resolveMedia: (p) => p, output: wav, options: { ...base, format: "wav", audioCodec: "pcm_f32le" }, engine: loud() });
    await renderProject(project(), { resolveMedia: (p) => p, output: mp4, options: { ...base, format: "mp4", quality: "low" }, engine: loud() });
    await renderProject(project(), { resolveMedia: (p) => p, output: raw, options: { ...base, format: "wav", audioCodec: "pcm_f32le", truePeakLimit: false }, engine: loud() });
    const unlimited = measureLoudness(await decodeStereo(raw), 48000);
    expect(unlimited.truePeakDb).toBeGreaterThan(2);
    const limitedWav = measureLoudness(await decodeStereo(wav), 48000);
    expect(limitedWav.truePeakDb).toBeLessThanOrEqual(-1);
    // Lossless output sits at the ceiling: the limiter does not squash more than it must.
    expect(limitedWav.truePeakDb).toBeGreaterThan(-1.5);
    expect(measureLoudness(await decodeStereo(mp4), 48000).truePeakDb).toBeLessThanOrEqual(-1);
  }, 60_000);

  it("leaves a mix under the ceiling as it was (to the oversampling's rounding)", async () => {
    const limited = path.join(dir, "quiet-limited.wav");
    const raw = path.join(dir, "quiet-raw.wav");
    const options = { ...base, format: "wav" as const, audioCodec: "pcm_f32le" };
    await renderProject(project(), { resolveMedia: (p) => p, output: limited, options, engine: engine() });
    await renderProject(project(), { resolveMedia: (p) => p, output: raw, options: { ...options, truePeakLimit: false }, engine: engine() });
    const [a, b] = [await decodeStereo(limited), await decodeStereo(raw)];
    let diff = 0;
    for (let i = 0; i < a[0]!.length; i += 1) diff = Math.max(diff, Math.abs(a[0]![i]! - b[0]![i]!));
    // The 4x resample round trip moves samples by a fraction of a sample: under -60 dBFS, no change in level.
    expect(diff).toBeLessThan(1e-3);
    expect(measureLoudness(a, 48000).integrated).toBeCloseTo(measureLoudness(b, 48000).integrated, 2);
  }, 60_000);
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

  it("reaches the target on a mix whose peaks forbid a plain gain, under the ceiling", async () => {
    // Quiet bed with three 20 ms bursts: ~18 dB between the bursts and the programme.
    const gain = [{ t: 0, gain: 0.004 }];
    for (const t of [1, 3, 5]) gain.push({ t: t - 0.001, gain: 0.004 }, { t, gain: 1 }, { t: t + 0.02, gain: 1 }, { t: t + 0.021, gain: 0.004 });
    const peaky: RenderEngine = {
      ...engine(),
      planAudio: (_p, range) => ({ sampleRate: 48000, channels: 2, start: range.start, end: range.end, segments: [{ ...segment("C1", quiet), gain }] }),
    };
    const base = { format: "wav" as const, width: 160, height: 90, fps: { num: 25, den: 1 } };
    const plain = path.join(dir, "peaky.wav");
    const normalized = path.join(dir, "peaky-normalized.wav");
    await renderProject(project(), { resolveMedia: (p) => p, output: plain, options: base, engine: peaky });
    await renderProject(project(), { resolveMedia: (p) => p, output: normalized, options: { ...base, loudness: { targetLufs: -10, truePeakDbtp: -1 } }, engine: peaky });
    const before = measureLoudness(await decodeStereo(plain), 48000);
    const after = measureLoudness(await decodeStereo(normalized), 48000);
    // A plain gain to the target would put the peaks over the ceiling.
    expect(before.truePeakDb + (-10 - before.integrated)).toBeGreaterThan(-1);
    expect(after.integrated).toBeGreaterThan(before.integrated + 2);
    expect(after.integrated).toBeLessThan(-9);
    expect(after.truePeakDb).toBeLessThanOrEqual(-1);
  }, 60_000);

  it("builds the second pass from the first pass's readings", () => {
    const pass2 = loudnormPass2({ inputI: -27.6, inputTp: -20, inputLra: 3.2, inputThresh: -38, targetOffset: 0.3 }, { targetLufs: -14, truePeakDbtp: -1 }, 44100, 2);
    expect(pass2).toContain("I=-14:TP=-2");
    expect(pass2).toContain("measured_I=-27.6:measured_TP=-20:measured_LRA=3.2:measured_thresh=-38:offset=0.3:linear=true");
    expect(pass2).toContain("aresample=44100");
    expect(pass2).toContain("aresample=44100,aformat=channel_layouts=stereo,alimiter=limit=0.79433:level=disabled");
    // +13.6 dB to reach -14 would take a -12 dBTP peak to +1.6: past -2, so a gain and a limiter.
    const hot = loudnormPass2({ inputI: -27.6, inputTp: -12, inputLra: 3.2, inputThresh: -38, targetOffset: 0.3 }, { targetLufs: -14, truePeakDbtp: -1 }, 44100, 2);
    expect(hot).toBe("volume=13.6dB,alimiter=limit=0.79433:level=disabled");
    // Asked for far more than the limiter may take: the gain stops at 6 dB of peak reduction.
    const crushed = loudnormPass2({ inputI: -45, inputTp: -22, inputLra: 3.2, inputThresh: -50, targetOffset: 0 }, { targetLufs: -14, truePeakDbtp: -1 }, 44100, 2);
    expect(crushed).toBe("volume=26dB,alimiter=limit=0.79433:level=disabled");
  });
});
