import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import type { Project } from "../../model/types.js";
import { addFile } from "../../ops/files.js";
import { runTool } from "../registry.js";
import type { RgbaImage } from "../../render/types.js";
import { findColorGrade, scalarY } from "../color-agent.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { audioInfo, imageInfo, media, videoInfo } from "../test-support/fixture.js";
import { pixelFrameHost } from "../test-support/pixel-host.js";

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

/** How many times the host was asked to decode audio: a given grid must not decode. */
let decodes = 0;

function withAudio(host: FakeHost, decode = true): FakeHost {
  decodes = 0;
  host.audio = {
    analyzeAudio: async () => ({ sampleRate: 16000, frameSize: 480, rms: new Float32Array(0) }),
    ...(decode
      ? {
          decodePcm: async () => {
            decodes += 1;
            return { sampleRate: SR, samples: groove() };
          },
        }
      : {}),
  };
  return host;
}

/** A vertical project with four clips, a photo and a song in the bin (nothing on the timeline). */
function reelProject(song = true): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "REELPROJ01", profile: findProfile("FHD Vertical 1080p 30 fps")! }));
  scratch.transaction("fixture", (tx) => {
    for (const name of ["huddle", "dribble", "break", "strike"]) addFile(tx, media(`/media/${name}.mp4`, videoInfo(`/media/${name}.mp4`, 20)), { id: name.toUpperCase().padEnd(10, "X").slice(0, 10) });
    addFile(tx, media("/media/crowd.png", imageInfo("/media/crowd.png")), { id: "CROWDXXXXX" });
    if (song) addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 60)), { id: "SONGXXXXXX" });
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
    // A section's flash opens on a full white frame.
    const flashes = doc.project.clips.filter((c) => c.layer === data.tracks.flash);
    expect(flashes).toHaveLength(data.flashes.length);
    for (const f of flashes) expect((f.alpha as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y).toBe(1);
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

  it("does not cut an earlier build's titles and flash into the rebuild", async () => {
    const doc = reelProject();
    const host = withAudio(fakeHost());
    const args = { style: "hype", hook: "Match day", end_card: "Full game Sunday", duration_seconds: "12" };
    expect((await runTool({ doc, host }, "build_reel_tool", args)).ok).toBe(true);
    const rebuilt = await runTool({ doc, host }, "build_reel_tool", { ...args, replace: true });
    expect(rebuilt.ok, rebuilt.text).toBe(true);
    const shots = ((rebuilt.data as { data: Record<string, unknown> }).data as { shots: { file_id: string }[] }).shots;
    const svgs = new Set(doc.project.files.filter((f) => String(f.path).endsWith(".svg")).map((f) => String(f.id)));
    expect(svgs.size).toBeGreaterThan(0);
    for (const shot of shots) expect(svgs.has(shot.file_id)).toBe(false);
  }, 30_000);

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

describe("build_reel_tool with the beat grid given", () => {
  type Reel = { bpm: number; beat_source: string; beats: number[]; music_tempo?: { given_bpm?: boolean; confidence: number; bpm: number } };
  const reel = async (args: Record<string, unknown>, doc = reelProject()) => {
    const result = await runTool({ doc, host: withAudio(fakeHost()) }, "build_reel_tool", { style: "hype", file_ids: FILES, duration_seconds: 12, ...args });
    return { result, doc, data: (result.data as { data: Reel }).data };
  };

  it("uses bpm + offset_seconds exactly, without decoding the music", async () => {
    const { result, data } = await reel({ bpm: 160, offset_seconds: 0.25 });
    expect(result.ok, result.text).toBe(true);
    expect(decodes).toBe(0);
    expect(data.bpm).toBe(160);
    expect(data.beat_source).toBe("160 BPM from 0.25 s");
    // The beats follow the given tempo (0.375 s apart; the in-point snaps to a frame).
    expect((data.beats[9]! - data.beats[1]!) / 8).toBeCloseTo(0.375, 2);
  });

  it("uses the given beat times instead of detecting", async () => {
    const beats = Array.from({ length: 80 }, (_, i) => 0.1 + i * 0.6);
    const { result, data } = await reel({ beats });
    expect(result.ok, result.text).toBe(true);
    expect(decodes).toBe(0);
    expect(data.beat_source).toBe("the given beats");
    expect(data.bpm).toBeCloseTo(100, 6);
  });

  it("tracks the music at the given bpm when there is no offset", async () => {
    const { result, data } = await reel({ bpm: 60 });
    expect(result.ok, result.text).toBe(true);
    expect(decodes).toBe(1);
    expect(data.bpm).toBe(60);
    expect(data.beat_source).toBe("the music tracked at 60 BPM");
    expect(data.music_tempo?.given_bpm).toBe(true);
  });

  it("cuts a slow-reading loop at the faster octave the audio also has when the style is fast", async () => {
    // A loop that reads as 80 with a full 160 pulse: hype (128) cuts at 160, not at half speed.
    const slow = new Float32Array(40 * SR);
    for (let t = 0; t < 40; t += 60 / 160) {
      const start = Math.round(t * SR);
      for (let k = 0; k < SR * 0.1 && start + k < slow.length; k += 1) slow[start + k] = (Math.round(t / (60 / 160)) % 2 === 0 ? 0.9 : 0.5) * Math.exp(-k / (0.02 * SR)) * Math.sin((2 * Math.PI * 900 * k) / SR);
    }
    const host = withAudio(fakeHost());
    host.audio!.decodePcm = async () => ({ sampleRate: SR, samples: slow });
    const result = await runTool({ doc: reelProject(), host }, "build_reel_tool", { style: "hype", file_ids: FILES, duration_seconds: 12 });
    expect(result.ok, result.text).toBe(true);
    const data = (result.data as { data: Reel; warnings?: string[] }).data;
    expect(data.bpm).toBeGreaterThan(155);
    expect(data.beat_source).toMatch(/faster reading/);
    // The octave was moved by the tool, not given by the caller.
    expect((data as { music_tempo?: { given_bpm?: boolean } }).music_tempo?.given_bpm).toBeUndefined();
  });

  it("cuts to the given bpm when the music cannot be tracked", async () => {
    const host = withAudio(fakeHost());
    host.audio!.decodePcm = async () => {
      throw new Error("ffmpeg exited 1");
    };
    const doc = reelProject();
    const result = await runTool({ doc, host }, "build_reel_tool", { style: "hype", file_ids: FILES, duration_seconds: 12, bpm: 150 });
    expect(result.ok, result.text).toBe(true);
    const out = result.data as { data: Reel; warnings?: string[] };
    expect(out.data.bpm).toBe(150);
    expect(out.data.beat_source).toBe("150 BPM");
    expect(out.warnings?.join(" ")).toContain("Cut to 150 BPM instead");
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("takes the double of a 174 pulse read as 87 for hype and highlight, keeping the half in the receipt", async () => {
    const pulse = new Float32Array(40 * SR);
    for (let t = 0; t < 40; t += 60 / 174) {
      const start = Math.round(t * SR);
      for (let k = 0; k < SR * 0.1 && start + k < pulse.length; k += 1) pulse[start + k] = 0.9 * Math.exp(-k / (0.02 * SR)) * Math.sin((2 * Math.PI * 900 * k) / SR);
    }
    for (const style of ["hype", "highlight", "cinematic"]) {
      const host = withAudio(fakeHost());
      host.audio!.decodePcm = async () => ({ sampleRate: SR, samples: pulse });
      const result = await runTool({ doc: reelProject(), host }, "build_reel_tool", { style, file_ids: FILES, duration_seconds: 12 });
      expect(result.ok, result.text).toBe(true);
      const data = (result.data as { data: Reel; warnings?: string[] }).data;
      if (style === "cinematic") {
        expect(data.bpm).toBeLessThan(100);
        continue;
      }
      expect(Math.abs(data.bpm - 174)).toBeLessThan(4);
      expect(data.beat_source).toMatch(/faster reading/);
      expect((data.music_tempo as unknown as { alternatives: { bpm: number }[] }).alternatives.some((a) => Math.abs(a.bpm - 87) < 3)).toBe(true);
    }
  });

  it("reports how sure the detected grid is", async () => {
    const { data } = await reel({});
    expect(data.beat_source).toBe("the music, tracked");
    expect(data.music_tempo?.confidence).toBeGreaterThan(0.6);
    expect(data.music_tempo?.bpm).toBeGreaterThan(118);
  });

  it("cuts to the given bpm when there is no music", async () => {
    const { result, data } = await reel({ bpm: 150 }, reelProject(false));
    expect(result.ok, result.text).toBe(true);
    expect(data.bpm).toBe(150);
    expect(data.beat_source).toBe("150 BPM");
  });

  it("refuses beats that are one time repeated, without an undo step", async () => {
    const { result, doc } = await reel({ beats: [1, 1] });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("at least two different beat times");
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("refuses an offset without a tempo and leaves no undo step", async () => {
    const { result, doc } = await reel({ offset_seconds: 1 });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Error: offset_seconds goes with bpm");
    expect(doc.undoLabels).toHaveLength(0);
  });
});

/** A grey ramp around `base` (so the frame has contrast), with an optional warm cast. */
function ramp(width: number, height: number, base: number, warm = 0): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const level = base - 40 + (80 * x) / Math.max(1, width - 1);
      const i = (y * width + x) * 4;
      data.set([level + warm, level, level - warm, 255], i);
    }
  }
  return { width, height, data };
}

/** A small landscape project of night ("night*") and daylight ("day*") clips, and a song; frames painted by file name. */
function gradeProject(names: readonly string[]): { doc: ProjectDocument; host: FakeHost; ids: string[] } {
  const scratch = new ProjectDocument(createProject({ id: "REELGRADE1", profile: findProfile("HD 1080p 30 fps")! }));
  const ids = names.map((name, i) => `${name.toUpperCase()}${i}`.padEnd(10, "X").slice(0, 10));
  scratch.transaction("fixture", (tx) => {
    names.forEach((name, i) => addFile(tx, media(`/media/${name}${i}.mp4`, videoInfo(`/media/${name}${i}.mp4`, 12)), { id: ids[i]! }));
    addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 60)), { id: "SONGXXXXXX" });
  });
  const project: Project = { ...structuredClone(scratch.project), width: 160, height: 90, history: { undo: [], redo: [] } };
  const host = fakeHost();
  host.frames = pixelFrameHost((path, w, h) => (path.includes("day") ? ramp(w, h, 190, 30) : ramp(w, h, 60)));
  return { doc: new ProjectDocument(project), host, ids };
}

const BEATS = Array.from({ length: 60 }, (_, i) => i * 0.5);
type GradeData = {
  shots: { file_id: string }[];
  tracks: Record<string, number>;
  grade: { look: string; lut: string; clips: { file_id: string; status: string; grade: Record<string, number> }[] } | null;
  sound_design: { tool: string; args: Record<string, unknown> } | null;
};

describe("build_reel_tool: one look", { timeout: 60_000 }, () => {
  it("grades every shot of a hype reel into one look inside its one undo step", async () => {
    const { doc, host, ids } = gradeProject(["day", "night", "night", "night", "night"]);
    const result = await runTool({ doc, host }, "build_reel_tool", { style: "hype", beats: BEATS, duration_seconds: 8, labels: ["night run"] });
    expect(result.ok, result.text).toBe(true);
    const data = (result.data as { data: GradeData }).data;
    expect(data.grade?.look).toBe("night");
    expect(data.grade?.lut).toBe("night_glow");
    expect(result.text).toMatch(/One look: night_glow/);
    // The daylight clip is pulled down toward the night target; the night clips need less.
    const day = data.grade!.clips.find((c) => c.file_id === ids[0])!;
    expect(day.grade.exposure).toBeLessThan(0);
    // Bin order has no story: a night clip opens the reel.
    expect(data.shots[0]!.file_id).not.toBe(ids[0]);
    const video = doc.project.clips.filter((c) => c.layer === data.tracks.video);
    for (const clip of video) {
      const grade = findColorGrade(clip.effects) as Record<string, unknown> | null;
      expect(String(grade?.lut_path)).toMatch(/night_glow\.cube$/);
      // The style's own colour stays on the same grade.
      expect(scalarY(grade!, "saturation")).toBeCloseTo(1.18, 6);
    }
    const dayShot = video.find((c) => c.file_id === ids[0])!;
    expect(scalarY(findColorGrade(dayShot.effects) as Record<string, unknown>, "exposure")).toBeCloseTo(day.grade.exposure!, 6);
    expect(data.sound_design).toEqual({ tool: "auto_sound_design_tool", args: { intensity: "hype", density: "every_cut" } });
    expect(doc.undoLabels).toEqual(["Build hype montage reel"]);
    doc.undo();
    expect(doc.project.clips).toHaveLength(0);
  });

  it("warns when a night label sits over mostly daylight footage", async () => {
    const { doc, host } = gradeProject(["day", "day", "day", "night"]);
    const result = await runTool({ doc, host }, "build_reel_tool", { style: "hype", beats: BEATS, duration_seconds: 8, hook: "Night run" });
    expect(result.ok, result.text).toBe(true);
    expect(result.text).toMatch(/set this reel at night, but \d+ % of its screen time is daylight footage/);
    // grade none opts out of the pass, but the check still runs.
    const plain = gradeProject(["day", "day", "day", "night"]);
    const none = await runTool({ doc: plain.doc, host: plain.host }, "build_reel_tool", { style: "hype", beats: BEATS, duration_seconds: 8, hook: "Night run", grade: "none" });
    expect(none.text).toMatch(/daylight footage/);
    expect((none.data as { data: GradeData }).data.grade).toBeNull();
    for (const clip of plain.doc.project.clips) expect((findColorGrade(clip.effects ?? []) as Record<string, unknown> | null)?.lut_path ?? "").toBe("");
  });

  it("renders nothing for grade none without night words, takes a named LUT, and refuses a LUT it does not know", async () => {
    const plain = gradeProject(["day", "night", "night"]);
    const none = await runTool({ doc: plain.doc, host: plain.host }, "build_reel_tool", { style: "hype", beats: BEATS, duration_seconds: 8, hook: "Launch", grade: "none" });
    expect(none.ok, none.text).toBe(true);
    expect((plain.host.frames as ReturnType<typeof pixelFrameHost>).renders).toHaveLength(0);
    const named = gradeProject(["day", "night", "night"]);
    const teal = await runTool({ doc: named.doc, host: named.host }, "build_reel_tool", { style: "highlight", beats: BEATS, duration_seconds: 8, grade: "teal_cinema" });
    expect(teal.ok, teal.text).toBe(true);
    expect((teal.data as { data: GradeData }).data.grade?.lut).toBe("teal_cinema");
    const bad = gradeProject(["day", "night"]);
    const refused = await runTool({ doc: bad.doc, host: bad.host }, "build_reel_tool", { style: "hype", beats: BEATS, grade: "no_such_lut" });
    expect(refused.ok).toBe(false);
    expect(bad.doc.undoLabels).toEqual([]);
  });

  it("records nothing when cancelled while it measures the footage", async () => {
    const { doc, host } = gradeProject(["day", "night", "night"]);
    const abort = new AbortController();
    let renders = 0;
    host.frames = pixelFrameHost((path, w, h) => {
      if (++renders === 2) abort.abort();
      return ramp(w, h, path.includes("day") ? 190 : 60);
    });
    const result = await runTool({ doc, host, signal: abort.signal }, "build_reel_tool", { style: "hype", beats: BEATS, duration_seconds: 8 });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/"summary":"Error: cancelled; nothing changed"/);
    expect(doc.undoLabels).toEqual([]);
    expect(doc.project.clips).toHaveLength(0);
  });

  it("keeps a highlight wind-up's own sound, ducked under the music, instead of muting it", async () => {
    const { doc, host } = gradeProject(["night", "night", "night", "night", "night", "night"]);
    const result = await runTool({ doc, host }, "build_reel_tool", { style: "highlight", beats: BEATS, duration_seconds: 20, grade: "none" });
    expect(result.ok, result.text).toBe(true);
    const ramp = (result.data as { data: { speed_ramp: { clip_id: string } | null } }).data.speed_ramp;
    expect(ramp).not.toBeNull();
    const clip = doc.project.clips.find((c) => c.id === ramp!.clip_id)!;
    const volume = clip.volume as unknown as { Points: { co: { Y: number } }[] };
    expect(volume.Points[0]!.co.Y).toBeCloseTo(0.075, 6);
  });
});

describe("detect_beats_tool on the web", () => {
  it("reports confidence, the other octaves and the bar, and tracks a given bpm", async () => {
    const run = (extra: Record<string, unknown>) => runTool({ doc: reelProject(), host: withAudio(fakeHost()) }, "detect_beats_tool", { file_id: "SONGXXXXXX", ...extra });
    const auto = await run({});
    const tempo = (auto.data as { data: { tempo: { confidence: number; beats_per_bar: number; alternatives: { bpm: number }[] } } }).data.tempo;
    expect(tempo.confidence).toBeGreaterThan(0.6);
    expect(tempo.beats_per_bar).toBe(4);
    expect(tempo.alternatives.some((a) => Math.abs(a.bpm - 60) < 2)).toBe(true);
    expect(auto.text).toMatch(/confidence/);
    const forced = await run({ bpm: "60" });
    expect(forced.ok, forced.text).toBe(true);
    expect((forced.data as { data: { bpm: number; tempo: { given_bpm: boolean } } }).data).toMatchObject({ bpm: 60, tempo: { given_bpm: true } });
  });

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
