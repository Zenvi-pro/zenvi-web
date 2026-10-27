import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INSPECT_THRESHOLDS } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import { inspectRender, parseInspectLog } from "./inspect-render.js";

const exec = promisify(execFile);

describe("parseInspectLog", () => {
  it("reads every detector's lines and closes a stretch still open at the end", () => {
    const log = [
      "[Parsed_scdet_2 @ 0x1] lavfi.scd.score: 33.285, lavfi.scd.time: 2",
      "[Parsed_silencedetect_0 @ 0x2] silence_start: 1.5",
      "[Parsed_silencedetect_0 @ 0x2] silence_end: 1.9 | silence_duration: 0.4",
      "[Parsed_freezedetect_1 @ 0x3] lavfi.freezedetect.freeze_start: 3",
      "[Parsed_blackdetect_0 @ 0x4] black_start:3 black_end:3.966667 black_duration:0.966667",
      "[Parsed_ebur128_0 @ 0x5] Summary:",
      "  Integrated loudness:",
      "    I:         -10.3 LUFS",
      "  Loudness range:",
      "    LRA:         2.3 LU",
      "  True peak:",
      "    Peak:        0.9 dBFS",
    ].join("\n");
    expect(parseInspectLog(log, 4, true)).toEqual({
      black: [{ start: 3, end: 3.967 }],
      frozen: [{ start: 3, end: 4 }],
      cuts: [{ time: 2, score: 33.3 }],
      silences: [{ start: 1.5, end: 1.9 }],
      loudness: { integratedLufs: -10.3, rangeLu: 2.3, truePeakDb: 0.9 },
    });
  });

  it("reports silent audio as unmeasured and no audio as none", () => {
    const silent = "Summary:\n    I:         -70.0 LUFS\n    LRA:         0.0 LU\n    Peak:       -inf dBFS";
    expect(parseInspectLog(silent, 2, true).loudness).toEqual({ integratedLufs: null, rangeLu: null, truePeakDb: null });
    expect(parseInspectLog(silent, 2, false).loudness).toBeNull();
  });
});

describe("inspectRender", { timeout: 60_000 }, () => {
  let dir: string;
  beforeAll(async () => {
    dir = await makeTempDir("zenvi-inspect-");
  });
  afterAll(() => removeDir(dir));

  it("finds the cut, the black end and the loudness of a real file", async () => {
    const file = path.join(dir, "endblack.mp4");
    const args =
      "-hide_banner -loglevel error -y -f lavfi -i testsrc2=s=320x180:r=30:d=2 -f lavfi -i color=black:s=320x180:r=30:d=1 " +
      "-f lavfi -i sine=f=440:d=3:sample_rate=48000 -filter_complex [0:v][1:v]concat=n=2:v=1:a=0[v] -map [v] -map 2:a " +
      "-c:v libx264 -pix_fmt yuv420p -c:a aac";
    await exec(resolveBinary("ffmpeg"), [...args.split(" "), file]);
    const found = await inspectRender(file, INSPECT_THRESHOLDS);
    expect(found).toMatchObject({ path: file, width: 320, height: 180, fps: 30, hasAudio: true });
    expect(found.duration).toBeCloseTo(3, 1);
    expect(found.cuts.map((c) => c.time)).toEqual([2]);
    expect(found.black).toHaveLength(1);
    expect(found.black[0]!.start).toBeCloseTo(2, 1);
    expect(found.black[0]!.end).toBeGreaterThan(2.9);
    expect(found.loudness!.integratedLufs).toBeLessThan(-10);
    expect(found.loudness!.truePeakDb).toBeLessThan(0);
  });
});
