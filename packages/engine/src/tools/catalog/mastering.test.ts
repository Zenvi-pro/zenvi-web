/**
 * master_audio_tool on a fake host whose mixPcm renders each clip as a
 * synthetic tone (by file name) through the clip's volume curve and its
 * gain-only Compressors, which is what the desktop and render-node do to it.
 */

import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { measureLoudness } from "../../mastering/loudness.js";
import { createProject } from "../../model/defaults.js";
import type { Clip, Project } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addEffect } from "../../ops/effects.js";
import { addFile } from "../../ops/files.js";
import { evaluateVolumeCurve, curvePoints, timelineToSourceFrame } from "../audio-mix.js";
import type { MixPcm } from "../types.js";
import { runTool } from "../registry.js";
import { applyClipGain } from "./mastering.js";
import type { ToolReceipt } from "../receipt.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { L1, L2, L3, audioInfo, media, videoInfo } from "../test-support/fixture.js";

const RATE = 24000;

interface Tone {
  freq: number;
  db: number;
  /** Source seconds with sound; the tone is silent elsewhere. */
  on?: [number, number][];
}

const TONES: Record<string, Tone> = {
  "speech.mp4": { freq: 220, db: -30, on: [[1, 4], [6, 9]] },
  "music.mp3": { freq: 110, db: -28 },
  "quiet-music.mp3": { freq: 110, db: -50 },
  "whoosh.wav": { freq: 3000, db: -26, on: [[0.2, 0.6]] },
  "bursts.wav": { freq: 1000, db: -10, on: Array.from({ length: 20 }, (_, i): [number, number] => [i * 0.5 + 0.1, i * 0.5 + 0.104]) },
  "silence.mp3": { freq: 110, db: -120 },
};

function toneOf(path: string): Tone {
  const key = Object.keys(TONES).sort((a, b) => b.length - a.length).find((k) => path.endsWith(k));
  if (!key) throw new Error(`no tone for ${path}`);
  return TONES[key]!;
}

function renderClip(project: Project, clip: Clip, out: Float32Array[]): void {
  const file = project.files.find((f) => f.id === clip.file_id)!;
  const tone = toneOf(String(file.path));
  const position = Number(clip.position);
  const start = Number(clip.start);
  const end = Number(clip.end);
  const points = curvePoints(clip);
  const makeup = (clip.effects ?? [])
    .filter((e) => e.class_name === "Compressor")
    .reduce((db, e) => db + Number((e.makeup_gain as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y), 0);
  const amplitude = 10 ** ((tone.db + makeup) / 20);
  const first = Math.round(position * RATE);
  const count = Math.round((end - start) * RATE);
  let gain = 1;
  for (let i = 0; i < count; i += 1) {
    const sourceT = start + i / RATE;
    if (tone.on && !tone.on.some(([s, e]) => sourceT >= s && sourceT < e)) continue;
    if (i % 240 === 0) gain = evaluateVolumeCurve(points, timelineToSourceFrame(position + i / RATE, clip, project.fps), 1);
    const v = amplitude * gain * Math.sin(2 * Math.PI * tone.freq * (i / RATE));
    for (const channel of out) if (first + i < channel.length) channel[first + i]! += v;
  }
}

function install(host: FakeHost): void {
  host.audio!.mixPcm = async (project, options): Promise<MixPcm> => {
    const only = options?.clipIds ? new Set(options.clipIds) : undefined;
    const length = Math.ceil(project.clips.reduce((m, c) => Math.max(m, Number(c.position) + Number(c.end) - Number(c.start)), 0) * RATE);
    const channels = [new Float32Array(length), new Float32Array(length)];
    for (const clip of project.clips) if (!only || only.has(String(clip.id))) renderClip(project, clip, channels);
    return { sampleRate: RATE, channels };
  };
}

let counter = 0;
function newDoc(): ProjectDocument {
  return new ProjectDocument(createProject({ id: "PROJECT001", profile: "FHD 1080p 30 fps" }), { newTransactionId: () => `tx-${(counter += 1)}` });
}

function add(doc: ProjectDocument, name: string, opts: { position?: number; end?: number; layer?: number; ai?: Record<string, unknown>; video?: boolean }): string {
  const path = `/media/${name}`;
  return doc.transaction("setup", (tx) => {
    const info = opts.video ? videoInfo(path, 30) : audioInfo(path, 30);
    const file = addFile(tx, media(path, info));
    if (opts.ai) tx.update(["files", { id: file.id }], { ai_metadata: opts.ai });
    return addClip(tx, { fileId: file.id, position: opts.position ?? 0, layer: opts.layer ?? L1, start: 0, end: opts.end ?? 12 }).id;
  });
}

const indexed = { analyzed: true };
const SPEECH_AI = { analyzed: true, has_speech: true, transcript_cues: [{ start: 1, end: 4, text: "one two three" }, { start: 6, end: 9, text: "four five six" }] };

async function master(doc: ProjectDocument, host: FakeHost, args: Record<string, unknown> = {}): Promise<ToolReceipt> {
  return (await runTool({ doc, host }, "master_audio_tool", args)).data!;
}

const hosts = new WeakMap<ProjectDocument, FakeHost>();

async function loudnessOf(doc: ProjectDocument, clipIds?: string[]) {
  const mix = await hosts.get(doc)!.audio!.mixPcm!(doc.project, { clipIds });
  return measureLoudness(mix.channels, mix.sampleRate);
}

function setup(): { doc: ProjectDocument; host: FakeHost } {
  const doc = newDoc();
  const host = fakeHost();
  install(host);
  hosts.set(doc, host);
  return { doc, host };
}

interface MasterData {
  lead: string;
  limitedBy?: string;
  duckDb: number;
  target: { lufs: number };
  before: { integratedLufs: number };
  after: { integratedLufs: number };
}

function data(receipt: ToolReceipt): MasterData {
  return receipt.data as MasterData;
}

describe("master_audio_tool", { timeout: 60_000 }, () => {
  it("brings a quiet music + whoosh edit to the social target in one undo step", async () => {
    const { doc, host } = setup();
    add(doc, "quiet-music.mp3", { ai: indexed, layer: L1 });
    const hits = [1, 4, 7].map((t) => add(doc, "whoosh.wav", { ai: indexed, position: t, end: 1, layer: L2 }));
    const undoBefore = doc.undoLabels.length;
    const before = await loudnessOf(doc);
    expect(before.integrated).toBeLessThan(-25);

    const receipt = await master(doc, host);
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(doc.undoLabels.length).toBe(undoBefore + 1);
    const after = await loudnessOf(doc);
    expect(after.integrated).toBeGreaterThan(-14.6);
    expect(after.integrated).toBeLessThan(-13.4);
    expect(after.truePeakDb).toBeLessThanOrEqual(-0.9);
    expect(data(receipt).before.integratedLufs).toBeCloseTo(before.integrated, 0);
    expect(data(receipt).after.integratedLufs).toBeCloseTo(after.integrated, 0);
    expect(data(receipt).lead).toBe("music");
    // The SFX sit under the music, which carries the lead.
    const music = await loudnessOf(doc, [doc.project.clips.find((c) => !hits.includes(String(c.id)))!.id]);
    const sfx = await loudnessOf(doc, hits);
    expect(music.integrated - sfx.integrated).toBeGreaterThan(1.5);
    expect(music.integrated - sfx.integrated).toBeLessThan(4.5);

    doc.undo();
    expect((await loudnessOf(doc)).integrated).toBeCloseTo(before.integrated, 1);
  });

  it("anchors on dialogue, ducks the music under it and lands on the target", async () => {
    const { doc, host } = setup();
    const speech = add(doc, "speech.mp4", { ai: SPEECH_AI, video: true, layer: L1 });
    const music = add(doc, "music.mp3", { ai: indexed, layer: L2 });
    const receipt = await master(doc, host);
    expect(receipt.summary).toMatch(/^Mastered/);
    expect(data(receipt).lead).toBe("speech");
    expect(data(receipt).duckDb).toBeLessThan(0);
    const after = await loudnessOf(doc);
    expect(after.integrated).toBeGreaterThan(-14.6);
    expect(after.integrated).toBeLessThan(-13.4);
    const musicClip = doc.project.clips.find((c) => c.id === music)!;
    expect(curvePoints(musicClip).length).toBeGreaterThan(2);
    // The speech clip was only gained, never given a duck.
    expect(curvePoints(doc.project.clips.find((c) => c.id === speech)!).length).toBeLessThanOrEqual(1);
  });

  it("ducks the music on the same frames as duck_under_speech_tool", async () => {
    const frames = async (tool: string, args: Record<string, unknown>): Promise<number[]> => {
      const { doc, host } = setup();
      add(doc, "speech.mp4", { ai: SPEECH_AI, video: true, layer: L1 });
      const music = add(doc, "music.mp3", { ai: indexed, layer: L2 });
      expect((await runTool({ doc, host }, tool, args)).data!.status).toBe("applied");
      return curvePoints(doc.project.clips.find((c) => c.id === music)!).map((p) => p.co.X);
    };
    const mastered = await frames("master_audio_tool", {});
    expect(mastered).toEqual(await frames("duck_under_speech_tool", {}));
  });

  it("is idempotent: the second run changes nothing and records no undo step", async () => {
    const { doc, host } = setup();
    add(doc, "speech.mp4", { ai: SPEECH_AI, video: true, layer: L1 });
    add(doc, "music.mp3", { ai: indexed, layer: L2 });
    await master(doc, host);
    const steps = doc.undoLabels.length;
    const snapshot = JSON.stringify(doc.project.clips);
    const again = await master(doc, host);
    expect(again.status).toBe("unchanged");
    expect(again.undoSteps).toBe(0);
    expect(doc.undoLabels.length).toBe(steps);
    expect(JSON.stringify(doc.project.clips)).toBe(snapshot);
  });

  it("dry_run reports the plan and changes nothing", async () => {
    const { doc, host } = setup();
    add(doc, "quiet-music.mp3", { ai: indexed });
    const snapshot = JSON.stringify(doc.project.clips);
    const steps = doc.undoLabels.length;
    const receipt = await master(doc, host, { dry_run: true, preset: "broadcast" });
    expect(receipt.status).toBe("unchanged");
    expect(JSON.stringify(doc.project.clips)).toBe(snapshot);
    expect(doc.undoLabels.length).toBe(steps);
    expect(data(receipt).after.integratedLufs).toBeCloseTo(-23, 0);
    expect(data(receipt).target.lufs).toBe(-23);
  });

  it("takes a too-loud mix down to the target", async () => {
    const { doc, host } = setup();
    add(doc, "music.mp3", { ai: indexed });
    const receipt = await master(doc, host, { preset: "podcast" });
    expect(receipt.status).toBe("applied");
    expect((await loudnessOf(doc)).integrated).toBeCloseTo(-16, 0);
  });

  it("gives a very quiet clip several gain stages", async () => {
    const { doc, host } = setup();
    const id = add(doc, "quiet-music.mp3", { ai: indexed });
    await master(doc, host, { target_lufs: -10 });
    const stages = doc.project.clips.find((c) => c.id === id)!.effects.filter((e) => e.class_name === "Compressor");
    expect(stages.length).toBeGreaterThanOrEqual(3);
    expect((await loudnessOf(doc)).integrated).toBeCloseTo(-10, 0);
  });

  it("stops at the true-peak ceiling when sparse peaks limit the loudness, says so, and then leaves it alone", async () => {
    const { doc, host } = setup();
    add(doc, "bursts.wav", { ai: indexed });
    const receipt = await master(doc, host, { preset: "social" });
    expect(data(receipt).limitedBy).toBe("peak");
    expect(receipt.notes.join(" ")).toMatch(/loudness normalisation/);
    const after = await loudnessOf(doc);
    expect(after.truePeakDb).toBeLessThanOrEqual(-0.9);
    expect(after.truePeakDb).toBeGreaterThan(-1.6);
    expect(after.integrated).toBeLessThan(-14.5);
    const again = await master(doc, host);
    expect(again.status).toBe("unchanged");
    expect(again.summary).toMatch(/ceiling/);
    expect(again.notes.join(" ")).toMatch(/loudness normalisation/);
  });

  it("refuses a silent timeline and a timeline with no audio", async () => {
    const { doc, host } = setup();
    expect((await master(doc, host)).status).toBe("refused");
    add(doc, "silence.mp3", { ai: indexed });
    const receipt = await master(doc, host);
    expect(receipt.status).toBe("refused");
    expect(receipt.summary).toMatch(/silent/);
  });

  it("leaves clips on locked tracks alone and says so", async () => {
    const { doc, host } = setup();
    const id = add(doc, "music.mp3", { ai: indexed, layer: L3 });
    doc.transaction("lock", (tx) => tx.update(["layers", { number: L3 }], { lock: true }));
    const snapshot = JSON.stringify(doc.project.clips.find((c) => c.id === id));
    const steps = doc.undoLabels.length;
    // Nothing it may move: refused, not "already mastered".
    const allLocked = await master(doc, host);
    expect(allLocked.status).toBe("refused");
    expect(allLocked.summary).toMatch(/locked/);
    expect(doc.undoLabels.length).toBe(steps);

    add(doc, "whoosh.wav", { ai: indexed, position: 2, end: 1, layer: L1 });
    const receipt = await master(doc, host);
    expect(receipt.status).toBe("applied");
    expect(JSON.stringify(doc.project.clips.find((c) => c.id === id))).toBe(snapshot);
    expect(receipt.warnings.join(" ")).toMatch(/locked/);
  });

  it("is refused where the host cannot render the mix", async () => {
    const doc = newDoc();
    const host = fakeHost();
    add(doc, "music.mp3", { ai: indexed });
    const receipt = await master(doc, host);
    expect(receipt.status).toBe("refused");
    expect(receipt.summary).toMatch(/not available/);
  });

  it("does not count a bypassed Compressor as gain", () => {
    const doc = newDoc();
    const id = add(doc, "music.mp3", { ai: indexed });
    doc.transaction("bypassed", (tx) => addEffect(tx, id, "Compressor", { makeup_gain: 6, ratio: 1, threshold: 0, bypass: 1 }));
    const result = doc.transaction("gain", (tx) => applyClipGain(tx, id, 6));
    expect(result.makeupDb).toBeCloseTo(6, 6);
    const live = doc.project.clips.find((c) => c.id === id)!.effects.filter((e) => Number((e.bypass as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y) === 0);
    expect(live.map((e) => Number((e.makeup_gain as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y))).toEqual([6]);
  });
});
