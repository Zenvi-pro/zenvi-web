/**
 * `AudioHost.transcribe` on Node, for the CLI, the local MCP server and Zenvi
 * Cloud: ffmpeg extracts the speech audio (mono, 16 kHz; MP3 at 32 kbps, or
 * FLAC when this ffmpeg build has no MP3 encoder), media longer than one
 * upload is split at quiet moments (`planSpeechChunks` on the loudness
 * envelope), each piece goes to the Zenvi backend through the host's
 * `upload`, and the answers are read and merged by the engine
 * (`parseTranscription`, `mergeTranscriptions`). Pieces are extracted one at
 * a time, so a long file never sits in memory as audio.
 */

import path from "node:path";
import {
  SPEECH_CHUNK_SECONDS,
  SPEECH_SAMPLE_RATE,
  TRANSCRIPTION_MAX_BYTES,
  TranscriptionError,
  isTranscriptionError,
  mergeTranscriptions,
  parseTranscription,
  planSpeechChunks,
  type AudioEnvelope,
  type TranscribeOptions,
  type Transcription,
} from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { encoderNames } from "../ffmpeg/capabilities.js";
import { AbortedError, FfmpegError, runBinary } from "../ffmpeg/process.js";
import { ffprobe } from "../probe/ffprobe.js";
import { analyzeAudio } from "./analyze.js";

/** One piece of speech audio to send. */
export interface SpeechPiece {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  /** Seconds into the media where the piece starts. */
  offset: number;
}

/**
 * Send one piece to `POST /api/v1/transcription` with `language` and
 * `prompt` form fields. Resolves with the JSON answer; rejects with a
 * `TranscriptionError` (`transcriptionHttpError` for a non-2xx answer).
 */
export type SpeechUpload = (piece: SpeechPiece, fields: { language: string; prompt: string; signal?: AbortSignal }) => Promise<unknown>;

export interface SpeechFormat {
  encoder: string;
  args: readonly string[];
  extension: string;
  contentType: string;
  /** Longest piece in this format that stays well under the upload limit. */
  chunkSeconds: number;
}

/** 32 kbps: 20 minutes is about 4.8 MB. */
export const MP3_SPEECH: SpeechFormat = {
  encoder: "libmp3lame",
  args: ["-c:a", "libmp3lame", "-b:a", "32k", "-f", "mp3"],
  extension: "mp3",
  contentType: "audio/mpeg",
  chunkSeconds: SPEECH_CHUNK_SECONDS,
};

/** Lossless, about 20 kB/s of speech: 10 minutes stay near 12 MB. */
export const FLAC_SPEECH: SpeechFormat = {
  encoder: "flac",
  args: ["-c:a", "flac", "-f", "flac"],
  extension: "flac",
  contentType: "audio/flac",
  chunkSeconds: 10 * 60,
};

/** MP3 when this ffmpeg can encode it, else FLAC (every build has it). */
export async function speechFormat(): Promise<SpeechFormat> {
  try {
    return (await encoderNames()).has(MP3_SPEECH.encoder) ? MP3_SPEECH : FLAC_SPEECH;
  } catch {
    return FLAC_SPEECH;
  }
}

const NO_AUDIO = /matches no streams|does not contain any stream|Stream map '0:a:0'/i;

/** The speech audio of [start, start + duration) seconds of `file`, encoded in `format`. */
export async function extractSpeechAudio(
  file: string,
  range: { start: number; duration: number },
  format: SpeechFormat,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-ss", range.start.toFixed(3), "-t", range.duration.toFixed(3),
    "-i", file,
    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(SPEECH_SAMPLE_RATE),
    ...format.args, "pipe:1",
  ];
  try {
    const { stdout } = await runBinary(resolveBinary("ffmpeg"), args, {
      signal,
      maxStdout: TRANSCRIPTION_MAX_BYTES,
      what: `Extracting the speech of ${path.basename(file)} failed`,
    });
    return new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.byteLength);
  } catch (error) {
    if (error instanceof FfmpegError && NO_AUDIO.test(error.stderr)) throw new TranscriptionError("no_audio", `${path.basename(file)} has no audio stream.`);
    if (error instanceof FfmpegError && /more output than expected/.test(error.message)) {
      throw new TranscriptionError("too_large", "a piece of the speech audio came out over the server's 25 MB limit");
    }
    throw error;
  }
}

/** Seconds of audio in `file`, or a TranscriptionError when it has none. */
async function audioDuration(file: string, signal?: AbortSignal): Promise<number> {
  const probe = await ffprobe(file, signal);
  const streams = probe.streams.filter((s) => s.codec_type === "audio");
  if (streams.length === 0) throw new TranscriptionError("no_audio", `${path.basename(file)} has no audio stream.`);
  const candidates = [probe.format.duration, ...streams.map((s) => s.duration)].map((d) => Number(d)).filter((d) => Number.isFinite(d) && d > 0);
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

export interface TranscribeFileOptions extends TranscribeOptions {
  upload: SpeechUpload;
  /** Encoding override (tests); defaults to `speechFormat()`. */
  format?: SpeechFormat;
}

/** Transcribe the speech in a local media file through `upload`. */
export async function transcribeMediaFile(file: string, options: TranscribeFileOptions): Promise<Transcription> {
  const { signal } = options;
  const format = options.format ?? (await speechFormat());
  const duration = await audioDuration(file, signal);
  if (!(duration > 0)) throw new TranscriptionError("no_audio", `${path.basename(file)} has no audio to transcribe.`);
  let envelope: AudioEnvelope | undefined;
  if (duration > format.chunkSeconds) envelope = await analyzeAudio(file, { signal });
  const pieces = planSpeechChunks(duration, format.chunkSeconds, envelope);
  const stem = path.basename(file, path.extname(file)).replace(/[^\w.-]+/g, "_").slice(0, 60) || "speech";
  const parts: { offset: number; transcription: Transcription }[] = [];
  for (const [i, [start, end]] of pieces.entries()) {
    if (signal?.aborted) throw new AbortedError();
    const bytes = await extractSpeechAudio(file, { start, duration: end - start }, format, signal);
    const piece: SpeechPiece = {
      bytes,
      fileName: `${stem}${pieces.length > 1 ? `-${i + 1}` : ""}.${format.extension}`,
      contentType: format.contentType,
      offset: start,
    };
    let answer: unknown;
    try {
      answer = await options.upload(piece, { language: options.language ?? "", prompt: options.prompt ?? "", signal });
    } catch (error) {
      if (isTranscriptionError(error) || signal?.aborted) throw error;
      throw new TranscriptionError("failed", `could not reach the Zenvi server (${error instanceof Error ? error.message : String(error)})`);
    }
    parts.push({ offset: start, transcription: parseTranscription(answer) });
  }
  return mergeTranscriptions(parts);
}
