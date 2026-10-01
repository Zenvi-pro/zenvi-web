/**
 * The FFT behind the STFT effects, standing in for `juce::dsp::FFT::perform`
 * (libopenshot-audio juce_FFT.cpp:434-536). On macOS JUCE runs Apple's
 * `vDSP_fft_zop` on interleaved `Complex<float>` buffers: forward
 * `X[k] = Σ x[n]·e^(−2πikn/N)` unscaled, inverse with `e^(+2πikn/N)`, then
 * scaled by `1/N` in float.
 *
 * vDSP's float32 butterflies are not reproducible outside Accelerate, so
 * this transform runs in double precision and rounds to float where the
 * JUCE buffers do; the result differs from the desktop by vDSP's own
 * rounding (measured: at most 1.2e-7 on the parity cases).
 *
 * The STFT effects only transform real frames and only keep the real part
 * of the inverse, so both directions use the half-size complex transform of
 * a real signal: forward bins 0..N/2 (the rest are their conjugates), and
 * the inverse of the Hermitian part of the spectrum, which is exactly the
 * real part of the full inverse (`Re(x) = IFFT((X[k] + conj(X[N−k]))/2)`).
 */

/** In-place radix-2 complex FFT on split double arrays, twiddles stored per stage. */
class SplitFft {
  readonly size: number;
  private readonly twiddles: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    this.size = size;
    this.twiddles = new Float64Array(2 * Math.max(1, size));
    let o = 0;
    for (let len = 2; len <= size; len <<= 1) {
      for (let k = 0; k < len >> 1; k += 1) {
        const angle = (2 * Math.PI * k) / len;
        this.twiddles[o++] = Math.cos(angle);
        this.twiddles[o++] = Math.sin(angle);
      }
    }
    let bits = 0;
    while (1 << bits < size) bits += 1;
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i += 1) {
      let r = 0;
      for (let b = 0; b < bits; b += 1) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.reverse[i] = r;
    }
  }

  /** `sign` −1: forward (e^−i), +1: inverse (e^+i), unscaled. */
  transform(re: Float64Array, im: Float64Array, sign: number): void {
    const n = this.size;
    const rev = this.reverse;
    const tw = this.twiddles;
    for (let i = 0; i < n; i += 1) {
      const j = rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    let o = 0;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      for (let k = 0; k < half; k += 1) {
        const wr = tw[o + 2 * k]!;
        const wi = sign * tw[o + 2 * k + 1]!;
        for (let a = k; a < n; a += len) {
          const b = a + half;
          const br = re[b]!;
          const bi = im[b]!;
          const xr = br * wr - bi * wi;
          const xi = br * wi + bi * wr;
          const ar = re[a]!;
          const ai = im[a]!;
          re[b] = ar - xr;
          im[b] = ai - xi;
          re[a] = ar + xr;
          im[a] = ai + xi;
        }
      }
      o += 2 * half;
    }
  }
}

/** Real-signal FFT of size N (a power of two) via an N/2-point complex FFT. */
export class RealFft {
  readonly size: number;
  private readonly half: number;
  private readonly fft: SplitFft;
  /** `e^(−2πik/N)` for k = 0..N/2 − 1. */
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number) {
    this.size = size;
    this.half = Math.max(1, size >> 1);
    this.fft = new SplitFft(this.half);
    this.wr = new Float64Array(this.half);
    this.wi = new Float64Array(this.half);
    for (let k = 0; k < this.half; k += 1) {
      const angle = (2 * Math.PI * k) / size;
      this.wr[k] = Math.cos(angle);
      this.wi[k] = -Math.sin(angle);
    }
    this.re = new Float64Array(this.half);
    this.im = new Float64Array(this.half);
  }

  /**
   * Forward transform of the real frame `x` (length N): bins 0..N/2 into
   * `outRe`/`outIm` (length N/2 + 1), rounded to float like JUCE's output buffer.
   */
  forward(x: Float32Array, outRe: Float32Array, outIm: Float32Array): void {
    const n = this.size;
    if (n === 1) {
      outRe[0] = x[0]!;
      outIm[0] = 0;
      return;
    }
    const m = this.half;
    const re = this.re;
    const im = this.im;
    for (let i = 0; i < m; i += 1) {
      re[i] = x[2 * i]!;
      im[i] = x[2 * i + 1]!;
    }
    this.fft.transform(re, im, -1);
    for (let k = 0; k <= m; k += 1) {
      const a = re[k % m]!;
      const b = im[k % m]!;
      const c = re[(m - k) % m]!;
      const d = -im[(m - k) % m]!;
      // E = (Z[k] + conj Z[m−k])/2, O = (Z[k] − conj Z[m−k])/(2i), X = E + W^k·O.
      const er = 0.5 * (a + c);
      const ei = 0.5 * (b + d);
      const or = 0.5 * (b - d);
      const oi = -0.5 * (a - c);
      const wr = k < m ? this.wr[k]! : -1;
      const wi = k < m ? this.wi[k]! : 0;
      outRe[k] = er + (wr * or - wi * oi);
      outIm[k] = ei + (wr * oi + wi * or);
    }
  }

  /**
   * Inverse transform of the Hermitian spectrum given by bins 0..N/2 (the
   * imaginary parts of bins 0 and N/2 are ignored): `y = f32(N·x)·(1/N)`, as
   * JUCE scales vDSP's unscaled float output.
   */
  inverse(inRe: Float32Array, inIm: Float32Array, y: Float32Array): void {
    const n = this.size;
    const scale = 1 / n;
    if (n === 1) {
      y[0] = inRe[0]!;
      return;
    }
    const m = this.half;
    const re = this.re;
    const im = this.im;
    for (let k = 0; k < m; k += 1) {
      // X[k] and X[k + m] = conj(X[m − k]) (bins 0 and m real).
      const xr = inRe[k]!;
      const xi = k === 0 ? 0 : inIm[k]!;
      const yr = inRe[m - k]!;
      const yi = k === 0 ? 0 : -inIm[m - k]!;
      // E = (X[k] + X[k+m])/2, O = (X[k] − X[k+m])·conj(W^k)/2, c = E + i·O.
      const er = 0.5 * (xr + yr);
      const ei = 0.5 * (xi + yi);
      const dr = 0.5 * (xr - yr);
      const di = 0.5 * (xi - yi);
      const wr = this.wr[k]!;
      const wi = -this.wi[k]!;
      const or = dr * wr - di * wi;
      const oi = dr * wi + di * wr;
      re[k] = er - oi;
      im[k] = ei + or;
    }
    this.fft.transform(re, im, 1);
    // z/m = x[2i] + i·x[2i+1]; unscaled N·x = 2·z.
    for (let i = 0; i < m; i += 1) {
      y[2 * i] = Math.fround(2 * re[i]!) * scale;
      y[2 * i + 1] = Math.fround(2 * im[i]!) * scale;
    }
  }
}
