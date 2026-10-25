import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import type { Clip, Project } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { planFrame } from "../../render/plan/frame-plan.js";
import type { Affine } from "../../render/types.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost, type FakeHostOptions } from "../test-support/fake-host.js";
import { audioInfo, fixtureDoc, imageInfo, L3, media, snapshotOf, videoInfo } from "../test-support/fixture.js";

const SR = BEAT_SAMPLE_RATE;

/** 60 s of a 120 BPM groove (kicks on the beat, from 0.25 s). */
function groove(): Float32Array {
  const out = new Float32Array(60 * SR);
  for (let n = 0; 0.25 + n * 0.5 < 60; n += 1) {
    const t = 0.25 + n * 0.5;
    const gain = n % 4 === 0 ? 1 : 0.65;
    const start = Math.round(t * SR);
    for (let k = 0; k < SR * 0.25 && start + k < out.length; k += 1) {
      out[start + k] = out[start + k]! + gain * Math.exp(-k / (0.07 * SR)) * Math.sin((2 * Math.PI * (50 + 70 * Math.exp(-k / (0.02 * SR))) * k) / SR);
    }
  }
  return out;
}

/**
 * A fake host that probes the SVGs it wrote for their real size (the tool
 * places drawings at their own pixel size) and decodes a 120 BPM groove.
 */
function motionHost(options: FakeHostOptions = {}): FakeHost {
  const host = fakeHost(options);
  if (host.media) {
    const probe = host.media.probe;
    host.media.probe = async (path) => {
      const svg = host.written.get(path);
      if (svg === undefined) return probe(path);
      const text = typeof svg === "string" ? svg : new TextDecoder().decode(svg);
      const width = Number(/width="(\d+)"/.exec(text)?.[1]);
      const height = Number(/height="(\d+)"/.exec(text)?.[1]);
      return { ...imageInfo(path), width, height, display_ratio: { num: width, den: height } };
    };
  }
  host.audio = { analyzeAudio: async () => ({ sampleRate: 16000, frameSize: 480, rms: new Float32Array(0) }), decodePcm: async () => ({ sampleRate: SR, samples: groove() }) };
  return host;
}

/** A vertical project with footage and a photo in the bin; the song on the timeline, only in the bin, or none. */
function verticalProject(song: "timeline" | "bin" | "none" = "timeline"): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "MOTIONPRJ1", profile: findProfile("FHD Vertical 1080p 30 fps")! }));
  scratch.transaction("fixture", (tx) => {
    for (const name of ["pour", "pages", "notes"]) addFile(tx, media(`/media/${name}.mp4`, videoInfo(`/media/${name}.mp4`, 20)), { id: name.toUpperCase().padEnd(10, "X") });
    addFile(tx, media("/media/press.png", imageInfo("/media/press.png")), { id: "PRESSXXXXX" });
    if (song !== "none") addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 60)), { id: "SONGXXXXXX" });
    if (song === "timeline") addClip(tx, { fileId: "SONGXXXXXX", position: 0, layer: 1_000_000, start: 0, end: 30, id: "SONGCLIP01" });
  });
  const project: Project = structuredClone(scratch.project);
  project.history = { undo: [], redo: [] };
  return new ProjectDocument(project);
}

type Data = Record<string, unknown>;
const dataOf = (result: { data?: unknown }) => (result.data as { data: Data }).data;

/** Canvas point of draw-space point (x, y) under a layer's affine (Qt order m11, m12, m21, m22, dx, dy). */
function apply(t: Affine, x: number, y: number): [number, number] {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

describe("add_motion_template_tool", () => {
  it("places a template above the video in one undo step, entrances on the music's beats", async () => {
    const doc = verticalProject();
    const host = motionHost();
    const result = await runTool({ doc, host }, "add_motion_template_tool", { template: "end_card", text: "Northwind", subtitle: "Brews in four minutes", position_seconds: "1" });
    expect(result.ok, result.text).toBe(true);
    const data = dataOf(result) as { layers: { timeline_clip_id: string; track: number }[]; cues: number[]; beats: number[]; bpm: number; tracks: { layer: number }[] };
    expect(doc.undoLabels).toEqual(["Add motion template end_card"]);
    expect(data.bpm).toBeGreaterThan(118);
    expect(data.bpm).toBeLessThan(122);
    // The grid is the song's (kicks from 0.25 s): every cue after the start is one of its half beats.
    for (const cue of data.cues.slice(1)) expect(Math.min(...data.beats.map((b) => Math.abs(b - cue)))).toBeLessThan(0.03);
    // On new tracks above the song's track, a clip per layer.
    expect(data.tracks.every((t) => t.layer > 1_000_000)).toBe(true);
    expect(data.layers).toHaveLength(4);
    for (const l of data.layers) expect(doc.project.clips.some((c) => c.id === l.timeline_clip_id)).toBe(true);
    doc.undo();
    expect(doc.project.clips.map((c) => c.id)).toEqual(["SONGCLIP01"]);
  });

  it("lands over an edit on the lowest free tracks above every picture there", async () => {
    const doc = fixtureDoc();
    const result = await runTool({ doc, host: motionHost() }, "add_motion_template_tool", { template: "grid_background", variant: "paper", position_seconds: "2", duration_seconds: "2" });
    expect(result.ok, result.text).toBe(true);
    const placed = (dataOf(result) as { layers: { timeline_clip_id: string }[] }).layers;
    const clip = doc.project.clips.find((c) => c.id === placed[0]!.timeline_clip_id)!;
    // The logo is on the third track from 2 s to 5 s: the background goes above it.
    expect(clip.layer).toBeGreaterThan(L3);
  });

  it("moves each card's footage and its frame drawing as one, frame by frame", async () => {
    const doc = verticalProject();
    const result = await runTool({ doc, host: motionHost() }, "add_motion_template_tool", {
      template: "ui_cards",
      file_ids: ["POURXXXXXX", "PAGESXXXXX", "NOTESXXXXX"],
      labels: ["Slow pour", "Ten pages", "Notes"],
      button: "Save",
    });
    expect(result.ok, result.text).toBe(true);
    const layers = (dataOf(result) as { layers: { name: string; timeline_clip_id: string }[] }).layers;
    const clipOf = (name: string) => doc.project.clips.find((c) => c.id === layers.find((l) => l.name === name)!.timeline_clip_id)! as Clip;
    for (const n of [1, 2, 3]) {
      const card = clipOf(`card-${n}`);
      const frame = clipOf(`card-${n}-frame`);
      // Footage starts later in its file than the drawing: keyframes count from the in-point.
      expect(card.start).toBeGreaterThan(0);
      const width = (layer: { transform: Affine; drawWidth: number }) => {
        const [x0, y0] = apply(layer.transform, 0, 0);
        const [x1, y1] = apply(layer.transform, layer.drawWidth, 0);
        return Math.hypot(x1 - x0, y1 - y0);
      };
      const first = Math.round(card.position * 30) + 1;
      const ratios: number[] = [];
      for (let f = first; f < first + 60; f += 3) {
        const plan = planFrame(doc.project, f);
        const m = plan.layers.find((l) => l.clipId === card.id)!;
        const d = plan.layers.find((l) => l.clipId === frame.id)!;
        // Same centre (the frame drawing is centred on its card)…
        const mc = apply(m.transform, m.drawWidth / 2, m.drawHeight / 2);
        const dc = apply(d.transform, d.drawWidth / 2, d.drawHeight / 2);
        expect(Math.hypot(mc[0] - dc[0], mc[1] - dc[1]), `card ${n} frame ${f}`).toBeLessThan(1.5);
        ratios.push(width(m) / width(d));
      }
      // …and they scale together.
      for (const r of ratios) expect(r).toBeCloseTo(ratios[0]!, 2);
    }
  });

  it("refuses content it cannot use, and unknown files, without touching history", async () => {
    const doc = verticalProject();
    const host = motionHost();
    const before = snapshotOf(doc.project);
    const one = await runTool({ doc, host }, "add_motion_template_tool", { template: "word_scroll", words: ["Only"] });
    expect(one.ok).toBe(false);
    expect(one.text).toContain("word_scroll needs words");
    const unknown = await runTool({ doc, host }, "add_motion_template_tool", { template: "callout", file_ids: ["NOPE000000"], labels: ["A"] });
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toContain("NOPE000000");
    const audio = await runTool({ doc, host }, "add_motion_template_tool", { template: "step_card", file_ids: ["SONGXXXXXX"], text: "Step" });
    expect(audio.ok).toBe(false);
    expect(doc.undoLabels).toHaveLength(0);
    expect(snapshotOf(doc.project)).toEqual(before);
    expect(host.written.size).toBe(0);
  });

  it("is not available where generated drawings cannot be stored", async () => {
    const result = await runTool({ doc: verticalProject(), host: motionHost({ omit: ["media.writeGenerated"] }) }, "add_motion_template_tool", { template: "end_card", text: "Zenvi" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("not available");
  });
});

describe("build_reel_tool motion styles", () => {
  const FILES = ["POURXXXXXX", "PAGESXXXXX", "NOTESXXXXX"];

  it("lays a UI promo's scenes on the bars in one undo step, over the music bed", async () => {
    const doc = verticalProject("bin");
    const result = await runTool({ doc, host: motionHost() }, "build_reel_tool", {
      style: "ui_promo",
      file_ids: FILES,
      music_file_id: "SONGXXXXXX",
      hook: "Plan a slower morning",
      end_card: "Zenvi",
      labels: ["Slow pour", "Ten pages", "Morning notes"],
      words: ["Plan", "Brew", "Read", "Begin"],
      duration_seconds: "16",
    });
    expect(result.ok, result.text).toBe(true);
    const data = dataOf(result) as { duration: number; downbeats: number[]; scenes: { name: string; start: number; end: number; templates: string[] }[]; tracks: { music: number; motion: number[] }; brief: Data };
    expect(data.scenes.map((s) => s.name)).toEqual(["search", "cards-1", "words", "end"]);
    // Scenes meet, each starting on a downbeat; the last ends the reel.
    for (const [i, scene] of data.scenes.entries()) {
      expect(Math.min(...data.downbeats.map((d) => Math.abs(d - scene.start)))).toBeLessThan(1 / 30 + 1e-6);
      if (i > 0) expect(scene.start).toBeCloseTo(data.scenes[i - 1]!.end, 6);
    }
    expect(data.scenes[data.scenes.length - 1]!.end).toBeCloseTo(data.duration, 6);
    expect(data.scenes[0]!.templates).toEqual(["grid_background", "type_search"]);
    const music = doc.project.clips.filter((c) => c.layer === data.tracks.music);
    expect(music).toHaveLength(1);
    expect(doc.project.clips.every((c) => c.layer === data.tracks.music || data.tracks.motion.includes(c.layer))).toBe(true);
    expect(doc.undoLabels).toEqual(["Build ui promo reel"]);
    doc.undo();
    expect(doc.project.clips).toHaveLength(0);
  });

  it.each(["editorial_motion", "product_callout", "tutorial"] as const)("builds the %s style from the same media", async (style) => {
    const doc = verticalProject("bin");
    const result = await runTool({ doc, host: motionHost() }, "build_reel_tool", {
      style,
      file_ids: FILES,
      music_file_id: "SONGXXXXXX",
      hook: "Quiet forms",
      end_card: "Studio Lumen",
      labels: ["One", "Two", "Three"],
      words: ["Glass carafe: Borosilicate", "Steel filter: 4-layer mesh"],
    });
    expect(result.ok, result.text).toBe(true);
    const scenes = (dataOf(result) as { scenes: { name: string }[] }).scenes;
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("follows the style's own tempo without music", async () => {
    const doc = verticalProject("none");
    const result = await runTool({ doc, host: motionHost() }, "build_reel_tool", { style: "tutorial", file_ids: FILES.slice(0, 2), hook: "Film better reels" });
    expect(result.ok, result.text).toBe(true);
    const data = dataOf(result) as { bpm: number; music_file_id: string | null; tracks: { music: number | null } };
    expect(data.bpm).toBe(100);
    expect(data.music_file_id).toBeNull();
    expect(data.tracks.music).toBeNull();
  });

  it("refuses a motion style where generated drawings cannot be stored", async () => {
    const doc = verticalProject("bin");
    const result = await runTool({ doc, host: motionHost({ omit: ["media.writeGenerated"] }) }, "build_reel_tool", { style: "ui_promo", file_ids: FILES });
    expect(result.ok).toBe(false);
    expect(doc.undoLabels).toHaveLength(0);
  });
});
