import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import type { Project } from "../../model/types.js";
import { addFile } from "../../ops/files.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { audioInfo, imageInfo, media, videoInfo } from "../test-support/fixture.js";

const SR = BEAT_SAMPLE_RATE;

/** 60 s of a 120 BPM groove: quiet for the first 8 s, then loud. */
function groove(): Float32Array {
  const out = new Float32Array(60 * SR);
  for (let n = 0; n * 0.5 < 60; n += 1) {
    const t = n * 0.5;
    const gain = (t < 8 ? 0.2 : 0.9) * (n % 4 === 0 ? 1 : 0.65);
    const start = Math.round(t * SR);
    for (let k = 0; k < SR * 0.25 && start + k < out.length; k += 1) {
      out[start + k] = out[start + k]! + gain * Math.exp(-k / (0.07 * SR)) * Math.sin((2 * Math.PI * (50 + 70 * Math.exp(-k / (0.02 * SR))) * k) / SR);
    }
  }
  return out;
}

function withAudio(host: FakeHost, decode = true): FakeHost {
  host.audio = {
    analyzeAudio: async () => ({ sampleRate: 16000, frameSize: 480, rms: new Float32Array(0) }),
    ...(decode ? { decodePcm: async () => ({ sampleRate: SR, samples: groove() }) } : {}),
  };
  return host;
}

/** A vertical project with four clips, a photo and a song in the bin (nothing on the timeline). */
function reelProject(): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "REELPROJ01", profile: findProfile("FHD Vertical 1080p 30 fps")! }));
  scratch.transaction("fixture", (tx) => {
    for (const name of ["huddle", "dribble", "break", "strike"]) addFile(tx, media(`/media/${name}.mp4`, videoInfo(`/media/${name}.mp4`, 20)), { id: name.toUpperCase().padEnd(10, "X").slice(0, 10) });
    addFile(tx, media("/media/crowd.png", imageInfo("/media/crowd.png")), { id: "CROWDXXXXX" });
    addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 60)), { id: "SONGXXXXXX" });
  });
  const project: Project = structuredClone(scratch.project);
  project.history = { undo: [], redo: [] };
  return new ProjectDocument(project);
}

const FILES = ["HUDDLEXXXX", "DRIBBLEXXX", "BREAKXXXXX", "STRIKEXXXX"];

describe("build_reel_tool", () => {
  it("cuts a whole reel on the music's beats in one undo step", async () => {
    const doc = reelProject();
    const host = withAudio(fakeHost());
    const result = await runTool({ doc, host }, "build_reel_tool", {
      style: "hype",
      file_ids: FILES,
      hook: "Match day",
      end_card: "Full game Sunday",
      duration_seconds: "15",
    });
    expect(result.ok, result.text).toBe(true);
    const data = (result.data as { data: Record<string, unknown> }).data as {
      duration: number;
      bpm: number;
      music_start: number;
      beats: number[];
      shots: { file_id: string; start: number; end: number }[];
      tracks: Record<string, number>;
      brief: Record<string, string>;
    };
    expect(data.bpm).toBeGreaterThan(118);
    expect(data.bpm).toBeLessThan(122);
    // The quiet intro is skipped: the music starts in the loud part, on a beat.
    expect(data.music_start).toBeGreaterThanOrEqual(7.9);
    // Rounded up to the bar line after the 15 s asked for (never more than a bar longer).
    expect(data.duration).toBeGreaterThanOrEqual(15);
    expect(data.duration).toBeLessThanOrEqual(15 + (4 * 60) / data.bpm + 0.05);
    expect(data.shots[data.shots.length - 1]!.file_id).toBe("STRIKEXXXX");
    expect(data.brief.format).toMatch(/vertical 9:16/);
    expect(data.brief.story).toMatch(/^huddle.*ends on strike$/);

    const project = doc.project;
    const video = project.clips.filter((c) => c.layer === data.tracks.video);
    expect(video).toHaveLength(data.shots.length);
    // Every cut within a frame of a beat, half- or quarter-beat of the music (positions snap to the 30 fps grid).
    const grid = data.beats.flatMap((t, i) => (i + 1 < data.beats.length ? [0, 0.25, 0.5, 0.75].map((f) => t + f * (data.beats[i + 1]! - t)) : [t]));
    for (const clip of video) expect(Math.min(...grid.map((t) => Math.abs(t - clip.position)))).toBeLessThanOrEqual(1 / 30 + 1e-6);
    // Shots butt together with no gap.
    const sorted = [...video].sort((a, b) => a.position - b.position);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      expect(sorted[i]!.position).toBeCloseTo(prev.position + (prev.end - prev.start), 1);
    }
    const music = project.clips.filter((c) => c.layer === data.tracks.music);
    expect(music).toHaveLength(1);
    expect(music[0]!.start).toBeCloseTo(data.music_start, 2);
    const volume = (music[0]!.volume as { Points: { co: { Y: number } }[] }).Points;
    expect(volume[volume.length - 1]!.co.Y).toBe(0);
    // Hook + end card on the titles track, white flashes on the downbeats.
    expect(project.clips.filter((c) => c.layer === data.tracks.titles)).toHaveLength(2);
    expect(project.clips.filter((c) => c.layer === data.tracks.flash).length).toBeGreaterThan(1);
    expect([...host.written.keys()]).toEqual(expect.arrayContaining(["/generated/reel-hook.svg", "/generated/reel-end.svg", "/generated/reel-flash.svg"]));
    // Looks on every shot; landscape footage fills the vertical frame (crop, not letterbox).
    for (const clip of video) expect((clip.effects as unknown[]).length).toBeGreaterThanOrEqual(2);
    for (const clip of video) expect(clip.scale).toBe(0);
    expect(doc.undoLabels).toEqual(["Build hype montage reel"]);
    doc.undo();
    expect(doc.project.clips).toHaveLength(0);
    // Beat analysis of a minute of audio: slow on a loaded machine.
  }, 30_000);

  it("gives a hype reel its accents: outlined display titles that slam in, whips one way, a ramped wind-up, a glitch on the drop", async () => {
    const scratch = new ProjectDocument(createProject({ id: "REELHYPE01", profile: findProfile("HD 1080p 30 fps")! }));
    scratch.transaction("fixture", (tx) => {
      for (let i = 0; i < 12; i += 1) addFile(tx, media(`/media/c${i}.mp4`, videoInfo(`/media/c${i}.mp4`, 12)), { id: `CLIP${String(i).padStart(2, "0")}XXXX` });
      addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 60)), { id: "SONGXXXXXX" });
    });
    const doc = new ProjectDocument({ ...structuredClone(scratch.project), history: { undo: [], redo: [] } });
    const host = fakeHost();
    const beats = Array.from({ length: 100 }, (_, i) => i * 0.5);
    const result = await runTool({ doc, host }, "build_reel_tool", { style: "hype", hook: "No brakes", end_card: "After dark", beats, duration_seconds: 24 });
    expect(result.ok, result.text).toBe(true);
    const data = (result.data as { data: Record<string, unknown> }).data as {
      drop: number;
      flashes: number[];
      transitions: { preset: string; direction: string | null; cut: number }[];
      speed_ramp: { clip_id: string; start: number; end: number } | null;
      sfx_cues: { kind: string }[];
      tracks: Record<string, number>;
    };
    expect(data.drop).toBe(16);
    expect(data.flashes).toContain(16);
    expect(data.transitions.find((t) => t.cut === 16)?.preset).toBe("glitch");
    const whips = data.transitions.filter((t) => t.preset === "whip");
    expect(whips.length).toBeGreaterThan(1);
    expect(new Set(whips.map((t) => t.direction)).size).toBe(1);
    expect(data.transitions[data.transitions.length - 1]!.preset).toBe("zoom_out");
    expect(data.sfx_cues.some((c) => c.kind === "glitch")).toBe(true);
    // The transitions are on the clips, recorded so they can be removed.
    const recorded = doc.project.clips.filter((c) => Array.isArray((c as Record<string, unknown>).zenvi_motion_transitions));
    expect(recorded.length).toBeGreaterThanOrEqual(data.transitions.length);
    // The wind-up keeps its length and ends on the drop.
    const ramped = doc.project.clips.find((c) => c.id === data.speed_ramp?.clip_id)!;
    expect((ramped as Record<string, unknown>).zenvi_speed_ramp).toBeDefined();
    expect(ramped.position + (ramped.end - ramped.start)).toBeCloseTo(16, 6);
    // Titles are set in the bundled condensed face as outlines, and slam in out of a blur.
    const svg = (name: string) => {
      const bytes = host.written.get(`/generated/${name}`)!;
      return typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
    };
    expect(svg("reel-hook.svg")).toContain('data-zenvi-outline="anton"');
    expect(svg("reel-end.svg")).toContain('stroke="#ffffff"');
    const hook = doc.project.clips.filter((c) => c.layer === data.tracks.titles).reduce((a, b) => (b.position < a.position ? b : a));
    expect((hook.scale_x as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y).toBeCloseTo(1.35, 6);
    expect((hook.effects as { class_name: string }[]).map((e) => e.class_name)).toContain("Blur");
    expect(doc.undoLabels).toEqual(["Build hype montage reel"]);
    doc.undo();
    expect(doc.project.clips).toHaveLength(0);
  });

  it("ends shot labels where the end card comes in", async () => {
    const doc = reelProject();
    const result = await runTool({ doc, host: withAudio(fakeHost()) }, "build_reel_tool", {
      style: "editorial",
      file_ids: FILES,
      labels: ["Huddle", "Dribble", "Break", "Strike"],
      end_card: "Full game Sunday",
      duration_seconds: "12",
    });
    expect(result.ok, result.text).toBe(true);
    const tracks = ((result.data as { data: Record<string, unknown> }).data as { tracks: Record<string, number> }).tracks;
    const span = (c: { position: number; start: number; end: number }) => [c.position, c.position + (c.end - c.start)] as const;
    const titles = doc.project.clips.filter((c) => c.layer === tracks.titles);
    const endCard = titles.reduce((a, b) => (b.position > a.position ? b : a));
    const labels = doc.project.clips.filter((c) => c.layer === tracks.labels);
    const shots = ((result.data as { data: Record<string, unknown> }).data as { shots: { start: number; end: number }[] }).shots;
    // Every shot keeps its label except the last one when the end card cuts it to a flicker.
    const cut = shots.filter((s) => s.start < endCard.position && s.end > endCard.position && endCard.position - s.start < 0.3).length;
    expect(labels).toHaveLength(shots.filter((s) => s.start < endCard.position).length - cut);
    for (const label of labels) expect(span(label)[1]).toBeLessThanOrEqual(endCard.position + 1e-6);
  });

  it("refuses to build over an edit unless asked to replace it, then replaces it in the same undo step", async () => {
    const doc = reelProject();
    const host = withAudio(fakeHost());
    expect((await runTool({ doc, host }, "build_reel_tool", { style: "cinematic" })).ok).toBe(true);
    const clips = doc.project.clips.length;
    const again = await runTool({ doc, host }, "build_reel_tool", { style: "minimal" });
    expect(again.ok).toBe(false);
    expect(again.text).toContain("replace=true");
    expect(doc.undoLabels).toHaveLength(1);
    const replaced = await runTool({ doc, host }, "build_reel_tool", { style: "minimal", replace: "true" });
    expect(replaced.ok, replaced.text).toBe(true);
    expect(doc.undoLabels).toHaveLength(2);
    doc.undo();
    expect(doc.project.clips).toHaveLength(clips);
  });

  it("cuts to the style's tempo, and says so, where audio cannot be decoded", async () => {
    const doc = reelProject();
    const result = await runTool({ doc, host: withAudio(fakeHost(), false) }, "build_reel_tool", { style: "match_cut", duration_seconds: 8 });
    expect(result.ok, result.text).toBe(true);
    expect(result.text).toContain("cannot analyse audio");
    const shots = (result.data as { data: { shots: { start: number; end: number }[] } }).data.shots;
    // match_cut cuts on every beat of its 120 BPM fallback after a two-beat opening.
    expect(shots[1]!.start).toBeCloseTo(1, 3);
    expect(shots[2]!.start).toBeCloseTo(1.5, 3);
  });

  it("refuses unknown and non-visual files without touching history", async () => {
    const doc = reelProject();
    const host = withAudio(fakeHost());
    const unknown = await runTool({ doc, host }, "build_reel_tool", { file_ids: ["NOPE000000"] });
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toContain("NOPE000000");
    const audio = await runTool({ doc, host }, "build_reel_tool", { file_ids: ["SONGXXXXXX"] });
    expect(audio.ok).toBe(false);
    expect(doc.undoLabels).toHaveLength(0);
  });
});

describe("detect_beats_tool on the web", () => {
  it("returns the desktop's receipt shape with a tempo grid", async () => {
    const doc = reelProject();
    const result = await runTool({ doc, host: withAudio(fakeHost()) }, "detect_beats_tool", { file_id: "SONGXXXXXX" });
    expect(result.ok, result.text).toBe(true);
    const data = (result.data as { data: { bpm: number; beats: { timeSec: number; frame: number }[]; provider: string } }).data;
    expect(Math.abs(data.bpm - 120)).toBeLessThan(2);
    expect(data.provider).toBe("local");
    expect(data.beats[0]).toHaveProperty("frame");
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("is not available where the host cannot decode audio", async () => {
    const result = await runTool({ doc: reelProject(), host: withAudio(fakeHost(), false) }, "detect_beats_tool", { file_id: "SONGXXXXXX" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("not available");
  });
});
