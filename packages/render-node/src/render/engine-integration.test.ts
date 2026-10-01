/**
 * renderProject / renderFrame with the engine's real planner and CPU
 * compositor (@zenvi/engine/render): frame-exact output end to end.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { addClip, addFile, createProject, ProjectDocument, type Project } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { liveChildCount } from "../ffmpeg/process.js";
import { probe } from "../probe/probe.js";
import { encodePng } from "../image/png.js";
import { createRgba } from "../image/rgba.js";
import { decodeRgba, ffprobeJson, makeTempDir, removeDir } from "../test-support/fixtures.js";
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

async function project(clips: Array<{ file: string; position: number; start?: number; end?: number }>): Promise<Project> {
  const doc = new ProjectDocument(createProject({ profile: "HD 720p 30 fps" }));
  for (const c of clips) {
    const info = await probe(c.file);
    doc.transaction("add", (tx) => {
      const file = addFile(tx, { path: c.file, info });
      addClip(tx, { fileId: file.id, position: c.position, layer: doc.project.layers[0]!.number, start: c.start, end: c.end });
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

  it("draws still images (natural size, scaled by the compositor)", async () => {
    const image = await renderFrameImage(await project([{ file: still, position: 0, end: 1 }]), 0.5, { resolveMedia: (p) => p, width: 160 });
    const center = Array.from(image.data.subarray(((45 * 160) + 80) * 4, ((45 * 160) + 80) * 4 + 4));
    expect(center).toEqual([255, 255, 255, 255]);
    const back = await decodeRgba(still, { width: 4, height: 3 });
    expect(back[0]).toBe(255);
  });
});
