/**
 * align_lyrics_tool: forced alignment of known words (song lyrics, a voice
 * script) to the audio they are sung or spoken in. Speech recognition hears
 * the audio (on device when set up, else the Zenvi server, steered by the
 * lyrics), `alignText` times the given words by what it heard, and the
 * result is kept as the file's transcript (`transcriptionSource`
 * "aligned_text"): get_transcript_tool, kinetic_captions_tool, add_captions_tool
 * and place_on_word_tool then use the lyrics' own spelling and lines with the
 * heard timings. Keeping a transcript is not an edit: no undo step.
 *
 * There is no vocal stem separation (Demucs): recognition hears the whole
 * mix, so dense arrangements match fewer words and more words are spread
 * between the ones it heard; the receipt reports the share heard.
 */

import { z } from "zod";
import { alignText, type TextAlignment } from "../../analysis/align.js";
import { asrLanguage, isTranscriptionError, type Transcription } from "../../analysis/transcription.js";
import type { Clip, ProjectFile } from "../../model/types.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { projectFps } from "../frame-time.js";
import { applied, failed, refused } from "../receipt.js";
import { clipSpeed, sourceToTimelineSec } from "../speech.js";
import { ALIGNED_SOURCE, fileHasAudio, fileOfClip, fileTarget, mediaPathOf, mediaSha256, storeTranscript, storedTranscript, type StoredTranscript } from "../transcripts.js";
import { fileById } from "./common.js";

const TOOL = "align_lyrics_tool";

/** Under this share of words heard, the timings are mostly spread, not heard. */
const ROUGH_RATIO = 0.5;
/** Whisper reads at most 224 prompt tokens; the start of the lyrics steers it best. */
const PROMPT_CHARS = 600;
const MAX_LINES_SHOWN = 120;

const input = z.strictObject({
  text: z.string().min(1).max(20_000).describe("The words as written: song lyrics or a voice script, one sung or spoken line per line."),
  timeline_clip_id: z.string().min(1).optional().describe("The clip playing the song or voice: line times come back in timeline seconds."),
  file_id: z.string().min(1).optional().describe("Or a media-bin file: times in the file's own seconds."),
  language: z.string().max(16).optional().describe("Language of the words (ISO 639-1, default auto)."),
});
type Input = z.output<typeof input>;

/** The prompt that steers recognition toward the lyrics' words. */
export function lyricsPrompt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= PROMPT_CHARS ? flat : flat.slice(0, flat.lastIndexOf(" ", PROMPT_CHARS) > 0 ? flat.lastIndexOf(" ", PROMPT_CHARS) : PROMPT_CHARS);
}

/**
 * `text` aligned to what was heard, and the transcript a file keeps of it
 * (after `file`'s own transcript and index words, when it has them).
 */
export function alignedTranscript(text: string, heard: Transcription, language: string, file?: ProjectFile): { alignment: TextAlignment; record: StoredTranscript } {
  const alignment = alignText(text, heard.words, { start: 0, end: heard.durationSeconds || undefined });
  const sha = mediaSha256(file);
  const previous = storedTranscript(file);
  const record: StoredTranscript = {
    modelId: heard.model,
    language: heard.language || language,
    requestLanguage: language || "auto",
    // After the index's words (generation 1), like a new transcription (transcripts.ts wordsFor).
    generation: previous ? previous.generation + 1 : file && fileTarget(file).indexed ? 2 : 1,
    transcriptionSource: ALIGNED_SOURCE,
    createdAt: Math.round(Date.now() / 1000),
    ...(sha ? { sha256: sha } : {}),
    words: alignment.words.map(({ text: t, startSec, endSec }) => ({ text: t, startSec, endSec })),
    segments: alignment.lines.map(({ text: t, startSec, endSec }) => ({ text: t, startSec, endSec })),
  };
  return { alignment, record };
}

export const alignLyricsTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Align lyrics to a song",
    description:
      "Time known words to the audio they are sung or spoken in (forced alignment): song lyrics for a lyric video or beat-locked kinetic type, or the script of a voice-over. " +
      "Speech recognition hears the audio and the given words take the times of the words it heard (misheard and unheard words are placed between them); the words keep their spelling and lines. " +
      "The result becomes the file's transcript, so get_transcript_tool, kinetic_captions_tool, add_captions_tool and place_on_word_tool use it next. Returns each line's start and end. No undo step (nothing on the timeline changes).",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, args: Input) => {
      const project = call.doc.project;
      if (Boolean(args.timeline_clip_id) === Boolean(args.file_id)) return refused(TOOL, "Error: pass timeline_clip_id or file_id (one of them).");
      let clip: Clip | undefined;
      let file: ProjectFile | undefined;
      if (args.timeline_clip_id) {
        clip = project.clips.find((c) => String(c.id) === args.timeline_clip_id);
        if (!clip) return refused(TOOL, `Error: unknown timeline clip ${args.timeline_clip_id}.`);
        file = fileOfClip(project, clip);
        if (!file) return refused(TOOL, `Error: clip ${clip.id} plays no media-bin file.`);
      } else {
        file = fileById(project, args.file_id!);
        if (!file) return refused(TOOL, `Error: unknown file ${args.file_id}.`);
      }
      if (!fileHasAudio(file) || !mediaPathOf(file, clip)) return refused(TOOL, `Error: ${file.name ?? file.id} has no audio to align the words to.`);
      const transcribe = call.host.audio?.transcribe;
      if (!transcribe) return unavailable(TOOL, "speech recognition is not set up (run `zenvi speech setup` to hear audio on this machine, or `zenvi login`).");
      const language = asrLanguage(args.language);
      let heard: Transcription;
      try {
        heard = await transcribe.call(call.host.audio, mediaPathOf(file, clip), { language, prompt: lyricsPrompt(args.text), signal: call.signal });
      } catch (error) {
        if (call.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (isTranscriptionError(error) && (error.code === "unavailable" || error.code === "sign_in")) return unavailable(TOOL, `${message}.`);
        return failed(TOOL, `Error: Speech recognition failed: ${message}.`);
      }
      const { alignment, record } = alignedTranscript(args.text, heard, language, file);
      if (record.words.length === 0) return refused(TOOL, "Error: text has no words to align.");
      storeTranscript(call.doc, file.id, record);
      const fps = projectFps(project);
      const toTimeline = (t: number): number => {
        if (!clip) return t;
        const seconds = sourceToTimelineSec(t, Number(clip.position) || 0, Number(clip.start) || 0, clipSpeed(clip as unknown as Record<string, unknown>));
        return Math.round(seconds * fps.num / fps.den) / (fps.num / fps.den);
      };
      const round = (t: number): number => Math.round(t * 1000) / 1000;
      const lines = alignment.lines.map((l) => ({ text: l.text, start: round(toTimeline(l.startSec)), end: round(toTimeline(l.endSec)) }));
      const heardPct = Math.round(alignment.heardRatio * 100);
      const warnings: string[] = [];
      if (alignment.heardRatio < ROUGH_RATIO) {
        warnings.push(
          `only ${heardPct}% of the words were heard in the audio${heard.onDevice ? " (set ZENVI_SPEECH_MODEL=small and run `zenvi speech setup --model small` to hear sung vocals better)" : ""}; check the line times on a preview before cutting to them`,
        );
      }
      if (clip) {
        const trimmed = lines.filter((l) => l.end <= toTimeline(Number(clip!.start) || 0) || l.start >= toTimeline(Number(clip!.end) || 0)).length;
        if (trimmed > 0) warnings.push(`${trimmed} line(s) fall outside clip ${clip.id}'s trim`);
      }
      const where = clip ? `clip ${clip.id}` : `file ${file.id}`;
      return applied(
        TOOL,
        `Aligned ${record.words.length} words in ${lines.length} line(s) to ${where}: ${heardPct}% heard (${heard.model || "speech recognition"}${heard.onDevice ? ", on device" : ""}).`,
        {
          warnings,
          notes: [
            clip ? "Line times are timeline seconds." : "Line times are the file's seconds.",
            "The words are now the file's transcript: kinetic_captions_tool / add_captions_tool caption them, place_on_word_tool lands an item on one.",
          ],
          data: {
            ...(clip ? { timeline_clip_id: clip.id } : {}),
            fileId: file.id,
            wordCount: record.words.length,
            heardRatio: Math.round(alignment.heardRatio * 1000) / 1000,
            language: record.language,
            transcriptionSource: ALIGNED_SOURCE,
            transcriptGeneration: record.generation,
            timeBase: clip ? "timeline" : "source",
            lines: lines.slice(0, MAX_LINES_SHOWN),
            ...(lines.length > MAX_LINES_SHOWN ? { linesOmitted: lines.length - MAX_LINES_SHOWN } : {}),
          },
        },
        0,
      );
    },
  }),
];
