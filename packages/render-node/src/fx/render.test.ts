import path from "node:path";
import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FX_IDS, parseFxStack, type FxEffect } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { decodeRgba, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { createFxRenderer, probeFxSource } from "./render.js";

const ffmpeg = resolveBinary("ffmpeg");
const ffprobe = resolveBinary("ffprobe");

let dir: string;
let clip: string;
let alphaClip: string;
let still: string;
let moving: string;

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

beforeAll(async () => {
  // Footage before a cut: colour bars standing still, and the same bars racing sideways (about 6 px a frame).
  still = await makeVideo(dir, "still.mp4", { width: 320, height: 180, fps: "30", duration: 2, source: "smptebars=size=320x180:rate=30:duration=2" });
  moving = await makeVideo(dir, "moving.mp4", { width: 320, height: 180, fps: "30", duration: 2, source: "smptebars=size=320x180:rate=30:duration=2,scroll=horizontal=0.02" });
});

afterAll(async () => removeDir(dir));

/** Mean absolute difference per channel (0-255) between frame `seconds` of two movies. */
async function frameDiff(a: string, b: string, seconds: number): Promise<number> {
  const [x, y] = await Promise.all([decodeRgba(a, { seconds, width: 320, height: 180 }), decodeRgba(b, { seconds, width: 320, height: 180 })]);
  let sum = 0;
  for (let i = 0; i < x.length; i++) if (i % 4 !== 3) sum += Math.abs(x[i]! - y[i]!);
  return sum / ((x.length / 4) * 3);
}

describe("Zenvi FX renderer", () => {
  it("probes size, rate, alpha and audio", async () => {
    expect(await probeFxSource(ffprobe, clip)).toMatchObject({ width: 320, height: 180, fps: { num: 30, den: 1 }, alpha: false, audio: true, codec: "h264" });
    expect(await probeFxSource(ffprobe, alphaClip)).toMatchObject({ alpha: true, audio: false });
  });

  it("renders every effect to ProRes 422 HQ with the range's frames and audio", async () => {
    const fx = renderer("each");
    // optical_flow_slowmo changes the length and datamosh_carry needs the footage before the cut: both have their own tests.
    for (const id of FX_IDS.filter((e) => e !== "optical_flow_slowmo" && e !== "datamosh_carry")) {
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

  it("keeps alpha through the CRT and screenprint looks", async () => {
    const r = await renderer("alpha-looks").render({ path: alphaClip, start: 0, end: 1, effects: stack([{ effect: "crt", params: { bezel: "tv" } }, { effect: "print_ink" }], 1) });
    expect(r.codec).toBe("prores4444");
    expect((await streams(r.path))[0]).toMatchObject({ pix_fmt: expect.stringMatching(/^yuva444p1[02]le$/), nb_read_frames: "30" });
  }, 60_000);

  it("weighs an effect by its amount: a low amount stays near the source, a full one does not", async () => {
    const fx = renderer("amount");
    const faint = await fx.render({ path: clip, start: 0, end: 1, effects: stack([{ effect: "dither", amount: 0.1, params: { colors: 2 } }], 1) });
    const full = await fx.render({ path: clip, start: 0, end: 1, effects: stack([{ effect: "dither", amount: 1, params: { colors: 2 } }], 1) });
    const [near, far] = [await frameDiff(faint.path, clip, 0.5), await frameDiff(full.path, clip, 0.5)];
    expect(near).toBeLessThan(far / 3);
  }, 60_000);

  it("fits the CRT bezels and the screenprint to a portrait frame", async () => {
    const portrait = await makeVideo(dir, "portrait.mp4", { width: 180, height: 320, fps: "30", duration: 1 });
    for (const bezel of ["none", "rounded", "tv"]) {
      const r = await renderer("portrait").render({ path: portrait, start: 0, end: 1, effects: stack([{ effect: "crt", params: { bezel } }, { effect: "print_ink", amount: 0.5 }], 1) });
      expect(r, bezel).toMatchObject({ width: 180, height: 320, frames: 30 });
    }
  }, 60_000);

  it("renders the CRT and screenprint looks to something different from the source", async () => {
    const fx = renderer("looks");
    for (const effect of ["crt", "print_ink"]) {
      const r = await fx.render({ path: clip, start: 0, end: 1, effects: stack([{ effect }], 1) });
      expect(await frameDiff(r.path, clip, 0.5), effect).toBeGreaterThan(8);
    }
  }, 60_000);

  describe("datamosh carry", () => {
    /**
     * How far an untouched frame (1.5 s, long after the mosh) sits from the
     * source after the ProRes round trip. It depends on the ffmpeg build's
     * 4:2:0 chroma resampling: about 1 with ffmpeg 9, 3.4 with Ubuntu's 6.1.
     */
    const roundTripFloor = async (file: string): Promise<number> => {
      const floor = await frameDiff(file, clip, 1.5);
      expect(floor).toBeLessThan(4);
      return floor;
    };
    const mosh = (params: Record<string, unknown>, at = 1.5) => stack([{ effect: "datamosh_carry", params: { length: 0.5, ...params, carry: { file_id: "A", at } } }], 2);

    it("pushes the clip's first frames along the motion before the cut, then lands clean", async () => {
      const r = await renderer("mosh").render({ path: clip, start: 0, end: 2, effects: mosh({ ghost: 0 }), carry: { path: moving, at: 1.5 } });
      expect(r.frames).toBe(60);
      const [video, audio] = await streams(r.path);
      expect(video).toMatchObject({ pix_fmt: "yuv422p10le", nb_read_frames: "60" });
      expect(audio).toMatchObject({ codec_type: "audio", codec_name: "pcm_s16le" });
      expect(await frameDiff(r.path, clip, 0.1)).toBeGreaterThan(6);
      // 0.5 s is 15 frames: from the 16th on the clip is untouched.
      const floor = await roundTripFloor(r.path);
      expect(await frameDiff(r.path, clip, 0.7)).toBeLessThan(floor + 0.5);
    }, 60_000);

    it("has nothing to carry from footage that stands still, unless the last frame lingers", async () => {
      const fx = renderer("mosh-still");
      const bare = await fx.render({ path: clip, start: 0, end: 2, effects: mosh({ ghost: 0 }), carry: { path: still, at: 1.5 } });
      const floor = await roundTripFloor(bare.path);
      expect(await frameDiff(bare.path, clip, 0.1)).toBeLessThan(floor + 0.5);
      const ghost = await fx.render({ path: clip, start: 0, end: 2, effects: mosh({ ghost: 1 }), carry: { path: still, at: 1.5 } });
      expect(await frameDiff(ghost.path, clip, 0.03)).toBeGreaterThan(20);
      expect(await frameDiff(ghost.path, clip, 0.7)).toBeLessThan(floor + 0.5);
    }, 60_000);

    it("moves alpha with the picture, and the ghost does not fill in transparent pixels", async () => {
      const fx = renderer("mosh-alpha");
      const alphaAt = async (file: string) => (await decodeRgba(file, { seconds: 0.1, width: 160, height: 90 })).filter((_, i) => i % 4 === 3);
      const meanDiff = (a: Uint8Array, b: Uint8Array) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;
      const source = await alphaAt(alphaClip);
      for (const ghost of [0, 1]) {
        const r = await fx.render({ path: alphaClip, start: 0, end: 1, effects: stack([{ effect: "datamosh_carry", params: { length: 0.5, ghost, carry: { file_id: "A", at: 1.5 } } }], 1), carry: { path: still, at: 1.5 } });
        expect(r.codec).toBe("prores4444");
        expect(meanDiff(await alphaAt(r.path), source), `ghost ${ghost}`).toBeLessThan(3);
      }
    }, 60_000);

    it("caches by the footage before the cut and where it ends", async () => {
      const fx = renderer("mosh-cache");
      const first = await fx.render({ path: clip, start: 0, end: 1, effects: mosh({}), carry: { path: moving, at: 1.5 } });
      expect((await fx.render({ path: clip, start: 0, end: 1, effects: mosh({}), carry: { path: moving, at: 1.5 } })).cached).toBe(true);
      expect((await fx.render({ path: clip, start: 0, end: 1, effects: mosh({}, 1.2), carry: { path: moving, at: 1.2 } })).fingerprint).not.toBe(first.fingerprint);
      expect((await fx.render({ path: clip, start: 0, end: 1, effects: mosh({}), carry: { path: still, at: 1.5 } })).fingerprint).not.toBe(first.fingerprint);
    }, 60_000);

    it("says what is missing", async () => {
      const fx = renderer("mosh-missing");
      await expect(fx.render({ path: clip, start: 0, end: 1, effects: mosh({}) })).rejects.toThrow(/needs the footage before the cut/);
      await expect(fx.render({ path: clip, start: 0, end: 1, effects: mosh({}), carry: { path: path.join(dir, "nope.mp4"), at: 1 } })).rejects.toThrow(/before the cut.*missing/);
      await expect(fx.render({ path: clip, start: 0, end: 1, effects: mosh({}, 0), carry: { path: moving, at: 0 } })).rejects.toThrow(/less than two frames in/);
    }, 60_000);
  });

  it("refuses a missing source and a range past its end", async () => {
    await expect(renderer().render({ path: path.join(dir, "nope.mp4"), start: 0, end: 1, effects: stack([{ effect: "bloom" }]) })).rejects.toThrow(/missing/);
    await expect(renderer().render({ path: clip, start: 5, end: 6, effects: stack([{ effect: "bloom" }]) })).rejects.toThrow(/outside/);
  });
});
