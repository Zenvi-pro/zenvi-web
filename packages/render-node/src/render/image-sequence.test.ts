/**
 * Image sequences on the CLI host: import_image_sequence_tool reads a folder
 * of numbered frames, the probe reads the `%04d` pattern like FFmpegReader,
 * and the decoder plays one image per frame at the file's frame rate, so a
 * render matches the desktop's libopenshot Timeline pixel for pixel.
 */

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { addClip, createProject, findProfile, ProjectDocument } from "@zenvi/engine";
import { runTool, type ToolReceipt } from "@zenvi/engine/tools";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { createNodeHost } from "../host/node-host.js";
import { probe } from "../probe/probe.js";
import { libopenshotReaderJson, libopenshotTimelineFrames, makeTempDir, removeDir } from "../test-support/fixtures.js";
import { renderFrameImage } from "./render-frame.js";

const exec = promisify(execFile);
let dir: string;
let frames: string;

/** Frame N of the sequence is gray 16 + 12N (lossless PNG), so a pixel tells which image is shown. */
beforeAll(async () => {
  dir = await makeTempDir("zenvi-sequence-");
  frames = path.join(dir, "frames");
  await mkdir(frames, { recursive: true });
  await exec(resolveBinary("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "nullsrc=s=320x180:r=24:d=1,geq=lum='16+12*N':cb=128:cr=128",
    "-frames:v", "12", "-start_number", "1", path.join(frames, "shot_%04d.png"),
  ]);
}, 60_000);

afterAll(() => removeDir(dir));

function project320(): ProjectDocument {
  const base = findProfile("HD 720p 30 fps")!;
  return new ProjectDocument(createProject({ profile: { ...base, key: "test-320x180", description: "Test 320x180", width: 320, height: 180 } }));
}

describe("image sequences on the CLI host", () => {
  it("probes a frame pattern like libopenshot's FFmpegReader", async () => {
    const pattern = path.join(frames, "shot_%04d.png");
    const { media_type: _mediaType, ...info } = await probe(pattern);
    expect(info).toMatchObject({ type: "FFmpegReader", path: pattern, video_length: 12, fps: { num: 25, den: 1 }, file_size: -1, has_single_image: false, width: 320, height: 180 });
    const oracle = await libopenshotReaderJson([pattern]);
    if (oracle) expect(info).toEqual(oracle[pattern]);
    await expect(probe(path.join(dir, "none", "x_%04d.png"))).rejects.toThrow(/not found/i);
  });

  it("imports through the tool and renders one image per frame at 24 fps, like libopenshot's Timeline", async (t) => {
    const doc = project320();
    const host = createNodeHost({ projectFile: path.join(dir, "seq.zvn") });
    const result = await runTool({ doc, host }, "import_image_sequence_tool", { path: frames, fps: "24", name: "Shots" });
    const receipt = result.data as ToolReceipt;
    expect(receipt.summary).toBe("Imported 12 frames of shot_%04d.png as one 24 fps sequence (0.50s). Place it with add_clip_to_timeline_tool.");
    const fileId = (receipt.data as { file_id: string }).file_id;
    const file = doc.project.files.find((f) => f.id === fileId)!;
    expect(file).toMatchObject({ path: path.join(frames, "shot_%04d.png"), media_type: "video", fps: { num: 24, den: 1 }, video_timebase: { num: 1, den: 24 }, video_length: 12 });
    // What the media check and a second import see.
    expect(await host.media!.missing!([file])).toEqual([false]);
    const again = (await runTool({ doc, host }, "import_image_sequence_tool", { path: path.join(frames, "shot_0003.png") })).data as ToolReceipt;
    expect(again.status).toBe("unchanged");

    doc.transaction("place", (tx) => addClip(tx, { fileId, position: 0, layer: doc.project.layers[0]!.number }));
    const timelineFrames = [1, 2, 5, 9, 13, 15];
    const resolveMedia = (p: string) => p;
    const ours = new Map<number, Uint8Array | Uint8ClampedArray>();
    for (const n of timelineFrames) ours.set(n, (await renderFrameImage(doc.project, (n - 1) / 30, { resolveMedia, width: 320 })).data);
    // Image N is gray (16 + 12N) in limited range: every frame shows one image, in order, ending on the last.
    const imageShown = (n: number) => Math.round((ours.get(n)![0]! * 219) / 255 / 12);
    const shown = timelineFrames.map(imageShown);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
    expect([shown[0], shown[shown.length - 1]]).toEqual([0, 11]);
    const reference = await libopenshotTimelineFrames(doc.project, timelineFrames, { highQuality: true });
    if (!reference) {
      t.skip(); // libopenshot's Python bindings are not installed here
      return;
    }
    for (const n of timelineFrames) {
      const theirs = reference.get(n)!.data;
      let max = 0;
      const mine = ours.get(n)!;
      for (let i = 0; i < mine.length; i += 1) max = Math.max(max, Math.abs(mine[i]! - theirs[i]!));
      expect(max, `timeline frame ${n}`).toBe(0);
    }
  }, 120_000);
});
