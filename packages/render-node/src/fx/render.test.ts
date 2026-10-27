import path from "node:path";
import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FX_IDS, parseFxStack, type FxEffect } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { createFxRenderer, probeFxSource } from "./render.js";

const ffmpeg = resolveBinary("ffmpeg");
const ffprobe = resolveBinary("ffprobe");

let dir: string;
let clip: string;
let alphaClip: string;

function stack(raw: unknown[], duration = 2): FxEffect[] {
  const parsed = parseFxStack(raw, duration);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.effects;
}

function renderer(out = "out") {
  return createFxRenderer({ ffmpeg, ffprobe, outputDir: () => path.join(dir, out), resolveMedia: (p) => p, hwaccel: false });
}

async function streams(file: string): Promise<{ codec_type: string; codec_name: string; pix_fmt?: string; nb_read_frames?: string; profile?: string; duration?: string }[]> {
  const { stdout } = await runBinary(ffprobe, ["-v", "error", "-count_frames", "-show_streams", "-of", "json", file]);
  return (JSON.parse(stdout.toString("utf8")) as { streams: never[] }).streams;
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-fx-");
  clip = await makeVideo(dir, "src.mp4", { width: 320, height: 180, fps: "30", duration: 3, audioHz: 440 });
  alphaClip = await makeVideo(dir, "alpha.mov", {
    width: 160,
    height: 90,
    duration: 1,
    source: "testsrc2=size=160x90:rate=30:duration=1,format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,80),255,0)'",
    codecArgs: ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"],
  });
});

afterAll(async () => removeDir(dir));

describe("Zenvi FX renderer", () => {
  it("probes size, rate, alpha and audio", async () => {
    expect(await probeFxSource(ffprobe, clip)).toMatchObject({ width: 320, height: 180, fps: { num: 30, den: 1 }, alpha: false, audio: true, codec: "h264" });
    expect(await probeFxSource(ffprobe, alphaClip)).toMatchObject({ alpha: true, audio: false });
  });

  it("renders every effect to ProRes 422 HQ with the range's frames and audio", async () => {
    const fx = renderer("each");
    for (const id of FX_IDS.filter((e) => e !== "optical_flow_slowmo")) {
      const r = await fx.render({ path: clip, start: 1, end: 2, effects: stack([{ effect: id }], 1) });
      expect(r, id).toMatchObject({ codec: "prores422", width: 320, height: 180, frames: 30, cached: false });
      const [video, audio] = await streams(r.path);
      expect(video, id).toMatchObject({ codec_name: "prores", pix_fmt: "yuv422p10le", nb_read_frames: "30" });
      expect(audio, id).toMatchObject({ codec_type: "audio", codec_name: "pcm_s16le" });
    }
  }, 120_000);

  it("keeps every frame when an effect has a window", async () => {
    const r = await renderer().render({ path: clip, start: 0, end: 2, effects: stack([{ effect: "glitch", start: 0.5, end: 1 }, { effect: "echo", start: 1.2 }]) });
    expect((await streams(r.path))[0]?.nb_read_frames).toBe("60");
  }, 60_000);

  it("serves the same stack from the cache and renders a changed one", async () => {
    const fx = renderer("cache");
    const effects = stack([{ effect: "bloom" }]);
    const first = await fx.render({ path: clip, start: 0, end: 1, effects });
    const again = await fx.render({ path: clip, start: 0, end: 1, effects });
    expect(again).toMatchObject({ cached: true, path: first.path, fingerprint: first.fingerprint, seconds: 0 });
    const other = await fx.render({ path: clip, start: 0, end: 1, effects: stack([{ effect: "bloom", amount: 0.9 }]) });
    expect(other.fingerprint).not.toBe(first.fingerprint);
    // No partial files are left behind.
    expect((await readdir(path.join(dir, "cache"))).filter((f) => f.startsWith("."))).toEqual([]);
  }, 60_000);

  it("keeps alpha in ProRes 4444", async () => {
    const r = await renderer().render({ path: alphaClip, start: 0, end: 1, effects: stack([{ effect: "bloom" }, { effect: "chromatic_aberration" }], 1) });
    expect(r.codec).toBe("prores4444");
    expect((await streams(r.path))[0]).toMatchObject({ pix_fmt: expect.stringMatching(/^yuva444p1[02]le$/), nb_read_frames: "30" });
  }, 60_000);

  it("slows down video and audio together", async () => {
    const r = await renderer().render({ path: clip, start: 0, end: 1, effects: stack([{ effect: "optical_flow_slowmo", params: { speed: 0.5, method: "blend" } }], 1) });
    expect(r.frames).toBe(60);
    const [video, audio] = await streams(r.path);
    expect(video?.nb_read_frames).toBe("60");
    // atempo ends on its last whole block, a few tens of milliseconds short.
    expect(Number(audio?.duration)).toBeGreaterThan(1.9);
  }, 60_000);

  it("refuses a missing source and a range past its end", async () => {
    await expect(renderer().render({ path: path.join(dir, "nope.mp4"), start: 0, end: 1, effects: stack([{ effect: "bloom" }]) })).rejects.toThrow(/missing/);
    await expect(renderer().render({ path: clip, start: 5, end: 6, effects: stack([{ effect: "bloom" }]) })).rejects.toThrow(/outside/);
  });
});
