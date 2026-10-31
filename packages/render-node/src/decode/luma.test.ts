import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectActions } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import { NoVideoError, decodeLuma } from "./luma.js";

const exec = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await makeTempDir();
});
afterAll(async () => {
  await removeDir(dir);
});

describe("decodeLuma", () => {
  it("decodes small grey frames at the asked rate from an accurate seek", async () => {
    const file = path.join(dir, "src.mp4");
    await exec(resolveBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3", "-pix_fmt", "yuv420p", "-y", file]);
    const luma = await decodeLuma(file, { width: 64, height: 36, fps: 30, startSeconds: 1, maxSeconds: 1 });
    expect(luma).toMatchObject({ fps: 30, width: 64, height: 36, startSeconds: 1 });
    expect(luma.frames).toHaveLength(30);
    expect(luma.frames[0]).toHaveLength(64 * 36);
    // testsrc2 moves every frame: the motion analysis sees it.
    let changed = 0;
    for (let p = 0; p < 64 * 36; p += 1) if (Math.abs(luma.frames[1]![p]! - luma.frames[0]![p]!) > 8) changed += 1;
    expect(changed).toBeGreaterThan(20);
    expect(Array.isArray(detectActions(luma))).toBe(true);
  });

  it("names a file without a picture", async () => {
    const file = path.join(dir, "tone.wav");
    await exec(resolveBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-y", file]);
    await expect(decodeLuma(file, { width: 32, height: 18, fps: 25 })).rejects.toBeInstanceOf(NoVideoError);
  });
});
