import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { liveChildCount } from "../ffmpeg/process.js";
import { encodePng } from "../image/png.js";
import { createRgba } from "../image/rgba.js";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import { decodeStill } from "./still.js";
import { VideoDecoder, videoDecodeArgs } from "./video.js";

const exec = promisify(execFile);
let dir: string;
let numbered: string;
let numberedTs: string;
let ntsc: string;

/** Frames whose luma encodes the frame number: Y = 16 + 3n, lossless. */
async function numberedVideo(file: string, fps: string, seconds: number, extra: string[] = []): Promise<string> {
  await exec(resolveBinary("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `nullsrc=s=64x48:r=${fps}:d=${seconds},geq=lum='16+3*N':cb=128:cr=128`,
    "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "12", "-bf", "2",
    ...extra, file,
  ]);
  return file;
}

/**
 * Red value of frame n (luma 16 + 3n) per decode size, after swscale's
 * YUV → RGBA conversion with the decoder's flags (same-size conversion and
 * scaling round differently), measured with plain ffmpeg so the test does
 * not depend on swscale's rounding.
 */
const levels = new Map<string, number[]>();

async function measureLevels(file: string, width: number, height: number): Promise<void> {
  const { stdout } = await exec(
    resolveBinary("ffmpeg"),
    ["-v", "error", "-i", file, "-vf", `scale=${width}:${height}:flags=bicubic,format=rgba`, "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 64 << 20 },
  );
  const bytes = width * height * 4;
  const out: number[] = [];
  for (let o = 0; o + bytes <= stdout.length; o += bytes) out.push(stdout[o]!);
  levels.set(`${width}x${height}`, out);
}

/** Frame number of a decoded frame: the frame whose measured level is closest. */
function frameNumber(image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }): number {
  const table = levels.get(`${image.width}x${image.height}`);
  if (!table) throw new Error(`no levels measured for ${image.width}x${image.height}`);
  const r = image.data[0]!;
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  table.forEach((level, n) => {
    if (Math.abs(level - r) < distance) [best, distance] = [n, Math.abs(level - r)];
  });
  return best;
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-decode-");
  numbered = await numberedVideo(path.join(dir, "numbered.mp4"), "30", 2);
  numberedTs = await numberedVideo(path.join(dir, "numbered.ts"), "25", 2);
  ntsc = await numberedVideo(path.join(dir, "ntsc.mp4"), "30000/1001", 2);
  for (const [w, h] of [[64, 48], [32, 24], [16, 12]] as const) await measureLevels(numbered, w, h);
}, 60_000);

afterAll(() => removeDir(dir));

describe("VideoDecoder", () => {
  it("returns exactly the requested source frame, sequentially and after seeks", async () => {
    const decoder = new VideoDecoder({ path: numbered, fps: { num: 30, den: 1 }, frameCount: 60 }, { width: 64, height: 48 }, { cacheFrames: 4 });
    try {
      for (let n = 0; n < 12; n += 1) {
        const img = await decoder.frame(n);
        expect(frameNumber(img), `frame ${n}`).toBe(n);
      }
      expect(decoder.restarts).toBe(1);
      // forward skip within the window reuses the stream
      expect(frameNumber(await decoder.frame(20))).toBe(20);
      expect(decoder.restarts).toBe(1);
      // a small backward step is served from the cache of recent frames
      expect(frameNumber(await decoder.frame(19))).toBe(19);
      expect(decoder.restarts).toBe(1);
      // a backward jump restarts a little before the target…
      expect(frameNumber(await decoder.frame(8))).toBe(8);
      expect(decoder.restarts).toBe(2);
      // …so the next backward steps hit the cache
      expect(frameNumber(await decoder.frame(7))).toBe(7);
      expect(frameNumber(await decoder.frame(6))).toBe(6);
      expect(decoder.restarts).toBe(2);
      // far jump restarts at the target
      expect(frameNumber(await decoder.frame(55))).toBe(55);
      // past the end clamps to the last frame, like libopenshot
      expect(frameNumber(await decoder.frame(500))).toBe(59);
    } finally {
      await decoder.close();
    }
  });

  it("counts frames from the video stream start (non-zero container start time)", async () => {
    const decoder = new VideoDecoder({ path: numberedTs, fps: { num: 25, den: 1 }, frameCount: 50 }, { width: 32, height: 24 });
    try {
      const { stdout } = await exec(resolveBinary("ffprobe"), ["-v", "error", "-show_entries", "stream=start_time:format=start_time", "-of", "json", numberedTs]);
      const parsed = JSON.parse(stdout) as { streams: Array<{ start_time: string }>; format: { start_time: string } };
      const videoStart = Number(parsed.streams[0]!.start_time);
      expect(videoStart).toBeGreaterThan(0.5);
      await decoder.close();
      const withStart = new VideoDecoder(
        { path: numberedTs, fps: { num: 25, den: 1 }, frameCount: 50, videoStart, formatStart: Number(parsed.format.start_time) },
        { width: 32, height: 24 },
      );
      try {
        for (const n of [0, 1, 13, 37]) expect(frameNumber(await withStart.frame(n)), `frame ${n}`).toBe(n);
      } finally {
        await withStart.close();
      }
    } finally {
      await decoder.close();
    }
  });

  it("handles NTSC rates without drifting", async () => {
    const decoder = new VideoDecoder({ path: ntsc, fps: { num: 30000, den: 1001 } }, { width: 64, height: 48 });
    try {
      for (const n of [0, 29, 30, 31, 57]) expect(frameNumber(await decoder.frame(n)), `frame ${n}`).toBe(n);
    } finally {
      await decoder.close();
    }
  });

  it("builds a seek a quarter frame early and shifts timestamps back", () => {
    const args = videoDecodeArgs({ path: "/x.mp4", fps: { num: 25, den: 1 } }, 50, { width: 10, height: 10 });
    expect(args[args.indexOf("-ss") + 1]).toBe("1.990000");
    expect(args[args.indexOf("-vf") + 1]).toContain("setpts=PTS-0.010000000/TB,fps=fps=25/1:start_time=0:round=near");
    expect(videoDecodeArgs({ path: "/x.mp4", fps: { num: 25, den: 1 } }, 0, { width: 10, height: 10 })).not.toContain("-ss");
  });

  it("leaves no ffmpeg children behind", async () => {
    const decoder = new VideoDecoder({ path: numbered, fps: { num: 30, den: 1 } }, { width: 16, height: 12 });
    await decoder.frame(3);
    await decoder.close();
    expect(liveChildCount()).toBe(0);
  });
});

describe("decodeStill", () => {
  it("decodes an image at the requested size", async () => {
    const blue = createRgba(40, 20);
    for (let i = 0; i < blue.data.length; i += 4) blue.data.set([0x33, 0x66, 0xcc, 255], i);
    await writeFile(path.join(dir, "blue.png"), encodePng(blue));
    const img = await decodeStill(path.join(dir, "blue.png"), { width: 20, height: 10 });
    expect([img.width, img.height]).toEqual([20, 10]);
    expect(Array.from(img.data.subarray(0, 4))).toEqual([0x33, 0x66, 0xcc, 255]);
  });
});
