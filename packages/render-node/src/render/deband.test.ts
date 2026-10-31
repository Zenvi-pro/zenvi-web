import { bandingOf } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { ffprobeJson, makeTempDir, removeDir } from "../test-support/fixtures.js";
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
  // A ramp drawn by geq, not lavfi's gradients source: that one seeds itself at random, so its ramp moves between runs.
  const src = `nullsrc=s=${W}x${H}:d=1,geq=r='14+X*28/W':g='17+X*31/W':b='22+X*30/W',format=gbrp`;
  await runBinary(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", src, "-frames:v", "1", "-vf", vf, "-c:v", "libx264", "-crf", "14", "-y", out]);
  const raw = await runBinary(ffmpeg, ["-v", "error", "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
  last = out;
  return raw.stdout;
}
let last = "";

describe("the deband pass (cinetic's dithered gradients)", () => {
  it("turns a banded 8-bit gradient into one the banding check passes", async () => {
    const plain = bandingOf({ width: W, height: H, data: await roundTrip(TO_YUV("yuv420p")) });
    const dithered = bandingOf({ width: W, height: H, data: await roundTrip(TO_YUV("yuv420p", true)) });
    expect(plain.area).toBeGreaterThan(0.03);
    expect(dithered.area).toBeLessThan(plain.area / 4);
    // BT.709 in the file itself, primaries and transfer too (cinetic's probe.py gate).
    const probe = await ffprobeJson(last);
    const v = probe.streams.find((s) => s.codec_type === "video") as Record<string, unknown>;
    expect([v.color_space, v.color_primaries, v.color_transfer]).toEqual(["bt709", "bt709", "bt709"]);
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
