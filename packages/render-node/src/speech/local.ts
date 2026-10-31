/**
 * `AudioHost.transcribe` on this machine: ffmpeg decodes the speech audio
 * (mono, 16 kHz float), Whisper hears it with word timestamps (models.ts,
 * runtime.ts), and the engine reads and merges the answers the way it reads
 * the backend's (`parseTranscription`, `mergeTranscriptions`). Media longer
 * than one piece is split at quiet moments (`planSpeechChunks`), so an hour
 * of audio never sits in memory at once. Free and offline once set up.
 */

import path from "node:path";
import {
  SPEECH_SAMPLE_RATE,
  TranscriptionError,
  mergeTranscriptions,
  parseTranscription,
  planSpeechChunks,
  speechLanguageCode,
  type AudioEnvelope,
  type TimedText,
  type TranscribeOptions,
  type Transcription,
} from "@zenvi/engine";
import { NoAudioError, analyzeAudio, decodePcm } from "../audio/analyze.js";
import { ensureModel, modelDir, type ModelCacheOptions } from "../matte/model-cache.js";
import { AbortedError } from "../ffmpeg/process.js";
import { ffprobe } from "../probe/ffprobe.js";
import { SPEECH_MODELS, speechModelId, speechModelPresent, type SpeechModel, type SpeechModelId } from "./models.js";
import { loadTransformers, resolveTransformers, type SpeechChunk, type SpeechPipeline } from "./runtime.js";

/** Ten minutes of 16 kHz float is 38 MB: the most one piece holds. */
export const LOCAL_PIECE_SECONDS = 10 * 60;

export interface LocalSpeechOptions extends Pick<ModelCacheOptions, "env" | "fetch" | "log"> {
  model?: SpeechModelId;
}

/** Whether this machine can transcribe on device now: the runtime resolves and the model's files are cached. */
export function localSpeechReady(options: LocalSpeechOptions = {}): boolean {
  const model = SPEECH_MODELS[options.model ?? speechModelId(options.env)];
  return resolveTransformers(options.env) !== undefined && speechModelPresent(model, { env: options.env });
}

/** Sentence-like segments: a new one after closing punctuation or a pause of `gap` seconds. */
export function segmentWords(words: readonly TimedText[], gap = 0.8): TimedText[] {
  const out: TimedText[] = [];
  let run: TimedText[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    out.push({ text: run.map((w) => w.text).join(" "), startSec: run[0]!.startSec, endSec: run[run.length - 1]!.endSec });
    run = [];
  };
  for (const word of words) {
    const last = run[run.length - 1];
    if (last && word.startSec - last.endSec >= gap) flush();
    run.push(word);
    if (/[.!?…]["')\]]*$/.test(word.text)) flush();
  }
  flush();
  return out;
}

/**
 * Whisper's word chunks as the backend's answer shape. A last word whose end
 * Whisper left open ends with the audio.
 */
export function chunksToAnswer(chunks: readonly SpeechChunk[], meta: { language: string; model: string; durationSeconds: number }): Record<string, unknown> {
  const words = chunks
    .map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? meta.durationSeconds }))
    .filter((w) => w.text.length > 0 && Number.isFinite(w.start));
  const timed = words.map((w) => ({ text: w.text, startSec: w.start, endSec: Math.max(w.start, Math.min(w.end, meta.durationSeconds)) }));
  return {
    language: meta.language,
    model: meta.model,
    duration_seconds: meta.durationSeconds,
    words: timed.map((w) => ({ word: w.text, start: w.startSec, end: w.endSec })),
    segments: segmentWords(timed).map((s) => ({ text: s.text, start: s.startSec, end: s.endSec })),
  };
}

const pipelines = new Map<string, Promise<SpeechPipeline>>();
/** One transcription at a time: Whisper already uses every core. */
let queue: Promise<unknown> = Promise.resolve();

async function speechPipeline(model: SpeechModel, options: LocalSpeechOptions): Promise<SpeechPipeline> {
  let ready = pipelines.get(model.id);
  if (!ready) {
    ready = (async () => {
      const transformers = await loadTransformers(options.env);
      // Checks every file against its pinned checksum (downloading what is missing) before the runtime reads them.
      await ensureModel(model, { env: options.env, fetch: options.fetch, log: options.log });
      transformers.env.localModelPath = path.dirname(modelDir(model, { env: options.env }));
      transformers.env.allowLocalModels = true;
      transformers.env.allowRemoteModels = false;
      return transformers.pipeline("automatic-speech-recognition", model.id, { dtype: model.dtype, device: "cpu" });
    })();
    pipelines.set(model.id, ready);
    ready.catch(() => pipelines.delete(model.id));
  }
  return ready;
}

async function audioSeconds(file: string, signal?: AbortSignal): Promise<number> {
  const probe = await ffprobe(file, signal);
  const streams = probe.streams.filter((s) => s.codec_type === "audio");
  if (streams.length === 0) throw new TranscriptionError("no_audio", `${path.basename(file)} has no audio stream.`);
  const candidates = [probe.format.duration, ...streams.map((s) => s.duration)].map(Number).filter((d) => Number.isFinite(d) && d > 0);
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

/**
 * Transcribe `file` on this machine. `options.language` "" means English
 * (Transformers.js does not detect the language); pass the code for other
 * speech. `options.prompt` is not used: the pipeline takes none.
 */
export async function transcribeLocally(file: string, options: TranscribeOptions & LocalSpeechOptions = {}): Promise<Transcription> {
  const run = queue.then(() => transcribe(file, options));
  queue = run.catch(() => undefined);
  return run;
}

async function transcribe(file: string, options: TranscribeOptions & LocalSpeechOptions): Promise<Transcription> {
  const { signal } = options;
  const model = SPEECH_MODELS[options.model ?? speechModelId(options.env)];
  const duration = await audioSeconds(file, signal);
  if (!(duration > 0)) throw new TranscriptionError("no_audio", `${path.basename(file)} has no audio to transcribe.`);
  let asr: SpeechPipeline;
  try {
    asr = await speechPipeline(model, options);
  } catch (error) {
    throw new TranscriptionError("unavailable", `on-device speech recognition could not start (${error instanceof Error ? error.message : String(error)})`);
  }
  let envelope: AudioEnvelope | undefined;
  if (duration > LOCAL_PIECE_SECONDS) envelope = await analyzeAudio(file, { signal });
  const language = speechLanguageCode(options.language) || "en";
  const parts: { offset: number; transcription: Transcription }[] = [];
  for (const [start, end] of planSpeechChunks(duration, LOCAL_PIECE_SECONDS, envelope)) {
    if (signal?.aborted) throw new AbortedError();
    let samples: Float32Array;
    try {
      ({ samples } = await decodePcm(file, { sampleRate: SPEECH_SAMPLE_RATE, startSeconds: start, maxSeconds: end - start, signal }));
    } catch (error) {
      if (error instanceof NoAudioError) throw new TranscriptionError("no_audio", `${path.basename(file)} has no audio stream.`);
      throw error;
    }
    const seconds = samples.length / SPEECH_SAMPLE_RATE;
    if (seconds <= 0) continue;
    let out: { chunks?: SpeechChunk[] };
    try {
      out = await asr(samples, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, task: "transcribe", language });
    } catch (error) {
      throw new TranscriptionError("failed", `on-device speech recognition failed (${error instanceof Error ? error.message : String(error)})`);
    }
    const answer = chunksToAnswer(out.chunks ?? [], { language, model: model.name, durationSeconds: seconds });
    parts.push({ offset: start, transcription: parseTranscription(answer) });
  }
  return { ...mergeTranscriptions(parts), onDevice: true };
}
