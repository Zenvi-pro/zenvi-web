/**
 * AnalogTape, ported from libopenshot 1.0 src/effects/AnalogTape.cpp:48-393
 * (hashes and box blur at AnalogTape.h:44-96).
 *
 * BT.601 YUV with horizontally halved chroma: luma blur, chroma bleed (shift
 * + box blur + desaturation), hashed dropout streaks, grain, a bottom
 * tracking stripe, static bursts, and a per-row tracking wobble.
 *
 * Desktop quirk kept on purpose (it defines how existing projects look): the
 * C++ reads each RGBA8888 pixel as a little-endian uint32 and takes
 * `(p >> 16) & 0xff` as "red", so its red is the blue byte and its blue the
 * red byte (luma = .299 B + .587 G + .114 R). It writes back the same way,
 * keeps alpha and never un-premultiplies.
 *
 * Every float step follows the arm64 build (`scratchpad/disfn.sh
 * 10AnalogTape8GetFrame`, all OpenMP-outlined loops): `f32(a*b + c)` where
 * clang fused a multiply-add (the float product is exact in double), plain
 * rounding elsewhere, and exact double FMAs (`fma`) for the three fused
 * double expressions (burst probability, hum argument, wobble phase).
 */

import type { PremulImage } from "../pixels.js";
import { fma, fmaf } from "../qt/fma.js";
import type { KernelContext } from "../types.js";
import { int, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;

// ---------------------------------------------------------------------------
// Hashes (AnalogTape.h:44-78)
// ---------------------------------------------------------------------------

const FNV_PRIME = 16777619;

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

/** `fnv1a_32(std::string)` over the UTF-8 bytes. */
export function fnv1aString(text: string): number {
  let h = 2166136261;
  for (const byte of utf8(text)) h = Math.imul(h ^ byte, FNV_PRIME) >>> 0;
  return h;
}

/** `fnv1a_32(h, d)`: FNV-1a over the four little-endian bytes of d. */
function fnv1aWord(h: number, d: number): number {
  h = Math.imul(h ^ (d & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((d >>> 8) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((d >>> 16) & 0xff), FNV_PRIME);
  return Math.imul(h ^ (d >>> 24), FNV_PRIME) >>> 0;
}

/** `hash01`: `h / 4294967295.0f`, and that float constant is exactly 2^32. */
function hash01(seed: number, a: number, b: number, c: number): number {
  return f32(fnv1aWord(fnv1aWord(fnv1aWord(seed, a), b), c)) / 4294967296;
}

/** `row_density(seed, frame, y)`: `m = fma(1 - a, h0, a*h1)`, squared. */
function rowDensity(seed: number, frame: number, y: number): number {
  const tc = frame >> 3;
  const y0 = y >> 3;
  const a = (y & 7) / 8;
  const h0 = hash01(seed, tc, y0, 31);
  const h1 = hash01(seed, tc, y0 + 1, 31);
  const m = fmaf(1 - a, h0, f32(a * h1));
  return f32(m * m);
}

/** xorshift32 `step` (AnalogTape.cpp:286-291). */
function xorshift(s: number): number {
  s = (s ^ (s << 13)) >>> 0;
  s = (s ^ (s >>> 17)) >>> 0;
  return (s ^ (s << 5)) >>> 0;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** `box_blur_row` (AnalogTape.h:79-96): clamped running sum, `sum += add - sub`. */
function boxBlurRows(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const win = 2 * r + 1;
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum = f32(sum + src[o + Math.min(Math.max(k, 0), w - 1)]!);
    dst[o] = f32(sum / win);
    for (let x = 1; x < w; x += 1) {
      const add = Math.min(w - 1, x + r);
      const sub = Math.max(0, x - r - 1);
      sum = f32(sum + f32(src[o + add]! - src[o + sub]!));
      dst[o + x] = f32(sum / win);
    }
  }
}

/**
 * `remap_line` (AnalogTape.cpp:331-356): linear resample of each row at
 * `x + dx[y]*scale`, edge pixels outside. Like the C++, the right neighbour
 * of the last sample is read from the flat buffer (it has weight 0 there).
 */
function remapRows(src: Float32Array, dst: Float32Array, width: number, h: number, dx: Float32Array, scale: number): void {
  for (let y = 0; y < h; y += 1) {
    const off = f32(dx[y]! * scale);
    const o = y * width;
    const start = Math.max(0, Math.ceil(-off));
    const end = Math.min(width, Math.floor(f32(width - off)));
    let xs = f32(start + off);
    let x0 = Math.trunc(xs);
    let t = f32(xs - x0);
    for (let x = start; x < end; x += 1) {
      const s1 = src[o + x0 + 1] ?? 0;
      dst[o + x] = fmaf(src[o + x0]!, f32(1 - t), f32(s1 * t));
      xs = f32(xs + 1);
      x0 = Math.trunc(xs);
      t = f32(xs - x0);
    }
    for (let x = 0; x < Math.min(start, width); x += 1) dst[o + x] = src[o]!;
    for (let x = Math.max(end, 0); x < width; x += 1) dst[o + x] = src[o + width - 1]!;
  }
}

// ---------------------------------------------------------------------------
// Constants (float literals as the build stores them)
// ---------------------------------------------------------------------------

const BYTE_MAX = 255;
const Y_R = f32(0.299);
const Y_G = f32(0.587);
const Y_B = f32(0.114);
const U_R = f32(-0.14713);
const U_G = f32(-0.28886);
const U_B = f32(0.436);
const V_R = f32(0.615);
const V_G = f32(-0.51499);
const V_B = f32(-0.10001);
const R_V = f32(1.13983);
const G_U = f32(-0.39465);
const G_V = f32(-0.5806);
const B_U = f32(2.03211);
const PI_F = f32(Math.PI);
const TWO_PI_F = f32(2 * PI_F);
/** `2 * PI * 0.0035f`, folded in float. */
const WOBBLE_K = f32(TWO_PI_F * f32(0.0035));
/** Compile-time `b - a` spans of `lerp(a, b, t) = a + (b - a)*t`, folded in float. */
const SPAN_TRACK_F = f32(f32(1.2) - 0.25);
const SPAN_BURST_G = f32(0.25 - f32(0.1));
const SPAN_SAT_BAND = f32(0.5 - f32(0.8));
const ONE_OVER_24BIT = 16777215;

/** The effect's frame rate: timeline fps, else the clip reader's, else 1/1 (AnalogTape.cpp:110-120). */
function effectFps(ctx: KernelContext): number {
  if (ctx.fps) return ctx.fps.num / ctx.fps.den;
  if (ctx.clip && ctx.clip.readerFps > 0) return ctx.clip.readerFps;
  return 1;
}

export const analogTape: KernelSpec = {
  type: "AnalogTape",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): void {
    const w = image.width;
    const h = image.height;
    if (w <= 0 || h <= 0) return;
    const Uw = (w + 1) >> 1;
    const px = image.data;
    let Y = new Float32Array(w * h);
    let U = new Float32Array(Uw * h);
    let V = new Float32Array(Uw * h);
    let tmpY = new Float32Array(w * h);
    let tmpU = new Float32Array(Uw * h);
    let tmpV = new Float32Array(Uw * h);

    // RGB → YUV, chroma averaged over pixel pairs (:73-108). "r" is byte 2.
    for (let y = 0; y < h; y += 1) {
      for (let x2 = 0; x2 < Uw; x2 += 1) {
        const x0 = x2 * 2;
        const i0 = (y * w + x0) * 4;
        const r0 = f32(px[i0 + 2]! / BYTE_MAX);
        const g0 = f32(px[i0 + 1]! / BYTE_MAX);
        const b0 = f32(px[i0]! / BYTE_MAX);
        Y[y * w + x0] = fmaf(b0, Y_B, fmaf(r0, Y_R, f32(g0 * Y_G)));
        let u = fmaf(b0, U_B, fmaf(r0, U_R, f32(g0 * U_G)));
        let v = fmaf(b0, V_B, fmaf(r0, V_R, f32(g0 * V_G)));
        if (x0 + 1 < w) {
          const i1 = i0 + 4;
          const r1 = f32(px[i1 + 2]! / BYTE_MAX);
          const g1 = f32(px[i1 + 1]! / BYTE_MAX);
          const b1 = f32(px[i1]! / BYTE_MAX);
          Y[y * w + x0 + 1] = fmaf(b1, Y_B, fmaf(r1, Y_R, f32(g1 * Y_G)));
          u = f32(f32(u + fmaf(b1, U_B, fmaf(r1, U_R, f32(g1 * U_G)))) * 0.5);
          v = f32(f32(v + fmaf(b1, V_B, fmaf(r1, V_R, f32(g1 * V_G)))) * 0.5);
        }
        U[y * Uw + x2] = u;
        V[y * Uw + x2] = v;
      }
    }

    const fpsD = effectFps(ctx);
    let refW = w;
    let refH = h;
    const tw = Math.trunc(ctx.timelineWidth ?? ctx.canvasWidth);
    const th = Math.trunc(ctx.timelineHeight ?? ctx.canvasHeight);
    if (tw > 0 && th > 0) {
      refW = tw;
      refH = th;
    }
    const refSx = f32(refW / w);
    const refSy = f32(refH / h);
    const invSx = refSx > 0 ? f32(1 / refSx) : 1;
    const frame = ctx.frame;
    const t = fpsD > 0 ? frame / fpsD : frame;

    const kTrack = f32(num(params, "tracking", 0.55));
    const kBleed = f32(num(params, "bleed", 0.65));
    const kSoft = f32(num(params, "softness", 0.4));
    const kNoise = f32(num(params, "noise", 0.5));
    const kStripe = f32(num(params, "stripe", 0.25));
    const kBands = f32(num(params, "static_bands", 0.2));
    const seedOffset = int(params, "seed_offset", 0);

    // Luma blur (:140-150).
    let rY = roundHalfAwayInt(f32(invSx * f32(2 * kSoft)));
    if (kNoise > f32(0.6)) rY = Math.min(rY, 1);
    if (rY > 0) {
      boxBlurRows(Y, tmpY, w, h, rY);
      [Y, tmpY] = [tmpY, Y];
    }

    // Chroma bleed: shift right by shift/2, then box blur (:152-189).
    const shift = f32(invSx * f32(2.5 * kBleed));
    const rC = roundHalfAwayInt(f32(invSx * f32(3 * kBleed)));
    const sat = fmaf(kBleed, f32(-0.3), 1);
    const shiftH = f32(shift * 0.5);
    for (let y = 0; y < h; y += 1) {
      const o = y * Uw;
      for (let x = 0; x < Uw; x += 1) {
        const raw = f32(x - shiftH);
        const xs = raw < 0 ? 0 : raw > Uw - 1 ? Uw - 1 : raw;
        const x0 = Math.trunc(xs);
        const x1 = Math.min(x0 + 1, Uw - 1);
        const tt = f32(xs - x0);
        const it = f32(1 - tt);
        tmpU[o + x] = fmaf(U[o + x0]!, it, f32(U[o + x1]! * tt));
        tmpV[o + x] = fmaf(V[o + x0]!, it, f32(V[o + x1]! * tt));
      }
    }
    [U, tmpU] = [tmpU, U];
    [V, tmpV] = [tmpV, V];
    if (rC > 0) {
      boxBlurRows(U, tmpU, Uw, h, rC);
      [U, tmpU] = [tmpU, U];
      boxBlurRows(V, tmpV, Uw, h, rC);
      [V, tmpV] = [tmpV, V];
    }

    // Seeds (:191-195).
    const SEED = (fnv1aString(ctx.effectId ?? "") ^ (seedOffset >>> 0)) >>> 0;
    const schedSalt = (toU32(f32(kBands * 64)) ^ (toU32(f32(kStripe * 64)) << 8) ^ (toU32(f32(kNoise * 64)) << 16)) >>> 0;
    const SCHED_SEED = (SEED ^ fnv1aWord(schedSalt, 0x9e3779b9)) >>> 0;

    // Constants (:198-212).
    const fh = h;
    const sigmaY = f32(kNoise * f32(0.08));
    const decay = fmaf(kNoise, f32(0.08), f32(0.88));
    const amp = f32(kNoise * f32(0.18));
    const baseP = fmaf(kNoise, f32(0.02), f32(0.0025));
    const Hfixed = fmaf(f32(fh * f32(0.12)), kStripe, 0);
    const Gfixed = f32(kStripe * f32(0.1));
    const Nfixed = fmaf(kStripe, 1.5, 1);
    const rate = f32(kBands * f32(0.4));
    const durFrames = roundHalfAwayInt(fmaf(kBands, 5, 1));
    const h06 = f32(fh * f32(0.06));
    const Hburst = fmaf(f32(f32(fh * 0.25) - h06), kBands, h06);
    const Gburst = fmaf(kBands, SPAN_BURST_G, f32(0.1));
    const satBand = fmaf(kBands, SPAN_SAT_BAND, f32(0.8));
    const Nburst = fmaf(kBands, 2, 1);

    // Static bursts (:214-241).
    const bands: { center: number; t0: number }[] = [];
    if (kBands > 0 && rate > 0) {
      const winIdx = Math.trunc(t * 4);
      const lambda = rate * 0.25 * (f32(rowDensity(SCHED_SEED, frame | 0, 0) * 1.5) + 0.25);
      const ex = Math.exp(-lambda);
      const probGe1 = 1 - ex;
      const probGe2 = fma(-lambda, ex, probGe1);
      const spawn = (kseed: number): void => {
        const start = f32(hash01(SCHED_SEED, winIdx >>> 0, 11 + kseed, 0) * 0.25);
        const center = fmaf(hash01(SCHED_SEED, winIdx >>> 0, 12 + kseed, 0), f32(fh - Hburst), f32(Hburst * 0.5));
        const t0 = winIdx * 0.25 + start;
        const t1 = t0 + durFrames / (fpsD > 0 ? fpsD : 1);
        if (t >= t0 && t < t1) bands.push({ center, t0 });
      };
      const r = hash01(SCHED_SEED, winIdx >>> 0, 9, 0);
      if (r < probGe1) spawn(0);
      if (r < probGe2) spawn(1);
    }

    // Grain time base (:243-245).
    const kf = Math.floor(t * 2);
    const a = f32(t * 2 - kf);
    const oneMinusA = f32(1 - a);

    // Per-row noise, dropouts, stripe and bursts (:250-315).
    const frameU = frame >>> 0;
    const hashFrame = fnv1aWord(SEED, frameU);
    const sixOverRefH = f32(6 / refH);
    const humScale = f32(kNoise * f32(0.008));
    const p07 = f32(0.7);
    const hMinusHfixed = f32(fh - Hfixed);
    const maxHfixed = Hfixed > 1 ? Hfixed : 1;
    const halfH = f32(Hburst * 0.5);
    const durMinus1 = durFrames - 1;
    for (let y = 0; y < h; y += 1) {
      const yRef = roundHalfAwayInt(f32(y * refSy));
      const bandF = !(Hfixed > 0) || hMinusHfixed > y ? 0 : f32(f32(y - hMinusHfixed) / maxHfixed);
      let burstF = 0;
      for (const b of bands) {
        const profile = Math.max(0, f32(1 - f32(Math.abs(f32(y - b.center)) / halfH)));
        const life = f32((t - b.t0) * fpsD);
        const env = life < 1 ? life : life < durMinus1 ? 1 : Math.max(0, f32(durFrames - life));
        const pe = f32(profile * env);
        if (burstF < pe) burstF = pe;
      }
      // fmsub: 1 - (1 - sat_band) * burstF, rounded once.
      const satRow = fmaf(-f32(1 - satBand), burstF, 1);
      if (burstF > 0 && satRow !== 1) {
        const o = y * Uw;
        for (let xh = 0; xh < Uw; xh += 1) {
          U[o + xh] = f32(satRow * U[o + xh]!);
          V[o + xh] = f32(satRow * V[o + xh]!);
        }
      }
      const rowBias = rowDensity(SEED, frame | 0, yRef);
      let p = f32(baseP * fmaf(rowBias, 1.5, 0.25));
      p = f32(fmaf(burstF, 2, fmaf(bandF, 1.5, 1)) * p);
      const humArg = fma(t, f32(0.08), f32(f32(yRef) * sixOverRefH)) * TWO_PI_F;
      const hum = f32(Math.sin(humArg) * humScale);
      const yRefU = yRef >>> 0;
      const yMul = Math.imul(0x85eb, yRefU);
      let s0 = (SEED ^ Math.imul(0x9e37, kf) ^ yMul) >>> 0;
      let s1 = (SEED ^ Math.imul(0x9e37, kf + 1) ^ yMul ^ 0x1234567) >>> 0;
      const lift = fmaf(Gfixed, bandF, f32(burstF * Gburst));
      const rowSigma = f32(sigmaY * fmaf(f32(Nburst - 1), burstF, fmaf(f32(Nfixed - 1), bandF, 1)));
      const hashRow = fnv1aWord(hashFrame, yRefU);
      const k = fmaf(hash01Tail(hashRow, 777), f32(0.35), f32(0.15));
      const pR = f32(p * p07);
      let sL = 0;
      let sR = 0;
      const o = y * w;
      for (let x = 0; x < w; x += 1) {
        const xRef = roundHalfAwayInt(f32(x * refSx));
        if (hash01Tail(hashRow, xRef >>> 0) < p) sL = 1;
        if (hash01Tail(hashRow, (refW - 1 - xRef) >>> 0) < pR) sR = 1;
        s0 = xorshift(s0);
        s1 = xorshift(s1);
        const n0 = f32((s0 & 0xffffff) / ONE_OVER_24BIT);
        const n1 = f32((s1 & 0xffffff) / ONE_OVER_24BIT);
        const n = fmaf(n0, oneMinusA, f32(n1 * a));
        const yv = Y[o + x]!;
        const mtRaw = f32(f32(yv - f32(0.2)) / f32(0.6));
        const mtTerm = mtRaw < 0 ? f32(0.6) : fmaf(mtRaw > 1 ? 1 : mtRaw, f32(0.4), f32(0.6));
        const val = f32(fmaf(f32(rowSigma * fmaf(n, 2, -1)), mtTerm, f32(yv + lift)) + hum);
        const streak = f32(amp * f32(sL + sR));
        const newY = fmaf(streak, f32(k + f32(1 - val)), val);
        Y[o + x] = newY > 1 ? 1 : newY < 0 ? 0 : newY;
        sL = f32(sL * decay);
        sR = f32(sR * decay);
      }
    }

    // Tracking wobble (:317-329).
    const A = f32(invSx * f32(3 * kTrack));
    const fHz = fmaf(kTrack, SPAN_TRACK_F, 0.25);
    const Hsk = fmaf(f32(fh * f32(0.1)), kTrack, 0);
    const S = f32(invSx * f32(5 * kTrack));
    const seedTerm = f32(f32(f32(SEED) * f32(0.001)) * f32(0.7));
    const phase = f32(fma(t * fHz, TWO_PI_F, seedTerm));
    const hMinusHsk = f32(fh - Hsk);
    const maxHsk = Hsk > 1 ? Hsk : 1;
    const dx = new Float32Array(h);
    for (let y = 0; y < h; y += 1) {
      const yRef = f32(refSy * y);
      const base = f32(A * f32(Math.sin(fmaf(yRef, WOBBLE_K, phase))));
      const skew = hMinusHsk > y ? 0 : f32(S * f32(f32(y - hMinusHsk) / maxHsk));
      dx[y] = f32(base + skew);
    }

    remapRows(Y, tmpY, w, h, dx, 1);
    [Y, tmpY] = [tmpY, Y];
    remapRows(U, tmpU, Uw, h, dx, 0.5);
    [U, tmpU] = [tmpU, U];
    remapRows(V, tmpV, Uw, h, dx, 0.5);
    [V, tmpV] = [tmpV, V];

    // YUV → bytes 2, 1, 0 (:368-390).
    for (let y = 0; y < h; y += 1) {
      const yo = y * w;
      const co = y * Uw;
      for (let x = 0; x < w; x += 1) {
        const xs = x * 0.5;
        const x0 = Math.trunc(xs);
        const x1 = Math.min(x0 + 1, Uw - 1);
        const tt = xs - x0;
        const it = 1 - tt;
        const u = f32(sat * fmaf(U[co + x0]!, it, f32(tt * U[co + x1]!)));
        const v = f32(sat * fmaf(V[co + x0]!, it, f32(tt * V[co + x1]!)));
        const yv = Y[yo + x]!;
        const r = fmaf(v, R_V, yv);
        const g = fmaf(v, G_V, fmaf(u, G_U, yv));
        const b = fmaf(u, B_U, yv);
        const i = (yo + x) * 4;
        px[i + 2] = toByte(r);
        px[i + 1] = toByte(g);
        px[i] = toByte(b);
      }
    }
  },
};

/** `int(std::clamp(v, 0.0f, 1.0f) * 255.0f)`. */
function toByte(v: number): number {
  if (v < 0) return 0;
  return Math.trunc(f32((v > 1 ? 1 : v) * 255));
}

/** `fcvtas`: round half away from zero to int. */
function roundHalfAwayInt(v: number): number {
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}

/** `(uint32_t)float` (arm64 fcvtzu: truncation, negatives saturate to 0). */
function toU32(v: number): number {
  if (!(v > 0)) return 0;
  return v >= 4294967296 ? 0xffffffff : Math.trunc(v) >>> 0;
}

/** `hash01(seed, frame, y_ref, c)` with the first two words already hashed into `h`. */
function hash01Tail(h: number, c: number): number {
  return f32(fnv1aWord(h, c)) / 4294967296;
}
