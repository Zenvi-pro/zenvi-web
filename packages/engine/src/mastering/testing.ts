/** Synthetic reference signals for loudness tests (EBU Tech 3341 style). Not part of the public API. */

/** A sine of `db` dBFS peak. */
export function dbfsSine(frequency: number, db: number, seconds: number, sampleRate: number, phase = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const amplitude = 10 ** (db / 20);
  for (let n = 0; n < out.length; n += 1) out[n] = amplitude * Math.sin(2 * Math.PI * frequency * (n / sampleRate) + phase);
  return out;
}

/** The same sine on both channels. */
export function stereoSine(frequency: number, db: number, seconds: number, sampleRate: number): Float32Array[] {
  const tone = dbfsSine(frequency, db, seconds, sampleRate);
  return [tone, Float32Array.from(tone)];
}
