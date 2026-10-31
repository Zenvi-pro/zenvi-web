/**
 * The spoken words on the timeline, in timeline seconds: what the
 * word-anchored tools (place_on_word_tool, insert_broll_on_words_tool) find
 * a word or phrase in. Words come from `wordsFor` (a kept transcript, the
 * media index's cues, or a new transcription), cut to each clip's trim.
 */

import { wordKey } from "../analysis/align.js";
import type { Clip, Project } from "../model/types.js";
import type { ToolCall } from "./define.js";
import { projectFps } from "./frame-time.js";
import { clipTarget, fileOfClip, isTalkingFootage, isWordSource, storedTranscript, wordsFor, wordsForClip, type WordSourceFailure } from "./transcripts.js";

export interface TimelineWord {
  text: string;
  /** `wordKey` of the text. */
  key: string;
  /** Timeline seconds, frame-snapped. */
  start: number;
  end: number;
  clipId: string;
  /** Real word timings (false: estimated from index phrases). */
  exact: boolean;
}

export interface TimelineWords {
  /** Every clip's words, in timeline order. */
  words: TimelineWord[];
  warnings: string[];
  failures: WordSourceFailure[];
}

/**
 * Clips whose speech a call without clip ids searches: the clips whose words
 * are known already (a transcript: TTS voices, aligned lyrics, transcribed
 * footage; or index cues), else footage with picture and sound. Footage
 * nobody has heard is not transcribed (and paid for) while known words exist.
 */
export function speakingClips(project: Project): Clip[] {
  const known = project.clips.filter((c) => storedTranscript(fileOfClip(project, c)) !== null || (clipTarget(project, c)?.cues.length ?? 0) > 0);
  if (known.length > 0) return known;
  return project.clips.filter((c) => {
    const file = fileOfClip(project, c);
    return file !== undefined && isTalkingFootage(file);
  });
}

export async function timelineWords(call: ToolCall, clips: readonly Clip[], language?: string): Promise<TimelineWords> {
  const fps = projectFps(call.doc.project);
  const words: TimelineWord[] = [];
  const warnings: string[] = [];
  const failures: WordSourceFailure[] = [];
  for (const clip of clips) {
    const target = clipTarget(call.doc.project, clip);
    if (!target) continue;
    const got = await wordsFor(call, target, { language, estimatesOk: true, transcribe: true });
    if (!isWordSource(got)) {
      if (got.kind !== "no_audio") failures.push(got);
      continue;
    }
    warnings.push(...got.warnings);
    if (!got.exact) warnings.push(`clip ${clip.id}: word times are estimated from the media index's phrases (transcribe_media_tool hears them exactly)`);
    const live = call.doc.project.clips.find((c) => c.id === clip.id) ?? clip;
    for (const w of wordsForClip(got.words, live, fps, got.generation)) {
      const key = wordKey(w.text);
      if (key) words.push({ text: w.text, key, start: Number(w.timelineStartSec), end: Number(w.timelineEndSec), clipId: String(live.id), exact: got.exact });
    }
  }
  words.sort((a, b) => a.start - b.start);
  return { words, warnings, failures };
}

export interface PhraseHit {
  /** The words as spoken. */
  text: string;
  start: number;
  end: number;
  clipId: string;
  /** Index of the first word in the searched list. */
  index: number;
  exact: boolean;
}

/** Every place the words of `phrase` are spoken one after another, in order. */
export function findPhrase(words: readonly TimelineWord[], phrase: string): PhraseHit[] {
  const keys = phrase.split(/\s+/).map(wordKey).filter(Boolean);
  if (keys.length === 0) return [];
  const hits: PhraseHit[] = [];
  for (let i = 0; i + keys.length <= words.length; i += 1) {
    const run = words.slice(i, i + keys.length);
    if (!run.every((w, k) => w.key === keys[k] && w.clipId === run[0]!.clipId)) continue;
    hits.push({ text: run.map((w) => w.text).join(" "), start: run[0]!.start, end: run[run.length - 1]!.end, clipId: run[0]!.clipId, index: i, exact: run.every((w) => w.exact) });
  }
  return hits;
}
