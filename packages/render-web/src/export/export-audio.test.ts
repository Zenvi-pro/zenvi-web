import { describe, expect, it } from "vitest";
import type { Project } from "@zenvi/engine";
import type { AudioPlan, AudioSegment } from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import { ExportError } from "./codecs.js";
import { exportAudio } from "./export-project.js";

const segment = (overrides: Partial<AudioSegment> = {}): AudioSegment => ({
  clipId: "C",
  fileId: "F",
  path: "a.webm",
  timelineStart: 0,
  sourceStart: 0,
  duration: 2,
  rate: 1,
  gain: [],
  effects: [],
  ...overrides,
});

function engineWith(segments: AudioSegment[]): RenderEngine & { calls: number } {
  const engine = {
    calls: 0,
    planAudio(_project: Project, range: { start: number; end: number }): AudioPlan {
      engine.calls += 1;
      return { sampleRate: 48000, channels: 2, start: range.start, end: range.end, segments };
    },
  };
  return engine as unknown as RenderEngine & { calls: number };
}

const project = (channels: number) => ({ sample_rate: 48000, channels }) as unknown as Project;
const range = { start: 0, end: 2 };

describe("exportAudio", () => {
  it("gives the file an audio track when something is audible", () => {
    const result = exportAudio(project(2), engineWith([segment()]), { format: "mp4" }, range);
    expect(result).toMatchObject({ hasAudio: true, channels: 2, sampleRate: 48000 });
    expect(result.plan.segments).toHaveLength(1);
  });

  it("treats channels: 0 as no audio track, without planning audio", () => {
    const engine = engineWith([segment()]);
    expect(exportAudio(project(0), engine, { format: "mp4" }, range)).toMatchObject({ hasAudio: false, channels: 0 });
    expect(exportAudio(project(2), engine, { format: "webm", channels: 0 }, range).hasAudio).toBe(false);
    expect(engine.calls).toBe(0);
  });

  it("has no audio track when nothing on the timeline plays", () => {
    expect(exportAudio(project(2), engineWith([]), { format: "mp4" }, range).hasAudio).toBe(false);
    const silent = [segment({ gain: [{ t: 0, gain: 0 }, { t: 2, gain: 0 }] }), segment({ rate: 0 }), segment({ duration: 0 })];
    expect(exportAudio(project(2), engineWith(silent), { format: "mp4" }, range).hasAudio).toBe(false);
    // A fade from silence still sounds.
    expect(exportAudio(project(2), engineWith([segment({ gain: [{ t: 0, gain: 0 }, { t: 2, gain: 1 }] })]), { format: "mp4" }, range).hasAudio).toBe(true);
  });

  it("always encodes WAV audio, and refuses a WAV export without channels", () => {
    expect(exportAudio(project(2), engineWith([]), { format: "wav" }, range).hasAudio).toBe(true);
    expect(() => exportAudio(project(0), engineWith([]), { format: "wav" }, range)).toThrow(ExportError);
  });
});
