import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import { sampleFrames } from "./sample-frames.js";

const exec = promisify(execFile);
let dir: string;
let numbered: string;

/** The frame number a decoded rgb24 frame shows (luma Y = 16 + 6n: steps wide enough to survive the RGB conversion). */
function frameNumber(rgb: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < rgb.length; i += 3) sum += rgb[i]!;
  const v = sum / (rgb.length / 3);
  return Math.round((v * 219) / 255 / 6);
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-sample-frames-");
  numbered = path.join(dir, "numbered.mp4");
  await exec(resolveBinary("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "nullsrc=s=64x48:r=30:d=1.2,geq=lum='16+6*N':cb=128:cr=128",
    "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p", numbered,
  ]);
});

afterAll(() => removeDir(dir));

describe("sampleFrames", () => {
  it("decodes a stretch at the requested spacing and size in one pass", async () => {
    const frames = await sampleFrames(numbered, { start: 0.5, end: 1, every: 0.1, width: 32, height: 18 });
    expect(frames).toHaveLength(6);
    expect(frames.every((f) => f.length === 32 * 18 * 3)).toBe(true);
    expect(frames.map(frameNumber)).toEqual([15, 18, 21, 24, 27, 30]);
  });

  it("gives every frame at the frame rate, the last one included", async () => {
    const frames = await sampleFrames(numbered, { start: 1, end: 1 + 4 / 30, every: 1 / 30, width: 8, height: 6 });
    expect(frames.map(frameNumber)).toEqual([30, 31, 32, 33, 34]);
  });

  it("refuses requests that make no sense", async () => {
    await expect(sampleFrames(numbered, { start: 1, end: 0.5, every: 0.1, width: 8, height: 6 })).rejects.toThrow(RangeError);
    await expect(sampleFrames(numbered, { start: 0, end: 3600, every: 0.001, width: 8, height: 6 })).rejects.toThrow(/max/);
  });
});
