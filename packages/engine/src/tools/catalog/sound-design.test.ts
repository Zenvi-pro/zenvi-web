import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Clip, Project } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { addTrack } from "../../ops/tracks.js";
import { addMarker } from "../../ops/markers.js";
import { isAutoSfxClip, isSfxClip } from "../../sfx/moments.js";
import { PALETTES } from "../../sfx/palettes.js";
import { SFX_RECIPES } from "../../sfx/recipes.js";
import { curvePoints, evaluateVolumeCurve } from "../audio-mix.js";
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

/** A 20 ms click: what every generated effect decodes to here. */
function click(): Float32Array {
  const out = new Float32Array(SR / 2);
  for (let i = 0; i < SR / 50; i += 1) out[i] = 0.8 * Math.exp(-i / 200);
  return out;
}

function withAudio(host: FakeHost): FakeHost {
  host.audio = {
    analyzeAudio: async () => ({ sampleRate: 16000, frameSize: 480, rms: new Float32Array(0) }),
    decodePcm: async (path) => ({ sampleRate: SR, samples: path === "/media/song.mp3" ? song() : click() }),
  };
  return host;
}

/** `seconds` (default 20) cut every second (four shots alternating), the song under it, history empty. */
function editProject(seconds = 20): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "SFXPROJ001" }));
  scratch.transaction("fixture", (tx) => {
    for (const name of ["aa", "bb", "cc", "dd"]) addFile(tx, media(`/media/${name}.mp4`, videoInfo(`/media/${name}.mp4`, 30)), { id: `SHOT${name.toUpperCase()}XXXX` });
    addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 30)), { id: "SONGXXXXXX" });
    const top = tx.project.layers.map((l) => l.number).sort((a, b) => b - a)[0]!;
    const bottom = tx.project.layers.map((l) => l.number).sort((a, b) => a - b)[0]!;
    for (let i = 0; i < seconds; i += 1) {
      const id = `SHOT${["AA", "BB", "CC", "DD"][i % 4]}XXXX`;
      addClip(tx, { fileId: id, position: i, layer: top, start: 1, end: 2, id: `CUT${String(i).padStart(7, "0")}` });
    }
    addClip(tx, { fileId: "SONGXXXXXX", position: 0, layer: bottom, start: 0, end: seconds, id: "MUSICCLIP1" });
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

function endOf(clip: Clip): number {
  return clip.position + (clip.end - clip.start);
}

/** A clip's volume points, in frame order. */
function volumePoints(clip: Clip): { X: number; Y: number }[] {
  return (clip.volume as { Points: { co: { X: number; Y: number } }[] }).Points.map((p) => p.co).sort((a, b) => a.X - b.X);
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

  it("numbers a new lane after the highest one", async () => {
    const doc = editProject();
    doc.transaction("lanes", (tx) => {
      addTrack(tx, { label: "SFX" });
      addTrack(tx, { label: "SFX 3" });
    });
    const host = fakeHost();
    for (let i = 0; i < 3; i += 1) expect((await runTool({ doc, host }, "add_sfx_tool", { recipe: "pop", at_seconds: 4 })).ok).toBe(true);
    expect(doc.project.layers.map((l) => l.label).filter((l) => /^SFX/.test(String(l))).sort()).toEqual(["SFX", "SFX 3", "SFX 4"]);
  });

  it("cuts a tail that would run past the picture at its last frame, fades it, and says so", async () => {
    // E2E bug: a 2.6 s boom at 8.6 s on a 10 s picture ran to 11.2 s, and the render delivered black for it.
    const doc = editProject(10);
    const result = await runTool({ doc, host: fakeHost() }, "add_sfx_tool", { recipe: "impact_boom", at_seconds: "8.6" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toHaveLength(1);
    const [clip] = sfxClips(doc);
    expect(clip!.position + hitOf(doc, clip!) - clip!.start).toBeCloseTo(8.6, 6);
    expect(endOf(clip!)).toBeCloseTo(10, 6);
    const d = data<{ trimmed_seconds: number; fade_out_seconds: number; ends_at: number }>(result);
    expect(d.ends_at).toBe(10);
    expect(d.trimmed_seconds).toBeGreaterThan(1);
    expect(d.fade_out_seconds).toBeCloseTo(0.5, 6);
    expect((result.data as { summary: string }).summary).toMatch(/ends with it at 10\.00 s, faded over 0\.50 s/);
    // Full level until the fade, silent on the clip's last frame.
    const points = volumePoints(clip!);
    expect(points[0]!.Y).toBeCloseTo(10 ** (-8 / 20), 1);
    expect(points[points.length - 1]!.Y).toBe(0);
    expect(points[points.length - 1]!.X).toBe(Math.round(clip!.end * FPS) + 1);
    // A sound that fits is left alone; a riser may end on the very last frame.
    expect(data<{ trimmed_seconds?: number }>(await runTool({ doc, host: fakeHost() }, "add_sfx_tool", { recipe: "riser_noise", at_seconds: 10 })).trimmed_seconds).toBeUndefined();
    expect(Math.max(...sfxClips(doc).map(endOf))).toBeCloseTo(10, 6);
  });

  it("refuses a hit at or after the end of the picture", async () => {
    const doc = editProject(10);
    const host = fakeHost();
    for (const args of [
      { recipe: "whoosh_short", clip_id: "CUT0000009", edge: "end" },
      { recipe: "impact_punch", at_seconds: 12 },
      { recipe: "riser_noise", at_seconds: 10.5 },
      { recipe: "pop", at_seconds: 10, align: "start" },
    ]) {
      const result = await runTool({ doc, host }, "add_sfx_tool", args);
      expect(result.ok, JSON.stringify(args)).toBe(false);
      expect(result.text).toMatch(/end of the picture \(10\.00 s\)/);
    }
    expect(doc.undoLabels).toHaveLength(0);
    expect(host.written.size).toBe(0);
  });

  it("refuses bad targets without touching history or writing media", async () => {
    for (const args of [
      { recipe: "pop" },
      { recipe: "pop", at_seconds: 1, clip_id: "CUT0000001" },
      { recipe: "pop", clip_id: "NOPE" },
      { recipe: "pop", marker_id: "NOPE" },
      { recipe: "pop", at_seconds: 1, edge: "end" },
      { recipe: "nope", at_seconds: 1 },
      { recipe: "riser_noise", at_seconds: 0 },
      // Above unity: libopenshot's clip volume runs 0..1.
      { recipe: "pop", at_seconds: 1, gain_db: 2 },
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

interface AutoData {
  genre: string;
  genre_guessed: boolean;
  climax: number | null;
  riser: boolean;
  music: { bpm: number } | null;
  hit_points: number;
  sounded: number;
  bed_dips: { from: number; to: number; db: number; reason: string }[];
  cues: { clip_id: string; recipe: string; role: string; layer: string; at: number; hit_seconds: number; gain_db: number; reason: string; trimmed_seconds?: number }[];
  replaced_clip_ids: string[];
  removed_file_ids: string[];
  levelled_over_bed: number;
}

/** Two 0.9 s shots of one file: one weak cut, no music. */
function quietProject(id: string): ProjectDocument {
  const doc = new ProjectDocument(createProject({ id }));
  doc.transaction("two shots", (tx) => {
    addFile(tx, media("/media/aa.mp4", videoInfo("/media/aa.mp4", 30)), { id: "SHOTAAXXXX" });
    const layer = tx.project.layers[0]!.number;
    addClip(tx, { fileId: "SHOTAAXXXX", position: 0, layer, start: 0, end: 0.9 });
    addClip(tx, { fileId: "SHOTAAXXXX", position: 0.9, layer, start: 3, end: 3.9 });
  });
  return doc;
}

describe("spot_sound_tool", () => {
  it("lists the cue sheet and the genre it reads as, read-only", async () => {
    const doc = editProject();
    const result = await runTool({ doc, host: withAudio(fakeHost()) }, "spot_sound_tool", {});
    expect(result.ok, result.text).toBe(true);
    expect((result.data as { status: string }).status).toBe("unchanged");
    expect(doc.undoLabels).toHaveLength(0);
    const d = data<{ genre: string; points_total: number; needs_cue: number; by_kind: Record<string, number>; climax: number; points: { t: number; kind: string; role: string; needs_cue: boolean }[] }>(result);
    expect(d.by_kind.cut).toBe(19);
    expect(d.climax).toBeCloseTo(12, 1);
    // The drop lands on the cut at 12 s.
    expect(d.points.find((p) => Math.abs(p.t - 12) < 0.01)!.role).toBe("hero");
    expect(d.points.every((p) => p.needs_cue)).toBe(true);
    const named = data<{ genre: string; genre_guessed: boolean }>(await runTool({ doc, host: withAudio(fakeHost()) }, "spot_sound_tool", { genre: "documentary" }));
    expect([named.genre, named.genre_guessed]).toEqual(["documentary", false]);
  });
});

describe("auto_sound_design_tool", () => {
  it("designs from the cue sheet in the genre's palette: layered heroes, a riser that stops a beat early, the bed sucked out, one undo step", async () => {
    const doc = editProject();
    const host = withAudio(fakeHost());
    const result = await runTool({ doc, host }, "auto_sound_design_tool", { genre: "hype" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Automatic sound design"]);
    const d = data<AutoData>(result);
    expect(d.genre).toBe("hype");
    expect(d.music!.bpm).toBeGreaterThan(115);
    expect(d.climax).toBeCloseTo(12, 1);
    const clips = sfxClips(doc);
    expect(clips).toHaveLength(d.cues.length);
    expect(clips.every(isAutoSfxClip)).toBe(true);
    // The drop: transient, body, sub and tail on one sample, marked as one cue.
    const drop = d.cues.filter((c) => Math.abs(c.at - d.climax!) < 1e-6 && c.role === "hero");
    expect(drop.map((c) => c.layer).sort()).toEqual(["body", "sub", "tail", "transient"]);
    expect(new Set(drop.map((c) => (doc.project.clips.find((x) => x.id === c.clip_id)!.zenvi_sfx as { cue: string }).cue)).size).toBe(1);
    const riser = d.cues.find((c) => c.layer === "riser")!;
    expect(riser.at).toBeCloseTo(d.climax! - PALETTES.hype.suckOut, 1);
    expect(d.bed_dips.some((b) => b.reason === "suck-out before the drop" && b.db === -18)).toBe(true);
    expect(volumePoints(doc.project.clips.find((c) => c.id === "MUSICCLIP1")!).some((p) => p.Y < 0.2)).toBe(true);
    for (const c of d.cues) {
      expect(c.gain_db).toBeLessThanOrEqual(0);
      // Every hit lands on its moment.
      const clip = clips.find((x) => x.id === c.clip_id)!;
      expect(clip.position - clip.start + hitOf(doc, clip)).toBeCloseTo(c.hit_seconds, 4);
    }
    // Most of the 19 cuts sound in hype; nothing plays inside the suck-out.
    expect(d.sounded).toBeGreaterThan(14);
    expect(d.cues.filter((c) => c.at > d.climax! - PALETTES.hype.suckOut + 1e-6 && c.at < d.climax! - 1e-6)).toHaveLength(0);
  });

  it("replaces its previous run and its bed dips (hand-placed effects stay), reuses cached sounds, and undoes in one step", async () => {
    const doc = editProject();
    const host = withAudio(fakeHost());
    expect((await runTool({ doc, host }, "add_sfx_tool", { recipe: "camera_shutter", at_seconds: 2.5 })).ok).toBe(true);
    const manual = sfxClips(doc)[0]!;
    const bedBefore = structuredClone(doc.project.clips.find((c) => c.id === "MUSICCLIP1")!.volume);
    const first = data<AutoData>(await runTool({ doc, host }, "auto_sound_design_tool", { genre: "hype" }));
    const bedAfterFirst = structuredClone(doc.project.clips.find((c) => c.id === "MUSICCLIP1")!.volume);
    const written = host.written.size;

    const same = await runTool({ doc, host }, "auto_sound_design_tool", { genre: "hype" });
    expect(same.ok, same.text).toBe(true);
    // Same design: every sound comes from the bin, and the bed's dips are put back before they go on again.
    expect(host.written.size).toBe(written);
    expect(data<AutoData>(same).replaced_clip_ids.sort()).toEqual(first.cues.map((c) => c.clip_id).sort());
    expect(doc.project.clips.find((c) => c.id === "MUSICCLIP1")!.volume).toEqual(bedAfterFirst);

    const subtle = data<AutoData>(await runTool({ doc, host }, "auto_sound_design_tool", { genre: "hype", intensity: "subtle" }));
    expect(subtle.sounded).toBeLessThan(first.sounded);
    expect(doc.project.clips.filter(isAutoSfxClip).map((c) => c.id).sort()).toEqual(subtle.cues.map((c) => c.clip_id).sort());
    expect(doc.project.clips.find((c) => c.id === manual.id)).toBeDefined();
    const used = new Set(doc.project.clips.map((c) => c.file_id));
    expect(doc.project.files.filter((f) => f.zenvi_role === "sfx").every((f) => used.has(f.id))).toBe(true);

    expect(doc.undoLabels).toHaveLength(4);
    doc.undo(3);
    expect(doc.project.clips.filter(isAutoSfxClip)).toHaveLength(0);
    expect(doc.project.clips.find((c) => c.id === "MUSICCLIP1")!.volume).toEqual(bedBefore);
  });

  it("levels every cue over the bed as it plays, and a rerun over its own dips lands the same levels", async () => {
    const doc = editProject();
    const host = withAudio(fakeHost());
    // The export's mix of the song clip: its volume curve applied (30 fps, source frame = timeline frame + 1).
    host.audio!.mixPcm = async (project) => {
      const music = project.clips.find((c) => c.id === "MUSICCLIP1")!;
      const points = curvePoints(music);
      const out = song().slice(0, 20 * SR).map((v, i) => v * evaluateVolumeCurve(points, (i / SR) * FPS + 1, 1));
      return { sampleRate: SR, channels: [out, Float32Array.from(out)] };
    };
    const first = data<AutoData>(await runTool({ doc, host }, "auto_sound_design_tool", { genre: "hype" }));
    expect(first.levelled_over_bed).toBeGreaterThan(0);
    expect(first.bed_dips.length).toBeGreaterThan(1);
    const again = data<AutoData>(await runTool({ doc, host }, "auto_sound_design_tool", { genre: "hype" }));
    const levels = (d: AutoData) => d.cues.map((c) => `${c.at.toFixed(3)} ${c.layer} ${c.recipe} ${c.gain_db}`).sort();
    expect(levels(again)).toEqual(levels(first));
  });

  it("reads the genre from the edit, and works from given beats and climax where audio cannot be decoded", async () => {
    const guessed = data<AutoData>(await runTool({ doc: editProject(), host: withAudio(fakeHost()) }, "auto_sound_design_tool", {}));
    expect([guessed.genre, guessed.genre_guessed]).toEqual(["editorial", true]);

    const blind = await runTool({ doc: editProject(), host: fakeHost({ without: ["audio"] }) }, "auto_sound_design_tool", {});
    expect(blind.ok, blind.text).toBe(true);
    expect((blind.data as { warnings: string[] }).warnings.join(" ")).toMatch(/cannot analyse audio/);
    expect(data<AutoData>(blind).climax).toBeNull();

    const given = await runTool({ doc: editProject(), host: fakeHost({ without: ["audio"] }) }, "auto_sound_design_tool", { genre: "hype", beats: Array.from({ length: 40 }, (_, i) => i * 0.5), climax_seconds: "16" });
    expect(given.ok, given.text).toBe(true);
    const d = data<AutoData>(given);
    expect(d.climax).toBe(16);
    expect(d.cues.some((c) => c.layer === "sub" && c.at === 16)).toBe(true);
    expect((given.data as { warnings: string[] }).warnings).toHaveLength(0);
  });

  it("never plays past the picture: a late climax gets shorter layers, any tail left over is cut and faded", async () => {
    const doc = editProject(10);
    const result = await runTool({ doc, host: fakeHost({ without: ["audio"] }) }, "auto_sound_design_tool", { genre: "hype", climax_seconds: "8.6" });
    expect(result.ok, result.text).toBe(true);
    const d = data<AutoData>(result);
    for (const clip of sfxClips(doc)) expect(endOf(clip)).toBeLessThanOrEqual(10 + 1e-6);
    expect(d.cues.some((c) => /shortened to end with the picture/.test(c.reason))).toBe(true);
    for (const c of d.cues.filter((x) => x.trimmed_seconds !== undefined)) {
      const points = volumePoints(doc.project.clips.find((x) => x.id === c.clip_id)!);
      expect(points[points.length - 1]!.Y).toBe(0);
    }
  });

  it("changes nothing when every hit point stays dry, and says so when a rerun only removes the last run", async () => {
    const doc = quietProject("QUIETPROJ1");
    const host = fakeHost();
    const dry = await runTool({ doc, host }, "auto_sound_design_tool", { genre: "documentary" });
    expect(dry.ok, dry.text).toBe(true);
    expect((dry.data as { status: string }).status).toBe("unchanged");
    expect(doc.undoLabels).toHaveLength(1);
    expect(host.written.size).toBe(0);

    expect(data<AutoData>(await runTool({ doc, host }, "auto_sound_design_tool", { genre: "hype" })).cues.length).toBeGreaterThan(0);
    const again = await runTool({ doc, host }, "auto_sound_design_tool", { genre: "documentary" });
    expect((again.data as { summary: string }).summary).toMatch(/^Removed the \d+ effects of the last run/);
    expect(doc.project.clips.filter(isAutoSfxClip)).toHaveLength(0);
  });

  it("refuses an empty timeline and a climax past or on the end, leaving history untouched", async () => {
    const empty = new ProjectDocument(createProject({ id: "EMPTYPROJ1" }));
    const host = fakeHost();
    const none = await runTool({ doc: empty, host }, "auto_sound_design_tool", {});
    expect(none.ok).toBe(false);
    expect(none.text).toMatch(/nothing to sound-design/);
    const doc = editProject();
    const late = await runTool({ doc, host }, "auto_sound_design_tool", { climax_seconds: 99 });
    expect(late.ok).toBe(false);
    // On the last frames there is no picture left for the impact: refused, not silently dropped.
    const edge = await runTool({ doc, host }, "auto_sound_design_tool", { climax_seconds: 19.9 });
    expect(edge.ok).toBe(false);
    expect(edge.text).toMatch(/less than 0.25 s of picture/);
    expect(doc.undoLabels).toHaveLength(0);
    expect(host.written.size).toBe(0);
  });
});
