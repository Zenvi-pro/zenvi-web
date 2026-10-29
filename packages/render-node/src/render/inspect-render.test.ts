import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INSPECT_THRESHOLDS } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import { inspectRender, parseInspectLog, parsePictureSeries, PICTURE_FPS } from "./inspect-render.js";

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

describe("parsePictureSeries", () => {
  it("joins each sample's four keys and maps studio range to 0-1 and -1..1", () => {
    const sample = (t: number, y: number, u: number, v: number, d: number): string[] => [
      `[Parsed_metadata_5 @ 0x1] frame:0    pts:0       pts_time:${t}`,
      `[Parsed_metadata_5 @ 0x1] lavfi.signalstats.YAVG=${y}`,
      `[Parsed_metadata_6 @ 0x2] frame:0    pts:0       pts_time:${t}`,
      `[Parsed_metadata_6 @ 0x2] lavfi.signalstats.UAVG=${u}`,
      `[Parsed_metadata_7 @ 0x3] frame:0    pts:0       pts_time:${t}`,
      `[Parsed_metadata_7 @ 0x3] lavfi.signalstats.VAVG=${v}`,
      `[Parsed_metadata_8 @ 0x4] frame:0    pts:0       pts_time:${t}`,
      `[Parsed_metadata_8 @ 0x4] lavfi.signalstats.YDIF=${d}`,
    ];
    const log = [...sample(0, 16, 128, 128, 0), ...sample(0.0667, 235, 240, 16, 21.9), "[Parsed_metadata_5 @ 0x1] frame:2 pts:2 pts_time:0.1333"].join("\n");
    expect(parsePictureSeries(log)).toEqual({ fps: PICTURE_FPS, t: [0, 0.067], luma: [0, 1], u: [0, 1], v: [0, -1], motion: [0, 0.1] });
    expect(parsePictureSeries("nothing here")).toBeNull();
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
    // The sampled picture: the test card is bright and moving, then black and still.
    const pic = found.picture!;
    expect(pic.t.length).toBeGreaterThan(40);
    const at = (s: number): number => pic.t.findIndex((t) => t >= s);
    expect(pic.luma[at(1)]!).toBeGreaterThan(0.2);
    expect(pic.motion[at(1)]!).toBeGreaterThan(0.001);
    expect(pic.luma[at(2.6)]!).toBeLessThan(0.02);
    expect(pic.motion[at(2.6)]!).toBe(0);
  });
});
