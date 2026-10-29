/**
 * What the category builders read before they compose: the bin's pictures
 * and the words they name, the voice's words, the music's bar lines. All of
 * it is read before the scratch copy is made, so a transcription kept on a
 * file is in the copy too.
 */

import { z } from "zod";
import type { TimedText } from "../../../analysis/transcription.js";
import { termsOf, type GivenKeyword, type KeywordMedia } from "../../../builders/keywords.js";
import type { Project, ProjectFile } from "../../../model/types.js";
import { isAudioOnlyMedia } from "../../../model/media.js";
import { buildSummaryPreview } from "../../ai-metadata.js";
import { beatsOfFile, canTrackBeats } from "../../beats.js";
import type { ToolCall } from "../../define.js";
import { energyVadWindows } from "../../speech.js";
import { fileTarget, isWordSource, wordsFor } from "../../transcripts.js";
import { displayName, visualKind } from "../reels.js";

/** Pictures of the bin an agent did not make as titles (SVG cards are an earlier build's own). */
export function binPictures(project: Project, exclude: ReadonlySet<string> = new Set()): ProjectFile[] {
  return project.files.filter((f) => visualKind(f) !== null && !exclude.has(String(f.id)) && !/\.svgz?$/i.test(String(f.path ?? f.name ?? "")) && !f.zenvi_role);
}

/** Every picture's terms: its name and its index summary. */
export function keywordMedia(files: readonly ProjectFile[]): KeywordMedia[] {
  return files.map((f) => ({ fileId: String(f.id), terms: termsOf(displayName(f), buildSummaryPreview(f.ai_metadata)) }));
}

export const keywordsArg = z
  .array(z.union([z.string().min(1).max(40), z.strictObject({ word: z.string().min(1).max(40), file_id: z.string().min(1).optional() })]))
  .max(30)
  .optional()
  .describe(
    "Spoken words that cut to B-roll: a word (its picture is the bin file whose name or description has it) or {word, file_id} to choose the picture. Default: every spoken word that names a bin picture.",
  );

export function givenKeywords(raw: z.infer<typeof keywordsArg>): GivenKeyword[] {
  return (raw ?? []).map((k) => (typeof k === "string" ? { word: k } : { word: k.word, ...(k.file_id ? { fileId: k.file_id } : {}) }));
}

export type VoiceWords = { words: TimedText[]; exact: boolean; source: string } | { error: string };

/** The words of a voice file: kept, indexed, or transcribed now (estimates are fine for cutting and captions). */
export async function voiceWords(call: ToolCall, file: ProjectFile): Promise<VoiceWords> {
  const got = await wordsFor(call, fileTarget(file), { estimatesOk: true, transcribe: true });
  if (!isWordSource(got)) return { error: got.message };
  if (got.words.length === 0) return { error: `no words were found in ${displayName(file)}` };
  return { words: got.words, exact: got.exact, source: got.source };
}

/**
 * Where a voice speaks, from its loudness alone, as untitled phrase-long
 * "words": what cuts on the pauses when no words can be read (no speech
 * recognition on this surface, no script). Null when the audio cannot be read.
 */
export async function voiceActivity(call: ToolCall, file: ProjectFile): Promise<TimedText[] | null> {
  const path = String(file.path ?? "");
  if (!path || !call.host.audio?.analyzeAudio) return null;
  try {
    const envelope = await call.host.audio.analyzeAudio(path, { signal: call.signal });
    const windows = envelope ? energyVadWindows(envelope, { minSpeechSec: 0.12, minSilenceSec: 0.3 }) : [];
    return windows.length > 0 ? windows.map(([startSec, endSec]) => ({ text: "", startSec, endSec })) : null;
  } catch {
    return null;
  }
}

/** The voice an explainer is led by: audio named like one, else audio with kept words, else the only audio file. */
export function pickVoice(project: Project, music: string | undefined): ProjectFile | undefined {
  const audio = project.files.filter((f) => isAudioOnlyMedia(f) && String(f.id) !== music && !f.zenvi_role);
  const named = audio.find((f) => /\b(vo|voice|voiceover|narrat\w*|tts|speech|dialog\w*)\b/i.test(displayName(f)));
  if (named) return named;
  const kept = audio.find((f) => (f.ai_metadata as { asr?: unknown } | undefined)?.asr);
  if (kept) return kept;
  return audio.length === 1 ? audio[0] : undefined;
}

/** Music in the bin: the one given, else the longest audio file that is not the voice (and not an SFX). */
export function pickMusic(project: Project, given: string | undefined, voice?: string): ProjectFile | undefined | string {
  if (given) {
    const file = project.files.find((f) => String(f.id) === given);
    if (!file) return `Error: unknown music_file_id ${given}.`;
    if (!file.has_audio) return `Error: ${given} has no audio.`;
    return file;
  }
  return project.files
    .filter((f) => isAudioOnlyMedia(f) && String(f.id) !== voice && !f.zenvi_role && !/\b(vo|voice|voiceover|narrat\w*|tts|speech)\b/i.test(displayName(f)))
    .sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0))[0];
}

export interface Grid {
  beats: number[];
  downbeats: number[];
  bpm: number;
  source: string;
}

/** The music's beats (from its start, where the bed starts), or a steady grid at `bpm` when it cannot be tracked. */
export async function musicGrid(call: ToolCall, music: ProjectFile | undefined, bpm: number, seconds: number): Promise<Grid> {
  if (music && canTrackBeats(call)) {
    const tracked = await beatsOfFile(call, music);
    if (typeof tracked !== "string" && tracked.beats.length >= 8) {
      return { beats: tracked.beats.map((b) => b.timeSec), downbeats: tracked.downbeats.map((d) => d.timeSec), bpm: tracked.bpm, source: "the music, tracked" };
    }
  }
  const beat = 60 / bpm;
  const beats = Array.from({ length: Math.ceil(seconds / beat) + 16 }, (_, i) => i * beat);
  return { beats, downbeats: beats.filter((_, i) => i % 4 === 0), bpm, source: music ? `${bpm} BPM (the music's beats could not be tracked here)` : `${bpm} BPM (no music)` };
}

/** Unknown or non-picture ids among `ids`, as a refusal message. */
export function pictureProblem(project: Project, ids: readonly string[], what: string): string | null {
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const unknown = ids.filter((id) => !files.has(id));
  if (unknown.length > 0) return `Error: unknown ${what}: ${unknown.join(", ")}.`;
  const notVisual = ids.filter((id) => visualKind(files.get(id)!) === null);
  if (notVisual.length > 0) return `Error: these ${what} are not videos or images: ${notVisual.join(", ")}.`;
  return null;
}

/** A refused rebuild: the timeline has clips and replace was not passed. */
export function occupied(project: Project, replace: boolean | undefined): string | null {
  return project.clips.length > 0 && !replace ? `Error: the timeline already has ${project.clips.length} clip(s). Pass replace=true to rebuild it, or build in a new project.` : null;
}

export const replaceArg = z.boolean().optional().describe("Clear the timeline first when it already has clips (in the same undo step).");
