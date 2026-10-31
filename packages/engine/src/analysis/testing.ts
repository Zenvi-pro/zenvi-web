/**
 * Synthetic songs for the analysis tests and demos: drum-machine sections
 * with chords, bass and risers at a fixed tempo, so where every section
 * starts is known exactly. Deterministic; no media files.
 */

import { BEAT_SAMPLE_RATE } from "./beats.js";

export interface SongPart {
  bars: number;
  /** MIDI notes of the chord held through the part (empty: no chord). */
  chord: readonly number[];
  chordGain?: number;
  kick?: boolean;
  snare?: boolean;
  hats?: boolean;
  /** Sub bass on the chord's root, every beat. */
  bass?: boolean;
  /** A noise riser swelling over the part (a build). */
  riser?: boolean;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function noise(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 1073741824 - 1;
  };
}

/** Mono PCM at BEAT_SAMPLE_RATE, 4/4, and the second each part starts at. */
export function synthSong(parts: readonly SongPart[], bpm = 120): { pcm: Float32Array; starts: number[]; sampleRate: number } {
  const sr = BEAT_SAMPLE_RATE;
  const beat = 60 / bpm;
  const total = parts.reduce((s, p) => s + p.bars * 4 * beat, 0);
  const out = new Float32Array(Math.round(total * sr));
  const rand = noise(11);
  const starts: number[] = [];
  const hit = (at: number, seconds: number, wave: (k: number) => number) => {
    const start = Math.round(at * sr);
    for (let k = 0; k < seconds * sr && start + k < out.length; k += 1) out[start + k] = out[start + k]! + wave(k);
  };
  let t0 = 0;
  for (const part of parts) {
    starts.push(t0);
    const length = part.bars * 4 * beat;
    const a = Math.round(t0 * sr);
    const b = Math.min(out.length, Math.round((t0 + length) * sr));
    const gain = part.chordGain ?? 0.06;
    for (let i = a; i < b; i += 1) {
      const t = i / sr;
      let v = 0;
      for (const note of part.chord) v += Math.sin(2 * Math.PI * hz(note) * t) + 0.3 * Math.sin(4 * Math.PI * hz(note) * t);
      if (part.riser) v += 0.15 * ((i - a) / (b - a)) ** 2 * rand();
      out[i] = out[i]! + gain * v;
    }
    for (let n = 0; n < part.bars * 4; n += 1) {
      const t = t0 + n * beat;
      if (part.kick) hit(t, 0.25, (k) => (n % 4 === 0 ? 0.8 : 0.6) * Math.exp(-k / (0.06 * sr)) * Math.sin((2 * Math.PI * (50 + 70 * Math.exp(-k / (0.02 * sr))) * k) / sr));
      if (part.snare && n % 2 === 1) hit(t, 0.15, (k) => 0.3 * Math.exp(-k / (0.04 * sr)) * rand());
      if (part.hats) hit(t + beat / 2, 0.04, (k) => 0.08 * Math.exp(-k / (0.008 * sr)) * rand());
      if (part.bass && part.chord.length > 0) {
        const root = hz(part.chord[0]! - 24);
        hit(t, beat * 0.9, (k) => 0.35 * Math.min(1, k / 200) * Math.exp(-k / (0.3 * sr)) * Math.sin((2 * Math.PI * root * k) / sr));
      }
    }
    t0 += length;
  }
  return { pcm: out, starts, sampleRate: sr };
}

/** 16-bit mono WAV bytes of `pcm` (for demos a person can listen to). */
export function wavBytes(pcm: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i]!)) * 32767), true);
  return bytes;
}
