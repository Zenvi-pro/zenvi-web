import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import type { Clip, Project } from "../model/types.js";
import { addClip } from "../ops/clips.js";
import { addFile } from "../ops/files.js";
import { Rng } from "../sfx/dsp.js";
import { isSfxClip } from "../sfx/moments.js";
import { recordedSample } from "../sfx/recorded.js";
import { runTool } from "./registry.js";
import { kitUsesOf, recordedIdOfKey } from "./sfx-recorded.js";
import { markOf } from "./sfx-media.js";
import { fakeHost, type FakeHost } from "./test-support/fake-host.js";
import { media, videoInfo } from "./test-support/fixture.js";

/** 0.6 s of noise with a fast attack: stands in for every recording. */
function burst(): { sampleRate: number; samples: Float32Array; right: Float32Array } {
  const sr = 44100;
  const rng = new Rng(5);
  const left = new Float32Array(Math.round(0.6 * sr));
  const right = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) {
    const env = Math.exp(-i / (0.1 * sr)) * 0.5;
    left[i] = rng.bipolar() * env;
    right[i] = rng.bipolar() * env;
  }
  return { sampleRate: sr, samples: left, right };
}

/** A host with the recorded kit: `kitSample` resolves (or fails with `offline`) and decoding works. */
function kitHost(options: { offline?: boolean } = {}): FakeHost {
  const host = fakeHost();
  host.media!.kitSample = async (sample) => {
    host.calls.push(`kitSample ${sample.url}`);
    if (options.offline) throw new Error("could not reach Freesound (offline).");
    return `/cache/sfx-kit/${sample.sha256}.mp3`;
  };
  host.audio!.decodePcm = async () => burst();
  return host;
}

/** 4 s: eight shots of 0.5 s, a cut every half second, no music. */
function edit(): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "KITPROJ001" }));
  scratch.transaction("fixture", (tx) => {
    addFile(tx, media("/media/a.mp4", videoInfo("/media/a.mp4", 30)), { id: "SHOTAXXXXX" });
    const top = tx.project.layers.map((l) => l.number).sort((a, b) => b - a)[0]!;
    for (let i = 0; i < 8; i += 1) addClip(tx, { fileId: "SHOTAXXXXX", position: i * 0.5, layer: top, start: i, end: i + 0.5, id: `CUT${String(i).padStart(7, "0")}` });
  });
  const project: Project = structuredClone(scratch.project);
  project.history = { undo: [], redo: [] };
  return new ProjectDocument(project);
}

const sfxClips = (doc: ProjectDocument): Clip[] => doc.project.clips.filter(isSfxClip).sort((a, b) => a.position - b.position);
const kitIdOf = (doc: ProjectDocument, clip: Clip): number | undefined => {
  const file = doc.project.files.find((f) => f.id === clip.file_id);
  return file ? recordedIdOfKey(markOf(file)?.key) : undefined;
};
type AutoData = { own_sounds: { kit: string; recorded: number } | null; cues: { recipe: string; library?: string }[] };
const dataOf = <T>(result: { data?: unknown }): T => (result.data as { data: T }).data;

describe("auto_sound_design_tool with the recorded kit", () => {
  it("plays every cut through recorded CC0 sounds, never the same one twice in a row, in one undo step", async () => {
    const doc = edit();
    const host = kitHost();
    const result = await runTool({ doc, host }, "auto_sound_design_tool", { density: "every_cut", intensity: "hype" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toHaveLength(1);
    const data = dataOf<AutoData>(result);
    expect(data.own_sounds).toMatchObject({ kit: "recorded" });
    expect(data.own_sounds!.recorded).toBeGreaterThanOrEqual(5);
    expect(data.cues.filter((c) => c.library?.startsWith("freesound:")).length).toBe(data.own_sounds!.recorded);
    const ids = sfxClips(doc).map((c) => kitIdOf(doc, c)).filter((id): id is number => id !== undefined);
    for (let i = 1; i < ids.length; i += 1) expect(ids[i]).not.toBe(ids[i - 1]);
    // Credited as CC0, no credit needed.
    const credited = doc.project.files.filter((f) => recordedIdOfKey(markOf(f)?.key) !== undefined);
    expect(credited.length).toBeGreaterThan(0);
    for (const f of credited) expect(f.zenvi_credit).toMatchObject({ provider: "freesound", license: "cc0", attribution_required: false });
    // One fetch per sound however many cues play it.
    const fetched = host.calls.filter((c) => c.startsWith("kitSample "));
    expect(new Set(fetched).size).toBe(fetched.length);
  });

  it("kit=synth synthesises and fetches nothing", async () => {
    const doc = edit();
    const host = kitHost();
    const result = await runTool({ doc, host }, "auto_sound_design_tool", { density: "every_cut", kit: "synth" });
    expect(result.ok, result.text).toBe(true);
    expect(dataOf<AutoData>(result).own_sounds).toEqual({ kit: "synth", recorded: 0 });
    expect(host.calls.some((c) => c.startsWith("kitSample"))).toBe(false);
  });

  it("falls back to the synth offline, and says so", async () => {
    const doc = edit();
    const result = await runTool({ doc, host: kitHost({ offline: true }) }, "auto_sound_design_tool", { density: "every_cut" });
    expect(result.ok, result.text).toBe(true);
    expect(dataOf<AutoData>(result).own_sounds).toEqual({ kit: "recorded", recorded: 0 });
    expect(result.text).toMatch(/could not be fetched, so they are synthesised/);
    expect(sfxClips(doc).length).toBeGreaterThan(0);
  });

  it("synthesises on surfaces that cannot fetch the kit (the default there is synth)", async () => {
    const result = await runTool({ doc: edit(), host: fakeHost() }, "auto_sound_design_tool", { density: "every_cut" });
    expect(dataOf<AutoData>(result).own_sounds).toEqual({ kit: "synth", recorded: 0 });
  });
});

describe("add_sfx_tool with the recorded kit", () => {
  it("plays a recipe as a recording, and the next one beside it is another recording", async () => {
    const doc = edit();
    const host = kitHost();
    const first = await runTool({ doc, host }, "add_sfx_tool", { recipe: "camera_shutter", at_seconds: 1 });
    expect(first.ok, first.text).toBe(true);
    expect(first.text).toMatch(/A recording from Zenvi's kit, CC0 1\.0, no credit needed/);
    expect(dataOf<{ kit: string }>(first).kit).toBe("recorded");
    const second = await runTool({ doc, host }, "add_sfx_tool", { recipe: "camera_shutter", at_seconds: 2 });
    expect(second.ok, second.text).toBe(true);
    const [a, b] = sfxClips(doc).map((c) => kitIdOf(doc, c));
    expect(recordedSample(a!)?.group).toBe("shutter");
    expect(b).not.toBe(a);
    expect(doc.undoLabels).toHaveLength(2);
  });

  it("synthesises when the sound is shaped (pitch), refuses shaping a recording, and keeps recipes the kit has none of", async () => {
    const doc = edit();
    const host = kitHost();
    const shaped = await runTool({ doc, host }, "add_sfx_tool", { recipe: "whoosh_short", at_seconds: 1, pitch: -3 });
    expect(dataOf<{ kit: string }>(shaped).kit).toBe("synth");
    const refusedCall = await runTool({ doc, host }, "add_sfx_tool", { recipe: "whoosh_short", at_seconds: 1, pitch: -3, kit: "recorded" });
    expect(refusedCall.ok).toBe(false);
    expect(refusedCall.text).toMatch(/Error: pitch shapes a synthesised sound; kit=recorded plays a recording/);
    const none = await runTool({ doc, host }, "add_sfx_tool", { recipe: "swoosh_hit", at_seconds: 2 });
    expect(dataOf<{ kit: string }>(none).kit).toBe("synth");
    expect(host.calls.some((c) => c.startsWith("kitSample"))).toBe(false);
    // Sub drops are recorded now (bass drums, timpani, taiko).
    const sub = await runTool({ doc, host }, "add_sfx_tool", { recipe: "sub_drop", at_seconds: 3 });
    expect(dataOf<{ kit: string }>(sub).kit).toBe("recorded");
  });

  it("places a kit sound by its search id, varies a repeat, and refuses unknown ids", async () => {
    const doc = edit();
    const host = kitHost();
    const search = await runTool({ doc, host }, "search_sound_library_tool", { category: "sparkle", brightness: "bright", near_seconds: 1 });
    expect(search.ok, search.text).toBe(true);
    const found = dataOf<{ pick: string; results: { id: string; category: string; brightness: string }[] }>(search);
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results.every((r) => r.category === "sparkle" && r.brightness === "bright")).toBe(true);
    const placed = await runTool({ doc, host }, "add_sfx_tool", { provider: "kit", sound_id: found.pick, at_seconds: 1 });
    expect(placed.ok, placed.text).toBe(true);
    expect(placed.text).toMatch(/A recording from Zenvi's kit, CC0 1\.0/);
    const again = await runTool({ doc, host }, "add_sfx_tool", { provider: "kit", sound_id: found.pick, at_seconds: 3 });
    expect(again.ok, again.text).toBe(true);
    // The repeat is its own file: pitched and levelled a little differently.
    const [a, b] = sfxClips(doc);
    expect(a!.file_id).not.toBe(b!.file_id);
    expect(String(doc.project.files.find((f) => f.id === b!.file_id)?.path)).toMatch(/-p-?\d+g-?\d+-v\d+\.wav$/);
    expect(doc.undoLabels).toHaveLength(2);
    // The variety rules now steer the next search's pick away from it.
    const next = await runTool({ doc, host }, "search_sound_library_tool", { category: "sparkle", brightness: "bright", near_seconds: 2 });
    expect(dataOf<{ pick: string }>(next).pick).not.toBe(found.pick);

    const unknown = await runTool({ doc, host }, "add_sfx_tool", { provider: "kit", sound_id: "1", at_seconds: 1 });
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toMatch(/Error: Zenvi's kit has no sound 1/);
    const elsewhere = await runTool({ doc: edit(), host: fakeHost() }, "add_sfx_tool", { provider: "kit", sound_id: found.pick, at_seconds: 1 });
    expect(elsewhere.ok).toBe(false);
    expect(elsewhere.text).toMatch(/cannot fetch Zenvi's recorded kit/);
  });

  it("counts a placed kit sound at its hit point, not where its pre-roll starts", async () => {
    // Regression: the variety rules read clip starts, so a whoosh peaking on 2 s counted as 0.4 s earlier than the moments asked about.
    const doc = edit();
    const host = kitHost();
    host.audio!.decodePcm = async () => {
      const sr = 44100;
      const rng = new Rng(9);
      const samples = Float32Array.from({ length: Math.round(0.6 * sr) }, (_, i) => rng.bipolar() * 0.5 * (i < 0.4 * sr ? (i / (0.4 * sr)) ** 2 : Math.exp(-(i - 0.4 * sr) / (0.03 * sr))));
      return { sampleRate: sr, samples };
    };
    const placed = await runTool({ doc, host }, "add_sfx_tool", { recipe: "whoosh_short", at_seconds: 2 });
    expect(placed.ok, placed.text).toBe(true);
    const [clip] = sfxClips(doc);
    expect(clip!.position).toBeLessThan(1.8);
    const [use] = kitUsesOf(doc.project);
    expect(use).toEqual({ id: kitIdOf(doc, clip!), at: expect.closeTo(2, 3) });
  });

  it("lists the library's categories when asked for nothing in particular", async () => {
    const result = await runTool({ doc: edit(), host: kitHost() }, "search_sound_library_tool", {});
    expect(result.ok, result.text).toBe(true);
    const data = dataOf<{ total: number; categories: { category: string; sounds: number }[] }>(result);
    expect(data.total).toBeGreaterThanOrEqual(400);
    expect(data.categories.map((c) => c.category)).toContain("ambience");
  });
});

describe("generate_sfx_tool", () => {
  it("is refused with the reason where no generator is configured", async () => {
    const result = await runTool({ doc: edit(), host: kitHost() }, "generate_sfx_tool", { prompt: "deep cinematic braam", duration_seconds: 3 });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/no sound generator is configured.*ELEVENLABS_API_KEY/);
  });

  it("refuses prompts naming someone else's work before anything is paid", async () => {
    const host = kitHost();
    host.audio!.generateSfx = async () => {
      throw new Error("must not be called");
    };
    const result = await runTool({ doc: edit(), host }, "generate_sfx_tool", { prompt: "star wars lightsaber hum", duration_seconds: 2 });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/names 'star wars'/);
  });

  it("generates, conditions and places a cue in one undo step, and reuses the cache and the bin file", async () => {
    const doc = edit();
    const host = kitHost();
    const asked: unknown[] = [];
    host.audio!.generateSfx = async (request) => {
      asked.push(request);
      return { path: "/cache/sfx-gen/abc.mp3", provider: "elevenlabs", model: "eleven_text_to_sound_v2", key: "ab".repeat(32), cached: asked.length > 1, costUsd: 0.015, licence: "paid plan", termsUrl: "https://elevenlabs.io/terms-of-use" };
    };
    const result = await runTool({ doc, host }, "generate_sfx_tool", { prompt: "deep cinematic braam, brass", duration_seconds: 2, role: "boom", at_seconds: 2 });
    expect(result.ok, result.text).toBe(true);
    expect(asked[0]).toEqual({ prompt: "deep cinematic braam, brass", durationSeconds: 2, promptInfluence: 0.7, loop: false });
    expect(doc.undoLabels).toHaveLength(1);
    const data = dataOf<{ clip_id: string; hit_seconds: number; generated: { cached: boolean; cost_usd: number } }>(result);
    expect(data.hit_seconds).toBeCloseTo(2, 5);
    expect(data.generated).toMatchObject({ cached: false, cost_usd: 0.015 });
    const file = doc.project.files.find((f) => f.id === sfxClips(doc)[0]!.file_id)!;
    expect(file.zenvi_credit).toMatchObject({ provider: "generated", attribution_required: false });

    const again = await runTool({ doc, host }, "generate_sfx_tool", { prompt: "deep cinematic braam, brass", duration_seconds: 2, role: "boom", at_seconds: 3 });
    expect(again.ok, again.text).toBe(true);
    expect(again.text).toMatch(/from the cache/);
    const [x, y] = sfxClips(doc);
    expect(y!.file_id).toBe(x!.file_id);
  });
});
