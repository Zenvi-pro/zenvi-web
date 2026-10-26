import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Clip, Project } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { addMarker } from "../../ops/markers.js";
import { isAutoSfxClip, isSfxClip } from "../../sfx/moments.js";
import { MIN_TRANSIENT_GAP } from "../../sfx/plan.js";
import { SFX_RECIPES } from "../../sfx/recipes.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { audioInfo, media, videoInfo } from "../test-support/fixture.js";

const SR = BEAT_SAMPLE_RATE;
const FPS = 30;

/** 30 s at 120 BPM: quiet for 12 s, then loud (the drop at 12 s). */
function song(): Float32Array {
  const out = new Float32Array(30 * SR);
  for (let n = 0; n * 0.5 < 30; n += 1) {
    const t = n * 0.5;
    const gain = (t < 12 ? 0.2 : 0.95) * (n % 4 === 0 ? 1 : 0.6);
    const start = Math.round(t * SR);
    for (let k = 0; k < SR * 0.25 && start + k < out.length; k += 1) {
      out[start + k] = out[start + k]! + gain * Math.exp(-k / (0.07 * SR)) * Math.sin((2 * Math.PI * (50 + 70 * Math.exp(-k / (0.02 * SR))) * k) / SR);
    }
  }
  return out;
}

function withAudio(host: FakeHost): FakeHost {
  host.audio = {
    analyzeAudio: async () => ({ sampleRate: 16000, frameSize: 480, rms: new Float32Array(0) }),
    decodePcm: async () => ({ sampleRate: SR, samples: song() }),
  };
  return host;
}

/** 20 s cut every second (four shots alternating), the song under it, history empty. */
function editProject(): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "SFXPROJ001" }));
  scratch.transaction("fixture", (tx) => {
    for (const name of ["aa", "bb", "cc", "dd"]) addFile(tx, media(`/media/${name}.mp4`, videoInfo(`/media/${name}.mp4`, 30)), { id: `SHOT${name.toUpperCase()}XXXX` });
    addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 30)), { id: "SONGXXXXXX" });
    const top = tx.project.layers.map((l) => l.number).sort((a, b) => b - a)[0]!;
    const bottom = tx.project.layers.map((l) => l.number).sort((a, b) => a - b)[0]!;
    for (let i = 0; i < 20; i += 1) {
      const id = `SHOT${["AA", "BB", "CC", "DD"][i % 4]}XXXX`;
      addClip(tx, { fileId: id, position: i, layer: top, start: 1, end: 2, id: `CUT${String(i).padStart(7, "0")}` });
    }
    addClip(tx, { fileId: "SONGXXXXXX", position: 0, layer: bottom, start: 0, end: 20, id: "MUSICCLIP1" });
    addMarker(tx, 7.5, undefined, { id: "MARKER0001" });
  });
  const project: Project = structuredClone(scratch.project);
  project.history = { undo: [], redo: [] };
  return new ProjectDocument(project);
}

function sfxClips(doc: ProjectDocument): Clip[] {
  return doc.project.clips.filter(isSfxClip);
}

function data<T>(result: { data?: unknown }): T {
  return (result.data as { data: T }).data;
}

/** Seconds from a placed clip's start to its file's hit point. */
function hitOf(doc: ProjectDocument, clip: Clip): number {
  const file = doc.project.files.find((f) => f.id === clip.file_id)!;
  return (file.zenvi_sfx as { hit: number }).hit;
}

describe("list_sfx_tool", () => {
  it("lists every recipe with its use, and filters by family", async () => {
    const all = await runTool({ doc: editProject(), host: fakeHost() }, "list_sfx_tool", {});
    expect(all.ok).toBe(true);
    const recipes = data<{ recipes: { id: string; use: string }[] }>(all).recipes;
    expect(recipes.map((r) => r.id)).toEqual(SFX_RECIPES.map((r) => r.id));
    const impacts = data<{ recipes: { family: string }[] }>(await runTool({ doc: editProject(), host: fakeHost() }, "list_sfx_tool", { family: "impact" })).recipes;
    expect(impacts.length).toBeGreaterThan(3);
    expect(impacts.every((r) => r.family === "impact")).toBe(true);
  });
});

describe("add_sfx_tool", () => {
  it("lands a whoosh's peak exactly on a clip's start, on an SFX track, in one undo step", async () => {
    const doc = editProject();
    const host = fakeHost();
    const result = await runTool({ doc, host }, "add_sfx_tool", { recipe: "whoosh_short", clip_id: "CUT0000005", gain_db: "-12", seed: "4" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toHaveLength(1);
    const [clip] = sfxClips(doc);
    expect(clip).toBeDefined();
    const hit = hitOf(doc, clip!);
    // The hit is on the cut, to the sample, and the file's hit sits on a frame boundary.
    expect(clip!.position + hit - clip!.start).toBeCloseTo(5, 6);
    expect(Math.abs(hit * FPS - Math.round(hit * FPS))).toBeLessThan(1e-3);
    const track = doc.project.layers.find((l) => l.number === clip!.layer)!;
    expect(track.label).toBe("SFX");
    const volume = (clip!.volume as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y;
    expect(volume).toBeCloseTo(10 ** (-12 / 20), 3);
    expect(host.written.size).toBe(1);
    const bytes = [...host.written.values()][0] as Uint8Array;
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    const receipt = result.data as { clips: { id: string }[]; data: { clip_id: string; cached: boolean } };
    expect(receipt.data.clip_id).toBe(clip!.id);
    expect(receipt.data.cached).toBe(false);
    expect(receipt.clips[0]!.id).toBe(clip!.id);
  });

  it("puts an impact's transient on a marker, reuses a cached sound, and opens a second lane when it overlaps", async () => {
    const doc = editProject();
    const host = fakeHost();
    expect((await runTool({ doc, host }, "add_sfx_tool", { recipe: "impact_punch", marker_id: "MARKER0001" })).ok).toBe(true);
    const again = await runTool({ doc, host }, "add_sfx_tool", { recipe: "impact_punch", at_seconds: 7.5 });
    expect(again.ok, again.text).toBe(true);
    expect(data<{ cached: boolean }>(again).cached).toBe(true);
    expect(host.written.size).toBe(1);
    const clips = sfxClips(doc);
    expect(clips).toHaveLength(2);
    for (const clip of clips) expect(clip.position + hitOf(doc, clip)).toBeCloseTo(7.5, 6);
    const labels = clips.map((c) => doc.project.layers.find((l) => l.number === c.layer)!.label).sort();
    expect(labels).toEqual(["SFX", "SFX 2"]);
    expect(new Set(clips.map((c) => c.file_id)).size).toBe(1);
  });

  it("align=start starts the sound on the moment; a hit before 0 trims the head", async () => {
    const doc = editProject();
    const host = fakeHost();
    expect((await runTool({ doc, host }, "add_sfx_tool", { recipe: "riser_noise", at_seconds: 3, align: "start", duration: 2 })).ok).toBe(true);
    expect(sfxClips(doc)[0]!.position).toBeCloseTo(3, 6);
    expect((await runTool({ doc, host }, "add_sfx_tool", { recipe: "whoosh_medium", at_seconds: 0.1 })).ok).toBe(true);
    const whoosh = sfxClips(doc).find((c) => c.title === "Whoosh, medium")!;
    expect(whoosh.position).toBe(0);
    expect(whoosh.start).toBeCloseTo(hitOf(doc, whoosh) - 0.1, 6);
  });

  it("refuses bad targets without touching history or writing media", async () => {
    for (const args of [
      { recipe: "pop" },
      { recipe: "pop", at_seconds: 1, clip_id: "CUT0000001" },
      { recipe: "pop", clip_id: "NOPE" },
      { recipe: "pop", marker_id: "NOPE" },
      { recipe: "pop", at_seconds: 1, edge: "end" },
      { recipe: "nope", at_seconds: 1 },
    ]) {
      const doc = editProject();
      const host = fakeHost();
      const result = await runTool({ doc, host }, "add_sfx_tool", args);
      expect(result.ok, JSON.stringify(args)).toBe(false);
      expect(result.text).toContain("Error");
      expect(doc.undoLabels).toHaveLength(0);
      expect(host.written.size).toBe(0);
    }
  });

  it("is unavailable where generated audio cannot be stored", async () => {
    const doc = editProject();
    const result = await runTool({ doc, host: fakeHost({ omit: ["media.writeGenerated"] }) }, "add_sfx_tool", { recipe: "pop", at_seconds: 1 });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/not available/);
    expect(doc.undoLabels).toHaveLength(0);
  });
});

describe("auto_sound_design_tool", () => {
  it("places a varied, spaced, gain-staged set with a build into the drop, in one undo step", async () => {
    const doc = editProject();
    const host = withAudio(fakeHost());
    const result = await runTool({ doc, host }, "auto_sound_design_tool", {});
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Automatic sound design"]);
    const d = data<{ cues: { clip_id: string; recipe: string; at: number; gain_db: number }[]; climax: number | null; music: { bpm: number } }>(result);
    expect(d.music.bpm).toBeGreaterThan(115);
    expect(d.climax).toBeCloseTo(12, 1);
    const clips = sfxClips(doc);
    expect(clips).toHaveLength(d.cues.length);
    expect(clips.every(isAutoSfxClip)).toBe(true);
    // Tasteful: not one per cut (19 cuts), but most moments covered.
    expect(d.cues.length).toBeGreaterThan(6);
    expect(d.cues.length).toBeLessThan(19);
    expect(d.cues.some((c) => c.recipe.startsWith("riser") && Math.abs(c.at - d.climax!) < 1e-6)).toBe(true);
    expect(d.cues.some((c) => c.recipe === "impact_boom" && Math.abs(c.at - d.climax!) < 1e-6)).toBe(true);
    const times = [...new Set(d.cues.map((c) => c.at))].sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(MIN_TRANSIENT_GAP - 1e-9);
    for (const c of d.cues) {
      expect(c.gain_db).toBeLessThanOrEqual(-7);
      expect(c.gain_db).toBeGreaterThanOrEqual(-16);
      // Every hit lands on its moment.
      const clip = clips.find((x) => x.id === c.clip_id)!;
      expect(clip.position - clip.start + hitOf(doc, clip)).toBeCloseTo(c.at, 6);
    }
    expect(new Set(d.cues.map((c) => c.recipe)).size).toBeGreaterThan(3);
  });

  it("replaces its previous run (hand-placed effects stay), reuses cached sounds, and undoes in one step", async () => {
    const doc = editProject();
    const host = withAudio(fakeHost());
    expect((await runTool({ doc, host }, "add_sfx_tool", { recipe: "camera_shutter", at_seconds: 2.5 })).ok).toBe(true);
    const manual = sfxClips(doc)[0]!;
    const first = await runTool({ doc, host }, "auto_sound_design_tool", { intensity: "hype" });
    const firstIds = data<{ cues: { clip_id: string }[] }>(first).cues.map((c) => c.clip_id);
    const written = host.written.size;

    const same = await runTool({ doc, host }, "auto_sound_design_tool", { intensity: "hype" });
    expect(same.ok, same.text).toBe(true);
    // Same design: every sound comes from the bin, nothing is rendered or written again.
    expect(host.written.size).toBe(written);
    expect(data<{ replaced_clip_ids: string[] }>(same).replaced_clip_ids.sort()).toEqual([...firstIds].sort());

    const subtle = await runTool({ doc, host }, "auto_sound_design_tool", { intensity: "subtle" });
    const subtleCues = data<{ cues: { clip_id: string }[]; removed_file_ids: string[] }>(subtle);
    expect(subtleCues.cues.length).toBeLessThan(firstIds.length);
    const auto = doc.project.clips.filter(isAutoSfxClip);
    expect(auto.map((c) => c.id).sort()).toEqual(subtleCues.cues.map((c) => c.clip_id).sort());
    expect(doc.project.clips.find((c) => c.id === manual.id)).toBeDefined();
    // Sounds no clip plays any more leave the bin.
    expect(subtleCues.removed_file_ids.length).toBeGreaterThan(0);
    const used = new Set(doc.project.clips.map((c) => c.file_id));
    expect(doc.project.files.filter((f) => f.zenvi_role === "sfx").every((f) => used.has(f.id))).toBe(true);

    expect(doc.undoLabels).toHaveLength(4);
    doc.undo(1);
    expect(doc.project.clips.filter(isAutoSfxClip)).toHaveLength(firstIds.length);
  });

  it("works from given beats and climax where audio cannot be decoded, and says so otherwise", async () => {
    const doc = editProject();
    const result = await runTool({ doc, host: fakeHost({ without: ["audio"] }) }, "auto_sound_design_tool", {});
    expect(result.ok, result.text).toBe(true);
    expect((result.data as { warnings: string[] }).warnings.join(" ")).toMatch(/cannot analyse audio/);
    expect(data<{ climax: number | null }>(result).climax).toBeNull();

    const given = await runTool({ doc: editProject(), host: fakeHost({ without: ["audio"] }) }, "auto_sound_design_tool", {
      beats: Array.from({ length: 40 }, (_, i) => i * 0.5),
      climax_seconds: "16",
    });
    expect(given.ok, given.text).toBe(true);
    const d = data<{ climax: number; cues: { recipe: string; at: number }[] }>(given);
    expect(d.climax).toBe(16);
    expect(d.cues.some((c) => c.recipe === "impact_boom" && c.at === 16)).toBe(true);
  });

  it("refuses an empty timeline and a climax past the end, leaving history untouched", async () => {
    const empty = new ProjectDocument(createProject({ id: "EMPTYPROJ1" }));
    const host = fakeHost();
    const none = await runTool({ doc: empty, host }, "auto_sound_design_tool", {});
    expect(none.ok).toBe(false);
    expect(none.text).toMatch(/nothing to sound-design/);
    const doc = editProject();
    const late = await runTool({ doc, host }, "auto_sound_design_tool", { climax_seconds: 99 });
    expect(late.ok).toBe(false);
    expect(doc.undoLabels).toHaveLength(0);
    expect(host.written.size).toBe(0);
  });
});
