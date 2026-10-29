import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../../history/document.js";
import { createProject } from "../../../model/defaults.js";
import { findProfile } from "../../../model/profiles.js";
import type { Clip, Project } from "../../../model/types.js";
import { addFile } from "../../../ops/files.js";
import { runTool } from "../../registry.js";
import { fakeHost } from "../../test-support/fake-host.js";
import { audioInfo, imageInfo, media, videoInfo } from "../../test-support/fixture.js";
import type { BuildDecision } from "./compose.js";

/** "word@start" tokens, each word 0.3 s long, as a kept transcription. */
function asr(...tokens: string[]): Record<string, unknown> {
  const words = tokens.map((t) => {
    const [text, at] = t.split("@");
    return { text, startSec: Number(at), endSec: Number(at) + 0.3 };
  });
  return { modelId: "test", language: "en", requestLanguage: "auto", generation: 1, transcriptionSource: "server", createdAt: 0, words, segments: [] };
}

const SPEECH = asr("so@0.5", "this@0.85", "is@1.2", "the@1.55", "story@1.9", "how@3", "a@3.35", "rocket@3.7", "flies@4.1", "over@4.45", "the@4.8", "ocean@5.15", "in@8", "300%@8.35", "less@8.7", "time@9.05", "watch@12", "closely@12.35");

/** A vertical project: a talking take, a voice-over, B-roll named for what it shows, a song. */
function project(): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "BUILDPROJ1", profile: findProfile("FHD Vertical 1080p 30 fps")! }));
  scratch.transaction("fixture", (tx) => {
    addFile(tx, media("/media/take1.mp4", videoInfo("/media/take1.mp4", 14)), { id: "TAKE000001" });
    addFile(tx, media("/media/voiceover.wav", audioInfo("/media/voiceover.wav", 14)), { id: "VOICE00001" });
    addFile(tx, media("/media/rocket_launch.mp4", videoInfo("/media/rocket_launch.mp4", 8, { has_audio: false })), { id: "ROCKET0001" });
    addFile(tx, media("/media/ocean.png", imageInfo("/media/ocean.png")), { id: "OCEAN00001" });
    addFile(tx, media("/media/city_night.mp4", videoInfo("/media/city_night.mp4", 8, { has_audio: false })), { id: "CITY000001" });
    addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 60)), { id: "SONG000001" });
  });
  const p: Project = structuredClone(scratch.project);
  for (const f of p.files) if (f.id === "TAKE000001" || f.id === "VOICE00001") f.ai_metadata = { asr: SPEECH };
  p.history = { undo: [], redo: [] };
  return new ProjectDocument(p);
}

interface Built {
  decisions: BuildDecision[];
  fallbacks: number;
  next_calls: { tool: string }[];
  [key: string]: unknown;
}

async function build(doc: ProjectDocument, tool: string, args: Record<string, unknown>): Promise<Built> {
  const before = doc.undoLabels.length;
  const result = await runTool({ doc, host: fakeHost() }, tool, args);
  expect(result.ok, result.text).toBe(true);
  // The whole video is ONE undo step.
  expect(doc.undoLabels.length).toBe(before + 1);
  return (result.data as { data: Built }).data;
}

const step = (data: Built, name: string) => data.decisions.find((d) => d.step === name);
const on = (doc: ProjectDocument, layer: number): Clip[] => doc.project.clips.filter((c) => c.layer === layer).sort((a, b) => a.position - b.position);

describe("build_talking_head_tool", () => {
  it("jump-cuts the take, alternates the framing, punches in on the number, cuts to B-roll on its word, in one undo step", async () => {
    const doc = project();
    const data = await build(doc, "build_talking_head_tool", { speaker_file_ids: ["TAKE000001"], hook: "Rockets", caption_style: "none" });
    const tracks = data.tracks as { speaker: number; broll: number; music: number };
    const segments = data.segments as { scale: number; start: number }[];
    // Four phrases (pauses over 0.45 s cut), the framing changing on every jump cut.
    expect(segments.map((s) => s.scale)).toEqual([1, 1.4, 1, 1.4]);
    const speaker = on(doc, tracks.speaker);
    expect(speaker).toHaveLength(4);
    for (let i = 1; i < speaker.length; i += 1) expect(speaker[i]!.position).toBeCloseTo(speaker[i - 1]!.position + (speaker[i - 1]!.end - speaker[i - 1]!.start), 5);
    // The punch-in is on 300% (a number), a hard step on its segment.
    expect(data.punch_ins).toMatchObject([{ word: "300%" }]);
    // rocket and ocean name pictures; ocean is too close after rocket, so one cutaway.
    expect((data.broll as { word: string; file_id: string }[]).map((b) => [b.word, b.file_id])).toEqual([["rocket", "ROCKET0001"]]);
    expect(on(doc, tracks.broll).filter((c) => c.file_id === "ROCKET0001")).toHaveLength(1);
    expect(on(doc, tracks.music)).toHaveLength(1);
    // No subject matte on this host: the hook falls back to type over the speaker, and the receipt says so.
    const hook = data.decisions.filter((d) => d.step === "hook");
    expect(hook.map((d) => [d.tool, d.outcome])).toEqual([
      ["text_behind_subject_tool", "skipped"],
      ["add_kinetic_title_tool", "fallback"],
    ]);
    expect(hook[1]!.instead_of).toBe("text behind the subject");
    expect(step(data, "captions")).toMatchObject({ outcome: "skipped" });
    expect(data.next_calls.map((c) => c.tool)).toEqual(["auto_sound_design_tool", "master_audio_tool"]);

    // One undo puts the empty timeline back.
    doc.undo();
    expect(doc.project.clips).toHaveLength(0);
  });

  it("refuses an occupied timeline without replace, and changes nothing", async () => {
    const doc = project();
    await build(doc, "build_talking_head_tool", { caption_style: "none" });
    const clips = doc.project.clips.length;
    const again = await runTool({ doc, host: fakeHost() }, "build_talking_head_tool", {});
    expect(again.text).toMatch(/already has \d+ clip/);
    expect(doc.project.clips).toHaveLength(clips);
  });
});

describe("build_explainer_tool", () => {
  it("lays B-roll over the whole voice, cuts on keywords, places chapters and a counter fallback, captions the voice", async () => {
    const doc = project();
    const data = await build(doc, "build_explainer_tool", {
      voice_file_id: "VOICE00001",
      broll_file_ids: ["ROCKET0001", "OCEAN00001", "CITY000001"],
      hook: "How rockets fly",
      chapters: ["Lift", "Speed"],
    });
    const tracks = data.tracks as { voice: number; picture: number };
    const shots = data.shots as { file_id: string; start: number; end: number; cue: string; keyword?: string }[];
    expect(shots[0]!.start).toBe(0);
    expect(shots[shots.length - 1]!.end).toBeCloseTo(data.duration as number, 5);
    for (let i = 1; i < shots.length; i += 1) expect(shots[i]!.start).toBeCloseTo(shots[i - 1]!.end, 5);
    expect(shots.some((s) => s.cue === "keyword" && s.keyword === "rocket" && s.file_id === "ROCKET0001")).toBe(true);
    expect(on(doc, tracks.voice)).toHaveLength(1);
    expect(on(doc, tracks.picture)).toHaveLength(shots.length);
    expect(step(data, "chapter 1")).toMatchObject({ outcome: "applied" });
    expect(step(data, "chapter 2")).toMatchObject({ outcome: "applied" });
    // 300% becomes a counter; with no Zenvi Motion here it is a kinetic title instead, recorded as a fallback.
    const data1 = data.decisions.filter((d) => d.step === "data 1 (counter)");
    expect(data1.map((d) => d.outcome)).toEqual(["skipped", "fallback"]);
    expect(data1[1]!.args).toMatchObject({ text: "300%" });
    expect(step(data, "captions")).toMatchObject({ outcome: "applied", tool: "kinetic_captions_tool" });
    expect(data.fallbacks).toBeGreaterThanOrEqual(2);
  });

  it("refuses with nothing to lead it", async () => {
    const doc = project();
    const result = await runTool({ doc, host: fakeHost() }, "build_explainer_tool", { voice_file_id: "ROCKET0001" });
    expect(result.text).toMatch(/has no sound to lead the explainer/);
    expect(doc.undoLabels).toHaveLength(0);
  });
});

describe("build_trailer_tool", () => {
  it("cuts three acts faster and faster, falls silent before the title, and puts braams on the act changes", async () => {
    const doc = project();
    const data = await build(doc, "build_trailer_tool", { file_ids: ["ROCKET0001", "OCEAN00001", "CITY000001"], title: "The Long Way", act_cards: ["THIS WINTER"], end_card: "SOON", duration_seconds: 30 });
    const shots = data.shots as { act: number; start: number; end: number }[];
    const mean = (act: number) => {
      const xs = shots.filter((s) => s.act === act).map((s) => s.end - s.start);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(mean(1)).toBeGreaterThan(mean(2));
    expect(mean(2)).toBeGreaterThan(mean(3));
    const [from, to] = data.silence as [number, number];
    // Nothing shows in the silence.
    expect(doc.project.clips.filter((c) => c.layer === (data.tracks as { picture: number }).picture && c.position < to - 1e-6 && c.position + (c.end - c.start) > from + 1e-6)).toHaveLength(0);
    // Each braam is a boom and a sub; the riser runs into the silence.
    const braams = data.decisions.filter((d) => d.step.startsWith("braam"));
    expect(braams).toHaveLength(6);
    expect(braams.every((d) => d.outcome === "applied")).toBe(true);
    expect(step(data, "riser")).toMatchObject({ outcome: "applied" });
    expect(step(data, "title")).toMatchObject({ outcome: "applied", args: expect.objectContaining({ background: "#000000" }) });
  });
});

describe("build_product_launch_tool", () => {
  it("puts problem, reveal, features, proof and end card on the bars, falling back to native type and the end card template", async () => {
    const doc = project();
    const data = await build(doc, "build_product_launch_tool", {
      product: "Oarlight",
      problem: "Editing takes all week",
      tagline: "Cut in minutes",
      features: ["Auto captions: every word timed", { title: "Beat sync" }],
      proof: { stat: "2,400", label: "teams" },
      cta: "Start free",
      file_ids: ["CITY000001", "ROCKET0001", "OCEAN00001"],
    });
    const sections = data.sections as { kind: string; start: number; end: number }[];
    expect(sections.map((s) => s.kind)).toEqual(["problem", "reveal", "feature", "feature", "proof", "end"]);
    for (let i = 1; i < sections.length; i += 1) expect(sections[i]!.start).toBeCloseTo(sections[i - 1]!.end, 5);
    // No Blender and no Zenvi Motion here: 3D -> headline block -> kinetic type, each step recorded.
    expect(data.decisions.filter((d) => d.step === "reveal").map((d) => [d.tool, d.outcome])).toEqual([
      ["add_3d_scene_tool", "skipped"],
      ["add_motion_block_tool", "skipped"],
      ["add_kinetic_title_tool", "fallback"],
    ]);
    expect(step(data, "tagline")).toMatchObject({ outcome: "applied" });
    expect(data.decisions.filter((d) => d.step.startsWith("feature ")).map((d) => d.outcome)).toEqual(["fallback", "fallback"]);
    expect(data.decisions.filter((d) => d.step === "proof").map((d) => d.outcome)).toEqual(["skipped", "fallback"]);
    expect(data.decisions.filter((d) => d.step === "end card").map((d) => [d.tool, d.outcome])).toEqual([
      ["add_motion_block_tool", "skipped"],
      ["add_motion_template_tool", "fallback"],
    ]);
    expect(step(data, "reveal hit")).toMatchObject({ outcome: "applied" });
  });
});
