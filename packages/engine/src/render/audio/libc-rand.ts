/**
 * The desktop's libc `rand()` (macOS Libc, the BSD "minimal standard"
 * Park–Miller generator): `next = 16807 · next mod (2^31 − 1)` computed with
 * Schrage's method, `RAND_MAX = 2^31 − 1`, `srand(s)` stores `s` and a zero
 * state is replaced by 123459876. Verified against the system `rand()` for
 * seeds 0, 1, 12345, 1759000000 and 2^32 − 1.
 *
 * Noise (src/audio_effects/Noise.cpp:50-60) and Whisperization
 * (Whisperization.cpp:77) draw from the process-wide `rand()`, which makes
 * their output depend on everything else that ran. The kernels instead keep
 * one generator per effect instance with this exact algorithm, so a known
 * seed reproduces libopenshot draw for draw.
 */

export const RAND_MAX = 0x7fffffff;

export class LibcRand {
  private state: number;

  /** `srand(seed)` (seed taken as `unsigned int`). A never-seeded libc behaves as `srand(1)`. */
  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  /** `rand()`: an integer in [0, RAND_MAX]. */
  next(): number {
    let x = this.state;
    if (x === 0) x = 123459876;
    const hi = Math.floor(x / 127773);
    const lo = x - hi * 127773;
    let t = 16807 * lo - 2836 * hi;
    if (t < 0) t += 0x7fffffff;
    this.state = t;
    return t % 0x80000000;
  }
}

/** 32-bit FNV-1a over the UTF-8 bytes of `text` (seeds per-effect generators from the effect id). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  const add = (b: number): void => {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) add(cp);
    else if (cp < 0x800) {
      add(0xc0 | (cp >> 6));
      add(0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      add(0xe0 | (cp >> 12));
      add(0x80 | ((cp >> 6) & 63));
      add(0x80 | (cp & 63));
    } else {
      add(0xf0 | (cp >> 18));
      add(0x80 | ((cp >> 12) & 63));
      add(0x80 | ((cp >> 6) & 63));
      add(0x80 | (cp & 63));
    }
  }
  return h;
}
