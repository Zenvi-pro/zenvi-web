/**
 * Word timings for a generated voice. The Zenvi backend's TTS
 * (`POST /api/v1/generation/tts`, OpenAI tts-1) returns audio only, but the
 * generator knows the words: they are the script. This lays the script over
 * the voice's own speech runs (the energy VAD of tools/speech.ts), each word
 * a share of the voiced time by its length, so captions follow the voice's
 * pauses with no speech recognition (the portable server has none). Words
 * are kept on the file as its transcript (`ai_metadata.asr`, source
 * `tts_script`), where kinetic_captions_tool and get_transcript_tool read
 * words from.
 */

import type { TimedText } from "../analysis/transcription.js";
import type { StoredTranscript } from "./transcripts.js";

/** `transcriptionSource` of words laid from a TTS script over its voice. */
export const TTS_SCRIPT_SOURCE = "tts_script";

type Range = readonly [number, number];

/** A word's share of the voiced time: its letters and digits, at least two (short words still take a syllable). */
function weight(word: string): number {
  return Math.max(2, word.replace(/[^\p{L}\p{N}]/gu, "").length);
}

const round = (t: number): number => Math.round(t * 1000) / 1000;

/**
 * The script's words over `voiced` (source seconds, in order); the whole of
 * `[0, duration]` when the VAD found nothing. A word that would straddle a
 * pause moves wholly to the side holding most of it, so no caption hangs
 * over a silence.
 */
export function scriptWordTimes(script: string, voiced: readonly Range[], duration: number): TimedText[] {
  const words = script.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const runs = voiced.filter(([s, e]) => e > s);
  const spans: Range[] = runs.length > 0 ? runs : duration > 0 ? [[0, duration]] : [];
  if (words.length === 0 || spans.length === 0) return [];
  const total = spans.reduce((n, [s, e]) => n + e - s, 0);
  /** Voiced offset (0..total) to source seconds, and the run it falls in. */
  const at = (offset: number): { t: number; run: number } => {
    let left = Math.min(Math.max(0, offset), total);
    for (const [i, [s, e]] of spans.entries()) {
      if (left <= e - s + 1e-9 || i === spans.length - 1) return { t: s + Math.min(left, e - s), run: i };
      left -= e - s;
    }
    return { t: spans[spans.length - 1]![1], run: spans.length - 1 };
  };
  const weights = words.map(weight);
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: TimedText[] = [];
  let done = 0;
  for (const [i, text] of words.entries()) {
    const from = (done / sum) * total;
    done += weights[i]!;
    const to = (done / sum) * total;
    const a = at(from + 1e-9);
    const b = at(to - 1e-9);
    let start = a.t;
    let end = b.t;
    if (a.run !== b.run) {
      // Most of the word in the first run: end it there; else start it at the next run's start.
      const [, endA] = spans[a.run]!;
      const [startB] = spans[b.run]!;
      if (endA - a.t >= b.t - startB) end = endA;
      else start = startB;
    }
    out.push({ text, startSec: round(start), endSec: round(Math.max(start, end)) });
  }
  return out;
}

/** The transcript a TTS file keeps: the script's words over its voice. */
export function ttsTranscript(words: readonly TimedText[], language = ""): StoredTranscript {
  return {
    modelId: TTS_SCRIPT_SOURCE,
    language,
    requestLanguage: "auto",
    generation: 1,
    transcriptionSource: TTS_SCRIPT_SOURCE,
    createdAt: Math.round(Date.now() / 1000),
    words: [...words],
    segments: words.length > 0 ? [{ text: words.map((w) => w.text).join(" "), startSec: words[0]!.startSec, endSec: words[words.length - 1]!.endSec }] : [],
  };
}
