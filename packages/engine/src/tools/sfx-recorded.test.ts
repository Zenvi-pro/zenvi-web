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
import { recordedIdOfKey } from "./sfx-recorded.js";
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
    const sub = await runTool({ doc, host }, "add_sfx_tool", { recipe: "sub_drop", at_seconds: 2 });
    expect(dataOf<{ kit: string }>(sub).kit).toBe("synth");
    expect(host.calls.some((c) => c.startsWith("kitSample"))).toBe(false);
  });
});
