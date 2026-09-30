import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AudioPlan, AudioSegment, FramePlan, Project } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveChildCount } from "../ffmpeg/process.js";
import { createRgba } from "../image/rgba.js";
import { audioRms, ffprobeJson, makeAudio, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { atempoChain, gainExpression, simplifyGain } from "./audio-graph.js";
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
    composite(plan, prepared) {
      const out = createRgba(plan.width, plan.height);
      out.data.set(prepared.layers[0]!.data);
      return out;
    },
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

  it("refuses an empty timeline", async () => {
    const empty = { ...project(1), clips: [] };
    await expect(
      renderProject(empty, { resolveMedia: (p) => p, output: path.join(dir, "e.mp4"), options: { format: "mp4", width: 160, height: 90, fps: { num: 25, den: 1 } }, engine: engine() }),
    ).rejects.toThrow(/empty/);
  });
});

describe("audio graph helpers", () => {
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

  it("computes the desktop export frame range", () => {
    const p = project(2);
    expect(exportFrameRange(p, { num: 25, den: 1 })).toEqual({ first: 1, last: 50 });
    // 0.5 s lies inside frame 13 ([0.48, 0.52))
    expect(exportFrameRange(p, { num: 25, den: 1 }, { start: 0.5, end: 1 })).toEqual({ first: 13, last: 25 });
    expect(exportFrameRange(p, { num: 25, den: 1 }, { start: 0.52, end: 1 })).toEqual({ first: 14, last: 25 });
  });
});
