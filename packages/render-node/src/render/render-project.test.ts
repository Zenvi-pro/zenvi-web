import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AudioPlan, AudioSegment, FramePlan, Project } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodedTruePeak } from "../audio/encoded-peak.js";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { liveChildCount, runBinary } from "../ffmpeg/process.js";
import { createRgba } from "../image/rgba.js";
import { audioRms, ffprobeJson, makeAudio, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { atempoChain, channelPan, gainExpression, simplifyGain } from "./audio-graph.js";
import { encoderCommand, ffmpegCanWrite, formatFromPath, type EncodeJob } from "./encoder.js";
import type { RenderEngine } from "./engine.js";
import { exportFrameRange, renderProject } from "./render-project.js";

let dir: string;
let video: string;
let tone: string;

function project(seconds: number): Project {
  return {
    id: "TESTPROJ01",
    fps: { num: 25, den: 1 },
    display_ratio: { num: 16, den: 9 },
    pixel_ratio: { num: 1, den: 1 },
    width: 160,
    height: 90,
    sample_rate: 48000,
    channels: 2,
    channel_layout: 3,
    settings: {},
    clips: [{ id: "C1", file_id: "F1", position: 0, start: 0, end: seconds, layer: 1000000 } as unknown as Project["clips"][number]],
    effects: [],
    files: [{ id: "F1", path: video, media_type: "video", fps: { num: 25, den: 1 }, video_length: 50 } as unknown as Project["files"][number]],
    duration: 300,
    scale: 15,
    tick_pixels: 100,
    playhead_position: 0,
    profile: "test",
    export_settings: null,
    export_overrides: {},
    layers: [],
    markers: [],
    progress: [],
    history: { undo: [], redo: [] },
    version: {},
  };
}

/** `p` plus a sound effect that runs 1.5 s past its last picture (1 s to 3.5 s). */
function withSoundTail(p: Project): Project {
  const boom = { id: "C2", file_id: "F2", position: 1, start: 0, end: 2.5, layer: 2000000, reader: { has_video: false, media_type: "audio" } };
  return { ...p, clips: [...p.clips, boom as unknown as Project["clips"][number]] };
}

function segment(overrides: Partial<AudioSegment>): AudioSegment {
  return {
    clipId: "C1",
    fileId: "F2",
    path: tone,
    timelineStart: 0,
    sourceStart: 0,
    duration: 2,
    rate: 1,
    gain: [{ t: 0, gain: 1 }],
    effects: [],
    ...overrides,
  };
}

/** Synthetic engine: one full-frame video layer, identity "compositing". */
function engine(audio: AudioSegment[] = []): RenderEngine {
  return {
    planFrame(p, frame, size): FramePlan {
      return {
        frame,
        time: (frame - 1) / 25,
        width: size.width,
        height: size.height,
        background: [0, 0, 0, 255],
        layers: [
          {
            clipId: "C1",
            layer: 1000000,
            source: { kind: "video", fileId: "F1", path: video, time: (frame - 1) / 25, frame },
            sourceWidth: 320,
            sourceHeight: 240,
            drawWidth: size.width,
            drawHeight: size.height,
            transform: [1, 0, 0, 1, 0, 0],
            opacity: 1,
            effects: [],
            masks: [],
          },
        ],
      };
    },
    planAudio(_p, range): AudioPlan {
      return { sampleRate: 48000, channels: 2, start: range.start, end: range.end, segments: audio };
    },
    compositeFrame(plan, sources) {
      const out = createRgba(plan.width, plan.height);
      const layer = sources.layers[0];
      if (layer) out.data.set(layer.data);
      else {
        const source = plan.layers[0]!.source;
        if (source.kind === "color") for (let i = 0; i < out.data.length; i += 4) out.data.set(source.color, i);
      }
      return out;
    },
    createState: () => ({}),
  };
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-render-");
  video = await makeVideo(dir, "src.mp4", { fps: "25", duration: 2, width: 320, height: 240 });
  tone = await makeAudio(dir, "tone.wav", { hz: 1000, duration: 3, amplitude: 0.5, channels: 1 });
}, 60_000);

afterAll(() => removeDir(dir));

describe("renderProject", () => {
  it("writes an H.264/AAC MP4 of the timeline's length with the planned audio gain", async () => {
    const out = path.join(dir, "out.mp4");
    const progress: number[] = [];
    const result = await renderProject(project(2), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 }, quality: "low" },
      engine: engine([segment({ gain: [{ t: 0, gain: 0.5 }] })]),
      onProgress: (p) => progress.push(p.fraction),
    });
    expect(result.location).toBe(out);
    expect(result.frames).toBe(50);
    expect(result.mimeType).toBe("video/mp4");
    expect(progress.at(-1)).toBe(1);
    const probe = await ffprobeJson(out);
    const v = probe.streams.find((s) => s.codec_type === "video")!;
    const a = probe.streams.find((s) => s.codec_type === "audio")!;
    expect([v.codec_name, v.width, v.height, v.pix_fmt]).toEqual(["h264", 160, 90, "yuv420p"]);
    expect(v.nb_frames).toBe("50");
    expect(a.codec_name).toBe("aac");
    expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.1);
    // 0.5-amplitude mono sine, upmixed to stereo at -3 dB per channel like
    // libopenshot's FrameMapper (swresample), at gain 0.5:
    // 0.5 · 0.7071 / √2 · 0.5 = 0.125
    const rms = await audioRms(out, { start: 0.2, duration: 1.5 });
    expect(rms).toBeGreaterThan(0.115);
    expect(rms).toBeLessThan(0.135);
    const leftovers = (await readdir(dir)).filter((n) => n.includes("partial") || n.includes("zenvi-render"));
    expect(leftovers).toEqual([]);
  });

  it("ends at the last picture when sound runs past it, and warns what it left out (W25a E2E bug 2)", async () => {
    const out = path.join(dir, "tail.mp4");
    const result = await renderProject(withSoundTail(project(2)), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 }, quality: "low" },
      engine: engine([segment({ clipId: "C2", timelineStart: 1, duration: 2.5 })]),
    });
    expect(result.frames).toBe(50);
    expect(result.warnings).toContain(
      "The video ends with the last picture at 2.00s: 1.50s of sound after it (to 3.50s) is left out instead of playing over black; render with an end of 3.50s to keep it.",
    );
    const probe = await ffprobeJson(out);
    expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.1);
  });

  it("places delayed segments and ramps gain along the envelope", async () => {
    const out = path.join(dir, "delayed.wav");
    await renderProject(project(2), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "wav", width: 160, height: 90, fps: { num: 25, den: 1 } },
      engine: engine([segment({ timelineStart: 1, duration: 1, gain: [{ t: 0, gain: 1 }, { t: 1, gain: 0 }] })]),
    });
    expect(await audioRms(out, { start: 0, duration: 0.9 })).toBeLessThan(0.001);
    const early = await audioRms(out, { start: 1.05, duration: 0.2 });
    const late = await audioRms(out, { start: 1.75, duration: 0.2 });
    expect(early).toBeGreaterThan(late * 2.5);
    const probe = await ffprobeJson(out);
    expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.02);
  });

  it("plays segments reversed and faster", async () => {
    const out = path.join(dir, "fast.mp3");
    await renderProject(project(2), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp3", width: 160, height: 90, fps: { num: 25, den: 1 } },
      engine: engine([segment({ sourceStart: 3, rate: -2, duration: 1 }), segment({ timelineStart: 1, rate: 2, duration: 1 })]),
    });
    const probe = await ffprobeJson(out);
    expect(probe.streams[0]!.codec_name).toBe("mp3");
    expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.1);
    expect(await audioRms(out, { start: 0.2, duration: 1.5 })).toBeGreaterThan(0.2);
  });

  it.each([
    ["webm", "vp9", "opus"],
    ["mov", "h264", "aac"],
    ["gif", "gif", undefined],
  ] as const)("writes %s", async (format, vcodec, acodec) => {
    const out = path.join(dir, `short.${format}`);
    await renderProject(project(0.4), {
      resolveMedia: (p) => p,
      output: out,
      options: { format, width: 160, height: 90, fps: { num: 25, den: 1 }, quality: "low" },
      engine: engine([segment({ duration: 0.4 })]),
    });
    const probe = await ffprobeJson(out);
    expect(probe.streams.find((s) => s.codec_type === "video")?.codec_name).toBe(vcodec);
    expect(probe.streams.find((s) => s.codec_type === "audio")?.codec_name).toBe(acodec);
  });

  it("holds -1 dBTP on the encoded file when the codec overshoots its limited input (W53 B3)", async () => {
    // Square-wave thumps and 3 kHz pings: AAC at 48 kb/s turns this, limited to -2 dBTP, into +0.2 dBTP.
    const hot = path.join(dir, "hot.wav");
    await runBinary(resolveBinary("ffmpeg"), ["-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc='0.9*sgn(sin(2*PI*55*t))*exp(-12*mod(t,0.25))+0.5*sin(2*PI*3000*t)*exp(-30*mod(t+0.1,0.25))':s=48000:d=2.5", hot]);
    const out = path.join(dir, "hot.mp4");
    await renderProject(project(2), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 }, quality: "low", audioBitrate: 48_000 },
      engine: engine([segment({ path: hot })]),
    });
    const peak = await encodedTruePeak(out);
    expect(peak).not.toBeNull();
    expect(peak!).toBeLessThanOrEqual(-1);
    expect(peak!).toBeGreaterThan(-6);
  }, 60_000);

  it("writes numbered PNG frames", async () => {
    const out = path.join(dir, "seq", "shot.png");
    const result = await renderProject(project(0.2), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "png-sequence", width: 160, height: 90, fps: { num: 25, den: 1 } },
      engine: engine(),
    });
    expect(result.location).toBe(path.join(dir, "seq", "shot_%05d.png"));
    expect((await readdir(path.join(dir, "seq"))).sort()).toEqual(["shot_00001.png", "shot_00002.png", "shot_00003.png", "shot_00004.png", "shot_00005.png"]);
  });

  it.each([
    ["jpg-sequence", "mjpeg", "jpg"],
    ["bmp-sequence", "bmp", "bmp"],
    ["tiff-sequence", "tiff", "tiff"],
  ] as const)("writes numbered frames as %s (export_video_tool image_format)", async (format, codec, extension) => {
    const folder = path.join(dir, `seq-${extension}`);
    const result = await renderProject(project(0.2), {
      resolveMedia: (p) => p,
      output: path.join(folder, `still-%05d.${extension}`),
      options: { format, width: 160, height: 90, fps: { num: 25, den: 1 } },
      engine: engine(),
    });
    expect(result.frames).toBe(5);
    expect((await readdir(folder)).sort()).toEqual([1, 2, 3, 4, 5].map((n) => `still-0000${n}.${extension}`));
    const probe = await ffprobeJson(path.join(folder, `still-00001.${extension}`));
    expect(probe.streams[0]!.codec_name).toBe(codec);
    expect([probe.streams[0]!.width, probe.streams[0]!.height]).toEqual([160, 90]);
  });

  it.each([
    ["flac", "flac"],
    ["m4a", "aac"],
  ] as const)("writes audio-only %s", async (format, codec) => {
    const out = path.join(dir, `sound.${format}`);
    await renderProject(project(1), {
      resolveMedia: (p) => p,
      output: out,
      options: { format, width: 160, height: 90, fps: { num: 25, den: 1 } },
      engine: engine([segment({ duration: 1 })]),
    });
    const probe = await ffprobeJson(out);
    expect(probe.streams.map((s) => [s.codec_type, s.codec_name])).toEqual([["audio", codec]]);
    expect(Math.abs(Number(probe.format.duration) - 1)).toBeLessThan(0.05);
  });

  it("plans frames at the export's frame rate, with the keyframes rescaled to it", async () => {
    const seen: Project[] = [];
    const base = engine();
    const counting: RenderEngine = { ...base, planFrame: (p, frame, size, options) => (seen.push(p), base.planFrame(p, frame, size, options)) };
    const source = project(1);
    source.clips[0] = { ...source.clips[0]!, alpha: { Points: [{ co: { X: 1, Y: 0 }, interpolation: 1 }, { co: { X: 25, Y: 1 }, interpolation: 1 }] } } as unknown as Project["clips"][number];
    const result = await renderProject(source, {
      resolveMedia: (p) => p,
      output: path.join(dir, "fifty.mp4"),
      options: { format: "mp4", width: 160, height: 90, fps: { num: 50, den: 1 }, channels: 0 },
      engine: counting,
    });
    expect(result.frames).toBe(50);
    expect(seen[0]!.fps).toEqual({ num: 50, den: 1 });
    expect((seen[0]!.clips[0] as unknown as { alpha: { Points: { co: { X: number } }[] } }).alpha.Points.map((p) => p.co.X)).toEqual([1, 50]);
    expect(source.fps).toEqual({ num: 25, den: 1 });
  });

  it("cancels cleanly: rejects, kills children, leaves no partial file", async () => {
    const out = path.join(dir, "cancelled.mp4");
    const controller = new AbortController();
    const promise = renderProject(project(2), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 } },
      engine: engine([segment({})]),
      signal: controller.signal,
      onProgress: (p) => {
        if (p.frame === 10) controller.abort();
      },
    });
    await expect(promise).rejects.toThrow(/cancel/i);
    expect(liveChildCount()).toBe(0);
    const names = await readdir(dir);
    expect(names.filter((n) => n.startsWith(".cancelled") || n === "cancelled.mp4")).toEqual([]);
  });

  it("reports encoder failures with ffmpeg's message", async () => {
    await expect(
      renderProject(project(0.4), {
        resolveMedia: (p) => p,
        output: path.join(dir, "bad.mp4"),
        options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 }, videoCodec: "no_such_codec" },
        engine: engine(),
      }),
    ).rejects.toThrow(/Encoding failed.*no_such_codec/s);
  });

  it("writes no audio stream for channels: 0 (video only)", async () => {
    const out = path.join(dir, "silent.mp4");
    const result = await renderProject(project(1), {
      resolveMedia: (p) => p,
      output: out,
      options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 }, channels: 0 },
      engine: engine([segment({})]),
    });
    expect(result.frames).toBe(25);
    expect((await ffprobeJson(out)).streams.map((s) => s.codec_type)).toEqual(["video"]);
    await expect(
      renderProject(project(1), { resolveMedia: (p) => p, output: path.join(dir, "silent.wav"), options: { format: "wav", width: 160, height: 90, fps: { num: 25, den: 1 }, channels: 0 }, engine: engine() }),
    ).rejects.toThrow(/needs audio channels/);
  });

  it("refuses an empty timeline", async () => {
    const empty = { ...project(1), clips: [] };
    await expect(
      renderProject(empty, { resolveMedia: (p) => p, output: path.join(dir, "e.mp4"), options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 } }, engine: engine() }),
    ).rejects.toThrow(/empty/);
  });
});

describe("what the ffmpeg exporter writes (ExportHost.supports)", () => {
  const encoders = new Set(["libx264", "libvpx-vp9", "libopus", "aac", "pcm_s16le", "flac", "gif", "png", "mjpeg", "libmp3lame", "prores_ks"]);

  it("needs the encoders, in a container whose muxer takes them", () => {
    expect(ffmpegCanWrite("mp4", "libx264", "aac", encoders)).toBe(true);
    expect(ffmpegCanWrite("mp4", "libx265", "", encoders)).toBe(false);
    expect(ffmpegCanWrite("webm", "libx264", "", encoders)).toBe(false);
    expect(ffmpegCanWrite("webm", "libvpx-vp9", "libopus", encoders)).toBe(true);
    expect(ffmpegCanWrite("webm", "", "aac", encoders)).toBe(false);
    expect(ffmpegCanWrite("mp4", "", "pcm_s16le", encoders)).toBe(false);
    expect(ffmpegCanWrite("mov", "prores_ks", "pcm_s16le", encoders)).toBe(true);
    expect(ffmpegCanWrite("wav", "", "pcm_s16le", encoders)).toBe(true);
    expect(ffmpegCanWrite("wav", "", "libmp3lame", encoders)).toBe(false);
    expect(ffmpegCanWrite("flac", "", "flac", encoders)).toBe(true);
    expect(ffmpegCanWrite("m4a", "", "aac", encoders)).toBe(true);
    expect(ffmpegCanWrite("mp3", "libx264", "", encoders)).toBe(false);
    expect(ffmpegCanWrite("jpg-sequence", "mjpeg", "", encoders)).toBe(true);
    expect(ffmpegCanWrite("png-sequence", "mjpeg", "", encoders)).toBe(false);
    expect(ffmpegCanWrite("gif", "gif", "", encoders)).toBe(true);
    expect(ffmpegCanWrite("tiff-sequence", "", "", encoders)).toBe(true);
  });

  it("names the format an output file implies", () => {
    expect([formatFromPath("a.png"), formatFromPath("a.jpeg"), formatFromPath("a.tif"), formatFromPath("a.m4a"), formatFromPath("a.flac"), formatFromPath("a.m4v")]).toEqual([
      "png-sequence",
      "jpg-sequence",
      "tiff-sequence",
      "m4a",
      "flac",
      "mp4",
    ]);
  });
});

describe("audio graph helpers", () => {
  it("maps channel_filter / channel_mapping like Timeline::add_layer", () => {
    expect(channelPan(2, "stereo")).toBeUndefined();
    expect(channelPan(2, "stereo", 0)).toBe("pan=stereo|c0=c0|c1=0*c0");
    expect(channelPan(2, "stereo", 0, 1)).toBe("pan=stereo|c0=0*c0|c1=c0");
    expect(channelPan(2, "stereo", -1, 0)).toBe("pan=stereo|c0=c0+c1|c1=0*c0");
  });

  it("chains atempo inside its 0.5..100 range", () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(-2)).toEqual(["atempo=2"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(atempoChain(5)).toEqual(["atempo=2", "atempo=2", "atempo=1.25"]);
  });

  it("builds a clamped piecewise-linear gain expression", () => {
    expect(gainExpression([{ t: 0, gain: 0.7 }])).toBe("0.7");
    expect(gainExpression([{ t: 0, gain: 0 }, { t: 1, gain: 1 }])).toBe("if(lt(t,0),0,if(gte(t,1),1,0+1*(t-0)/1))");
    expect(simplifyGain([{ t: 0, gain: 0 }, { t: 0.5, gain: 0.5 }, { t: 1, gain: 1 }])).toHaveLength(2);
    const many = Array.from({ length: 101 }, (_, i) => ({ t: i / 10, gain: i % 2 }));
    const depth = (gainExpression(many).match(/if\(/g) ?? []).length;
    expect(depth).toBeGreaterThan(90);
  });

  it("computes the export frame range: the last picture by default, the explicit range when given", () => {
    const p = project(2);
    expect(exportFrameRange(p, { num: 25, den: 1 })).toMatchObject({ first: 1, last: 50, cut: { audioCut: 0 } });
    const tail = withSoundTail(project(2));
    expect(exportFrameRange(tail, { num: 25, den: 1 })).toMatchObject({ first: 1, last: 50, cut: { end: 2, contentEnd: 3.5 } });
    // Audio formats run to the end of the sound.
    expect(exportFrameRange(tail, { num: 25, den: 1 }, undefined, false)).toMatchObject({ first: 1, last: 88 });
    // 0.5 s lies inside frame 13 ([0.48, 0.52))
    expect(exportFrameRange(p, { num: 25, den: 1 }, { start: 0.5, end: 1 })).toEqual({ first: 13, last: 25 });
    expect(exportFrameRange(p, { num: 25, den: 1 }, { start: 0.52, end: 1 })).toEqual({ first: 14, last: 25 });
  });
});

describe("encoder rate control (the desktop preset ladders, engine encoderRates)", () => {
  const job = (options: Partial<EncodeJob["options"]> & { format: EncodeJob["format"] }): string[] =>
    encoderCommand({
      format: options.format,
      output: "/tmp/out." + options.format,
      video: { width: 1280, height: 720, fps: { num: 30, den: 1 } },
      audio: { graph: { inputs: [], filter: "anullsrc[aout]", warnings: [] } as unknown as NonNullable<EncodeJob["audio"]>["graph"], sampleRate: 48000, channels: 2 },
      options: { width: 1280, height: 720, fps: { num: 30, den: 1 }, ...options },
      ffmpegMajor: 7,
      scriptPath: "/tmp/graph.txt",
    }).args;
  const after = (args: string[], flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  it("uses libx264 crf 30/23/20 (Low/Med/High) and qp 0 for lossless", () => {
    expect(after(job({ format: "mp4", quality: "low" }), "-crf")).toBe("30");
    expect(after(job({ format: "mp4", quality: "medium" }), "-crf")).toBe("23");
    expect(after(job({ format: "mp4" }), "-crf")).toBe("20"); // default: the dialog's High
    const lossless = job({ format: "mp4", quality: "lossless" });
    expect(after(lossless, "-qp")).toBe("0");
    expect(lossless).not.toContain("-crf");
  });

  it("uses vp9 constant quality with -b:v 0, explicit crf and bitrates first", () => {
    const webm = job({ format: "webm", quality: "medium" });
    expect([after(webm, "-crf"), after(webm, "-b:v")]).toEqual(["34", "0"]);
    expect(after(job({ format: "mp4", quality: "low", crf: 18 }), "-crf")).toBe("18");
    const bitrate = job({ format: "mp4", videoBitrate: 5_000_000, audioBitrate: 64_000 });
    expect([after(bitrate, "-b:v"), after(bitrate, "-b:a")]).toEqual(["5000000", "64000"]);
    expect(bitrate).not.toContain("-crf");
  });

  it("encodes at veryfast by default; --encoder-preset medium is the desktop's x264 speed", () => {
    expect(after(job({ format: "mp4" }), "-preset")).toBe("veryfast");
    expect(after(job({ format: "mp4", encoderPreset: "medium" }), "-preset")).toBe("medium");
    expect(after(job({ format: "webm" }), "-cpu-used")).toBe("5");
    expect(after(job({ format: "webm", encoderPreset: "medium" }), "-cpu-used")).toBe("2");
  });

  it("takes audio bitrates from the same ladder", () => {
    expect(after(job({ format: "mp4", quality: "low" }), "-b:a")).toBe("96000");
    expect(after(job({ format: "mp4", quality: "medium" }), "-b:a")).toBe("128000");
  });
});

