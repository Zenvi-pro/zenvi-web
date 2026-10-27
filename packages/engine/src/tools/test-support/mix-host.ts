/**
 * A fake host whose mixPcm renders each clip from a synthetic source (picked
 * by file name) through its clip audio effects (the engine's libopenshot
 * kernels, one 1600-sample frame at a time with the effect's parameters at
 * that source frame) and then its volume curve: the order and the data
 * libopenshot's Clip::GetFrame uses, without decoding any media.
 */

import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Clip, Project } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { setTrackAudioRole } from "../../ops/tracks.js";
import { getAudioKernel } from "../../render/audio/registry.js";
import { effectInstance } from "../../render/plan/effects.js";
import { scoreFixture } from "../../mastering/testing.js";
import { evaluateVolumeCurve, curvePoints, timelineToSourceFrame } from "../audio-mix.js";
import type { MixPcm } from "../types.js";
import { fakeHost, type FakeHost } from "./fake-host.js";
import { audioInfo, media, L1 } from "./fixture.js";

export const MIX_RATE = 48000;
const FRAME = MIX_RATE / 30;

const fixture = scoreFixture({ duckDb: 0 });
/** One click of the fixture, 0.3 s. */
const click = fixture.sfx[0]!.subarray(Math.round(0.5 * MIX_RATE), Math.round(0.8 * MIX_RATE));

/** Source audio by file name (mono; rendered to both channels). */
export const SOURCES: Record<string, Float32Array> = {
  "voice.wav": fixture.voice[0]!,
  "music.wav": fixture.music[0]!,
  "hit.wav": click,
};

function sourceOf(path: string): Float32Array {
  const key = Object.keys(SOURCES).find((k) => path.endsWith(k));
  if (!key) throw new Error(`no source for ${path}`);
  return SOURCES[key]!;
}

function renderClip(project: Project, clip: Clip, out: Float32Array[]): void {
  const file = project.files.find((f) => f.id === clip.file_id)!;
  const source = sourceOf(String(file.path));
  const position = Number(clip.position);
  const start = Number(clip.start);
  const count = Math.round((Number(clip.end) - start) * MIX_RATE);
  const first = Math.round(position * MIX_RATE);
  const pcm = [new Float32Array(count), new Float32Array(count)];
  for (let i = 0; i < count; i += 1) pcm[0]![i] = pcm[1]![i] = source[Math.round(start * MIX_RATE) + i] ?? 0;
  const effects = (clip.effects ?? []).filter((e) => getAudioKernel(String(e.class_name)));
  const states = effects.map(() => new Map<string, unknown>());
  for (let at = 0; at < count; at += FRAME) {
    const n = Math.floor((start * MIX_RATE + at) / FRAME) + 1;
    const block = pcm.map((c) => c.subarray(at, Math.min(count, at + FRAME)));
    effects.forEach((e, k) => getAudioKernel(String(e.class_name))!(block, MIX_RATE, effectInstance(e, n, project.fps, false).params, states[k]!));
  }
  const points = curvePoints(clip);
  let gain = 1;
  for (let i = 0; i < count; i += 1) {
    if (i % 160 === 0) gain = evaluateVolumeCurve(points, timelineToSourceFrame(position + i / MIX_RATE, clip, project.fps), 1);
    for (let c = 0; c < 2; c += 1) if (first + i < out[c]!.length) out[c]![first + i]! += pcm[c]![i]! * gain;
  }
}

/** Install the renderer on a fake host. */
export function mixHost(): FakeHost {
  const host = fakeHost();
  host.audio!.mixPcm = async (project, options): Promise<MixPcm> => {
    const only = options?.clipIds ? new Set(options.clipIds) : undefined;
    const seconds = project.clips.reduce((m, c) => Math.max(m, Number(c.position) + Number(c.end) - Number(c.start)), 0);
    const channels = [new Float32Array(Math.ceil(seconds * MIX_RATE)), new Float32Array(Math.ceil(seconds * MIX_RATE))];
    for (const clip of project.clips) if (!only || only.has(String(clip.id))) renderClip(project, clip, channels);
    return { sampleRate: MIX_RATE, channels };
  };
  return host;
}

export interface MixProject {
  doc: ProjectDocument;
  host: FakeHost;
  voice: string;
  music: string;
  hits: string[];
}

/**
 * An 8 s edit: the fixture's voice (two lines) on track 3, its music bed unducked on track 1, six SFX clicks on track 2 at the fixture's hit points.
 * `transcript`: the voice file carries transcript cues of its two lines.
 */
export function mixProject(options: { transcript?: boolean } = {}): MixProject {
  const doc = new ProjectDocument(createProject({ id: "MIXPROJ001", profile: "FHD 1080p 30 fps" }));
  const host = mixHost();
  const ids = doc.transaction("setup", (tx) => {
    const fileOf = (name: string, seconds: number) => addFile(tx, media(`/media/${name}`, audioInfo(`/media/${name}`, seconds))).id;
    const music = addClip(tx, { fileId: fileOf("music.wav", 8), position: 0, layer: L1, start: 0, end: 8 }).id;
    const voiceFile = fileOf("voice.wav", 8);
    if (options.transcript) {
      tx.update(["files", { id: voiceFile }], { ai_metadata: { analyzed: true, has_speech: true, transcript_cues: fixture.speech.map(([start, end]) => ({ start, end, text: "one two three four" })) } });
    }
    const voiceClip = addClip(tx, { fileId: voiceFile, position: 0, layer: 3_000_000, start: 0, end: 8 }).id;
    const hitFile = fileOf("hit.wav", 0.3);
    tx.update(["files", { id: hitFile }], { zenvi_role: "sfx", zenvi_sfx: { key: "hit", recipe: "impact_punch", hit: 0, duration: 0.3, version: 1 } });
    const hits = fixture.hits.map((t) => {
      const id = addClip(tx, { fileId: hitFile, position: t, layer: 2_000_000, start: 0, end: 0.3 }).id;
      tx.update(["clips", { id }], { zenvi_role: "sfx", zenvi_sfx: { recipe: "impact_punch", auto: false } });
      return id;
    });
    return { music, voice: voiceClip, hits };
  });
  doc.transaction("roles", (tx) => setTrackAudioRole(tx, 3_000_000, "voice"));
  return { doc, host, ...ids };
}
