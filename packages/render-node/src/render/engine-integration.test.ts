/**
 * renderProject / renderFrame with the engine's real planner and CPU
 * compositor (@zenvi/engine/render): frame-exact output end to end.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  addClip,
  addEffect,
  addFile,
  applyTransitionBetween,
  createProject,
  findProfile,
  ProjectDocument,
  setClipKeyframes,
  setClipProperty,
  type Project,
} from "@zenvi/engine";
import { runTool } from "@zenvi/engine/tools";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { liveChildCount } from "../ffmpeg/process.js";
import { probe } from "../probe/probe.js";
import { encodePng } from "../image/png.js";
import { createRgba } from "../image/rgba.js";
import { createMediaResolver } from "../host/paths.js";
import { engineAssetsDir } from "../resources.js";
import {
  audioRms,
  decodeRgba,
  ffprobeJson,
  libopenshotTimelineFrames,
  makeAudio,
  makeTempDir,
  makeVideo,
  removeDir,
} from "../test-support/fixtures.js";
import { renderFrameImage } from "./render-frame.js";
import { renderProject } from "./render-project.js";

const exec = promisify(execFile);
let dir: string;
let numbered: string;
let still: string;

/** Frame n has luma 16 + 3n (lossless), so a pixel tells which source frame it shows. */
async function numberedVideo(file: string): Promise<string> {
  await exec(resolveBinary("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "nullsrc=s=64x48:r=30:d=2,geq=lum='16+3*N':cb=128:cr=128",
    "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file,
  ]);
  return file;
}

const frameOf = (gray: number) => Math.round((gray * 219) / 255 / 3);

type ClipEdit = (tx: Parameters<Parameters<ProjectDocument["transaction"]>[1]>[0], clipId: string) => void;

async function project(clips: Array<{ file: string; position: number; start?: number; end?: number; edit?: ClipEdit }>): Promise<Project> {
  const doc = new ProjectDocument(createProject({ profile: "HD 720p 30 fps" }));
  for (const c of clips) {
    const info = await probe(c.file);
    doc.transaction("add", (tx) => {
      const file = addFile(tx, { path: c.file, info });
      const clip = addClip(tx, { fileId: file.id, position: c.position, layer: doc.project.layers[0]!.number, start: c.start, end: c.end });
      c.edit?.(tx, clip.id);
    });
  }
  return doc.project;
}

async function outputFrames(file: string, width: number, height: number): Promise<number[]> {
  const { stdout } = await exec(resolveBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  const frames: number[] = [];
  const size = width * height;
  for (let off = 0; off + size <= stdout.length; off += size) frames.push(stdout[off + (height >> 1) * width + (width >> 1)]!);
  return frames;
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-engine-render-");
  numbered = await numberedVideo(path.join(dir, "numbered.mp4"));
  const white = createRgba(40, 30);
  white.data.fill(255);
  still = path.join(dir, "still.png");
  await writeFile(still, encodePng(white));
}, 60_000);

afterAll(() => removeDir(dir));

describe("render with the engine planner and compositor", () => {
  it("renders every source frame exactly once, in order", async () => {
    const out = path.join(dir, "exact.mp4");
    const result = await renderProject(await project([{ file: numbered, position: 0 }]), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp4", width: 160, height: 90, fps: { num: 30, den: 1 }, quality: "lossless" },
    });
    expect(result.frames).toBe(60);
    const probeOut = await ffprobeJson(out);
    expect(probeOut.streams.find((s) => s.codec_type === "video")).toMatchObject({ width: 160, height: 90, nb_frames: "60" });
    const frames = (await outputFrames(out, 160, 90)).map(frameOf);
    expect(frames).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(liveChildCount()).toBe(0);
  });

  it("honours clip position and source in point", async () => {
    // Starts at 0.5 s on the timeline, playing the source from 0.2 s.
    const out = path.join(dir, "offset.mp4");
    await renderProject(await project([{ file: numbered, position: 0.5, start: 0.2, end: 1.2 }]), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp4", width: 160, height: 90, fps: { num: 30, den: 1 }, quality: "lossless" },
    });
    const frames = await outputFrames(out, 160, 90);
    expect(frames).toHaveLength(45); // ends at 1.5 s
    // Before the clip: background (black).
    expect(frames.slice(0, 15).every((g) => g < 20)).toBe(true);
    // Timeline frame 15 (t = 0.5 s) shows source time 0.2 s = source frame 6.
    expect(frames.slice(15).map(frameOf)).toEqual(Array.from({ length: 30 }, (_, i) => 6 + i));
  });

  it("previews one frame at a requested width", async () => {
    const image = await renderFrameImage(await project([{ file: numbered, position: 0 }]), 1.0, { resolveMedia: (p) => p, width: 320 });
    expect([image.width, image.height]).toEqual([320, 180]);
    const center = image.data[((90 * 320) + 160) * 4]!;
    expect(frameOf(center)).toBe(30);
  });

  it("mixes clip audio with its volume (planAudio)", async () => {
    const tone = await makeAudio(dir, "tone.wav", { hz: 1000, duration: 2, amplitude: 0.5, channels: 1 });
    const out = path.join(dir, "half.wav");
    const result = await renderProject(await project([{ file: tone, position: 0, edit: (tx, id) => setClipProperty(tx, id, "volume", 0.5) }]), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "wav", width: 160, height: 90, fps: { num: 30, den: 1 } },
    });
    expect(result.warnings).toEqual([]);
    // 0.5 sine, mono upmixed at -3 dB, gain 0.5 → 0.125
    const rms = await audioRms(out, { start: 0.2, duration: 1.5 });
    expect(rms).toBeGreaterThan(0.115);
    expect(rms).toBeLessThan(0.135);
  });

  it("follows volume keyframes (fade in)", async () => {
    const tone = await makeAudio(dir, "tone2.wav", { hz: 1000, duration: 2, amplitude: 0.5, channels: 2 });
    const out = path.join(dir, "fade.wav");
    const fade: ClipEdit = (tx, id) => setClipKeyframes(tx, id, "volume", [{ frame: 1, value: 0, interpolation: 1 }, { frame: 31, value: 1, interpolation: 1 }]);
    await renderProject(await project([{ file: tone, position: 0, edit: fade }]), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "wav", width: 160, height: 90, fps: { num: 30, den: 1 } },
    });
    const early = await audioRms(out, { start: 0.02, duration: 0.2 });
    const late = await audioRms(out, { start: 1.2, duration: 0.5 });
    expect(early).toBeLessThan(late * 0.3);
    // Full gain after the fade: the fixture's 0.5 sine is upmixed to stereo at -3 dB → RMS 0.25.
    expect(late).toBeGreaterThan(0.23);
    expect(late).toBeLessThan(0.27);
  });

  it("applies channel_filter and channel_mapping", async () => {
    const leftOnly = path.join(dir, "left.wav");
    await exec(resolveBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*1000*t)|0:s=48000:d=1", "-c:a", "pcm_s16le", leftOnly]);
    const out = path.join(dir, "swapped.wav");
    const route: ClipEdit = (tx, id) => {
      setClipProperty(tx, id, "channel_filter", 0);
      setClipProperty(tx, id, "channel_mapping", 1);
    };
    await renderProject(await project([{ file: leftOnly, position: 0, edit: route }]), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "wav", width: 160, height: 90, fps: { num: 30, den: 1 } },
    });
    expect(await audioRms(out, { start: 0.1, duration: 0.8 }, 0)).toBeLessThan(0.001);
    expect(await audioRms(out, { start: 0.1, duration: 0.8 }, 1)).toBeGreaterThan(0.3);
  });

  it("runs clip audio effects with the engine's DSP (Delay)", async () => {
    const blip = path.join(dir, "blip.wav");
    await exec(resolveBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*1000*t)*lt(t\\,0.3):s=48000:d=1.5", "-c:a", "pcm_s16le", blip]);
    const out = path.join(dir, "delayed-fx.wav");
    const result = await renderProject(await project([{ file: blip, position: 0, edit: (tx, id) => void addEffect(tx, id, "Delay", { delay_time: 0.5 }) }]), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "wav", width: 160, height: 90, fps: { num: 30, den: 1 } },
    });
    expect(result.warnings).toEqual([]);
    // The 0.3 s blip now starts 0.5 s later.
    expect(await audioRms(out, { start: 0.05, duration: 0.35 })).toBeLessThan(0.01);
    expect(await audioRms(out, { start: 0.55, duration: 0.2 })).toBeGreaterThan(0.1);
  });

  it("draws still images (natural size, scaled by the compositor)", async () => {
    const image = await renderFrameImage(await project([{ file: still, position: 0, end: 1 }]), 0.5, { resolveMedia: (p) => p, width: 160 });
    const center = Array.from(image.data.subarray(((45 * 160) + 80) * 4, ((45 * 160) + 80) * 4 + 4));
    expect(center).toEqual([255, 255, 255, 255]);
    const back = await decodeRgba(still, { width: 4, height: 3 });
    expect(back[0]).toBe(255);
  });
});

/** A project of `width`x`height` at 30 fps with the given clips (absolute paths). */
async function sizedProject(width: number, height: number, clips: Array<{ file: string; position: number }>): Promise<{ project: Project; clipIds: string[] }> {
  const base = findProfile("HD 720p 30 fps")!;
  const doc = new ProjectDocument(createProject({ profile: { ...base, key: `test-${width}x${height}`, description: `Test ${width}x${height}`, width, height } }));
  const clipIds: string[] = [];
  for (const c of clips) {
    const info = await probe(c.file);
    doc.transaction("add", (tx) => {
      const file = addFile(tx, { path: c.file, info });
      clipIds.push(addClip(tx, { fileId: file.id, position: c.position, layer: doc.project.layers[0]!.number }).id);
    });
  }
  return { project: doc.project, clipIds };
}

/** The project as libopenshot reads it: `@transitions/…` masks as absolute files. */
function forLibopenshot(project: Project): Project {
  const assets = engineAssetsDir()!;
  return JSON.parse(JSON.stringify(project).replaceAll('"@transitions/', JSON.stringify(`${assets}/transitions/`).slice(0, -1))) as Project;
}

function maxChannelDifference(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max;
}

describe("pixels match the desktop's libopenshot Timeline", () => {
  it("upscaled and native video through a mask transition, and a bicubic downscale: identical RGBA", async (t) => {
    const small = await makeVideo(dir, "parity-small.mp4", { width: 320, height: 180, duration: 1 });
    const native = await makeVideo(dir, "parity-native.mp4", { width: 640, height: 360, duration: 1, source: "smptebars=size=640x360:rate=30:duration=1" });
    const { project: up, clipIds } = await sizedProject(640, 360, [
      { file: small, position: 0 },
      { file: native, position: 1 },
    ]);
    const doc = new ProjectDocument(up);
    doc.transaction("transition", (tx) => applyTransitionBetween(tx, clipIds[0]!, clipIds[1]!, "fade", 0.5));
    const { project: down } = await sizedProject(320, 180, [{ file: native, position: 0 }]);

    const upFrames = [1, 18, 23, 28, 45];
    const reference = await libopenshotTimelineFrames(forLibopenshot(doc.project), upFrames, { highQuality: true });
    const referenceDown = await libopenshotTimelineFrames(forLibopenshot(down), [10], { highQuality: true });
    if (!reference || !referenceDown) {
      t.skip(); // libopenshot's Python bindings are not installed here
      return;
    }
    const resolveMedia = createMediaResolver({ projectFile: path.join(dir, "parity.zvn"), engineAssetsDir: engineAssetsDir() });
    for (const n of upFrames) {
      const ours = await renderFrameImage(doc.project, (n - 1) / 30, { resolveMedia, width: 640 });
      expect([ours.width, ours.height]).toEqual([640, 360]);
      expect(maxChannelDifference(ours.data, reference.get(n)!.data), `frame ${n}`).toBe(0);
    }
    const ours = await renderFrameImage(down, 9 / 30, { resolveMedia, width: 320 });
    expect(maxChannelDifference(ours.data, referenceDown.get(10)!.data), "downscaled frame 10").toBe(0);
  }, 120_000);
});

describe("the renders the skills workers doubted match libopenshot (sk2-product-brand)", () => {
  it("origin_x 0 pivots on the left edge, ChromaKey keys a green screen, a shadow wheel tints: identical RGBA", async (t) => {
    const base = await makeVideo(dir, "doubt-base.mp4", { width: 320, height: 180, duration: 1 });
    const screen = await makeVideo(dir, "doubt-screen.mp4", { width: 320, height: 180, duration: 1, source: "color=c=0x00ff00:size=320x180:rate=30:duration=1,drawbox=x=110:y=50:w=100:h=80:color=0xc8604e:t=fill" });
    const card = await makeVideo(dir, "doubt-card.mp4", { width: 320, height: 180, duration: 1, source: "color=c=white:size=320x180:rate=30:duration=1" });
    const { project, clipIds } = await sizedProject(320, 180, [
      { file: base, position: 0 },
      { file: screen, position: 0 },
      { file: card, position: 0 },
    ]);
    const doc = new ProjectDocument(project);
    const tops = [...doc.project.layers].sort((a, b) => a.number - b.number).map((l) => l.number);
    doc.transaction("stack", (tx) => {
      for (const [i, id] of clipIds.entries()) tx.update(["clips", { id }], { layer: tops[0]! + i * 1_000_000 });
    });
    const call = (name: string, args: Record<string, unknown>) => runTool({ doc, host: {} }, name, args);
    const [, keyed, wedge] = clipIds;
    for (const r of [
      await call("color_grade_clip_tool", { timeline_clip_id: clipIds[0], wheels: { shadows: { color: "#2a6cff", amount: 0.6 } } }),
      await call("add_effect_tool", { timeline_clip_id: keyed, effect: "ChromaKey", properties: { color: "#00ff00", fuzz: 40 } }),
      await call("set_clip_properties_tool", { timeline_clip_ids: [wedge], properties: { scale_x: 0.5, scale_y: 0.5, location_x: 0.25, origin_x: 0, origin_y: 0.5, rotation: 30 } }),
    ]) {
      expect(r.ok, r.text).toBe(true);
    }
    const reference = await libopenshotTimelineFrames(doc.project, [10], { highQuality: true });
    if (!reference) {
      t.skip(); // libopenshot's Python bindings are not installed here
      return;
    }
    const resolveMedia = createMediaResolver({ projectFile: path.join(dir, "doubt.zvn"), engineAssetsDir: engineAssetsDir() });
    const ours = await renderFrameImage(doc.project, 9 / 30, { resolveMedia, width: 320 });
    expect(maxChannelDifference(ours.data, reference.get(10)!.data)).toBe(0);
    // And each is visible: the key shows the base through the screen, the pivot is not the centre.
    const centre = await renderFrameImage({ ...doc.project, clips: doc.project.clips.map((c) => (c.id === wedge ? { ...c, origin_x: { Points: [{ co: { X: 1, Y: 0.5 }, interpolation: 0 }] } } : c)) } as Project, 9 / 30, { resolveMedia, width: 320 });
    expect(maxChannelDifference(ours.data, centre.data)).toBeGreaterThan(100);
    const px = (x: number, y: number) => [...ours.data.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)];
    expect(px(20, 20)[1]).toBeLessThan(200); // the green screen is keyed: testsrc2 shows there, not pure green
  }, 120_000);
});

describe("compositing on worker threads", () => {
  it("writes the same pixels as the main thread, stateful effects in order and per-frame ones on any worker", async () => {
    const a = await makeVideo(dir, "pool-a.mp4", { width: 160, height: 90, duration: 1 });
    const b = await makeVideo(dir, "pool-b.mp4", { width: 320, height: 180, duration: 1, source: "smptebars=size=320x180:rate=30:duration=1" });
    const { project: base, clipIds } = await sizedProject(320, 180, [
      { file: a, position: 0 },
      { file: b, position: 1 },
      { file: still, position: 0 },
    ]);
    const doc = new ProjectDocument(base);
    doc.transaction("edit", (tx) => {
      // DenoiseImage keeps the previous frame (temporal): frames must reach it in order.
      addEffect(tx, clipIds[0]!, "DenoiseImage");
      // Pure per frame: these frames may composite on any worker.
      addEffect(tx, clipIds[1]!, "FilmGrain");
      addEffect(tx, clipIds[1]!, "ColorGrade");
      applyTransitionBetween(tx, clipIds[0]!, clipIds[1]!, "fade", 0.5);
      setClipProperty(tx, clipIds[2]!, "alpha", 0.5);
      setClipProperty(tx, clipIds[2]!, "end", 1.5);
    });
    const resolveMedia = createMediaResolver({ projectFile: path.join(dir, "pool.zvn"), engineAssetsDir: engineAssetsDir() });
    const render = async (threads: number) => {
      const out = path.join(dir, `pool-${threads}`, "f.png");
      const result = await renderProject(doc.project, {
        resolveMedia,
        output: out,
        threads,
        options: { format: "png-sequence", width: 320, height: 180, fps: { num: 30, den: 1 } },
      });
      expect(result.stats.threads).toBe(threads);
      const names = (await readdir(path.dirname(out))).sort();
      return Promise.all(names.map((n) => readFile(path.join(path.dirname(out), n))));
    };
    const single = await render(0);
    const pooled = await render(3);
    expect(single.length).toBe(45);
    expect(pooled.length).toBe(single.length);
    pooled.forEach((png, i) => expect(png.equals(single[i]!), `frame ${i + 1}`).toBe(true));
    expect(liveChildCount()).toBe(0);
  }, 120_000);
});

