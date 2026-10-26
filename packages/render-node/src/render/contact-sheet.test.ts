import path from "node:path";
import { addClip, addFile, createProject, ProjectDocument, type Project } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureMix, parseMixLog } from "../audio/mix.js";
import { liveChildCount } from "../ffmpeg/process.js";
import { probe } from "../probe/probe.js";
import { ffprobeJson, makeAudio, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { lumaStats, renderContactSheet } from "./contact-sheet.js";

let dir: string;
let project: Project;

async function build(clips: Array<{ file: string; position: number; end: number; layer?: number }>): Promise<Project> {
  const doc = new ProjectDocument(createProject({ profile: "HD 720p 30 fps" }));
  for (const c of clips) {
    const info = await probe(c.file);
    doc.transaction("add", (tx) => {
      const file = addFile(tx, { path: c.file, info });
      addClip(tx, { fileId: file.id, position: c.position, layer: c.layer ?? 1_000_000, start: 0, end: c.end });
    });
  }
  return doc.project;
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-sheet-");
  const scene = await makeVideo(dir, "scene.mp4", { width: 320, height: 180, duration: 2 });
  const white = await makeVideo(dir, "white.mp4", { source: "color=c=white:s=320x180:r=30:d=1" });
  const black = await makeVideo(dir, "black.mp4", { source: "color=c=black:s=320x180:r=30:d=1" });
  project = await build([
    { file: scene, position: 0, end: 1 },
    { file: white, position: 1, end: 0.2 },
    { file: black, position: 1.2, end: 0.5 },
    { file: scene, position: 1.7, end: 1 },
  ]);
}, 60_000);

afterAll(() => removeDir(dir));

describe("renderContactSheet", () => {
  const layout = { columns: 3, tileWidth: 128, tileHeight: 72, gap: 3, mark: { bright: 0.85, dark: 0.02, darkPeak: 0.12 } };
  const tiles = [
    { seconds: 0.5, label: "0.50" },
    { seconds: 1.05, label: "1.00 in" },
    { seconds: 1.4, label: "1.20 in" },
    { seconds: 1.8, label: "1.70 in" },
  ];

  it("pastes labelled frames into one JPEG and measures each tile's brightness", async () => {
    const result = await renderContactSheet(project, tiles, layout, { resolveMedia: (p) => p });
    expect(result.width).toBe(3 * 128 + 4 * 3);
    expect(result.height).toBe(2 * 72 + 3 * 3);
    expect(result.image.mimeType).toBe("image/jpeg");
    expect(result.luma).toHaveLength(4);
    expect(result.luma[0]!).toBeGreaterThan(0.1);
    expect(result.luma[0]!).toBeLessThan(0.85);
    expect(result.luma[1]!).toBeGreaterThan(0.95);
    expect(result.luma[2]!).toBeLessThan(0.02);
    expect(result.peak[2]!).toBeLessThan(0.12);
    expect(result.peak[1]!).toBeGreaterThan(0.95);
    expect(liveChildCount()).toBe(0);

    const file = path.join(dir, "sheet.jpg");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, Buffer.from(result.image.data, "base64"));
    const info = await ffprobeJson(file);
    expect(info.streams[0]).toMatchObject({ width: result.width, height: result.height });
    // The sheet stays small: well under 100 kB of base64 for a 4-tile sheet.
    expect(result.image.data.length).toBeLessThan(100_000);
  }, 60_000);

  it("borders a tile only with the mark it was given", async () => {
    const sheet = async (marks: ("flash" | "black" | undefined)[]): Promise<string> =>
      (await renderContactSheet(project, tiles.slice(1, 3).map((t, i) => ({ ...t, mark: marks[i] })), { ...layout, columns: 2 }, { resolveMedia: (p) => p })).image.data;
    const plain = await sheet([undefined, undefined]);
    expect(await sheet(["flash", "black"])).not.toBe(plain);
    // A white tile that may only be black, and a black one that may only be a flash, stay plain.
    expect(await sheet(["black", "flash"])).toBe(plain);
  }, 60_000);

  it("reports a null brightness for a tile that cannot be rendered, and still returns the sheet", async () => {
    const broken = structuredClone(project);
    for (const item of [...broken.files, ...broken.clips.map((c) => c.reader)]) item.path = path.join(dir, "missing.mp4");
    const result = await renderContactSheet(broken, tiles.slice(0, 1), { ...layout, columns: 1 }, { resolveMedia: (p) => p });
    expect(result.luma).toEqual([null]);
    expect(result.peak).toEqual([null]);
    expect(result.width).toBe(128 + 6);
  }, 60_000);
});

describe("lumaStats", () => {
  it("weights channels like Rec. 709 and ignores transparent pixels", () => {
    const green = { width: 1, height: 1, data: new Uint8ClampedArray([0, 255, 0, 255]) };
    expect(lumaStats(green).mean).toBeCloseTo(0.7152, 3);
    expect(lumaStats({ width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 0]) }).mean).toBe(0);
  });

  it("tells a black frame from dark footage with a lit subject by the 99th percentile", () => {
    const dark = new Uint8ClampedArray(100 * 4).fill(0);
    for (let i = 3; i < dark.length; i += 4) dark[i] = 255;
    for (let p = 0; p < 5; p += 1) dark.set([255, 255, 255, 255], p * 4);
    const lit = lumaStats({ width: 10, height: 10, data: dark });
    expect(lit.mean).toBeLessThan(0.06);
    expect(lit.peak).toBeGreaterThan(0.9);
    const black = new Uint8ClampedArray(100 * 4).fill(0);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    expect(lumaStats({ width: 10, height: 10, data: black })).toEqual({ mean: 0, peak: 0 });
  });
});

describe("measureMix", () => {
  it("mixes the project down and reports loudness, silence and PCM for beat tracking", async () => {
    const picture = await makeVideo(dir, "picture.mp4", { width: 160, height: 90, duration: 3 });
    const tone = await makeAudio(dir, "tone.wav", { hz: 440, duration: 1, amplitude: 0.5 });
    const mixed = await build([
      { file: picture, position: 0, end: 3 },
      { file: tone, position: 0, end: 1, layer: 2_000_000 },
    ]);
    const result = await measureMix(mixed, { resolveMedia: (p) => p });
    expect(result.lufs).not.toBeNull();
    expect(result.lufs!).toBeGreaterThan(-30);
    expect(result.lufs!).toBeLessThan(-5);
    expect(result.peakDb!).toBeLessThan(0);
    expect(result.silences).toHaveLength(1);
    expect(result.silences[0]!.start).toBeGreaterThan(0.9);
    expect(result.silences[0]!.start).toBeLessThan(1.2);
    expect(result.silences[0]!.end).toBeGreaterThan(2.8);
    expect(result.pcm.sampleRate).toBe(22050);
    expect(result.pcm.samples.length / 22050).toBeGreaterThan(2.8);

    const part = await measureMix(mixed, { resolveMedia: (p) => p, range: { start: 2, end: 3 } });
    expect(part.silences[0]!.start).toBeCloseTo(2, 1);
    expect(part.lufs).toBeNull();
    expect(liveChildCount()).toBe(0);
  }, 90_000);
});

describe("parseMixLog", () => {
  const log = [
    "[silencedetect @ 0x1] silence_start: 1.02",
    "[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.48",
    "[silencedetect @ 0x1] silence_start: 8.1",
    "[Parsed_ebur128_0 @ 0x2] Summary:",
    "",
    "  Integrated loudness:",
    "    I:         -14.2 LUFS",
    "    Threshold: -24.3 LUFS",
    "",
    "  Loudness range:",
    "    LRA:         5.3 LU",
    "",
    "  True peak:",
    "    Peak:       -1.26 dBFS",
  ].join("\n");

  it("reads loudness, peak and silences, offset to the timeline, closing a silence that runs to the end", () => {
    expect(parseMixLog(log, 10, 9)).toEqual({ lufs: -14.2, peakDb: -1.3, silences: [{ start: 11.02, end: 12.5 }, { start: 18.1, end: 19 }] });
  });

  it("gives null for a silent mix", () => {
    expect(parseMixLog("    I:         -inf LUFS\n    Peak:       -inf dBFS", 0, 1)).toMatchObject({ lufs: null, peakDb: null });
  });
});
