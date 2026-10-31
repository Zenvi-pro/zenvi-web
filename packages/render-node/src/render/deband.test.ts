import { bandingOf } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import { encoderCommand, TO_YUV } from "./encoder.js";

let dir: string;
beforeAll(async () => {
  dir = await makeTempDir("zenvi-deband-");
});
afterAll(() => removeDir(dir));

const W = 640;
const H = 360;

/** A dark 8-bit gradient through `vf`, encoded as H.264 and decoded back to RGBA. */
async function roundTrip(vf: string): Promise<Buffer> {
  const ffmpeg = resolveBinary("ffmpeg");
  const out = `${dir}/g-${Math.random().toString(36).slice(2)}.mp4`;
  const src = `gradients=s=${W}x${H}:c0=0x0e1116:c1=0x2a3640:x0=0:y0=0:x1=${W}:y1=0:d=1:speed=0`;
  await runBinary(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", src, "-frames:v", "1", "-vf", vf, "-c:v", "libx264", "-crf", "14", "-y", out]);
  const raw = await runBinary(ffmpeg, ["-v", "error", "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
  return raw.stdout;
}

describe("the deband pass (cinetic's dithered gradients)", () => {
  it("turns a banded 8-bit gradient into one the banding check passes", async () => {
    const plain = bandingOf({ width: W, height: H, data: await roundTrip(TO_YUV("yuv420p")) });
    const dithered = bandingOf({ width: W, height: H, data: await roundTrip(TO_YUV("yuv420p", true)) });
    expect(plain.area).toBeGreaterThan(0.03);
    expect(dithered.area).toBeLessThan(plain.area / 4);
  });

  it("is in the H.264 chain when asked, tagged BT.709, and never on alpha ProRes", () => {
    const job = (options: Record<string, unknown>) =>
      encoderCommand({ format: "mp4", output: `${dir}/x.mp4`, video: { width: W, height: H, fps: { num: 30, den: 1 } }, options: { format: "mp4", width: W, height: H, fps: { num: 30, den: 1 }, ...options }, ffmpegMajor: 7, scriptPath: `${dir}/s.txt` }).args.join(" ");
    expect(job({ deband: true })).toMatch(/deband=.*sws_dither=a_dither.*noise=/);
    expect(job({ deband: true })).toContain("-color_primaries bt709");
    expect(job({})).not.toMatch(/deband=|noise=/);
    expect(job({ deband: true, videoCodec: "prores_ks", quality: "lossless" })).not.toMatch(/deband=/);
  });
});
