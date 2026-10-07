/**
 * Robotization and Whisperization, ported from libopenshot
 * src/audio_effects/Robotization.cpp:49-82 and Whisperization.cpp:49-89 on the
 * STFT framework (`stft.ts`). `fft_size` e gives N = 2^(e+5) (default 4:
 * 512), `hop_size` h gives overlap 2^(h+1) (Robotization 0: 2,
 * Whisperization 2: 8), `window_type` 0–3 (rectangular, Bartlett, Hann,
 * Hamming).
 *
 * Robotization replaces every bin by its magnitude (zero phase).
 * Whisperization keeps bins 0..N/2's magnitudes with uniformly random
 * phases `2π·rand()/RAND_MAX` and mirrors them conjugated into N−k.
 * Both work on bins 0..N/2 of a real FFT (`fft.ts`); for Robotization that
 * mirrors |X[k]| into N−k, where the desktop takes |X[N−k]| from vDSP's
 * (rounding-asymmetric) output, a difference far below the FFT tolerance.
 *
 * Parity divergence: Whisperization draws from the process-wide libc
 * `rand()`, so its phases depend on everything else the desktop ran. This
 * kernel draws from a per-instance libc-compatible generator seeded with
 * `fnv1a32(id)`; libopenshot after `srand(fnv1a32(id))` makes the same draws
 * (the parity test does that).
 */

import type { AudioKernel } from "../types.js";
import { int, str } from "../kernels/params.js";
import type { Params } from "../kernels/types.js";
import { cosf, sinf } from "./apple-libm.js";
import { f32 } from "./float.js";
import { fnv1a32, LibcRand } from "./libc-rand.js";
import { hypotf } from "./libm.js";
import { Stft } from "./stft.js";

/** `2.0f * M_PI * (float)rand() / (float)RAND_MAX`, as compiled: `((double)(float)r · 2π) · 2^-31`, then float. */
const TWO_PI = 2 * Math.PI;

/**
 * `1 << (enum + 5)` and `1 << (enum + 1)`. libopenshot shifts unchecked;
 * the exponents are clamped to sizes up to 2^15 here.
 */
function sizes(params: Params, defaultHop: number): { fft: number; overlap: number; window: number } {
  const fftShift = Math.min(15, Math.max(0, int(params, "fft_size", 4) + 5));
  const hopShift = Math.min(15, Math.max(0, int(params, "hop_size", defaultHop) + 1));
  return { fft: 2 ** fftShift, overlap: 2 ** hopShift, window: int(params, "window_type", 0) };
}

class RobotizationStft extends Stft {
  /** Every bin becomes its magnitude with zero phase (Robotization.cpp:71-82). */
  protected modification(): void {
    const re = this.binRe;
    const im = this.binIm;
    this.fft.forward(this.frame, re, im);
    for (let k = 0; k < re.length; k += 1) {
      re[k] = hypotf(re[k]!, im[k]!);
      im[k] = 0;
    }
    this.fft.inverse(re, im, this.frame);
  }
}

class WhisperizationStft extends Stft {
  constructor(private readonly rand: LibcRand) {
    super();
  }

  /**
   * Bins 0..N/2 keep their magnitude with phase `2π·rand()/RAND_MAX`, bins
   * N−k their conjugates (Whisperization.cpp:71-89). Bins 0 and N/2 get a
   * random phase too; only the real part of the inverse is kept, which is
   * the inverse of their real parts.
   */
  protected modification(): void {
    const re = this.binRe;
    const im = this.binIm;
    this.fft.forward(this.frame, re, im);
    for (let k = 0; k < re.length; k += 1) {
      const magnitude = hypotf(re[k]!, im[k]!);
      const phase = f32(f32(this.rand.next()) * TWO_PI * 2 ** -31);
      re[k] = magnitude * cosf(phase);
      im[k] = magnitude * sinf(phase);
    }
    this.fft.inverse(re, im, this.frame);
  }
}

/** libopenshot `Robotization`. */
export const robotization: AudioKernel = (channels, _sampleRate, params, state) => {
  let stft = state.get("Robotization");
  if (!(stft instanceof RobotizationStft)) {
    stft = new RobotizationStft();
    state.set("Robotization", stft);
  }
  const s = sizes(params, 0);
  const r = stft as RobotizationStft;
  r.setup(channels.length);
  r.updateParameters(s.fft, s.overlap, s.window);
  r.process(channels);
};

/** libopenshot `Whisperization` with a per-instance generator (see the module comment). */
export const whisperization: AudioKernel = (channels, _sampleRate, params, state) => {
  let stft = state.get("Whisperization");
  if (!(stft instanceof WhisperizationStft)) {
    stft = new WhisperizationStft(new LibcRand(fnv1a32(str(params, "id", ""))));
    state.set("Whisperization", stft);
  }
  const s = sizes(params, 2);
  const w = stft as WhisperizationStft;
  w.setup(channels.length);
  w.updateParameters(s.fft, s.overlap, s.window);
  w.process(channels);
};
