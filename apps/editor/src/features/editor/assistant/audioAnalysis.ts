/**
 * `AudioHost.analyzeAudio` for the browser: decode a project file's audio
 * with Web Audio (resampled to the asked rate, 16 kHz by default like the
 * desktop's VAD), mix to mono and measure the RMS of each frame (480 samples,
 * 30 ms). Feeds remove_silence_tool and duck_under_speech_tool.
 *
 * `AudioHost.decodePcm`: the same decode, returning the mono samples
 * (22050 Hz by default) for beat tracking (detect_beats_tool, build_reel_tool).
 */
import type { AudioEnvelope } from "@zenvi/engine";
import type { MediaSourceSpec } from "../session/media";

/** Web Audio decodes whole files in memory; past this, ask for the desktop app. */
export const MAX_ANALYZE_BYTES = 768 * 1024 * 1024;

/** The bytes behind a media source (in memory, OPFS or a signed URL). */
export async function blobOf(spec: MediaSourceSpec, signal?: AbortSignal): Promise<Blob> {
  switch (spec.kind) {
    case "blob":
      return spec.blob;
    case "opfs":
      return spec.handle.getFile();
    case "url": {
      let response = await fetch(spec.url, { signal });
      if ((response.status === 401 || response.status === 403) && spec.refresh) response = await fetch(await spec.refresh(), { signal });
      if (!response.ok) throw new Error(`could not read the media (${response.status})`);
      return response.blob();
    }
  }
}

/** RMS of each `frameSize` samples of `mono` (the last frame may be shorter). */
export function rmsFrames(mono: Float32Array, frameSize: number): Float32Array {
  const frames = Math.ceil(mono.length / frameSize);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    const from = f * frameSize;
    const to = Math.min(mono.length, from + frameSize);
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += mono[i]! * mono[i]!;
    out[f] = Math.sqrt(sum / Math.max(1, to - from));
  }
  return out;
}

/** Average the channels of a decoded buffer. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const length = Math.min(...channels.map((c) => c.length));
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i += 1) mono[i]! += channel[i]! / channels.length;
  return mono;
}

/** Decode `spec`'s audio, resampled to `sampleRate` and mixed to mono. */
export async function decodeMono(spec: MediaSourceSpec, sampleRate: number, signal?: AbortSignal): Promise<Float32Array> {
  if (typeof OfflineAudioContext === "undefined") throw new Error("this browser cannot decode audio");
  const blob = await blobOf(spec, signal);
  if (blob.size > MAX_ANALYZE_BYTES) throw new Error("the file is too large to analyze in the browser; use Zenvi desktop");
  const bytes = await blob.arrayBuffer();
  signal?.throwIfAborted();
  // decodeAudioData resamples to the context's rate.
  const context = new OfflineAudioContext(1, 1, sampleRate);
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(bytes);
  } catch {
    throw new Error("the file has no audio this browser can decode");
  }
  return mixToMono(Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c)));
}

export async function decodePcm(
  spec: MediaSourceSpec,
  options: { sampleRate?: number; startSeconds?: number; maxSeconds?: number; signal?: AbortSignal } = {},
): Promise<{ sampleRate: number; samples: Float32Array }> {
  const sampleRate = options.sampleRate ?? 22050;
  const mono = await decodeMono(spec, sampleRate, options.signal);
  const from = Math.max(0, Math.round((options.startSeconds ?? 0) * sampleRate));
  const to = options.maxSeconds !== undefined ? Math.min(mono.length, from + Math.round(options.maxSeconds * sampleRate)) : mono.length;
  return { sampleRate, samples: from === 0 && to === mono.length ? mono : mono.slice(from, to) };
}

export async function analyzeAudio(
  spec: MediaSourceSpec,
  options: { sampleRate?: number; frameSize?: number; signal?: AbortSignal } = {},
): Promise<AudioEnvelope> {
  const sampleRate = options.sampleRate ?? 16000;
  const frameSize = options.frameSize ?? 480;
  const mono = await decodeMono(spec, sampleRate, options.signal);
  return { sampleRate, frameSize, rms: rmsFrames(mono, frameSize) };
}
