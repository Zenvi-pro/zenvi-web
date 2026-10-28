/**
 * Transcripts on the web surfaces: where a file's words come from, and where
 * a speech recognition result is kept.
 *
 * Zenvi desktop transcribes on device and caches the words of each media
 * file on disk (zenvi-core src/classes/speech/cache.py, keyed by path, size,
 * mtime, model and language). The web surfaces have no such disk (Zenvi
 * Cloud keeps no folder per project), so a transcription made through the
 * Zenvi backend is kept in the project, on its file, as `ai_metadata.asr` in
 * the desktop record's shape (`TranscriptRecord.to_dict` without the disk
 * identity: modelId, language, requestLanguage, words, generation,
 * transcriptionSource, createdAt) plus the segments and the media's content
 * hash. The next call, another surface and an exported .zvn reuse it. The
 * desktop leaves the key alone: it reads a file's `ai_metadata` only once the
 * file is `analyzed`, builds clip metadata from named keys, and replaces
 * `ai_metadata` when it indexes the file.
 *
 * Keeping a transcript is not an edit: it is written outside the undo history
 * (`ProjectDocument.setUntracked`), so it never makes an undo step of its own
 * (AGENTS.md: no empty undo steps) and undoing a cut never throws it away.
 *
 * A file's words come from, in order:
 *   1. the kept transcription (real word timings);
 *   2. the media index's transcript cues (phrases, word timings estimated by
 *      character count), for tools that can work with estimates;
 *   3. a new transcription through the host (`AudioHost.transcribe`), kept;
 *   4. the index cues again, when transcription fails or is not available.
 * A kept transcription comes before the index because its timings are exact
 * and every tool must count words alike: wordIndices from get_transcript_tool
 * are positions in the list remove_words_tool cuts from.
 */

import { asrLanguage, isTranscriptionError, transcriptionPrompt, type TimedText, type TranscriptionErrorCode } from "../analysis/transcription.js";
import type { ProjectDocument } from "../history/document.js";
import type { Clip, Project, ProjectFile } from "../model/types.js";
import { fileIsAnalyzed, getEffectiveAiMetadata } from "./ai-metadata.js";
import { hasAudioStream } from "./audio-mix.js";
import type { ToolCall } from "./define.js";
import { toFrame, toSeconds, type Fps } from "./frame-time.js";
import { clipSpeed, sourceToTimelineSec, type TimedWord } from "./speech.js";
import { TTS_SCRIPT_SOURCE } from "./tts-words.js";

/** The `ai_metadata` key of a kept transcription. */
export const ASR_KEY = "asr";
/** `transcriptionSource` of words from the Zenvi backend's speech recognition. */
export const SERVER_SOURCE = "server";
/** `transcriptionSource` of words estimated from the media index's transcript cues. */
export const INDEX_SOURCE = "index_cues";

/** present.py NO_AUDIO_USER_MSG. */
export const NO_AUDIO_MESSAGE =
  "This video has no audio track, so there's no dialogue to transcribe. " +
  "Import a clip with spoken audio, or re-record with the microphone / system audio enabled.";

/** A transcription kept on a file (`ai_metadata.asr`). */
export interface StoredTranscript {
  modelId: string;
  /** ISO code of the speech (detected, or the one asked for). */
  language: string;
  /** What the call asked for: "auto" or a code. */
  requestLanguage: string;
  /** Bumped by every new transcription of the file; word indices pin it. */
  generation: number;
  transcriptionSource: string;
  /** Unix seconds, like the desktop record. */
  createdAt: number;
  /** Content hash of the media it was made from, when the file has one. */
  sha256?: string;
  words: TimedText[];
  segments: TimedText[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timed(value: unknown): TimedText[] {
  if (!Array.isArray(value)) return [];
  const out: TimedText[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const text = String(item.text ?? "").trim();
    const start = Number(item.startSec ?? item.start);
    const end = Number(item.endSec ?? item.end);
    if (text && Number.isFinite(start) && Number.isFinite(end) && end >= start) out.push({ text, startSec: start, endSec: end });
  }
  return out;
}

const SHA256 = /^[0-9a-f]{64}$/;

/** The media's content hash: its Zenvi Cloud address, else its fingerprint. */
export function mediaSha256(file: ProjectFile | undefined): string | undefined {
  const candidates = [file?.cloud?.sha256, file?.fingerprint?.sha256];
  return candidates.find((c): c is string => typeof c === "string" && SHA256.test(c));
}

/** The transcription kept on `file`, if any. */
export function storedTranscript(file: ProjectFile | undefined): StoredTranscript | null {
  const ai = isRecord(file?.ai_metadata) ? file!.ai_metadata : undefined;
  const raw = ai?.[ASR_KEY];
  if (!isRecord(raw) || !Array.isArray(raw.words)) return null;
  const generation = Math.trunc(Number(raw.generation));
  const record: StoredTranscript = {
    modelId: String(raw.modelId ?? ""),
    language: String(raw.language ?? ""),
    requestLanguage: String(raw.requestLanguage ?? "auto") || "auto",
    generation: Number.isFinite(generation) && generation > 0 ? generation : 1,
    transcriptionSource: String(raw.transcriptionSource ?? SERVER_SOURCE) || SERVER_SOURCE,
    createdAt: Number(raw.createdAt) || 0,
    words: timed(raw.words),
    segments: timed(raw.segments),
  };
  if (typeof raw.sha256 === "string" && SHA256.test(raw.sha256)) record.sha256 = raw.sha256;
  return record;
}

/** Keep `record` on the file, outside the undo history. */
export function storeTranscript(doc: ProjectDocument, fileId: string, record: StoredTranscript): void {
  const file = doc.project.files.find((f) => f.id === fileId);
  if (!file) return;
  const ai = isRecord(file.ai_metadata) ? file.ai_metadata : {};
  doc.setUntracked(["files", { id: fileId }], { ...file, ai_metadata: { ...ai, [ASR_KEY]: record } });
}

function baseLanguage(value: string): string {
  return value.split(/[-_]/)[0]!.toLowerCase();
}

/**
 * Whether a kept transcription answers a request in `requested` ("" = detect):
 * detection takes any; an explicit language only one in that language
 * (cache.py `_find_sibling`: "en-CA" shares "en", "fr" never gets English words).
 */
function languageMatches(record: StoredTranscript, requested: string): boolean {
  if (!requested) return true;
  return [record.language, record.requestLanguage].some((l) => l && baseLanguage(l) === requested);
}

// ---------------------------------------------------------------------------
// Index cues (Zenvi's media index)
// ---------------------------------------------------------------------------

/** Split each transcript cue into words, sharing its time by character count. */
export function wordsFromCues(cues: readonly unknown[]): TimedText[] {
  const rows = cues
    .filter(isRecord)
    .map((c) => ({
      text: String(c.text ?? "").trim(),
      start: Number("source_start" in c ? c.source_start : c.start),
      end: Number("source_end" in c ? c.source_end : c.end),
    }))
    .filter((c) => c.text && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const out: TimedText[] = [];
  for (const cue of rows) {
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    const weights = tokens.map((t) => Array.from(t).length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = cue.start;
    tokens.forEach((token, i) => {
      const dur = ((cue.end - cue.start) * weights[i]!) / total;
      out.push({ text: token, startSec: t, endSec: i === tokens.length - 1 ? cue.end : t + dur });
      t += dur;
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resolving a file's words
// ---------------------------------------------------------------------------

/** Where a target's words came from. */
export interface WordSource {
  /** Words in source seconds, in order. */
  words: TimedText[];
  /** `transcriptionSource`: "server" or "index_cues". */
  source: string;
  /** Real word timings (false: estimated from index phrases). */
  exact: boolean;
  generation: number;
  modelId: string;
  language: string;
  /** Transcribed by this call: nobody has seen these word indices yet. */
  fresh: boolean;
  /** The index's transcript cues behind estimated words. */
  cues?: unknown[];
  /** Something a person should know (a fallback, an ignored force). */
  warnings: string[];
}

export interface WordSourceFailure {
  kind: "no_audio" | "unavailable" | "failed";
  /** For a person, no "Error:" prefix. */
  message: string;
  code?: TranscriptionErrorCode;
}

export interface WordRequest {
  /** The tool's language argument ("auto", "en", "en-US"…). */
  language?: unknown;
  /** Transcribe again even when words are kept or indexed. */
  force?: boolean;
  /** Indexed cues with estimated word timings will do. */
  estimatesOk: boolean;
  /** Transcribe (spending credits) when nothing better is there. */
  transcribe: boolean;
}

/** What a target offers before any transcription: the file and its index cues. */
export interface WordTarget {
  file: ProjectFile;
  /** Index transcript cues for the target (a clip's effective cues, or the file's). */
  cues: readonly unknown[];
  /** The media index has analyzed it (its cues are its whole transcript, maybe none). */
  indexed: boolean;
}

export function isWordSource(value: WordSource | WordSourceFailure): value is WordSource {
  return "words" in value;
}

function fromStored(record: StoredTranscript, fresh: boolean, warnings: string[] = []): WordSource {
  return {
    words: record.words,
    source: record.transcriptionSource || SERVER_SOURCE,
    // A TTS script laid over its voice (tts-words.ts) has the words exactly, their times from the voice's pauses.
    exact: record.transcriptionSource !== TTS_SCRIPT_SOURCE,
    generation: record.generation,
    modelId: record.modelId,
    language: record.language,
    fresh,
    warnings,
  };
}

function fromIndex(target: WordTarget, warnings: string[] = []): WordSource {
  return {
    words: wordsFromCues(target.cues),
    source: INDEX_SOURCE,
    exact: false,
    generation: 1,
    modelId: "",
    language: "",
    fresh: false,
    cues: [...target.cues],
    warnings,
  };
}

/** The path the host reads a file's media from. */
export function mediaPathOf(file: ProjectFile | undefined, clip?: Clip): string {
  const reader = isRecord(clip?.reader) ? (clip!.reader as Record<string, unknown>) : {};
  return String(file?.path || reader.path || "");
}

/** True when the file has sound to transcribe (images, titles and silent video do not). */
export function fileHasAudio(file: ProjectFile): boolean {
  const type = String(file.media_type ?? "").toLowerCase();
  if (type === "image" || type === "image/sequence" || type === "font") return false;
  return hasAudioStream({}, file);
}

/** True when a file shows a picture and plays sound: talking footage. */
export function isTalkingFootage(file: ProjectFile): boolean {
  return fileHasAudio(file) && String(file.media_type ?? "").toLowerCase() !== "audio" && file.has_video !== false;
}

function fileById(project: Project, id: string): ProjectFile | undefined {
  return project.files.find((f) => String(f.id) === id);
}

/** The file a clip plays: its file_id, else the bin file at its reader path (transcript.py `_file_data_for_clip`). */
export function fileOfClip(project: Project, clip: Clip): ProjectFile | undefined {
  const byId = clip.file_id ? fileById(project, String(clip.file_id)) : undefined;
  if (byId) return byId;
  const path = String((isRecord(clip.reader) ? clip.reader.path : "") ?? "");
  return path ? project.files.find((f) => f.path === path) : undefined;
}

/** A clip's word target: its file and the index cues for its trim (tool_handlers `_clip_transcript_cues`). */
export function clipTarget(project: Project, clip: Clip): WordTarget | undefined {
  const file = fileOfClip(project, clip);
  if (!file) return undefined;
  const effective = getEffectiveAiMetadata(file, clip, { clipAiMetadata: (clip as { ai_metadata?: unknown }).ai_metadata });
  const parent = file.parent_file_id ? fileById(project, String(file.parent_file_id)) : undefined;
  const indexed = Boolean(effective.analyzed) || fileIsAnalyzed(file) || (parent ? fileIsAnalyzed(parent) : false);
  return { file, cues: Array.isArray(effective.transcript_cues) ? effective.transcript_cues : [], indexed };
}

/** A media-bin file's word target: its own index cues, in source time. */
export function fileTarget(file: ProjectFile): WordTarget {
  const ai = isRecord(file.ai_metadata) ? file.ai_metadata : {};
  return { file, cues: Array.isArray(ai.transcript_cues) ? ai.transcript_cues : [], indexed: Boolean(ai.analyzed) };
}

/**
 * Which of `clips` a call without a target pays to transcribe: the talking
 * footage (picture and sound) when there is some, else every clip with sound.
 * Music beds and other audio-only clips still use a transcript they already
 * have, and are transcribed when a call names them.
 */
export function untargetedTranscription(project: Project, clips: readonly Clip[]): (clip: Clip) => boolean {
  const footage = (clip: Clip): boolean => {
    const file = fileOfClip(project, clip);
    return file !== undefined && isTalkingFootage(file);
  };
  const anyFootage = clips.some(footage);
  return (clip) => !anyFootage || footage(clip);
}

/**
 * The words of `target`, by the order in the module comment. A new
 * transcription is kept on the file before this returns.
 */
export async function wordsFor(call: ToolCall, target: WordTarget, request: WordRequest): Promise<WordSource | WordSourceFailure> {
  const { file } = target;
  const requested = asrLanguage(request.language);
  const stored = storedTranscript(file);
  const sha = mediaSha256(file);
  const sameMedia = stored !== null && (!stored.sha256 || !sha || stored.sha256 === sha);
  const transcribe = request.transcribe ? call.host.audio?.transcribe : undefined;
  // A TTS script has no detected language; with no speech recognition to ask, it is the voice's words in any.
  const reusable = stored !== null && sameMedia && (languageMatches(stored, requested) || (stored.transcriptionSource === TTS_SCRIPT_SOURCE && !transcribe));
  const warnings: string[] = [];
  if (request.force && !transcribe) warnings.push("force ignored: speech recognition is not available on this Zenvi surface");
  const force = Boolean(request.force && transcribe);

  if (reusable && !force) return fromStored(stored, false, warnings);
  if (request.estimatesOk && !force && target.indexed) return fromIndex(target, warnings);
  if (!fileHasAudio(file)) return { kind: "no_audio", message: NO_AUDIO_MESSAGE };
  if (transcribe) {
    const path = mediaPathOf(file);
    try {
      const result = await transcribe.call(call.host.audio, path, { language: requested, prompt: transcriptionPrompt(requested), signal: call.signal });
      const record: StoredTranscript = {
        modelId: result.model,
        language: result.language || requested,
        requestLanguage: requested || "auto",
        // After the index's words (generation 1), so indices from either never pass for the other.
        generation: stored ? stored.generation + 1 : target.indexed ? 2 : 1,
        transcriptionSource: SERVER_SOURCE,
        createdAt: Math.round(Date.now() / 1000),
        ...(sha ? { sha256: sha } : {}),
        words: result.words,
        segments: result.segments,
      };
      storeTranscript(call.doc, file.id, record);
      return fromStored(record, true, warnings);
    } catch (error) {
      if (call.signal?.aborted) throw error;
      const code = isTranscriptionError(error) ? error.code : undefined;
      const message = error instanceof Error ? error.message : String(error);
      if (code === "no_audio") return { kind: "no_audio", message: NO_AUDIO_MESSAGE };
      if (request.estimatesOk && target.indexed) return fromIndex(target, [...warnings, `speech recognition failed (${message}); used the indexed transcript`]);
      if (code === "unavailable" || code === "sign_in") return { kind: "unavailable", code, message };
      return { kind: "failed", ...(code ? { code } : {}), message: code ? message : `Transcription failed: ${message}` };
    }
  }
  if (reusable) return fromStored(stored, false, warnings);
  if (request.estimatesOk && target.indexed) return fromIndex(target, warnings);
  return { kind: "unavailable", message: "speech recognition is not set up on this Zenvi surface" };
}

/** Speech windows (source seconds) from words: words less than `maxGapSec` apart run together, like the VAD's minimum silence. */
export function speechWindowsFromWords(words: readonly TimedText[], maxGapSec = 0.35): [number, number][] {
  const windows: [number, number][] = [];
  for (const w of [...words].sort((a, b) => a.startSec - b.startSec)) {
    if (!(w.endSec > w.startSec)) continue;
    const last = windows[windows.length - 1];
    if (last && w.startSec - last[1] <= maxGapSec) last[1] = Math.max(last[1], w.endSec);
    else windows.push([w.startSec, w.endSec]);
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Words on the timeline
// ---------------------------------------------------------------------------

/**
 * Words overlapping a clip's source window, with project frames
 * (map_timeline.words_for_clip): indexed from 0 per clip, cut to the trim.
 */
export function wordsForClip(words: readonly TimedText[], clip: Clip, fps: Fps, generation: number): TimedWord[] {
  const position = Number(clip.position) || 0;
  const start = Number(clip.start) || 0;
  const end = Number(clip.end) || start;
  const speed = clipSpeed(clip as unknown as Record<string, unknown>);
  const out: TimedWord[] = [];
  let index = 0;
  for (const w of words) {
    if (w.endSec <= start || w.startSec >= end) continue;
    const s = Math.max(start, w.startSec);
    const e = Math.min(end, w.endSec);
    if (e <= s) continue;
    const startFrame = toFrame(sourceToTimelineSec(s, position, start, speed), fps);
    let endFrame = toFrame(sourceToTimelineSec(e, position, start, speed), fps);
    if (endFrame <= startFrame) endFrame = startFrame + 1;
    out.push({
      index,
      text: w.text,
      startFrame,
      endFrame,
      startSec: s,
      endSec: e,
      timelineStartSec: toSeconds(startFrame, fps),
      timelineEndSec: toSeconds(endFrame, fps),
      clipId: String(clip.id),
      transcriptGeneration: generation,
    });
    index += 1;
  }
  return out;
}

/** A media-bin file's words, source time = timeline time (transcript.py `_words_payload`). */
export function wordsForFile(words: readonly TimedText[], fps: Fps, generation: number): TimedWord[] {
  return words.map((w, index) => {
    const startFrame = toFrame(w.startSec, fps);
    let endFrame = toFrame(w.endSec, fps);
    if (endFrame <= startFrame) endFrame = startFrame + 1;
    return { index, text: w.text, startFrame, endFrame, startSec: w.startSec, endSec: w.endSec, transcriptGeneration: generation };
  });
}
