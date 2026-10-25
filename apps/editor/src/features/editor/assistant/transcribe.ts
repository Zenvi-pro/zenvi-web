/**
 * `AudioHost.transcribe` in the browser: decode a project file's audio with
 * Web Audio at 16 kHz mono (`decodeMono`), cut it into pieces of at most ten
 * minutes at quiet moments (`planSpeechChunks` on its loudness envelope),
 * encode each as 16-bit WAV (ten minutes are about 19 MB, under the
 * backend's 25 MB) and send it to `POST /api/v1/transcription` with the
 * signed-in session. The engine reads and merges the answers.
 */
import {
  SPEECH_SAMPLE_RATE,
  TRANSCRIPTION_PATH,
  TranscriptionError,
  isTranscriptionError,
  mergeTranscriptions,
  parseTranscription,
  planSpeechChunks,
  transcriptionHttpError,
  type TranscribeOptions,
  type Transcription,
} from "@zenvi/engine";
import { backendSend } from "@/lib/backend";
import type { MediaSourceSpec } from "../session/media";
import { decodeMono, rmsFrames } from "./audioAnalysis";

/** Ten minutes of 16 kHz 16-bit mono WAV: about 19 MB. */
export const WAV_CHUNK_SECONDS = 10 * 60;

/** A WAV file of mono float samples as 16-bit PCM. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Sends one WAV piece; resolves with the backend's JSON answer. */
export type WavUpload = (wav: Uint8Array, fileName: string, fields: { language: string; prompt: string; signal?: AbortSignal }) => Promise<unknown>;

/** The upload the editor uses: the signed-in session, errors in words. */
export const backendWavUpload: WavUpload = async (wav, fileName, fields) => {
  const form = new FormData();
  form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), fileName);
  if (fields.language) form.append("language", fields.language);
  if (fields.prompt) form.append("prompt", fields.prompt);
  let answer: { status: number; body: unknown };
  try {
    answer = await backendSend(TRANSCRIPTION_PATH, form, { signal: fields.signal });
  } catch (error) {
    if (fields.signal?.aborted) throw error;
    throw new TranscriptionError("failed", `could not reach the Zenvi server (${error instanceof Error ? error.message : String(error)})`);
  }
  if (answer.status < 200 || answer.status >= 300) throw transcriptionHttpError(answer.status, answer.body);
  return answer.body;
};

/** Transcribe decoded mono speech (16 kHz) in WAV pieces through `upload`. */
export async function transcribeSamples(
  mono: Float32Array,
  options: TranscribeOptions & { upload: WavUpload; name?: string; chunkSeconds?: number },
): Promise<Transcription> {
  const rate = SPEECH_SAMPLE_RATE;
  const duration = mono.length / rate;
  if (!(duration > 0)) throw new TranscriptionError("no_audio", "the file has no audio to transcribe");
  const chunk = options.chunkSeconds ?? WAV_CHUNK_SECONDS;
  const envelope = duration > chunk ? { sampleRate: rate, frameSize: 480, rms: rmsFrames(mono, 480) } : undefined;
  const pieces = planSpeechChunks(duration, chunk, envelope);
  const stem = (options.name ?? "speech").replace(/\.[^.]*$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60) || "speech";
  const parts: { offset: number; transcription: Transcription }[] = [];
  for (const [i, [start, end]] of pieces.entries()) {
    options.signal?.throwIfAborted();
    const wav = encodeWav(mono.subarray(Math.round(start * rate), Math.round(end * rate)), rate);
    const answer = await options.upload(wav, `${stem}${pieces.length > 1 ? `-${i + 1}` : ""}.wav`, {
      language: options.language ?? "",
      prompt: options.prompt ?? "",
      signal: options.signal,
    });
    parts.push({ offset: start, transcription: parseTranscription(answer) });
  }
  return mergeTranscriptions(parts);
}

/** `AudioHost.transcribe` for a project file the editor has loaded. */
export async function transcribeSpeech(spec: MediaSourceSpec, options: TranscribeOptions & { name?: string } = {}, upload: WavUpload = backendWavUpload): Promise<Transcription> {
  let mono: Float32Array;
  try {
    mono = await decodeMono(spec, SPEECH_SAMPLE_RATE, options.signal);
  } catch (error) {
    if (options.signal?.aborted || isTranscriptionError(error)) throw error;
    throw new TranscriptionError("no_audio", error instanceof Error ? error.message : String(error));
  }
  return transcribeSamples(mono, { ...options, upload });
}
