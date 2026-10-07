/**
 * Deterministic PCM for the audio kernel tests, identical to
 * `scripts/parity/audio_goldens.py` (integer math only, so both languages
 * produce the same int16 samples; floats are `int16 / 32768`). Not exported
 * from the package entry point.
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

/** Triangle wave of a 32-bit phase, in [-2^30, 2^30]. */
function triangle(phase: number): number {
  return Math.abs(phase - 0x80000000) - 0x40000000;
}

const ENVELOPE = [29000, 2600, 18000, 700, 32000, 9000, 150, 24000];

export type SignalKind = "music" | "sparse";

/** One channel of int16 samples (`signal()` in audio_goldens.py). */
export function signalInt16(kind: SignalKind, channel: number, count: number, seed: number): Int16Array {
  const rnd = lcg(seed * 7919 + channel * 104729 + 1);
  const out = new Int16Array(count);
  if (kind === "music") {
    let p1 = 0;
    let p2 = 0;
    const inc1 = 9_830_400 + channel * 1_966_080;
    const inc2 = 131_072_000 + channel * 7_340_032;
    for (let i = 0; i < count; i += 1) {
      p1 = (p1 + inc1) >>> 0;
      p2 = (p2 + inc2) >>> 0;
      const env = ENVELOPE[Math.floor(i / 173) % ENVELOPE.length]!;
      const tone = ((triangle(p1) >> 16) * 3 + (triangle(p2) >> 16)) >> 2;
      const v = ((tone * env) >> 14) + ((rnd() >>> 21) - 1024);
      out[i] = Math.max(-32768, Math.min(32767, v));
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      const r = rnd();
      if (r % 97 === 0) out[i] = ((r >>> 16) & 0xffff) - 32768;
      else if (r % 13 === 0) out[i] = ((r >>> 20) & 0xfff) - 2048;
    }
  }
  return out;
}

/** Planar float channels (`int16 / 32768`). */
export function signal(kind: SignalKind, channels: number, count: number, seed: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) {
    const pcm = signalInt16(kind, c, count, seed);
    const f = new Float32Array(count);
    for (let i = 0; i < count; i += 1) f[i] = pcm[i]! / 32768;
    out.push(f);
  }
  return out;
}

export interface SampleDiff {
  /** Samples that are not bit-identical. */
  differing: number;
  maxAbs: number;
}

export function diffSamples(expected: Float32Array, actual: Float32Array): SampleDiff {
  if (expected.length !== actual.length) throw new RangeError(`length ${actual.length} vs ${expected.length}`);
  let differing = 0;
  let maxAbs = 0;
  for (let i = 0; i < expected.length; i += 1) {
    const e = expected[i]!;
    const a = actual[i]!;
    if (Object.is(e, a)) continue;
    differing += 1;
    const d = Math.abs(e - a);
    if (!(d <= maxAbs)) maxAbs = d;
  }
  return { differing, maxAbs };
}
