/**
 * Spherical Projection, ported from libopenshot
 * src/effects/SphericalProjection.cpp:50-420. Every output pixel casts a ray
 * (rectilinear view for Sphere/Hemisphere, or one of four fisheye lenses),
 * rotates it by yaw and pitch (roll is applied in screen space), and looks it
 * up in an equirectangular or fisheye source. Lookups are cached as a float32
 * UV map that is rebuilt only when the size, a mode or an angle changes, with
 * angles compared as `llround(angle * 1e6)` (:114-123). The map persists in
 * `ctx.state` across frames, so sub-microradian angle changes reuse it like
 * the desktop does. Sampling is nearest, bilinear, Catmull-Rom bicubic, or
 * Auto (mipmaps / bilinear / bicubic by the coverage ratio, :237-250).
 *
 * Precision: the desktop first converts the frame to straight ARGB32 through
 * Qt's arm64 NEON un-premultiply (approximate reciprocal; the last `W % 4`
 * pixels of a row take the exact C path). The port reproduces it exactly
 * (`unpremultiplyNeon`). The UV map is double math in the C++ evaluation
 * order. Clang's fused multiply-adds there are evaluated unfused, and V8's
 * `Math.sin`/`atan2`/... can differ from Apple's libm by 1 ulp. Both are
 * absorbed by the float32 store except in about 4e-9 of the values. Sampling
 * is exact: plain double math, recomputed with the fused operations
 * (`fmaExact`) whenever a value lands within 1e-7 of a rounding boundary.
 *
 * Divergence (docs/PARITY.md): libopenshot leaves the frame as straight-alpha
 * ARGB32 (SphericalProjection.cpp:66-67, 370), so later effects and mask
 * blends read the bytes as premultiplied RGBA. This port returns
 * premultiplied RGBA: qPremultiply of the straight result, which is what
 * compositing the ARGB32 frame produces.
 */

import { roundHalfAway } from "../../model/rounding.js";
import { byteMul, createPremul, type PremulImage } from "../pixels.js";
import type { KernelContext } from "../types.js";
import { unpremultiplyNeon } from "../qt/convert.js";
import { fmaExact } from "./lens-flare.js";
import { int, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Parameters and the UV map
// ---------------------------------------------------------------------------

interface Setup {
  w: number;
  h: number;
  yaw: number;
  pitch: number;
  roll: number;
  inFov: number;
  outFov: number;
  projectionMode: number;
  invert: number;
  inputModel: number;
  interpolation: number;
}

/** A cached UV map and the inputs it was built for (`uv_map`, `cached_*`). */
interface UvMap {
  setup: Setup;
  uv: Float32Array;
}

const STATE_KEY = "SphericalProjection.uv";

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : hi < v ? hi : v;
}

/** Angles in radians (:78-89) and the enum properties clamped like SetJsonValue (:478-484). */
function readSetup(w: number, h: number, params: Params): Setup {
  const inputModel = clampInt(int(params, "input_model", 0), 0, 4);
  const invert = clampInt(int(params, "invert", 0), 0, 1);
  let yaw = -num(params, "yaw", 0) * DEG;
  if (inputModel === 0 && invert === 1) yaw += Math.PI;
  return {
    w,
    h,
    yaw,
    pitch: num(params, "pitch", 0) * DEG,
    roll: -num(params, "roll", 0) * DEG,
    inFov: num(params, "in_fov", 180) * DEG,
    outFov: num(params, "fov", 90) * DEG,
    projectionMode: clampInt(int(params, "projection_mode", 0), 0, 5),
    invert,
    inputModel,
    interpolation: clampInt(int(params, "interpolation", 3), 0, 3),
  };
}

/** The recompute test (:114-123): `llround(angle * 1e6)` per angle, exact sizes and modes. */
function sameMap(a: Setup, b: Setup): boolean {
  const q = (x: number): number => roundHalfAway(x * 1e6);
  return (
    a.w === b.w &&
    a.h === b.h &&
    q(a.yaw) === q(b.yaw) &&
    q(a.pitch) === q(b.pitch) &&
    q(a.roll) === q(b.roll) &&
    q(a.inFov) === q(b.inFov) &&
    q(a.outFov) === q(b.outFov) &&
    a.inputModel === b.inputModel &&
    a.projectionMode === b.projectionMode &&
    a.invert === b.invert
  );
}

/** Constants of `project_input` that the compiler hoists out of the pixel loop. */
interface InputLens {
  az: number;
  tmax: number;
  sinHalfTmax: number;
  tanHalfTmax: number;
  sinTmax: number;
  radius: number;
}

/** `project_input` (:374-420); writes (uf, vf) into `uv` at `o`. */
function projectInput(s: Setup, lens: InputLens, dx: number, dy: number, dz: number, uv: Float32Array, o: number): void {
  if (s.inputModel === 0) {
    let lon = Math.atan2(dx, -dz);
    const lat = Math.asin(clamp(dy, -1, 1));
    const hemi = s.projectionMode === 1;
    if (hemi) lon = clamp(lon, -HALF_PI, HALF_PI);
    uv[o] = ((lon + (hemi ? HALF_PI : Math.PI)) / (hemi ? Math.PI : TWO_PI)) * s.w;
    uv[o + 1] = ((HALF_PI - lat) / Math.PI) * s.h;
    return;
  }
  const theta = Math.acos(clamp(dz * lens.az, -1, 1));
  let rNorm: number;
  if (s.inputModel === 2) rNorm = Math.sin(theta * 0.5) / lens.sinHalfTmax;
  else if (s.inputModel === 3) rNorm = Math.tan(theta * 0.5) / lens.tanHalfTmax;
  else if (s.inputModel === 4) rNorm = Math.sin(theta) / lens.sinTmax;
  else rNorm = theta / lens.tmax;
  const phi = Math.atan2(dy, dx);
  const rpx = rNorm * lens.radius;
  uv[o] = s.w * 0.5 + rpx * Math.cos(phi);
  uv[o + 1] = s.h * 0.5 - rpx * Math.sin(phi);
}

/** Build the UV map (:125-235). */
function buildUvMap(s: Setup): Float32Array {
  const { w: W, h: H } = s;
  const uv = new Float32Array(W * H * 2);
  const sy = Math.sin(s.yaw);
  const cy = Math.cos(s.yaw);
  const sp = Math.sin(s.pitch);
  const cp = Math.cos(s.pitch);
  const r00 = cy;
  const r01 = sy * sp;
  const r02 = sy * cp;
  const r11 = cp;
  const r12 = -sp;
  const r20 = -sy;
  const r21 = cy * sp;
  const r22 = cy * cp;
  const rollSign = r22 >= 0 ? 1 : -1;
  const hx = Math.tan(s.outFov * 0.5);
  const vy = (hx * H) / W;
  const cR = Math.cos(s.roll);
  const sR = Math.sin(s.roll) * rollSign;
  const tmax = Math.max(1e-6, s.inFov * 0.5);
  const lens: InputLens = {
    az: s.invert === 1 ? 1 : -1,
    tmax,
    sinHalfTmax: Math.max(1e-12, Math.sin(tmax * 0.5)),
    tanHalfTmax: Math.max(1e-12, Math.tan(tmax * 0.5)),
    sinTmax: Math.max(1e-12, Math.sin(tmax)),
    radius: 0.5 * Math.min(W, H),
  };
  const fisheye = s.projectionMode >= 2;
  const thetaMax = s.outFov * 0.5;
  const sinHalfThetaMax = Math.sin(thetaMax * 0.5);
  const tanHalfThetaMax = Math.tan(thetaMax * 0.5);
  const sinThetaMax = Math.sin(thetaMax);
  const R = 0.5 * Math.min(W, H);

  for (let yy = 0; yy < H; yy += 1) {
    if (!fisheye) {
      // Rectilinear: sy_up = -ndc_y, rotated by roll in screen space, then normalized.
      const syUp = -(((2 * (yy + 0.5)) / H - 1) * vy);
      const sRsy = sR * syUp;
      const cRsy = cR * syUp;
      for (let xx = 0; xx < W; xx += 1) {
        const sx = ((2 * (xx + 0.5)) / W - 1) * hx;
        const rx = cR * sx + sRsy;
        const ry = -sR * sx + cRsy;
        const invLen = 1 / Math.sqrt(rx * rx + ry * ry + 1);
        const vx = rx * invLen;
        const vy2 = ry * invLen;
        const dx = r00 * vx + r01 * vy2 - r02 * invLen;
        const dy = r11 * vy2 - r12 * invLen;
        const dz = r20 * vx + r21 * vy2 - r22 * invLen;
        projectInput(s, lens, dx, dy, dz, uv, 2 * (yy * W + xx));
      }
      continue;
    }
    const ryUpNum = H * 0.5 - (yy + 0.5);
    for (let xx = 0; xx < W; xx += 1) {
      const o = 2 * (yy * W + xx);
      const rx = (xx + 0.5 - W * 0.5) / R;
      const ryUp = ryUpNum / R;
      const rxr = cR * rx + sR * ryUp;
      const ryr = -sR * rx + cR * ryUp;
      const rNorm = Math.sqrt(rxr * rxr + ryr * ryr);
      if (!(rNorm <= 1)) {
        uv[o] = -1;
        uv[o + 1] = -1;
        continue;
      }
      let theta: number;
      if (s.projectionMode === 3) theta = 2 * Math.asin(clamp(rNorm * sinHalfThetaMax, -1, 1));
      else if (s.projectionMode === 4) theta = 2 * Math.atan(rNorm * tanHalfThetaMax);
      else if (s.projectionMode === 5) theta = Math.asin(clamp(rNorm * sinThetaMax, -1, 1));
      else theta = rNorm * thetaMax;
      const phi = Math.atan2(ryr, rxr);
      const st = Math.sin(theta);
      const ct = Math.cos(theta);
      const vx = st * Math.cos(phi);
      const vy2 = st * Math.sin(phi);
      const dx = r00 * vx + r01 * vy2 - r02 * ct;
      const dy = r11 * vy2 - r12 * ct;
      const dz = r20 * vx + r21 * vy2 - r22 * ct;
      projectInput(s, lens, dx, dy, dz, uv, o);
    }
  }
  return uv;
}

// ---------------------------------------------------------------------------
// Sampling (:278-368)
// ---------------------------------------------------------------------------

/** Distance from a `+0.5`-and-truncate boundary below which a sample is recomputed with fused math. */
const NEAR_BOUNDARY = 1e-7;

function nearHalf(v: number): boolean {
  return Math.abs(v - Math.floor(v) - 0.5) <= NEAR_BOUNDARY;
}

/** `uchar(v0 * (1 - dyr) + v1 * dyr + 0.5)` with the arm64 contraction. */
function bilinearByte(p00: number, p10: number, p01: number, p11: number, dxr: number, dyr: number): number {
  const ix = 1 - dxr;
  const iy = 1 - dyr;
  const v = (p00 * ix + p10 * dxr) * iy + (p01 * ix + p11 * dxr) * dyr;
  if (!nearHalf(v)) return Math.trunc(v + 0.5);
  const v0 = fmaExact(p00, ix, p10 * dxr);
  const v1 = fmaExact(p01, ix, p11 * dxr);
  return Math.trunc(fmaExact(v0, iy, v1 * dyr) + 0.5);
}

/** `cubic_interp` (:51-59), plain double math. */
function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const a1 = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
  const a2 = -0.5 * p0 + 0.5 * p2;
  return ((a0 * t + a1) * t + a2) * t + p1;
}

/** `cubic_interp` as the arm64 build evaluates it (every `a*b + c` fused). */
function cubicFused(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a0 = fmaExact(p3, 0.5, fmaExact(p2, -1.5, fmaExact(p0, -0.5, p1 * 1.5)));
  const a1 = fmaExact(p3, -0.5, fmaExact(p2, 2, fmaExact(p1, -2.5, p0)));
  const a2 = fmaExact(p0, -0.5, p2 * 0.5);
  return fmaExact(fmaExact(fmaExact(a0, t, a1), t, a2), t, p1);
}

interface Plane {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** Byte offsets of the clamp-to-edge 4×4 neighborhood: 4 row starts, then 4 column offsets. */
const TAPS = new Int32Array(8);

function setTaps(W: number, H: number, x1: number, y1: number): void {
  for (let k = 0; k < 4; k += 1) {
    TAPS[k] = clampInt(y1 + k - 1, 0, H - 1) * W * 4;
    TAPS[4 + k] = clampInt(x1 + k - 1, 0, W - 1) * 4;
  }
}

/** The 4×4 Catmull-Rom of channel `c` at the taps in `TAPS` (:318-335), plain double math. */
function bicubicValue(data: Uint8ClampedArray, c: number, tx: number, ty: number): number {
  const x0 = TAPS[4]! + c;
  const x1 = TAPS[5]! + c;
  const x2 = TAPS[6]! + c;
  const x3 = TAPS[7]! + c;
  let y = TAPS[0]!;
  const c0 = cubic(data[y + x0]!, data[y + x1]!, data[y + x2]!, data[y + x3]!, tx);
  y = TAPS[1]!;
  const c1 = cubic(data[y + x0]!, data[y + x1]!, data[y + x2]!, data[y + x3]!, tx);
  y = TAPS[2]!;
  const c2 = cubic(data[y + x0]!, data[y + x1]!, data[y + x2]!, data[y + x3]!, tx);
  y = TAPS[3]!;
  const c3 = cubic(data[y + x0]!, data[y + x1]!, data[y + x2]!, data[y + x3]!, tx);
  return cubic(c0, c1, c2, c3, ty);
}

/** `bicubicValue` with every `a*b + c` fused, for values next to a rounding boundary. */
function bicubicValueFused(data: Uint8ClampedArray, c: number, tx: number, ty: number): number {
  const col = [0, 0, 0, 0];
  for (let k = 0; k < 4; k += 1) {
    const y = TAPS[k]!;
    col[k] = cubicFused(data[y + TAPS[4]! + c]!, data[y + TAPS[5]! + c]!, data[y + TAPS[6]! + c]!, data[y + TAPS[7]! + c]!, tx);
  }
  return cubicFused(col[0]!, col[1]!, col[2]!, col[3]!, ty);
}

/** Mip levels for the Auto path (:252-276): up to three 2×2 truncating box reductions. */
function buildMipmaps(base: Plane): Plane[] {
  const levels = [base];
  for (let level = 1; level < 4; level += 1) {
    const prev = levels[level - 1]!;
    if (prev.w <= 1 || prev.h <= 1) break;
    const w = Math.trunc(prev.w / 2);
    const h = Math.trunc(prev.h / 2);
    const data = new Uint8ClampedArray(w * h * 4);
    const p = prev.data;
    const pw = prev.w * 4;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = 2 * y * pw + 2 * x * 4;
        for (let c = 0; c < 4; c += 1) data[(y * w + x) * 4 + c] = (p[o + c]! + p[o + 4 + c]! + p[o + pw + c]! + p[o + pw + 4 + c]!) >> 2;
      }
    }
    levels.push({ w, h, data });
  }
  return levels;
}

/** Bilinear sample of all four channels of `plane` at (uf, vf) into `out` at `o` (:304-317, :350-366). */
function bilinearPixel(plane: Plane, uf: number, vf: number, out: Uint8ClampedArray, o: number): void {
  const { w: W, h: H, data } = plane;
  const x0 = clampInt(Math.floor(uf), 0, W - 1);
  const y0 = clampInt(Math.floor(vf), 0, H - 1);
  const x1 = clampInt(x0 + 1, 0, W - 1);
  const y1 = clampInt(y0 + 1, 0, H - 1);
  const dxr = uf - x0;
  const dyr = vf - y0;
  const i00 = (y0 * W + x0) * 4;
  const i10 = (y0 * W + x1) * 4;
  const i01 = (y1 * W + x0) * 4;
  const i11 = (y1 * W + x1) * 4;
  for (let c = 0; c < 4; c += 1) out[o + c] = bilinearByte(data[i00 + c]!, data[i10 + c]!, data[i01 + c]!, data[i11 + c]!, dxr, dyr);
}

/** SphericalProjection::GetFrame (:62-372). */
function sphericalKernel(image: PremulImage, params: Params, ctx: KernelContext): PremulImage | void {
  const W = image.width;
  const H = image.height;
  if (W <= 0 || H <= 0) return;
  const setup = readSetup(W, H, params);

  const cached = ctx.state?.get(STATE_KEY) as UvMap | undefined;
  let map: UvMap;
  if (cached && sameMap(cached.setup, setup)) {
    map = cached;
  } else {
    map = { setup, uv: buildUvMap(setup) };
    ctx.state?.set(STATE_KEY, map);
  }
  const uv = map.uv;

  let sampler = setup.interpolation;
  if (sampler === 3) {
    const coverage = setup.projectionMode === 0 ? TWO_PI : setup.projectionMode === 1 ? Math.PI : setup.inFov;
    const ratio = W / setup.outFov / (W / coverage);
    sampler = ratio < 0.8 ? 3 : ratio <= 1.2 ? 1 : 2;
  }

  const src: Plane = { w: W, h: H, data: unpremultiplyNeon(image) };
  const mipmaps = sampler === 3 ? buildMipmaps(src) : [src];
  const out = new Uint8ClampedArray(W * H * 4);
  const wrapU = setup.inputModel === 0 && setup.projectionMode === 0;
  const clampUv = setup.inputModel === 0 && setup.projectionMode === 1;

  for (let yy = 0; yy < H; yy += 1) {
    for (let xx = 0; xx < W; xx += 1) {
      const idx = 2 * (yy * W + xx);
      let uf = uv[idx]!;
      let vf = uv[idx + 1]!;
      const o = (yy * W + xx) * 4;
      if (wrapU) {
        uf = (((uf % W) + W) % W);
        vf = clamp(vf, 0, H - 1);
      } else if (clampUv) {
        uf = clamp(uf, 0, W - 1);
        vf = clamp(vf, 0, H - 1);
      } else if (uf < 0 || uf >= W || vf < 0 || vf >= H) {
        continue; // transparent
      }

      if (sampler === 0) {
        const s = (clampInt(Math.floor(vf), 0, H - 1) * W + clampInt(Math.floor(uf), 0, W - 1)) * 4;
        out[o] = src.data[s]!;
        out[o + 1] = src.data[s + 1]!;
        out[o + 2] = src.data[s + 2]!;
        out[o + 3] = src.data[s + 3]!;
      } else if (sampler === 1) {
        bilinearPixel(src, uf, vf, out, o);
      } else if (sampler === 2) {
        const x1 = clampInt(Math.floor(uf), 0, W - 1);
        const y1 = clampInt(Math.floor(vf), 0, H - 1);
        const tx = uf - x1;
        const ty = vf - y1;
        setTaps(W, H, x1, y1);
        for (let c = 0; c < 4; c += 1) {
          let val = bicubicValue(src.data, c, tx, ty);
          if (val > 0 && val < 255 && nearHalf(val)) val = bicubicValueFused(src.data, c, tx, ty);
          out[o + c] = Math.trunc(clamp(val, 0, 255) + 0.5);
        }
      } else {
        // Auto -> mipmaps: level from the UV footprint to the right and below (:337-349).
        let ufDx = 0;
        let vfDx = 0;
        let ufDy = 0;
        let vfDy = 0;
        if (xx + 1 < W) {
          ufDx = uv[idx + 2]! - uf;
          vfDx = uv[idx + 3]! - vf;
        }
        if (yy + 1 < H) {
          ufDy = uv[idx + 2 * W]! - uf;
          vfDy = uv[idx + 2 * W + 1]! - vf;
        }
        const scaleX = Math.sqrt(ufDx * ufDx + vfDx * vfDx);
        const scaleY = Math.sqrt(ufDy * ufDy + vfDy * vfDy);
        const scale = scaleX < scaleY ? scaleY : scaleX;
        const level = scale > 1 ? Math.min(Math.floor(Math.log2(scale)), mipmaps.length - 1) : 0;
        const div = 1 << level;
        bilinearPixel(mipmaps[level]!, uf / div, vf / div, out, o);
      }
    }
  }

  // Straight ARGB32 result -> premultiplied RGBA (what drawing the ARGB32 frame produces).
  const result = createPremul(W, H);
  const r = result.data;
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]!;
    if (a === 0) continue;
    if (a === 255) {
      r[i] = out[i]!;
      r[i + 1] = out[i + 1]!;
      r[i + 2] = out[i + 2]!;
      r[i + 3] = 255;
      continue;
    }
    r[i] = byteMul(out[i]!, a);
    r[i + 1] = byteMul(out[i + 1]!, a);
    r[i + 2] = byteMul(out[i + 2]!, a);
    r[i + 3] = a;
  }
  return result;
}

export const sphericalProjection: KernelSpec = { type: "SphericalProjection", supported: true, run: sphericalKernel };
