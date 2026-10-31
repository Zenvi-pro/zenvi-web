/**
 * Tempo, level and energy of a stock music preview, so search can filter by
 * what the track is instead of what its page says. The host decodes the
 * preview (`AudioHost.decodePcm`, ffmpeg reads the URL on the CLI); hosts that
 * only know the project's own files refuse the URL, and search says so.
 */

import { BEAT_SAMPLE_RATE, detectBeats, type TempoAlternative } from "../analysis/beats.js";
import { classifyEnergy, energyCurve, type Energy, type EnergyCurve } from "../stock/music.js";
import type { ToolCall } from "./define.js";

/** Seconds of the preview measured: enough bars to hear the tempo, little enough to download quickly. */
const MEASURE_SECONDS = 45;
/** A preview that does not decode in this long is skipped. */
const TIMEOUT_MS = 25_000;

export interface PreviewMeasure {
  bpm: number;
  confidence: number;
  alternatives: TempoAlternative[];
  beatsPerBar: number;
  /** RMS level of the measured stretch, dBFS. */
  loudnessDb: number;
  /** Highest sample, dBFS. */
  peakDb: number;
  energy: Energy;
  /** How the level moves over the measured stretch. */
  curve: EnergyCurve;
}

const db = (linear: number) => Math.round(20 * Math.log10(Math.max(linear, 1e-6)) * 10) / 10;

/** Can this host measure a preview at all: it decodes audio from a URL (Zenvi Cloud decodes project media only). */
export function canMeasurePreviews(call: ToolCall): boolean {
  return typeof call.host.audio?.decodePcm === "function" && call.host.audio.decodesUrls === true;
}

/** Measure `url`'s audio, or say why not (a string). */
export async function measurePreview(call: ToolCall, url: string): Promise<PreviewMeasure | string> {
  const decode = call.host.audio?.decodePcm;
  if (!decode) return "this surface cannot decode audio";
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const { samples, sampleRate } = await decode(url, { sampleRate: BEAT_SAMPLE_RATE, maxSeconds: MEASURE_SECONDS, signal: call.signal ? AbortSignal.any([call.signal, timeout]) : timeout });
    if (samples.length < sampleRate) return "the preview is too short to measure";
    let energy = 0;
    let peak = 0;
    for (const v of samples) {
      energy += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const loudnessDb = db(Math.sqrt(energy / samples.length));
    const perSecond: number[] = [];
    for (let i = 0; i + sampleRate <= samples.length; i += sampleRate) {
      let sum = 0;
      for (let k = i; k < i + sampleRate; k += 1) sum += samples[k]! * samples[k]!;
      // Silence floors at -60 dB: a gap in a track is quiet, not minus infinity.
      perSecond.push(Math.max(-60, db(Math.sqrt(sum / sampleRate))));
    }
    const beats = detectBeats(samples, sampleRate);
    const strength = beats.beats.length > 0 ? beats.beats.reduce((sum, b) => sum + b.strength, 0) / beats.beats.length : 0;
    return {
      bpm: beats.bpm,
      confidence: beats.confidence,
      alternatives: beats.alternatives,
      beatsPerBar: beats.beatsPerBar,
      loudnessDb,
      peakDb: db(peak),
      energy: classifyEnergy(loudnessDb, strength),
      curve: energyCurve(perSecond),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    call.host.log?.(`measure ${url} failed: ${message}`);
    return message;
  }
}
