import { createRequire as __zenviCreateRequire } from 'node:module';
const require = __zenviCreateRequire(import.meta.url);

// ../render-node/src/render/composite-worker.ts
import { parentPort } from "node:worker_threads";

// ../engine/src/render/pixels.ts
function createPremul(width, height) {
  const w = Math.max(0, Math.trunc(width));
  const h = Math.max(0, Math.trunc(height));
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), premultiplied: true };
}
function clonePremul(image) {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data), premultiplied: true };
}
function fillPremul(image, r, g, b, a) {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  }
}
function copyRect(image, x, y, w, h) {
  const out = createPremul(w, h);
  const rowBytes = w * 4;
  for (let row = 0; row < h; row += 1) {
    const src = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(src, src + rowBytes), row * rowBytes);
  }
  return out;
}
function byteMul(x, a) {
  const t = x * a;
  return t + (t >> 8) + 128 >> 8;
}
function qGray(r, g, b) {
  return r * 11 + g * 16 + b * 5 >> 5;
}
function qRound(x) {
  return Math.floor(x + 0.5);
}
function qFloor(x) {
  return Math.floor(x);
}
function qCeil(x) {
  return Math.ceil(x);
}
function clampU8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
var INV_PREMUL_FACTOR = (() => {
  const t = new Uint32Array(256);
  for (let a = 1; a < 256; a += 1) t[a] = Math.floor(16711935 / a);
  return t;
})();
function unpremulChannel(c, a) {
  if (a === 255) return c;
  if (a === 0) return 0;
  return Math.floor((c * INV_PREMUL_FACTOR[a] + 32768) / 65536);
}
function premultiply(src, out) {
  const target = out ?? createPremul(src.width, src.height);
  if (target.width !== src.width || target.height !== src.height) {
    throw new RangeError("premultiply: size mismatch");
  }
  const s = src.data;
  const d = target.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    if (a === 255) {
      d[i] = s[i];
      d[i + 1] = s[i + 1];
      d[i + 2] = s[i + 2];
      d[i + 3] = 255;
    } else if (a === 0) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    } else {
      d[i] = byteMul(s[i], a);
      d[i + 1] = byteMul(s[i + 1], a);
      d[i + 2] = byteMul(s[i + 2], a);
      d[i + 3] = a;
    }
  }
  return target;
}
function unpremultiply(src, out) {
  const target = out ?? { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data.length) };
  if (target.width !== src.width || target.height !== src.height) {
    throw new RangeError("unpremultiply: size mismatch");
  }
  const s = src.data;
  const d = target.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    if (a === 255) {
      d[i] = s[i];
      d[i + 1] = s[i + 1];
      d[i + 2] = s[i + 2];
      d[i + 3] = 255;
    } else if (a === 0) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    } else {
      const inv = INV_PREMUL_FACTOR[a];
      d[i] = Math.floor((s[i] * inv + 32768) / 65536);
      d[i + 1] = Math.floor((s[i + 1] * inv + 32768) / 65536);
      d[i + 2] = Math.floor((s[i + 2] * inv + 32768) / 65536);
      d[i + 3] = a;
    }
  }
  return target;
}

// ../engine/src/model/fma.ts
var SPLITTER = 134217729;
function productError(a, b, p) {
  let t = SPLITTER * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLITTER * b;
  const bh = t - (t - b);
  const bl = b - bh;
  return ah * bh - p + ah * bl + al * bh + al * bl;
}
var bits = new Float64Array(1);
var words = new Uint32Array(bits.buffer);
var LOW = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1;
var HIGH = 1 - LOW;
function roundToOdd(s, err) {
  if (err === 0 || s === 0) return s;
  bits[0] = s;
  if ((words[LOW] & 1) === 1) return s;
  const awayFromZero = s > 0 === err > 0;
  if (awayFromZero) {
    const low = words[LOW] + 1 >>> 0;
    words[LOW] = low;
    if (low === 0) words[HIGH] = words[HIGH] + 1 >>> 0;
  } else {
    if (words[LOW] === 0) words[HIGH] = words[HIGH] - 1 >>> 0;
    words[LOW] = words[LOW] - 1 >>> 0;
  }
  return bits[0];
}
function fma(a, b, c) {
  const uh = a * b;
  if (!Number.isFinite(uh) || !Number.isFinite(c)) return uh + c;
  const ul = productError(a, b, uh);
  const th = c + uh;
  const bv = th - c;
  const tl = c - (th - bv) + (uh - bv);
  const s = tl + ul;
  const sv = s - tl;
  const err = tl - (s - sv) + (ul - sv);
  return th + roundToOdd(s, err);
}

// ../engine/src/render/qt/fma.ts
var f64 = new Float64Array(1);
var u32 = new Uint32Array(f64.buffer);
var LO = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1;
function isOdd(x) {
  f64[0] = x;
  return (u32[LO] & 1) === 1;
}
function stepAwayFromZero(x) {
  f64[0] = x;
  const lo = u32[LO] + 1;
  if (lo > 4294967295) {
    u32[LO] = 0;
    u32[1 - LO] = u32[1 - LO] + 1;
  } else u32[LO] = lo;
  return f64[0];
}
function stepTowardZero(x) {
  f64[0] = x;
  const lo = u32[LO];
  if (lo === 0) {
    u32[LO] = 4294967295;
    u32[1 - LO] = u32[1 - LO] - 1;
  } else u32[LO] = lo - 1;
  return f64[0];
}
function addRoundToOdd(x, y) {
  const s = x + y;
  const v = s - x;
  const err = x - (s - v) + (y - v);
  if (err === 0 || isOdd(s)) return s;
  return err > 0 === s > 0 ? stepAwayFromZero(s) : stepTowardZero(s);
}
var SAFE_MAX = 2 ** 480;
var SAFE_MIN = 2 ** -480;
function safe(x) {
  const a = Math.abs(x);
  return a === 0 || a < SAFE_MAX && a > SAFE_MIN;
}
function fma2(a, b, c) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return a * b + c;
  if (!safe(a) || !safe(b) || !safe(c) || !safe(a * b)) return fmaExact(a, b, c);
  return fma(a, b, c);
}
function fmaf(a, b, c) {
  const p = a * b;
  if (!Number.isFinite(p) || !Number.isFinite(c)) return Math.fround(p + c);
  return Math.fround(addRoundToOdd(p, c));
}
var VIEW = new DataView(new ArrayBuffer(8));
function decompose(x) {
  VIEW.setFloat64(0, x);
  const bits2 = VIEW.getBigUint64(0);
  const sign = bits2 >> 63n ? -1n : 1n;
  const biased = Number(bits2 >> 52n & 0x7ffn);
  const frac = bits2 & 0xfffffffffffffn;
  if (biased === 0) return { m: sign * frac, e: -1074 };
  return { m: sign * (frac | 0x10000000000000n), e: biased - 1075 };
}
function scale2(x, k) {
  let v = x;
  let n = k;
  while (n > 1e3) {
    v *= 2 ** 1e3;
    n -= 1e3;
  }
  while (n < -1e3) {
    v *= 2 ** -1e3;
    n += 1e3;
  }
  return v * 2 ** n;
}
function roundToDouble(m, e) {
  if (m === 0n) return 0;
  const neg = m < 0n;
  const a = neg ? -m : m;
  const top = e + a.toString(2).length - 1;
  const ulpExp = Math.max(top, -1022) - 52;
  let q = a;
  let qExp = e;
  if (ulpExp > e) {
    const shift2 = BigInt(ulpExp - e);
    q = a >> shift2;
    const rem = a - (q << shift2);
    const half = 1n << shift2 - 1n;
    if (rem > half || rem === half && (q & 1n) === 1n) q += 1n;
    qExp = ulpExp;
  }
  const v = scale2(Number(q), qExp);
  return neg ? -v : v;
}
function fmaExact(a, b, c) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a === 0 || b === 0) return a * b + c;
  const da = decompose(a);
  const db = decompose(b);
  let pm = da.m * db.m;
  let pe = da.e + db.e;
  if (c === 0) return roundToDouble(pm, pe);
  const dc = decompose(c);
  let cm = dc.m;
  if (pe > dc.e) {
    pm <<= BigInt(pe - dc.e);
    pe = dc.e;
  } else {
    cm <<= BigInt(dc.e - pe);
  }
  return roundToDouble(pm + cm, pe);
}

// ../engine/src/render/kernels/params.ts
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function num(params, key, fallback) {
  const v = params[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return fallback;
}
function int(params, key, fallback) {
  return Math.trunc(num(params, key, fallback));
}
function bool(params, key, fallback) {
  const v = params[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "true" || v === "1";
  return fallback;
}
function str(params, key, fallback) {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}
function color(params, key, fallback) {
  const v = params[key];
  if (Array.isArray(v) && v.length >= 3) {
    const ch = (i) => {
      const x = v[i];
      return typeof x === "number" && Number.isFinite(x) ? x : fallback[i];
    };
    return [ch(0), ch(1), ch(2), v.length >= 4 ? ch(3) : fallback[3]];
  }
  if (isRecord(v)) {
    const ch = (name, i) => {
      const x = v[name];
      return typeof x === "number" && Number.isFinite(x) ? x : fallback[i];
    };
    return [ch("red", 0), ch("green", 1), ch("blue", 2), ch("alpha", 3)];
  }
  return fallback;
}
function record(params, key) {
  const v = params[key];
  return isRecord(v) ? v : void 0;
}
function numbers(params, key) {
  const v = params[key];
  if (!Array.isArray(v)) return void 0;
  return v.every((x) => typeof x === "number") ? v : void 0;
}
function getInt(value) {
  const a = Math.abs(value);
  const f = Math.floor(a);
  const r = a - f >= 0.5 ? f + 1 : f;
  const out = value < 0 ? -r : r;
  return out === 0 ? 0 : out;
}
function hexColorRgb(c) {
  const clamp2 = (v) => Math.min(255, Math.max(0, getInt(v)));
  return [clamp2(c[0]), clamp2(c[1]), clamp2(c[2])];
}
function readerPath(params, key) {
  const v = params[key];
  if (!isRecord(v)) return void 0;
  const path3 = v.path;
  return typeof path3 === "string" && path3.length > 0 ? path3 : void 0;
}

// ../engine/src/render/kernels/analog-tape.ts
var f32 = Math.fround;
var FNV_PRIME = 16777619;
function utf8(text2) {
  const out = [];
  for (const ch of text2) {
    const cp = ch.codePointAt(0);
    if (cp < 128) out.push(cp);
    else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
    else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
    else out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
  }
  return out;
}
function fnv1aString(text2) {
  let h = 2166136261;
  for (const byte of utf8(text2)) h = Math.imul(h ^ byte, FNV_PRIME) >>> 0;
  return h;
}
function fnv1aWord(h, d) {
  h = Math.imul(h ^ d & 255, FNV_PRIME);
  h = Math.imul(h ^ d >>> 8 & 255, FNV_PRIME);
  h = Math.imul(h ^ d >>> 16 & 255, FNV_PRIME);
  return Math.imul(h ^ d >>> 24, FNV_PRIME) >>> 0;
}
function hash01(seed, a, b, c) {
  return f32(fnv1aWord(fnv1aWord(fnv1aWord(seed, a), b), c)) / 4294967296;
}
function rowDensity(seed, frame, y) {
  const tc = frame >> 3;
  const y0 = y >> 3;
  const a = (y & 7) / 8;
  const h0 = hash01(seed, tc, y0, 31);
  const h1 = hash01(seed, tc, y0 + 1, 31);
  const m = fmaf(1 - a, h0, f32(a * h1));
  return f32(m * m);
}
function xorshift(s) {
  s = (s ^ s << 13) >>> 0;
  s = (s ^ s >>> 17) >>> 0;
  return (s ^ s << 5) >>> 0;
}
function boxBlurRows(src, dst, w, h, r) {
  const win = 2 * r + 1;
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum = f32(sum + src[o + Math.min(Math.max(k, 0), w - 1)]);
    dst[o] = f32(sum / win);
    for (let x = 1; x < w; x += 1) {
      const add = Math.min(w - 1, x + r);
      const sub = Math.max(0, x - r - 1);
      sum = f32(sum + f32(src[o + add] - src[o + sub]));
      dst[o + x] = f32(sum / win);
    }
  }
}
function remapRows(src, dst, width, h, dx, scale) {
  for (let y = 0; y < h; y += 1) {
    const off = f32(dx[y] * scale);
    const o = y * width;
    const start = Math.max(0, Math.ceil(-off));
    const end = Math.min(width, Math.floor(f32(width - off)));
    let xs = f32(start + off);
    let x0 = Math.trunc(xs);
    let t = f32(xs - x0);
    for (let x = start; x < end; x += 1) {
      const s1 = src[o + x0 + 1] ?? 0;
      dst[o + x] = fmaf(src[o + x0], f32(1 - t), f32(s1 * t));
      xs = f32(xs + 1);
      x0 = Math.trunc(xs);
      t = f32(xs - x0);
    }
    for (let x = 0; x < Math.min(start, width); x += 1) dst[o + x] = src[o];
    for (let x = Math.max(end, 0); x < width; x += 1) dst[o + x] = src[o + width - 1];
  }
}
var BYTE_MAX = 255;
var Y_R = f32(0.299);
var Y_G = f32(0.587);
var Y_B = f32(0.114);
var U_R = f32(-0.14713);
var U_G = f32(-0.28886);
var U_B = f32(0.436);
var V_R = f32(0.615);
var V_G = f32(-0.51499);
var V_B = f32(-0.10001);
var R_V = f32(1.13983);
var G_U = f32(-0.39465);
var G_V = f32(-0.5806);
var B_U = f32(2.03211);
var PI_F = f32(Math.PI);
var TWO_PI_F = f32(2 * PI_F);
var WOBBLE_K = f32(TWO_PI_F * f32(35e-4));
var SPAN_TRACK_F = f32(f32(1.2) - 0.25);
var SPAN_BURST_G = f32(0.25 - f32(0.1));
var SPAN_SAT_BAND = f32(0.5 - f32(0.8));
var ONE_OVER_24BIT = 16777215;
function effectFps(ctx) {
  if (ctx.fps) return ctx.fps.num / ctx.fps.den;
  if (ctx.clip && ctx.clip.readerFps > 0) return ctx.clip.readerFps;
  return 1;
}
var analogTape = {
  type: "AnalogTape",
  supported: true,
  run(image, params, ctx) {
    const w = image.width;
    const h = image.height;
    if (w <= 0 || h <= 0) return;
    const Uw = w + 1 >> 1;
    const px = image.data;
    let Y = new Float32Array(w * h);
    let U = new Float32Array(Uw * h);
    let V = new Float32Array(Uw * h);
    let tmpY = new Float32Array(w * h);
    let tmpU = new Float32Array(Uw * h);
    let tmpV = new Float32Array(Uw * h);
    for (let y = 0; y < h; y += 1) {
      for (let x2 = 0; x2 < Uw; x2 += 1) {
        const x0 = x2 * 2;
        const i0 = (y * w + x0) * 4;
        const r0 = f32(px[i0 + 2] / BYTE_MAX);
        const g0 = f32(px[i0 + 1] / BYTE_MAX);
        const b0 = f32(px[i0] / BYTE_MAX);
        Y[y * w + x0] = fmaf(b0, Y_B, fmaf(r0, Y_R, f32(g0 * Y_G)));
        let u = fmaf(b0, U_B, fmaf(r0, U_R, f32(g0 * U_G)));
        let v = fmaf(b0, V_B, fmaf(r0, V_R, f32(g0 * V_G)));
        if (x0 + 1 < w) {
          const i1 = i0 + 4;
          const r1 = f32(px[i1 + 2] / BYTE_MAX);
          const g1 = f32(px[i1 + 1] / BYTE_MAX);
          const b1 = f32(px[i1] / BYTE_MAX);
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
    let rY = roundHalfAwayInt(f32(invSx * f32(2 * kSoft)));
    if (kNoise > f32(0.6)) rY = Math.min(rY, 1);
    if (rY > 0) {
      boxBlurRows(Y, tmpY, w, h, rY);
      [Y, tmpY] = [tmpY, Y];
    }
    const shift2 = f32(invSx * f32(2.5 * kBleed));
    const rC = roundHalfAwayInt(f32(invSx * f32(3 * kBleed)));
    const sat = fmaf(kBleed, f32(-0.3), 1);
    const shiftH = f32(shift2 * 0.5);
    for (let y = 0; y < h; y += 1) {
      const o = y * Uw;
      for (let x = 0; x < Uw; x += 1) {
        const raw = f32(x - shiftH);
        const xs = raw < 0 ? 0 : raw > Uw - 1 ? Uw - 1 : raw;
        const x0 = Math.trunc(xs);
        const x1 = Math.min(x0 + 1, Uw - 1);
        const tt = f32(xs - x0);
        const it = f32(1 - tt);
        tmpU[o + x] = fmaf(U[o + x0], it, f32(U[o + x1] * tt));
        tmpV[o + x] = fmaf(V[o + x0], it, f32(V[o + x1] * tt));
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
    const SEED = (fnv1aString(ctx.effectId ?? "") ^ seedOffset >>> 0) >>> 0;
    const schedSalt = (toU32(f32(kBands * 64)) ^ toU32(f32(kStripe * 64)) << 8 ^ toU32(f32(kNoise * 64)) << 16) >>> 0;
    const SCHED_SEED = (SEED ^ fnv1aWord(schedSalt, 2654435769)) >>> 0;
    const fh = h;
    const sigmaY = f32(kNoise * f32(0.08));
    const decay = fmaf(kNoise, f32(0.08), f32(0.88));
    const amp = f32(kNoise * f32(0.18));
    const baseP = fmaf(kNoise, f32(0.02), f32(25e-4));
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
    const bands = [];
    if (kBands > 0 && rate > 0) {
      const winIdx = Math.trunc(t * 4);
      const lambda = rate * 0.25 * (f32(rowDensity(SCHED_SEED, frame | 0, 0) * 1.5) + 0.25);
      const ex = Math.exp(-lambda);
      const probGe1 = 1 - ex;
      const probGe2 = fma2(-lambda, ex, probGe1);
      const spawn = (kseed) => {
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
    const kf = Math.floor(t * 2);
    const a = f32(t * 2 - kf);
    const oneMinusA = f32(1 - a);
    const frameU = frame >>> 0;
    const hashFrame = fnv1aWord(SEED, frameU);
    const sixOverRefH = f32(6 / refH);
    const humScale = f32(kNoise * f32(8e-3));
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
      const satRow = fmaf(-f32(1 - satBand), burstF, 1);
      if (burstF > 0 && satRow !== 1) {
        const o2 = y * Uw;
        for (let xh = 0; xh < Uw; xh += 1) {
          U[o2 + xh] = f32(satRow * U[o2 + xh]);
          V[o2 + xh] = f32(satRow * V[o2 + xh]);
        }
      }
      const rowBias = rowDensity(SEED, frame | 0, yRef);
      let p = f32(baseP * fmaf(rowBias, 1.5, 0.25));
      p = f32(fmaf(burstF, 2, fmaf(bandF, 1.5, 1)) * p);
      const humArg = fma2(t, f32(0.08), f32(f32(yRef) * sixOverRefH)) * TWO_PI_F;
      const hum = f32(Math.sin(humArg) * humScale);
      const yRefU = yRef >>> 0;
      const yMul = Math.imul(34283, yRefU);
      let s0 = (SEED ^ Math.imul(40503, kf) ^ yMul) >>> 0;
      let s1 = (SEED ^ Math.imul(40503, kf + 1) ^ yMul ^ 19088743) >>> 0;
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
        if (hash01Tail(hashRow, refW - 1 - xRef >>> 0) < pR) sR = 1;
        s0 = xorshift(s0);
        s1 = xorshift(s1);
        const n0 = f32((s0 & 16777215) / ONE_OVER_24BIT);
        const n1 = f32((s1 & 16777215) / ONE_OVER_24BIT);
        const n = fmaf(n0, oneMinusA, f32(n1 * a));
        const yv = Y[o + x];
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
    const A = f32(invSx * f32(3 * kTrack));
    const fHz = fmaf(kTrack, SPAN_TRACK_F, 0.25);
    const Hsk = fmaf(f32(fh * f32(0.1)), kTrack, 0);
    const S = f32(invSx * f32(5 * kTrack));
    const seedTerm = f32(f32(f32(SEED) * f32(1e-3)) * f32(0.7));
    const phase = f32(fma2(t * fHz, TWO_PI_F, seedTerm));
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
    for (let y = 0; y < h; y += 1) {
      const yo = y * w;
      const co = y * Uw;
      for (let x = 0; x < w; x += 1) {
        const xs = x * 0.5;
        const x0 = Math.trunc(xs);
        const x1 = Math.min(x0 + 1, Uw - 1);
        const tt = xs - x0;
        const it = 1 - tt;
        const u = f32(sat * fmaf(U[co + x0], it, f32(tt * U[co + x1])));
        const v = f32(sat * fmaf(V[co + x0], it, f32(tt * V[co + x1])));
        const yv = Y[yo + x];
        const r = fmaf(v, R_V, yv);
        const g = fmaf(v, G_V, fmaf(u, G_U, yv));
        const b = fmaf(u, B_U, yv);
        const i = (yo + x) * 4;
        px[i + 2] = toByte(r);
        px[i + 1] = toByte(g);
        px[i] = toByte(b);
      }
    }
  }
};
function toByte(v) {
  if (v < 0) return 0;
  return Math.trunc(f32((v > 1 ? 1 : v) * 255));
}
function roundHalfAwayInt(v) {
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}
function toU32(v) {
  if (!(v > 0)) return 0;
  return v >= 4294967296 ? 4294967295 : Math.trunc(v) >>> 0;
}
function hash01Tail(h, c) {
  return f32(fnv1aWord(h, c)) / 4294967296;
}

// ../engine/src/render/qt/smooth-scale.ts
function calcPoints(s, d) {
  const p = new Int32Array(d);
  const up = d >= s;
  let val = up ? Math.trunc(32768 * s / d) - 32768 : 0;
  const inc = Math.trunc(s * 65536 / d);
  for (let i = 0; i < d; i += 1) {
    p[i] = Math.max(0, Math.floor(val / 65536));
    val += inc;
  }
  return p;
}
function calcApoints(s, d, up) {
  const p = new Int32Array(d);
  if (up) {
    let val = Math.trunc(32768 * s / d) - 32768;
    const inc = Math.trunc(s * 65536 / d);
    for (let i = 0; i < d; i += 1) {
      const pos = Math.floor(val / 65536);
      if (pos < 0 || pos >= s - 1) p[i] = 0;
      else p[i] = Math.floor(val / 256) & 255;
      val += inc;
    }
  } else {
    let val = 0;
    const inc = Math.trunc(s * 65536 / d);
    const Cp = Math.trunc((d * 16384 + s - 1) / s);
    for (let i = 0; i < d; i += 1) {
      const ap = Math.floor((65536 - (val & 65535)) * Cp / 65536);
      p[i] = ap | Cp << 16;
      val += inc;
    }
  }
  return p;
}
function axis(s, d) {
  const up = d >= s;
  return { points: calcPoints(s, d), apoints: calcApoints(s, d, up), up };
}
function areaSum(src, o, xyap, Cxy, step, acc) {
  let r = src[o] * xyap;
  let g = src[o + 1] * xyap;
  let b = src[o + 2] * xyap;
  let a = src[o + 3] * xyap;
  let j = 16384 - xyap;
  for (; j > Cxy; j -= Cxy) {
    o += step;
    r += src[o] * Cxy;
    g += src[o + 1] * Cxy;
    b += src[o + 2] * Cxy;
    a += src[o + 3] * Cxy;
  }
  o += step;
  r += src[o] * j;
  g += src[o + 1] * j;
  b += src[o + 2] * j;
  a += src[o + 3] * j;
  acc[0] = r;
  acc[1] = g;
  acc[2] = b;
  acc[3] = a;
}
function smoothScale(src, dw, dh) {
  const sw = src.width;
  const sh = src.height;
  dw = Math.trunc(dw);
  dh = Math.trunc(dh);
  if (dw === sw && dh === sh) return src;
  const out = createPremul(dw, dh);
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return out;
  const xs = axis(sw, dw);
  const ys = axis(sh, dh);
  const s = src.data;
  const d = out.data;
  const sow = sw * 4;
  const xpoints = xs.points;
  const xapoints = xs.apoints;
  const ypoints = ys.points;
  const yapoints = ys.apoints;
  if (xs.up && ys.up) {
    for (let y = 0; y < dh; y += 1) {
      const rowBase = ypoints[y] * sow;
      const yap = yapoints[y];
      let di = y * dw * 4;
      for (let x = 0; x < dw; x += 1, di += 4) {
        const pi = rowBase + xpoints[x] * 4;
        const xap = xapoints[x];
        if (yap > 0) {
          if (xap > 0) {
            const iy = 256 - yap;
            const ix = 256 - xap;
            for (let c = 0; c < 4; c += 1) {
              const left = s[pi + c] * iy + s[pi + sow + c] * yap >> 8;
              const right = s[pi + 4 + c] * iy + s[pi + sow + 4 + c] * yap >> 8;
              d[di + c] = left * ix + right * xap >> 8;
            }
          } else {
            const iy = 256 - yap;
            for (let c = 0; c < 4; c += 1) d[di + c] = s[pi + c] * iy + s[pi + sow + c] * yap >> 8;
          }
        } else if (xap > 0) {
          const ix = 256 - xap;
          for (let c = 0; c < 4; c += 1) d[di + c] = s[pi + c] * ix + s[pi + 4 + c] * xap >> 8;
        } else {
          d[di] = s[pi];
          d[di + 1] = s[pi + 1];
          d[di + 2] = s[pi + 2];
          d[di + 3] = s[pi + 3];
        }
      }
    }
    return out;
  }
  const acc = new Float64Array(4);
  const acc2 = new Float64Array(4);
  if (xs.up) {
    for (let y = 0; y < dh; y += 1) {
      const Cy = yapoints[y] >> 16;
      const yap = yapoints[y] & 65535;
      const rowBase = ypoints[y] * sow;
      let di = y * dw * 4;
      for (let x = 0; x < dw; x += 1, di += 4) {
        const o = rowBase + xpoints[x] * 4;
        areaSum(s, o, yap, Cy, sow, acc);
        const xap = xapoints[x];
        if (xap > 0) {
          areaSum(s, o + 4, yap, Cy, sow, acc2);
          for (let c = 0; c < 4; c += 1) {
            acc[c] = Math.floor((acc[c] * (256 - xap) + acc2[c] * xap) / 256);
          }
        }
        for (let c = 0; c < 4; c += 1) d[di + c] = Math.floor(acc[c] / 16384);
      }
    }
    return out;
  }
  if (ys.up) {
    for (let y = 0; y < dh; y += 1) {
      const rowBase = ypoints[y] * sow;
      const yap = yapoints[y];
      let di = y * dw * 4;
      for (let x = 0; x < dw; x += 1, di += 4) {
        const Cx = xapoints[x] >> 16;
        const xap = xapoints[x] & 65535;
        const o = rowBase + xpoints[x] * 4;
        areaSum(s, o, xap, Cx, 4, acc);
        if (yap > 0) {
          areaSum(s, o + sow, xap, Cx, 4, acc2);
          for (let c = 0; c < 4; c += 1) {
            acc[c] = Math.floor((acc[c] * (256 - yap) + acc2[c] * yap) / 256);
          }
        }
        for (let c = 0; c < 4; c += 1) d[di + c] = Math.floor(acc[c] / 16384);
      }
    }
    return out;
  }
  const sum = new Float64Array(4);
  for (let y = 0; y < dh; y += 1) {
    const Cy = yapoints[y] >> 16;
    const yap = yapoints[y] & 65535;
    const rowBase = ypoints[y] * sow;
    let di = y * dw * 4;
    for (let x = 0; x < dw; x += 1, di += 4) {
      const Cx = xapoints[x] >> 16;
      const xap = xapoints[x] & 65535;
      let o = rowBase + xpoints[x] * 4;
      areaSum(s, o, xap, Cx, 4, acc);
      for (let c = 0; c < 4; c += 1) sum[c] = Math.floor(acc[c] / 16) * yap;
      let j = 16384 - yap;
      for (; j > Cy; j -= Cy) {
        o += sow;
        areaSum(s, o, xap, Cx, 4, acc);
        for (let c = 0; c < 4; c += 1) sum[c] = sum[c] + Math.floor(acc[c] / 16) * Cy;
      }
      o += sow;
      areaSum(s, o, xap, Cx, 4, acc);
      for (let c = 0; c < 4; c += 1) {
        sum[c] = sum[c] + Math.floor(acc[c] / 16) * j;
        d[di + c] = Math.floor(sum[c] / 16777216);
      }
    }
  }
  return out;
}

// ../engine/src/render/kernels/audio-visualization-analysis.ts
var f322 = Math.fround;
function clampf(v, lo, hi) {
  const m = v < hi ? v : hi;
  return lo < m ? m : lo;
}
function clampi(v, lo, hi) {
  const m = v < hi ? v : hi;
  return lo < m ? m : lo;
}
function lround(v) {
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}
function normalizedFrequencyToHz(value, highFrequency) {
  if (value > 1) return value;
  const normalized = clampf(value, 0, 1);
  if (highFrequency && normalized <= 0) return 21;
  return f322(20 * f322(Math.pow(1e3, normalized)));
}
function sampleCount(audio) {
  return audio && audio.channels.length > 0 ? audio.channels[0].length : 0;
}
function frameSampleCount(audio) {
  return sampleCount(audio);
}
function bucketSamples(audio, channel, wanted, gain, smooth2) {
  const size = Math.max(2, wanted);
  const values = new Float32Array(size);
  const samples = sampleCount(audio);
  const channels = audio ? audio.channels.length : 0;
  if (!audio || samples <= 0 || channels <= 0) return values;
  const oneMinusSmooth = f322(1 - smooth2);
  const data = channel >= 0 ? audio.channels[clampi(channel, 0, channels - 1)] : null;
  let previous = 0;
  for (let i = 0; i < size; i += 1) {
    const start = Math.floor(i * samples / size);
    const end = Math.max(start + 1, Math.trunc((i + 1) * samples / size));
    let peak = 0;
    let peakMagnitude = 0;
    for (let s = start; s < end && s < samples; s += 1) {
      let value;
      if (data) value = data[s];
      else {
        let mixed = 0;
        for (let c = 0; c < channels; c += 1) mixed = f322(mixed + audio.channels[c][s]);
        value = f322(mixed / channels);
      }
      const magnitude = Math.abs(value);
      if (magnitude > peakMagnitude) {
        peak = value;
        peakMagnitude = magnitude;
      }
    }
    const scaled = clampf(f322(gain * peak), -1, 1);
    previous = fmaf(previous, smooth2, f322(oneMinusSmooth * scaled));
    values[i] = previous;
  }
  return values;
}
function reactiveLevel(audio, channel, gain) {
  const samples = sampleCount(audio);
  const channels = audio ? audio.channels.length : 0;
  if (!audio || samples <= 0 || channels <= 0) return 0;
  const first = channel >= 0 ? clampi(channel, 0, channels - 1) : 0;
  const last = channel >= 0 ? first + 1 : channels;
  let total = 0;
  let peak = 0;
  for (let c = first; c < last; c += 1) {
    const data = audio.channels[c];
    for (let i = 0; i < samples; i += 1) {
      const magnitude = Math.abs(data[i]);
      total += f322(magnitude * magnitude);
      if (peak < magnitude) peak = magnitude;
    }
  }
  const rms = f322(Math.sqrt(total / (samples * (last - first))));
  const a = f322(rms * f322(3.6));
  const b = f322(peak * f322(1.15));
  const mixed = a < b ? b : a;
  return f322(Math.pow(clampf(f322(gain * mixed), 0, 1), f322(0.55)));
}
function bandLevel(bins, start, end) {
  const n = bins.length;
  if (n === 0) return 0;
  const first = clampi(lround(f322(start * n)), 0, n - 1);
  const last = clampi(lround(f322(end * n)), first + 1, n);
  let total = 0;
  for (let i = first; i < last; i += 1) total = f322(total + bins[i]);
  return clampf(f322(total / (last - first)), 0, 1);
}
var TWO_PI = 2 * Math.PI;
function spectrumBins(audio, bins, gain, smooth2, lowHz, highHz) {
  const size = Math.max(2, bins);
  const result = new Float32Array(size);
  const samples = sampleCount(audio);
  const channels = audio ? audio.channels.length : 0;
  if (!audio || samples <= 4 || channels <= 0) return result;
  const sampleRate = Math.max(1, Math.trunc(audio.sampleRate));
  const n = Math.min(samples, 2048);
  const nyquist = f322(sampleRate * 0.5);
  const low = clampf(lowHz, 1, nyquist);
  const high = clampf(highHz, f322(low + 1), nyquist);
  const windowed = new Float64Array(n);
  for (let s = 0; s < n; s += 1) {
    let mixed = 0;
    for (let c = 0; c < channels; c += 1) mixed = f322(mixed + audio.channels[c][s]);
    mixed = f322(mixed / channels);
    const window = 0.5 - 0.5 * Math.cos(TWO_PI * s / (n - 1));
    windowed[s] = window * mixed;
  }
  const magnitudes = new Float32Array(size);
  const ratio = f322(high / low);
  for (let bin = 0; bin < size; bin += 1) {
    const t = f322(f322(bin + 0.5) / size);
    const hz = f322(low * f322(Math.pow(ratio, t)));
    const phaseDelta = TWO_PI * hz / sampleRate;
    const stepReal = Math.cos(phaseDelta);
    const stepImag = Math.sin(phaseDelta);
    const negStepImag = -stepImag;
    let phaseReal = 1;
    let phaseImag = 0;
    let real = 0;
    let imag = 0;
    for (let s = 0; s < n; s += 1) {
      const value = windowed[s];
      real = fma2(value, phaseReal, real);
      imag = fma2(-value, phaseImag, imag);
      const nextImag = fma2(phaseReal, stepImag, stepReal * phaseImag);
      phaseReal = fma2(phaseReal, stepReal, phaseImag * negStepImag);
      phaseImag = nextImag;
    }
    const magnitude = Math.sqrt(fma2(real, real, imag * imag)) / n * gain * 8;
    magnitudes[bin] = clampf(f322(magnitude), 0, 1);
  }
  const oneMinusSmooth = f322(1 - smooth2);
  let previous = 0;
  for (let bin = 0; bin < size; bin += 1) {
    previous = fmaf(previous, smooth2, f322(oneMinusSmooth * magnitudes[bin]));
    result[bin] = previous;
  }
  return result;
}
function mt19937Floats(seed, count) {
  const words2 = 397 + count + 1;
  const mt = new Uint32Array(words2);
  mt[0] = seed >>> 0;
  for (let i = 1; i < words2; i += 1) {
    const prev = mt[i - 1];
    mt[i] = Math.imul(1812433253, (prev ^ prev >>> 30) >>> 0) + i >>> 0;
  }
  const out = [];
  for (let k = 0; k < count; k += 1) {
    const yp = (mt[k] & 2147483648 | mt[k + 1] & 2147483647) >>> 0;
    const x = (mt[k + 397] ^ yp >>> 1 ^ (yp & 1 ? 2567483615 : 0)) >>> 0;
    let z = (x ^ x >>> 11) >>> 0;
    z = (z ^ z << 7 & 2636928640) >>> 0;
    z = (z ^ z << 15 & 4022730752) >>> 0;
    z = (z ^ z >>> 18) >>> 0;
    out.push(f322(z) / 4294967296);
  }
  return out;
}

// ../engine/src/render/kernels/audio-visualization-color.ts
function rgb8(r, g, b, a = 255) {
  return { r: r * 257, g: g * 257, b: b * 257, a: a * 257 };
}
function div257(x) {
  const v = x + 128;
  return v - (v >> 8) >> 8;
}
function red8(c) {
  return div257(c.r);
}
function green8(c) {
  return div257(c.g);
}
function blue8(c) {
  return div257(c.b);
}
function alpha8(c) {
  return div257(c.a);
}
function withAlpha(c, a) {
  return { r: c.r, g: c.g, b: c.b, a: a * 257 };
}
function qRoundPos(x) {
  return Math.trunc(x + 0.5);
}
function fuzzyCompare(p1, p2) {
  return Math.abs(p1 - p2) * 1e12 <= Math.min(Math.abs(p1), Math.abs(p2));
}
function getHsv(c) {
  const r = c.r / 65535;
  const g = c.g / 65535;
  const b = c.b / 65535;
  const max = r > g && r > b ? r : g > b ? g : b;
  const min = r < g && r < b ? r : g < b ? g : b;
  const delta = max - min;
  const value = qRoundPos(max * 65535);
  let hue16 = 65535;
  let sat16 = 0;
  if (!(Math.abs(delta) <= 1e-12)) {
    sat16 = qRoundPos(delta / max * 65535);
    let hue2 = 0;
    if (fuzzyCompare(r, max)) hue2 = (g - b) / delta;
    else if (fuzzyCompare(g, max)) hue2 = 2 + (b - r) / delta;
    else if (fuzzyCompare(b, max)) hue2 = 4 + (r - g) / delta;
    hue2 *= 60;
    if (hue2 < 0) hue2 += 360;
    hue16 = qRoundPos(hue2 * 100);
  }
  return {
    h: hue16 === 65535 ? -1 : Math.trunc(hue16 / 100),
    s: div257(sat16),
    v: div257(value),
    a: div257(c.a)
  };
}
function fromHsv(h, s, v, a) {
  const hue16 = h === -1 ? 65535 : h % 360 * 100;
  const sat16 = s * 257;
  const val16 = v * 257;
  const alpha = a * 257;
  if (sat16 === 0 || hue16 === 65535) return { r: val16, g: val16, b: val16, a: alpha };
  const hh = hue16 === 36e3 ? 0 : hue16 / 6e3;
  const ss = sat16 / 65535;
  const vv = val16 / 65535;
  const i = Math.trunc(hh);
  const f = hh - i;
  const p = vv * (1 - ss);
  const R = (x) => qRoundPos(x * 65535);
  if (i & 1) {
    const q = vv * fma2(-ss, f, 1);
    if (i === 1) return { r: R(q), g: R(vv), b: R(p), a: alpha };
    if (i === 3) return { r: R(p), g: R(q), b: R(vv), a: alpha };
    return { r: R(vv), g: R(p), b: R(q), a: alpha };
  }
  const t = vv * fma2(-ss, 1 - f, 1);
  if (i === 0) return { r: R(vv), g: R(t), b: R(p), a: alpha };
  if (i === 2) return { r: R(p), g: R(vv), b: R(t), a: alpha };
  return { r: R(t), g: R(p), b: R(vv), a: alpha };
}
function mixColor(a, b, amount) {
  const t = clampf(amount, 0, 1);
  const inv = f322(1 - t);
  const ch = (x, y) => clampi(lround(fmaf(x, inv, f322(t * y))), 0, 255);
  return rgb8(ch(red8(a), red8(b)), ch(green8(a), green8(b)), ch(blue8(a), blue8(b)), ch(alpha8(a), alpha8(b)));
}
function alphaColor(c, scale) {
  return withAlpha(c, clampi(lround(f322(scale * alpha8(c))), 0, 255));
}
function hueShift(c, degrees) {
  const hsv = getHsv(c);
  const h = hsv.h < 0 ? 0 : hsv.h;
  return fromHsv((h + degrees + 360) % 360, hsv.s, hsv.v, alpha8(c));
}
function rainbowColor(seed, position, spread2) {
  const hsv = getHsv(seed);
  const h = hsv.h < 0 ? 0 : hsv.h;
  const sp = clampf(spread2, 0, 1);
  const hue2 = (h + lround(f322(clampf(position, 0, 1) * 360))) % 360;
  const saturation2 = clampi(lround(f322(fmaf(sp, f322(0.35), f322(0.65)) * hsv.s)), 0, 255);
  const value = clampi(lround(f322(fmaf(sp, f322(0.12), f322(0.88)) * hsv.v)), 0, 255);
  return fromHsv(hue2, saturation2, value, alpha8(seed));
}
var STYLE_SOFT = 1;
var STYLE_NEON = 2;
var STYLE_MINIMAL = 3;
function basePalette(base, glowAmount, style) {
  const a = alpha8(base);
  const dark = mixColor(base, rgb8(0, 0, 0, a), f322(0.62));
  let light = mixColor(base, rgb8(255, 255, 255, a), f322(0.28));
  let accent = mixColor(base, light, f322(0.35));
  if (style === STYLE_MINIMAL) {
    light = base;
    accent = base;
  } else if (style === STYLE_SOFT) {
    light = mixColor(base, rgb8(255, 255, 255, a), f322(0.42));
    accent = light;
  } else if (style === STYLE_NEON) {
    light = mixColor(base, rgb8(255, 255, 255, a), f322(0.18));
    accent = light;
  }
  const glow2 = alphaColor(light, fmaf(glowAmount, f322(0.65), f322(0.18)));
  return { base, dark, light, accent, glow: glow2 };
}
function makePalette(base, glowAmount, style, colorSpread) {
  const p = basePalette(base, glowAmount, style);
  const spread2 = clampf(colorSpread, 0, 1);
  return {
    base,
    dark: mixColor(base, p.dark, spread2),
    light: mixColor(base, p.light, spread2),
    accent: mixColor(base, p.accent, spread2),
    glow: alphaColor(mixColor(base, p.glow, spread2), fmaf(glowAmount, f322(0.65), f322(0.18)))
  };
}
function styleGlowAmount(style, glow2) {
  if (style === STYLE_NEON) return clampf(glow2 < f322(0.45) ? f322(0.45) : glow2, 0, 1);
  if (style === STYLE_SOFT) return clampf(glow2 < f322(0.22) ? f322(0.22) : glow2, 0, 1);
  if (style === STYLE_MINIMAL) return f322(glow2 * f322(0.2));
  return glow2;
}
function styleStrokeWidth(style, glow2) {
  if (style === STYLE_MINIMAL) return 1;
  if (style === STYLE_SOFT) return fmaf(glow2, f322(1.4), f322(2.4));
  if (style === STYLE_NEON) return fmaf(glow2, f322(1.2), f322(1.8));
  return fmaf(glow2, f322(1.6), 1.5);
}
function styleFillAlpha(style) {
  if (style === STYLE_MINIMAL) return 1;
  if (style === STYLE_NEON) return f322(0.82);
  if (style === STYLE_SOFT) return f322(0.74);
  return f322(0.72);
}
function setColorAt(stops, pos, color2) {
  if (pos > 1 || pos < 0) return;
  let index = 0;
  while (index < stops.length && stops[index].pos < pos) index += 1;
  if (index < stops.length && stops[index].pos === pos) stops[index] = { pos, color: color2 };
  else stops.splice(index, 0, { pos, color: color2 });
}
var RAINBOW_STOPS = [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1].map((v) => f322(v));
function rainbowStops(seed, spread2, alphaScale = 1) {
  const stops = [];
  for (const stop of RAINBOW_STOPS) setColorAt(stops, stop, alphaColor(rainbowColor(seed, stop, spread2), alphaScale));
  return stops;
}
function verticalStyleFill(x0, y0, x1, y1, palette, style, alphaScale = 1) {
  if (style === STYLE_MINIMAL) return { kind: "solid", color: alphaColor(palette.base, f322(styleFillAlpha(style) * alphaScale)) };
  const stops = [];
  if (style === STYLE_NEON) {
    setColorAt(stops, 0, alphaColor(palette.light, f322(f322(0.92) * alphaScale)));
    setColorAt(stops, 0.5, alphaColor(palette.base, f322(f322(0.7) * alphaScale)));
    setColorAt(stops, 1, alphaColor(palette.base, f322(f322(0.28) * alphaScale)));
  } else if (style === STYLE_SOFT) {
    setColorAt(stops, 0, alphaColor(palette.light, f322(f322(0.48) * alphaScale)));
    setColorAt(stops, 0.5, alphaColor(palette.base, f322(f322(0.78) * alphaScale)));
    setColorAt(stops, 1, alphaColor(palette.base, f322(f322(0.48) * alphaScale)));
  } else {
    setColorAt(stops, 0, alphaColor(palette.light, f322(f322(0.72) * alphaScale)));
    setColorAt(stops, 0.62, alphaColor(palette.base, f322(f322(0.72) * alphaScale)));
    setColorAt(stops, 1, alphaColor(palette.base, f322(f322(0.38) * alphaScale)));
  }
  return { kind: "linear", x1: x0, y1: y0, x2: x1, y2: y1, stops };
}

// ../engine/src/render/qt/compose.ts
var CompositionMode = {
  SourceOver: 0,
  DestinationOver: 1,
  Clear: 2,
  Source: 3,
  Destination: 4,
  SourceIn: 5,
  DestinationIn: 6,
  SourceOut: 7,
  DestinationOut: 8,
  SourceAtop: 9,
  DestinationAtop: 10,
  Xor: 11,
  Plus: 12,
  Multiply: 13,
  Screen: 14,
  Overlay: 15,
  Darken: 16,
  Lighten: 17,
  ColorDodge: 18,
  ColorBurn: 19,
  HardLight: 20,
  SoftLight: 21,
  Difference: 22,
  Exclusion: 23
};
function div255(x) {
  return x + (x >> 8) + 128 >> 8;
}
function interp255(x, a1, y, a2) {
  return div255(x * a1 + y * a2);
}
function mixAlpha(da, sa) {
  return 255 - div255((255 - sa) * (255 - da));
}
function sourceOverPixels(d, di, s, si, n, ca) {
  if (ca === 255) {
    for (let i = 0; i < n; i += 1, di += 4, si += 4) {
      const sa = s[si + 3];
      if (sa === 255) {
        d[di] = s[si];
        d[di + 1] = s[si + 1];
        d[di + 2] = s[si + 2];
        d[di + 3] = 255;
      } else {
        const ia = 255 - sa;
        d[di] = s[si] + byteMul(d[di], ia);
        d[di + 1] = s[si + 1] + byteMul(d[di + 1], ia);
        d[di + 2] = s[si + 2] + byteMul(d[di + 2], ia);
        d[di + 3] = sa + byteMul(d[di + 3], ia);
      }
    }
    return;
  }
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const r = byteMul(s[si], ca);
    const g = byteMul(s[si + 1], ca);
    const b = byteMul(s[si + 2], ca);
    const a = byteMul(s[si + 3], ca);
    const ia = 255 - a;
    d[di] = r + byteMul(d[di], ia);
    d[di + 1] = g + byteMul(d[di + 1], ia);
    d[di + 2] = b + byteMul(d[di + 2], ia);
    d[di + 3] = a + byteMul(d[di + 3], ia);
  }
}
var sourceOver = (d, di, s, si, n, ca) => {
  sourceOverPixels(d, di, s, si, n, ca === 255 ? 255 : Math.trunc(ca * 256 / 255) * 255 >> 8);
};
function blendSourceOverFast(d, di, s, si, n, intOpacity) {
  if (intOpacity <= 0) return;
  sourceOverPixels(d, di, s, si, n, intOpacity >= 256 ? 255 : intOpacity * 255 >> 8);
}
var destinationOver = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const ida = 255 - d[di + 3];
    for (let c = 0; c < 4; c += 1) {
      const sc = ca === 255 ? s[si + c] : byteMul(s[si + c], ca);
      d[di + c] = byteMul(sc, ida) + d[di + c];
    }
  }
};
var clear = (d, di, _s, _si, n, ca) => {
  if (ca === 255) {
    d.fill(0, di, di + n * 4);
    return;
  }
  const ia = 255 - ca;
  for (let i = 0; i < n * 4; i += 1) d[di + i] = byteMul(d[di + i], ia);
};
var source = (d, di, s, si, n, ca) => {
  if (ca === 255) {
    d.set(s.subarray(si, si + n * 4), di);
    return;
  }
  const ia = 255 - ca;
  for (let i = 0; i < n * 4; i += 1) d[di + i] = interp255(s[si + i], ca, d[di + i], ia);
};
var destination = () => {
};
var sourceIn = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const da = d[di + 3];
    if (ca === 255) {
      for (let c = 0; c < 4; c += 1) d[di + c] = byteMul(s[si + c], da);
    } else {
      const cia = 255 - ca;
      for (let c = 0; c < 4; c += 1) d[di + c] = interp255(byteMul(s[si + c], ca), da, d[di + c], cia);
    }
  }
};
var destinationIn = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    let sa = s[si + 3];
    if (ca !== 255) sa = div255(sa * ca) + (255 - ca);
    for (let c = 0; c < 4; c += 1) d[di + c] = byteMul(d[di + c], sa);
  }
};
var sourceOut = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const ida = 255 - d[di + 3];
    if (ca === 255) {
      for (let c = 0; c < 4; c += 1) d[di + c] = byteMul(s[si + c], ida);
    } else {
      const cia = 255 - ca;
      for (let c = 0; c < 4; c += 1) d[di + c] = interp255(byteMul(s[si + c], ca), ida, d[di + c], cia);
    }
  }
};
var destinationOut = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    let sia = 255 - s[si + 3];
    if (ca !== 255) sia = div255(sia * ca) + (255 - ca);
    for (let c = 0; c < 4; c += 1) d[di + c] = byteMul(d[di + c], sia);
  }
};
var sourceAtop = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const da = d[di + 3];
    const sa = ca === 255 ? s[si + 3] : byteMul(s[si + 3], ca);
    const sia = 255 - sa;
    for (let c = 0; c < 4; c += 1) {
      const sc = ca === 255 ? s[si + c] : byteMul(s[si + c], ca);
      d[di + c] = interp255(sc, da, d[di + c], sia);
    }
  }
};
var destinationAtop = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const ida = 255 - d[di + 3];
    let sa = s[si + 3];
    if (ca === 255) {
      for (let c = 0; c < 4; c += 1) d[di + c] = interp255(s[si + c], ida, d[di + c], sa);
    } else {
      const cia = 255 - ca;
      sa = byteMul(sa, ca) + cia;
      for (let c = 0; c < 4; c += 1) d[di + c] = interp255(byteMul(s[si + c], ca), ida, d[di + c], sa);
    }
  }
};
var xor = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const ida = 255 - d[di + 3];
    const sa = ca === 255 ? s[si + 3] : byteMul(s[si + 3], ca);
    const sia = 255 - sa;
    for (let c = 0; c < 4; c += 1) {
      const sc = ca === 255 ? s[si + c] : byteMul(s[si + c], ca);
      d[di + c] = interp255(sc, ida, d[di + c], sia);
    }
  }
};
var plus = (d, di, s, si, n, ca) => {
  const ia = 255 - ca;
  for (let i = 0; i < n * 4; i += 1) {
    const sum = Math.min(255, d[di + i] + s[si + i]);
    d[di + i] = ca === 255 ? sum : interp255(sum, ca, d[di + i], ia);
  }
};
function separable(op) {
  return (d, di, s, si, n, ca) => {
    const ica = 255 - ca;
    for (let i = 0; i < n; i += 1, di += 4, si += 4) {
      const da = d[di + 3];
      const sa = s[si + 3];
      const r = op(d[di], s[si], da, sa);
      const g = op(d[di + 1], s[si + 1], da, sa);
      const b = op(d[di + 2], s[si + 2], da, sa);
      const a = mixAlpha(da, sa);
      if (ca === 255) {
        d[di] = r;
        d[di + 1] = g;
        d[di + 2] = b;
        d[di + 3] = a;
      } else {
        d[di] = interp255(r & 255, ca, d[di], ica);
        d[di + 1] = interp255(g & 255, ca, d[di + 1], ica);
        d[di + 2] = interp255(b & 255, ca, d[di + 2], ica);
        d[di + 3] = interp255(a, ca, d[di + 3], ica);
      }
    }
  };
}
var multiplyOp = (dst, src, da, sa) => div255(src * dst + src * (255 - da) + dst * (255 - sa));
var screenOp = (dst, src) => 255 - div255((255 - dst) * (255 - src));
var overlayOp = (dst, src, da, sa) => {
  const temp = src * (255 - da) + dst * (255 - sa);
  if (2 * dst < da) return div255(2 * src * dst + temp);
  return div255(sa * da - 2 * (da - dst) * (sa - src) + temp);
};
var darkenOp = (dst, src, da, sa) => div255(Math.min(src * da, dst * sa) + src * (255 - da) + dst * (255 - sa));
var lightenOp = (dst, src, da, sa) => div255(Math.max(src * da, dst * sa) + src * (255 - da) + dst * (255 - sa));
var colorDodgeOp = (dst, src, da, sa) => {
  const saDa = sa * da;
  const dstSa = dst * sa;
  const srcDa = src * da;
  const temp = src * (255 - da) + dst * (255 - sa);
  if (srcDa + dstSa > saDa) return div255(saDa + temp);
  if (src === sa || sa === 0) return div255(temp);
  return div255(Math.trunc(255 * dstSa / (255 - Math.trunc(255 * src / sa))) + temp);
};
var colorBurnOp = (dst, src, da, sa) => {
  const srcDa = src * da;
  const dstSa = dst * sa;
  const saDa = sa * da;
  const temp = src * (255 - da) + dst * (255 - sa);
  if (srcDa + dstSa < saDa) return div255(temp);
  if (src === 0) return div255(dstSa + temp);
  return div255(Math.trunc(sa * (srcDa + dstSa - saDa) / src) + temp);
};
var hardLightOp = (dst, src, da, sa) => {
  const temp = src * (255 - da) + dst * (255 - sa);
  if (2 * src < sa) return div255(2 * src * dst + temp);
  return div255(sa * da - 2 * (da - dst) * (sa - src) + temp);
};
var softLightOp = (dst, src, da, sa) => {
  const src2 = src << 1;
  const dstNp = da !== 0 ? Math.trunc(255 * dst / da) : 0;
  const temp = (src * (255 - da) + dst * (255 - sa)) * 255;
  if (src2 < sa) return Math.trunc((dst * (sa * 255 + (src2 - sa) * (255 - dstNp)) + temp) / 65025);
  if (4 * dst <= da) {
    const poly = Math.trunc(((16 * dstNp - 12 * 255) * dstNp + 3 * 65025) * dstNp / 65025);
    return Math.trunc((dst * sa * 255 + da * (src2 - sa) * poly + temp) / 65025);
  }
  return Math.trunc((dst * sa * 255 + da * (src2 - sa) * (Math.trunc(Math.sqrt(dstNp * 255)) - dstNp) + temp) / 65025);
};
var differenceOp = (dst, src, da, sa) => src + dst - div255(2 * Math.min(src * da, dst * sa));
var exclusionOp = (dst, src) => dst + src - (dst * src >> 7);
var COMPOSERS = [
  sourceOver,
  destinationOver,
  clear,
  source,
  destination,
  sourceIn,
  destinationIn,
  sourceOut,
  destinationOut,
  sourceAtop,
  destinationAtop,
  xor,
  plus,
  separable(multiplyOp),
  separable(screenOp),
  separable(overlayOp),
  separable(darkenOp),
  separable(lightenOp),
  separable(colorDodgeOp),
  separable(colorBurnOp),
  separable(hardLightOp),
  separable(softLightOp),
  separable(differenceOp),
  separable(exclusionOp)
];
function composerFor(mode) {
  return COMPOSERS[mode] ?? sourceOver;
}

// ../engine/src/render/qt/gray-raster.ts
function grayRasterize(contours, oddEven, width, height) {
  const outline = contours.filter((c) => c.length >= 4).map((c) => c.map((v) => Math.floor(v * 64 + 0.5)));
  if (outline.length === 0) return null;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const c of outline) {
    for (let i = 0; i + 1 < c.length; i += 2) {
      bx0 = Math.min(bx0, c[i]);
      bx1 = Math.max(bx1, c[i]);
      by0 = Math.min(by0, c[i + 1]);
      by1 = Math.max(by1, c[i + 1]);
    }
  }
  let minEx = Math.floor(bx0 / 64);
  let minEy = Math.floor(by0 / 64);
  let maxEx = Math.floor((bx1 + 63) / 64);
  let maxEy = Math.floor((by1 + 63) / 64);
  if (maxEx <= 0 || minEx >= width || maxEy <= 0 || minEy >= height) return null;
  minEx = Math.max(minEx, 0);
  minEy = Math.max(minEy, 0);
  maxEx = Math.min(maxEx, width);
  maxEy = Math.min(maxEy, height);
  const countEx = maxEx - minEx;
  const countEy = maxEy - minEy;
  if (countEx <= 0 || countEy <= 0) return null;
  const rows = Array.from({ length: countEy }, () => /* @__PURE__ */ new Map());
  let ex = 0;
  let ey = 0;
  let area = 0;
  let cover = 0;
  let invalid = true;
  let px = 0;
  let py = 0;
  const divMod = (a, b) => {
    let q = Math.trunc(a / b);
    let r = a % b;
    if (r < 0) {
      q -= 1;
      r += b;
    }
    return [q, r];
  };
  const recordCell = () => {
    if (area === 0 && cover === 0) return;
    const row = rows[ey];
    const x = ex > countEx ? countEx : ex;
    const cell = row.get(x);
    if (cell) {
      cell[0] += cover;
      cell[1] += area;
    } else row.set(x, [cover, area]);
  };
  const setCell = (cx, cy) => {
    const y = cy - minEy;
    let x = cx > maxEx ? maxEx : cx;
    x -= minEx;
    if (x < 0) x = -1;
    if (x !== ex || y !== ey) {
      if (!invalid) recordCell();
      area = 0;
      cover = 0;
      ex = x;
      ey = y;
    }
    invalid = y < 0 || y >= countEy || x >= countEx;
  };
  const startCell = (cx, cy) => {
    let x = cx;
    if (x > maxEx) x = maxEx;
    if (x < minEx) x = minEx - 1;
    area = 0;
    cover = 0;
    ex = x - minEx;
    ey = cy - minEy;
    invalid = false;
    setCell(x, cy);
  };
  const renderScanline = (row, x1, y1, x2, y2) => {
    let dx = x2 - x1;
    let ex1 = x1 >> 8;
    const ex2 = x2 >> 8;
    const fx1 = x1 - ex1 * 256;
    const fx2 = x2 - ex2 * 256;
    if (y1 === y2) {
      setCell(ex2, row);
      return;
    }
    if (ex1 === ex2) {
      const delta2 = y2 - y1;
      area += (fx1 + fx2) * delta2;
      cover += delta2;
      return;
    }
    let p = (256 - fx1) * (y2 - y1);
    let first = 256;
    let incr = 1;
    if (dx < 0) {
      p = fx1 * (y2 - y1);
      first = 0;
      incr = -1;
      dx = -dx;
    }
    let [delta, mod] = divMod(p, dx);
    area += (fx1 + first) * delta;
    cover += delta;
    ex1 += incr;
    setCell(ex1, row);
    let y = y1 + delta;
    if (ex1 !== ex2) {
      const [lift, rem] = divMod(256 * (y2 - y + delta), dx);
      mod -= dx;
      while (ex1 !== ex2) {
        delta = lift;
        mod += rem;
        if (mod >= 0) {
          mod -= dx;
          delta += 1;
        }
        area += 256 * delta;
        cover += delta;
        y += delta;
        ex1 += incr;
        setCell(ex1, row);
      }
    }
    delta = y2 - y;
    area += (fx2 + 256 - first) * delta;
    cover += delta;
  };
  const renderLine = (toX, toY) => {
    let ey1 = py >> 8;
    const ey2 = toY >> 8;
    const fy1 = py - ey1 * 256;
    const fy2 = toY - ey2 * 256;
    const dx = toX - px;
    let dy = toY - py;
    if (ey1 >= maxEy && ey2 >= maxEy || ey1 < minEy && ey2 < minEy) {
    } else if (ey1 === ey2) {
      renderScanline(ey1, px, fy1, toX, fy2);
    } else if (dx === 0) {
      const cx = px >> 8;
      const twoFx = (px - cx * 256) * 2;
      const first = dy < 0 ? 0 : 256;
      let delta = first - fy1;
      area += twoFx * delta;
      cover += delta;
      delta = first + first - 256;
      const step = twoFx * delta;
      const maxEy1 = countEy + minEy;
      if (dy < 0) {
        if (ey1 > maxEy1) ey1 = maxEy1 > ey2 ? maxEy1 : ey2;
        else ey1 -= 1;
        setCell(cx, ey1);
        while (ey1 > ey2 && ey1 >= minEy) {
          area += step;
          cover += delta;
          ey1 -= 1;
          setCell(cx, ey1);
        }
      } else {
        if (ey1 < minEy) ey1 = minEy < ey2 ? minEy : ey2;
        else ey1 += 1;
        setCell(cx, ey1);
        while (ey1 < ey2 && ey1 < maxEy1) {
          area += step;
          cover += delta;
          ey1 += 1;
          setCell(cx, ey1);
        }
      }
      if (ey1 !== ey2) {
        ey1 = ey2;
        setCell(cx, ey1);
      }
      delta = fy2 - 256 + first;
      area += twoFx * delta;
      cover += delta;
    } else {
      let p = (256 - fy1) * dx;
      let first = 256;
      let incr = 1;
      if (dy < 0) {
        p = fy1 * dx;
        first = 0;
        incr = -1;
        dy = -dy;
      }
      let [delta, mod] = divMod(p, dy);
      let x = px + delta;
      renderScanline(ey1, px, fy1, x, first);
      ey1 += incr;
      setCell(x >> 8, ey1);
      if (ey1 !== ey2) {
        const [lift, rem] = divMod(256 * dx, dy);
        mod -= dy;
        while (ey1 !== ey2) {
          delta = lift;
          mod += rem;
          if (mod >= 0) {
            mod -= dy;
            delta += 1;
          }
          const x2 = x + delta;
          renderScanline(ey1, x, 256 - first, x2, first);
          x = x2;
          ey1 += incr;
          setCell(x >> 8, ey1);
        }
      }
      renderScanline(ey1, x, 256 - first, toX, fy2);
    }
    px = toX;
    py = toY;
  };
  for (const c of outline) {
    if (!invalid) recordCell();
    const sx = c[0] * 4;
    const sy = c[1] * 4;
    startCell(sx >> 8, sy >> 8);
    px = sx;
    py = sy;
    for (let i = 2; i + 1 < c.length; i += 2) renderLine(c[i] * 4, c[i + 1] * 4);
    renderLine(sx, sy);
  }
  if (!invalid) recordCell();
  const data = new Uint8Array(countEx * countEy);
  const hline = (x, y, a, count) => {
    let coverage = Math.floor(a / 512);
    if (coverage < 0) coverage = -coverage;
    if (oddEven) {
      coverage &= 511;
      if (coverage > 256) coverage = 512 - coverage;
      else if (coverage === 256) coverage = 255;
    } else if (coverage >= 256) coverage = 255;
    if (coverage) data.fill(coverage, y * countEx + x, y * countEx + x + count);
  };
  for (let yi = 0; yi < countEy; yi += 1) {
    const cells = [...rows[yi].entries()].sort((a, b) => a[0] - b[0]);
    let acc = 0;
    let x = 0;
    for (const [cx, [cellCover, cellArea]] of cells) {
      if (cx > x && acc !== 0) hline(x, yi, acc * 512, cx - x);
      acc += cellCover;
      const a = acc * 512 - cellArea;
      if (a !== 0 && cx >= 0) hline(cx, yi, a, 1);
      x = cx + 1;
    }
    if (countEx > x && acc !== 0) hline(x, yi, acc * 512, countEx - x);
  }
  return { x: minEx, y: minEy, width: countEx, height: countEy, data };
}

// ../engine/src/render/qt/rasterizer.ts
function clipBoxFor(width, height) {
  return { left: 0, top: 0, right: width - 1, bottom: height - 1 };
}
function emit(sink, x, len, y, coverage) {
  if (coverage <= 0 || len <= 0) return;
  sink(x, y, len, coverage > 255 ? 255 : coverage);
}
function fillRectSpans(x, y, w, h, clip, sink) {
  const x1 = Math.max(x, clip.left);
  const x2 = Math.min(x + w, clip.right + 1);
  const y1 = Math.max(y, clip.top);
  const y2 = Math.min(y + h, clip.bottom + 1);
  if (x2 <= x1 || y2 <= y1) return;
  for (let row = y1; row < y2; row += 1) sink(x1, row, x2 - x1, 255);
}
var Q16 = 65536;
function safeQ16(x) {
  const tmp = x * 65536;
  if (tmp > 2147483647) return 2147483647;
  if (tmp < -2147483648) return -2147483647;
  return Math.trunc(tmp);
}
function q16Mul(x, y) {
  return Math.floor(x * y / 65536) | 0;
}
function q16FastMul(x, y) {
  return Math.imul(x, y) >> 16;
}
function q16ToInt(v) {
  return v >> 16;
}
function qSafeDivide(x, y) {
  if (y === 0) return x > 0 ? 1e20 : -1e20;
  return x / y;
}
function q26Dot6Equal(p1, p2) {
  return Math.trunc((p2 - p1) * 64) === 0;
}
function snap26Dot6(v) {
  return Math.floor(v * 64) * (1 / 64);
}
function intersectPixelFP(x, top, bottom, leftIntersectX, rightIntersectX, slope, invSlope) {
  const leftX = x * Q16;
  const rightX = x * Q16 + Q16;
  let leftIntersectY;
  let rightIntersectY;
  if (slope > 0) {
    leftIntersectY = top + q16Mul(leftX - leftIntersectX, invSlope);
    rightIntersectY = leftIntersectY + invSlope;
  } else {
    leftIntersectY = top + q16Mul(leftX - rightIntersectX, invSlope);
    rightIntersectY = leftIntersectY + invSlope;
  }
  if (leftIntersectX >= leftX && rightIntersectX <= rightX) {
    return q16Mul(bottom - top, leftIntersectX - leftX + (rightIntersectX - leftIntersectX >> 1));
  } else if (leftIntersectX >= rightX) {
    return bottom - top;
  } else if (leftIntersectX >= leftX) {
    if (slope > 0) return bottom - top - q16FastMul(rightX - leftIntersectX >> 1, rightIntersectY - top);
    return bottom - top - q16FastMul(rightX - leftIntersectX >> 1, bottom - rightIntersectY);
  } else if (rightIntersectX <= leftX) {
    return 0;
  } else if (rightIntersectX <= rightX) {
    if (slope > 0) return q16FastMul(rightIntersectX - leftX >> 1, bottom - leftIntersectY);
    return q16FastMul(rightIntersectX - leftX >> 1, leftIntersectY - top);
  }
  if (slope > 0) return bottom - rightIntersectY + (rightIntersectY - leftIntersectY >> 1);
  return rightIntersectY - top + (leftIntersectY - rightIntersectY >> 1);
}
function rasterizeLine(ax, ay, bx, by, width, antialiased, clip, sink) {
  if (ax === bx && ay === by || !(width > 0) || clip.right < clip.left || clip.bottom < clip.top) return;
  let pax = ax;
  let pay = ay;
  let pbx = bx;
  let pby = by;
  const offsX = Math.abs(by - ay) * width * 0.5;
  const offsY = Math.abs(bx - ax) * width * 0.5;
  const cLeft = clip.left - offsX;
  const cTop = clip.top - offsY;
  const cRight = clip.right + 1 + offsX;
  const cBottom = clip.bottom + 1 + offsY;
  const contains = (x, y) => cLeft !== cRight && cTop !== cBottom && x >= cLeft && x <= cRight && y >= cTop && y <= cBottom;
  if (!contains(pax, pay) || !contains(pbx, pby)) {
    let t1 = 0;
    let t2 = 1;
    const o = [pax, pay];
    const d = [pbx - pax, pby - pay];
    const low = [cLeft, cTop];
    const high = [cRight, cBottom];
    for (let i = 0; i < 2; i += 1) {
      if (d[i] === 0) {
        if (o[i] <= low[i] || o[i] >= high[i]) return;
        continue;
      }
      const dInv = 1 / d[i];
      let tLow = (low[i] - o[i]) * dInv;
      let tHigh = (high[i] - o[i]) * dInv;
      if (tLow > tHigh) [tLow, tHigh] = [tHigh, tLow];
      if (t1 < tLow) t1 = tLow;
      if (t2 > tHigh) t2 = tHigh;
      if (t1 >= t2) return;
    }
    const npax = pax + (pbx - pax) * t1;
    const npay = pay + (pby - pay) * t1;
    const npbx = pax + (pbx - pax) * t2;
    const npby = pay + (pby - pay) * t2;
    pax = npax;
    pay = npay;
    pbx = npbx;
    pby = npby;
  }
  {
    const d0x = ax - bx;
    const d0y = ay - by;
    const w0 = d0x * d0x + d0y * d0y;
    const dx = pax - pbx;
    const dy = pay - pby;
    const w = dx * dx + dy * dy;
    if (w === 0) return;
    width *= Math.sqrt(w0 / w);
  }
  if (q26Dot6Equal(pay, pby)) {
    const x = (pax + pbx) * 0.5;
    const dx = Math.abs(pbx - pax) * 0.5;
    const y = pay;
    const dy = width * dx;
    pax = x;
    pay = y - dy;
    pbx = x;
    pby = y + dy;
    width = 1 / width;
  }
  if (q26Dot6Equal(pax, pbx)) {
    if (pay > pby) {
      [pax, pbx] = [pbx, pax];
      [pay, pby] = [pby, pay];
    }
    const dy = pby - pay;
    const halfWidth = 0.5 * width * dy;
    let left = pax - halfWidth;
    let right = pax + halfWidth;
    left = Math.min(Math.max(left, clip.left), clip.right + 1);
    right = Math.min(Math.max(right, clip.left), clip.right + 1);
    pay = Math.min(Math.max(pay, clip.top), clip.bottom + 1);
    pby = Math.min(Math.max(pby, clip.top), clip.bottom + 1);
    if (q26Dot6Equal(left, right) || q26Dot6Equal(pay, pby)) return;
    if (antialiased) {
      const iLeft = Math.trunc(left);
      const iRight = Math.trunc(right);
      const leftWidth = (iLeft + 1) * Q16 - safeQ16(left);
      const rightWidth = safeQ16(right) - iRight * Q16;
      const coverage = [];
      const xs = [];
      const lens = [];
      let n = 1;
      if (iLeft === iRight) {
        coverage[0] = (leftWidth + rightWidth) * 255;
        xs[0] = iLeft;
        lens[0] = 1;
      } else {
        coverage[0] = leftWidth * 255;
        xs[0] = iLeft;
        lens[0] = 1;
        if (leftWidth === Q16) {
          lens[0] = iRight - iLeft;
        } else if (iRight - iLeft > 1) {
          coverage[1] = 255 * Q16;
          xs[1] = iLeft + 1;
          lens[1] = iRight - iLeft - 1;
          n += 1;
        }
        if (rightWidth) {
          coverage[n] = rightWidth * 255;
          xs[n] = iRight;
          lens[n] = 1;
          n += 1;
        }
      }
      const iTopFP2 = Math.trunc(pay) * Q16;
      const iBottomFP2 = Math.trunc(pby) * Q16;
      const yPa = safeQ16(pay);
      const yPb = safeQ16(pby);
      for (let yFP2 = iTopFP2; yFP2 <= iBottomFP2; yFP2 += Q16) {
        const rowHeight = Math.min(yFP2 + Q16, yPb) - Math.max(yFP2, yPa);
        const y = q16ToInt(yFP2);
        if (y > clip.bottom) break;
        for (let i = 0; i < n; i += 1) {
          emit(sink, xs[i], lens[i], y, q16ToInt(q16Mul(rowHeight, coverage[i])));
        }
      }
    } else {
      const iTop = Math.trunc(pay + 0.5);
      const iBottom = pby < 0.5 ? -1 : Math.trunc(pby - 0.5);
      const iLeft = Math.trunc(left + 0.5);
      const iRight = right < 0.5 ? -1 : Math.trunc(right - 0.5);
      const iWidth = iRight - iLeft + 1;
      for (let y = iTop; y <= iBottom; y += 1) emit(sink, iLeft, iWidth, y, 255);
    }
    return;
  }
  if (pay > pby) {
    [pax, pbx] = [pbx, pax];
    [pay, pby] = [pby, pay];
  }
  const deltaX = (pbx - pax) * 0.5 * width;
  const deltaY = (pby - pay) * 0.5 * width;
  const perpX = deltaY;
  const perpY = -deltaX;
  let topX, topY, leftX, leftY, rightX, rightY, bottomX, bottomY;
  if (pax < pbx) {
    topX = pax + perpX;
    topY = pay + perpY;
    leftX = pax - perpX;
    leftY = pay - perpY;
    rightX = pbx + perpX;
    rightY = pby + perpY;
    bottomX = pbx - perpX;
    bottomY = pby - perpY;
  } else {
    topX = pax - perpX;
    topY = pay - perpY;
    leftX = pbx - perpX;
    leftY = pby - perpY;
    rightX = pax + perpX;
    rightY = pay + perpY;
    bottomX = pbx + perpX;
    bottomY = pby + perpY;
  }
  topX = snap26Dot6(topX);
  topY = snap26Dot6(topY);
  bottomX = snap26Dot6(bottomX);
  bottomY = snap26Dot6(bottomY);
  leftX = snap26Dot6(leftX);
  leftY = snap26Dot6(leftY);
  rightX = snap26Dot6(rightX);
  rightY = snap26Dot6(rightY);
  const topBound = Math.min(Math.max(topY, clip.top), clip.bottom);
  const bottomBound = Math.min(Math.max(bottomY, clip.top), clip.bottom);
  const topLeftSlope = qSafeDivide(leftX - topX, leftY - topY);
  const bottomLeftSlope = qSafeDivide(bottomX - leftX, bottomY - leftY);
  const topRightSlope = qSafeDivide(rightX - topX, rightY - topY);
  const bottomRightSlope = qSafeDivide(bottomX - rightX, bottomY - rightY);
  const topLeftSlopeFP = safeQ16(topLeftSlope);
  const topRightSlopeFP = safeQ16(topRightSlope);
  const bottomLeftSlopeFP = safeQ16(bottomLeftSlope);
  const bottomRightSlopeFP = safeQ16(bottomRightSlope);
  if (!antialiased) {
    const iTop = Math.trunc(topY + 0.5);
    const iLeft = leftY < 0.5 ? -1 : Math.trunc(leftY - 0.5);
    const iRight = rightY < 0.5 ? -1 : Math.trunc(rightY - 0.5);
    const iBottom = bottomY < 0.5 ? -1 : Math.trunc(bottomY - 0.5);
    const iMiddle = Math.min(iLeft, iRight);
    let leftIntersectAf2 = safeQ16(topX + 0.5 + (iTop + 0.5 - topY) * topLeftSlope);
    let leftIntersectBf2 = safeQ16(leftX + 0.5 + (iLeft + 1.5 - leftY) * bottomLeftSlope);
    let rightIntersectAf2 = safeQ16(topX - 0.5 + (iTop + 0.5 - topY) * topRightSlope);
    let rightIntersectBf2 = safeQ16(rightX - 0.5 + (iRight + 1.5 - rightY) * bottomRightSlope);
    let y = iTop;
    const segment = (next, useLeftB, useRightB) => {
      const ls = useLeftB ? bottomLeftSlopeFP : topLeftSlopeFP;
      const rs = useRightB ? bottomRightSlopeFP : topRightSlopeFP;
      let li = useLeftB ? leftIntersectBf2 : leftIntersectAf2;
      let ri = useRightB ? rightIntersectBf2 : rightIntersectAf2;
      const ny = Math.min(next + 1, clip.top);
      if (y < ny) {
        li = li + Math.imul(ls, ny - y) | 0;
        ri = ri + Math.imul(rs, ny - y) | 0;
        y = ny;
      }
      if (next > clip.bottom) next = clip.bottom;
      for (; y <= next; y += 1) {
        const x1 = Math.max(q16ToInt(li), clip.left);
        const x2 = Math.min(q16ToInt(ri), clip.right);
        if (x2 >= x1) emit(sink, x1, x2 - x1 + 1, y, 255);
        li = li + ls | 0;
        ri = ri + rs | 0;
      }
      if (useLeftB) leftIntersectBf2 = li;
      else leftIntersectAf2 = li;
      if (useRightB) rightIntersectBf2 = ri;
      else rightIntersectAf2 = ri;
    };
    segment(iMiddle, false, false);
    segment(iRight, true, false);
    segment(iLeft, false, true);
    segment(iBottom, true, true);
    return;
  }
  const invTopLeftSlopeFP = safeQ16(qSafeDivide(1, topLeftSlope));
  const invTopRightSlopeFP = safeQ16(qSafeDivide(1, topRightSlope));
  const invBottomLeftSlopeFP = safeQ16(qSafeDivide(1, bottomLeftSlope));
  const invBottomRightSlopeFP = safeQ16(qSafeDivide(1, bottomRightSlope));
  const iTopFP = Math.trunc(topBound) * Q16;
  const iLeftFP = Math.trunc(leftY) * Q16;
  const iRightFP = Math.trunc(rightY) * Q16;
  const iBottomFP = Math.trunc(bottomBound) * Q16;
  let leftIntersectAf = safeQ16(topX + (Math.trunc(topBound) - topY) * topLeftSlope);
  let rightIntersectAf = safeQ16(topX + (Math.trunc(topBound) - topY) * topRightSlope);
  let leftIntersectBf = 0;
  let rightIntersectBf = 0;
  if (iLeftFP < iTopFP) leftIntersectBf = safeQ16(leftX + (Math.trunc(topBound) - leftY) * bottomLeftSlope);
  if (iRightFP < iTopFP) rightIntersectBf = safeQ16(rightX + (Math.trunc(topBound) - rightY) * bottomRightSlope);
  const yTopFP = safeQ16(topY);
  const yLeftFP = safeQ16(leftY);
  const yRightFP = safeQ16(rightY);
  const yBottomFP = safeQ16(bottomY);
  let rowTop = Math.max(iTopFP, yTopFP);
  let topLeftIntersectAf = leftIntersectAf + q16Mul(topLeftSlopeFP, rowTop - iTopFP);
  let topRightIntersectAf = rightIntersectAf + q16Mul(topRightSlopeFP, rowTop - iTopFP);
  let yFP = iTopFP;
  while (yFP <= iBottomFP) {
    const rowBottomLeft = Math.min(yFP + Q16, yLeftFP);
    const rowBottomRight = Math.min(yFP + Q16, yRightFP);
    const rowTopLeft = Math.max(yFP, yLeftFP);
    const rowTopRight = Math.max(yFP, yRightFP);
    const rowBottom = Math.min(yFP + Q16, yBottomFP);
    let topLeftIntersectBf;
    let bottomLeftIntersectAf;
    let topRightIntersectBf;
    let bottomRightIntersectAf;
    let bottomLeftIntersectBf;
    let bottomRightIntersectBf;
    if (yFP === iLeftFP) {
      const y = q16ToInt(yFP);
      leftIntersectBf = safeQ16(leftX + (y - leftY) * bottomLeftSlope);
      topLeftIntersectBf = leftIntersectBf + q16Mul(bottomLeftSlopeFP, rowTopLeft - yFP);
      bottomLeftIntersectAf = leftIntersectAf + q16Mul(topLeftSlopeFP, rowBottomLeft - yFP);
    } else {
      topLeftIntersectBf = leftIntersectBf;
      bottomLeftIntersectAf = leftIntersectAf + topLeftSlopeFP;
    }
    if (yFP === iRightFP) {
      const y = q16ToInt(yFP);
      rightIntersectBf = safeQ16(rightX + (y - rightY) * bottomRightSlope);
      topRightIntersectBf = rightIntersectBf + q16Mul(bottomRightSlopeFP, rowTopRight - yFP);
      bottomRightIntersectAf = rightIntersectAf + q16Mul(topRightSlopeFP, rowBottomRight - yFP);
    } else {
      topRightIntersectBf = rightIntersectBf;
      bottomRightIntersectAf = rightIntersectAf + topRightSlopeFP;
    }
    if (yFP === iBottomFP) {
      bottomLeftIntersectBf = leftIntersectBf + q16Mul(bottomLeftSlopeFP, rowBottom - yFP);
      bottomRightIntersectBf = rightIntersectBf + q16Mul(bottomRightSlopeFP, rowBottom - yFP);
    } else {
      bottomLeftIntersectBf = leftIntersectBf + bottomLeftSlopeFP;
      bottomRightIntersectBf = rightIntersectBf + bottomRightSlopeFP;
    }
    let leftMin, leftMax, rightMin, rightMax;
    if (yFP < iLeftFP) {
      leftMin = q16ToInt(bottomLeftIntersectAf);
      leftMax = q16ToInt(topLeftIntersectAf);
    } else if (yFP === iLeftFP) {
      leftMin = q16ToInt(Math.max(bottomLeftIntersectAf, topLeftIntersectBf));
      leftMax = q16ToInt(Math.max(topLeftIntersectAf, bottomLeftIntersectBf));
    } else {
      leftMin = q16ToInt(topLeftIntersectBf);
      leftMax = q16ToInt(bottomLeftIntersectBf);
    }
    leftMin = Math.min(Math.max(leftMin, clip.left), clip.right);
    leftMax = Math.min(Math.max(leftMax, clip.left), clip.right);
    if (yFP < iRightFP) {
      rightMin = q16ToInt(topRightIntersectAf);
      rightMax = q16ToInt(bottomRightIntersectAf);
    } else if (yFP === iRightFP) {
      rightMin = q16ToInt(Math.min(topRightIntersectAf, bottomRightIntersectBf));
      rightMax = q16ToInt(Math.min(bottomRightIntersectAf, topRightIntersectBf));
    } else {
      rightMin = q16ToInt(bottomRightIntersectBf);
      rightMax = q16ToInt(topRightIntersectBf);
    }
    rightMin = Math.min(Math.max(rightMin, clip.left), clip.right);
    rightMax = Math.min(Math.max(rightMax, clip.left), clip.right);
    if (leftMax > rightMax) leftMax = rightMax;
    if (rightMin < leftMin) rightMin = leftMin;
    const rowHeight = rowBottom - rowTop;
    const row = q16ToInt(yFP);
    let x = leftMin;
    while (x <= leftMax) {
      let excluded = 0;
      if (yFP <= iLeftFP) {
        excluded += intersectPixelFP(x, rowTop, rowBottomLeft, bottomLeftIntersectAf, topLeftIntersectAf, topLeftSlopeFP, invTopLeftSlopeFP);
      }
      if (yFP >= iLeftFP) {
        excluded += intersectPixelFP(x, rowTopLeft, rowBottom, topLeftIntersectBf, bottomLeftIntersectBf, bottomLeftSlopeFP, invBottomLeftSlopeFP);
      }
      if (x >= rightMin) {
        if (yFP <= iRightFP) {
          excluded += rowBottomRight - rowTop - intersectPixelFP(x, rowTop, rowBottomRight, topRightIntersectAf, bottomRightIntersectAf, topRightSlopeFP, invTopRightSlopeFP);
        }
        if (yFP >= iRightFP) {
          excluded += rowBottom - rowTopRight - intersectPixelFP(x, rowTopRight, rowBottom, bottomRightIntersectBf, topRightIntersectBf, bottomRightSlopeFP, invBottomRightSlopeFP);
        }
      }
      emit(sink, x, 1, row, q16ToInt(255 * (rowHeight - excluded)));
      x += 1;
    }
    if (x < rightMin) {
      emit(sink, x, rightMin - x, row, q16ToInt(255 * rowHeight));
      x = rightMin;
    }
    while (x <= rightMax) {
      let excluded = 0;
      if (yFP <= iRightFP) {
        excluded += rowBottomRight - rowTop - intersectPixelFP(x, rowTop, rowBottomRight, topRightIntersectAf, bottomRightIntersectAf, topRightSlopeFP, invTopRightSlopeFP);
      }
      if (yFP >= iRightFP) {
        excluded += rowBottom - rowTopRight - intersectPixelFP(x, rowTopRight, rowBottom, bottomRightIntersectBf, topRightIntersectBf, bottomRightSlopeFP, invBottomRightSlopeFP);
      }
      emit(sink, x, 1, row, q16ToInt(255 * (rowHeight - excluded)));
      x += 1;
    }
    leftIntersectAf += topLeftSlopeFP;
    leftIntersectBf += bottomLeftSlopeFP;
    rightIntersectAf += topRightSlopeFP;
    rightIntersectBf += bottomRightSlopeFP;
    topLeftIntersectAf = leftIntersectAf;
    topRightIntersectAf = rightIntersectAf;
    yFP += Q16;
    rowTop = yFP;
  }
}
function rasterizePolygonsAliased(subpaths, oddEven, clip, sink) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pts of subpaths) {
    for (let i = 1; i < pts.length; i += 2) {
      minY = Math.min(minY, pts[i]);
      maxY = Math.max(maxY, pts[i]);
    }
  }
  if (!Number.isFinite(minY)) return;
  const top = Math.max(clip.top, Math.trunc(minY + 0.5));
  const bottom = Math.min(clip.bottom, Math.trunc(maxY - 0.5));
  if (top > bottom) return;
  const leftFP = clip.left * Q16;
  const rightFP = (clip.right + 1) * Q16;
  const lines = [];
  const clipEdge = (st, slopeFP, edgeFP, winding) => {
    const right = edgeFP === rightFP;
    if (st.xFP === edgeFP) {
      if (slopeFP > 0 !== right) return false;
      lines.push({ x: edgeFP, delta: 0, top: st.iTop, bottom: st.iBottom, winding });
      return true;
    }
    const lastFP = st.xFP + slopeFP * (st.iBottom - st.iTop);
    if (lastFP === edgeFP) {
      if (slopeFP < 0 !== right) return false;
      lines.push({ x: edgeFP, delta: 0, top: st.iTop, bottom: st.iBottom, winding });
      return true;
    }
    if (lastFP < edgeFP !== st.xFP < edgeFP) {
      const deltaY = Math.trunc((edgeFP - st.xFP) / (slopeFP / 65536));
      if (st.xFP < edgeFP !== right) {
        const iHeight = q16ToInt(deltaY + 1);
        const iMiddle = st.iTop + iHeight;
        lines.push({ x: edgeFP, delta: 0, top: st.iTop, bottom: iMiddle, winding });
        if (iMiddle !== st.iBottom) {
          st.xFP += slopeFP * (iHeight + 1);
          st.iTop = iMiddle + 1;
        } else return true;
      } else {
        const iHeight = q16ToInt(deltaY);
        const iMiddle = st.iTop + iHeight;
        if (iMiddle !== st.iBottom) {
          lines.push({ x: edgeFP, delta: 0, top: iMiddle + 1, bottom: st.iBottom, winding });
          st.iBottom = iMiddle;
        }
      }
      return false;
    } else if (st.xFP < edgeFP !== right) {
      lines.push({ x: edgeFP, delta: 0, top: st.iTop, bottom: st.iBottom, winding });
      return true;
    }
    return false;
  };
  const mergeLine = (ax, ay, bx, by) => {
    let winding = 1;
    if (ay > by) {
      [ax, bx] = [bx, ax];
      [ay, by] = [by, ay];
      winding = -1;
    }
    const iTop = Math.max(top, ay + 32 >> 6);
    const iBottom = Math.min(bottom, by - 32 >> 6);
    if (iTop > iBottom) return;
    const aFP = Q16 / 2 + ax * 1024;
    if (bx === ax) {
      lines.push({ x: Math.min(Math.max(aFP, leftFP), rightFP), delta: 0, top: iTop, bottom: iBottom, winding });
      return;
    }
    const slope = (bx - ax) / (by - ay);
    const slopeFP = Math.trunc(slope * 65536);
    const st = { xFP: aFP + q16Mul(slopeFP, iTop * Q16 + Q16 / 2 - ay * 1024), iTop, iBottom };
    if (clipEdge(st, slopeFP, leftFP, winding)) return;
    if (clipEdge(st, slopeFP, rightFP, winding)) return;
    lines.push({ x: st.xFP, delta: slopeFP, top: st.iTop, bottom: st.iBottom, winding });
  };
  for (const pts of subpaths) {
    const n = pts.length >> 1;
    if (n < 2) continue;
    const vx = (i) => Math.trunc(pts[i * 2] * 64);
    const vy = (i) => Math.trunc(pts[i * 2 + 1] * 64);
    for (let i = 0; i < n - 1; i += 1) mergeLine(vx(i), vy(i), vx(i + 1), vy(i + 1));
    if (vx(0) !== vx(n - 1) || vy(0) !== vy(n - 1)) mergeLine(vx(n - 1), vy(n - 1), vx(0), vy(0));
  }
  if (lines.length === 0) return;
  lines.sort((a, b) => a.top - b.top);
  const mask2 = oddEven ? 1 : ~0;
  const active = [];
  let next = 0;
  for (let y = lines[0].top; y <= bottom; y += 1) {
    for (; next < lines.length && lines[next].top === y; next += 1) active.push(lines[next]);
    for (let i = 1; i < active.length; i += 1) {
      const l = active[i];
      let j = i - 1;
      for (; j >= 0 && l.x < active[j].x; j -= 1) active[j + 1] = active[j];
      active[j + 1] = l;
    }
    let x = 0;
    let winding = 0;
    for (let i = 0; i < active.length; i += 1) {
      const node = active[i];
      const current = q16ToInt(node.x);
      if (winding & mask2) emit(sink, x, current - x, y, 255);
      x = current;
      winding += node.winding;
      if (node.bottom === y) {
        active.splice(i, 1);
        i -= 1;
      } else node.x += node.delta;
    }
  }
}
function maskSpans(mask2, sink) {
  for (let row = 0; row < mask2.height; row += 1) {
    const base = row * mask2.width;
    let col = 0;
    while (col < mask2.width) {
      const c = mask2.data[base + col];
      let end = col + 1;
      while (end < mask2.width && mask2.data[base + end] === c) end += 1;
      if (c > 0) sink(mask2.x + col, mask2.y + row, end - col, c);
      col = end;
    }
  }
}

// ../engine/src/render/kernels/audio-visualization-stroke.ts
var MOVE_TO = 0;
var LINE_TO = 1;
var CURVE_TO = 2;
var CURVE_DATA = 3;
function newPath() {
  return { types: [], pts: [] };
}
function fuzzyCompare2(p1, p2) {
  return Math.abs(p1 - p2) * 1e12 <= Math.min(Math.abs(p1), Math.abs(p2));
}
function fuzzyIsNull(d) {
  return Math.abs(d) <= 1e-12;
}
function pointsEqual(x1, y1, x2, y2) {
  const ex = x1 === 0 || x2 === 0 ? fuzzyIsNull(x1 - x2) : fuzzyCompare2(x1, x2);
  const ey = y1 === 0 || y2 === 0 ? fuzzyIsNull(y1 - y2) : fuzzyCompare2(y1, y2);
  return ex && ey;
}
function moveTo(path3, x, y) {
  const n = path3.types.length;
  if (n > 0 && path3.types[n - 1] === MOVE_TO) {
    path3.pts[(n - 1) * 2] = x;
    path3.pts[(n - 1) * 2 + 1] = y;
    return;
  }
  path3.types.push(MOVE_TO);
  path3.pts.push(x, y);
}
function lineTo(path3, x, y) {
  const n = path3.types.length;
  if (n > 0 && pointsEqual(x, y, path3.pts[(n - 1) * 2], path3.pts[(n - 1) * 2 + 1])) return;
  path3.types.push(LINE_TO);
  path3.pts.push(x, y);
}
function cubicTo(path3, c1x, c1y, c2x, c2y, ex, ey) {
  const n = path3.types.length;
  const lx = path3.pts[(n - 1) * 2];
  const ly = path3.pts[(n - 1) * 2 + 1];
  if (pointsEqual(lx, ly, c1x, c1y) && pointsEqual(c1x, c1y, c2x, c2y) && pointsEqual(c2x, c2y, ex, ey)) return;
  path3.types.push(CURVE_TO, CURVE_DATA, CURVE_DATA);
  path3.pts.push(c1x, c1y, c2x, c2y, ex, ey);
}
function line(x1, y1, x2, y2) {
  return { x1, y1, x2, y2 };
}
function lineLength(l) {
  return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
}
function lineIsNull(l) {
  return fuzzyCompare2(l.x1, l.x2) && fuzzyCompare2(l.y1, l.y2);
}
function lineAngle(l) {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const theta = Math.atan2(-dy, dx) * 360 / (2 * Math.PI);
  const normalized = theta < 0 ? theta + 360 : theta;
  return fuzzyCompare2(normalized, 360) ? 0 : normalized;
}
function angleTo(a, b) {
  if (lineIsNull(a) || lineIsNull(b)) return 0;
  const delta = lineAngle(b) - lineAngle(a);
  const normalized = delta < 0 ? delta + 360 : delta;
  return fuzzyCompare2(delta, 360) ? 0 : normalized;
}
function setLength(l, len) {
  const old = lineLength(l);
  if (!(old > 0)) return l;
  return { x1: l.x1, y1: l.y1, x2: l.x1 + len * ((l.x2 - l.x1) / old), y2: l.y1 + len * ((l.y2 - l.y1) / old) };
}
function translated(l, dx, dy) {
  return { x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy };
}
function normalVector(l) {
  return { x1: l.x1, y1: l.y1, x2: l.x1 + (l.y2 - l.y1), y2: l.y1 - (l.x2 - l.x1) };
}
function unitVector(l) {
  const x = l.x2 - l.x1;
  const y = l.y2 - l.y1;
  const len = Math.hypot(x, y);
  return { x1: l.x1, y1: l.y1, x2: l.x1 + x / len, y2: l.y1 + y / len };
}
var NO_INTERSECTION = 0;
var BOUNDED = 1;
var UNBOUNDED = 2;
function intersects(a, b) {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x1 - b.x2;
  const by = b.y1 - b.y2;
  const cx = a.x1 - b.x1;
  const cy = a.y1 - b.y1;
  const denominator = ay * bx - ax * by;
  if (denominator === 0 || !Number.isFinite(denominator)) return { type: NO_INTERSECTION, x: 0, y: 0 };
  const reciprocal = 1 / denominator;
  const na = (by * cx - bx * cy) * reciprocal;
  const x = a.x1 + ax * na;
  const y = a.y1 + ay * na;
  if (na < 0 || na > 1) return { type: UNBOUNDED, x, y };
  const nb = (ax * cy - ay * cx) * reciprocal;
  if (nb < 0 || nb > 1) return { type: UNBOUNDED, x, y };
  return { type: BOUNDED, x, y };
}
function splitBezier(b) {
  const m12x = (b[0] + b[2]) * 0.5;
  const m12y = (b[1] + b[3]) * 0.5;
  const m23x = (b[2] + b[4]) * 0.5;
  const m23y = (b[3] + b[5]) * 0.5;
  const m34x = (b[4] + b[6]) * 0.5;
  const m34y = (b[5] + b[7]) * 0.5;
  const m123x = (m12x + m23x) * 0.5;
  const m123y = (m12y + m23y) * 0.5;
  const m234x = (m23x + m34x) * 0.5;
  const m234y = (m23y + m34y) * 0.5;
  const mx = (m123x + m234x) * 0.5;
  const my = (m123y + m234y) * 0.5;
  return [
    [b[0], b[1], m12x, m12y, m123x, m123y, mx, my],
    [mx, my, m234x, m234y, m34x, m34y, b[6], b[7]]
  ];
}
function flattenBezier(start, threshold, out) {
  const stack = [start];
  const levels = [9];
  while (stack.length > 0) {
    const top = stack.length - 1;
    const b = stack[top];
    const y4y1 = b[7] - b[1];
    const x4x1 = b[6] - b[0];
    let l = Math.abs(x4x1) + Math.abs(y4y1);
    let d;
    if (l > 1) {
      d = Math.abs(x4x1 * (b[1] - b[3]) - y4y1 * (b[0] - b[2])) + Math.abs(x4x1 * (b[1] - b[5]) - y4y1 * (b[0] - b[4]));
    } else {
      d = Math.abs(b[0] - b[2]) + Math.abs(b[1] - b[3]) + Math.abs(b[0] - b[4]) + Math.abs(b[1] - b[5]);
      l = 1;
    }
    if (d < threshold * l || levels[top] === 0) {
      out.push(b[6], b[7]);
      stack.pop();
      levels.pop();
    } else {
      const [first, second] = splitBezier(b);
      const level = levels[top] - 1;
      stack[top] = second;
      levels[top] = level;
      stack.push(first);
      levels.push(level);
    }
  }
}
function pointAt(b, t) {
  const mt = 1 - t;
  let a = b[0] * mt + b[2] * t;
  let bb = b[2] * mt + b[4] * t;
  const c = b[4] * mt + b[6] * t;
  a = a * mt + bb * t;
  bb = bb * mt + c * t;
  const x = a * mt + bb * t;
  let ay = b[1] * mt + b[3] * t;
  let by = b[3] * mt + b[5] * t;
  const cy = b[5] * mt + b[7] * t;
  ay = ay * mt + by * t;
  by = by * mt + cy * t;
  return [x, ay * mt + by * t];
}
function bezierNormal(b, t) {
  const mt = 1 - t;
  const a = mt * mt;
  const bb = t * mt;
  const c = t * t;
  return [(b[3] - b[1]) * a + (b[5] - b[3]) * bb + (b[7] - b[5]) * c, -(b[2] - b[0]) * a - (b[4] - b[2]) * bb - (b[6] - b[4]) * c];
}
function parameterSplitLeft(src, t) {
  const b = [...src];
  const left = [0, 0, 0, 0, 0, 0, 0, 0];
  left[0] = b[0];
  left[1] = b[1];
  left[2] = b[0] + t * (b[2] - b[0]);
  left[3] = b[1] + t * (b[3] - b[1]);
  left[4] = b[2] + t * (b[4] - b[2]);
  left[5] = b[3] + t * (b[5] - b[3]);
  b[4] = b[4] + t * (b[6] - b[4]);
  b[5] = b[5] + t * (b[7] - b[5]);
  b[2] = left[4] + t * (b[4] - left[4]);
  b[3] = left[5] + t * (b[5] - left[5]);
  left[4] = left[2] + t * (left[4] - left[2]);
  left[5] = left[3] + t * (left[5] - left[3]);
  left[6] = b[0] = left[4] + t * (b[2] - left[4]);
  left[7] = b[1] = left[5] + t * (b[3] - left[5]);
  return [left, b];
}
function bezierOnInterval(b, t0, t1) {
  if (t0 === 0 && t1 === 1) return b;
  const [, right] = parameterSplitLeft(b, t0);
  const trueT = (t1 - t0) / (1 - t0);
  return parameterSplitLeft(right, trueT)[0];
}
function bounds(b) {
  let xmin = b[0];
  let xmax = b[0];
  let ymin = b[1];
  let ymax = b[1];
  for (let i = 2; i < 8; i += 2) {
    if (b[i] < xmin) xmin = b[i];
    else if (b[i] > xmax) xmax = b[i];
    if (b[i + 1] < ymin) ymin = b[i + 1];
    else if (b[i + 1] > ymax) ymax = b[i + 1];
  }
  return { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
}
var SHIFT_OK = 0;
var SHIFT_DISCARD = 1;
var SHIFT_SPLIT = 2;
var SHIFT_CIRCLE = 3;
function goodOffset(b1, b2, offset, threshold) {
  const o2 = offset * offset;
  const maxDistLine = threshold * offset * offset;
  const maxDistNormal = threshold * offset;
  for (let i = 0.25; i < 0.99; i += 0.25) {
    const [p1x, p1y] = pointAt(b1, i);
    const [p2x, p2y] = pointAt(b2, i);
    let d = (p1x - p2x) * (p1x - p2x) + (p1y - p2y) * (p1y - p2y);
    if (Math.abs(d - o2) > maxDistLine) return SHIFT_SPLIT;
    const [nx, ny] = bezierNormal(b1, i);
    const l = Math.abs(nx) + Math.abs(ny);
    if (l !== 0) {
      d = Math.abs(nx * (p1y - p2y) - ny * (p1x - p2x)) / l;
      if (d > maxDistNormal) return SHIFT_SPLIT;
    }
  }
  return SHIFT_OK;
}
function shiftBezier(orig, offset, threshold) {
  const map = [0, 0, 0, 0];
  const p12 = fuzzyCompare2(orig[0], orig[2]) && fuzzyCompare2(orig[1], orig[3]);
  const p23 = fuzzyCompare2(orig[2], orig[4]) && fuzzyCompare2(orig[3], orig[5]);
  const p34 = fuzzyCompare2(orig[4], orig[6]) && fuzzyCompare2(orig[5], orig[7]);
  const px = [orig[0]];
  const py = [orig[1]];
  map[0] = 0;
  if (!p12) {
    px.push(orig[2]);
    py.push(orig[3]);
  }
  map[1] = px.length - 1;
  if (!p23) {
    px.push(orig[4]);
    py.push(orig[5]);
  }
  map[2] = px.length - 1;
  if (!p34) {
    px.push(orig[6]);
    py.push(orig[7]);
  }
  map[3] = px.length - 1;
  const np = px.length;
  const empty = [0, 0, 0, 0, 0, 0, 0, 0];
  if (np === 1) return { result: SHIFT_DISCARD, curve: empty };
  const bb = bounds(orig);
  if (np === 4 && bb.w < 0.1 * offset && bb.h < 0.1 * offset) {
    const l = (orig[0] - orig[2]) * (orig[0] - orig[2]) + (orig[1] - orig[3]) * (orig[1] - orig[3]) * (orig[4] - orig[6]) * (orig[4] - orig[6]) + (orig[5] - orig[7]) * (orig[5] - orig[7]);
    const dot = (orig[0] - orig[2]) * (orig[4] - orig[6]) + (orig[1] - orig[3]) * (orig[5] - orig[7]);
    if (dot < 0 && dot * dot < 0.8 * l) return { result: SHIFT_CIRCLE, curve: empty };
  }
  const sx = new Array(np).fill(0);
  const sy = new Array(np).fill(0);
  let prev = line(0, 0, px[1] - px[0], py[1] - py[0]);
  if (!lineLength(prev)) return { result: SHIFT_DISCARD, curve: empty };
  let prevNormal = unitVector(normalVector(prev));
  let pnx = prevNormal.x2;
  let pny = prevNormal.y2;
  sx[0] = px[0] + offset * pnx;
  sy[0] = py[0] + offset * pny;
  for (let i = 1; i < np - 1; i += 1) {
    const next = line(0, 0, px[i + 1] - px[i], py[i + 1] - py[i]);
    const nextNormal = unitVector(normalVector(next));
    const nnx = nextNormal.x2;
    const nny = nextNormal.y2;
    const r = 1 + pnx * nnx + pny * nny;
    if (fuzzyIsNull(r)) {
      sx[i] = px[i] + offset * pnx;
      sy[i] = py[i] + offset * pny;
    } else {
      const k = offset / r;
      sx[i] = px[i] + k * (pnx + nnx);
      sy[i] = py[i] + k * (pny + nny);
    }
    pnx = nnx;
    pny = nny;
    prev = next;
    prevNormal = nextNormal;
  }
  sx[np - 1] = px[np - 1] + offset * pnx;
  sy[np - 1] = py[np - 1] + offset * pny;
  const curve = [sx[map[0]], sy[map[0]], sx[map[1]], sy[map[1]], sx[map[2]], sy[map[2]], sx[map[3]], sy[map[3]]];
  if (np > 2) return { result: goodOffset(orig, curve, offset, threshold), curve };
  return { result: SHIFT_OK, curve };
}
var KAPPA = 0.5522847498;
function addCircle(b, offset) {
  const normals = [
    [b[3] - b[1], b[0] - b[2]],
    [0, 0],
    [b[7] - b[5], b[4] - b[6]]
  ];
  let dist = Math.sqrt(normals[0][0] * normals[0][0] + normals[0][1] * normals[0][1]);
  if (fuzzyIsNull(dist)) return null;
  normals[0] = [normals[0][0] / dist, normals[0][1] / dist];
  dist = Math.sqrt(normals[2][0] * normals[2][0] + normals[2][1] * normals[2][1]);
  if (fuzzyIsNull(dist)) return null;
  normals[2] = [normals[2][0] / dist, normals[2][1] / dist];
  const n1x = b[0] - b[2] - b[4] + b[6];
  const n1y = b[1] - b[3] - b[5] + b[7];
  const n1len = -1 * Math.sqrt(n1x * n1x + n1y * n1y);
  normals[1] = [n1x / n1len, n1y / n1len];
  const angles = [0, 0];
  let sign = 1;
  for (let i = 0; i < 2; i += 1) {
    let cosA = normals[i][0] * normals[i + 1][0] + normals[i][1] * normals[i + 1][1];
    if (cosA > 1) cosA = 1;
    if (cosA < -1) cosA = -1;
    angles[i] = Math.acos(cosA) / Math.PI;
  }
  if (angles[0] + angles[1] > 1) {
    normals[1] = [-normals[1][0], -normals[1][1]];
    angles[0] = 1 - angles[0];
    angles[1] = 1 - angles[1];
    sign = -1;
  }
  const circle = [
    [b[0] + normals[0][0] * offset, b[1] + normals[0][1] * offset],
    [0.5 * (b[0] + b[6]) + normals[1][0] * offset, 0.5 * (b[1] + b[7]) + normals[1][1] * offset],
    [b[6] + normals[2][0] * offset, b[7] + normals[2][1] * offset]
  ];
  const out = [];
  for (let i = 0; i < 2; i += 1) {
    const kappa = 2 * KAPPA * sign * offset * angles[i];
    out.push([
      circle[i][0],
      circle[i][1],
      circle[i][0] - normals[i][1] * kappa,
      circle[i][1] + normals[i][0] * kappa,
      circle[i + 1][0] + normals[i + 1][1] * kappa,
      circle[i + 1][1] - normals[i + 1][0] * kappa,
      circle[i + 1][0],
      circle[i + 1][1]
    ]);
  }
  return out;
}
function shiftedBeziers(b, maxSegments, offset, thresholdIn) {
  if (fuzzyCompare2(b[0], b[2]) && fuzzyCompare2(b[0], b[4]) && fuzzyCompare2(b[0], b[6]) && fuzzyCompare2(b[1], b[3]) && fuzzyCompare2(b[1], b[5]) && fuzzyCompare2(b[1], b[7])) {
    return [];
  }
  const max = maxSegments - 1;
  let threshold = Math.fround(thresholdIn);
  for (; ; ) {
    const stack = [b];
    const out = [];
    let redo = false;
    let giveUp = false;
    while (stack.length > 0) {
      const stackSegments = stack.length;
      if (stackSegments === 10 || out.length === max - stackSegments) {
        threshold = Math.fround(threshold * 1.5);
        if (threshold > 2) giveUp = true;
        else redo = true;
        break;
      }
      const top = stack[stack.length - 1];
      const res = shiftBezier(top, offset, threshold);
      if (res.result === SHIFT_DISCARD) stack.pop();
      else if (res.result === SHIFT_OK) {
        out.push(res.curve);
        stack.pop();
      } else if (res.result === SHIFT_CIRCLE && max - out.length >= 2) {
        const circle = addCircle(top, offset);
        if (circle) out.push(...circle);
        stack.pop();
      } else {
        const [first, second] = splitBezier(top);
        stack[stack.length - 1] = second;
        stack.push(first);
      }
    }
    if (redo) continue;
    if (giveUp) {
      while (stack.length > 0) {
        const res = shiftBezier(stack[stack.length - 1], offset, threshold);
        if (res.result === SHIFT_OK || res.result === SHIFT_SPLIT) out.push(res.curve);
        stack.pop();
      }
    }
    return out;
  }
}
function startTangent(b) {
  let t = line(b[0], b[1], b[2], b[3]);
  if (lineIsNull(t)) t = line(b[0], b[1], b[4], b[5]);
  if (lineIsNull(t)) t = line(b[0], b[1], b[6], b[7]);
  return t;
}
function tForArc(angle) {
  if (fuzzyIsNull(angle)) return 0;
  if (fuzzyCompare2(angle, 90)) return 1;
  const radians = angle * (Math.PI / 180);
  const cosAngle = Math.cos(radians);
  const sinAngle = Math.sin(radians);
  const K = KAPPA;
  let tc = angle / 90;
  tc -= (((2 - 3 * K) * tc + 3 * (K - 1)) * tc * tc + 1 - cosAngle) / (((6 - 9 * K) * tc + 6 * (K - 1)) * tc);
  tc -= (((2 - 3 * K) * tc + 3 * (K - 1)) * tc * tc + 1 - cosAngle) / (((6 - 9 * K) * tc + 6 * (K - 1)) * tc);
  let ts = tc;
  ts -= ((((3 * K - 2) * ts - 6 * K + 3) * ts + 3 * K) * ts - sinAngle) / (((9 * K - 6) * ts + 12 * K - 6) * ts + 3 * K);
  ts -= ((((3 * K - 2) * ts - 6 * K + 3) * ts + 3 * K) * ts - sinAngle) / (((9 * K - 6) * ts + 12 * K - 6) * ts + 3 * K);
  return 0.5 * (tc + ts);
}
function ellipseCoords(rx, ry, rw, rh, angle, length) {
  if (rw === 0 && rh === 0) return [0, 0, 0, 0];
  const w2 = rw / 2;
  const h2 = rh / 2;
  const out = [];
  for (const a of [angle, angle + length]) {
    const theta = a - 360 * Math.floor(a / 360);
    let t = theta / 90;
    const quadrant = Math.trunc(t);
    t -= quadrant;
    t = tForArc(90 * t);
    if (quadrant & 1) t = 1 - t;
    const mt = 1 - t;
    let bb = mt * mt;
    let c = t * t;
    const d = c * t;
    const aa = bb * mt;
    bb *= 3 * t;
    c *= 3 * mt;
    let px = aa + bb + c * KAPPA;
    let py = d + c + bb * KAPPA;
    if (quadrant === 1 || quadrant === 2) px = -px;
    if (quadrant === 0 || quadrant === 1) py = -py;
    out.push(rx + rw / 2 + w2 * px, ry + rh / 2 + h2 * py);
  }
  return [out[0], out[1], out[2], out[3]];
}
function curvesForArc(x, y, w, h, startAngle, sweepIn) {
  if (w === 0 && h === 0) return { sx: 0, sy: 0, curves: [] };
  const w2 = w / 2;
  const w2k = w2 * KAPPA;
  const h2 = h / 2;
  const h2k = h2 * KAPPA;
  const P = [
    x + w,
    y + h2,
    x + w,
    y + h2 + h2k,
    x + w2 + w2k,
    y + h,
    x + w2,
    y + h,
    x + w2 - w2k,
    y + h,
    x,
    y + h2 + h2k,
    x,
    y + h2,
    x,
    y + h2 - h2k,
    x + w2 - w2k,
    y,
    x + w2,
    y,
    x + w2 + w2k,
    y,
    x + w,
    y + h2 - h2k,
    x + w,
    y + h2
  ];
  const px = (i) => P[i * 2];
  const py = (i) => P[i * 2 + 1];
  let sweep = sweepIn;
  if (sweep > 360) sweep = 360;
  else if (sweep < -360) sweep = -360;
  const curves = [];
  if (startAngle === 0) {
    if (sweep === 360) {
      for (let i = 11; i >= 0; i -= 1) curves.push(px(i), py(i));
      return { sx: px(12), sy: py(12), curves };
    }
    if (sweep === -360) {
      for (let i = 1; i <= 12; i += 1) curves.push(px(i), py(i));
      return { sx: px(0), sy: py(0), curves };
    }
  }
  let startSegment = Math.floor(startAngle / 90);
  let endSegment = Math.floor((startAngle + sweep) / 90);
  let startT = (startAngle - startSegment * 90) / 90;
  let endT = (startAngle + sweep - endSegment * 90) / 90;
  const delta = sweep > 0 ? 1 : -1;
  if (delta < 0) {
    startT = 1 - startT;
    endT = 1 - endT;
  }
  if (fuzzyIsNull(startT - 1)) {
    startT = 0;
    startSegment += delta;
  }
  if (fuzzyIsNull(endT)) {
    endT = 1;
    endSegment -= delta;
  }
  startT = tForArc(startT * 90);
  endT = tForArc(endT * 90);
  const splitAtStart = !fuzzyIsNull(startT);
  const splitAtEnd = !fuzzyIsNull(endT - 1);
  const end = endSegment + delta;
  if (startSegment === end) {
    const quadrant = 3 - (startSegment % 4 + 4) % 4;
    const j = 3 * quadrant;
    return delta > 0 ? { sx: px(j + 3), sy: py(j + 3), curves } : { sx: px(j), sy: py(j), curves };
  }
  const [spx, spy, epx, epy] = ellipseCoords(x, y, w, h, startAngle, sweep);
  for (let i = startSegment; i !== end; i += delta) {
    const quadrant = 3 - (i % 4 + 4) % 4;
    const j = 3 * quadrant;
    let b = delta > 0 ? [px(j + 3), py(j + 3), px(j + 2), py(j + 2), px(j + 1), py(j + 1), px(j), py(j)] : [px(j), py(j), px(j + 1), py(j + 1), px(j + 2), py(j + 2), px(j + 3), py(j + 3)];
    if (startSegment === endSegment && fuzzyCompare2(startT, endT)) return { sx: spx, sy: spy, curves };
    if (i === startSegment) {
      if (i === endSegment && splitAtEnd) b = bezierOnInterval(b, startT, endT);
      else if (splitAtStart) b = bezierOnInterval(b, startT, 1);
    } else if (i === endSegment && splitAtEnd) b = bezierOnInterval(b, 0, endT);
    curves.push(b[2], b[3], b[4], b[5], b[6], b[7]);
  }
  curves[curves.length - 2] = epx;
  curves[curves.length - 1] = epy;
  return { sx: spx, sy: spy, curves };
}
var FLAT_JOIN = 0;
var SQUARE_JOIN = 1;
var ROUND_JOIN = 3;
var ROUND_CAP = 4;
var Stroker = class {
  constructor(width, cap, join, forceOpen) {
    this.forceOpen = forceOpen;
    this.width = width === 0 ? 1 : width;
    this.capMode = cap === "flat" ? FLAT_JOIN : cap === "square" ? SQUARE_JOIN : ROUND_CAP;
    this.joinMode = join === "bevel" ? FLAT_JOIN : ROUND_JOIN;
    this.curveThreshold = Math.min(0.25, Math.max(25e-5, 1 / this.width));
  }
  forceOpen;
  out = newPath();
  back1x = 0;
  back1y = 0;
  back2x = 0;
  back2y = 0;
  width;
  capMode;
  joinMode;
  curveThreshold;
  emitMoveTo(x, y) {
    this.back2x = this.back1x;
    this.back2y = this.back1y;
    this.back1x = x;
    this.back1y = y;
    this.out.types.push(MOVE_TO);
    this.out.pts.push(x, y);
  }
  emitLineTo(x, y) {
    this.back2x = this.back1x;
    this.back2y = this.back1y;
    this.back1x = x;
    this.back1y = y;
    this.out.types.push(LINE_TO);
    this.out.pts.push(x, y);
  }
  emitCubicTo(c1x, c1y, c2x, c2y, ex, ey) {
    if (c2x === ex && c2y === ey) {
      if (c1x === ex && c1y === ey) {
        this.back2x = this.back1x;
        this.back2y = this.back1y;
      } else {
        this.back2x = c1x;
        this.back2y = c1y;
      }
    } else {
      this.back2x = c2x;
      this.back2y = c2y;
    }
    this.back1x = ex;
    this.back1y = ey;
    this.out.types.push(CURVE_TO, CURVE_DATA, CURVE_DATA);
    this.out.pts.push(c1x, c1y, c2x, c2y, ex, ey);
  }
  joinPoints(fx, fy, next, join) {
    if (fuzzyCompare2(this.back1x, next.x1) && fuzzyCompare2(this.back1y, next.y1)) return;
    const prev = line(this.back2x, this.back2y, this.back1x, this.back1y);
    const isect = intersects(prev, next);
    const offset = this.width / 2;
    if (join === FLAT_JOIN) {
      const angle = angleTo(line(prev.x2, prev.y2, next.x1, next.y1), prev);
      if (isect.type === BOUNDED || angle > 90 && !fuzzyCompare2(angle, 90)) {
        this.emitLineTo(fx, fy);
        this.emitLineTo(next.x1, next.y1);
        return;
      }
      this.emitLineTo(next.x1, next.y1);
    } else if (join === SQUARE_JOIN) {
      let l1 = prev;
      const dp = (prev.x2 - prev.x1) * (next.x2 - next.x1) + (prev.y2 - prev.y1) * (next.y2 - next.y1);
      if (dp > 0) l1 = line(prev.x2, prev.y2, prev.x1, prev.y1);
      else l1 = translated(l1, l1.x2 - l1.x1, l1.y2 - l1.y1);
      l1 = setLength(l1, offset);
      let l2 = line(next.x2, next.y2, next.x1, next.y1);
      l2 = translated(l2, l2.x2 - l2.x1, l2.y2 - l2.y1);
      l2 = setLength(l2, offset);
      this.emitLineTo(l1.x2, l1.y2);
      this.emitLineTo(l2.x2, l2.y2);
      this.emitLineTo(l2.x1, l2.y1);
    } else if (join === ROUND_JOIN) {
      const angle = angleTo(line(prev.x2, prev.y2, next.x1, next.y1), prev);
      if ((isect.type === BOUNDED || angle > 90.01) && lineLength(next) > offset) {
        this.emitLineTo(fx, fy);
        this.emitLineTo(next.x1, next.y1);
        return;
      }
      const axis2 = line(0, 0, 1, 0);
      const l1OnX = angleTo(axis2, prev);
      const l2OnX = angleTo(axis2, next);
      const sweep = Math.abs(l2OnX - l1OnX);
      const arc = curvesForArc(fx - offset, fy - offset, offset * 2, offset * 2, l1OnX + 90, -sweep);
      for (let i = 0; i < arc.curves.length; i += 6) {
        const c = arc.curves;
        this.emitCubicTo(c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5]);
      }
      this.emitLineTo(next.x1, next.y1);
    } else {
      let l1 = prev;
      const dp = (prev.x2 - prev.x1) * (next.x2 - next.x1) + (prev.y2 - prev.y1) * (next.y2 - next.y1);
      if (dp > 0) l1 = line(prev.x2, prev.y2, prev.x1, prev.y1);
      else l1 = translated(l1, l1.x2 - l1.x1, l1.y2 - l1.y1);
      l1 = setLength(l1, KAPPA * offset);
      let l2 = line(fx, fy, prev.x2, prev.y2);
      l2 = translated(l2, -(l2.y2 - l2.y1), l2.x2 - l2.x1);
      l2 = setLength(l2, KAPPA * offset);
      this.emitCubicTo(l1.x2, l1.y2, l2.x2, l2.y2, l2.x1, l2.y1);
      l2 = line(l2.x1, l2.y1, l2.x1 - (l2.x2 - l2.x1), l2.y1 - (l2.y2 - l2.y1));
      l1 = translated(l1, next.x1 - l1.x1, next.y1 - l1.y1);
      this.emitCubicTo(l2.x2, l2.y2, l1.x2, l1.y2, l1.x1, l1.y1);
    }
  }
  /** `qt_stroke_side` (qstroker.cpp:752-871). Returns whether the side closed, and its start tangent. */
  strokeSide(els, capFirst) {
    const first = els[0];
    const startX = first.x;
    const startY = first.y;
    let prevX = startX;
    let prevY = startY;
    let isFirst = true;
    let tangent = null;
    const offset = this.width / 2;
    for (let i = 1; i < els.length; i += 1) {
      const e = els[i];
      if (e.type === LINE_TO) {
        let l = line(prevX, prevY, e.x, e.y);
        if (!pointsEqual(l.x1, l.y1, l.x2, l.y2)) {
          const normal = setLength(normalVector(l), offset);
          l = translated(l, normal.x2 - normal.x1, normal.y2 - normal.y1);
          if (isFirst) {
            if (capFirst) this.joinPoints(prevX, prevY, l, this.capMode);
            else this.emitMoveTo(l.x1, l.y1);
            tangent = l;
            isFirst = false;
          } else this.joinPoints(prevX, prevY, l, this.joinMode);
          this.emitLineTo(l.x2, l.y2);
          prevX = e.x;
          prevY = e.y;
        }
      } else if (e.type === CURVE_TO) {
        const cp2 = els[i + 1];
        const ep = els[i + 2];
        i += 2;
        const bezier2 = [prevX, prevY, e.x, e.y, cp2.x, cp2.y, ep.x, ep.y];
        const offsets = shiftedBeziers(bezier2, 16, offset, this.curveThreshold);
        if (offsets.length > 0) {
          const st = startTangent(bezier2);
          const o0 = offsets[0];
          const t = translated(st, o0[0] - bezier2[0], o0[1] - bezier2[1]);
          if (isFirst) {
            if (capFirst) this.joinPoints(prevX, prevY, t, this.capMode);
            else this.emitMoveTo(o0[0], o0[1]);
            tangent = t;
            isFirst = false;
          } else this.joinPoints(prevX, prevY, t, this.joinMode);
          for (const c of offsets) this.emitCubicTo(c[2], c[3], c[4], c[5], c[6], c[7]);
        }
        prevX = ep.x;
        prevY = ep.y;
      }
    }
    const closedPath = fuzzyCompare2(startX, prevX) && fuzzyCompare2(startY, prevY);
    if (closedPath && !this.forceOpen) {
      if (!isFirst && tangent) this.joinPoints(prevX, prevY, tangent, this.joinMode);
      return { closed: true, tangent };
    }
    return { closed: false, tangent };
  }
  processSubpath(els) {
    const forward = this.strokeSide(els, false);
    const backward = [];
    for (let pos = els.length - 1; pos >= 0; pos -= 1) {
      const ce = els[pos];
      if (pos === els.length - 1) {
        backward.push({ type: MOVE_TO, x: ce.x, y: ce.y });
        continue;
      }
      const pe = els[pos + 1];
      let type = ce.type;
      if (pe.type === LINE_TO) type = LINE_TO;
      else if (pe.type === CURVE_DATA) type = ce.type === CURVE_TO ? CURVE_DATA : CURVE_TO;
      else if (pe.type === CURVE_TO) type = CURVE_DATA;
      backward.push({ type, x: ce.x, y: ce.y });
    }
    const back = this.strokeSide(backward, !forward.closed);
    if (!back.closed && forward.tangent && !lineIsNull(forward.tangent)) this.joinPoints(els[0].x, els[0].y, forward.tangent, this.capMode);
  }
};
function strokePath(path3, style, forceOpen) {
  const stroker = new Stroker(style.width, style.cap, style.join, forceOpen);
  let els = [];
  const flush = () => {
    if (els.length > 1) stroker.processSubpath(els);
    els = [];
  };
  for (let i = 0; i < path3.types.length; i += 1) {
    const type = path3.types[i];
    const x = path3.pts[i * 2];
    const y = path3.pts[i * 2 + 1];
    if (type === MOVE_TO) {
      flush();
      els.push({ type: MOVE_TO, x, y });
    } else els.push({ type, x, y });
  }
  flush();
  return stroker.out;
}
function flattenPath(path3, device) {
  const contours = [];
  let current = null;
  const close = () => {
    if (current && current.length >= 2) {
      const n = current.length;
      if (!pointsEqual(current[n - 2], current[n - 1], current[0], current[1])) current.push(current[0], current[1]);
      contours.push(current);
    }
    current = null;
  };
  const inside = (x, y) => x >= 0 && x <= device.width && y >= 0 && y <= device.height;
  const count = path3.types.length;
  for (let i = 0; i < count; i += 1) {
    const type = path3.types[i];
    const x = path3.pts[i * 2];
    const y = path3.pts[i * 2 + 1];
    if (type === MOVE_TO) {
      if (i === count - 1) continue;
      close();
      current = [x, y];
    } else if (type === LINE_TO) {
      current ??= [x, y];
      current.push(x, y);
    } else if (type === CURVE_TO) {
      current ??= [0, 0];
      const n = current.length;
      const b = [current[n - 2], current[n - 1], x, y, path3.pts[(i + 1) * 2], path3.pts[(i + 1) * 2 + 1], path3.pts[(i + 2) * 2], path3.pts[(i + 2) * 2 + 1]];
      i += 2;
      let outside = false;
      if (!inside(b[6], b[7])) {
        const r = bounds(b);
        const r1 = r.x + r.w;
        const b1 = r.y + r.h;
        outside = r.x === r1 || r.y === b1 || r.x >= device.width || 0 >= r1 || r.y >= device.height || 0 >= b1;
      }
      if (outside) current.push(b[6], b[7]);
      else flattenBezier(b, 0.25, current);
    }
  }
  close();
  return contours;
}

// ../engine/src/render/kernels/audio-visualization-cosmetic.ts
var CAP_BEGIN = 1;
var CAP_END = 2;
var NO_DIRECTION = 0;
var TOP_TO_BOTTOM = 1;
var BOTTOM_TO_TOP = 2;
var LEFT_TO_RIGHT = 4;
var RIGHT_TO_LEFT = 8;
var VERTICAL_MASK = 3;
var HORIZONTAL_MASK = 12;
var INT_MIN = -2147483648;
function toF26Dot6(x) {
  return Math.trunc(x * 64);
}
function fixedDiv(x, y) {
  return Math.trunc(x * 65536 / y);
}
function qRound2(d) {
  if (d >= 0) return Math.trunc(d + 0.5);
  const i = Math.trunc(d - 1);
  return Math.trunc(d - i + 0.5) + i;
}
function swapCaps(caps) {
  return (caps & CAP_BEGIN) << 1 | (caps & CAP_END) >> 1;
}
var CosmeticStroker = class {
  /**
   * `width`/`height`: the device. `penWidth` <= 1. `drawCaps` is
   * `capStyle != FlatCap`.
   */
  constructor(width, height, antialiased, penWidth, drawCaps, sink) {
    this.width = width;
    this.height = height;
    this.antialiased = antialiased;
    this.drawCaps = drawCaps;
    this.sink = sink;
    this.xmin = -1;
    this.xmax = width - 1 + 2;
    this.ymin = -1;
    this.ymax = height - 1 + 2;
    const opacity = penWidth === 0 ? 256 : Math.trunc(256 * penWidth);
    this.opacity = Math.max(0, Math.min(256, opacity));
  }
  width;
  height;
  antialiased;
  drawCaps;
  sink;
  xmin;
  xmax;
  ymin;
  ymax;
  opacity;
  lastDir = NO_DIRECTION;
  lastAxisAligned = false;
  lastX = INT_MIN;
  lastY = INT_MIN;
  pixel(x, y, coverage) {
    if (x < 0 || x > this.width - 1 || y < 0 || y > this.height - 1) return;
    this.sink(x, y, coverage * this.opacity >> 8);
  }
  /** Returns null when the line is clipped away, else the clipped coordinates. */
  clipLine(x1In, y1In, x2In, y2In) {
    let x1 = x1In;
    let y1 = y1In;
    let x2 = x2In;
    let y2 = y2In;
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return null;
    const clipped = () => {
      this.lastX = INT_MIN;
      return null;
    };
    if (x1 < this.xmin) {
      if (x2 <= this.xmin) return clipped();
      y1 += (y2 - y1) / (x2 - x1) * (this.xmin - x1);
      x1 = this.xmin;
    } else if (x1 > this.xmax) {
      if (x2 >= this.xmax) return clipped();
      y1 += (y2 - y1) / (x2 - x1) * (this.xmax - x1);
      x1 = this.xmax;
    }
    if (x2 < this.xmin) {
      this.lastX = INT_MIN;
      y2 += (y2 - y1) / (x2 - x1) * (this.xmin - x2);
      x2 = this.xmin;
    } else if (x2 > this.xmax) {
      this.lastX = INT_MIN;
      y2 += (y2 - y1) / (x2 - x1) * (this.xmax - x2);
      x2 = this.xmax;
    }
    if (y1 < this.ymin) {
      if (y2 <= this.ymin) return clipped();
      x1 += (x2 - x1) / (y2 - y1) * (this.ymin - y1);
      y1 = this.ymin;
    } else if (y1 > this.ymax) {
      if (y2 >= this.ymax) return clipped();
      x1 += (x2 - x1) / (y2 - y1) * (this.ymax - y1);
      y1 = this.ymax;
    }
    if (y2 < this.ymin) {
      this.lastX = INT_MIN;
      x2 += (x2 - x1) / (y2 - y1) * (this.ymin - y2);
      y2 = this.ymin;
    } else if (y2 > this.ymax) {
      this.lastX = INT_MIN;
      x2 += (x2 - x1) / (y2 - y1) * (this.ymax - y2);
      y2 = this.ymax;
    }
    return [x1, y1, x2, y2];
  }
  stroke(rx1, ry1, rx2, ry2, caps) {
    return this.antialiased ? this.drawLineAA(rx1, ry1, rx2, ry2, caps) : this.drawLineAliased(rx1, ry1, rx2, ry2, caps);
  }
  drawLineAliased(rx1In, ry1In, rx2In, ry2In, capsIn) {
    let didDraw = Math.abs(rx2In - rx1In) + Math.abs(ry2In - ry1In) >= 1;
    const c = this.clipLine(rx1In, ry1In, rx2In, ry2In);
    if (!c) return true;
    let caps = capsIn;
    let x1 = toF26Dot6(c[0]);
    let y1 = toF26Dot6(c[1]);
    let x2 = toF26Dot6(c[2]);
    let y2 = toF26Dot6(c[3]);
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    let lastX = this.lastX;
    let lastY = this.lastY;
    if (dx < dy) {
      let dir = TOP_TO_BOTTOM;
      let swapped = false;
      if (y1 > y2) {
        swapped = true;
        [y1, y2] = [y2, y1];
        [x1, x2] = [x2, x1];
        caps = swapCaps(caps);
        dir = BOTTOM_TO_TOP;
      }
      const xinc = fixedDiv(x2 - x1, y2 - y1);
      let x = x1 * 1024;
      if ((this.lastDir ^ VERTICAL_MASK) === dir) caps |= swapped ? CAP_END : CAP_BEGIN;
      if (caps & CAP_BEGIN) {
        y1 -= 32;
        x -= xinc >> 1;
      }
      if (caps & CAP_END) y2 += 32;
      let y = y1 + 32 >> 6;
      let ys = y2 + 32 >> 6;
      const round = xinc > 0 ? 32 : 0;
      if (caps & CAP_BEGIN && this.lastY === y + 1) y += 1;
      if (y !== ys) {
        x += (y * 64 + round - y1) * xinc >> 6;
        let firstX = x >> 16;
        let firstY = y;
        lastX = x + (ys - y - 1) * xinc >> 16;
        lastY = ys - 1;
        if (swapped) {
          [firstX, lastX] = [lastX, firstX];
          [firstY, lastY] = [lastY, firstY];
        }
        const axisAligned = Math.abs(xinc) < 1 << 14;
        if (this.lastX > INT_MIN) {
          if (firstX === this.lastX && firstY === this.lastY) {
            if (swapped) ys -= 1;
            else {
              y += 1;
              x += xinc;
            }
          } else if (this.lastDir !== dir && (axisAligned && this.lastAxisAligned && this.lastX !== firstX && this.lastY !== firstY || Math.abs(this.lastX - firstX) > 1 || Math.abs(this.lastY - firstY) > 1)) {
            if (swapped) ys += 1;
            else {
              y -= 1;
              x -= xinc;
            }
          } else if (this.lastDir === dir && Math.abs(this.lastX - firstX) <= 1 && Math.abs(this.lastY - firstY) > 1) {
            x += xinc >> 1;
            if (swapped) lastX = x >> 16;
            else lastX = x + (ys - y - 1) * xinc >> 16;
          }
        }
        this.lastDir = dir;
        this.lastAxisAligned = axisAligned;
        do {
          this.pixel(x >> 16, y, 255);
          x += xinc;
        } while (++y < ys);
        didDraw = true;
      }
    } else {
      if (!dx) return true;
      let dir = LEFT_TO_RIGHT;
      let swapped = false;
      if (x1 > x2) {
        swapped = true;
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
        caps = swapCaps(caps);
        dir = RIGHT_TO_LEFT;
      }
      const yinc = fixedDiv(y2 - y1, x2 - x1);
      let y = y1 * 1024;
      if ((this.lastDir ^ HORIZONTAL_MASK) === dir) caps |= swapped ? CAP_END : CAP_BEGIN;
      if (caps & CAP_BEGIN) {
        x1 -= 32;
        y -= yinc >> 1;
      }
      if (caps & CAP_END) x2 += 32;
      let x = x1 + 32 >> 6;
      let xs = x2 + 32 >> 6;
      const round = yinc > 0 ? 32 : 0;
      if (caps & CAP_BEGIN && this.lastX === x + 1) x += 1;
      if (x !== xs) {
        y += (x * 64 + round - x1) * yinc >> 6;
        let firstX = x;
        let firstY = y >> 16;
        lastX = xs - 1;
        lastY = y + (xs - x - 1) * yinc >> 16;
        if (swapped) {
          [firstX, lastX] = [lastX, firstX];
          [firstY, lastY] = [lastY, firstY];
        }
        const axisAligned = Math.abs(yinc) < 1 << 14;
        if (this.lastX > INT_MIN) {
          if (firstX === this.lastX && firstY === this.lastY) {
            if (swapped) xs -= 1;
            else {
              x += 1;
              y += yinc;
            }
          } else if (this.lastDir !== dir && (axisAligned && this.lastAxisAligned && this.lastX !== firstX && this.lastY !== firstY || Math.abs(this.lastX - firstX) > 1 || Math.abs(this.lastY - firstY) > 1)) {
            if (swapped) xs += 1;
            else {
              x -= 1;
              y -= yinc;
            }
          } else if (this.lastDir === dir && Math.abs(this.lastX - firstX) <= 1 && Math.abs(this.lastY - firstY) > 1) {
            y += yinc >> 1;
            if (swapped) lastY = y >> 16;
            else lastY = y + (xs - x - 1) * yinc >> 16;
          }
        }
        this.lastDir = dir;
        this.lastAxisAligned = axisAligned;
        do {
          this.pixel(x, y >> 16, 255);
          y += yinc;
        } while (++x < xs);
        didDraw = true;
      }
    }
    this.lastX = lastX;
    this.lastY = lastY;
    return didDraw;
  }
  drawLineAA(rx1In, ry1In, rx2In, ry2In, capsIn) {
    const c = this.clipLine(rx1In, ry1In, rx2In, ry2In);
    if (!c) return true;
    let caps = capsIn;
    let x1 = toF26Dot6(c[0]);
    let y1 = toF26Dot6(c[1]);
    let x2 = toF26Dot6(c[2]);
    let y2 = toF26Dot6(c[3]);
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) < Math.abs(dy)) {
      const xinc = fixedDiv(dx, dy);
      if (y1 > y2) {
        [y1, y2] = [y2, y1];
        [x1, x2] = [x2, x1];
        caps = swapCaps(caps);
      }
      let x = (x1 - 32) * 1024;
      x -= ((y1 & 63) - 32) * xinc >> 6;
      if (caps & CAP_BEGIN) {
        y1 -= 32;
        x -= xinc >> 1;
      }
      if (caps & CAP_END) y2 += 32;
      let y = y1 >> 6;
      const ys = y2 >> 6;
      let alphaStart;
      let alphaEnd;
      if (y === ys) {
        alphaStart = y2 - y1;
        alphaEnd = 0;
      } else {
        alphaStart = 64 - (y1 & 63);
        alphaEnd = y2 & 63;
      }
      let alpha = x >> 8 & 255;
      this.pixel(x >> 16, y, (255 - alpha) * alphaStart >> 6);
      this.pixel((x >> 16) + 1, y, alpha * alphaStart >> 6);
      x += xinc;
      y += 1;
      if (y < ys) {
        do {
          alpha = x >> 8 & 255;
          this.pixel(x >> 16, y, 255 - alpha);
          this.pixel((x >> 16) + 1, y, alpha);
          x += xinc;
        } while (++y < ys);
      }
      if (alphaEnd) {
        alpha = x >> 8 & 255;
        this.pixel(x >> 16, y, (255 - alpha) * alphaEnd >> 6);
        this.pixel((x >> 16) + 1, y, alpha * alphaEnd >> 6);
      }
    } else {
      if (!dx) return true;
      const yinc = fixedDiv(dy, dx);
      if (x1 > x2) {
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
        caps = swapCaps(caps);
      }
      let y = (y1 - 32) * 1024;
      y -= ((x1 & 63) - 32) * yinc >> 6;
      if (caps & CAP_BEGIN) {
        x1 -= 32;
        y -= yinc >> 1;
      }
      if (caps & CAP_END) x2 += 32;
      let x = x1 >> 6;
      const xs = x2 >> 6;
      let alphaStart;
      let alphaEnd;
      if (x === xs) {
        alphaStart = x2 - x1;
        alphaEnd = 0;
      } else {
        alphaStart = 64 - (x1 & 63);
        alphaEnd = x2 & 63;
      }
      let alpha = y >> 8 & 255;
      this.pixel(x, y >> 16, (255 - alpha) * alphaStart >> 6);
      this.pixel(x, (y >> 16) + 1, alpha * alphaStart >> 6);
      y += yinc;
      x += 1;
      if (x < xs) {
        do {
          alpha = y >> 8 & 255;
          this.pixel(x, y >> 16, 255 - alpha);
          this.pixel(x, (y >> 16) + 1, alpha);
          y += yinc;
        } while (++x < xs);
      }
      if (alphaEnd) {
        alpha = y >> 8 & 255;
        this.pixel(x, y >> 16, (255 - alpha) * alphaEnd >> 6);
        this.pixel(x, (y >> 16) + 1, alpha * alphaEnd >> 6);
      }
    }
    return true;
  }
  /** `calculateLastPoint` (:412-490): direction and last pixel of the closing segment. */
  calculateLastPoint(rx1In, ry1In, rx2In, ry2In) {
    this.lastX = INT_MIN;
    this.lastY = INT_MIN;
    const c = this.clipLine(rx1In, ry1In, rx2In, ry2In);
    if (!c) return;
    let x1 = toF26Dot6(c[0]);
    let y1 = toF26Dot6(c[1]);
    let x2 = toF26Dot6(c[2]);
    let y2 = toF26Dot6(c[3]);
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    if (dx < dy) {
      let swapped = false;
      if (y1 > y2) {
        swapped = true;
        [y1, y2] = [y2, y1];
        [x1, x2] = [x2, x1];
      }
      const xinc = fixedDiv(x2 - x1, y2 - y1);
      let x = x1 * 1024;
      const y = y1 + 32 >> 6;
      const ys = y2 + 32 >> 6;
      const round = xinc > 0 ? 32 : 0;
      if (y !== ys) {
        x += (y * 64 + round - y1) * xinc >> 6;
        if (swapped) {
          this.lastX = x >> 16;
          this.lastY = y;
          this.lastDir = BOTTOM_TO_TOP;
        } else {
          this.lastX = x + (ys - y - 1) * xinc >> 16;
          this.lastY = ys - 1;
          this.lastDir = TOP_TO_BOTTOM;
        }
        this.lastAxisAligned = Math.abs(xinc) < 1 << 14;
      }
    } else {
      if (!dx) return;
      let swapped = false;
      if (x1 > x2) {
        swapped = true;
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
      }
      const yinc = fixedDiv(y2 - y1, x2 - x1);
      let y = y1 * 1024;
      const x = x1 + 32 >> 6;
      const xs = x2 + 32 >> 6;
      const round = yinc > 0 ? 32 : 0;
      if (x !== xs) {
        y += (x * 64 + round - x1) * yinc >> 6;
        if (swapped) {
          this.lastX = x;
          this.lastY = y >> 16;
          this.lastDir = RIGHT_TO_LEFT;
        } else {
          this.lastX = xs - 1;
          this.lastY = y + (xs - x - 1) * yinc >> 16;
          this.lastDir = LEFT_TO_RIGHT;
        }
        this.lastAxisAligned = Math.abs(yinc) < 1 << 14;
      }
    }
  }
  /** `drawPoints`: one full-coverage pixel at the rounded position. */
  point(x, y) {
    this.pixel(qRound2(x), qRound2(y), 255);
  }
  /** `QCosmeticStroker::drawLine`. */
  drawLine(x1, y1, x2, y2) {
    if (pointsEqual(x1, y1, x2, y2)) {
      this.point(x1, y1);
      return;
    }
    this.lastX = INT_MIN;
    this.lastY = INT_MIN;
    this.stroke(x1, y1, x2, y2, this.drawCaps ? CAP_BEGIN | CAP_END : 0);
  }
  /** `drawPath` for a polygon without element types (drawPolyline / implicitly closed polygons). */
  drawPolygon(points, implicitClose) {
    const n = points.length >> 1;
    if (n === 0) return;
    let px = points[0];
    let py = points[1];
    const movedX = px;
    const movedY = py;
    this.lastX = INT_MIN;
    this.lastY = INT_MIN;
    const endX = points[(n - 1) * 2];
    const endY = points[(n - 1) * 2 + 1];
    const closed = implicitClose || points[0] === endX && points[1] === endY;
    let caps = !closed && this.drawCaps ? CAP_BEGIN : 0;
    if (closed) {
      let p2x;
      let p2y;
      if (points[0] === endX && points[1] === endY && n > 2) {
        p2x = points[(n - 2) * 2];
        p2y = points[(n - 2) * 2 + 1];
      } else {
        p2x = endX;
        p2y = endY;
      }
      this.calculateLastPoint(p2x, p2y, px, py);
    }
    const fastPenAliased = !this.antialiased;
    for (let i = 1; i < n; i += 1) {
      const qx = points[i * 2];
      const qy = points[i * 2 + 1];
      if (!closed && this.drawCaps && i === n - 1) caps |= CAP_END;
      const moveNextStart = this.stroke(px, py, qx, qy, caps);
      if (!fastPenAliased || moveNextStart || i === 1 || i === n - 1) {
        px = qx;
        py = qy;
      }
      caps = 0;
    }
    if (implicitClose) this.stroke(px, py, movedX, movedY, 0);
  }
  /** `drawPath` for a path with element types (QPainterPath: lines and cubics). */
  drawPath(path3) {
    const types = path3.types;
    const pts = path3.pts;
    const end = types.length;
    let t = 0;
    while (t < end) {
      let px = pts[t * 2];
      let py = pts[t * 2 + 1];
      this.lastX = INT_MIN;
      this.lastY = INT_MIN;
      let e = t + 1;
      while (e < end && types[e] !== MOVE_TO) e += 1;
      const lastIndex = e - 1;
      const closed = pts[t * 2] === pts[lastIndex * 2] && pts[t * 2 + 1] === pts[lastIndex * 2 + 1];
      if (closed) {
        this.calculateLastPoint(pts[(e - 2) * 2], pts[(e - 2) * 2 + 1], pts[(e - 1) * 2], pts[(e - 1) * 2 + 1]);
      }
      let caps = !closed && this.drawCaps ? CAP_BEGIN : 0;
      let i = t + 1;
      while (i < e) {
        const type = types[i];
        const qx = pts[i * 2];
        const qy = pts[i * 2 + 1];
        if (type === LINE_TO) {
          if (!closed && this.drawCaps && i === e - 1) caps |= CAP_END;
          this.stroke(px, py, qx, qy, caps);
          px = qx;
          py = qy;
          i += 1;
        } else if (type === CURVE_TO) {
          if (!closed && this.drawCaps && i === e - 3) caps |= CAP_END;
          const p3x = pts[(i + 1) * 2];
          const p3y = pts[(i + 1) * 2 + 1];
          const p4x = pts[(i + 2) * 2];
          const p4y = pts[(i + 2) * 2 + 1];
          this.renderCubic(px, py, qx, qy, p3x, p3y, p4x, p4y, caps);
          px = p4x;
          py = p4y;
          i += 3;
        } else i += 1;
        caps = 0;
      }
      t = e;
    }
  }
  renderCubic(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y, caps) {
    const pts = new Array(2 * (3 * 6 + 4)).fill(0);
    pts[6] = p1x;
    pts[7] = p1y;
    pts[4] = p2x;
    pts[5] = p2y;
    pts[2] = p3x;
    pts[3] = p3y;
    pts[0] = p4x;
    pts[1] = p4y;
    this.renderCubicSubdivision(pts, 0, 6, caps);
  }
  renderCubicSubdivision(pts, base, level, caps) {
    const X = (i) => pts[(base + i) * 2];
    const Y = (i) => pts[(base + i) * 2 + 1];
    if (level) {
      const dx = X(3) - X(0);
      const dy = Y(3) - Y(0);
      const len = 0.25 * (Math.abs(dx) + Math.abs(dy));
      if (Math.abs(dx * (Y(0) - Y(2)) - dy * (X(0) - X(2))) >= len || Math.abs(dx * (Y(0) - Y(1)) - dy * (X(0) - X(1))) >= len) {
        splitCubic(pts, base);
        this.renderCubicSubdivision(pts, base + 3, level - 1, caps & CAP_BEGIN);
        this.renderCubicSubdivision(pts, base, level - 1, caps & CAP_END);
        return;
      }
    }
    this.stroke(X(3), Y(3), X(0), Y(0), caps);
  }
};
function splitCubic(pts, base) {
  for (let k = 0; k < 2; k += 1) {
    const at = (i) => (base + i) * 2 + k;
    pts[at(6)] = pts[at(3)];
    let c = pts[at(1)];
    const d = pts[at(2)];
    let a = (pts[at(0)] + c) * 0.5;
    pts[at(1)] = a;
    let b = (pts[at(3)] + d) * 0.5;
    pts[at(5)] = b;
    c = (c + d) * 0.5;
    a = (a + c) * 0.5;
    pts[at(2)] = a;
    b = (b + c) * 0.5;
    pts[at(4)] = b;
    pts[at(3)] = (a + b) * 0.5;
  }
}

// ../engine/src/render/kernels/audio-visualization-paint.ts
function premultipliedBytes(c) {
  const a = c.a;
  if (a === 65535) return [div257(c.r), div257(c.g), div257(c.b), 255];
  if (a === 0) return [0, 0, 0, 0];
  const pm = (x) => {
    const t = x * a;
    return Math.floor((t + Math.floor(t / 65536) + 32768) / 65536);
  };
  return [div257(pm(c.r)), div257(pm(c.g)), div257(pm(c.b)), div257(a)];
}
function premul64(c) {
  const a = c.a;
  if (a === 65535) return [c.r, c.g, c.b, a];
  if (a === 0) return [0, 0, 0, 0];
  const pm = (x) => {
    const t = x * a;
    return Math.floor((t + Math.floor(t / 65536) + 32768) / 65536);
  };
  return [pm(c.r), pm(c.g), pm(c.b), a];
}
function qRound3(d) {
  if (d >= 0) return Math.trunc(d + 0.5);
  const i = Math.trunc(d - 1);
  return Math.trunc(d - i + 0.5) + i;
}
var TABLE = 1024;
function gradientTable(stopsIn) {
  const stops = stopsIn.length > 0 ? stopsIn : [{ pos: 0, color: { r: 0, g: 0, b: 0, a: 65535 } }, { pos: 1, color: { r: 65535, g: 65535, b: 65535, a: 65535 } }];
  const out = new Uint8Array(TABLE * 4);
  const put = (i, v) => {
    out[i * 4] = div257(v[0]);
    out[i * 4 + 1] = div257(v[1]);
    out[i * 4 + 2] = div257(v[2]);
    out[i * 4 + 3] = div257(v[3]);
  };
  const putRange = (from, toIn, v) => {
    const to = Math.min(toIn, TABLE);
    if (from >= to) return;
    put(from, v);
    for (let i = from + 1; i < to; i += 1) out.copyWithin(i * 4, from * 4, from * 4 + 4);
  };
  if (stops.length === 2) {
    let first = premul64(stops[0].color);
    let second = premul64(stops[1].color);
    let firstStop = stops[0].pos;
    let secondStop = stops[1].pos;
    if (secondStop < firstStop) {
      [first, second] = [second, first];
      [firstStop, secondStop] = [secondStop, firstStop];
    }
    const firstIndex = qRound3(firstStop * (TABLE - 1));
    const secondIndex = qRound3(secondStop * (TABLE - 1));
    const f = first.map((v) => v * 65536);
    const s = second.map((v) => v * 65536);
    let i = Math.max(0, Math.min(TABLE, firstIndex) + 1);
    putRange(0, i, first);
    if (i < secondIndex) {
      const reciprocal = 1 / (secondIndex - firstIndex);
      const delta = [0, 1, 2, 3].map((c) => qRound3((s[c] - f[c]) * reciprocal));
      const cur = f.map((v) => v + (1 << 15));
      for (; i < Math.min(TABLE, secondIndex); i += 1) {
        for (let c = 0; c < 4; c += 1) cur[c] = cur[c] + delta[c] >>> 0;
        put(i, [cur[0] >>> 16 & 65535, cur[1] >>> 16 & 65535, cur[2] >>> 16 & 65535, cur[3] >>> 16 & 65535]);
      }
    }
    putRange(i, TABLE, second);
  } else if (stops.length === 1) {
    putRange(0, TABLE, premul64(stops[0].color));
  } else {
    const interpolate = (x, a1, y, a2) => [
      (x[0] * a1 >> 8) + (y[0] * a2 >> 8),
      (x[1] * a1 >> 8) + (y[1] * a2 >> 8),
      (x[2] * a1 >> 8) + (y[2] * a2 >> 8),
      (x[3] * a1 >> 8) + (y[3] * a2 >> 8)
    ];
    const beginPos = stops[0].pos;
    const endPos = stops[stops.length - 1].pos;
    let pos = 0;
    const incr = 1 / TABLE;
    let dpos = 1.5 * incr;
    let current = stops[0].color ? premul64(stops[0].color) : [0, 0, 0, 0];
    put(pos++, current);
    while (dpos <= beginPos) {
      out.copyWithin(pos * 4, (pos - 1) * 4, pos * 4);
      pos += 1;
      dpos += incr;
    }
    let cs = 0;
    if (dpos < endPos) {
      while (dpos > stops[cs + 1].pos) cs += 1;
      current = premul64(stops[cs].color);
      let next = premul64(stops[cs + 1].color);
      let diff = stops[cs + 1].pos - stops[cs].pos;
      let c = diff === 0 ? 0 : 256 / diff;
      let t = (dpos - stops[cs].pos) * c;
      let tDelta = incr * c;
      for (; ; ) {
        const dist = qRound3(t);
        put(pos, interpolate(current, 256 - dist, next, dist));
        pos += 1;
        dpos += incr;
        if (dpos >= endPos) break;
        t += tDelta;
        let skip = 0;
        while (dpos > stops[cs + skip + 1].pos) skip += 1;
        if (skip !== 0) {
          cs += skip;
          current = skip === 1 ? next : premul64(stops[cs].color);
          next = premul64(stops[cs + 1].color);
          diff = stops[cs + 1].pos - stops[cs].pos;
          c = diff === 0 ? 0 : 256 / diff;
          t = (dpos - stops[cs].pos) * c;
          tDelta = incr * c;
        }
      }
    }
    const last = premul64(stops[stops.length - 1].color);
    putRange(pos, TABLE, last);
  }
  return out;
}
function clampIndex(ipos, repeat) {
  if (ipos < 0 || ipos >= TABLE) {
    if (repeat) {
      ipos %= TABLE;
      if (ipos < 0) ipos += TABLE;
    } else ipos = ipos < 0 ? 0 : TABLE - 1;
  }
  return ipos;
}
var FIXPT_MAX = 2147483647 >> 9;
var F32 = new Float32Array(1);
var U32 = new Uint32Array(F32.buffer);
function recipSqrtEstimate(aIn) {
  let a = aIn;
  if (a < 256) a = a * 2 + 1;
  else {
    a = a >> 1 << 1;
    a = (a + 1) * 2;
  }
  let b = 512;
  while (a * (b + 1) * (b + 1) < 268435456) b += 1;
  return b + 1 >> 1;
}
function frsqrte(x) {
  F32[0] = x;
  const bits2 = U32[0];
  let exp = bits2 >>> 23 & 255;
  let fraction2 = bits2 & 8388607;
  if (exp === 0) {
    if (fraction2 === 0) return Infinity;
    while ((fraction2 & 4194304) === 0) {
      fraction2 <<= 1;
      exp -= 1;
    }
    fraction2 = fraction2 << 1 & 8388607;
  }
  const scaled = exp & 1 ? 128 | fraction2 >> 16 : 256 | fraction2 >> 15;
  const resultExp = Math.floor((380 - exp) / 2);
  const estimate = recipSqrtEstimate(scaled);
  U32[0] = (resultExp & 255) << 23 | (estimate & 255) << 15;
  return F32[0];
}
function neonSqrt(x) {
  const y0 = frsqrte(x);
  const step = f322((3 - x * f322(y0 * y0)) / 2);
  return f322(x * f322(y0 * step));
}
var FLT_EPSILON = 11920928955078125e-23;
function stopsOpaque(stops) {
  return stops.every((s) => div257(s.color.a) === 255);
}
function prepare(brush) {
  if (brush.kind === "solid") {
    const c = premultipliedBytes(brush.color);
    return { opaque: c[3] === 255, solid: c, table: null, fetch: null, rowIndex: null };
  }
  const table = gradientTable(brush.stops);
  const opaque = stopsOpaque(brush.stops);
  const put = (out, i, idx) => {
    out[i * 4] = table[idx * 4];
    out[i * 4 + 1] = table[idx * 4 + 1];
    out[i * 4 + 2] = table[idx * 4 + 2];
    out[i * 4 + 3] = table[idx * 4 + 3];
  };
  if (brush.kind === "linear") {
    let dx = brush.x2 - brush.x1;
    let dy = brush.y2 - brush.y1;
    const l = dx * dx + dy * dy;
    let off = 0;
    if (l !== 0) {
      dx /= l;
      dy /= l;
      off = -dx * brush.x1 - dy * brush.y1;
    }
    if (brush.x2 === brush.x1) {
      const yinc = Math.trunc(dy * 1 * (TABLE - 1) * 256);
      const offFixed = Math.trunc((dy * (1 * 0.5 + 0) + off) * (TABLE - 1) * 256);
      return { opaque, solid: null, table, fetch: null, rowIndex: (y) => clampIndex(yinc * y + offFixed + 128 >> 8, false) };
    }
    const fetch3 = (x, y, len, out) => {
      if (l === 0) {
        for (let i = 0; i < len; i += 1) put(out, i, clampIndex(0, false));
        return;
      }
      const rx = x + 0.5;
      const ry = y + 0.5;
      const t = (dx * rx + dy * ry + off) * (TABLE - 1);
      const inc = dx * (TABLE - 1);
      if (inc > -1e-5 && inc < 1e-5) {
        const idx = Math.abs(t) < FIXPT_MAX ? clampIndex(Math.trunc(t * 256) + 128 >> 8, false) : clampIndex(Math.trunc(t / TABLE * (TABLE - 1) + 0.5), false);
        for (let i = 0; i < len; i += 1) put(out, i, idx);
      } else if (Math.abs(t) < FIXPT_MAX && Math.abs(inc) < FIXPT_MAX && Math.abs(t + inc * len) < FIXPT_MAX) {
        let tFixed = Math.trunc(t * 256);
        const incFixed = Math.trunc(inc * 256);
        for (let i = 0; i < len; i += 1) {
          put(out, i, clampIndex(tFixed + 128 >> 8, false));
          tFixed = tFixed + incFixed | 0;
        }
      } else {
        let tt = t;
        for (let i = 0; i < len; i += 1) {
          put(out, i, clampIndex(Math.trunc(tt / TABLE * (TABLE - 1) + 0.5), false));
          tt += inc;
        }
      }
    };
    return { opaque, solid: null, table, fetch: fetch3, rowIndex: null };
  }
  if (brush.kind === "radial") {
    const a = brush.radius * brush.radius;
    const dr = brush.radius;
    const fetch3 = (x, y, len, out) => {
      if (Math.abs(a) <= 1e-12) {
        out.fill(0, 0, len * 4);
        return;
      }
      const rx = x + 0.5 - brush.cx;
      const ry = y + 0.5 - brush.cy;
      let invA = 1 / (2 * a);
      let b = 0;
      invA *= invA;
      const rxrxryry = rx * rx + ry * ry;
      let det = (0 - 4 * a * (0 - rxrxryry)) * invA;
      let deltaDet = (0 + 0 + 4 * a * (2 * rx + 1)) * invA;
      const deltaDeltaDet = (0 + 4 * a * 2) * invA;
      const detVec = [0, 0, 0, 0];
      const delta4 = [0, 0, 0, 0];
      const bVec = [0, 0, 0, 0];
      for (let i = 0; i < 4; i += 1) {
        detVec[i] = f322(det);
        delta4[i] = f322(4 * deltaDet);
        bVec[i] = f322(b);
        det += deltaDet;
        deltaDet += deltaDeltaDet;
        b += 0;
      }
      const dd16 = f322(16 * deltaDeltaDet);
      const dd6 = f322(6 * deltaDeltaDet);
      const db4 = f322(0);
      const vmax = 1023;
      for (let base = 0; base < len; base += 4) {
        for (let lane = 0; lane < 4; lane += 1) {
          const d = detVec[lane];
          const local = f322(neonSqrt(d > FLT_EPSILON ? d : FLT_EPSILON) - bVec[lane]);
          const index = f322(f322(local * vmax) + 0.5);
          const clamped = index < vmax ? index > FLT_EPSILON ? index : FLT_EPSILON : vmax;
          const idx = Math.trunc(clamped);
          if (base + lane < len) put(out, base + lane, idx);
          detVec[lane] = f322(f322(d + delta4[lane]) + dd6);
          delta4[lane] = f322(delta4[lane] + dd16);
          bVec[lane] = f322(bVec[lane] + db4);
        }
      }
      void dr;
    };
    return { opaque: false, solid: null, table, fetch: fetch3, rowIndex: null };
  }
  const angle = brush.angle * (Math.PI / 180);
  const inv2pi = 1 / Math.PI / 2;
  const fetch2 = (x, y, len, out) => {
    let rx = x + 0.5 - brush.cx;
    const ry = y + 0.5 - brush.cy;
    for (let i = 0; i < len; i += 1) {
      const a = Math.atan2(ry, rx) + angle;
      put(out, i, clampIndex(Math.trunc((1 - a * inv2pi) * (TABLE - 1) + 0.5), true));
      rx += 1;
    }
  };
  return { opaque, solid: null, table, fetch: fetch2, rowIndex: null };
}
var SpanBatch = class {
  constructor(mode, flushFn) {
    this.mode = mode;
    this.flushFn = flushFn;
  }
  mode;
  flushFn;
  xs = [];
  ys = [];
  lens = [];
  covs = [];
  get count() {
    return this.xs.length;
  }
  add(x, y, len, coverage) {
    if (len <= 0) return;
    const n = this.xs.length;
    if (this.mode === 1 /* Gray */) {
      if (n > 0 && this.ys[n - 1] === y && this.xs[n - 1] + this.lens[n - 1] === x && this.covs[n - 1] === coverage) {
        this.lens[n - 1] = this.lens[n - 1] + len;
        return;
      }
      if (n >= 256) this.flush();
    } else if (this.mode === 2 /* Cosmetic */ && n > 0) {
      const lastX = this.xs[n - 1] + this.lens[n - 1];
      const lastY = this.ys[n - 1];
      if (n === 255 || y < lastY || y === lastY && x < lastX) this.flush();
    }
    this.xs.push(x);
    this.ys.push(y);
    this.lens.push(len);
    this.covs.push(coverage);
    if (this.mode === 0 /* Rasterizer */ && this.xs.length === 256) this.flush();
  }
  flush() {
    if (this.xs.length > 0) this.flushFn(this);
    this.xs.length = 0;
    this.ys.length = 0;
    this.lens.length = 0;
    this.covs.length = 0;
  }
};
var BUFFER_SIZE = 2048;
var SOURCE = composerFor(CompositionMode.Source);
var SOURCE_OVER = composerFor(CompositionMode.SourceOver);
var DESTINATION_IN = composerFor(CompositionMode.DestinationIn);
var Painter = class {
  width;
  height;
  data;
  clip;
  scratch;
  /** `QPainter::Antialiasing`. */
  antialias = false;
  constructor(image) {
    this.width = image.width;
    this.height = image.height;
    this.data = image.data;
    this.clip = clipBoxFor(image.width, image.height);
    this.scratch = new Uint8ClampedArray(BUFFER_SIZE * 4);
  }
  /** A span sink that batches like `mode` and blends each batch (`handleSpans`). */
  batched(p, mode) {
    const batch = new SpanBatch(mode, (b) => this.blendBatch(b, p));
    return { sink: (x, y, len, coverage) => batch.add(x, y, len, coverage), end: () => batch.flush() };
  }
  /**
   * One blend call: colors span by span; gradients like `handleSpans`
   * (qdrawhelper.cpp:4679-4728) — one fetch per run of adjacent spans on a
   * row, in chunks of BufferSize, each span composited with its coverage.
   */
  blendBatch(b, p) {
    const n = b.count;
    if (!p.fetch) {
      for (let i2 = 0; i2 < n; i2 += 1) this.blend(b.xs[i2], b.ys[i2], b.lens[i2], b.covs[i2], p);
      return;
    }
    const compose = p.opaque ? SOURCE : SOURCE_OVER;
    let i = 0;
    while (i < n) {
      if (!b.lens[i]) {
        i += 1;
        continue;
      }
      let x = b.xs[i];
      const y = b.ys[i];
      let right = x + b.lens[i];
      for (let j = i + 1; j < n && b.ys[j] === y && b.xs[j] === right; j += 1) right += b.lens[j];
      let length = right - x;
      while (length) {
        let l = Math.min(BUFFER_SIZE, length);
        length -= l;
        p.fetch(x, y, l, this.scratch);
        let offset = 0;
        while (l > 0) {
          const spanRight = b.xs[i] + b.lens[i];
          const len = Math.min(l, spanRight - x);
          compose(this.data, (y * this.width + x) * 4, this.scratch, offset * 4, len, b.covs[i]);
          l -= len;
          x += len;
          offset += len;
          if (x === spanRight) i += 1;
        }
      }
    }
  }
  /** Blend one span (x .. x+len-1, y) with coverage 1..255. */
  blend(x, y, len, coverage, p) {
    if (len <= 0) return;
    const d = this.data;
    const di = (y * this.width + x) * 4;
    let color2 = p.solid;
    if (p.rowIndex && p.table) {
      const idx = p.rowIndex(y) * 4;
      color2 = [p.table[idx], p.table[idx + 1], p.table[idx + 2], p.table[idx + 3]];
    }
    if (color2) {
      if (p.opaque) {
        if (coverage === 255) {
          for (let i = 0; i < len; i += 1) d.set(color2, di + i * 4);
          return;
        }
        const ia2 = 255 - coverage;
        const s0 = byteMul(color2[0], coverage);
        const s1 = byteMul(color2[1], coverage);
        const s2 = byteMul(color2[2], coverage);
        const s3 = byteMul(color2[3], coverage);
        for (let i = 0, o = di; i < len; i += 1, o += 4) {
          d[o] = s0 + byteMul(d[o], ia2);
          d[o + 1] = s1 + byteMul(d[o + 1], ia2);
          d[o + 2] = s2 + byteMul(d[o + 2], ia2);
          d[o + 3] = s3 + byteMul(d[o + 3], ia2);
        }
        return;
      }
      let c0 = color2[0];
      let c1 = color2[1];
      let c2 = color2[2];
      let c3 = color2[3];
      if (coverage !== 255) {
        c0 = byteMul(c0, coverage);
        c1 = byteMul(c1, coverage);
        c2 = byteMul(c2, coverage);
        c3 = byteMul(c3, coverage);
      }
      const ia = 255 - c3;
      for (let i = 0, o = di; i < len; i += 1, o += 4) {
        d[o] = c0 + byteMul(d[o], ia);
        d[o + 1] = c1 + byteMul(d[o + 1], ia);
        d[o + 2] = c2 + byteMul(d[o + 2], ia);
        d[o + 3] = c3 + byteMul(d[o + 3], ia);
      }
      return;
    }
    if (!p.fetch) return;
    p.fetch(x, y, len, this.scratch);
    (p.opaque ? SOURCE : SOURCE_OVER)(d, di, this.scratch, 0, len, coverage);
  }
  /** `fillRect_normalized` over the integer rect (x, y, w, h). */
  fillNormalized(x, y, w, h, p) {
    const x1 = Math.max(x, 0);
    const x2 = Math.min(x + w, this.width);
    const y1 = Math.max(y, 0);
    const y2 = Math.min(y + h, this.height);
    if (x2 <= x1 || y2 <= y1) return;
    for (let row = y1; row < y2; row += 1) this.blend(x1, row, x2 - x1, 255, p);
  }
  /** `QPainter::fillRect(QRectF, brush)` (QRect arguments convert to QRectF). */
  fillRect(x, y, w, h, brush) {
    const p = prepare(brush);
    if (!p.opaque && p.solid && p.solid[3] === 0) return;
    if (!this.antialias) {
      let x1 = qRound3(x);
      let y1 = qRound3(y);
      let x2 = qRound3(x + w);
      let y2 = qRound3(y + h);
      if (x2 < x1) [x1, x2] = [x2, x1];
      if (y2 < y1) [y1, y2] = [y2, y1];
      this.fillNormalized(x1, y1, x2 - x1, y2 - y1, p);
      return;
    }
    let nx = x;
    let ny = y;
    let nw = w;
    let nh = h;
    if (nw < 0) {
      nx += nw;
      nw = -nw;
    }
    if (nh < 0) {
      ny += nh;
      nh = -nh;
    }
    if (!(nw > 0 && nh > 0)) return;
    const my = (ny + (ny + nh)) * f322(0.5);
    const ax = (nx + nx) * f322(0.5);
    const bx = (nx + nw + (nx + nw)) * f322(0.5);
    const out = this.batched(p, 0 /* Rasterizer */);
    rasterizeLine(ax, my, bx, my, nh / nw, true, this.clip, out.sink);
    out.end();
  }
  /** `QPainter::drawRect(QRect)` with no pen, aliased (`drawRects` → `fillRect_normalized`). */
  drawRectI(x, y, w, h, brush) {
    const p = prepare(brush);
    let x1 = x;
    let x2 = x + w - 1;
    let y1 = y;
    let y2 = y + h - 1;
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    this.fillNormalized(x1, y1, x2 - x1 + 1, y2 - y1 + 1, p);
  }
  /**
   * Fill a path outline with the winding (default) or odd-even rule:
   * QOutlineMapper rounds to 26.6 (`qRound(v * 64)`, qoutlinemapper.cpp:51),
   * then qgrayraster (antialiased; its spans are the runs of equal coverage,
   * flushed every 256) or QRasterizer's scan converter (aliased).
   */
  fillPath(path3, brush, evenOdd) {
    const contours = flattenPath(path3, this);
    if (contours.length === 0) return;
    const p = prepare(brush);
    if (this.antialias) {
      const mask2 = grayRasterize(contours, evenOdd, this.width, this.height);
      if (!mask2) return;
      const out = this.batched(p, 1 /* Gray */);
      maskSpans(mask2, out.sink);
      out.end();
    } else {
      const fixed = contours.map((c) => c.map((v) => Math.floor(v * 64 + 0.5) / 64));
      const out = this.batched(p, 0 /* Rasterizer */);
      rasterizePolygonsAliased(fixed, evenOdd, this.clip, out.sink);
      out.end();
    }
  }
  /** Run `draw` with a cosmetic stroker for `pen`; its spans are blended in Qt's batches. */
  cosmetic(pen2, draw) {
    const out = this.batched(prepare(pen2.brush), 2 /* Cosmetic */);
    draw(new CosmeticStroker(this.width, this.height, this.antialias, pen2.width, pen2.cap !== "flat", (x, y, coverage) => out.sink(x, y, 1, coverage)));
    out.end();
  }
  /** `QPainter::drawPolyline`. */
  drawPolyline(points, pen2) {
    if (points.length < 4) return;
    if (pen2.width <= 1) {
      this.cosmetic(pen2, (c) => c.drawPolygon(points, false));
      return;
    }
    const path3 = { types: [], pts: [] };
    for (let i = 0; i < points.length; i += 2) {
      path3.types.push(i === 0 ? MOVE_TO : LINE_TO);
      path3.pts.push(points[i], points[i + 1]);
    }
    this.fillPath(strokePath(path3, pen2, true), pen2.brush, false);
  }
  /** `QPainter::drawPath` with no brush. */
  drawPath(path3, pen2) {
    if (path3.types.length === 0) return;
    if (pen2.width <= 1) {
      this.cosmetic(pen2, (c) => c.drawPath(path3));
      return;
    }
    this.fillPath(strokePath(path3, pen2, false), pen2.brush, false);
  }
  /** `QPainter::drawLine(QPointF, QPointF)`. */
  drawLine(x1, y1, x2, y2, pen2) {
    if (pen2.width <= 1) {
      this.cosmetic(pen2, (c) => c.drawLine(x1, y1, x2, y2));
      return;
    }
    const path3 = { types: [MOVE_TO, LINE_TO], pts: [x1, y1, x2, y2] };
    this.fillPath(strokePath(path3, pen2, false), pen2.brush, false);
  }
  /** `QPainter::drawEllipse(center, rx, ry)` with no pen. */
  fillEllipse(cx, cy, rx, ry, brush) {
    let x = cx - rx;
    let y = cy - ry;
    let w = 2 * rx;
    let h = 2 * ry;
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    const arc = curvesForArc(x, y, w, h, 0, -360);
    if (arc.curves.length === 0) return;
    const path3 = { types: [MOVE_TO], pts: [arc.sx, arc.sy] };
    for (let i = 0; i < arc.curves.length; i += 6) {
      path3.types.push(CURVE_TO, CURVE_DATA, CURVE_DATA);
      path3.pts.push(...arc.curves.slice(i, i + 6));
    }
    this.fillPath(path3, brush, true);
  }
  /** `drawImage(0, 0, image)` with SourceOver (the `qBlendFunctions` fast path). */
  drawImageSourceOver(image) {
    const w = Math.min(this.width, image.width);
    const h = Math.min(this.height, image.height);
    for (let y = 0; y < h; y += 1) blendSourceOverFast(this.data, y * this.width * 4, image.data, y * image.width * 4, w, 256);
  }
  /** `drawImage(0, 0, image)` with CompositionMode_DestinationIn (texture spans). */
  drawImageDestinationIn(image) {
    const w = Math.min(this.width, image.width);
    const h = Math.min(this.height, image.height);
    for (let y = 0; y < h; y += 1) DESTINATION_IN(this.data, y * this.width * 4, image.data, y * image.width * 4, w, 255);
  }
};

// ../engine/src/render/kernels/audio-visualization.ts
var WAVEFORM = 0;
var FILLED_WAVEFORM = 1;
var BARS = 2;
var RADIAL = 3;
var SPECTRUM = 4;
var PHASE_SCOPE = 5;
var PARTICLES = 6;
var VU_METER = 7;
var RADIAL_BARS = 8;
var LAYOUT_AUTO = 0;
var LAYOUT_SPLIT = 2;
var LAYOUT_OVERLAY = 3;
var BACKGROUND_SOLID = 1;
var BACKGROUND_FADE = 2;
var BACKGROUND_GRADIENT = 3;
var BACKGROUND_SOURCE = 4;
var RAINBOW = 1;
var PI = Math.PI;
var TWO_PI2 = 2 * Math.PI;
var HALF_PI_NEG = -Math.PI * 0.5;
var GLOW_MIN = f322(0.01);
function fillBrush(fill) {
  return fill.kind === "solid" ? { kind: "solid", color: fill.color } : fill;
}
function solid(c) {
  return { kind: "solid", color: c };
}
function horizontal(width, stops) {
  return { kind: "linear", x1: 0, y1: 0, x2: width, y2: 0, stops };
}
function pen(brush, width, cap = "square", join = "bevel") {
  return { brush, width, cap, join };
}
function drawWaveform(p, s) {
  p.antialias = false;
  const { width, height, gain, smoothing, styledGlow, style, spread: spread2, base, palette } = s;
  const lanes = s.split || s.overlay ? Math.min(s.channels, 8) : 1;
  const columns = clampi(lround(f322(fmaf(s.detail, 0.25, 0.75) * width)), 16, Math.max(16, width));
  const alphaScale = s.overlay ? f322(0.48) : 1;
  const rainbow = s.colorMode === RAINBOW;
  const lineWidth = s.stroke > 1 ? s.stroke : 1;
  for (let lane = 0; lane < lanes; lane += 1) {
    const values = bucketSamples(s.audio, s.split || s.overlay ? lane : -1, columns, gain, smoothing);
    const size = values.length;
    const laneTop = s.split ? f322(height * lane / lanes) : 0;
    const laneHeight = s.split ? f322(height / lanes) : height;
    const centerY = fmaf(laneHeight, 0.5, laneTop);
    const amplitude = f322(laneHeight * f322(0.44));
    const laneBase = rainbow ? rainbowColor(base, f322(lane / Math.max(1, lanes)), spread2) : s.overlay ? mixColor(base, hueShift(base, lane * 18), f322(spread2 * f322(0.18))) : lane % 2 ? palette.accent : base;
    const lanePalette = makePalette(laneBase, styledGlow, style, spread2);
    if (s.mode === FILLED_WAVEFORM) {
      const envelopeOf = (v) => {
        if (v === 0) return 0;
        const m = f322(amplitude * Math.abs(v));
        return m > 1 ? m : 1;
      };
      if (styledGlow > GLOW_MIN) {
        const glowBrush = rainbow ? horizontal(width, rainbowStops(base, spread2, f322(f322(0.78) * alphaScale))) : solid(alphaColor(lanePalette.glow, f322(f322(0.78) * alphaScale)));
        const pad2 = Math.max(1, Math.ceil(f322(styledGlow * 5)));
        for (let i = 0; i < size; i += 4) {
          const x0 = Math.floor(i * width / size);
          const x1 = Math.floor(Math.min(i + 4, size) * width / size);
          let envelope = 0;
          for (let j = i; j < Math.min(i + 4, size); j += 1) {
            const e = envelopeOf(values[j]);
            if (envelope < e) envelope = e;
          }
          const y0 = clampi(Math.floor(f322(centerY - envelope)) - pad2, 0, height);
          const y1 = clampi(Math.ceil(f322(centerY + envelope)) + pad2, y0 + 1, height);
          p.drawRectI(x0, y0, Math.max(1, x1 - x0), y1 - y0, glowBrush);
        }
      }
      const fill = rainbow ? horizontal(width, rainbowStops(base, spread2, f322(styleFillAlpha(style) * alphaScale))) : fillBrush(verticalStyleFill(0, laneTop, 0, f322(laneTop + laneHeight), lanePalette, style, alphaScale));
      for (let i = 0; i < size; i += 1) {
        const x0 = Math.floor(i * width / size);
        const x1 = Math.floor((i + 1) * width / size);
        const envelope = envelopeOf(values[i]);
        const y0 = clampi(Math.floor(f322(centerY - envelope)), 0, height);
        const y1 = clampi(Math.ceil(f322(centerY + envelope)), y0 + 1, height);
        p.drawRectI(x0, y0, Math.max(1, x1 - x0), y1 - y0, fill);
      }
      continue;
    }
    const points = [];
    for (let i = 0; i < size; i += 1) {
      const x = size <= 1 ? 0 : f322((width - 1) * i / (size - 1));
      points.push(x, fmaf(-values[i], amplitude, centerY));
    }
    const glowWidth = fmaf(styledGlow, 16, lineWidth);
    if (rainbow) {
      if (styledGlow > GLOW_MIN) p.drawPolyline(points, pen(horizontal(width, rainbowStops(base, spread2, f322(f322(0.88) * alphaScale))), glowWidth, "flat"));
      p.drawPolyline(points, pen(horizontal(width, rainbowStops(base, spread2, alphaScale)), lineWidth, "flat"));
    } else {
      if (styledGlow > GLOW_MIN) p.drawPolyline(points, pen(solid(alphaColor(lanePalette.glow, f322(f322(0.88) * alphaScale))), glowWidth, "flat"));
      p.drawPolyline(points, pen(solid(alphaColor(lanePalette.base, alphaScale)), lineWidth, "flat"));
    }
  }
}
function drawBars(p, s) {
  const { width, height, styledGlow, style, spread: spread2, base } = s;
  const bars2 = clampi(lround(fmaf(s.detail, 112, 16)), 8, Math.max(8, Math.floor(width / 3)));
  const bins = spectrumBins(s.audio, bars2, s.gain, s.smoothing, s.lowHz, s.highHz);
  const step = f322(width / bars2);
  const g = f322(step * f322(0.18));
  const gap = g > 1 ? g : 1;
  const bw = f322(step - gap);
  const barWidth = bw > 1 ? bw : 1;
  const pitch = f322(gap + barWidth);
  for (let i = 0; i < bars2; i += 1) {
    const x = f322(pitch * i);
    const hh = f322(f322(bins[i] * height) * f322(0.88));
    const h = hh > 1 ? hh : 1;
    const top = f322(height - h);
    const barPalette = s.colorMode === RAINBOW ? makePalette(rainbowColor(base, f322(i / Math.max(1, bars2 - 1)), spread2), styledGlow, style, spread2) : s.palette;
    if (styledGlow > GLOW_MIN) {
      const dx1 = f322(styledGlow * -2);
      const dy1 = f322(styledGlow * -5);
      const dx2 = f322(styledGlow * 2);
      p.fillRect(x + dx1, top + dy1, barWidth + dx2 - dx1, h + 0 - dy1, solid(alphaColor(barPalette.glow, f322(0.55))));
    }
    p.fillRect(x, top, barWidth, h, fillBrush(verticalStyleFill(0, top, 0, height, barPalette, style)));
  }
}
function drawSpectrum(p, s) {
  const { width, height, styledGlow, style, spread: spread2, base, palette } = s;
  const count = clampi(lround(fmaf(s.detail, 220, 56)), 40, Math.max(40, Math.floor(width / 2)));
  const bins = spectrumBins(s.audio, count, s.gain, s.smoothing, s.lowHz, s.highHz);
  const px = [];
  const py = [];
  for (let i = 0; i < count; i += 1) {
    px.push(f322(i * width / Math.max(1, count - 1)));
    const hh = f322(f322(bins[i] * height) * f322(0.84));
    py.push(f322(height - (hh > 1 ? hh : 1)));
  }
  const ridge = newPath();
  moveTo(ridge, px[0], py[0]);
  for (let i = 0; i + 1 < count; i += 1) {
    const i0 = i === 0 ? i : i - 1;
    const i3 = Math.min(i + 2, count - 1);
    const c1x = (px[i + 1] - px[i0]) / 6 + px[i];
    const c1y = (py[i + 1] - py[i0]) / 6 + py[i];
    const c2x = px[i + 1] - (px[i3] - px[i]) / 6;
    const c2y = py[i + 1] - (py[i3] - py[i]) / 6;
    cubicTo(ridge, c1x, c1y, c2x, c2y, px[i + 1], py[i + 1]);
  }
  const terrain = s.colorMode === RAINBOW ? horizontal(width, rainbowStops(base, spread2, styleFillAlpha(style))) : fillBrush(verticalStyleFill(0, 0, 0, height, palette, style));
  if (count > 1) {
    const layer = createPremul(width, height);
    new Painter(layer).fillRect(0, 0, width, height, terrain);
    const mask2 = createPremul(width, height);
    const maskPainter = new Painter(mask2);
    const white = pen(solid(rgb8(255, 255, 255)), 1);
    for (let x = 0; x < width; x += 1) {
      const position = f322(f322(x * (count - 1)) / Math.max(1, width - 1));
      const index = clampi(Math.floor(position), 0, count - 2);
      const mix = f322(position - index);
      const y = f322(fma2(py[index], f322(1 - mix), py[index + 1] * mix));
      const lx = f322(x + 0.5);
      maskPainter.drawLine(lx, y, lx, height, white);
    }
    const layerPainter = new Painter(layer);
    layerPainter.drawImageDestinationIn(mask2);
    p.drawImageSourceOver(layer);
  }
  const rs = f322(s.stroke * f322(0.75));
  const ridgeWidth = rs > 1 ? rs : 1;
  if (s.colorMode === RAINBOW) {
    if (styledGlow > GLOW_MIN) p.drawPath(ridge, pen(horizontal(width, rainbowStops(base, spread2, f322(0.45))), fmaf(styledGlow, 10, ridgeWidth), "round", "round"));
    p.drawPath(ridge, pen(horizontal(width, rainbowStops(base, spread2)), ridgeWidth, "round", "round"));
  } else {
    const glow2 = f322(styledGlow * f322(0.55));
    if (glow2 > GLOW_MIN) p.drawPath(ridge, pen(solid(palette.glow), fmaf(glow2, 18, ridgeWidth), "round", "round"));
    p.drawPath(ridge, pen(solid(palette.base), ridgeWidth, "round", "round"));
  }
}
function drawRadial(p, s) {
  const { width, height, styledGlow, spread: spread2, base, palette, stroke } = s;
  const segments = clampi(lround(fmaf(s.detail, 192, 48)), 24, 256);
  const bins = spectrumBins(s.audio, segments, s.gain, s.smoothing, s.lowHz, s.highHz);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const radius = f322(Math.min(width, height) * f322(0.24));
  const ring = newPath();
  for (let i = 0; i <= segments; i += 1) {
    const angle = TWO_PI2 * i / segments + HALF_PI_NEG;
    const r = fmaf(bins[i % segments], radius, radius);
    const x = fma2(Math.cos(angle), r, cx);
    const y = fma2(Math.sin(angle), r, cy);
    if (i === 0) moveTo(ring, x, y);
    else lineTo(ring, x, y);
  }
  let stops;
  if (s.colorMode === RAINBOW) stops = rainbowStops(base, spread2);
  else {
    stops = [];
    setColorAt(stops, 0, palette.base);
    setColorAt(stops, 0.45, palette.light);
    setColorAt(stops, 1, palette.accent);
  }
  if (styledGlow > GLOW_MIN) {
    const glowBrush = s.colorMode === RAINBOW ? { kind: "conical", cx, cy, angle: -90, stops: rainbowStops(base, spread2, f322(0.48)) } : solid(palette.glow);
    p.drawPath(ring, pen(glowBrush, fmaf(styledGlow, 16, stroke), "round", "round"));
  }
  p.drawPath(ring, pen({ kind: "conical", cx, cy, angle: -90, stops }, f322(stroke + 1), "round", "round"));
}
function drawRadialBars(p, s) {
  const { width, height, styledGlow, spread: spread2, base, palette } = s;
  const bars2 = clampi(lround(fmaf(s.detail, 156, 36)), 24, 220);
  const bins = spectrumBins(s.audio, bars2, s.gain, s.smoothing, s.lowHz, s.highHz);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const minDimension = Math.min(width, height);
  const inner = f322(minDimension * f322(0.22));
  const maxLength = f322(minDimension * f322(0.28));
  const bw = f322(TWO_PI2 * inner / bars2 * 0.55);
  const barWidth = bw > 1 ? bw : 1;
  const minLength = f322(minDimension * f322(0.012));
  const glowWidth = fmaf(styledGlow, 8, barWidth);
  for (let i = 0; i < bars2; i += 1) {
    const angle = TWO_PI2 * i / bars2 + HALF_PI_NEG;
    const scaled = f322(maxLength * bins[i]);
    const length = minLength < scaled ? scaled : minLength;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const sx = fma2(cos, inner, cx);
    const sy = fma2(sin, inner, cy);
    const outer = f322(inner + length);
    const ex = fma2(cos, outer, cx);
    const ey = fma2(sin, outer, cy);
    const c = s.colorMode === RAINBOW ? rainbowColor(base, f322(i / Math.max(1, bars2 - 1)), spread2) : mixColor(palette.base, palette.light, f322(bins[i] * f322(0.35)));
    if (styledGlow > GLOW_MIN) {
      const glowColor = s.colorMode === RAINBOW ? alphaColor(c, f322(0.58)) : alphaColor(palette.glow, f322(0.65));
      p.drawLine(sx, sy, ex, ey, pen(solid(glowColor), glowWidth, "round"));
    }
    p.drawLine(sx, sy, ex, ey, pen(solid(c), barWidth, "round"));
  }
}
function drawPhaseScope(p, s) {
  p.antialias = false;
  const { width, height, styledGlow, spread: spread2, base, palette, gain } = s;
  const count = clampi(lround(fmaf(s.detail, 224, 96)), 64, 320);
  const audio = s.audio;
  const samples = frameSampleCount(audio);
  const left = audio.channels[0];
  const right = audio.channels[1];
  const halfW = f322(width * 0.5);
  const halfH = f322(height * 0.5);
  let prevX = halfW;
  let prevY = halfH;
  const trace = [];
  const kx = f322(0.38);
  const ky = f322(-0.42);
  for (let i = 0; i < count; i += 1) {
    const sample = clampi(Math.trunc(i * samples / count), 0, samples - 1);
    const l = left[sample];
    const r = right[sample];
    const ax = clampf(f322(f322(f322(l - r) * gain) * f322(0.75)), -1, 1);
    const ay = clampf(f322(f322(f322(l + r) * gain) * f322(0.38)), -1, 1);
    const rawX = fmaf(0.5, width, f322(f322(ax * width) * kx));
    const rawY = fmaf(0.5, height, f322(f322(ay * height) * ky));
    const x = fmaf(f322(0.72), prevX, f322(rawX * f322(0.28)));
    const y = fmaf(f322(0.72), prevY, f322(rawY * f322(0.28)));
    trace.push(x, y);
    prevX = x;
    prevY = y;
  }
  const cross = pen(solid(alphaColor(palette.dark, f322(0.35))), 1);
  p.drawLine(halfW, f322(height * f322(0.12)), halfW, f322(height * f322(0.88)), cross);
  p.drawLine(f322(width * f322(0.12)), halfH, f322(width * f322(0.88)), halfH, cross);
  const traceWidth = s.stroke > 1 ? s.stroke : 1;
  const glowWidth = fmaf(styledGlow, 10, traceWidth);
  if (s.colorMode === RAINBOW) {
    let minX = trace[0];
    let maxX = minX;
    let minY = trace[1];
    let maxY = minY;
    for (let i = 2; i < trace.length; i += 2) {
      const tx = trace[i];
      const ty = trace[i + 1];
      if (tx < minX) minX = tx;
      else if (tx > maxX) maxX = tx;
      if (ty < minY) minY = ty;
      else if (ty > maxY) maxY = ty;
    }
    let bx = minX;
    let by = minY;
    let bw = maxX - minX;
    let bh = maxY - minY;
    const minSpan = Math.min(width, height) * 0.22;
    if (bw < minSpan) {
      const d1 = (bw - minSpan) * 0.5;
      const d2 = (minSpan - bw) * 0.5;
      bx += d1;
      bw += d2 - d1;
    }
    if (bh < minSpan) {
      const d1 = (bh - minSpan) * 0.5;
      const d2 = (minSpan - bh) * 0.5;
      by += d1;
      bh += d2 - d1;
    }
    [bx, by, bw, bh] = intersectRect(bx, by, bw, bh, 0, 0, width, height);
    const centerY = by + bh * 0.5;
    const grad = (stops) => ({ kind: "linear", x1: bx, y1: centerY, x2: bx + bw, y2: centerY, stops });
    if (styledGlow > GLOW_MIN) p.drawPolyline(trace, pen(grad(rainbowStops(base, spread2, f322(0.42))), glowWidth, "flat"));
    p.drawPolyline(trace, pen(grad(rainbowStops(base, spread2)), traceWidth, "flat"));
  } else {
    if (styledGlow > GLOW_MIN) p.drawPolyline(trace, pen(solid(palette.glow), glowWidth, "flat"));
    p.drawPolyline(trace, pen(solid(palette.base), traceWidth, "flat"));
  }
}
function intersectRect(x1, y1, w1, h1, x2, y2, w2, h2) {
  let l1 = x1;
  let r1 = x1;
  if (w1 < 0) l1 += w1;
  else r1 += w1;
  if (l1 === r1) return [0, 0, 0, 0];
  let l2 = x2;
  let r2 = x2;
  if (w2 < 0) l2 += w2;
  else r2 += w2;
  if (l2 === r2) return [0, 0, 0, 0];
  if (l1 >= r2 || l2 >= r1) return [0, 0, 0, 0];
  let t1 = y1;
  let b1 = y1;
  if (h1 < 0) t1 += h1;
  else b1 += h1;
  if (t1 === b1) return [0, 0, 0, 0];
  let t2 = y2;
  let b2 = y2;
  if (h2 < 0) t2 += h2;
  else b2 += h2;
  if (t2 === b2) return [0, 0, 0, 0];
  if (t1 >= b2 || t2 >= b1) return [0, 0, 0, 0];
  const x = Math.max(l1, l2);
  const y = Math.max(t1, t2);
  return [x, y, Math.min(r1, r2) - x, Math.min(b1, b2) - y];
}
var PARTICLE_SEED = 747796405;
function drawParticles(p, s) {
  const { width, height, styledGlow, style, spread: spread2, base, palette, gain } = s;
  const count = clampi(lround(fmaf(s.detail, 920, 220)), 160, 1280);
  const level = reactiveLevel(s.audio, -1, gain);
  const bands = spectrumBins(s.audio, 36, gain, s.smoothing, s.lowHz, s.highHz);
  const low = bandLevel(bands, 0, f322(0.18));
  const mid = bandLevel(bands, f322(0.18), f322(0.56));
  const high = bandLevel(bands, f322(0.56), 1);
  const time = f322(f322(s.frame) * fmaf(level, f322(0.075), f322(0.028)));
  const cx = f322(width * 0.5);
  const cy = f322(fmaf(level, f322(-0.08), f322(0.55)) * height);
  const maxRadius = f322(Math.sqrt(width * width + height * height) * f322(0.42));
  const swirl = fmaf(low, f322(2.4), f322(0.65));
  const twist = fmaf(mid, f322(2.1), f322(0.45));
  const sparkle2 = f322(fmaf(high, f322(1.8), f322(0.2)) + 2);
  const radiusTerm = fmaf(low, f322(0.35), f322(0.88));
  const levelTerm = fmaf(level, f322(0.74), f322(0.62));
  const ribbonAmp = fmaf(height, f322(0.018), f322(f322(mid * height) * f322(0.055)));
  const trail = fmaf(level, 64, fmaf(low, 58, 16));
  const sizeTerm = fmaf(level, 2, fmaf(high, f322(2.25), f322(0.95)));
  const spreadTerm = fmaf(spread2, f322(0.35), 0.25);
  const alphaTerm = fmaf(high, f322(0.22), fmaf(level, f322(0.52), f322(0.12)));
  const trailAlpha = fmaf(mid, f322(0.16), f322(0.26));
  const trailWidthTerm = fmaf(low, f322(0.12), f322(0.28));
  const gradTerm = fmaf(styledGlow, 4, f322(2.2));
  const k035 = f322(0.35);
  for (let i = 0; i < count; i += 1) {
    const draws = mt19937Floats(Math.imul(i + 1, PARTICLE_SEED) >>> 0, 4);
    const seed = draws[0];
    const arm = Math.floor(f322(draws[1] * 5));
    const ageRaw = fmaf(time, fmaf(level, f322(0.55), fmaf(draws[2], f322(0.62), f322(0.18))), seed);
    const age = f322(ageRaw - Math.trunc(ageRaw));
    const eased = f322(Math.pow(age, f322(0.58)));
    const armFrac = f322(arm / 5);
    const baseAngle = f322(fma2(f322(armFrac + armFrac), PI, f322(draws[3] * f322(0.42))));
    const sway = f322(f322(f322(Math.sin(fmaf(seed, 12, time))) * twist) * f322(0.22));
    const orbit = f322(fma2(f322(swirl * eased), PI, baseAngle) + sway);
    const wave2 = f322(Math.sin(fma2(eased * PI, sparkle2, f322(seed * 10))));
    const radius = f322(levelTerm * f322(f322(fmaf(eased, radiusTerm, f322(0.06))) * maxRadius));
    const ribbon = f322(ribbonAmp * wave2);
    const sinO = f322(Math.sin(orbit));
    const cosO = f322(Math.cos(orbit));
    const px = fma2(-sinO, ribbon, fma2(cosO, radius, cx));
    const py = fma2(cosO, ribbon, fma2(sinO, radius, cy));
    const fade = f322(Math.sin(age * PI));
    let c = s.colorMode === RAINBOW ? rainbowColor(base, fmodOne(f322(armFrac + age)), spread2) : mixColor(palette.base, palette.light, f322(spreadTerm * fade));
    c = alphaColor(c, f322(alphaTerm * fade));
    const size = fmaf(fade, sizeTerm, f322(0.42));
    const tw = f322(trailWidthTerm * size);
    const trailPen = pen(solid(alphaColor(c, trailAlpha)), tw > f322(0.45) ? tw : f322(0.45), "round");
    const tailX = fma2(ribbon * sinO, k035, fma2(-cosO, trail, px));
    const tailY = fma2(-(ribbon * cosO), k035, fma2(-sinO, trail, py));
    p.drawLine(tailX, tailY, px, py, trailPen);
    let brush;
    if (style === STYLE_MINIMAL) brush = solid(alphaColor(c, 1));
    else {
      const stops = [];
      setColorAt(stops, 0, c);
      setColorAt(stops, 1, alphaColor(c, 0));
      brush = { kind: "radial", cx: px, cy: py, radius: f322(gradTerm * size), stops };
    }
    const r2 = f322(size + size);
    p.fillEllipse(px, py, r2, r2, brush);
  }
}
function fmodOne(x) {
  return f322(x - Math.trunc(x));
}
function drawVuMeter(p, s) {
  const { width, height, style, base, palette, gain } = s;
  const meters = s.split ? Math.min(s.channels, 8) : 1;
  const segments = clampi(lround(fmaf(s.detail, 32, 8)), 6, 48);
  const laneWidth = f322(width / meters);
  const offsetX = f322(laneWidth * f322(0.08));
  const g = f322(height * f322(0.01));
  const gap = g > 1 ? g : 1;
  const segH = f322(fmaf(height, f322(0.88), -f322((segments - 1) * gap)) / segments);
  const rectWidth2 = f322(laneWidth * f322(0.84));
  const a = alpha8(base);
  for (let meter = 0; meter < meters; meter += 1) {
    const level = reactiveLevel(s.audio, s.split ? meter : -1, gain);
    const x0 = fmaf(meter, laneWidth, offsetX);
    for (let segment = 0; segment < segments; segment += 1) {
      const t = f322((segment + 1) / segments);
      let c;
      if (style === STYLE_MINIMAL) c = palette.base;
      else if (t > f322(0.82)) c = rgb8(255, 86, 68, a);
      else if (t > f322(0.55)) c = mixColor(palette.accent, rgb8(255, 214, 90, a), f322(f322(t + f322(-0.55)) / f322(0.27)));
      else c = mixColor(palette.base, palette.light, f322(t * 1.5));
      if (!(t <= level)) c = alphaColor(palette.dark, 0.25);
      const y = fmaf(-segment, gap, fmaf(height, f322(0.94), -f322((segment + 1) * segH)));
      p.fillRect(x0, y, rectWidth2, segH, solid(c));
    }
  }
}
function render(image, params, ctx, modeOverride) {
  let width = Math.max(1, image.width);
  let height = Math.max(1, image.height);
  if (width <= 1 || height <= 1) {
    const tw = Math.trunc(ctx.timelineWidth ?? ctx.canvasWidth);
    const th = Math.trunc(ctx.timelineHeight ?? ctx.canvasHeight);
    if (tw > 1 && th > 1) {
      width = tw;
      height = th;
    }
  }
  const frame = ctx.frame;
  const intensity = clampf(f322(num(params, "intensity", 1)), 0, 10);
  const smoothing = clampf(f322(num(params, "smoothing", 0.35)), 0, 1);
  const detail = clampf(f322(num(params, "detail", 0.75)), 0, 1);
  const glow2 = clampf(f322(num(params, "glow", 0.25)), 0, 1);
  const spread2 = clampf(f322(num(params, "color_spread", 0.6)), 0, 1);
  const mode = modeOverride ?? clampi(int(params, "visualization_type", WAVEFORM), 0, RADIAL_BARS);
  const style = int(params, "style", 0);
  const colorMode = int(params, "color_mode", 0);
  const layout = int(params, "channel_layout", LAYOUT_AUTO);
  const background = int(params, "background", BACKGROUND_SOURCE);
  const usesFrequency = mode === BARS || mode === SPECTRUM || mode === RADIAL || mode === RADIAL_BARS || mode === PARTICLES;
  const lowHz = usesFrequency ? normalizedFrequencyToHz(f322(num(params, "frequency_low", 0)), false) : 20;
  const hiRaw = usesFrequency ? normalizedFrequencyToHz(f322(num(params, "frequency_high", 1)), true) : 2e4;
  const highHz = usesFrequency ? Math.max(f322(lowHz + 1), hiRaw) : 2e4;
  const audio = ctx.audio;
  const channels = Math.max(1, audio ? audio.channels.length : 0);
  const split = layout === LAYOUT_SPLIT || layout === LAYOUT_AUTO && channels > 1 && (mode === WAVEFORM || mode === FILLED_WAVEFORM || mode === VU_METER);
  const overlay = layout === LAYOUT_OVERLAY;
  if (mode === PHASE_SCOPE && channels < 2 && frameSampleCount(audio) > 0) {
    return render(image, params, ctx, WAVEFORM);
  }
  let visual;
  if (background === BACKGROUND_SOURCE && image.width > 0 && image.height > 0) {
    visual = image.width === width && image.height === height ? clonePremul(image) : smoothScale(image, width, height);
  } else visual = createPremul(width, height);
  const base = color(params, "color", [68, 170, 255, 255]);
  const baseColor = rgb8(clampi(getInt(base[0]), 0, 255), clampi(getInt(base[1]), 0, 255), clampi(getInt(base[2]), 0, 255), clampi(getInt(base[3]), 0, 255));
  const styledGlow = styleGlowAmount(style, glow2);
  const palette = makePalette(baseColor, styledGlow, style, spread2);
  const p = new Painter(visual);
  if (background === BACKGROUND_SOLID) p.fillRect(0, 0, width, height, solid(palette.dark));
  else if (background === BACKGROUND_FADE) {
    const stops = [];
    setColorAt(stops, 0, alphaColor(palette.dark, 0));
    setColorAt(stops, 1, alphaColor(palette.dark, f322(0.55)));
    p.fillRect(0, 0, width, height, { kind: "linear", x1: 0, y1: 0, x2: 0, y2: height, stops });
  } else if (background === BACKGROUND_GRADIENT) {
    const stops = [];
    setColorAt(stops, 0, alphaColor(palette.dark, f322(0.55)));
    setColorAt(stops, 1, alphaColor(palette.accent, f322(0.35)));
    p.fillRect(0, 0, width, height, { kind: "linear", x1: 0, y1: 0, x2: width, y2: height, stops });
  }
  if (frameSampleCount(audio) <= 0) return visual;
  const gain = intensity > GLOW_MIN ? intensity : GLOW_MIN;
  const stroke = styleStrokeWidth(style, styledGlow);
  const waveformMode = mode === WAVEFORM || mode === FILLED_WAVEFORM;
  p.antialias = !waveformMode || styledGlow > GLOW_MIN || stroke > f322(1.05);
  const setup = {
    width,
    height,
    frame,
    audio,
    channels,
    mode,
    style,
    colorMode,
    smoothing,
    detail,
    spread: spread2,
    lowHz,
    highHz,
    split,
    overlay,
    base: baseColor,
    styledGlow,
    palette,
    gain,
    stroke
  };
  if (waveformMode) drawWaveform(p, setup);
  else if (mode === BARS) drawBars(p, setup);
  else if (mode === SPECTRUM) drawSpectrum(p, setup);
  else if (mode === RADIAL) drawRadial(p, setup);
  else if (mode === RADIAL_BARS) drawRadialBars(p, setup);
  else if (mode === PHASE_SCOPE) drawPhaseScope(p, setup);
  else if (mode === PARTICLES) drawParticles(p, setup);
  else if (mode === VU_METER) drawVuMeter(p, setup);
  return visual;
}
var audioVisualization = {
  type: "AudioVisualization",
  supported: true,
  run(image, params, ctx) {
    return render(image, params, ctx);
  }
};

// ../engine/src/model/types.ts
var Interpolation = {
  BEZIER: 0,
  LINEAR: 1,
  CONSTANT: 2
};
var HandleType = {
  AUTO: 0,
  MANUAL: 1
};

// ../engine/src/model/rounding.ts
function roundHalfAway(x) {
  if (!Number.isFinite(x)) return x;
  const a = Math.abs(x);
  const f = Math.floor(a);
  const r = a - f >= 0.5 ? f + 1 : f;
  return x < 0 && r !== 0 ? -r : r;
}
function truncInt(x) {
  const t = Math.trunc(x);
  return t === 0 ? 0 : t;
}

// ../engine/src/keyframe/points.ts
var DEFAULT_HANDLE_LEFT = Object.freeze({ X: 0.5, Y: 1 });
var DEFAULT_HANDLE_RIGHT = Object.freeze({ X: 0.5, Y: 0 });
function num2(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resolvePoint(raw) {
  const p = isRecord2(raw) ? raw : {};
  const co = isRecord2(p.co) ? p.co : {};
  const hl = isRecord2(p.handle_left) ? p.handle_left : {};
  const hr = isRecord2(p.handle_right) ? p.handle_right : {};
  return {
    x: num2(co.X) ?? 1,
    y: num2(co.Y) ?? 0,
    // jsoncpp asInt() truncates a double.
    interpolation: Math.trunc(num2(p.interpolation) ?? Interpolation.BEZIER),
    handleType: Math.trunc(num2(p.handle_type) ?? HandleType.AUTO),
    leftX: num2(hl.X) ?? DEFAULT_HANDLE_LEFT.X,
    leftY: num2(hl.Y) ?? DEFAULT_HANDLE_LEFT.Y,
    rightX: num2(hr.X) ?? DEFAULT_HANDLE_RIGHT.X,
    rightY: num2(hr.Y) ?? DEFAULT_HANDLE_RIGHT.Y
  };
}
function lowerBound(points, target) {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (points[mid].x < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function addResolvedPoint(points, point) {
  const at = lowerBound(points, point.x);
  if (at < points.length && points[at].x === point.x) points[at] = point;
  else points.splice(at, 0, point);
}
function resolvePoints(kf) {
  if (typeof kf === "number") {
    if (!Number.isFinite(kf)) return [];
    return [
      {
        x: 1,
        y: Math.fround(kf),
        interpolation: Interpolation.CONSTANT,
        handleType: HandleType.AUTO,
        leftX: DEFAULT_HANDLE_LEFT.X,
        leftY: DEFAULT_HANDLE_LEFT.Y,
        rightX: DEFAULT_HANDLE_RIGHT.X,
        rightY: DEFAULT_HANDLE_RIGHT.Y
      }
    ];
  }
  if (!isRecord2(kf) || !Array.isArray(kf.Points)) return [];
  const raw = kf.Points;
  const out = [];
  let sorted = true;
  for (const item of raw) {
    const p = resolvePoint(item);
    const last = out[out.length - 1];
    if (sorted && (last === void 0 || last.x < p.x)) out.push(p);
    else {
      sorted = false;
      addResolvedPoint(out, p);
    }
  }
  return out;
}

// ../engine/src/keyframe/evaluate.ts
var BEZIER_ALLOWED_ERROR = 0.01;
var BEZIER_MAX_ITERATIONS = 100;
function linear(left, right, target) {
  const diffY = right.y - left.y;
  const diffX = right.x - left.x;
  const slope = diffY / diffX;
  return fma(slope, target - left.x, left.y);
}
function bezier(left, right, target, allowedError) {
  const xDiff = right.x - left.x;
  const yDiff = right.y - left.y;
  const p0x = left.x;
  const p0y = left.y;
  const p1x = fma(left.rightX, xDiff, p0x);
  const p1y = fma(left.rightY, yDiff, p0y);
  const p2x = fma(right.leftX, xDiff, p0x);
  const p2y = fma(right.leftY, yDiff, p0y);
  const p3x = right.x;
  const p3y = right.y;
  let t = 0.5;
  let tStep = 0.25;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
  for (let iteration = 0; iteration < BEZIER_MAX_ITERATIONS; iteration += 1) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    b1 = t * 3 * uu;
    b2 = tt * 3 * u;
    b3 = tt * t;
    b0 = uu * u;
    const x = fma(p3x, b3, fma(p2x, b2, fma(p0x, b0, p1x * b1)));
    if (Math.abs(target - x) < allowedError) break;
    if (x > target) t -= tStep;
    else t += tStep;
    tStep /= 2;
  }
  return fma(p3y, b3, fma(p2y, b2, fma(p0y, b0, p1y * b1)));
}
function interpolateBetween(left, right, target, allowedError = BEZIER_ALLOWED_ERROR) {
  if (left.x > target) return left.y;
  if (target > right.x) return right.y;
  switch (right.interpolation) {
    case Interpolation.CONSTANT:
      return left.y;
    case Interpolation.LINEAR:
      return linear(left, right, target);
    case Interpolation.BEZIER:
      return bezier(left, right, target, allowedError);
    default:
      return linear(left, right, target);
  }
}
function valueAtResolved(points, x) {
  if (points.length === 0) return 0;
  const at = lowerBound(points, x);
  if (at === points.length) return points[points.length - 1].y;
  if (at === 0) return points[0].y;
  const candidate = points[at];
  if (candidate.x === x) return candidate.y;
  return interpolateBetween(points[at - 1], candidate, x);
}
function evaluate(kf, frame, fallback) {
  if ((kf === void 0 || kf === null) && fallback !== void 0) return fallback;
  return valueAtResolved(resolvePoints(kf), truncInt(frame));
}

// ../engine/src/render/plan/effect-params.ts
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function readNode(raw) {
  const n = isRecord3(raw) ? raw : {};
  const int2 = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
  return {
    id: int2(n.id, 0),
    x: n.x ?? 0,
    y: n.y ?? 0,
    lhx: n.left_handle_x ?? 0.5,
    lhy: n.left_handle_y ?? 1,
    rhx: n.right_handle_x ?? 0.5,
    rhy: n.right_handle_y ?? 0,
    interpolation: int2(n.interpolation, 1),
    handleType: int2(n.handle_type, 0)
  };
}
function valueOf(v, frame) {
  if (typeof v === "number") return v;
  return evaluate(v, frame);
}
function evaluateAnimatedCurve(json, frame, defaultNodes) {
  const root = isRecord3(json) ? json : {};
  const enabled = root.enabled === void 0 ? 1 : valueOf(root.enabled, frame);
  let rawNodes = Array.isArray(root.nodes) && root.nodes.length > 0 ? root.nodes : [];
  if (rawNodes.length === 0) {
    rawNodes = defaultNodes ?? [
      { id: 0, x: 0, y: 0, interpolation: 1 },
      { id: 1, x: 1, y: 1, interpolation: 1 }
    ];
  }
  const nodes = rawNodes.map(readNode);
  const xs = new Map(nodes.map((n) => [n, valueOf(n.x, frame)]));
  nodes.sort((a, b) => {
    const ax = xs.get(a);
    const bx = xs.get(b);
    if (ax === bx) return a.id - b.id;
    return ax - bx;
  });
  const points = [];
  for (const n of nodes) {
    addResolvedPoint(points, {
      x: Math.fround(clamp01(valueOf(n.x, frame)) * 255),
      y: Math.fround(clamp01(valueOf(n.y, frame))),
      interpolation: n.interpolation,
      handleType: n.handleType,
      leftX: clamp01(valueOf(n.lhx, frame)),
      leftY: clamp01(valueOf(n.lhy, frame)),
      rightX: clamp01(valueOf(n.rhx, frame)),
      rightY: clamp01(valueOf(n.rhy, frame))
    });
  }
  const table = [];
  for (let i = 0; i < 256; i += 1) table.push(clamp01(valueAtResolved(points, i)));
  return { enabled, table };
}
function sampleCurve(curve, input) {
  const v = clamp01(input);
  if (curve.enabled < 0.5) return Math.fround(v);
  const i = Math.round(v * 255);
  return Math.fround(curve.table[i] ?? v);
}
var DENOISE_RESPONSE_NODES = Object.freeze([
  { id: 0, x: 0, y: 1, interpolation: 1 },
  { id: 1, x: 0.5, y: 0.55, interpolation: 1 },
  { id: 2, x: 1, y: 0.2, interpolation: 1 }
]);

// ../engine/src/render/kernels/beat-sync.ts
var f323 = Math.fround;
var TWO_PI_F2 = f323(2 * f323(Math.PI));
var ONE_24TH = f323(1 / 24);
var MS = f323(1e-3);
function clampf2(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function normalizedToHz(v) {
  return f323(20 * f323(Math.pow(1e3, clampf2(v, 0, 1))));
}
function sampleCount2(audio) {
  return audio && audio.channels.length > 0 ? audio.channels[0].length : 0;
}
function bandEnergy(audio, lowHz, highHz, gain) {
  const samples = sampleCount2(audio);
  const channels = audio ? audio.channels.length : 0;
  if (!audio || samples <= 0 || channels <= 0) return 0;
  const sampleRate = Math.max(1, Math.trunc(audio.sampleRate));
  const nyquist = f323(sampleRate * 0.5);
  const low = clampf2(lowHz, 0, f323(nyquist - 1));
  const high = clampf2(highHz, f323(low + 1), nyquist);
  const dt = f323(1 / sampleRate);
  const alphaHi = f323(dt / f323(dt + f323(1 / f323(TWO_PI_F2 * high))));
  const alphaLo = low > 1 ? f323(dt / f323(dt + f323(1 / f323(TWO_PI_F2 * low)))) : 0;
  const ch = audio.channels;
  let lpHi = 0;
  let lpLo = 0;
  let sumSq = 0;
  let peak = 0;
  for (let s = 0; s < samples; s += 1) {
    let x = 0;
    for (let c = 0; c < channels; c += 1) x = f323(x + ch[c][s]);
    x = f323(x / channels);
    lpHi = fmaf(alphaHi, f323(x - lpHi), lpHi);
    lpLo = fmaf(alphaLo, f323(x - lpLo), lpLo);
    const filtered = f323(lpHi - lpLo);
    sumSq += f323(filtered * filtered);
    const absV = Math.abs(filtered);
    if (peak < absV) peak = absV;
  }
  const rms = f323(Math.sqrt(f323(sumSq / samples)));
  const a = f323(rms * f323(3.6));
  const b = f323(peak * f323(1.15));
  const combined = a < b ? b : a;
  return clampf2(f323(gain * combined), 0, 1);
}
function isCurve(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.enabled === "number" && Array.isArray(v.table);
}
function responseCurve(params, frame) {
  const v = record(params, "response_curve");
  if (!isCurve(v)) return evaluateAnimatedCurve({}, frame);
  return { enabled: v.enabled, table: v.table.map((x) => typeof x === "number" ? x : 0) };
}
function blendChannel(low, high, inv, blend) {
  return clampf2(low, 0, 255) * inv + clampf2(high, 0, 255) * blend >> 8;
}
var ENVELOPE = "BeatSync.envelope";
var LAST_FRAME = "BeatSync.lastFrame";
var beatSync = {
  type: "BeatSync",
  supported: true,
  run(image, params, ctx) {
    const frame = ctx.frame;
    let width = Math.max(1, image.width);
    let height = Math.max(1, image.height);
    if (width <= 1 || height <= 1) {
      const tw = Math.trunc(ctx.timelineWidth ?? ctx.canvasWidth);
      const th = Math.trunc(ctx.timelineHeight ?? ctx.canvasHeight);
      if (tw > 1 && th > 1) {
        width = tw;
        height = th;
      }
    }
    const state2 = ctx.state;
    let envelope = typeof state2?.get(ENVELOPE) === "number" ? state2.get(ENVELOPE) : 0;
    const lastFrame = typeof state2?.get(LAST_FRAME) === "number" ? state2.get(LAST_FRAME) : -1;
    if (lastFrame >= 0 && Math.abs(frame - lastFrame) >= 2) envelope = 0;
    const lowHz = normalizedToHz(f323(num(params, "frequency_low", 0)));
    const highHz = Math.max(f323(lowHz + 1), normalizedToHz(f323(num(params, "frequency_high", 1))));
    const gain = Math.max(f323(0.01), f323(num(params, "intensity", 2)));
    const audio = ctx.audio;
    const raw = bandEnergy(audio, lowHz, highHz, gain);
    const samples = sampleCount2(audio);
    const sampleRate = Math.max(1, Math.trunc(audio?.sampleRate ?? 0));
    const frameSec = samples > 0 ? f323(samples / sampleRate) : ONE_24TH;
    const ms = f323(raw > envelope ? num(params, "attack_ms", 10) : num(params, "decay_ms", 200));
    const tau = ms < 1 ? MS : f323(clampf2(ms, 1, 5e3) * MS);
    const coef = f323(Math.exp(f323(-frameSec / tau)));
    envelope = fmaf(coef, envelope, f323(raw * f323(1 - coef)));
    if (state2) {
      state2.set(ENVELOPE, envelope);
      state2.set(LAST_FRAME, frame);
    }
    const thr = clampf2(f323(num(params, "threshold", 0.1)), 0, 1);
    let energy = 0;
    if (envelope > thr) energy = clampf2(f323(f323(envelope - thr) / Math.max(f323(1 - thr), MS)), 0, 1);
    if (bool(params, "invert", false)) energy = f323(1 - energy);
    const response = clampf2(sampleCurve(responseCurve(params, frame), energy), 0, 1);
    const blend = clampf2(Math.trunc(fmaf(response, 256, 0.5)), 0, 256);
    const inv = 256 - blend;
    const low = color(params, "low_color", [0, 0, 0, 255]);
    const high = color(params, "high_color", [255, 255, 255, 255]);
    const ch = (i) => blendChannel(getInt(low[i]), getInt(high[i]), inv, blend);
    const r = ch(0);
    const g = ch(1);
    const b = ch(2);
    const a = ch(3);
    const out = createPremul(width, height);
    fillPremul(out, byteMul(r, a), byteMul(g, a), byteMul(b, a), a);
    return out;
  }
};

// ../engine/src/render/qt/blit.ts
function blendPixel(d, di, s, si, constAlpha255) {
  if (constAlpha255 === 255) {
    const sa = s[si + 3];
    if (sa === 255) {
      d[di] = s[si];
      d[di + 1] = s[si + 1];
      d[di + 2] = s[si + 2];
      d[di + 3] = 255;
    } else if (sa !== 0 || s[si] !== 0 || s[si + 1] !== 0 || s[si + 2] !== 0) {
      const ia2 = 255 - sa;
      d[di] = s[si] + byteMul(d[di], ia2);
      d[di + 1] = s[si + 1] + byteMul(d[di + 1], ia2);
      d[di + 2] = s[si + 2] + byteMul(d[di + 2], ia2);
      d[di + 3] = sa + byteMul(d[di + 3], ia2);
    }
    return;
  }
  if (s[si] === 0 && s[si + 1] === 0 && s[si + 2] === 0 && s[si + 3] === 0) return;
  const r = byteMul(s[si], constAlpha255);
  const g = byteMul(s[si + 1], constAlpha255);
  const b = byteMul(s[si + 2], constAlpha255);
  const a = byteMul(s[si + 3], constAlpha255);
  const ia = 255 - a;
  d[di] = r + byteMul(d[di], ia);
  d[di + 1] = g + byteMul(d[di + 1], ia);
  d[di + 2] = b + byteMul(d[di + 2], ia);
  d[di + 3] = a + byteMul(d[di + 3], ia);
}
function toRect(r) {
  const x = qRound(r.x);
  const y = qRound(r.y);
  return { x, y, width: qRound(r.x + r.width) - x, height: qRound(r.y + r.height) - y };
}
function drawImageRect(dst, src, target, source2, intOpacity = 256) {
  let { x, y, width: w, height: h } = target;
  let { x: sx, y: sy, width: sw, height: sh } = source2;
  if (sw <= 0) sw = src.width - sx;
  if (sh <= 0) sh = src.height - sy;
  if (w < 0) w = sw;
  if (h < 0) h = sh;
  if (sx < 0) {
    const wRatio = sx * w / sw;
    x -= wRatio;
    w += wRatio;
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    const hRatio = sy * h / sh;
    y -= hRatio;
    h += hRatio;
    sh += sy;
    sy = 0;
  }
  if (sw + sx > src.width) {
    const delta = sw - (src.width - sx);
    const wRatio = delta * w / sw;
    sw -= delta;
    w -= wRatio;
  }
  if (sh + sy > src.height) {
    const delta = sh - (src.height - sy);
    const hRatio = delta * h / sh;
    sh -= delta;
    h -= hRatio;
  }
  if (w === 0 || h === 0 || sw <= 0 || sh <= 0) return;
  if (w !== sw || h !== sh) {
    scaleBlit(dst, src, { x, y, width: w, height: h }, { x: sx, y: sy, width: sw, height: sh }, intOpacity);
    return;
  }
  if (intOpacity === 0) return;
  const sr = toRect({ x: sx, y: sy, width: sw, height: sh });
  let iw = sr.width;
  let ih = sr.height;
  let srcX = sr.x;
  let srcY = sr.y;
  let dx = qRound(x);
  let dy = qRound(y);
  if (dx < 0) {
    srcX -= dx;
    iw += dx;
    dx = 0;
  }
  if (dx + iw > dst.width) iw = dst.width - dx;
  if (dy < 0) {
    srcY -= dy;
    ih += dy;
    dy = 0;
  }
  if (dy + ih > dst.height) ih = dst.height - dy;
  if (iw <= 0 || ih <= 0) return;
  const ca = intOpacity >= 256 ? 255 : intOpacity * 255 >> 8;
  for (let row = 0; row < ih; row += 1) {
    let di = ((dy + row) * dst.width + dx) * 4;
    let si = ((srcY + row) * src.width + srcX) * 4;
    for (let col = 0; col < iw; col += 1, di += 4, si += 4) blendPixel(dst.data, di, src.data, si, ca);
  }
}
function scaleBlit(dst, src, target, source2, intOpacity = 256) {
  if (intOpacity === 0) return;
  const sxScale = source2.width / target.width;
  const syScale = source2.height / target.height;
  const ix = Math.trunc(65536 * sxScale);
  const iy = Math.trunc(65536 * syScale);
  let nx = target.x;
  let ny = target.y;
  let nw = target.width;
  let nh = target.height;
  if (nw < 0) {
    nx += nw;
    nw = -nw;
  }
  if (nh < 0) {
    ny += nh;
    nh = -nh;
  }
  const tr = toRect({ x: nx, y: ny, width: nw, height: nh });
  const left = Math.max(tr.x, 0);
  const top = Math.max(tr.y, 0);
  const right = Math.min(tr.x + tr.width, dst.width);
  const bottom = Math.min(tr.y + tr.height, dst.height);
  if (right <= left || bottom <= top) return;
  const tx1 = left;
  const ty1 = top;
  let w = right - left;
  let h = bottom - top;
  let basex;
  let srcy;
  if (sxScale < 0) {
    const dstx = qFloor((tx1 + 0.5 - (target.x + target.width)) * sxScale * 65536) + 1;
    basex = Math.trunc((source2.x + source2.width) * 65536) + dstx;
  } else {
    const dstx = qCeil((tx1 + 0.5 - target.x) * sxScale * 65536) - 1;
    basex = Math.trunc(source2.x * 65536) + dstx;
  }
  if (syScale < 0) {
    const dsty = qFloor((ty1 + 0.5 - (target.y + target.height)) * syScale * 65536) + 1;
    srcy = Math.trunc((source2.y + source2.height) * 65536) + dsty;
  } else {
    const dsty = qCeil((ty1 + 0.5 - target.y) * syScale * 65536) - 1;
    srcy = Math.trunc(source2.y * 65536) + dsty;
  }
  const srch = src.height;
  const srcw = src.width;
  if (Math.floor(srcy / 65536) >= srch && iy < 0) {
    srcy += iy;
    h -= 1;
  }
  if (Math.floor(basex / 65536) >= srcw && ix < 0) {
    basex += ix;
    w -= 1;
  }
  const yend = Math.floor((srcy + iy * (h - 1)) / 65536);
  if (yend < 0 || yend >= srch) h -= 1;
  const xend = Math.floor((basex + ix * (w - 1)) / 65536);
  if (xend < 0 || xend >= srcw) w -= 1;
  const ca = intOpacity >= 256 ? 255 : intOpacity * 255 >> 8;
  for (let row = 0; row < h; row += 1) {
    const sRow = Math.floor(srcy / 65536);
    let srcx = basex;
    let di = ((ty1 + row) * dst.width + tx1) * 4;
    for (let col = 0; col < w; col += 1, di += 4) {
      const si = (sRow * srcw + Math.floor(srcx / 65536)) * 4;
      blendPixel(dst.data, di, src.data, si, ca);
      srcx += ix;
    }
    srcy += iy;
  }
}
function fastScaled(src, w, h) {
  w = Math.max(1, Math.trunc(w));
  h = Math.max(1, Math.trunc(h));
  if (w === src.width && h === src.height) return src;
  const sx = w / src.width;
  const sy = h / src.height;
  const out = createPremul(qRound(Math.abs(sx) * src.width), qRound(Math.abs(sy) * src.height));
  scaleBlit(out, src, { x: 0, y: 0, width: src.width * sx, height: src.height * sy }, { x: 0, y: 0, width: src.width, height: src.height });
  return out;
}

// ../engine/src/render/qt/rect.ts
function qrect(x, y, w, h) {
  return { x1: x, y1: y, x2: x + w - 1, y2: y + h - 1 };
}
function rectWidth(r) {
  return r.x2 - r.x1 + 1;
}
function rectHeight(r) {
  return r.y2 - r.y1 + 1;
}
function isNull(r) {
  return r.x2 === r.x1 - 1 && r.y2 === r.y1 - 1;
}
function isEmpty(r) {
  return r.x1 > r.x2 || r.y1 > r.y2;
}
function marginsRemoved(rect, l, t, r, b) {
  return { x1: rect.x1 + l, y1: rect.y1 + t, x2: rect.x2 - r, y2: rect.y2 - b };
}
function intersected(a, b) {
  const empty = { x1: 0, y1: 0, x2: -1, y2: -1 };
  if (isNull(a) || isNull(b)) return empty;
  let l1 = a.x1;
  let r1 = a.x2;
  if (a.x2 < a.x1 - 1) [l1, r1] = [r1, l1];
  let l2 = b.x1;
  let r2 = b.x2;
  if (b.x2 < b.x1 - 1) [l2, r2] = [r2, l2];
  if (l1 > r2 || l2 > r1) return empty;
  let t1 = a.y1;
  let b1 = a.y2;
  if (a.y2 < a.y1 - 1) [t1, b1] = [b1, t1];
  let t2 = b.y1;
  let b2 = b.y2;
  if (b.y2 < b.y1 - 1) [t2, b2] = [b2, t2];
  if (t1 > b2 || t2 > b1) return empty;
  return { x1: Math.max(l1, l2), x2: Math.min(r1, r2), y1: Math.max(t1, t2), y2: Math.min(b1, b2) };
}

// ../engine/src/render/kernels/blur.ts
var f324 = Math.fround;
function clampMargin(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function marginArea(image, params) {
  const w = image.width;
  const h = image.height;
  const area = intersected(
    marginsRemoved(
      qrect(0, 0, w, h),
      Math.trunc(clampMargin(num(params, "left", 0)) * w),
      Math.trunc(clampMargin(num(params, "top", 0)) * h),
      Math.trunc(clampMargin(num(params, "right", 0)) * w),
      Math.trunc(clampMargin(num(params, "bottom", 0)) * h)
    ),
    qrect(0, 0, w, h)
  );
  return isEmpty(area) ? null : area;
}
function boxBlurH(src, dst, w, h, r) {
  const iarr = f324(1 / (r + r + 1));
  for (let y = 0; y < h; y += 1) {
    const row = y * w * 4;
    let v0 = 0;
    let v1 = 0;
    let v2 = 0;
    let v3 = 0;
    for (let j = -r; j <= r; j += 1) {
      const p = row + Math.min(Math.max(j, 0), w - 1) * 4;
      v0 += src[p];
      v1 += src[p + 1];
      v2 += src[p + 2];
      v3 += src[p + 3];
    }
    for (let j = 0; j < w; j += 1) {
      const o = row + j * 4;
      dst[o] = Math.trunc(f324(v0 * iarr + 0.5));
      dst[o + 1] = Math.trunc(f324(v1 * iarr + 0.5));
      dst[o + 2] = Math.trunc(f324(v2 * iarr + 0.5));
      dst[o + 3] = Math.trunc(f324(v3 * iarr + 0.5));
      const rem = row + Math.min(Math.max(j - r, 0), w - 1) * 4;
      const add = row + Math.min(Math.max(j + r + 1, 0), w - 1) * 4;
      v0 += src[add] - src[rem];
      v1 += src[add + 1] - src[rem + 1];
      v2 += src[add + 2] - src[rem + 2];
      v3 += src[add + 3] - src[rem + 3];
    }
  }
}
function boxBlurT(src, dst, w, h, r) {
  const iarr = f324(1 / (r + r + 1));
  const stride = w * 4;
  for (let x = 0; x < w; x += 1) {
    const col = x * 4;
    let v0 = 0;
    let v1 = 0;
    let v2 = 0;
    let v3 = 0;
    for (let j = -r; j <= r; j += 1) {
      const p = col + Math.min(Math.max(j, 0), h - 1) * stride;
      v0 += src[p];
      v1 += src[p + 1];
      v2 += src[p + 2];
      v3 += src[p + 3];
    }
    for (let j = 0; j < h; j += 1) {
      const o = col + j * stride;
      dst[o] = Math.trunc(f324(v0 * iarr + 0.5));
      dst[o + 1] = Math.trunc(f324(v1 * iarr + 0.5));
      dst[o + 2] = Math.trunc(f324(v2 * iarr + 0.5));
      dst[o + 3] = Math.trunc(f324(v3 * iarr + 0.5));
      const rem = col + Math.min(Math.max(j - r, 0), h - 1) * stride;
      const add = col + Math.min(Math.max(j + r + 1, 0), h - 1) * stride;
      v0 += src[add] - src[rem];
      v1 += src[add + 1] - src[rem + 1];
      v2 += src[add + 2] - src[rem + 2];
      v3 += src[add + 3] - src[rem + 3];
    }
  }
}
var blur = {
  type: "Blur",
  supported: true,
  customMaskBlend: true,
  run(image, params) {
    const hRadius = Math.trunc(num(params, "horizontal_radius", 6));
    const vRadius = Math.trunc(num(params, "vertical_radius", 6));
    const iterations = getInt(num(params, "iterations", 3));
    if (image.width <= 0 || image.height <= 0 || iterations <= 0) return;
    const area = marginArea(image, params);
    if (!area) return;
    const aw = rectWidth(area);
    const ah = rectHeight(area);
    let a = copyRect(image, area.x1, area.y1, aw, ah).data;
    let b = new Uint8ClampedArray(a);
    const hr = Math.min(Math.max(0, hRadius), Math.max(0, aw - 1));
    const vr = Math.min(Math.max(0, vRadius), Math.max(0, ah - 1));
    let blurred = false;
    for (let it = 0; it < iterations; it += 1) {
      if (hr > 0) {
        boxBlurH(a, b, aw, ah, hr);
        [a, b] = [b, a];
        blurred = true;
      }
      if (vr > 0) {
        boxBlurT(a, b, aw, ah, vr);
        [a, b] = [b, a];
        blurred = true;
      }
    }
    if (!blurred) return;
    const layer = { width: aw, height: ah, data: a, premultiplied: true };
    drawImageRect(image, layer, { x: area.x1, y: area.y1, width: aw, height: ah }, { x: 0, y: 0, width: aw, height: ah });
  }
};
function scaledToWidth(src, w) {
  const factor = w / src.width;
  if (factor === 1) return src;
  const wd = Math.trunc(Math.abs(factor) * src.width + 0.9999);
  const hd = Math.trunc(Math.abs(factor) * src.height + 0.9999);
  if (wd === 0 || hd === 0) return createPremul(0, 0);
  return smoothScale(src, wd, hd);
}
var pixelate = {
  type: "Pixelate",
  supported: true,
  customMaskBlend: true,
  run(image, params) {
    const value = Math.min(Math.pow(1e-3, Math.abs(num(params, "pixelization", 0.5))), 1);
    if (!(value > 0)) return;
    if (image.width <= 0 || image.height <= 0) return;
    const area = marginArea(image, params);
    if (!area) return;
    const aw = rectWidth(area);
    const ah = rectHeight(area);
    const scaleTo = Math.max(1, Math.trunc(aw * value));
    const small = scaledToWidth(copyRect(image, area.x1, area.y1, aw, ah), scaleTo);
    if (small.width === 0 || small.height === 0) return;
    drawImageRect(image, small, { x: area.x1, y: area.y1, width: aw, height: ah }, { x: 0, y: 0, width: small.width, height: small.height });
  }
};

// ../engine/src/render/kernels/text-layout.ts
var F64 = new Float64Array(1);
var U64 = new BigUint64Array(F64.buffer);
function decompose2(x) {
  F64[0] = x;
  const bits2 = U64[0];
  const biased = Number(bits2 >> 52n & 0x7ffn);
  let mant = bits2 & 0xfffffffffffffn;
  let exp = -1074;
  if (biased !== 0) {
    mant |= 1n << 52n;
    exp = biased - 1075;
  }
  return [bits2 >> 63n ? -mant : mant, exp];
}
function fusedMulAdd(a, b, c) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a === 0 || b === 0) return a * b + c;
  if (c === 0) return a * b;
  const [ma, ea] = decompose2(a);
  const [mb, eb] = decompose2(b);
  const [mc, ec] = decompose2(c);
  const ep = ea + eb;
  const e = Math.min(ep, ec);
  let sum = (ma * mb << BigInt(ep - e)) + (mc << BigInt(ec - e));
  if (sum === 0n) return 0;
  const neg = sum < 0n;
  if (neg) sum = -sum;
  let shift2 = sum.toString(2).length - 64;
  if (shift2 > 0) {
    const sticky = (sum & (1n << BigInt(shift2)) - 1n) !== 0n ? 1n : 0n;
    sum = sum >> BigInt(shift2) | sticky;
  } else shift2 = 0;
  const v = Number(sum) * 2 ** (e + shift2);
  return neg ? -v : v;
}
function isEmptyRect(r) {
  return !(r.width > 0) || !(r.height > 0);
}
function hexColor(c) {
  const r = getInt(c[0]);
  const g = getInt(c[1]);
  const b = getInt(c[2]);
  const a = getInt(c[3]);
  const ok = (v) => v >= 0 && v <= 255;
  return ok(r) && ok(g) && ok(b) && ok(a) ? [r, g, b] : [0, 0, 0];
}
function alpha16(alphaF) {
  if (Number.isNaN(alphaF)) return 0;
  const a = alphaF < 0 ? 0 : alphaF > 1 ? 1 : alphaF;
  return Math.floor(a * 65535 + 0.5);
}
function premul16(c, a) {
  if (a === 65535) return c;
  if (a === 0) return 0;
  const t = c * a;
  return Math.floor((t + Math.floor(t / 65536) + 32768) / 65536);
}
function to8(x) {
  const t = x + 128;
  return t - (t >> 8) >> 8;
}
function solidPremul(rgb, a16) {
  return [to8(premul16(rgb[0] * 257, a16)), to8(premul16(rgb[1] * 257, a16)), to8(premul16(rgb[2] * 257, a16)), to8(a16)];
}
function straightColor(rgb, a16) {
  return [rgb[0], rgb[1], rgb[2], to8(a16)];
}
function imageRegion(width, height) {
  return { x0: 0, y0: 0, x1: width, y1: height };
}
function regionBox(region) {
  return { left: region.x0, top: region.y0, right: region.x1 - 1, bottom: region.y1 - 1 };
}
function clipRectRegion(x, y, w, h, width, height) {
  if (w > 0 && h > 0) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(width, Math.ceil(x + w));
    const y1 = Math.min(height, Math.ceil(y + h));
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
  }
  if (w === 0 || h === 0 || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const mask2 = grayRasterize([[x, y, x + w, y, x + w, y + h, x, y + h]], true, width, height);
  if (!mask2) return null;
  return { x0: mask2.x, y0: mask2.y, x1: mask2.x + mask2.width, y1: mask2.y + mask2.height, mask: mask2 };
}
function clipCoverage(region, x, y, coverage) {
  const m = region.mask;
  if (!m) return coverage;
  const c = m.data[(y - m.y) * m.width + (x - m.x)];
  const t = coverage * c;
  return t + (t >> 8) + 128 >> 8;
}
function blendSolidPixel(d, i, color2, cov) {
  if (cov === 255 && color2[3] === 255) {
    d[i] = color2[0];
    d[i + 1] = color2[1];
    d[i + 2] = color2[2];
    d[i + 3] = 255;
    return;
  }
  let r = color2[0];
  let g = color2[1];
  let b = color2[2];
  let a = color2[3];
  if (cov !== 255) {
    r = byteMul(r, cov);
    g = byteMul(g, cov);
    b = byteMul(b, cov);
    a = byteMul(a, cov);
  }
  const ia = 255 - a;
  d[i] = r + byteMul(d[i], ia);
  d[i + 1] = g + byteMul(d[i + 1], ia);
  d[i + 2] = b + byteMul(d[i + 2], ia);
  d[i + 3] = a + byteMul(d[i + 3], ia);
}
var KAPPA2 = 0.5522847498;
function flattenBezier2(out, x1, y1, x2, y2, x3, y3, x4, y4, threshold = 0.25) {
  const bz = new Float64Array(80);
  const lvl = new Int32Array(10);
  bz.set([x1, y1, x2, y2, x3, y3, x4, y4], 0);
  lvl[0] = 9;
  let b = 0;
  while (b >= 0) {
    const o = b * 8;
    const bx1 = bz[o];
    const by1 = bz[o + 1];
    const bx2 = bz[o + 2];
    const by2 = bz[o + 3];
    const bx3 = bz[o + 4];
    const by3 = bz[o + 5];
    const bx4 = bz[o + 6];
    const by4 = bz[o + 7];
    const y4y1 = by4 - by1;
    const x4x1 = bx4 - bx1;
    let l = Math.abs(x4x1) + Math.abs(y4y1);
    let d;
    if (l > 1) {
      d = Math.abs(x4x1 * (by1 - by2) - y4y1 * (bx1 - bx2)) + Math.abs(x4x1 * (by1 - by3) - y4y1 * (bx1 - bx3));
    } else {
      d = Math.abs(bx1 - bx2) + Math.abs(by1 - by2) + Math.abs(bx1 - bx3) + Math.abs(by1 - by3);
      l = 1;
    }
    if (d < threshold * l || lvl[b] === 0) {
      out.push(bx4, by4);
      b -= 1;
    } else {
      const f = o + 8;
      let c = (bx2 + bx3) * 0.5;
      const fx2 = (bx1 + bx2) * 0.5;
      const sx3 = (bx3 + bx4) * 0.5;
      const fx3 = (fx2 + c) * 0.5;
      const sx2 = (sx3 + c) * 0.5;
      const mx = (fx3 + sx2) * 0.5;
      c = (by2 + by3) / 2;
      const fy2 = (by1 + by2) * 0.5;
      const sy3 = (by3 + by4) * 0.5;
      const fy3 = (fy2 + c) * 0.5;
      const sy2 = (sy3 + c) * 0.5;
      const my = (fy3 + sy2) * 0.5;
      bz.set([bx1, by1, fx2, fy2, fx3, fy3, mx, my], f);
      bz.set([mx, my, sx2, sy2, sx3, sy3, bx4, by4], o);
      lvl[b] = lvl[b] - 1;
      lvl[b + 1] = lvl[b];
      b += 1;
    }
  }
}
function roundedRectPolygon(x, y, w, h, radius) {
  const x1 = x;
  const x2 = x + w;
  const y1 = y;
  const y2 = y + h;
  const xr = Math.min(radius, w / 2);
  const yr = Math.min(radius, h / 2);
  const k = 1 - KAPPA2;
  const pts = [x1 + xr, y1, x2 - xr, y1];
  flattenBezier2(pts, x2 - xr, y1, x2 - k * xr, y1, x2, y1 + k * yr, x2, y1 + yr);
  pts.push(x2, y2 - yr);
  flattenBezier2(pts, x2, y2 - yr, x2, y2 - k * yr, x2 - k * xr, y2, x2 - xr, y2);
  pts.push(x1 + xr, y2);
  flattenBezier2(pts, x1 + xr, y2, x1 + k * xr, y2, x1, y2 - k * yr, x1, y2 - yr);
  pts.push(x1, y1 + yr);
  flattenBezier2(pts, x1, y1 + yr, x1, y1 + k * yr, x1 + k * xr, y1, x1 + xr, y1);
  return pts;
}
function fillRoundedRect(image, rect, radius, color2, region) {
  if (color2[3] === 0 && color2[0] === 0 && color2[1] === 0 && color2[2] === 0) return;
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  const box = regionBox(region);
  if (box.right < box.left || box.bottom < box.top) return;
  const d = image.data;
  const W = image.width;
  const put = (x, y, len, coverage) => {
    const from = Math.max(x, region.x0);
    const to = Math.min(x + len, region.x1);
    if (y < region.y0 || y >= region.y1) return;
    for (let px = from; px < to; px += 1) {
      const cov = clipCoverage(region, px, y, coverage);
      if (cov > 0) blendSolidPixel(d, (y * W + px) * 4, color2, cov);
    }
  };
  if (!(radius > 0)) {
    const ay = (rect.y + (rect.y + rect.height)) * 0.5;
    const right = rect.x + rect.width;
    rasterizeLine(rect.x, ay, right, ay, rect.height / rect.width, true, box, put);
    return;
  }
  const mask2 = grayRasterize([roundedRectPolygon(rect.x, rect.y, rect.width, rect.height, radius)], true, image.width, image.height);
  if (!mask2) return;
  for (let row = 0; row < mask2.height; row += 1) {
    const y = mask2.y + row;
    for (let col = 0; col < mask2.width; col += 1) {
      const c = mask2.data[row * mask2.width + col];
      if (c > 0) put(mask2.x + col, y, 1, c);
    }
  }
}
function drawTextPath(image, raster, text2, x, y, font, ink, fill, stroke, strokeWidth, region) {
  if (text2.length === 0 || isEmptyRect(ink)) return;
  const margin = Math.ceil(Math.max(0, strokeWidth)) + 2 + Math.ceil(font.pixelSize * 0.25);
  const x0 = Math.max(region.x0, Math.floor(x + ink.x) - margin);
  const y0 = Math.max(region.y0, Math.floor(y + ink.y) - margin);
  const x1 = Math.min(region.x1, Math.ceil(x + ink.x + ink.width) + margin);
  const y1 = Math.min(region.y1, Math.ceil(y + ink.y + ink.height) + margin);
  if (!(x1 > x0) || !(y1 > y0)) return;
  const lw = x1 - x0;
  const lh = y1 - y0;
  const layer = { width: lw, height: lh, data: new Uint8ClampedArray(lw * lh * 4) };
  raster.drawText(layer, text2, x - x0, y - y0, font, fill, stroke, stroke ? strokeWidth : 0);
  const src = premultiply(layer);
  const compose = composerFor(CompositionMode.SourceOver);
  const d = image.data;
  for (let row = 0; row < lh; row += 1) {
    const di = ((y0 + row) * image.width + x0) * 4;
    const si = row * lw * 4;
    if (!region.mask) {
      compose(d, di, src.data, si, lw, 255);
      continue;
    }
    for (let col = 0; col < lw; col += 1) {
      const cov = clipCoverage(region, x0 + col, y0 + row, 255);
      if (cov > 0) compose(d, di + col * 4, src.data, si + col * 4, 1, cov);
    }
  }
}
var ASCII_WIDTHS = [
  278,
  278,
  355,
  556,
  556,
  889,
  667,
  191,
  333,
  333,
  389,
  584,
  278,
  333,
  278,
  278,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  278,
  278,
  584,
  584,
  584,
  556,
  1015,
  667,
  667,
  722,
  722,
  667,
  611,
  778,
  722,
  278,
  500,
  667,
  556,
  833,
  722,
  778,
  667,
  778,
  722,
  667,
  611,
  722,
  667,
  944,
  667,
  667,
  611,
  278,
  278,
  278,
  469,
  556,
  333,
  556,
  556,
  500,
  556,
  556,
  278,
  556,
  556,
  222,
  222,
  500,
  222,
  833,
  556,
  556,
  556,
  556,
  333,
  500,
  278,
  556,
  500,
  722,
  500,
  500,
  500,
  334,
  260,
  334,
  584
];
function isWide(cp) {
  return cp >= 4352 && cp <= 4447 || cp >= 11904 && cp <= 42191 || cp >= 44032 && cp <= 55203 || cp >= 63744 && cp <= 64255 || cp >= 65072 && cp <= 65103 || cp >= 65280 && cp <= 65376 || cp >= 65504 && cp <= 65510 || cp >= 127744;
}
function charWidthEm(cp) {
  if (cp >= 32 && cp <= 126) return ASCII_WIDTHS[cp - 32] / 1e3;
  if (cp < 32 || cp >= 768 && cp <= 879 || cp === 8203 || cp === 65279) return 0;
  return isWide(cp) ? 1 : 0.556;
}
var INVISIBLE = /^[\s\u200b\ufeff]*$/u;
var TALL = /[^acegmnopqrsuvwxyz\s.,:;\-_~=+*'"`^]/u;
var DESCENDER = /[gjpqyQ,;()[\]{}|@$]/u;
function approximateAdvance(text2, font) {
  let w = 0;
  for (const ch of text2) w += charWidthEm(ch.codePointAt(0));
  return w * font.pixelSize;
}
var approximateMetrics = {
  fontMetrics(font) {
    const px = font.pixelSize;
    return { ascent: px * 0.93, descent: px * 0.23, lineSpacing: px * 1.16 };
  },
  advance: approximateAdvance,
  bounds(text2, font) {
    const px = font.pixelSize;
    return { x: 0, y: -px * 0.93, width: approximateAdvance(text2, font), height: px * 1.16 };
  },
  inkBounds(text2, font) {
    if (INVISIBLE.test(text2)) return { x: 0, y: 0, width: 0, height: 0 };
    const px = font.pixelSize;
    const top = TALL.test(text2) ? 0.716 : 0.519;
    const bottom = DESCENDER.test(text2) ? 0.21 : 0.012;
    const adv = approximateAdvance(text2, font);
    return { x: px * 0.05, y: -top * px, width: Math.max(0, adv - px * 0.1), height: (top + bottom) * px };
  }
};

// ../engine/src/render/kernels/caption.ts
var CAPTION_DEFAULT_TEXT = "00:00:00:000 --> 00:10:00:000\nEdit this caption with our caption editor";
var CUE_PATTERN = /(\d{2})?:*(\d{2}):(\d{2})[^\n](\d{2,3})[\t\n\v\f\r ]*-->[\t\n\v\f\r ]*(\d{2})?:*(\d{2}):(\d{2})[^\n](\d{2,3})([\s\S]*?)([^\n]*?)(?=\d{2}:\d{2,3}|\n?$)/gu;
function groupValue(g) {
  return g ? Number(g) : 0;
}
function fraction(g) {
  return Number((g ?? "").padEnd(3, "0")) / 1e3;
}
var cueCache = /* @__PURE__ */ new Map();
var CUE_CACHE_LIMIT = 32;
function parseCaptions(text2) {
  const cached2 = cueCache.get(text2);
  if (cached2) return cached2;
  const nul = text2.indexOf("\0");
  let prepared = nul >= 0 ? text2.slice(0, nul) : text2;
  if (!prepared.endsWith("\n\n")) prepared += "\n\n";
  const cues = [];
  for (const m of prepared.matchAll(CUE_PATTERN)) {
    const start = groupValue(m[1]) * 3600 + groupValue(m[2]) * 60 + groupValue(m[3]) + fraction(m[4]);
    const end = groupValue(m[5]) * 3600 + groupValue(m[6]) * 60 + groupValue(m[7]) + fraction(m[8]);
    const lines = (m[9] ?? "").split("\n").filter((line2) => !line2.startsWith("NOTE") && line2.length > 1);
    cues.push({ start, end, lines });
  }
  if (cueCache.size >= CUE_CACHE_LIMIT) cueCache.delete(cueCache.keys().next().value);
  cueCache.set(text2, cues);
  return cues;
}
function cueFrameRange(cue, fps) {
  const fpsF = Math.fround(fps.num / fps.den);
  return { first: Math.trunc(cue.start * fpsF) + 1, last: Math.trunc(cue.end * fpsF) };
}
function singleLineWidth(measure, font, text2) {
  const t = text2.replace(/[\r\n\t]/g, " ");
  if (t.length === 0) return 0;
  const advance = measure.advance(t, font);
  const ink = measure.inkBounds(t, font);
  return isEmptyRect(ink) ? advance : Math.max(advance, ink.x + ink.width);
}
function pathBounds(ink, text2, x, y) {
  if (text2.length === 0 || isEmptyRect(ink)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x + ink.x, y: y + ink.y, width: ink.width, height: ink.height };
}
function captionFps(ctx) {
  if (ctx.fps && ctx.fps.num > 0 && ctx.fps.den > 0) return ctx.fps;
  if (ctx.clip && ctx.clip.readerFps > 0) return { num: ctx.clip.readerFps, den: 1 };
  return { num: 1, den: 1 };
}
function layoutCaption(params, width, height, frame, fps, measure) {
  const cues = parseCaptions(str(params, "caption_text", CAPTION_DEFAULT_TEXT));
  const scale = width / 600;
  const fontSizeValue = num(params, "font_size", 30) * scale;
  const font = { family: str(params, "caption_font", "sans"), pixelSize: Math.trunc(Math.max(fontSizeValue, 1)) };
  const fpsD = fps.num / fps.den;
  const leftValue = num(params, "left", 0.1);
  const topValue = num(params, "top", 0.75);
  const fadeInValue = num(params, "fade_in", 0) * fpsD;
  const fadeOutValue = num(params, "fade_out", 0) * fpsD;
  const rightValue = num(params, "right", 0.1);
  const bottomValue = num(params, "bottom", 0);
  const cornerValue = num(params, "background_corner", 10) * scale;
  const paddingValue = num(params, "background_padding", 20) * scale;
  const strokeWidthValue = num(params, "stroke_width", 0.5) * scale;
  const lineSpacingValue = num(params, "line_spacing", 1);
  const metricsLineSpacing = measure.fontMetrics(font).lineSpacing;
  const leftMarginX = width * leftValue;
  const topMarginY = height * topValue;
  const startingY = topMarginY + metricsLineSpacing;
  let currentY = startingY;
  let bottomY = startingY;
  let topY = startingY;
  let maxTextWidth = 0;
  const rightMarginX = fusedMulAdd(-width, rightValue, width);
  const captionAreaWidth = rightMarginX - leftMarginX;
  const bottomMarginY = fusedMulAdd(-height, bottomValue, height);
  const clip = { x: leftMarginX, y: topMarginY, width: captionAreaWidth, height: Math.max(bottomMarginY - topMarginY, 0) };
  const lines = [];
  let fadeIn = 0;
  let fadeOut = 0;
  const lineHeight = metricsLineSpacing * lineSpacingValue;
  const widths = /* @__PURE__ */ new Map();
  const measureWidth = (s) => {
    let w = widths.get(s);
    if (w === void 0) {
      w = singleLineWidth(measure, font, s);
      widths.set(s, w);
    }
    return w;
  };
  const f3219 = Math.fround;
  for (const cue of cues) {
    const { first, last } = cueFrameRange(cue, fps);
    if (frame < first || frame > last) continue;
    for (const line2 of cue.lines) {
      fadeIn = fadeInValue > 0 ? f3219(f3219(frame) - f3219(first)) / fadeInValue : 1;
      fadeOut = fadeOutValue > 0 ? 1 - (f3219(frame) - (f3219(last) - fadeOutValue)) / fadeOutValue : -1;
      let words2 = line2.split(" ");
      let useSpaces = true;
      if (line2.length > 20 && words2.length === 1) {
        words2 = ["", ...line2.split(""), ""];
        useSpaces = false;
      }
      while (words2.length > 0) {
        let displayed = false;
        for (let wordIndex = words2.length; wordIndex > 0; wordIndex -= 1) {
          const part = words2.slice(0, wordIndex);
          if (measureWidth(part.join(" ")) <= captionAreaWidth) {
            const text2 = useSpaces ? part.join(" ") : part.join("");
            const x = Math.trunc(leftMarginX);
            const y = Math.trunc(currentY);
            const ink = text2.length > 0 ? measure.inkBounds(text2, font) : { x: 0, y: 0, width: 0, height: 0 };
            const bounds2 = pathBounds(ink, text2, x, y);
            lines.push({ text: text2, x, y, ink, bounds: bounds2 });
            words2 = words2.slice(wordIndex);
            displayed = true;
            currentY += lineHeight;
            if (bounds2.width > maxTextWidth) maxTextWidth = bounds2.width;
            if (bounds2.y < topY) topY = bounds2.y;
            if (bounds2.y + bounds2.height > bottomY) bottomY = bounds2.y + bounds2.height;
            break;
          }
        }
        if (!displayed) break;
      }
    }
  }
  const alignmentOffset = Math.max((captionAreaWidth - maxTextWidth) / 2, 0);
  const background = {
    x: leftMarginX - paddingValue / 2 + alignmentOffset,
    y: topY - paddingValue / 2,
    width: maxTextWidth + paddingValue,
    height: bottomY - topY + paddingValue
  };
  for (const line2 of lines) line2.x += alignmentOffset;
  const backgroundAlphaValue = num(params, "background_alpha", 0);
  const fontAlphaValue = num(params, "font_alpha", 1);
  const fade = fadeIn < 1 ? fadeIn : fadeOut >= 0 && fadeOut <= 1 ? fadeOut : null;
  return {
    font,
    clip,
    lines,
    background,
    cornerRadius: cornerValue,
    backgroundColor: hexColor(color(params, "background", [0, 0, 0, 255])),
    backgroundAlpha: fade === null ? backgroundAlphaValue : fade * backgroundAlphaValue,
    textColor: hexColor(color(params, "color", [255, 255, 255, 255])),
    strokeColor: hexColor(color(params, "stroke", [169, 169, 169, 255])),
    textAlpha: fade === null ? fontAlphaValue : fade * fontAlphaValue,
    strokeWidth: strokeWidthValue,
    fadeIn,
    fadeOut
  };
}
function paintCaption(image, layout, ctx) {
  const region = clipRectRegion(layout.clip.x, layout.clip.y, layout.clip.width, layout.clip.height, image.width, image.height);
  if (!region) return;
  const bgAlpha = alpha16(layout.backgroundAlpha);
  if (bgAlpha > 0) fillRoundedRect(image, layout.background, layout.cornerRadius, solidPremul(layout.backgroundColor, bgAlpha), region);
  const raster = ctx.text;
  const textAlpha = alpha16(layout.textAlpha);
  if (!raster || textAlpha === 0) return;
  const fill = straightColor(layout.textColor, textAlpha);
  const stroke = layout.strokeWidth > 0 ? straightColor(layout.strokeColor, textAlpha) : null;
  for (const line2 of layout.lines) {
    drawTextPath(image, raster, line2.text, line2.x, line2.y, layout.font, line2.ink, fill, stroke, layout.strokeWidth, region);
  }
}
var caption = {
  type: "Caption",
  supported: true,
  run(image, params, ctx) {
    if (image.width <= 0 || image.height <= 0) return;
    const layout = layoutCaption(params, image.width, image.height, ctx.frame, captionFps(ctx), ctx.text ?? approximateMetrics);
    paintCaption(image, layout, ctx);
  }
};

// ../engine/src/render/kernels/chroma-key.ts
var f325 = Math.fround;
var INV_ALPHA = (() => {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i += 1) t[i] = f325(255 / i);
  return t;
})();
function sqrtf(i) {
  return f325(Math.sqrt(i));
}
var CHROMAKEY_BASIC = 0;
var CHROMAKEY_BASIC_SOFT = 11;
var chromaKey = {
  type: "ChromaKey",
  supported: true,
  run(image, params) {
    const threshold = getInt(num(params, "fuzz", 20));
    const halo = getInt(num(params, "halo", 10));
    const key = color(params, "color", [0, 0, 0, 0]);
    const kR = getInt(key[0]);
    const kG = getInt(key[1]);
    const kB = getInt(key[2]);
    const method = int(params, "keymethod", CHROMAKEY_BASIC_SOFT);
    const d = image.data;
    if (method === CHROMAKEY_BASIC) {
      for (let i = 0; i < d.length; i += 4) {
        const A = d[i + 3];
        if (A <= 0) continue;
        let R;
        let G;
        let B;
        if (A === 255) {
          R = d[i];
          G = d[i + 1];
          B = d[i + 2];
        } else {
          const inv = INV_ALPHA[A];
          R = Math.trunc(f325(d[i] * inv)) & 255;
          G = Math.trunc(f325(d[i + 1] * inv)) & 255;
          B = Math.trunc(f325(d[i + 2] * inv)) & 255;
        }
        const rmean = R + kR >> 1;
        const r = R - kR;
        const g = G - kG;
        const b = B - kB;
        const distSq = ((512 + rmean) * r * r >> 8) + 4 * g * g + ((767 - rmean) * b * b >> 8);
        if (Math.trunc(sqrtf(distSq)) <= threshold) {
          d[i] = 0;
          d[i + 1] = 0;
          d[i + 2] = 0;
          d[i + 3] = 0;
        }
      }
      return;
    }
    const haloUpper = threshold + halo;
    const haloUpperSq = haloUpper * haloUpper;
    const invHalo = halo > 0 ? f325(1 / halo) : 0;
    for (let i = 0; i < d.length; i += 4) {
      const A = d[i + 3];
      if (A <= 0) continue;
      let R;
      let G;
      let B;
      if (A === 255) {
        R = d[i];
        G = d[i + 1];
        B = d[i + 2];
      } else {
        const inv = INV_ALPHA[A];
        R = Math.min(255, Math.max(0, Math.trunc(f325(d[i] * inv))));
        G = Math.min(255, Math.max(0, Math.trunc(f325(d[i + 1] * inv))));
        B = Math.min(255, Math.max(0, Math.trunc(f325(d[i + 2] * inv))));
      }
      const rmean = R + kR >> 1;
      const r = R - kR;
      const g = G - kG;
      const b = B - kB;
      const distSq = ((512 + rmean) * r * r >> 8) + 4 * g * g + ((767 - rmean) * b * b >> 8);
      const distance = Math.trunc(sqrtf(distSq));
      if (distance <= threshold) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
      } else if (halo > 0 && distSq <= haloUpperSq) {
        const alphamult = f325(f325(sqrtf(distSq) - threshold) * invHalo);
        d[i] = Math.trunc(f325(d[i] * alphamult));
        d[i + 1] = Math.trunc(f325(d[i + 1] * alphamult));
        d[i + 2] = Math.trunc(f325(d[i + 2] * alphamult));
        d[i + 3] = Math.trunc(f325(d[i + 3] * alphamult));
      }
    }
  }
};

// ../engine/src/render/kernels/color-basic.ts
var f326 = Math.fround;
var INV_255 = f326(1 / 255);
var INV_ALPHA2 = (() => {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i += 1) t[i] = f326(255 / i);
  return t;
})();
function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
var brightness = {
  type: "Brightness",
  supported: true,
  customMaskBlend: true,
  run(image, params) {
    const b = f326(num(params, "brightness", 0));
    const c = f326(num(params, "contrast", 3));
    const cf = f326(f326(f326(c + 255) * 259) / f326(f326(259 - c) * 255));
    const offset = Math.trunc(f326(255 * b));
    const adjust = (v) => clampByte(clampByte(Math.trunc(f326(cf * (v - 128) + 128))) + offset);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a <= 0) continue;
      if (a === 255) {
        d[i] = adjust(d[i]);
        d[i + 1] = adjust(d[i + 1]);
        d[i + 2] = adjust(d[i + 2]);
      } else {
        const ap = f326(a * INV_255);
        const inv = INV_ALPHA2[a];
        const r = adjust(Math.trunc(f326(d[i] * inv)));
        const g = adjust(Math.trunc(f326(d[i + 1] * inv)));
        const bl = adjust(Math.trunc(f326(d[i + 2] * inv)));
        d[i] = Math.trunc(f326(r * ap));
        d[i + 1] = Math.trunc(f326(g * ap));
        d[i + 2] = Math.trunc(f326(bl * ap));
      }
    }
  }
};
var SQRT_LUT = (() => {
  const t = new Float32Array(65026);
  for (let i = 0; i <= 65025; i += 1) t[i] = f326(Math.sqrt(i));
  return t;
})();
var SQRT_PR = f326(Math.sqrt(f326(0.299)));
var SQRT_PG = f326(Math.sqrt(f326(0.587)));
var SQRT_PB = f326(Math.sqrt(f326(0.114)));
var saturation = {
  type: "Saturation",
  supported: true,
  customMaskBlend: true,
  run(image, params) {
    const s = f326(num(params, "saturation", 1));
    const sR = f326(num(params, "saturation_R", 1));
    const sG = f326(num(params, "saturation_G", 1));
    const sB = f326(num(params, "saturation_B", 1));
    const out = [0, 0, 0];
    const apply = (R, G, B) => {
      const weighted = 77 * R * R + 150 * G * G + 29 * B * B + 128 >> 8;
      const p = SQRT_LUT[Math.min(65025, weighted)];
      R = clampByte(Math.trunc(f326(f326(R - p) * s + p)));
      G = clampByte(Math.trunc(f326(f326(G - p) * s + p)));
      B = clampByte(Math.trunc(f326(f326(B - p) * s + p)));
      const pr = f326(R * SQRT_PR);
      const pg = f326(G * SQRT_PG);
      const pb = f326(B * SQRT_PB);
      const Rr = Math.trunc(f326(f326(R - pr) * sR + pr));
      const Gr = Math.trunc(f326(pr - pr * sR));
      const Rg = Math.trunc(f326(pg - pg * sG));
      const Gg = Math.trunc(f326(f326(G - pg) * sG + pg));
      const Rb = Math.trunc(f326(pb - pb * sB));
      const Bb = Math.trunc(f326(f326(B - pb) * sB + pb));
      out[0] = clampByte(Rr + Rg + Rb);
      out[1] = clampByte(Gr + Gg + Rb);
      out[2] = clampByte(Gr + Rg + Bb);
    };
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a <= 0) continue;
      if (a === 255) {
        apply(d[i], d[i + 1], d[i + 2]);
        d[i] = out[0];
        d[i + 1] = out[1];
        d[i + 2] = out[2];
      } else {
        const ap = f326(a * INV_255);
        const inv = INV_ALPHA2[a];
        apply(Math.trunc(f326(d[i] * inv)), Math.trunc(f326(d[i + 1] * inv)), Math.trunc(f326(d[i + 2] * inv)));
        d[i] = Math.trunc(f326(out[0] * ap));
        d[i + 1] = Math.trunc(f326(out[1] * ap));
        d[i + 2] = Math.trunc(f326(out[2] * ap));
      }
    }
  }
};
function constrain(v) {
  const t = Number.isNaN(v) ? 0 : v >= 2147483647 ? 2147483647 : v <= -2147483648 ? -2147483648 : Math.trunc(v);
  return t < 0 ? 0 : t > 255 ? 255 : t;
}
function toInt(v) {
  if (Number.isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v <= -2147483648) return -2147483648;
  return Math.trunc(v);
}
var hue = {
  type: "Hue",
  supported: true,
  customMaskBlend: true,
  run(image, params) {
    const degrees = 360 * num(params, "hue", 0);
    const pi = f326(3.14159265);
    const cosA = f326(Math.cos(degrees * pi / 180));
    const sinA = f326(Math.sin(degrees * pi / 180));
    const third = f326(1 / 3);
    const sqrtThird = f326(Math.sqrt(third));
    const oneMinus = f326(1 - cosA);
    const m0 = f326(cosA + f326(oneMinus / 3));
    const sinTerm = f326(sqrtThird * sinA);
    const m1 = f326(third * oneMinus - sinTerm);
    const m2 = f326(third * oneMinus + sinTerm);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      const ap = f326(a / 255);
      const R = toInt(f326(d[i] / ap));
      const G = toInt(f326(d[i + 1] / ap));
      const B = toInt(f326(d[i + 2] / ap));
      const r = constrain(f326(B * m2 + f326(R * m0 + f326(G * m1))));
      const g = constrain(f326(B * m1 + f326(R * m2 + f326(G * m0))));
      const b = constrain(f326(B * m0 + f326(R * m1 + f326(G * m2))));
      d[i] = Math.trunc(f326(ap * r));
      d[i + 1] = Math.trunc(f326(ap * g));
      d[i + 2] = Math.trunc(f326(ap * b));
    }
  }
};
var negate = {
  type: "Negate",
  supported: true,
  run(image) {
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 255) {
        d[i] = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
      } else if (a === 0) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
      } else {
        d[i] = byteMul(255 - unpremulChannel(d[i], a), a);
        d[i + 1] = byteMul(255 - unpremulChannel(d[i + 1], a), a);
        d[i + 2] = byteMul(255 - unpremulChannel(d[i + 2], a), a);
      }
    }
  }
};

// ../engine/src/render/kernels/cube-lut.ts
function isQtSpace(code) {
  if (code === 32 || code >= 9 && code <= 13) return true;
  if (code < 133) return false;
  return code === 133 || code === 160 || code === 5760 || code >= 8192 && code <= 8202 || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288;
}
function qtTrimmed(line2) {
  let start = 0;
  let end = line2.length;
  while (start < end && isQtSpace(line2.charCodeAt(start))) start += 1;
  while (end > start && isQtSpace(line2.charCodeAt(end - 1))) end -= 1;
  return line2.slice(start, end);
}
var WHITESPACE_RUN = /[\t\n\v\f\r ]+/;
function splitTokens(line2) {
  return line2.split(WHITESPACE_RUN);
}
function toCLocale(token) {
  let out = "";
  for (const ch of qtTrimmed(token)) {
    if (ch === "\u2212") out += "-";
    else if (ch === ",") return null;
    else if (ch >= "A" && ch <= "Z") out += ch.toLowerCase();
    else out += ch;
  }
  return out;
}
var DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;
var FLOAT_MAX = 34028234663852886e22;
function qtToFloat(token) {
  const s = toCLocale(token);
  if (s === null) return 0;
  let d;
  if (s === "nan") d = NaN;
  else if (s === "inf" || s === "+inf") d = Infinity;
  else if (s === "-inf") d = -Infinity;
  else if (DECIMAL.test(s)) d = Number(s);
  else return 0;
  if (!Number.isFinite(d)) return d;
  if (Math.abs(d) > FLOAT_MAX) return d < 0 ? -Infinity : Infinity;
  return Math.fround(d);
}
function qtToInt(token) {
  const s = toCLocale(token);
  if (s === null || !/^[+-]?\d+$/.test(s)) return 0;
  const v = Number(s);
  return v >= -2147483648 && v <= 2147483647 ? v : 0;
}
function readLines(text2) {
  let body = text2.charCodeAt(0) === 65279 ? text2.slice(1) : text2;
  body = body.replace(/\r/g, "");
  const lines = body.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map(qtTrimmed);
}
var MAX_VALUES = 2147483647;
function parseCubeLut(text2) {
  const lines = readLines(text2);
  const domainMin = [0, 0, 0];
  const domainMax = [1, 1, 1];
  const parseDomainLine = (line2) => {
    const isMin = line2.startsWith("DOMAIN_MIN");
    if (!isMin && !line2.startsWith("DOMAIN_MAX")) return;
    const parts = splitTokens(line2);
    if (parts.length < 4) return;
    const target = isMin ? domainMin : domainMax;
    target[0] = qtToFloat(parts[1]);
    target[1] = qtToFloat(parts[2]);
    target[2] = qtToFloat(parts[3]);
  };
  const tryParse = (keyword, want3d) => {
    let i = 0;
    let detected = 0;
    while (i < lines.length) {
      const line2 = lines[i++];
      parseDomainLine(line2);
      if (line2.startsWith(keyword)) {
        const parts = splitTokens(line2);
        if (parts.length >= 2) detected = qtToInt(parts[1]);
        break;
      }
    }
    if (detected <= 0) return null;
    const entries = want3d ? detected * detected * detected : detected;
    const need = entries * 3;
    if (need > MAX_VALUES) return null;
    if (need > (lines.length - i) * 3) return null;
    const data = new Float32Array(need);
    let count = 0;
    while (i < lines.length && count < need) {
      const line2 = lines[i++];
      if (line2 === "" || line2.startsWith("#") || line2.startsWith("TITLE")) continue;
      if (line2.startsWith("DOMAIN_MIN") || line2.startsWith("DOMAIN_MAX")) {
        parseDomainLine(line2);
        continue;
      }
      const vals = splitTokens(line2);
      if (vals.length >= 3) {
        data[count] = qtToFloat(vals[0]);
        data[count + 1] = qtToFloat(vals[1]);
        data[count + 2] = qtToFloat(vals[2]);
        count += 3;
      }
    }
    if (count !== need) return null;
    return { size: detected, data };
  };
  const lut3d = tryParse("LUT_3D_SIZE", true);
  const found = lut3d ?? tryParse("LUT_1D_SIZE", false);
  if (!found) return null;
  return { kind: lut3d ? "3d" : "1d", size: found.size, data: found.data, domainMin, domainMax };
}
var CACHE = /* @__PURE__ */ new Map();
var CACHE_LIMIT = 8;
function cachedCubeLut(text2) {
  if (CACHE.has(text2)) {
    const hit = CACHE.get(text2);
    CACHE.delete(text2);
    CACHE.set(text2, hit);
    return hit;
  }
  const lut = parseCubeLut(text2);
  CACHE.set(text2, lut);
  if (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value);
  return lut;
}

// ../engine/src/render/kernels/color-map.ts
var f327 = Math.fround;
var INV_2552 = f327(1 / 255);
function fmaf2(a, b, c) {
  return f327(a * b + c);
}
function floorIndex(v) {
  return v === v ? Math.floor(v) : 0;
}
function constrainByte(v) {
  if (!(v > 0)) return 0;
  if (v >= 255) return 255;
  return Math.trunc(v);
}
function normalizeToDomain(value, min, range) {
  const v = range <= 0 ? value : f327(f327(value - min) / range);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function trilinear(t, i000, i100, i010, i110, i001, i101, i011, i111, dr, odr, dg, odg, db, odb) {
  const c00 = fmaf2(t[i000], odr, f327(t[i100] * dr));
  const c01 = fmaf2(t[i001], odr, f327(t[i101] * dr));
  const c10 = fmaf2(t[i010], odr, f327(t[i110] * dr));
  const c11 = fmaf2(t[i011], odr, f327(t[i111] * dr));
  const c0 = fmaf2(c00, odg, f327(c10 * dg));
  const c1 = fmaf2(c01, odg, f327(c11 * dg));
  return fmaf2(c0, odb, f327(c1 * db));
}
function sample1d(t, size, value, channel) {
  const count = t.length;
  if (size <= 1) return t[Math.min(channel, count - 1)];
  const scaled = f327(value * (size - 1));
  const i0 = floorIndex(scaled);
  const i1 = Math.min(i0 + 1, size - 1);
  const frac = f327(scaled - i0);
  const v0 = t[Math.max(0, Math.min(i0 * 3 + channel, count - 1))];
  const v1 = t[Math.max(0, Math.min(i1 * 3 + channel, count - 1))];
  return fmaf2(v0, f327(1 - frac), f327(v1 * frac));
}
function applyCubeLut(image, lut, intensity, intensityR, intensityG, intensityB) {
  const overall = f327(intensity);
  const tR = f327(f327(intensityR) * overall);
  const tG = f327(f327(intensityG) * overall);
  const tB = f327(f327(intensityB) * overall);
  const keepR = f327(1 - tR);
  const keepG = f327(1 - tG);
  const keepB = f327(1 - tB);
  const [minR, minG, minB] = lut.domainMin;
  const rangeR = f327(lut.domainMax[0] - minR);
  const rangeG = f327(lut.domainMax[1] - minG);
  const rangeB = f327(lut.domainMax[2] - minB);
  const t = lut.data;
  const n = lut.size;
  const last = n - 1;
  const is3d = lut.kind === "3d";
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const alpha = f327(d[i + 3] / 255);
    if (alpha === 0) continue;
    const rn = f327(f327(d[i] / alpha) * INV_2552);
    const gn = f327(f327(d[i + 1] / alpha) * INV_2552);
    const bn = f327(f327(d[i + 2] / alpha) * INV_2552);
    const rd = normalizeToDomain(rn, minR, rangeR);
    const gd = normalizeToDomain(gn, minG, rangeG);
    const bd = normalizeToDomain(bn, minB, rangeB);
    let lr;
    let lg;
    let lb;
    if (is3d) {
      const rf = f327(rd * last);
      const gf = f327(gd * last);
      const bf = f327(bd * last);
      const r0 = floorIndex(rf);
      const g0 = floorIndex(gf);
      const b0 = floorIndex(bf);
      const r1 = Math.min(r0 + 1, last);
      const g1 = Math.min(g0 + 1, last);
      const b1 = Math.min(b0 + 1, last);
      const dr = f327(rf - r0);
      const dg = f327(gf - g0);
      const db = f327(bf - b0);
      const odr = f327(1 - dr);
      const odg = f327(1 - dg);
      const odb = f327(1 - db);
      const b0g0 = (b0 * n + g0) * n;
      const b0g1 = (b0 * n + g1) * n;
      const b1g0 = (b1 * n + g0) * n;
      const b1g1 = (b1 * n + g1) * n;
      const i000 = (b0g0 + r0) * 3;
      const i100 = (b0g0 + r1) * 3;
      const i010 = (b0g1 + r0) * 3;
      const i110 = (b0g1 + r1) * 3;
      const i001 = (b1g0 + r0) * 3;
      const i101 = (b1g0 + r1) * 3;
      const i011 = (b1g1 + r0) * 3;
      const i111 = (b1g1 + r1) * 3;
      lr = trilinear(t, i000, i100, i010, i110, i001, i101, i011, i111, dr, odr, dg, odg, db, odb);
      lg = trilinear(t, i000 + 1, i100 + 1, i010 + 1, i110 + 1, i001 + 1, i101 + 1, i011 + 1, i111 + 1, dr, odr, dg, odg, db, odb);
      lb = trilinear(t, i000 + 2, i100 + 2, i010 + 2, i110 + 2, i001 + 2, i101 + 2, i011 + 2, i111 + 2, dr, odr, dg, odg, db, odb);
    } else {
      lr = sample1d(t, n, rd, 0);
      lg = sample1d(t, n, gd, 1);
      lb = sample1d(t, n, bd, 2);
    }
    d[i] = constrainByte(f327(f327(alpha * fmaf2(lr, tR, f327(rn * keepR))) * 255));
    d[i + 1] = constrainByte(f327(f327(alpha * fmaf2(lg, tG, f327(gn * keepG))) * 255));
    d[i + 2] = constrainByte(f327(f327(alpha * fmaf2(lb, tB, f327(bn * keepB))) * 255));
  }
}
function lutForPath(ctx, path3) {
  if (path3 === "") return null;
  const text2 = ctx.texts?.get(path3);
  return text2 === void 0 ? null : cachedCubeLut(text2);
}
var colorMap = {
  type: "ColorMap",
  supported: true,
  run(image, params, ctx) {
    const lut = lutForPath(ctx, str(params, "lut_path", ""));
    if (!lut) return;
    applyCubeLut(
      image,
      lut,
      num(params, "intensity", 1),
      num(params, "intensity_r", 1),
      num(params, "intensity_g", 1),
      num(params, "intensity_b", 1)
    );
  }
};

// ../engine/src/render/kernels/color-grade.ts
var f328 = Math.fround;
var INV_2553 = f328(1 / 255);
var EPSILON = f328(1e-5);
var LUMA_R = f328(0.299);
var LUMA_G = f328(0.587);
var LUMA_B = f328(0.114);
var TINT_G = f328(0.1);
var TINT_RB = f328(0.05);
var RECOVERY = f328(0.35);
function fmaf3(a, b, c) {
  return f328(a * b + c);
}
function clampF(v, lo, hi) {
  return v < hi ? v > lo ? v : lo : hi;
}
function clamp012(v) {
  return v < 1 ? v > 0 ? v : 0 : 1;
}
function clampByte2(v) {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(f328(v + 0.5));
}
function luma(r, g, b) {
  return fmaf3(LUMA_B, b, fmaf3(r, LUMA_R, f328(LUMA_G * g)));
}
function sampleCurve2(lut, v) {
  return lut[Math.trunc(f328(v * 255 + 0.5))];
}
var MEMO_BITS = 16;
var INV_ALPHA3 = (() => {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i += 1) t[i] = f328(255 / i);
  return t;
})();
var EXP2_TABLE = [
  1,
  1.0054299011128027,
  1.0108892860517005,
  1.016378314910953,
  1.0218971486541166,
  1.0274459491187637,
  1.0330248790212284,
  1.0386341019613787,
  1.0442737824274138,
  1.0499440858006872,
  1.0556451783605572,
  1.061377227289262,
  1.0671404006768237,
  1.0729348675259756,
  1.0787607977571199,
  1.0846183622133092,
  1.0905077326652577,
  1.0964290818163769,
  1.102382583307841,
  1.1083684117236787,
  1.1143867425958924,
  1.1204377524096067,
  1.1265216186082418,
  1.1326385195987192,
  1.1387886347566916,
  1.1449721444318042,
  1.1511892299529827,
  1.1574400736337511,
  1.1637248587775775,
  1.1700437696832502,
  1.1763969916502812,
  1.182784710984341,
  1.189207115002721,
  1.1956643920398273,
  1.202156731452703,
  1.2086843236265816,
  1.215247359980469,
  1.2218460329727576,
  1.22848053610687,
  1.2351510639369334,
  1.241857812073484,
  1.2486009771892048,
  1.255380757024691,
  1.2621973503942507,
  1.2690509571917332,
  1.275941778396392,
  1.2828700160787783,
  1.2898358734066657,
  1.2968395546510096,
  1.3038812651919358,
  1.3109612115247644,
  1.318079601266064,
  1.3252366431597413,
  1.3324325470831615,
  1.339667524053303,
  1.3469417862329458,
  1.3542555469368927,
  1.3616090206382248,
  1.3690024229745905,
  1.3764359707545302,
  1.383909881963832,
  1.3914243757719262,
  1.3989796725383112,
  1.4065759938190154,
  1.4142135623730951,
  1.4218926021691656,
  1.42961333839197,
  1.4373759974489824,
  1.4451808069770467,
  1.4530279958490526,
  1.460917794180647,
  1.4688504333369818,
  1.4768261459394993,
  1.4848451658727524,
  1.4929077282912648,
  1.5010140696264256,
  1.5091644275934228,
  1.5173590411982147,
  1.5255981507445384,
  1.533881997840956,
  1.5422108254079407,
  1.550584877685,
  1.559004400237837,
  1.567469639965553,
  1.5759808451078865,
  1.5845382652524937,
  1.593142151342267,
  1.6017927556826934,
  1.6104903319492543,
  1.6192351351948637,
  1.6280274218573478,
  1.6368674497669644,
  1.645755478153965,
  1.6546917676561943,
  1.6636765803267364,
  1.6727101796415966,
  1.681792830507429,
  1.6909247992693053,
  1.7001063537185235,
  1.709337763100463,
  1.718619298122478,
  1.7279512309618377,
  1.7373338352737062,
  1.746767386199169,
  1.7562521603732995,
  1.7657884359332727,
  1.7753764925265212,
  1.785016611318935,
  1.7947090750031072,
  1.804454167806624,
  1.8142521755003989,
  1.8241033854070534,
  1.8340080864093424,
  1.843966568958626,
  1.8539791250833855,
  1.864046048397789,
  1.8741676341103,
  1.8843441790323345,
  1.8945759815869656,
  1.9048633418176741,
  1.9152065613971474,
  1.925605943636125,
  1.9360617934922943,
  1.9465744175792332,
  1.9571441241754002,
  1.9677712232331759,
  1.978456026387951,
  1.9891988469672663
];
var EXP2_C0 = 0.2402265068100628;
var EXP2_C1 = 0.6931478155387845;
var EXP2_SHIFT = 52776558133248;
var exp2Bits = new DataView(new ArrayBuffer(8));
function appleExp2f(x) {
  const xd = f328(x);
  const kd = xd + EXP2_SHIFT;
  const k128 = kd - EXP2_SHIFT;
  const r = xd - k128;
  const k = k128 * 128;
  const j = k & 127;
  const m = (k - j) / 128;
  exp2Bits.setFloat64(0, EXP2_TABLE[j]);
  exp2Bits.setUint32(0, exp2Bits.getUint32(0) + m * 1048576 >>> 0);
  const s = exp2Bits.getFloat64(0);
  const p = fma(EXP2_C0, r, EXP2_C1) * r;
  return f328(fma(p, s, s));
}
var NAMED_COLORS = "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32";
var namedColors;
function namedColor(name) {
  if (!namedColors) {
    namedColors = /* @__PURE__ */ new Map([["transparent", [0, 0, 0, 0]]]);
    const parts = NAMED_COLORS.split(" ");
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const hex = Number.parseInt(parts[i + 1], 16);
      namedColors.set(parts[i], [hex >> 16 & 255, hex >> 8 & 255, hex & 255, 255]);
    }
  }
  return namedColors.get(name);
}
function div2572(x) {
  const y = x + 128;
  return y - (y >> 8) >> 8;
}
function hex2int(s, at, n) {
  let result = 0;
  for (let i = at; i < at + n; i += 1) {
    const h = Number.parseInt(s[i], 16);
    if (Number.isNaN(h)) return -1;
    result = result * 16 + h;
  }
  return result;
}
function qColorFromString(name) {
  if (name.length === 0) return void 0;
  if (name[0] === "#") {
    if (name.length > 13) return void 0;
    const s = name.slice(1);
    let a = 65535;
    let r;
    let g;
    let b;
    if (s.length === 12) {
      r = hex2int(s, 0, 4);
      g = hex2int(s, 4, 4);
      b = hex2int(s, 8, 4);
    } else if (s.length === 9) {
      r = hex2int(s, 0, 3);
      g = hex2int(s, 3, 3);
      b = hex2int(s, 6, 3);
      if (r < 0 || g < 0 || b < 0) return void 0;
      r = r << 4 | r >> 8;
      g = g << 4 | g >> 8;
      b = b << 4 | b >> 8;
    } else if (s.length === 8) {
      a = hex2int(s, 0, 2) * 257;
      r = hex2int(s, 2, 2) * 257;
      g = hex2int(s, 4, 2) * 257;
      b = hex2int(s, 6, 2) * 257;
    } else if (s.length === 6) {
      r = hex2int(s, 0, 2) * 257;
      g = hex2int(s, 2, 2) * 257;
      b = hex2int(s, 4, 2) * 257;
    } else if (s.length === 3) {
      r = hex2int(s, 0, 1) * 4369;
      g = hex2int(s, 1, 1) * 4369;
      b = hex2int(s, 2, 1) * 4369;
    } else {
      return void 0;
    }
    if (r < 0 || g < 0 || b < 0 || a < 0) return void 0;
    return [div2572(r), div2572(g), div2572(b), div2572(a)];
  }
  if (name.length > 255) return void 0;
  let key = "";
  for (const ch of name) {
    if (ch !== "	" && ch !== " ") key += ch.toLowerCase();
  }
  return namedColor(key);
}
var WHITE = [255, 255, 255, 255];
var NO_BIAS = [0, 0, 0];
function isPresent(v) {
  return v !== void 0;
}
function wheelBias(entry) {
  let rgba2 = WHITE;
  let amount = 0;
  let lumaShift = 0;
  if (entry) {
    if (isPresent(entry.color_keyframes)) rgba2 = color(entry, "color_keyframes", WHITE);
    else if (typeof entry.color === "string") rgba2 = qColorFromString(entry.color) ?? WHITE;
    if (isPresent(entry.amount_keyframes)) amount = num(entry, "amount_keyframes", 0);
    else if (isPresent(entry.amount)) amount = num(entry, "amount", 0);
    if (isPresent(entry.luma_keyframes)) lumaShift = num(entry, "luma_keyframes", 0);
    else if (isPresent(entry.luma)) lumaShift = num(entry, "luma", 0);
  }
  const ints = rgba2.map(getInt);
  const valid = ints.every((v) => v >= 0 && v <= 255);
  const cr = valid ? f328(ints[0] * 257 / 65535) : 0;
  const cg = valid ? f328(ints[1] * 257 / 65535) : 0;
  const cb = valid ? f328(ints[2] * 257 / 65535) : 0;
  const avg = f328(f328(f328(cr + cg) + cb) / 3);
  const a = clampF(f328(amount), -1, 1);
  const l = clampF(f328(lumaShift), -1, 1);
  return [fmaf3(f328(cr - avg), a, l), fmaf3(f328(cg - avg), a, l), fmaf3(f328(cb - avg), a, l)];
}
function wheelsEnabled(wheels) {
  let value = 1;
  if (wheels) {
    if (typeof wheels.enabled === "boolean") value = wheels.enabled ? 1 : 0;
    else if (isPresent(wheels.enabled_keyframes)) value = num(wheels, "enabled_keyframes", 0);
  }
  return value >= 0.5;
}
var identityTable;
function curveParam(params, key) {
  identityTable ??= evaluateAnimatedCurve(void 0, 1).table;
  const v = record(params, key);
  if (!v) return { enabled: 1, table: identityTable };
  const table = numbers(v, "table");
  return { enabled: num(v, "enabled", 1), table: table && table.length >= 256 ? table : identityTable };
}
function curveLut(curve) {
  const lut = new Float32Array(256);
  if (curve.enabled < 0.5) {
    for (let i = 0; i < 256; i += 1) lut[i] = f328(i * INV_2553);
  } else {
    for (let i = 0; i < 256; i += 1) lut[i] = f328(curve.table[i]);
  }
  return lut;
}
function lutStage(image, ctx, path3, intensity) {
  if (path3 === "" || !(intensity > 0)) return;
  const lut = lutForPath(ctx, path3);
  if (lut) applyCubeLut(image, lut, intensity, 1, 1, 1);
}
var colorGrade = {
  type: "ColorGrade",
  supported: true,
  run(image, params, ctx) {
    const temperature = clampF(f328(num(params, "temperature", 0)), -1, 1);
    const tint2 = clampF(f328(num(params, "tint", 0)), -1, 1);
    const exposure = clampF(f328(num(params, "exposure", 0)), -4, 4);
    const contrast = clampF(f328(num(params, "contrast", 0)), -1, 2);
    const highlights = clampF(f328(num(params, "highlights", 0)), -1, 1);
    const shadows = clampF(f328(num(params, "shadows", 0)), -1, 1);
    const saturation2 = clampF(f328(num(params, "saturation", 1)), 0, 4);
    const vibrance = clampF(f328(num(params, "vibrance", 0)), -1, 1);
    const mix = clampF(f328(num(params, "mix", 1)), 0, 1);
    const inverseMix = f328(1 - mix);
    const wheels = record(params, "wheels");
    const useWheels = wheelsEnabled(wheels);
    const curves = [curveParam(params, "curve_all"), curveParam(params, "curve_red"), curveParam(params, "curve_green"), curveParam(params, "curve_blue")];
    const lutPath = str(params, "lut_path", "");
    const lutIntensity = num(params, "lut_intensity", 1);
    if (temperature === 0 && tint2 === 0 && exposure === 0 && contrast === 0 && highlights === 0 && shadows === 0 && saturation2 === 1 && vibrance === 0 && mix === 1 && !useWheels && curves.every((c) => c.enabled < 0.5)) {
      lutStage(image, ctx, lutPath, lutIntensity);
      return;
    }
    const gain = appleExp2f(exposure);
    const contrastFactor = clampF(f328(1 + contrast), 0, Infinity);
    const [lutAll, lutRed, lutGreen, lutBlue] = curves.map(curveLut);
    const [gR, gG, gB] = useWheels ? wheelBias(record(wheels, "global")) : NO_BIAS;
    const [sR, sG, sB] = useWheels ? wheelBias(record(wheels, "shadows")) : NO_BIAS;
    const [mR, mG, mB] = useWheels ? wheelBias(record(wheels, "midtones")) : NO_BIAS;
    const [hR, hG, hB] = useWheels ? wheelBias(record(wheels, "highlights")) : NO_BIAS;
    const minusTint = -tint2;
    const d = image.data;
    const memoRgb = new Int32Array(1 << MEMO_BITS).fill(-1);
    const memoOut = new Int32Array(1 << MEMO_BITS);
    for (let i = 0; i < d.length; i += 4) {
      const A = d[i + 3];
      if (A === 0) continue;
      let R;
      let G;
      let B;
      let rgb = -1;
      let slot = 0;
      if (A === 255) {
        rgb = d[i] << 16 | d[i + 1] << 8 | d[i + 2];
        slot = Math.imul(rgb, 2654435761) >>> 32 - MEMO_BITS;
        if (memoRgb[slot] === rgb) {
          const out = memoOut[slot];
          d[i] = out >>> 16;
          d[i + 1] = out >>> 8 & 255;
          d[i + 2] = out & 255;
          continue;
        }
        R = f328(d[i] * INV_2553);
        G = f328(d[i + 1] * INV_2553);
        B = f328(d[i + 2] * INV_2553);
      } else {
        const inv = INV_ALPHA3[A];
        R = f328(f328(d[i] * inv) * INV_2553);
        G = f328(f328(d[i + 1] * inv) * INV_2553);
        B = f328(f328(d[i + 2] * inv) * INV_2553);
      }
      const origR = R;
      const origG = G;
      const origB = B;
      R = clamp012(fmaf3(temperature, 0.125, R));
      B = clamp012(fmaf3(-temperature, 0.125, B));
      G = clamp012(fmaf3(TINT_G, minusTint, G));
      R = clamp012(fmaf3(tint2, TINT_RB, R));
      B = clamp012(fmaf3(TINT_RB, tint2, B));
      R = clamp012(f328(R * gain));
      G = clamp012(f328(G * gain));
      B = clamp012(f328(B * gain));
      R = clamp012(fmaf3(f328(R - 0.5), contrastFactor, 0.5));
      G = clamp012(fmaf3(f328(G - 0.5), contrastFactor, 0.5));
      B = clamp012(fmaf3(f328(B - 0.5), contrastFactor, 0.5));
      let L = luma(R, G, B);
      const dark = f328(1 - L);
      const shadowAdjust = f328(f328(shadows * f328(dark * dark)) * RECOVERY);
      const highlightAdjust = f328(f328(highlights * f328(L * L)) * RECOVERY);
      R = clamp012(f328(f328(R + shadowAdjust) + highlightAdjust));
      G = clamp012(f328(f328(G + shadowAdjust) + highlightAdjust));
      B = clamp012(f328(f328(B + shadowAdjust) + highlightAdjust));
      if (useWheels) {
        L = luma(R, G, B);
        R = f328(R + gR);
        G = f328(G + gG);
        B = f328(B + gB);
        const lo = f328(1 - L);
        let w = f328(lo * lo);
        if (Math.abs(w) > EPSILON) {
          R = fmaf3(sR, w, R);
          G = fmaf3(sG, w, G);
          B = fmaf3(sB, w, B);
        }
        const centered = f328(Math.abs(f328(L - 0.5)) * 2);
        w = clamp012(f328(1 - centered * centered));
        if (w > EPSILON) {
          R = fmaf3(mR, w, R);
          G = fmaf3(mG, w, G);
          B = fmaf3(mB, w, B);
        }
        w = f328(L * L);
        if (Math.abs(w) > EPSILON) {
          R = fmaf3(hR, w, R);
          G = fmaf3(hG, w, G);
          B = fmaf3(hB, w, B);
        }
      }
      R = clamp012(R);
      G = clamp012(G);
      B = clamp012(B);
      L = luma(R, G, B);
      const maxC = R < (G < B ? B : G) ? G < B ? B : G : R;
      const minC = (B < G ? B : G) < R ? B < G ? B : G : R;
      const vibranceFactor = fmaf3(vibrance, f328(1 - f328(maxC - minC)), 1);
      const satFactor = f328(saturation2 * (vibranceFactor > 0 ? vibranceFactor : 0));
      R = clamp012(fmaf3(f328(R - L), satFactor, L));
      G = clamp012(fmaf3(f328(G - L), satFactor, L));
      B = clamp012(fmaf3(f328(B - L), satFactor, L));
      R = sampleCurve2(lutRed, sampleCurve2(lutAll, R));
      G = sampleCurve2(lutGreen, sampleCurve2(lutAll, G));
      B = sampleCurve2(lutBlue, sampleCurve2(lutAll, B));
      R = clamp012(fmaf3(origR, inverseMix, f328(R * mix)));
      G = clamp012(fmaf3(origG, inverseMix, f328(G * mix)));
      B = clamp012(fmaf3(origB, inverseMix, f328(B * mix)));
      if (A === 255) {
        const r8 = clampByte2(f328(R * 255));
        const g8 = clampByte2(f328(G * 255));
        const b8 = clampByte2(f328(B * 255));
        d[i] = r8;
        d[i + 1] = g8;
        d[i + 2] = b8;
        memoRgb[slot] = rgb;
        memoOut[slot] = r8 << 16 | g8 << 8 | b8;
      } else {
        const ap = f328(A * INV_2553);
        d[i] = clampByte2(f328(f328(R * 255) * ap));
        d[i + 1] = clampByte2(f328(f328(G * 255) * ap));
        d[i + 2] = clampByte2(f328(f328(B * 255) * ap));
      }
    }
    lutStage(image, ctx, lutPath, lutIntensity);
  }
};

// ../engine/src/render/kernels/denoise.ts
var f329 = Math.fround;
var INV_2554 = f329(1 / 255);
var INV_255_THIRD = f329(INV_2554 / 3);
var LUMA_R2 = f329(0.299);
var LUMA_G2 = f329(0.587);
var LUMA_B2 = f329(0.114);
function clamp013(v) {
  return v < 1 ? v > 0 ? v : 0 : 1;
}
function clampByte3(v) {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(f329(v + 0.5));
}
function luma2(r, g, b) {
  return fmaf(LUMA_B2, b, fmaf(r, LUMA_R2, f329(LUMA_G2 * g)));
}
function shrink(value, threshold, keep) {
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) return f329(value * keep);
  const kept = fmaf(threshold, keep, f329(magnitude - threshold));
  return value < 0 ? -kept : kept;
}
function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp013(f329(f329(value - edge0) / f329(edge1 - edge0)));
  return f329(f329(t * t) * fmaf(t, -2, 3));
}
var defaultResponse;
function responseLut(params) {
  const lut = new Float32Array(256);
  const curve = record(params, "response_curve");
  const enabled = curve ? num(curve, "enabled", 1) : 1;
  if (enabled < 0.5) return lut.fill(1);
  let table = curve ? numbers(curve, "table") : void 0;
  if (!table || table.length < 256) {
    defaultResponse ??= evaluateAnimatedCurve(void 0, 1, [...DENOISE_RESPONSE_NODES]).table;
    table = defaultResponse;
  }
  for (let i = 0; i < 256; i += 1) lut[i] = f329(table[i]);
  return lut;
}
function buildPixelLut(responses, strength, detail, temporal, colorNoise) {
  const lut = {
    fineThreshold: new Float32Array(256),
    midThreshold: new Float32Array(256),
    fineKeep: new Float32Array(256),
    midKeep: new Float32Array(256),
    chromaFineThresholdRB: new Float32Array(256),
    chromaFineThresholdG: new Float32Array(256),
    chromaMidThreshold: new Float32Array(256),
    chromaFineKeep: new Float32Array(256),
    chromaMidKeep: new Float32Array(256),
    temporalMixBase: new Float32Array(256)
  };
  const overdrive = f329(strength * fmaf(f329(f329(0.85) * strength), strength, 1));
  const structuralKeep = f329(detail * fmaf(detail, f329(0.34), f329(0.62)));
  const fineKeepFloor = f329(f329(f329(detail * detail) * detail) * f329(0.35));
  const inverseDetail = f329(1 - detail);
  const fineThresholdScale = fmaf(inverseDetail, 42, 24);
  const midThresholdScale = fmaf(inverseDetail, 20, 9);
  const fineKeepScale = fmaf(inverseDetail, f329(0.24), f329(0.95));
  const midKeepScale = fmaf(inverseDetail, f329(0.22), f329(0.46));
  const chromaScaleRB = fmaf(colorNoise, f329(0.55), f329(0.75));
  const chromaScaleG = fmaf(colorNoise, f329(0.45), f329(0.8));
  const chromaMidScale = fmaf(colorNoise, f329(0.45), f329(0.85));
  const temporalScale = f329(strength * temporal);
  for (let i = 0; i < 256; i += 1) {
    const response = responses[i];
    const noise = f329(overdrive * response);
    const fineThreshold = fmaf(noise, fineThresholdScale, 4);
    const midThreshold = fmaf(noise, midThresholdScale, 2);
    const fineCandidate = fmaf(-noise, fineKeepScale, 1);
    const fineKeep = fineCandidate > fineKeepFloor ? fineCandidate : fineKeepFloor;
    const midCandidate = fmaf(-noise, midKeepScale, 1);
    const midKeep = midCandidate > structuralKeep ? midCandidate : structuralKeep;
    const noiseColor = f329(-noise * colorNoise);
    const chromaFineKeep = fmaf(f329(0.55), noiseColor, fineKeep);
    const chromaMidKeep = fmaf(0.25, noiseColor, midKeep);
    lut.fineThreshold[i] = fineThreshold;
    lut.midThreshold[i] = midThreshold;
    lut.fineKeep[i] = fineKeep;
    lut.midKeep[i] = midKeep;
    lut.chromaFineThresholdRB[i] = f329(fineThreshold * chromaScaleRB);
    lut.chromaFineThresholdG[i] = f329(fineThreshold * chromaScaleG);
    lut.chromaMidThreshold[i] = f329(midThreshold * chromaMidScale);
    lut.chromaFineKeep[i] = chromaFineKeep > 0 ? chromaFineKeep : 0;
    lut.chromaMidKeep[i] = chromaMidKeep > 0 ? chromaMidKeep : 0;
    lut.temporalMixBase[i] = f329(response * temporalScale);
  }
  return lut;
}
var scratch = { capacity: 0, planes: [] };
function scratchPlanes(count) {
  if (count > scratch.capacity) {
    scratch.capacity = count;
    scratch.planes = Array.from({ length: 10 }, () => new Float32Array(count));
  }
  return scratch.planes.map((plane) => plane.subarray(0, count));
}
function unpremultiplyInto(data, count, r, g, b) {
  for (let p = 0; p < count; p += 1) {
    const i = p * 4;
    const a = data[i + 3];
    if (a === 255) {
      r[p] = data[i];
      g[p] = data[i + 1];
      b[p] = data[i + 2];
    } else {
      const u = a > 0 ? f329(255 / a) : 0;
      r[p] = f329(data[i] * u);
      g[p] = f329(data[i + 1] * u);
      b[p] = f329(data[i + 2] * u);
    }
  }
}
function boxBlur(src, dst, tmp, width, height, radius) {
  if (radius <= 0) {
    dst.set(src);
    return;
  }
  const invWindow = f329(1 / (radius * 2 + 1));
  const lead = radius + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = f329(src[row] * lead);
    for (let i = 1; i <= radius; i += 1) sum = f329(sum + src[row + Math.min(i, width - 1)]);
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = f329(sum * invWindow);
      const add = src[row + Math.min(x + radius + 1, width - 1)];
      const sub = src[row + Math.max(x - radius, 0)];
      sum = f329(sum + f329(add - sub));
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = f329(tmp[x] * lead);
    for (let i = 1; i <= radius; i += 1) sum = f329(sum + tmp[Math.min(i, height - 1) * width + x]);
    for (let y = 0; y < height; y += 1) {
      dst[y * width + x] = f329(sum * invWindow);
      const add = tmp[Math.min(y + radius + 1, height - 1) * width + x];
      const sub = tmp[Math.max(y - radius, 0) * width + x];
      sum = f329(sum + f329(add - sub));
    }
  }
}
var STATE_KEY = "DenoiseImage";
function history(ctx) {
  const existing = ctx.state?.get(STATE_KEY);
  if (existing) return existing;
  const fresh = { previous: null, width: 0, height: 0, lastFrame: -1 };
  ctx.state?.set(STATE_KEY, fresh);
  return fresh;
}
function resetHistory(h) {
  h.previous = null;
  h.lastFrame = -1;
}
var denoiseImage = {
  type: "DenoiseImage",
  supported: true,
  run(image, params, ctx) {
    const state2 = history(ctx);
    const strength = clamp013(f329(num(params, "strength", 0.78)));
    const width = image.width;
    const height = image.height;
    if (strength <= 0 || width <= 0 || height <= 0) {
      resetHistory(state2);
      return;
    }
    const detail = clamp013(f329(num(params, "detail", 0.5)));
    const temporal = clamp013(f329(num(params, "temporal", 0.35)));
    const motionSafety = clamp013(f329(num(params, "motion_safety", 0.7)));
    const colorNoise = clamp013(f329(num(params, "color_noise", 0.7)));
    const frame = ctx.frame;
    const data = image.data;
    let inputCopy = null;
    if (temporal > 0) inputCopy = new Uint8ClampedArray(data);
    else resetHistory(state2);
    const prev = temporal > 0 && state2.lastFrame >= 0 && frame === state2.lastFrame + 1 && state2.width === width && state2.height === height ? state2.previous : null;
    const lut = buildPixelLut(responseLut(params), strength, detail, temporal, colorNoise);
    const inverseDetail = f329(1 - detail);
    const gateScale = fmaf(inverseDetail, f329(0.55), f329(0.45));
    const lumaScale = fmaf(inverseDetail, f329(0.28), f329(0.32));
    const chromaScale = fmaf(colorNoise, f329(0.35), f329(0.65));
    const looseness = f329(1 - motionSafety);
    const motionLow = fmaf(looseness, f329(0.08), f329(0.02));
    const motionHigh = fmaf(looseness, f329(0.1), f329(motionLow + f329(0.055)));
    const fineRadius = 1 + (strength >= 0.75 && detail <= f329(0.45) ? 1 : 0);
    let coarseRadius = 3;
    if (strength >= f329(0.95) && detail <= f329(0.15)) coarseRadius = 8;
    else if (strength >= f329(0.8) && detail <= f329(0.35)) coarseRadius = 6;
    else if (strength >= f329(0.65) && detail <= f329(0.55)) coarseRadius = 5;
    const count = width * height;
    const [cr, cg, cb, tmp, fineR, fineG, fineB, baseR, baseG, baseB] = scratchPlanes(count);
    unpremultiplyInto(data, count, cr, cg, cb);
    boxBlur(cr, fineR, tmp, width, height, fineRadius);
    boxBlur(cg, fineG, tmp, width, height, fineRadius);
    boxBlur(cb, fineB, tmp, width, height, fineRadius);
    boxBlur(fineR, baseR, tmp, width, height, coarseRadius);
    boxBlur(fineG, baseG, tmp, width, height, coarseRadius);
    boxBlur(fineB, baseB, tmp, width, height, coarseRadius);
    for (let p = 0; p < count; p += 1) {
      const i = p * 4;
      const centerR = cr[p];
      const centerG = cg[p];
      const centerB = cb[p];
      const fr = fineR[p];
      const fg = fineG[p];
      const fb = fineB[p];
      const br = baseR[p];
      const bg = baseG[p];
      const bb = baseB[p];
      const centerY = luma2(centerR, centerG, centerB);
      const fineY = luma2(fr, fg, fb);
      const baseY = luma2(br, bg, bb);
      const k = clampByte3(centerY);
      const chromaMidThreshold = lut.chromaMidThreshold[k];
      const chromaFineKeep = lut.chromaFineKeep[k];
      const chromaMidKeep = lut.chromaMidKeep[k];
      let outY = f329(
        f329(baseY + shrink(f329(fineY - baseY), lut.midThreshold[k], lut.midKeep[k])) + shrink(f329(centerY - fineY), lut.fineThreshold[k], lut.fineKeep[k])
      );
      let outR = f329(
        f329(br + shrink(f329(fr - br), chromaMidThreshold, chromaMidKeep)) + shrink(f329(centerR - fr), lut.chromaFineThresholdRB[k], chromaFineKeep)
      );
      let outG = f329(
        f329(bg + shrink(f329(fg - bg), chromaMidThreshold, chromaMidKeep)) + shrink(f329(centerG - fg), lut.chromaFineThresholdG[k], chromaFineKeep)
      );
      let outB = f329(
        f329(bb + shrink(f329(fb - bb), chromaMidThreshold, chromaMidKeep)) + shrink(f329(centerB - fb), lut.chromaFineThresholdRB[k], chromaFineKeep)
      );
      const correction = f329(outY - luma2(outR, outG, outB));
      outR = f329(outR + correction);
      outG = f329(outG + correction);
      outB = f329(outB + correction);
      if (prev) {
        const pa = prev[i + 3];
        const pu = pa === 255 ? 1 : pa > 0 ? f329(255 / pa) : 0;
        const prevR = pa === 255 ? prev[i] : f329(prev[i] * pu);
        const prevG = pa === 255 ? prev[i + 1] : f329(prev[i + 1] * pu);
        const prevB = pa === 255 ? prev[i + 2] : f329(prev[i + 2] * pu);
        const prevY = luma2(prevR, prevG, prevB);
        const lumaMotion = f329(Math.abs(f329(centerY - prevY)) * INV_2554);
        const colorMotion = f329(
          f329(f329(Math.abs(f329(centerR - prevR)) + Math.abs(f329(centerG - prevG))) + Math.abs(f329(centerB - prevB))) * INV_255_THIRD
        );
        const colorMotionWeighted = f329(colorMotion * 0.75);
        const motion = lumaMotion < colorMotionWeighted ? colorMotionWeighted : lumaMotion;
        const gate = f329(1 - smoothstep(motionLow, motionHigh, motion));
        const blend = f329(f329(lut.temporalMixBase[k] * gate) * gateScale);
        const mix = blend < f329(0.35) ? blend : f329(0.35);
        const lumaMix = f329(lumaScale * mix);
        const chromaMix = f329(chromaScale * mix);
        const chromaR = f329(outR - outY);
        const chromaG = f329(outG - outY);
        const chromaB = f329(outB - outY);
        outY = fmaf(f329(prevY - outY), lumaMix, outY);
        outR = f329(outY + fmaf(f329(f329(prevR - prevY) - chromaR), chromaMix, chromaR));
        outG = f329(outY + fmaf(f329(f329(prevG - prevY) - chromaG), chromaMix, chromaG));
        outB = f329(outY + fmaf(f329(f329(prevB - prevY) - chromaB), chromaMix, chromaB));
      }
      const a = data[i + 3];
      if (a === 255) {
        data[i] = clampByte3(outR);
        data[i + 1] = clampByte3(outG);
        data[i + 2] = clampByte3(outB);
      } else {
        const premultiply2 = f329(a * INV_2554);
        data[i] = clampByte3(f329(premultiply2 * outR));
        data[i + 1] = clampByte3(f329(premultiply2 * outG));
        data[i + 2] = clampByte3(f329(premultiply2 * outB));
      }
    }
    if (temporal > 0) {
      state2.previous = inputCopy;
      state2.width = width;
      state2.height = height;
    }
    state2.lastFrame = frame;
  }
};

// ../engine/src/render/kernels/image-cache.ts
var cache = /* @__PURE__ */ new WeakMap();
function cached(source2, key, make) {
  let bySize = cache.get(source2);
  if (!bySize) {
    bySize = /* @__PURE__ */ new Map();
    cache.set(source2, bySize);
  }
  let hit = bySize.get(key);
  if (!hit) {
    hit = make();
    if (bySize.size >= 4) bySize.delete(bySize.keys().next().value);
    bySize.set(key, hit);
  }
  return hit;
}
function scaledPremul(source2, width, height, delivered) {
  let base = null;
  const premul = () => base ??= cached(source2, "premul", () => premultiply(source2));
  let from = premul;
  if (delivered && (delivered.width !== source2.width || delivered.height !== source2.height) && delivered.width > 0 && delivered.height > 0) {
    from = () => cached(source2, `via ${delivered.width}x${delivered.height}`, () => smoothScale(premul(), delivered.width, delivered.height));
  }
  const via = delivered ? `${delivered.width}x${delivered.height}` : "";
  return cached(source2, `${width}x${height}<${via}`, () => {
    const img = from();
    return img.width === width && img.height === height ? img : smoothScale(img, width, height);
  });
}

// ../engine/src/render/kernels/displace.ts
var f3210 = Math.fround;
var MIN_CONTRAST_DIVISOR = f3210(1e-5);
function displaceMapPath(params) {
  if (params.map_reader !== void 0) return readerPath(params, "map_reader");
  return readerPath(params, "reader");
}
function cfmin(a, b) {
  return a < b || b !== b ? a : b;
}
function cfmax(a, b) {
  return a > b || b !== b ? a : b;
}
function grayTable(brightness2, contrast) {
  const brightnessAdj = Math.trunc(255 * brightness2);
  const c = f3210(contrast);
  const divisor = f3210(20 - c);
  const factor = f3210(20 / (MIN_CONTRAST_DIVISOR < divisor ? divisor : MIN_CONTRAST_DIVISOR));
  const table = new Uint8Array(256);
  for (let g = 0; g < 256; g += 1) table[g] = clampU8(Math.trunc(fmaf(factor, g + brightnessAdj - 128, 128)));
  return table;
}
function displaceKernel(image, params, ctx) {
  const path3 = displaceMapPath(params);
  if (!path3) return;
  const source2 = ctx.images.get(path3);
  const width = image.width;
  const height = image.height;
  if (!source2 || source2.width <= 0 || source2.height <= 0 || width <= 0 || height <= 0) return;
  const map = scaledPremul(source2, width, height, ctx.imageSizes?.[path3]).data;
  const strength = f3210(num(params, "strength", 1));
  const xAmount = f3210(f3210(f3210(num(params, "horizontal", 0.05)) * width) * strength);
  const yAmount = f3210(f3210(f3210(num(params, "vertical", 0)) * height) * strength);
  const adjusted = grayTable(num(params, "brightness", 0), num(params, "contrast", 0));
  const invert = bool(params, "invert", false);
  const replace = bool(params, "replace_image", false);
  const original = clonePremul(image).data;
  const out = image.data;
  const maxX = f3210(width - 1);
  const maxY = f3210(height - 1);
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    const gray = map[idx] * 11 + map[idx + 1] * 16 + map[idx + 2] * 5 >> 5;
    let processed = adjusted[gray];
    if (invert) processed = 255 - processed;
    processed = 128 + Math.trunc((processed - 128) * map[idx + 3] / 255);
    if (replace) {
      const v = clampU8(processed);
      out[idx] = v;
      out[idx + 1] = v;
      out[idx + 2] = v;
      out[idx + 3] = 255;
      continue;
    }
    const signed = f3210(f3210(processed - 127.5) / 127.5);
    const px = i % width;
    const py = (i - px) / width;
    const x = cfmax(0, cfmin(fmaf(signed, xAmount, px), maxX));
    const y = cfmax(0, cfmin(fmaf(signed, yAmount, py), maxY));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = f3210(x - x0);
    const ty = f3210(y - y0);
    const itx = f3210(1 - tx);
    const ity = f3210(1 - ty);
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    for (let c = 0; c < 4; c += 1) {
      const top = fmaf(original[i00 + c], itx, f3210(tx * original[i10 + c]));
      const bottom = fmaf(original[i01 + c], itx, f3210(tx * original[i11 + c]));
      out[idx + c] = clampU8(roundHalfAway(fmaf(top, ity, f3210(bottom * ty))));
    }
  }
}
var displace = { type: "Displace", supported: true, run: displaceKernel };

// ../engine/src/render/kernels/effect-mask.ts
var f3211 = Math.fround;
function blendWithMask(original, effected, mask2, invert) {
  const o = original.data;
  const e = effected.data;
  const m = mask2.data;
  for (let i = 0; i < e.length; i += 4) {
    let gray = qGray(m[i], m[i + 1], m[i + 2]);
    if (invert) gray = 255 - gray;
    const factor = f3211(gray / 255);
    const inverse = f3211(1 - factor);
    e[i] = Math.trunc(f3211(o[i] * inverse + f3211(e[i] * factor)));
    e[i + 1] = Math.trunc(f3211(o[i + 1] * inverse + f3211(e[i + 1] * factor)));
    e[i + 2] = Math.trunc(f3211(o[i + 2] * inverse + f3211(e[i + 2] * factor)));
    e[i + 3] = Math.trunc(f3211(o[i + 3] * inverse + f3211(e[i + 3] * factor)));
  }
}
function blendVaryStrength(original, effected, mask2, invert) {
  const o = original.data;
  const e = effected.data;
  const m = mask2.data;
  for (let i = 0; i < e.length; i += 4) {
    let factor = f3211(qGray(m[i], m[i + 1], m[i + 2]) / 255);
    if (invert) factor = f3211(1 - factor);
    factor = f3211(factor * factor);
    const inverse = f3211(1 - factor);
    e[i] = Math.trunc(f3211(o[i] * inverse + f3211(e[i] * factor)));
    e[i + 1] = Math.trunc(f3211(o[i + 1] * inverse + f3211(e[i + 1] * factor)));
    e[i + 2] = Math.trunc(f3211(o[i + 2] * inverse + f3211(e[i + 2] * factor)));
    e[i + 3] = o[i + 3];
  }
}

// ../engine/src/render/kernels/film-grain.ts
var f3212 = Math.fround;
var INV_2555 = f3212(1 / 255);
var EPSILON2 = f3212(1e-5);
var LUMA_R3 = f3212(0.299);
var LUMA_G3 = f3212(0.587);
var LUMA_B3 = f3212(0.114);
var INV_U32_MAX = f3212(2 / f3212(4294967295));
var SOFT_LERP_SPAN = f3212(f3212(0.12) - f3212(0.45));
var CLUMP_LERP_SPAN = f3212(f3212(0.08) - f3212(0.35));
var SOFT_LERP_BASE = f3212(0.45);
var CLUMP_LERP_BASE = f3212(0.35);
var CLUSTER_BASE = f3212(0.45);
var CLUSTER_SCALE = f3212(1.35);
var INTENSITY_SCALE = f3212(0.18);
var SALTS = [16777619, 2376512323, 3625334849, 3407524639];
var SOFT_XOR = 1365458477;
var CLUMP_XOR = 2769414579;
function fmaf4(a, b, c) {
  return f3212(a * b + c);
}
function clamp014(v) {
  return v < 1 ? v > 0 ? v : 0 : 1;
}
function clampByte4(v) {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(f3212(v + 0.5));
}
function smooth(t) {
  return f3212(f3212(t * t) * fmaf4(t, -2, 3));
}
var INV_ALPHA4 = (() => {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i += 1) t[i] = f3212(255 / i);
  return t;
})();
function mix32(value) {
  let v = value >>> 0;
  v ^= v >>> 16;
  v = Math.imul(v, 2146121005);
  v ^= v >>> 15;
  v = Math.imul(v, 2221713035);
  v ^= v >>> 16;
  return v >>> 0;
}
function utf82(text2) {
  const out = [];
  for (const ch of text2) {
    let cp = ch.codePointAt(0);
    if (cp >= 55296 && cp <= 57343) cp = 65533;
    if (cp < 128) out.push(cp);
    else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
    else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
    else out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
  }
  return out;
}
function fnv1a(text2) {
  let h = 2166136261;
  for (const byte of utf82(text2)) h = Math.imul(h ^ byte, 16777619) >>> 0;
  return h;
}
function hashSigned(seed, x, y, t, salt) {
  let h = seed ^ salt;
  h ^= Math.imul(x, 2654435769);
  h ^= Math.imul(y, 2246822507);
  h ^= Math.imul(t, 3266489909);
  return fmaf4(f3212(mix32(h)), INV_U32_MAX, -1);
}
var filmGrain = {
  type: "FilmGrain",
  supported: true,
  run(image, params, ctx) {
    const amount = clamp014(f3212(num(params, "amount", 0.25)));
    if (amount <= EPSILON2) return;
    const size = clamp014(f3212(num(params, "size", 0.2)));
    const softness = clamp014(f3212(num(params, "softness", 0.25)));
    const clump = clamp014(f3212(num(params, "clump", 0.2)));
    const shadowStrength = clamp014(f3212(num(params, "shadows", 0.8)));
    const midtoneStrength = clamp014(f3212(num(params, "midtones", 1)));
    const highlightStrength = clamp014(f3212(num(params, "highlights", 0.55)));
    const colorAmount = clamp014(f3212(num(params, "color_amount", 0.2)));
    const colorVariation = clamp014(f3212(num(params, "color_variation", 0.35)));
    const evolution = clamp014(f3212(num(params, "evolution", 0.65)));
    const coherence = clamp014(f3212(num(params, "coherence", 0.55)));
    const seed = int(params, "seed", 1);
    const fineFrequency = f3212(1 / fmaf4(size, 8, 1));
    const softFrequency = f3212(fineFrequency * fmaf4(softness, SOFT_LERP_SPAN, SOFT_LERP_BASE));
    const clumpFrequency = f3212(fineFrequency * fmaf4(clump, CLUMP_LERP_SPAN, CLUMP_LERP_BASE));
    const temporalRate = f3212(evolution * fmaf4(f3212(1 - coherence), 7, 1));
    const temporalPosition = f3212(f3212(ctx.frame) * temporalRate);
    const time0 = Math.floor(temporalPosition);
    const time1 = time0 + 1;
    const temporalMix = temporalRate <= EPSILON2 ? 0 : clamp014(f3212(temporalPosition - time0));
    const smoothMix = smooth(temporalMix);
    const baseSeed = (seed >>> 0 ^ mix32(fnv1a(ctx.effectId ?? ""))) >>> 0;
    const intensityScale = f3212(amount * INTENSITY_SCALE);
    const useTemporal = temporalRate > EPSILON2 && smoothMix > EPSILON2;
    const useSoft = softness > EPSILON2;
    const useClump = clump > EPSILON2;
    const useVariation = colorAmount > EPSILON2 && colorVariation > EPSILON2;
    const numTimes = useTemporal ? 2 : 1;
    const numSalts = useVariation ? 4 : 1;
    const buckets = [time0, time1];
    const width = image.width;
    const height = image.height;
    let refW = width;
    let refH = height;
    const tw = Math.trunc(ctx.timelineWidth ?? ctx.canvasWidth);
    const th = Math.trunc(ctx.timelineHeight ?? ctx.canvasHeight);
    if (tw > 0 && th > 0) {
      refW = tw;
      refH = th;
    }
    const scaleX = width > 0 ? f3212(refW / width) : 1;
    const scaleY = height > 0 ? f3212(refH / height) : 1;
    if (width === 0 || height === 0) return;
    const fineIxOf = new Int32Array(width);
    const softIxOf = new Int32Array(width);
    const softSxOf = new Float32Array(width);
    const clumpIxOf = new Int32Array(width);
    const clumpSxOf = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      const refX = f3212(x * scaleX);
      fineIxOf[x] = Math.trunc(f3212(refX * fineFrequency));
      if (useSoft) {
        const srx = f3212(refX * softFrequency);
        softIxOf[x] = Math.trunc(srx);
        softSxOf[x] = smooth(f3212(srx - softIxOf[x]));
      }
      if (useClump) {
        const crx = f3212(refX * clumpFrequency);
        clumpIxOf[x] = Math.trunc(crx);
        clumpSxOf[x] = smooth(f3212(crx - clumpIxOf[x]));
      }
    }
    const lastX = width - 1;
    const fineNoise = new Float32Array((fineIxOf[lastX] + 1) * 8);
    const fineStamp = new Int32Array(fineIxOf[lastX] + 1).fill(-1);
    const softTop = new Float32Array((softIxOf[lastX] + 2) * 8);
    const softBottom = new Float32Array((softIxOf[lastX] + 2) * 8);
    const softStamp = new Int32Array(softIxOf[lastX] + 2).fill(-1);
    const clumpTop = new Float32Array((clumpIxOf[lastX] + 2) * 4);
    const clumpBottom = new Float32Array((clumpIxOf[lastX] + 2) * 4);
    const clumpStamp = new Int32Array(clumpIxOf[lastX] + 2).fill(-1);
    const softCol0 = new Float32Array(8);
    const softCol1 = new Float32Array(8);
    const clumpCol0 = new Float32Array(4);
    const clumpCol1 = new Float32Array(4);
    const grains = new Float32Array(4);
    const d = image.data;
    for (let y = 0; y < height; y += 1) {
      const refY = f3212(y * scaleY);
      const fineIy = Math.trunc(f3212(refY * fineFrequency));
      let softIy0 = 0;
      let softSy = 0;
      if (useSoft) {
        const sry = f3212(refY * softFrequency);
        softIy0 = Math.trunc(sry);
        softSy = smooth(f3212(sry - softIy0));
      }
      let clumpIy0 = 0;
      let clumpSy = 0;
      if (useClump) {
        const cry = f3212(refY * clumpFrequency);
        clumpIy0 = Math.trunc(cry);
        clumpSy = smooth(f3212(cry - clumpIy0));
      }
      let cachedFineIx = -1;
      let fineAt = 0;
      let cachedSoftIx0 = -1;
      let cachedClumpIx0 = -1;
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const A = d[i + 3];
        if (A === 0) continue;
        let R;
        let G;
        let B;
        if (A === 255) {
          R = f3212(d[i] * INV_2555);
          G = f3212(d[i + 1] * INV_2555);
          B = f3212(d[i + 2] * INV_2555);
        } else {
          const inv = INV_ALPHA4[A];
          R = f3212(f3212(d[i] * inv) * INV_2555);
          G = f3212(f3212(d[i + 1] * inv) * INV_2555);
          B = f3212(f3212(d[i + 2] * inv) * INV_2555);
        }
        const L = fmaf4(LUMA_B3, B, fmaf4(R, LUMA_R3, f3212(LUMA_G3 * G)));
        const dark = f3212(1 - L);
        const centered = f3212(Math.abs(f3212(L - 0.5)) * 2);
        const midtone = clamp014(f3212(1 - centered * centered));
        const tone = fmaf4(f3212(L * L), highlightStrength, fmaf4(f3212(dark * dark), shadowStrength, f3212(midtoneStrength * midtone)));
        if (tone <= EPSILON2) continue;
        const fineIx = fineIxOf[x];
        if (fineIx !== cachedFineIx) {
          cachedFineIx = fineIx;
          fineAt = fineIx * 8;
          if (fineStamp[fineIx] !== fineIy) {
            fineStamp[fineIx] = fineIy;
            for (let t = 0; t < numTimes; t += 1) {
              for (let s = 0; s < numSalts; s += 1) fineNoise[fineAt + t * 4 + s] = hashSigned(baseSeed, fineIx, fineIy, buckets[t], SALTS[s]);
            }
          }
        }
        let softSx = 0;
        if (useSoft) {
          const softIx0 = softIxOf[x];
          if (softIx0 !== cachedSoftIx0) {
            cachedSoftIx0 = softIx0;
            for (let c = softIx0; c <= softIx0 + 1; c += 1) {
              if (softStamp[c] === softIy0) continue;
              softStamp[c] = softIy0;
              for (let t = 0; t < numTimes; t += 1) {
                for (let s = 0; s < numSalts; s += 1) {
                  const salt = (SALTS[s] ^ SOFT_XOR) >>> 0;
                  softTop[c * 8 + t * 4 + s] = hashSigned(baseSeed, c, softIy0, buckets[t], salt);
                  softBottom[c * 8 + t * 4 + s] = hashSigned(baseSeed, c, softIy0 + 1, buckets[t], salt);
                }
              }
            }
            const at0 = softIx0 * 8;
            const at1 = at0 + 8;
            for (let t = 0; t < numTimes; t += 1) {
              for (let s = 0; s < numSalts; s += 1) {
                const k = t * 4 + s;
                const n00 = softTop[at0 + k];
                const n10 = softTop[at1 + k];
                softCol0[k] = fmaf4(f3212(softBottom[at0 + k] - n00), softSy, n00);
                softCol1[k] = fmaf4(f3212(softBottom[at1 + k] - n10), softSy, n10);
              }
            }
          }
          softSx = softSxOf[x];
        }
        let clumpSx = 0;
        if (useClump) {
          const clumpIx0 = clumpIxOf[x];
          if (clumpIx0 !== cachedClumpIx0) {
            cachedClumpIx0 = clumpIx0;
            for (let c = clumpIx0; c <= clumpIx0 + 1; c += 1) {
              if (clumpStamp[c] === clumpIy0) continue;
              clumpStamp[c] = clumpIy0;
              for (let s = 0; s < numSalts; s += 1) {
                const salt = (SALTS[s] ^ CLUMP_XOR) >>> 0;
                clumpTop[c * 4 + s] = hashSigned(baseSeed, c, clumpIy0, time0, salt);
                clumpBottom[c * 4 + s] = hashSigned(baseSeed, c, clumpIy0 + 1, time0, salt);
              }
            }
            const at0 = clumpIx0 * 4;
            const at1 = at0 + 4;
            for (let s = 0; s < numSalts; s += 1) {
              const n00 = clumpTop[at0 + s];
              const n10 = clumpTop[at1 + s];
              clumpCol0[s] = fmaf4(f3212(clumpBottom[at0 + s] - n00), clumpSy, n00);
              clumpCol1[s] = fmaf4(f3212(clumpBottom[at1 + s] - n10), clumpSy, n10);
            }
          }
          clumpSx = clumpSxOf[x];
        }
        for (let s = 0; s < numSalts; s += 1) {
          let g0 = fineNoise[fineAt + s];
          if (useSoft) {
            const soft0 = fmaf4(f3212(softCol1[s] - softCol0[s]), softSx, softCol0[s]);
            g0 = fmaf4(f3212(soft0 - g0), softness, g0);
          }
          let grain = g0;
          if (useTemporal) {
            let g1 = fineNoise[fineAt + 4 + s];
            if (useSoft) {
              const soft1 = fmaf4(f3212(softCol1[4 + s] - softCol0[4 + s]), softSx, softCol0[4 + s]);
              g1 = fmaf4(f3212(soft1 - g1), softness, g1);
            }
            grain = fmaf4(f3212(g1 - g0), smoothMix, g0);
          }
          if (useClump) {
            const cluster = fmaf4(f3212(clumpCol1[s] - clumpCol0[s]), clumpSx, clumpCol0[s]);
            const target = fmaf4(Math.abs(cluster), CLUSTER_SCALE, CLUSTER_BASE);
            grain = f3212(grain * fmaf4(f3212(target - 1), clump, 1));
          }
          grains[s] = grain;
        }
        const strength = f3212(tone * intensityScale);
        const lumaGrain = grains[0];
        if (useVariation) {
          const redGrain = fmaf4(f3212(grains[1] - lumaGrain), colorVariation, lumaGrain);
          const greenGrain = fmaf4(f3212(grains[2] - lumaGrain), colorVariation, lumaGrain);
          const blueGrain = fmaf4(f3212(grains[3] - lumaGrain), colorVariation, lumaGrain);
          R = clamp014(fmaf4(fmaf4(f3212(redGrain - lumaGrain), colorAmount, lumaGrain), strength, R));
          G = clamp014(fmaf4(fmaf4(f3212(greenGrain - lumaGrain), colorAmount, lumaGrain), strength, G));
          B = clamp014(fmaf4(fmaf4(f3212(blueGrain - lumaGrain), colorAmount, lumaGrain), strength, B));
        } else {
          const delta = f3212(lumaGrain * strength);
          R = clamp014(f3212(R + delta));
          G = clamp014(f3212(G + delta));
          B = clamp014(f3212(B + delta));
        }
        if (A === 255) {
          d[i] = clampByte4(f3212(R * 255));
          d[i + 1] = clampByte4(f3212(G * 255));
          d[i + 2] = clampByte4(f3212(B * 255));
        } else {
          const ap = f3212(A * INV_2555);
          d[i] = clampByte4(f3212(ap * f3212(R * 255)));
          d[i + 1] = clampByte4(f3212(ap * f3212(G * 255)));
          d[i + 2] = clampByte4(f3212(ap * f3212(B * 255)));
        }
      }
    }
  }
};

// ../engine/src/render/kernels/geometry.ts
var f3213 = Math.fround;
function cropRects(params, W, H) {
  const left = num(params, "left", 0);
  const top = num(params, "top", 0);
  const right = num(params, "right", 0);
  const bottom = num(params, "bottom", 0);
  const xShift = num(params, "x", 0);
  const yShift = num(params, "y", 0);
  const paint = { x: left * W, y: top * H, w: Math.max(0, 1 - left - right) * W, h: Math.max(0, 1 - top - bottom) * H };
  const copy = { x: paint.x + xShift * W, y: paint.y + yShift * H, w: paint.w, h: paint.h };
  const setLeft = (r, pos) => {
    const diff = pos - r.x;
    r.x += diff;
    r.w -= diff;
  };
  const setTop = (r, pos) => {
    const diff = pos - r.y;
    r.y += diff;
    r.h -= diff;
  };
  if (copy.x < 0) {
    setLeft(paint, paint.x - copy.x);
    setLeft(copy, 0);
  }
  if (copy.x + copy.w > W) {
    paint.w = paint.x + paint.w - (copy.x + copy.w - W) - paint.x;
    copy.w = W - copy.x;
  }
  if (copy.y < 0) {
    setTop(paint, paint.y - copy.y);
    setTop(copy, 0);
  }
  if (copy.y + copy.h > H) {
    paint.h = paint.y + paint.h - (copy.y + copy.h - H) - paint.y;
    copy.h = H - copy.y;
  }
  return { paint, copy };
}
var crop = {
  type: "Crop",
  supported: true,
  run(image, params) {
    const W = image.width;
    const H = image.height;
    const { paint, copy } = cropRects(params, W, H);
    const cropped = createPremul(W, H);
    drawImageRect(cropped, image, { x: paint.x, y: paint.y, width: paint.w, height: paint.h }, { x: copy.x, y: copy.y, width: copy.w, height: copy.h });
    if (!bool(params, "resize", false)) return cropped;
    const r = toRect({ x: paint.x, y: paint.y, width: paint.w, height: paint.h });
    if (r.width === 0 && r.height === 0) return cropped;
    if (r.width <= 0 || r.height <= 0) return createPremul(0, 0);
    const out = createPremul(r.width, r.height);
    for (let row = 0; row < r.height; row += 1) {
      const sy = r.y + row;
      if (sy < 0 || sy >= H) continue;
      for (let col = 0; col < r.width; col += 1) {
        const sx = r.x + col;
        if (sx < 0 || sx >= W) continue;
        const si = (sy * W + sx) * 4;
        const di = (row * r.width + col) * 4;
        out.data[di] = cropped.data[si];
        out.data[di + 1] = cropped.data[si + 1];
        out.data[di + 2] = cropped.data[si + 2];
        out.data[di + 3] = cropped.data[si + 3];
      }
    }
    return out;
  }
};
var shift = {
  type: "Shift",
  supported: true,
  run(image, params) {
    const W = image.width;
    const H = image.height;
    const d = image.data;
    const xShift = num(params, "x", 0);
    const yShift = num(params, "y", 0);
    const xLimit = Math.abs(xShift) % 1;
    const yLimit = Math.abs(yShift) % 1;
    if (xShift !== 0) {
      const s = Math.trunc(roundHalfAway(W * xLimit));
      const row = new Uint8ClampedArray(W * 4);
      for (let y = 0; y < H; y += 1) {
        const base = y * W * 4;
        row.set(d.subarray(base, base + W * 4));
        if (xShift > 0) {
          d.set(row.subarray(0, (W - s) * 4), base + s * 4);
          d.set(row.subarray((W - s) * 4, W * 4), base);
        } else {
          d.set(row.subarray(s * 4, W * 4), base);
          d.set(row.subarray(0, s * 4), base + (W - s) * 4);
        }
      }
    }
    if (yShift !== 0) {
      const s = W * Math.trunc(roundHalfAway(H * yLimit));
      const n = W * H;
      const tmp = new Uint8ClampedArray(d);
      if (yShift > 0) {
        d.set(tmp.subarray(0, (n - s) * 4), s * 4);
        d.set(tmp.subarray((n - s) * 4, n * 4), 0);
      } else {
        d.set(tmp.subarray(s * 4, n * 4), 0);
        d.set(tmp.subarray(0, s * 4), (n - s) * 4);
      }
    }
  }
};
var colorShift = {
  type: "ColorShift",
  supported: true,
  run(image, params) {
    const W = image.width;
    const H = image.height;
    if (W <= 0 || H <= 0) return;
    const keys = ["red", "green", "blue", "alpha"];
    const src = new Uint8ClampedArray(image.data);
    const d = image.data;
    keys.forEach((name, c) => {
      const xs = f3213(num(params, `${name}_x`, 0));
      const ys = f3213(num(params, `${name}_y`, 0));
      const xl = Math.trunc(roundHalfAway(W * (Math.abs(xs) % 1)));
      const yl = Math.trunc(roundHalfAway(H * (Math.abs(ys) % 1)));
      const dx = xs > 0 ? xl : xs < 0 ? -xl : 0;
      const dy = ys > 0 ? yl : ys < 0 ? -yl : 0;
      if (dx === 0 && dy === 0) return;
      for (let row = 0; row < H; row += 1) {
        const ty = ((row + dy) % H + H) % H;
        for (let col = 0; col < W; col += 1) {
          const tx = ((col + dx) % W + W) % W;
          d[(ty * W + tx) * 4 + c] = src[(row * W + col) * 4 + c];
        }
      }
    });
  }
};
var wave = {
  type: "Wave",
  supported: true,
  run(image, params, ctx) {
    const W = image.width;
    const count = W * image.height;
    if (count === 0) return;
    const original = new Uint8ClampedArray(image.data);
    const d = image.data;
    const time = ctx.frame;
    const wavelength = num(params, "wavelength", 0.06);
    const amplitude = num(params, "amplitude", 0.3);
    const multiplier = num(params, "multiplier", 0.2);
    const shiftX = num(params, "shift_x", 0);
    const speedY = num(params, "speed_y", 0.2);
    let rowOffset = 0;
    for (let Y = 0; Y < image.height; Y += 1) {
      const noiseVal = f3213((100 + Y * 1e-3) * multiplier);
      const noiseAmp = f3213(noiseVal * amplitude);
      const waveform = f3213(Math.sin(Y * wavelength + time * speedY));
      const waveVal = f3213((waveform + shiftX) * noiseAmp);
      for (let x = 0; x < W; x += 1) {
        const pixel = rowOffset + x;
        let source2 = roundHalfAway(f3213(pixel + waveVal));
        if (source2 < 0) source2 = 0;
        if (source2 >= count) source2 = count - 1;
        d[pixel * 4] = original[source2 * 4];
        d[pixel * 4 + 1] = original[source2 * 4 + 1];
        d[pixel * 4 + 2] = original[source2 * 4 + 2];
        d[pixel * 4 + 3] = original[source2 * 4 + 3];
      }
      rowOffset += W;
    }
  }
};
var deinterlace = {
  type: "Deinterlace",
  supported: true,
  run(image, params) {
    const W = image.width;
    const H = image.height;
    const start = bool(params, "isOdd", true) ? 1 : 0;
    const rows = Math.trunc((H - start + 1) / 2);
    if (rows <= 0 || W <= 0) return createPremul(0, 0);
    const half = createPremul(W, rows);
    for (let i = 0; i < rows; i += 1) {
      const row = start + 2 * i;
      half.data.set(image.data.subarray(row * W * 4, (row + 1) * W * 4), i * W * 4);
    }
    return fastScaled(half, W, H);
  }
};
function clamp015(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
var bars = {
  type: "Bars",
  supported: true,
  run(image, params) {
    const W = image.width;
    const H = image.height;
    if (W <= 0 || H <= 0) return;
    const [r, g, b] = hexColorRgb(color(params, "color", [0, 0, 0, 255]));
    const top = Math.trunc(clamp015(num(params, "top", 0.1)) * H);
    const bottom = Math.trunc(clamp015(num(params, "bottom", 0.1)) * H);
    const left = Math.trunc(clamp015(num(params, "left", 0)) * W);
    const right = Math.trunc(clamp015(num(params, "right", 0)) * W);
    const d = image.data;
    const paint = (row, from, to) => {
      for (let x = from; x < to; x += 1) {
        const i = (row * W + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    };
    for (let row = 0; row < H; row += 1) {
      if (top > 0 && row <= top || bottom > 0 && row >= H - bottom) {
        paint(row, 0, W);
      } else {
        if (left > 0) paint(row, 0, left);
        if (right > 0) paint(row, W - right, W);
      }
    }
  }
};

// ../engine/src/render/qt/transform.ts
var TxNone = 0;
var TxTranslate = 1;
var TxScale = 2;
var TxRotate = 4;
var TxShear = 8;
function fuzzyIsNull2(d) {
  return Math.abs(d) <= 1e-12;
}
function fuzzyCompare3(p1, p2) {
  return Math.abs(p1 - p2) * 1e12 <= Math.min(Math.abs(p1), Math.abs(p2));
}
var DEG2RAD = 0.017453292519943295;
var QTransform = class _QTransform {
  m11 = 1;
  m12 = 0;
  m21 = 0;
  m22 = 1;
  dx = 0;
  dy = 0;
  mType = TxNone;
  mDirty = TxNone;
  /** `QTransform(h11, h12, h21, h22, dx, dy)`: type recomputed from values (m_dirty = TxShear). */
  static fromValues(m11, m12, m21, m22, dx, dy) {
    const t = new _QTransform();
    t.m11 = m11;
    t.m12 = m12;
    t.m21 = m21;
    t.m22 = m22;
    t.dx = dx;
    t.dy = dy;
    t.mType = TxNone;
    t.mDirty = TxShear;
    return t;
  }
  /** From a Canvas2D-order affine `[a, b, c, d, e, f]`. */
  static fromAffine(a) {
    return _QTransform.fromValues(a[0], a[1], a[2], a[3], a[4], a[5]);
  }
  clone() {
    const t = new _QTransform();
    t.m11 = this.m11;
    t.m12 = this.m12;
    t.m21 = this.m21;
    t.m22 = this.m22;
    t.dx = this.dx;
    t.dy = this.dy;
    t.mType = this.mType;
    t.mDirty = this.mDirty;
    return t;
  }
  toAffine() {
    return [this.m11, this.m12, this.m21, this.m22, this.dx, this.dy];
  }
  /** `QTransform::type()` (qtransform.cpp): lazily classify, fuzzy. */
  type() {
    if (this.mDirty === TxNone || this.mDirty < this.mType) return this.mType;
    let t = TxNone;
    const level = this.mDirty;
    if (level >= TxRotate && (!fuzzyIsNull2(this.m12) || !fuzzyIsNull2(this.m21))) {
      const dot = fma2(this.m11, this.m21, this.m12 * this.m22);
      t = fuzzyIsNull2(dot) ? TxRotate : TxShear;
    } else if (level >= TxScale && (!fuzzyIsNull2(this.m11 - 1) || !fuzzyIsNull2(this.m22 - 1))) {
      t = TxScale;
    } else if (level >= TxTranslate && (!fuzzyIsNull2(this.dx) || !fuzzyIsNull2(this.dy))) {
      t = TxTranslate;
    }
    this.mType = t;
    this.mDirty = TxNone;
    return t;
  }
  inlineType() {
    return this.mDirty === TxNone ? this.mType : this.type();
  }
  isIdentity() {
    return this.inlineType() === TxNone;
  }
  translate(dx, dy) {
    if (dx === 0 && dy === 0) return this;
    switch (this.inlineType()) {
      case TxNone:
        this.dx = dx;
        this.dy = dy;
        break;
      case TxTranslate:
        this.dx += dx;
        this.dy += dy;
        break;
      case TxScale:
        this.dx = fma2(dx, this.m11, this.dx);
        this.dy = fma2(dy, this.m22, this.dy);
        break;
      default:
        this.dx += fma2(dx, this.m11, dy * this.m21);
        this.dy += fma2(dy, this.m22, dx * this.m12);
        break;
    }
    if (this.mDirty < TxTranslate) this.mDirty = TxTranslate;
    return this;
  }
  scale(sx, sy) {
    if (sx === 1 && sy === 1) return this;
    switch (this.inlineType()) {
      case TxNone:
      case TxTranslate:
        this.m11 = sx;
        this.m22 = sy;
        break;
      case TxRotate:
      case TxShear:
        this.m12 *= sx;
        this.m21 *= sy;
        this.m11 *= sx;
        this.m22 *= sy;
        break;
      default:
        this.m11 *= sx;
        this.m22 *= sy;
        break;
    }
    if (this.mDirty < TxScale) this.mDirty = TxScale;
    return this;
  }
  /** Degrees; positive is clockwise on a y-down canvas. */
  rotate(a) {
    if (a === 0) return this;
    let sina = 0;
    let cosa = 0;
    if (a === 90 || a === -270) sina = 1;
    else if (a === 270 || a === -90) sina = -1;
    else if (a === 180) cosa = -1;
    else {
      const b = DEG2RAD * a;
      sina = Math.sin(b);
      cosa = Math.cos(b);
    }
    switch (this.inlineType()) {
      case TxNone:
      case TxTranslate:
        this.m11 = cosa;
        this.m12 = sina;
        this.m21 = -sina;
        this.m22 = cosa;
        break;
      case TxScale: {
        const tm11 = cosa * this.m11;
        const tm12 = sina * this.m22;
        const tm21 = -sina * this.m11;
        const tm22 = cosa * this.m22;
        this.m11 = tm11;
        this.m12 = tm12;
        this.m21 = tm21;
        this.m22 = tm22;
        break;
      }
      default: {
        const tm11 = fma2(cosa, this.m11, sina * this.m21);
        const tm12 = fma2(cosa, this.m12, sina * this.m22);
        const tm21 = fma2(-sina, this.m11, cosa * this.m21);
        const tm22 = fma2(-sina, this.m12, cosa * this.m22);
        this.m11 = tm11;
        this.m12 = tm12;
        this.m21 = tm21;
        this.m22 = tm22;
        break;
      }
    }
    if (this.mDirty < TxRotate) this.mDirty = TxRotate;
    return this;
  }
  shear(sh, sv) {
    if (sh === 0 && sv === 0) return this;
    switch (this.inlineType()) {
      case TxNone:
      case TxTranslate:
        this.m12 = sv;
        this.m21 = sh;
        break;
      case TxScale:
        this.m12 = sv * this.m22;
        this.m21 = sh * this.m11;
        break;
      default: {
        const tm11 = sv * this.m21;
        const tm22 = sh * this.m12;
        const tm12 = sv * this.m22;
        const tm21 = sh * this.m11;
        this.m11 += tm11;
        this.m12 += tm12;
        this.m21 += tm21;
        this.m22 += tm22;
        break;
      }
    }
    if (this.mDirty < TxShear) this.mDirty = TxShear;
    return this;
  }
  /** `this * m`: apply `this` first, then `m` (qtransform.cpp operator*). */
  multiply(m) {
    const otherType = m.inlineType();
    if (otherType === TxNone) return this.clone();
    const thisType = this.inlineType();
    if (thisType === TxNone) return m.clone();
    const t = new _QTransform();
    const type = Math.max(thisType, otherType);
    if (type === TxTranslate) {
      t.dx = this.dx + m.dx;
      t.dy += this.dy + m.dy;
    } else if (type === TxScale) {
      t.m11 = this.m11 * m.m11;
      t.m22 = this.m22 * m.m22;
      t.dx = fma2(this.dx, m.m11, m.dx);
      t.dy = fma2(this.dy, m.m22, m.dy);
    } else {
      t.m11 = fma2(this.m11, m.m11, this.m12 * m.m21);
      t.m12 = fma2(this.m11, m.m12, this.m12 * m.m22);
      t.m21 = fma2(this.m21, m.m11, this.m22 * m.m21);
      t.m22 = fma2(this.m21, m.m12, this.m22 * m.m22);
      t.dx = fma2(this.dx, m.m11, this.dy * m.m21) + m.dx;
      t.dy = fma2(this.dx, m.m12, this.dy * m.m22) + m.dy;
    }
    t.mDirty = type;
    t.mType = type;
    return t;
  }
  /** `QTransform::inverted()`; null when singular. */
  inverted() {
    const inv = new _QTransform();
    let ok = true;
    const type = this.inlineType();
    switch (type) {
      case TxNone:
        break;
      case TxTranslate:
        inv.dx = -this.dx;
        inv.dy = -this.dy;
        break;
      case TxScale:
        ok = !fuzzyIsNull2(this.m11) && !fuzzyIsNull2(this.m22);
        if (ok) {
          inv.m11 = 1 / this.m11;
          inv.m22 = 1 / this.m22;
          inv.dx = -this.dx * inv.m11;
          inv.dy = -this.dy * inv.m22;
        }
        break;
      default: {
        const dtr = fma2(this.m11, this.m22, -(this.m12 * this.m21));
        if (dtr === 0) {
          ok = false;
          break;
        }
        const dinv = 1 / dtr;
        inv.m11 = this.m22 * dinv;
        inv.m12 = -this.m12 * dinv;
        inv.m21 = -this.m21 * dinv;
        inv.m22 = this.m11 * dinv;
        inv.dx = fma2(this.m21, this.dy, -(this.m22 * this.dx)) * dinv;
        inv.dy = fma2(this.m12, this.dx, -(this.m11 * this.dy)) * dinv;
        break;
      }
    }
    if (!ok) return null;
    inv.mType = this.mType;
    inv.mDirty = this.mDirty;
    return inv;
  }
  /** Map a point (the `MAP` macro for affine types). */
  map(x, y) {
    switch (this.inlineType()) {
      case TxNone:
        return [x, y];
      case TxTranslate:
        return [x + this.dx, y + this.dy];
      case TxScale:
        return [fma2(this.m11, x, this.dx), fma2(this.m22, y, this.dy)];
      default:
        return [fma2(this.m11, x, this.m21 * y) + this.dx, fma2(this.m12, x, this.m22 * y) + this.dy];
    }
  }
  /** `QTransform::mapRect(QRectF)`: bounding rect of the mapped rectangle. */
  mapRect(x, y, w, h) {
    const t = this.inlineType();
    if (t <= TxTranslate) return { x: x + this.dx, y: y + this.dy, width: w, height: h };
    if (t <= TxScale) {
      let rx = fma2(this.m11, x, this.dx);
      let ry = fma2(this.m22, y, this.dy);
      let rw = this.m11 * w;
      let rh = this.m22 * h;
      if (rw < 0) {
        rw = -rw;
        rx -= rw;
      }
      if (rh < 0) {
        rh = -rh;
        ry -= rh;
      }
      return { x: rx, y: ry, width: rw, height: rh };
    }
    const corners = [
      this.map(x, y),
      this.map(x + w, y),
      this.map(x + w, y + h),
      this.map(x, y + h)
    ];
    let xmin = corners[0][0];
    let ymin = corners[0][1];
    let xmax = xmin;
    let ymax = ymin;
    for (const [cx, cy] of corners) {
      xmin = Math.min(xmin, cx);
      ymin = Math.min(ymin, cy);
      xmax = Math.max(xmax, cx);
      ymax = Math.max(ymax, cy);
    }
    return { x: xmin, y: ymin, width: xmax - xmin, height: ymax - ymin };
  }
};
function scaleIsUniform(t) {
  const type = t.type();
  if (type <= TxTranslate) return true;
  if (type === TxScale) return fuzzyCompare3(Math.abs(t.m11), Math.abs(t.m22));
  const xScale1 = fma2(t.m11, t.m11, t.m21 * t.m21);
  const yScale1 = fma2(t.m12, t.m12, t.m22 * t.m22);
  const xScale2 = fma2(t.m11, t.m11, t.m12 * t.m12);
  const yScale2 = fma2(t.m21, t.m21, t.m22 * t.m22);
  if (Math.abs(xScale1 - yScale1) > Math.abs(xScale2 - yScale2)) {
    return type === TxRotate && fuzzyCompare3(xScale1, yScale1);
  }
  return type === TxRotate && fuzzyCompare3(xScale2, yScale2);
}

// ../engine/src/render/kernels/lens-flare.ts
var f3214 = Math.fround;
var USHRT_MAX = 65535;
function fromRgbF(r, g, b, a) {
  return { a: qRound(a * USHRT_MAX), r: qRound(r * USHRT_MAX), g: qRound(g * USHRT_MAX), b: qRound(b * USHRT_MAX) };
}
function toHsv(c) {
  const r = c.r / USHRT_MAX;
  const g = c.g / USHRT_MAX;
  const b = c.b / USHRT_MAX;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const v = qRound(max * USHRT_MAX);
  if (fuzzyIsNull2(delta)) return { a: c.a, h: USHRT_MAX, s: 0, v };
  const s = qRound(delta / max * USHRT_MAX);
  let hue2 = 0;
  if (fuzzyCompare3(r, max)) hue2 = (g - b) / delta;
  else if (fuzzyCompare3(g, max)) hue2 = 2 + (b - r) / delta;
  else if (fuzzyCompare3(b, max)) hue2 = 4 + (r - g) / delta;
  hue2 *= 60;
  if (hue2 < 0) hue2 += 360;
  return { a: c.a, h: qRound(hue2 * 100), s, v };
}
function fromHsvF(h, s, v, a) {
  return { a: qRound(a * USHRT_MAX), h: h === -1 ? USHRT_MAX : qRound(h * 36e3), s: qRound(s * USHRT_MAX), v: qRound(v * USHRT_MAX) };
}
function hsvToRgb(c) {
  if (c.s === 0 || c.h === USHRT_MAX) return { a: c.a, r: c.v, g: c.v, b: c.v };
  const h = c.h === 36e3 ? 0 : c.h / 6e3;
  const s = c.s / USHRT_MAX;
  const v = c.v / USHRT_MAX;
  const i = Math.trunc(h);
  const f = h - i;
  const p = qRound(v * (1 - s) * USHRT_MAX);
  const vv = qRound(v * USHRT_MAX);
  if (i & 1) {
    const q = qRound(v * fma2(-s, f, 1) * USHRT_MAX);
    if (i === 1) return { a: c.a, r: q, g: vv, b: p };
    if (i === 3) return { a: c.a, r: p, g: q, b: vv };
    return { a: c.a, r: vv, g: p, b: q };
  }
  const t = qRound(v * fma2(-s, 1 - f, 1) * USHRT_MAX);
  if (i === 0) return { a: c.a, r: vv, g: t, b: p };
  if (i === 2) return { a: c.a, r: p, g: vv, b: t };
  return { a: c.a, r: t, g: p, b: vv };
}
function channelsF(c) {
  return [c.r / USHRT_MAX, c.g / USHRT_MAX, c.b / USHRT_MAX];
}
function shiftedHsv(base, hShift, sScale, vScale, aScale) {
  const hsv = toHsv(base);
  let h = hsv.h === USHRT_MAX ? -1 : hsv.h / 36e3;
  const s = hsv.s / USHRT_MAX;
  const v = hsv.v / USHRT_MAX;
  const a = hsv.a / USHRT_MAX;
  if (s === 0) h = 0;
  h = (h + hShift + 1) % 1;
  const clamp016 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
  return fromHsvF(h, clamp016(s * sScale), clamp016(v * vScale), clamp016(a * aScale));
}
var REFLECTORS = [
  [1, 0.6699, 0.027, 0, 14, 113],
  [1, 0.2692, 0.01, 90, 181, 142],
  [1, -0.0112, 5e-3, 56, 140, 106],
  [2, 0.649, 0.031, 9, 29, 19],
  [2, 0.4696, 0.015, 24, 14, 0],
  [2, 0.4087, 0.037, 24, 14, 0],
  [2, -0.2003, 0.022, 42, 19, 0],
  [2, -0.4103, 0.025, 0, 9, 17],
  [2, -0.4503, 0.058, 10, 4, 0],
  [2, -0.5112, 0.017, 5, 5, 14],
  [2, -1.496, 0.2, 9, 4, 0],
  [2, -1.496, 0.5, 9, 4, 0],
  [3, 0.4487, 0.075, 34, 19, 0],
  [3, 1, 0.1, 14, 26, 0],
  [3, -1.301, 0.039, 10, 25, 13],
  [4, 1.309, 0.19, 9, 0, 17],
  [4, 1.309, 0.195, 9, 16, 5],
  [4, 1.309, 0.2, 17, 4, 0],
  [4, -1.301, 0.038, 17, 4, 0]
];
function byteF(x) {
  return f3214(x / 255);
}
function addChannel(c, p, cf) {
  const v = c + Math.trunc(f3214((255 - c) * p) * cf);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
var F0_15 = f3214(0.15);
var F0_12 = f3214(0.12);
var F0_04 = f3214(0.04);
var F0_07 = f3214(0.07);
function lensFlareKernel(image, params) {
  const w = image.width;
  const h = image.height;
  if (w <= 0 || h <= 0) return;
  const X = f3214(num(params, "x", -0.5));
  const Y = f3214(num(params, "y", -0.5));
  const I = f3214(num(params, "brightness", 1));
  const S = f3214(num(params, "size", 1));
  const SP = f3214(num(params, "spread", 1));
  const halfW = f3214(w * 0.5);
  const halfH = f3214(h * 0.5);
  const px = f3214(fmaf(X, 0.5, 0.5) * w);
  const py = f3214(fmaf(Y, 0.5, 0.5) * h);
  const DX = f3214(f3214(halfW - px) * SP);
  const DY = f3214(f3214(halfH - py) * SP);
  const c = color(params, "color", [255, 255, 255, 255]);
  const ch = (v) => Math.min(255, Math.max(0, v)) / 255;
  const tint2 = fromRgbF(ch(c[0]), ch(c[1]), ch(c[2]), ch(c[3]));
  const [tr, tg, tb] = channelsF(tint2);
  const ta = tint2.a / USHRT_MAX;
  const matt = w;
  const scolor = f3214(f3214(matt * f3214(0.0375)) * S);
  const sglow = f3214(f3214(matt * 0.078125) * S);
  const sinner = f3214(f3214(matt * 0.1796875) * S);
  const souter = f3214(f3214(matt * 0.3359375) * S);
  const shalo = f3214(f3214(matt * f3214(0.084375)) * S);
  const shaloWidth = f3214(shalo * F0_07);
  const tintify = (br, bg, bb) => channelsF(fromRgbF(br * tr, bg * tg, bb * tb, ta));
  const cColor = tintify(byteF(239), byteF(239), byteF(239));
  const cGlow = tintify(byteF(245), byteF(245), byteF(245));
  const cInner = tintify(1, byteF(38), byteF(43));
  const cOuter = tintify(byteF(69), byteF(59), byteF(64));
  const cHalo = tintify(byteF(80), byteF(15), byteF(4));
  const tintHsv = toHsv(tint2);
  const whiteTint = tintHsv.s / USHRT_MAX < f3214(0.01);
  const hShift = f3214(tintHsv.h === USHRT_MAX ? -1 : tintHsv.h / 36e3);
  const sScale = f3214(tintHsv.s / USHRT_MAX);
  const vScale = f3214(tintHsv.v / USHRT_MAX);
  const aScale = f3214(tintHsv.a / USHRT_MAX);
  const n = REFLECTORS.length;
  const refl = {
    type: new Int8Array(n),
    x: new Float64Array(n),
    y: new Float64Array(n),
    size: new Float64Array(n),
    den: new Float64Array(n),
    bound: new Float64Array(n),
    r: new Float64Array(n),
    g: new Float64Array(n),
    b: new Float64Array(n)
  };
  REFLECTORS.forEach(([type, fxy, fsize, r, g, b], j) => {
    const fx = f3214(fxy);
    const size = f3214(f3214(f3214(fsize) * matt) * S);
    const base = fromRgbF(byteF(r), byteF(g), byteF(b), 1);
    const [cr, cg, cb] = channelsF(whiteTint ? base : hsvToRgb(shiftedHsv(base, hShift, sScale, vScale, aScale)));
    refl.type[j] = type;
    refl.x[j] = fmaf(fx, DX, halfW);
    refl.y[j] = fmaf(fx, DY, halfH);
    refl.size[j] = size;
    refl.den[j] = type === 1 ? size : f3214(size * (type === 2 ? F0_15 : type === 3 ? F0_12 : F0_04));
    refl.bound[j] = size > 0 ? type === 4 ? size * 1.05 : size : Infinity;
    refl.r[j] = cr;
    refl.g[j] = cg;
    refl.b[j] = cb;
  });
  const overlay = new Uint8ClampedArray(w * h * 4);
  const overlayAlpha = new Uint8Array(w * h);
  const rowDy = new Float64Array(n);
  const active = new Int32Array(n);
  for (let yy = 0; yy < h; yy += 1) {
    const ddy = f3214(yy - py);
    const ddy2 = ddy * ddy;
    let activeCount = 0;
    for (let j = 0; j < n; j += 1) {
      rowDy[j] = f3214(refl.y[j] - yy);
      if (!(Math.abs(rowDy[j]) >= refl.bound[j])) active[activeCount++] = j;
    }
    for (let xx = 0; xx < w; xx += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      const ddx = f3214(xx - px);
      const d2 = f3214(Math.sqrt(ddx * ddx + ddy2));
      let p;
      if (d2 < scolor) {
        p = f3214(f3214(scolor - d2) / scolor);
        p = f3214(p * p);
        r = addChannel(r, p, cColor[0]);
        g = addChannel(g, p, cColor[1]);
        b = addChannel(b, p, cColor[2]);
      }
      if (d2 < sglow) {
        p = f3214(f3214(sglow - d2) / sglow);
        p = f3214(p * p);
        r = addChannel(r, p, cGlow[0]);
        g = addChannel(g, p, cGlow[1]);
        b = addChannel(b, p, cGlow[2]);
      }
      if (d2 < sinner) {
        p = f3214(f3214(sinner - d2) / sinner);
        p = f3214(p * p);
        r = addChannel(r, p, cInner[0]);
        g = addChannel(g, p, cInner[1]);
        b = addChannel(b, p, cInner[2]);
      }
      if (d2 < souter) {
        p = f3214(f3214(souter - d2) / souter);
        r = addChannel(r, p, cOuter[0]);
        g = addChannel(g, p, cOuter[1]);
        b = addChannel(b, p, cOuter[2]);
      }
      p = Math.abs(f3214(f3214(d2 - shalo) / shaloWidth));
      if (p < 1) {
        p = f3214(1 - p);
        r = addChannel(r, p, cHalo[0]);
        g = addChannel(g, p, cHalo[1]);
        b = addChannel(b, p, cHalo[2]);
      }
      for (let k = 0; k < activeCount; k += 1) {
        const j = active[k];
        const rx = f3214(refl.x[j] - xx);
        if (Math.abs(rx) >= refl.bound[j]) continue;
        const ry = rowDy[j];
        const rd = f3214(Math.sqrt(rx * rx + ry * ry));
        const type = refl.type[j];
        if (type === 4) {
          p = Math.abs(f3214(f3214(rd - refl.size[j]) / refl.den[j]));
          if (!(p < 1)) continue;
          p = f3214(1 - p);
        } else {
          p = f3214(f3214(refl.size[j] - rd) / refl.den[j]);
          if (!(p > 0)) continue;
          if (type === 1) p = f3214(p * p);
          else if (type === 2) p = p > 1 ? 1 : p;
          else p = fmaf(p > 1 ? 1 : p, -F0_12, 1);
        }
        r = addChannel(r, p, refl.r[j]);
        g = addChannel(g, p, refl.g[j]);
        b = addChannel(b, p, refl.b[j]);
      }
      const a = Math.max(r, g, b);
      const i = (yy * w + xx) * 4;
      overlay[i] = byteMul(r, a);
      overlay[i + 1] = byteMul(g, a);
      overlay[i + 2] = byteMul(b, a);
      overlay[i + 3] = a;
      overlayAlpha[yy * w + xx] = a;
    }
  }
  const d = image.data;
  const origAlpha = new Uint8Array(w * h);
  for (let i = 0; i < origAlpha.length; i += 1) origAlpha[i] = d[i * 4 + 3];
  const intOpacity = Math.trunc((I < 0 ? 0 : I > 1 ? 1 : I) * 256);
  composerFor(CompositionMode.Plus)(d, 0, overlay, 0, w * h, 255 * intOpacity >> 8);
  for (let i = 0; i < origAlpha.length; i += 1) {
    const oa = f3214(origAlpha[i] / 255);
    const fa = f3214(f3214(overlayAlpha[i] / 255) * I);
    const m = f3214((oa < fa ? fa : oa) * 255);
    const alpha = Math.trunc(m < 0 ? 0 : m > 255 ? 255 : m);
    const o = i * 4;
    d[o] = byteMul(d[o], alpha);
    d[o + 1] = byteMul(d[o + 1], alpha);
    d[o + 2] = byteMul(d[o + 2], alpha);
    d[o + 3] = byteMul(d[o + 3], alpha);
  }
}
var lensFlare = { type: "LensFlare", supported: true, run: lensFlareKernel };

// ../engine/src/render/kernels/mask.ts
var f3215 = Math.fround;
var MUL_LUT = (() => {
  const t = new Uint8Array(256 * 256);
  for (let a = 0; a < 256; a += 1) for (let v = 0; v < 256; v += 1) t[a * 256 + v] = Math.trunc(v * a / 255);
  return t;
})();
function maskGrayTable(brightness2, contrast) {
  const brightnessAdj = Math.trunc(255 * brightness2);
  const contrastFactor = f3215(20 / Math.max(0.5, f3215(20 - f3215(contrast))));
  const table = new Uint8Array(256);
  for (let g = 0; g < 256; g += 1) {
    table[g] = clampU8(Math.trunc(f3215(contrastFactor * (g + brightnessAdj - 128) + 128)));
  }
  return table;
}
function applyScaledMask(image, scaled, settings) {
  const m = scaled.data;
  const adjusted = maskGrayTable(settings.brightness, settings.contrast);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = m[i] * 11 + m[i + 1] * 16 + m[i + 2] * 5 >> 5;
    const diff = clampU8(m[i + 3] - adjusted[gray]);
    if (settings.replaceImage) {
      d[i] = diff;
      d[i + 1] = diff;
      d[i + 2] = diff;
      d[i + 3] = diff;
      continue;
    }
    const row = (settings.invert ? 255 - diff : diff) * 256;
    d[i] = MUL_LUT[row + d[i]];
    d[i + 1] = MUL_LUT[row + d[i + 1]];
    d[i + 2] = MUL_LUT[row + d[i + 2]];
    d[i + 3] = MUL_LUT[row + d[i + 3]];
  }
}
function applyMaskFromSource(image, maskImage, settings) {
  if (image.width <= 0 || image.height <= 0 || maskImage.width <= 0 || maskImage.height <= 0) return;
  applyScaledMask(image, scaledPremul(maskImage, image.width, image.height), settings);
}
var mask = {
  type: "Mask",
  supported: true,
  handlesMask: true,
  run(image, params, ctx) {
    const path3 = readerPath(params, "mask_reader") ?? readerPath(params, "reader");
    if (!path3) return;
    const source2 = ctx.images.get(path3);
    if (!source2) return;
    applyMaskFromSource(image, source2, {
      brightness: num(params, "brightness", 0),
      contrast: num(params, "contrast", 0),
      replaceImage: bool(params, "replace_image", false),
      invert: bool(params, "mask_invert", false)
    });
  }
};

// ../engine/src/render/kernels/shadow-glow.ts
var f3216 = Math.fround;
var DEG_TO_RAD_F = f3216(Math.PI / 180);
function clampf3(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
function boxPass(src, dst, len, count, step, lineStep, r) {
  const inv = f3216(1 / (r * 2 + 1));
  const lastIndex = len - 1;
  for (let line2 = 0; line2 < count; line2 += 1) {
    const base = line2 * lineStep;
    const first = src[base];
    const last = src[base + lastIndex * step];
    let value = f3216((r + 1) * first);
    for (let j = 0; j < r; j += 1) value = f3216(value + src[base + Math.min(j, lastIndex) * step]);
    for (let x = 0; x < len; x += 1) {
      const ai = x + r;
      const add = ai < lastIndex ? src[base + ai * step] : last;
      const si = x - r - 1;
      const sub = si < 0 ? first : src[base + si * step];
      value = f3216(value + f3216(add - sub));
      dst[base + x * step] = value * inv;
    }
  }
}
function boxBlur2(mask2, w, h, r, iterations) {
  if (r <= 0 || iterations <= 0 || w <= 0 || h <= 0) return;
  const temp = new Float32Array(mask2.length);
  for (let i = 0; i < iterations; i += 1) {
    boxPass(mask2, temp, w, h, 1, w, r);
    boxPass(temp, mask2, h, w, w, 1, r);
  }
}
function maxPass(src, dst, len, count, step, lineStep, r, queue) {
  for (let line2 = 0; line2 < count; line2 += 1) {
    const base = line2 * lineStep;
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let x = 0; x < len; x += 1) {
      const right = Math.min(len - 1, x + r);
      while (next <= right) {
        const v = src[base + next * step];
        while (tail > head && src[base + queue[tail - 1] * step] <= v) tail -= 1;
        queue[tail] = next;
        tail += 1;
        next += 1;
      }
      while (queue[head] < x - r) head += 1;
      const m = src[base + queue[head] * step];
      dst[base + x * step] = m > 0 ? m : 0;
    }
  }
}
function spread(mask2, w, h, r) {
  if (r <= 0 || w <= 0 || h <= 0) return;
  const temp = new Float32Array(mask2.length);
  const queue = new Int32Array(Math.max(w, h));
  maxPass(mask2, temp, w, h, 1, w, r, queue);
  maxPass(temp, mask2, h, w, w, 1, r, queue);
}
function alphaMask(image) {
  const d = image.data;
  const mask2 = new Float32Array(image.width * image.height);
  for (let i = 0; i < mask2.length; i += 1) mask2[i] = d[i * 4 + 3] / 255;
  return mask2;
}
function tint(params, fallback) {
  const c = color(params, "color", fallback);
  const ch = (v) => Math.min(255, Math.max(0, getInt(v)));
  return { r: ch(c[0]), g: ch(c[1]), b: ch(c[2]), a: f3216(getInt(c[3]) / 255) };
}
function overlayPixel(out, i, r, g, b, alpha) {
  out[i] = Math.trunc(f3216(r * alpha));
  out[i + 1] = Math.trunc(f3216(g * alpha));
  out[i + 2] = Math.trunc(f3216(b * alpha));
  out[i + 3] = Math.trunc(f3216(255 * alpha));
}
function sourceOver2(dst, src) {
  composerFor(CompositionMode.SourceOver)(dst.data, 0, src.data, 0, dst.width * dst.height, 255);
}
function shadowKernel(image, params) {
  const w = image.width;
  const h = image.height;
  if (w <= 0 || h <= 0) return;
  const opacity = clampf3(f3216(num(params, "opacity", 0.6)), 0, 1);
  const blur2 = Math.max(0, getInt(num(params, "blur_radius", 18)));
  const spreadValue = clampf3(f3216(num(params, "spread", 0.12)), 0, 1);
  const distance = f3216(num(params, "distance", 10));
  const angle = f3216(num(params, "angle", 60));
  const c = tint(params, [0, 0, 0, 255]);
  const radians = f3216(angle * DEG_TO_RAD_F);
  const shiftX = roundHalfAway(f3216(f3216(Math.cos(radians)) * distance));
  const shiftY = roundHalfAway(f3216(f3216(Math.sin(radians)) * distance));
  const mask2 = alphaMask(image);
  const spreadRadius = Math.max(0, roundHalfAway(f3216(blur2 * spreadValue)));
  if (spreadRadius > 0) spread(mask2, w, h, spreadRadius);
  const shifted = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = y - shiftY;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x += 1) {
      const sx = x - shiftX;
      if (sx >= 0 && sx < w) shifted[y * w + x] = mask2[sy * w + sx];
    }
  }
  if (blur2 > 0) boxBlur2(shifted, w, h, blur2, 3);
  const out = createPremul(w, h);
  for (let i = 0; i < shifted.length; i += 1) {
    const alpha = clampf3(f3216(f3216(shifted[i] * opacity) * c.a), 0, 1);
    if (alpha <= 0) continue;
    overlayPixel(out.data, i * 4, c.r, c.g, c.b, alpha);
  }
  sourceOver2(out, image);
  return out;
}
function glowKernel(image, params) {
  const w = image.width;
  const h = image.height;
  if (w <= 0 || h <= 0) return;
  const outer = int(params, "mode", 0) === 0;
  const opacity = clampf3(f3216(num(params, "opacity", 0.45)), 0, 1);
  const blur2 = Math.max(0, getInt(num(params, "blur_radius", 20)));
  const spreadValue = clampf3(f3216(num(params, "spread", 0.1)), 0, 1);
  const c = tint(params, [255, 244, 194, 255]);
  const mask2 = alphaMask(image);
  const spreadRadius = Math.max(0, roundHalfAway(f3216(blur2 * spreadValue)));
  if (spreadRadius > 0) spread(mask2, w, h, spreadRadius);
  const overlay = createPremul(w, h);
  if (outer) {
    const blurred = new Float32Array(mask2);
    if (blur2 > 0) boxBlur2(blurred, w, h, blur2, 3);
    for (let i = 0; i < blurred.length; i += 1) {
      const alpha = clampf3(f3216(f3216(blurred[i] * opacity) * c.a), 0, 1);
      overlayPixel(overlay.data, i * 4, c.r, c.g, c.b, alpha);
    }
    sourceOver2(overlay, image);
    return overlay;
  }
  const inverse = new Float32Array(mask2.length);
  for (let i = 0; i < mask2.length; i += 1) inverse[i] = 1 - mask2[i];
  if (blur2 > 0) boxBlur2(inverse, w, h, blur2, 3);
  for (let i = 0; i < inverse.length; i += 1) {
    const alpha = clampf3(f3216(f3216(f3216(inverse[i] * mask2[i]) * opacity) * c.a), 0, 1);
    overlayPixel(overlay.data, i * 4, c.r, c.g, c.b, alpha);
  }
  sourceOver2(image, overlay);
}
var shadow = { type: "Shadow", supported: true, run: shadowKernel };
var glow = { type: "Glow", supported: true, run: glowKernel };

// ../engine/src/render/qt/convert.ts
var f3217 = Math.fround;
var F322 = new Float32Array(1);
var U322 = new Uint32Array(F322.buffer);
function frecpe(a) {
  F322[0] = a;
  const bits2 = U322[0];
  const exp = bits2 >>> 23 & 255;
  const scaled = 256 + ((bits2 & 8388607) >>> 15);
  const r = Math.floor(524288 / (scaled * 2 + 1)) + 1 >> 1;
  U322[0] = 253 - exp << 23 | (r & 255) << 15;
  return F322[0];
}
var NEON_INV_ALPHA = (() => {
  const t = new Float64Array(256);
  for (let a = 1; a < 256; a += 1) {
    const e = frecpe(a);
    t[a] = f3217((2 - a * e) * f3217(e * 255));
  }
  return t;
})();
function invPremulFactor(a) {
  return Math.floor(16711935 / a);
}
function unpremultiplyNeon(image) {
  const w = image.width;
  const s = image.data;
  const out = new Uint8ClampedArray(s.length);
  for (let y = 0; y < image.height; y += 1) {
    const row = y * w * 4;
    let x = 0;
    for (; x < w - 3; x += 4) {
      const o = row + x * 4;
      const sum = s[o + 3] + s[o + 7] + s[o + 11] + s[o + 15];
      if (sum === 0) continue;
      if (sum === 1020) {
        out.set(s.subarray(o, o + 16), o);
        continue;
      }
      for (let k = 0; k < 16; k += 4) {
        const a = s[o + k + 3];
        if (a === 0) continue;
        const ia = NEON_INV_ALPHA[a];
        for (let c = 0; c < 3; c += 1) out[o + k + c] = Math.trunc(2 * f3217(s[o + k + c] * ia)) + 1 >> 1 & 255;
        out[o + k + 3] = a;
      }
    }
    for (; x < w; x += 1) {
      const o = row + x * 4;
      const a = s[o + 3];
      if (a === 0) continue;
      if (a === 255) {
        out.set(s.subarray(o, o + 4), o);
        continue;
      }
      const inv = invPremulFactor(a);
      for (let c = 0; c < 3; c += 1) out[o + c] = Math.floor((s[o + c] * inv + 32768) / 65536) & 255;
      out[o + 3] = a;
    }
  }
  return out;
}

// ../engine/src/render/kernels/sharpen.ts
var f3218 = Math.fround;
function boxesForGauss(sigma) {
  const n = 3;
  const wi = Math.sqrt(12 * sigma * sigma / n + 1);
  let wl = Math.floor(wi);
  if (!(wl & 1)) wl -= 1;
  const wu = wl + 2;
  const mi = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.trunc(roundHalfAway(mi));
  const b = [0, 0, 0];
  for (let i = 0; i < n; i += 1) b[i] = i < m ? wl : wu;
  return b;
}
function blurAxis(src, dst, w, h, r, vertical) {
  if (r <= 0) {
    for (let c = 0; c < 3; c += 1) dst[c].set(src[c]);
    return;
  }
  const invW = f3218(1 / (2 * r + 1));
  for (let c = 0; c < 3; c += 1) {
    const s = src[c];
    const o = dst[c];
    if (!vertical) {
      for (let y = 0; y < h; y += 1) {
        const row = y * w;
        let sum = s[row] * (r + 1);
        for (let x = 1; x <= r; x += 1) sum += s[row + Math.min(x, w - 1)];
        for (let x = 0; x < w; x += 1) {
          o[row + x] = Math.trunc(f3218(sum * invW + 0.5)) & 255;
          sum += s[row + Math.min(x + r + 1, w - 1)] - s[row + Math.max(x - r, 0)];
        }
      }
    } else {
      for (let x = 0; x < w; x += 1) {
        let sum = s[x] * (r + 1);
        for (let y = 1; y <= r; y += 1) sum += s[Math.min(y, h - 1) * w + x];
        for (let y = 0; y < h; y += 1) {
          o[y * w + x] = Math.trunc(f3218(sum * invW + 0.5)) & 255;
          sum += s[Math.min(y + r + 1, h - 1) * w + x] - s[Math.max(y - r, 0) * w + x];
        }
      }
    }
  }
}
function gaussBlur(planes, w, h, sigma) {
  const boxes = boxesForGauss(sigma);
  const t1 = [0, 1, 2].map(() => new Float64Array(w * h));
  const t2 = [0, 1, 2].map(() => new Float64Array(w * h));
  let src = planes;
  for (const b of boxes) {
    const r = Math.floor(0.5 * (b - 1));
    blurAxis(src, t1, w, h, r, false);
    blurAxis(t1, t2, w, h, r, true);
    src = t2;
  }
  return src;
}
var W_B = f3218(0.114);
var W_G = f3218(0.587);
var W_R = f3218(0.299);
function lumaDetail(dB, dG, dR) {
  return f3218(dR * W_R + f3218(dB * W_B + f3218(dG * W_G)));
}
var sharpen = {
  type: "Sharpen",
  supported: true,
  customMaskBlend: true,
  run(image, params) {
    const W = image.width;
    const H = image.height;
    if (W <= 0 || H <= 0) return;
    const amt = num(params, "amount", 10);
    const rpx = num(params, "radius", 3);
    const thrUI = num(params, "threshold", 0);
    const mode = int(params, "mode", 0);
    const channel = int(params, "channel", 1);
    if (amt === 0 || rpx <= 0) return;
    const sigma = Math.max(0.1, rpx * H / 720);
    const n = W * H;
    const d = image.data;
    const straight = unpremultiplyNeon(image);
    const planes = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    const alpha = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) {
      alpha[p] = d[p * 4 + 3];
      planes[0][p] = straight[p * 4 + 2];
      planes[1][p] = straight[p * 4 + 1];
      planes[2][p] = straight[p * 4];
    }
    const blurred = gaussBlur(planes, W, H, sigma);
    let maxDY = 0;
    if (thrUI > 0) {
      for (let p = 0; p < n; p += 1) {
        const dB = f3218(planes[0][p] - blurred[0][p]);
        const dG = f3218(planes[1][p] - blurred[1][p]);
        const dR = f3218(planes[2][p] - blurred[2][p]);
        const dY = Math.abs(lumaDetail(dB, dG, dR));
        if (dY > maxDY) maxDY = dY;
      }
    }
    const thr = f3218(f3218(thrUI) * maxDY);
    const famt = f3218(amt);
    const wB = W_B;
    const wG = W_G;
    const wR = W_R;
    const halo = (v) => f3218(f3218(255 - Math.abs(v)) * f3218(1 / 255));
    const outC = [0, 0, 0];
    for (let p = 0; p < n; p += 1) {
      const sB = planes[0][p];
      const sG = planes[1][p];
      const sR = planes[2][p];
      const bB = blurred[0][p];
      const bG = blurred[1][p];
      const bR = blurred[2][p];
      const dB = f3218(sB - bB);
      const dG = f3218(sG - bG);
      const dR = f3218(sR - bR);
      const dY = lumaDetail(dB, dG, dR);
      if (Math.abs(dY) < thr) continue;
      if (mode === 1) {
        if (channel === 1) {
          const inc = f3218(famt * dY);
          outC[0] = f3218(bB + f3218(inc * wB));
          outC[1] = f3218(bG + f3218(inc * wG));
          outC[2] = f3218(bR + f3218(inc * wR));
        } else if (channel === 2) {
          outC[0] = f3218(bB + f3218(famt * f3218(dB - f3218(dY * wB))));
          outC[1] = f3218(bG + f3218(famt * f3218(dG - f3218(dY * wG))));
          outC[2] = f3218(bR + f3218(famt * f3218(dR - f3218(dY * wR))));
        } else {
          outC[0] = f3218(bB + f3218(famt * dB));
          outC[1] = f3218(bG + f3218(famt * dG));
          outC[2] = f3218(bR + f3218(famt * dR));
        }
      } else if (channel === 1) {
        const inc = f3218(f3218(famt * dY) * halo(dY));
        outC[0] = f3218(sB + inc);
        outC[1] = f3218(sG + inc);
        outC[2] = f3218(sR + inc);
      } else if (channel === 2) {
        const cB = f3218(dB - dY);
        const cG = f3218(dG - dY);
        const cR = f3218(dR - dY);
        outC[0] = f3218(sB + f3218(f3218(famt * cB) * halo(cB)));
        outC[1] = f3218(sG + f3218(f3218(famt * cG) * halo(cG)));
        outC[2] = f3218(sR + f3218(f3218(famt * cR) * halo(cR)));
      } else {
        outC[0] = f3218(sB + f3218(f3218(famt * dB) * halo(dB)));
        outC[1] = f3218(sG + f3218(f3218(famt * dG) * halo(dG)));
        outC[2] = f3218(sR + f3218(f3218(famt * dR) * halo(dR)));
      }
      planes[0][p] = Math.trunc(f3218(Math.min(255, Math.max(0, outC[0])) + 0.5));
      planes[1][p] = Math.trunc(f3218(Math.min(255, Math.max(0, outC[1])) + 0.5));
      planes[2][p] = Math.trunc(f3218(Math.min(255, Math.max(0, outC[2])) + 0.5));
    }
    for (let p = 0; p < n; p += 1) {
      const a = alpha[p];
      d[p * 4] = byteMul(planes[2][p], a);
      d[p * 4 + 1] = byteMul(planes[1][p], a);
      d[p * 4 + 2] = byteMul(planes[0][p], a);
    }
  }
};

// ../engine/src/render/kernels/spherical.ts
var DEG = Math.PI / 180;
var HALF_PI = Math.PI / 2;
var TWO_PI3 = 2 * Math.PI;
var STATE_KEY2 = "SphericalProjection.uv";
function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function clamp(v, lo, hi) {
  return v < lo ? lo : hi < v ? hi : v;
}
function readSetup(w, h, params) {
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
    interpolation: clampInt(int(params, "interpolation", 3), 0, 3)
  };
}
function sameMap(a, b) {
  const q = (x) => roundHalfAway(x * 1e6);
  return a.w === b.w && a.h === b.h && q(a.yaw) === q(b.yaw) && q(a.pitch) === q(b.pitch) && q(a.roll) === q(b.roll) && q(a.inFov) === q(b.inFov) && q(a.outFov) === q(b.outFov) && a.inputModel === b.inputModel && a.projectionMode === b.projectionMode && a.invert === b.invert;
}
function projectInput(s, lens, dx, dy, dz, uv, o) {
  if (s.inputModel === 0) {
    let lon = Math.atan2(dx, -dz);
    const lat = Math.asin(clamp(dy, -1, 1));
    const hemi = s.projectionMode === 1;
    if (hemi) lon = clamp(lon, -HALF_PI, HALF_PI);
    uv[o] = (lon + (hemi ? HALF_PI : Math.PI)) / (hemi ? Math.PI : TWO_PI3) * s.w;
    uv[o + 1] = (HALF_PI - lat) / Math.PI * s.h;
    return;
  }
  const theta = Math.acos(clamp(dz * lens.az, -1, 1));
  let rNorm;
  if (s.inputModel === 2) rNorm = Math.sin(theta * 0.5) / lens.sinHalfTmax;
  else if (s.inputModel === 3) rNorm = Math.tan(theta * 0.5) / lens.tanHalfTmax;
  else if (s.inputModel === 4) rNorm = Math.sin(theta) / lens.sinTmax;
  else rNorm = theta / lens.tmax;
  const phi = Math.atan2(dy, dx);
  const rpx = rNorm * lens.radius;
  uv[o] = s.w * 0.5 + rpx * Math.cos(phi);
  uv[o + 1] = s.h * 0.5 - rpx * Math.sin(phi);
}
function buildUvMap(s) {
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
  const vy = hx * H / W;
  const cR = Math.cos(s.roll);
  const sR = Math.sin(s.roll) * rollSign;
  const tmax = Math.max(1e-6, s.inFov * 0.5);
  const lens = {
    az: s.invert === 1 ? 1 : -1,
    tmax,
    sinHalfTmax: Math.max(1e-12, Math.sin(tmax * 0.5)),
    tanHalfTmax: Math.max(1e-12, Math.tan(tmax * 0.5)),
    sinTmax: Math.max(1e-12, Math.sin(tmax)),
    radius: 0.5 * Math.min(W, H)
  };
  const fisheye = s.projectionMode >= 2;
  const thetaMax = s.outFov * 0.5;
  const sinHalfThetaMax = Math.sin(thetaMax * 0.5);
  const tanHalfThetaMax = Math.tan(thetaMax * 0.5);
  const sinThetaMax = Math.sin(thetaMax);
  const R = 0.5 * Math.min(W, H);
  for (let yy = 0; yy < H; yy += 1) {
    if (!fisheye) {
      const syUp = -((2 * (yy + 0.5) / H - 1) * vy);
      const sRsy = sR * syUp;
      const cRsy = cR * syUp;
      for (let xx = 0; xx < W; xx += 1) {
        const sx = (2 * (xx + 0.5) / W - 1) * hx;
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
      let theta;
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
var NEAR_BOUNDARY = 1e-7;
function nearHalf(v) {
  return Math.abs(v - Math.floor(v) - 0.5) <= NEAR_BOUNDARY;
}
function bilinearByte(p00, p10, p01, p11, dxr, dyr) {
  const ix = 1 - dxr;
  const iy = 1 - dyr;
  const v = (p00 * ix + p10 * dxr) * iy + (p01 * ix + p11 * dxr) * dyr;
  if (!nearHalf(v)) return Math.trunc(v + 0.5);
  const v0 = fma2(p00, ix, p10 * dxr);
  const v1 = fma2(p01, ix, p11 * dxr);
  return Math.trunc(fma2(v0, iy, v1 * dyr) + 0.5);
}
function cubic(p0, p1, p2, p3, t) {
  const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const a1 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const a2 = -0.5 * p0 + 0.5 * p2;
  return ((a0 * t + a1) * t + a2) * t + p1;
}
function cubicFused(p0, p1, p2, p3, t) {
  const a0 = fma2(p3, 0.5, fma2(p2, -1.5, fma2(p0, -0.5, p1 * 1.5)));
  const a1 = fma2(p3, -0.5, fma2(p2, 2, fma2(p1, -2.5, p0)));
  const a2 = fma2(p0, -0.5, p2 * 0.5);
  return fma2(fma2(fma2(a0, t, a1), t, a2), t, p1);
}
var TAPS = new Int32Array(8);
function setTaps(W, H, x1, y1) {
  for (let k = 0; k < 4; k += 1) {
    TAPS[k] = clampInt(y1 + k - 1, 0, H - 1) * W * 4;
    TAPS[4 + k] = clampInt(x1 + k - 1, 0, W - 1) * 4;
  }
}
function bicubicValue(data, c, tx, ty) {
  const x0 = TAPS[4] + c;
  const x1 = TAPS[5] + c;
  const x2 = TAPS[6] + c;
  const x3 = TAPS[7] + c;
  let y = TAPS[0];
  const c0 = cubic(data[y + x0], data[y + x1], data[y + x2], data[y + x3], tx);
  y = TAPS[1];
  const c1 = cubic(data[y + x0], data[y + x1], data[y + x2], data[y + x3], tx);
  y = TAPS[2];
  const c2 = cubic(data[y + x0], data[y + x1], data[y + x2], data[y + x3], tx);
  y = TAPS[3];
  const c3 = cubic(data[y + x0], data[y + x1], data[y + x2], data[y + x3], tx);
  return cubic(c0, c1, c2, c3, ty);
}
function bicubicValueFused(data, c, tx, ty) {
  const col = [0, 0, 0, 0];
  for (let k = 0; k < 4; k += 1) {
    const y = TAPS[k];
    col[k] = cubicFused(data[y + TAPS[4] + c], data[y + TAPS[5] + c], data[y + TAPS[6] + c], data[y + TAPS[7] + c], tx);
  }
  return cubicFused(col[0], col[1], col[2], col[3], ty);
}
function buildMipmaps(base) {
  const levels = [base];
  for (let level = 1; level < 4; level += 1) {
    const prev = levels[level - 1];
    if (prev.w <= 1 || prev.h <= 1) break;
    const w = Math.trunc(prev.w / 2);
    const h = Math.trunc(prev.h / 2);
    const data = new Uint8ClampedArray(w * h * 4);
    const p = prev.data;
    const pw = prev.w * 4;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = 2 * y * pw + 2 * x * 4;
        for (let c = 0; c < 4; c += 1) data[(y * w + x) * 4 + c] = p[o + c] + p[o + 4 + c] + p[o + pw + c] + p[o + pw + 4 + c] >> 2;
      }
    }
    levels.push({ w, h, data });
  }
  return levels;
}
function bilinearPixel(plane, uf, vf, out, o) {
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
  for (let c = 0; c < 4; c += 1) out[o + c] = bilinearByte(data[i00 + c], data[i10 + c], data[i01 + c], data[i11 + c], dxr, dyr);
}
function sphericalKernel(image, params, ctx) {
  const W = image.width;
  const H = image.height;
  if (W <= 0 || H <= 0) return;
  const setup = readSetup(W, H, params);
  const cached2 = ctx.state?.get(STATE_KEY2);
  let map;
  if (cached2 && sameMap(cached2.setup, setup)) {
    map = cached2;
  } else {
    map = { setup, uv: buildUvMap(setup) };
    ctx.state?.set(STATE_KEY2, map);
  }
  const uv = map.uv;
  let sampler = setup.interpolation;
  if (sampler === 3) {
    const coverage = setup.projectionMode === 0 ? TWO_PI3 : setup.projectionMode === 1 ? Math.PI : setup.inFov;
    const ratio = W / setup.outFov / (W / coverage);
    sampler = ratio < 0.8 ? 3 : ratio <= 1.2 ? 1 : 2;
  }
  const src = { w: W, h: H, data: unpremultiplyNeon(image) };
  const mipmaps = sampler === 3 ? buildMipmaps(src) : [src];
  const out = new Uint8ClampedArray(W * H * 4);
  const wrapU = setup.inputModel === 0 && setup.projectionMode === 0;
  const clampUv = setup.inputModel === 0 && setup.projectionMode === 1;
  for (let yy = 0; yy < H; yy += 1) {
    for (let xx = 0; xx < W; xx += 1) {
      const idx = 2 * (yy * W + xx);
      let uf = uv[idx];
      let vf = uv[idx + 1];
      const o = (yy * W + xx) * 4;
      if (wrapU) {
        uf = (uf % W + W) % W;
        vf = clamp(vf, 0, H - 1);
      } else if (clampUv) {
        uf = clamp(uf, 0, W - 1);
        vf = clamp(vf, 0, H - 1);
      } else if (uf < 0 || uf >= W || vf < 0 || vf >= H) {
        continue;
      }
      if (sampler === 0) {
        const s = (clampInt(Math.floor(vf), 0, H - 1) * W + clampInt(Math.floor(uf), 0, W - 1)) * 4;
        out[o] = src.data[s];
        out[o + 1] = src.data[s + 1];
        out[o + 2] = src.data[s + 2];
        out[o + 3] = src.data[s + 3];
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
        let ufDx = 0;
        let vfDx = 0;
        let ufDy = 0;
        let vfDy = 0;
        if (xx + 1 < W) {
          ufDx = uv[idx + 2] - uf;
          vfDx = uv[idx + 3] - vf;
        }
        if (yy + 1 < H) {
          ufDy = uv[idx + 2 * W] - uf;
          vfDy = uv[idx + 2 * W + 1] - vf;
        }
        const scaleX = Math.sqrt(ufDx * ufDx + vfDx * vfDx);
        const scaleY = Math.sqrt(ufDy * ufDy + vfDy * vfDy);
        const scale = scaleX < scaleY ? scaleY : scaleX;
        const level = scale > 1 ? Math.min(Math.floor(Math.log2(scale)), mipmaps.length - 1) : 0;
        const div = 1 << level;
        bilinearPixel(mipmaps[level], uf / div, vf / div, out, o);
      }
    }
  }
  const result = createPremul(W, H);
  const r = result.data;
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0) continue;
    if (a === 255) {
      r[i] = out[i];
      r[i + 1] = out[i + 1];
      r[i + 2] = out[i + 2];
      r[i + 3] = 255;
      continue;
    }
    r[i] = byteMul(out[i], a);
    r[i + 1] = byteMul(out[i + 1], a);
    r[i + 2] = byteMul(out[i + 2], a);
    r[i + 3] = a;
  }
  return result;
}
var sphericalProjection = { type: "SphericalProjection", supported: true, run: sphericalKernel };

// ../engine/src/render/kernels/timer.ts
var TimerMode = { CountUp: 0, CountDown: 1, Clock: 2, Timecode: 3, FrameNumber: 4 };
var TimerTimeSource = { Clip: 0, Source: 1 };
var TimerFormat = { MmSs: 0, HhMmSs: 1, HhMmSsMs: 2, Timecode: 3, Frames: 4 };
var Gravity = { TopLeft: 0, Top: 1, TopRight: 2, Left: 3, Center: 4, Right: 5, BottomLeft: 6, Bottom: 7, BottomRight: 8 };
function clampGravity(g) {
  return g < Gravity.TopLeft || g > Gravity.BottomRight ? Gravity.Bottom : g;
}
function timerSettings(params) {
  return {
    mode: int(params, "mode", TimerMode.CountUp),
    timeSource: int(params, "time_source", TimerTimeSource.Source),
    format: int(params, "format", TimerFormat.MmSs),
    clamp: int(params, "clamp", 1) !== 0,
    gravity: clampGravity(int(params, "gravity", Gravity.Bottom)),
    showBackground: int(params, "show_background", 1) !== 0,
    fontName: str(params, "font_name", "sans"),
    prefix: str(params, "prefix", ""),
    suffix: str(params, "suffix", "")
  };
}
function resolveTimerFps(timeSource, ctx) {
  const reader = ctx.clip && ctx.clip.readerFps > 0 ? ctx.clip.readerFps : 0;
  if (timeSource === TimerTimeSource.Source && reader > 0) return reader;
  const timeline = ctx.fps && ctx.fps.den !== 0 ? ctx.fps.num / ctx.fps.den : 0;
  if (timeline > 0) return timeline;
  if (reader > 0) return reader;
  return 30;
}
function effectiveTimerFrame(timeSource, ctx) {
  if (timeSource === TimerTimeSource.Source && ctx.clip) return Math.max(1, ctx.clip.mappedFrame);
  return Math.max(1, ctx.frame);
}
function countdownDuration(params, ctx) {
  const configured = num(params, "end_time", 0);
  if (configured > 0) return configured;
  if (ctx.clip) return Math.max(0, Math.fround(ctx.clip.duration));
  return 0;
}
function timerSeconds(params, ctx, settings = timerSettings(params)) {
  const fps = resolveTimerFps(settings.timeSource, ctx);
  const elapsed = (effectiveTimerFrame(settings.timeSource, ctx) - 1) / fps;
  const start = num(params, "start_time", 0);
  if (settings.mode === TimerMode.CountDown) return countdownDuration(params, ctx) - start - elapsed;
  return start + elapsed;
}
function pad(n, width) {
  return String(n).padStart(width, "0");
}
function formatTimecode(seconds, fps) {
  const negative = seconds < 0;
  const totalFrames = roundHalfAway(Math.abs(seconds) * fps);
  const roundedFps = Math.max(1, roundHalfAway(fps));
  const frames = totalFrames % roundedFps;
  const totalSeconds = Math.floor(totalFrames / roundedFps);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${negative ? "-" : ""}${pad(hours, 2)}:${pad(mins, 2)}:${pad(secs, 2)}:${pad(frames, 2)}`;
}
function formatSeconds(seconds, fps, durationStyle, format, clamp2) {
  let s = seconds;
  if (durationStyle && clamp2 && s < 0) s = 0;
  const negative = s < 0;
  const totalMs = roundHalfAway(Math.abs(s) * 1e3);
  const ms = totalMs % 1e3;
  const totalSeconds = Math.floor(totalMs / 1e3);
  const hours = Math.trunc(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const wholeSeconds = totalSeconds % 60;
  const sign = negative ? "-" : "";
  if (format === TimerFormat.HhMmSsMs) return `${sign}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}.${pad(ms, 3)}`;
  if (format === TimerFormat.HhMmSs) return `${sign}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}`;
  if (format === TimerFormat.Timecode) return sign + formatTimecode(s, fps);
  if (format === TimerFormat.Frames) return sign + String(roundHalfAway(s * fps));
  return `${sign}${pad(hours * 60 + minutes, 2)}:${pad(wholeSeconds, 2)}`;
}
function usesFrames(settings) {
  return settings.mode === TimerMode.FrameNumber || settings.format === TimerFormat.Frames;
}
function usesTimecode(settings) {
  return settings.mode === TimerMode.Timecode || settings.format === TimerFormat.Timecode;
}
function timerText(params, ctx, settings = timerSettings(params)) {
  const fps = resolveTimerFps(settings.timeSource, ctx);
  let value;
  if (usesFrames(settings)) {
    const offset = roundHalfAway(num(params, "start_time", 0) * fps);
    value = String(effectiveTimerFrame(settings.timeSource, ctx) + offset);
  } else if (usesTimecode(settings)) {
    value = formatTimecode(timerSeconds(params, ctx, settings), fps);
  } else if (settings.mode === TimerMode.Clock) {
    let seconds = timerSeconds(params, ctx, settings) % 86400;
    if (seconds < 0) seconds += 86400;
    value = formatSeconds(seconds, fps, false, settings.format, settings.clamp);
  } else {
    value = formatSeconds(timerSeconds(params, ctx, settings), fps, true, settings.format, settings.clamp);
  }
  return settings.prefix + value + settings.suffix;
}
function timerLayoutText(params, ctx, settings = timerSettings(params)) {
  if (usesFrames(settings)) return timerText(params, ctx, settings);
  let template = "88:88";
  if (usesTimecode(settings)) template = "88:88:88:88";
  else if (settings.format === TimerFormat.HhMmSsMs) template = "88:88:88.888";
  else if (settings.format === TimerFormat.HhMmSs) template = "88:88:88";
  return settings.prefix + template + settings.suffix;
}
function clampAlpha(v) {
  const m = v < 1 ? v : 1;
  return 0 < m ? m : 0;
}
var DIGIT = new RegExp("^\\p{Nd}$", "u");
function layoutTimer(params, width, height, ctx, measure) {
  const settings = timerSettings(params);
  const scale = width / 600;
  const fontSizeValue = Math.max(1, num(params, "font_size", 48) * scale);
  const strokeWidthValue = Math.max(0, num(params, "stroke_width", 2) * scale);
  const paddingValue = Math.max(0, num(params, "background_padding", 14) * scale);
  const cornerValue = Math.max(0, num(params, "background_corner", 6) * scale);
  const text2 = timerText(params, ctx, settings);
  const layoutText = timerLayoutText(params, ctx, settings);
  const font = { family: settings.fontName, pixelSize: Math.trunc(fontSizeValue) };
  const tight = (s) => {
    const ink = s.length > 0 ? measure.inkBounds(s, font) : { x: 0, y: 0, width: 0, height: 0 };
    if (!isEmptyRect(ink)) return ink;
    return s.length > 0 ? measure.bounds(s, font) : { x: 0, y: 0, width: 0, height: 0 };
  };
  const textBounds = tight(text2);
  const layoutBounds = tight(layoutText);
  const textWidth = Math.max(1, textBounds.width);
  const textHeight = Math.max(1, textBounds.height);
  let digitSlotWidth = 0;
  for (let digit = 0; digit <= 9; digit += 1) digitSlotWidth = Math.max(digitSlotWidth, measure.advance(String(digit), font));
  const slotLayout = text2.length === layoutText.length && !usesFrames(settings);
  const slotWidths = [];
  let layoutWidth = 0;
  if (slotLayout) {
    for (let index = 0; index < layoutText.length; index += 1) {
      const ch = layoutText[index];
      const slot = DIGIT.test(ch) ? digitSlotWidth : measure.advance(ch, font);
      slotWidths.push(slot);
      layoutWidth += slot;
    }
  } else {
    layoutWidth = Math.max(textWidth, layoutBounds.width);
  }
  layoutWidth = Math.max(1, layoutWidth);
  const boxWidth = layoutWidth + paddingValue * 2;
  const boxHeight = Math.max(textHeight, layoutBounds.height) + paddingValue * 2;
  const g = settings.gravity;
  const column = g % 3;
  const row = Math.floor(g / 3);
  let x = paddingValue;
  let y = 0;
  if (column === 1) x = (width - boxWidth) / 2;
  else if (column === 2) x = width - boxWidth - paddingValue;
  if (row === 1) y = (height - boxHeight) / 2;
  else if (row === 2) y = height - boxHeight;
  x = roundHalfAway(fusedMulAdd(width, num(params, "x_offset", 0) / 100, x));
  y = roundHalfAway(fusedMulAdd(height, num(params, "y_offset", 0) / 100, y));
  let textX = x + paddingValue - textBounds.x;
  if (column === 1) textX = x + paddingValue + (layoutWidth - textWidth) / 2 - textBounds.x;
  else if (column === 2) textX = x + paddingValue + layoutWidth - textWidth - textBounds.x;
  textX = roundHalfAway(textX);
  const textY = roundHalfAway(y + paddingValue - textBounds.y);
  const runs = [];
  if (slotLayout) {
    let cursorX = x + paddingValue;
    for (let index = 0; index < text2.length; index += 1) {
      const ch = text2[index];
      const charBounds = tight(ch);
      const charX = roundHalfAway(cursorX);
      runs.push({ text: ch, x: charX - charBounds.x, y: textY, ink: measure.inkBounds(ch, font) });
      cursorX += slotWidths[index];
    }
  } else {
    runs.push({ text: text2, x: textX, y: textY, ink: text2.length > 0 ? measure.inkBounds(text2, font) : { x: 0, y: 0, width: 0, height: 0 } });
  }
  const fontAlpha = clampAlpha(num(params, "font_alpha", 1));
  return {
    font,
    text: text2,
    layoutText,
    slotLayout,
    box: { x, y, width: boxWidth, height: boxHeight },
    cornerRadius: cornerValue,
    showBackground: settings.showBackground,
    backgroundColor: hexColor(color(params, "background", [0, 0, 0, 255])),
    backgroundAlpha: clampAlpha(num(params, "background_alpha", 0.45)),
    textColor: hexColor(color(params, "color", [255, 255, 255, 255])),
    strokeColor: hexColor(color(params, "stroke", [0, 0, 0, 255])),
    textAlpha: fontAlpha,
    strokeWidth: strokeWidthValue,
    runs
  };
}
function paintTimer(image, layout, ctx) {
  const region = imageRegion(image.width, image.height);
  if (layout.showBackground) {
    const a2 = alpha16(layout.backgroundAlpha);
    if (a2 > 0) fillRoundedRect(image, layout.box, layout.cornerRadius, solidPremul(layout.backgroundColor, a2), region);
  }
  const raster = ctx.text;
  const a = alpha16(layout.textAlpha);
  if (!raster || a === 0) return;
  const fill = straightColor(layout.textColor, a);
  const stroke = layout.strokeWidth > 0 ? straightColor(layout.strokeColor, a) : null;
  if (!layout.slotLayout) {
    const run = layout.runs[0];
    drawTextPath(image, raster, run.text, run.x, run.y, layout.font, run.ink, fill, stroke, layout.strokeWidth, region);
    return;
  }
  for (const run of layout.runs) drawTextPath(image, raster, run.text, run.x, run.y, layout.font, run.ink, fill, null, 0, region);
  if (!stroke) return;
  const clear2 = [fill[0], fill[1], fill[2], 0];
  for (const run of layout.runs) drawTextPath(image, raster, run.text, run.x, run.y, layout.font, run.ink, clear2, stroke, layout.strokeWidth, region);
}
var timer = {
  type: "Timer",
  supported: true,
  run(image, params, ctx) {
    if (image.width <= 0 || image.height <= 0) return;
    const layout = layoutTimer(params, image.width, image.height, ctx, ctx.text ?? approximateMetrics);
    paintTimer(image, layout, ctx);
  }
};

// ../engine/src/render/kernels/registry.ts
function unsupported(type) {
  return { type, supported: false, run: () => void 0 };
}
var SPECS = [
  brightness,
  saturation,
  hue,
  negate,
  blur,
  pixelate,
  crop,
  shift,
  colorShift,
  wave,
  deinterlace,
  bars,
  chromaKey,
  sharpen,
  mask,
  colorMap,
  colorGrade,
  filmGrain,
  denoiseImage,
  shadow,
  glow,
  lensFlare,
  displace,
  sphericalProjection,
  analogTape,
  audioVisualization,
  beatSync,
  caption,
  timer,
  unsupported("Outline"),
  unsupported("Stabilizer"),
  unsupported("Tracker"),
  unsupported("ObjectDetection"),
  unsupported("ObjectMask")
];
var BY_TYPE = /* @__PURE__ */ new Map();
function registerKernels(specs) {
  for (const spec of specs) BY_TYPE.set(spec.type, spec);
}
registerKernels(SPECS);
function processEffect(image, effect, ctx) {
  const spec = BY_TYPE.get(effect.type);
  if (!spec || !spec.supported) return image;
  const kctx = ctx.frame === effect.frame ? ctx : { ...ctx, frame: effect.frame };
  const params = effect.params;
  const maskPath = spec.handlesMask ? void 0 : readerPath(params, "mask_reader");
  const maskSource = maskPath ? ctx.images.get(maskPath) : void 0;
  if (!maskSource) return spec.run(image, params, kctx) ?? image;
  const original = clonePremul(image);
  const out = spec.run(image, params, kctx) ?? image;
  if (out.width !== original.width || out.height !== original.height || out.width === 0 || out.height === 0) return out;
  const maskImage = scaledPremul(maskSource, out.width, out.height, ctx.imageSizes?.[maskPath]);
  const invert = bool(params, "mask_invert", false);
  if (spec.customMaskBlend && int(params, "mask_mode", 0) === 1) blendVaryStrength(original, out, maskImage, invert);
  else blendWithMask(original, out, maskImage, invert);
  return out;
}

// ../engine/src/render/qt/path.ts
var MoveTo = 0;
var LineTo = 1;
var CurveTo = 2;
var CurveToData = 3;
var KAPPA3 = 0.5522847498;
function ellipsePoint(r, angle) {
  const w2 = r.w / 2;
  const h2 = r.h / 2;
  const theta = angle - 360 * Math.floor(angle / 360);
  const quadrant = Math.trunc(theta / 90);
  if (theta / 90 - quadrant !== 0) throw new RangeError("ellipsePoint: angle must be a multiple of 90");
  const t = quadrant & 1 ? 1 : 0;
  let px = t === 0 ? 1 : 0;
  let py = t === 0 ? 0 : 1;
  if (quadrant === 1 || quadrant === 2) px = -px;
  if (quadrant === 0 || quadrant === 1) py = -py;
  return [r.x + r.w / 2 + w2 * px, r.y + r.h / 2 + h2 * py];
}
var PainterPath = class {
  /** A new QPainterPathData starts with MoveTo(0, 0). */
  elements = [{ type: MoveTo, x: 0, y: 0 }];
  cStart = 0;
  requireMoveTo = false;
  last() {
    return this.elements[this.elements.length - 1];
  }
  maybeMoveTo() {
    if (this.requireMoveTo) {
      const e = this.last();
      this.elements.push({ type: MoveTo, x: e.x, y: e.y });
      this.requireMoveTo = false;
    }
  }
  isEmpty() {
    return this.elements.length === 1 && this.elements[0].type === MoveTo;
  }
  moveTo(x, y) {
    this.requireMoveTo = false;
    const last = this.last();
    if (last.type === MoveTo) {
      last.x = x;
      last.y = y;
    } else this.elements.push({ type: MoveTo, x, y });
    this.cStart = this.elements.length - 1;
  }
  lineTo(x, y) {
    this.maybeMoveTo();
    const last = this.last();
    if (last.x === x && last.y === y) return;
    this.elements.push({ type: LineTo, x, y });
  }
  cubicTo(c1x, c1y, c2x, c2y, ex, ey) {
    const last = this.last();
    if (last.x === c1x && last.y === c1y && c1x === c2x && c1y === c2y && c2x === ex && c2y === ey) return;
    this.maybeMoveTo();
    this.elements.push({ type: CurveTo, x: c1x, y: c1y }, { type: CurveToData, x: c2x, y: c2y }, { type: CurveToData, x: ex, y: ey });
  }
  closeSubpath() {
    if (this.isEmpty()) return;
    this.requireMoveTo = true;
    const first = this.elements[this.cStart];
    const last = this.last();
    if (first.x !== last.x || first.y !== last.y) {
      if (fuzzyCompare3(first.x, last.x) && fuzzyCompare3(first.y, last.y)) {
        last.x = first.x;
        last.y = first.y;
      } else this.elements.push({ type: LineTo, x: first.x, y: first.y });
    }
  }
  /** `addRect(QRectF)`. */
  addRect(x, y, w, h) {
    if (w === 0 && h === 0) return;
    this.moveTo(x, y);
    this.elements.push({ type: LineTo, x: x + w, y }, { type: LineTo, x: x + w, y: y + h }, { type: LineTo, x, y: y + h }, { type: LineTo, x, y });
    this.requireMoveTo = true;
  }
  /** `arcTo(rect, start, -90)` for a start angle that is a multiple of 90° (qt_curves_for_arc). */
  quarterArc(r, start) {
    const { x, y, w } = r;
    const w2 = r.w / 2;
    const w2k = w2 * KAPPA3;
    const h = r.h;
    const h2 = r.h / 2;
    const h2k = h2 * KAPPA3;
    const points = [
      [x + w, y + h2],
      [x + w, y + h2 + h2k],
      [x + w2 + w2k, y + h],
      [x + w2, y + h],
      [x + w2 - w2k, y + h],
      [x, y + h2 + h2k],
      [x, y + h2],
      [x, y + h2 - h2k],
      [x + w2 - w2k, y],
      [x + w2, y],
      [x + w2 + w2k, y],
      [x + w, y + h2 - h2k],
      [x + w, y + h2]
    ];
    const segment = Math.floor(start / 90) - 1;
    const quadrant = 3 - (segment % 4 + 4) % 4;
    const j = 3 * quadrant;
    const [sx, sy] = ellipsePoint(r, start);
    const [ex, ey] = ellipsePoint(r, start - 90);
    this.lineTo(sx, sy);
    this.cubicTo(points[j + 1][0], points[j + 1][1], points[j + 2][0], points[j + 2][1], ex, ey);
  }
  /** `addRoundedRect(QRectF(x, y, w, h), xr, yr, Qt::AbsoluteSize)` (qpainterpath.cpp:3214-3270). */
  addRoundedRect(x0, y0, w0, h0, xRadius, yRadius) {
    const x = w0 < 0 ? x0 + w0 : x0;
    const y = h0 < 0 ? y0 + h0 : y0;
    const w = Math.abs(w0);
    const h = Math.abs(h0);
    if (w === 0 && h === 0) return;
    const hw = w / 2;
    const hh = h / 2;
    const xr = hw === 0 ? 0 : 100 * Math.min(xRadius, hw) / hw;
    const yr = hh === 0 ? 0 : 100 * Math.min(yRadius, hh) / hh;
    if (xr <= 0 || yr <= 0) {
      this.addRect(x, y, w, h);
      return;
    }
    const rxx2 = w * xr / 100;
    const ryy2 = h * yr / 100;
    const [mx, my] = ellipsePoint({ x, y, w: rxx2, h: ryy2 }, 180);
    if (!(rxx2 === 0 && ryy2 === 0)) this.moveTo(mx, my);
    this.quarterArc({ x, y, w: rxx2, h: ryy2 }, 180);
    this.quarterArc({ x: x + w - rxx2, y, w: rxx2, h: ryy2 }, 90);
    this.quarterArc({ x: x + w - rxx2, y: y + h - ryy2, w: rxx2, h: ryy2 }, 0);
    this.quarterArc({ x, y: y + h - ryy2, w: rxx2, h: ryy2 }, 270);
    this.closeSubpath();
    this.requireMoveTo = true;
  }
};
function transformScale(t) {
  const type = t.type();
  if (type <= TxTranslate) return 1;
  if (type === TxScale) return Math.max(Math.abs(t.m11), Math.abs(t.m22));
  const xScale1 = fma2(t.m11, t.m11, t.m21 * t.m21);
  const yScale1 = fma2(t.m12, t.m12, t.m22 * t.m22);
  const xScale2 = fma2(t.m11, t.m11, t.m12 * t.m12);
  const yScale2 = fma2(t.m21, t.m21, t.m22 * t.m22);
  if (Math.abs(xScale1 - yScale1) > Math.abs(xScale2 - yScale2)) return Math.sqrt(Math.max(xScale1, yScale1));
  return Math.sqrt(Math.max(xScale2, yScale2));
}
function flatten(out, b0, threshold) {
  const stack = [b0.slice()];
  const levels = [9];
  let top = 0;
  while (top >= 0) {
    const b = stack[top];
    const [x1, y1, x2, y2, x3, y3, x4, y4] = b;
    const y4y1 = y4 - y1;
    const x4x1 = x4 - x1;
    let l = Math.abs(x4x1) + Math.abs(y4y1);
    let d;
    if (l > 1) {
      d = Math.abs(fma2(x4x1, y1 - y2, -(y4y1 * (x1 - x2)))) + Math.abs(fma2(x4x1, y1 - y3, -(y4y1 * (x1 - x3))));
    } else {
      d = Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(x1 - x3) + Math.abs(y1 - y3);
      l = 1;
    }
    if (d < threshold * l || levels[top] === 0) {
      out.push(x4, y4);
      top -= 1;
    } else {
      const m12x = (x1 + x2) * 0.5;
      const m12y = (y1 + y2) * 0.5;
      const m23x = (x2 + x3) * 0.5;
      const m23y = (y2 + y3) * 0.5;
      const m34x = (x3 + x4) * 0.5;
      const m34y = (y3 + y4) * 0.5;
      const m1223x = (m12x + m23x) * 0.5;
      const m1223y = (m12y + m23y) * 0.5;
      const m2334x = (m23x + m34x) * 0.5;
      const m2334y = (m23y + m34y) * 0.5;
      const mx = (m1223x + m2334x) * 0.5;
      const my = (m1223y + m2334y) * 0.5;
      stack[top] = [mx, my, m2334x, m2334y, m34x, m34y, x4, y4];
      stack[top + 1] = [x1, y1, m12x, m12y, m1223x, m1223y, mx, my];
      levels[top] = levels[top] - 1;
      levels[top + 1] = levels[top];
      top += 1;
    }
  }
}
function outlineContours(path3, transform) {
  const scale = transformScale(transform);
  const threshold = scale === 0 ? 0.25 : 0.25 / scale;
  const contours = [];
  let current = null;
  const close = () => {
    if (!current || current.length < 2) return;
    const n = current.length;
    if (current[n - 2] !== current[0] || current[n - 1] !== current[1]) current.push(current[0], current[1]);
  };
  const els = path3.elements;
  for (let i = 0; i < els.length; i += 1) {
    const e = els[i];
    if (e.type === MoveTo) {
      if (i === els.length - 1) continue;
      close();
      current = [e.x, e.y];
      contours.push(current);
    } else if (e.type === LineTo) {
      current.push(e.x, e.y);
    } else if (e.type === CurveTo) {
      const c2 = els[i + 1];
      const end = els[i + 2];
      const n = current.length;
      flatten(current, [current[n - 2], current[n - 1], e.x, e.y, c2.x, c2.y, end.x, end.y], threshold);
      i += 2;
    }
  }
  close();
  const identity = transform.isIdentity();
  return contours.map((c) => {
    if (identity) return c;
    const out = new Array(c.length);
    for (let k = 0; k < c.length; k += 2) {
      const [mx, my] = transform.map(c[k], c[k + 1]);
      out[k] = mx;
      out[k + 1] = my;
    }
    return out;
  });
}

// ../engine/src/render/qt/spans.ts
var SPAN_BATCH = 256;
var CLIPPED_BATCH = 256;
function div2552(x) {
  return x + (x >> 8) + 128 >> 8;
}
var ClipData = class _ClipData {
  constructor(spans) {
    this.spans = spans;
    if (spans.length === 0) {
      this.xmin = this.xmax = this.ymin = this.ymax = 0;
      return;
    }
    let xmin = Number.POSITIVE_INFINITY;
    let xmax = 0;
    let y = -1;
    spans.forEach((s, i) => {
      if (s.y !== y) {
        y = s.y;
        this.lines.set(y, i);
      }
      xmin = Math.min(xmin, s.x);
      xmax = Math.max(xmax, s.x + s.len);
    });
    this.xmin = xmin;
    this.xmax = xmax;
    this.ymin = spans[0].y;
    this.ymax = spans[spans.length - 1].y + 1;
  }
  spans;
  lines = /* @__PURE__ */ new Map();
  xmin;
  xmax;
  ymin;
  ymax;
  /**
   * The spans the gray raster emits for a coverage mask: maximal runs of
   * equal non-zero coverage per row, rows top to bottom (gray_hline merges
   * adjacent equal spans; a flush never splits a run).
   */
  static fromMask(mask2) {
    return new _ClipData(mask2 ? maskSpans2(mask2) : []);
  }
};
function maskSpans2(mask2) {
  const out = [];
  maskSpans(mask2, (x, y, len, coverage) => out.push({ x, y, len, coverage }));
  return out;
}
function intersect(clip, state2, spans, start, end, out, available) {
  const clipSpans = clip.spans;
  const clipCount = clipSpans.length;
  let ci = state2.current;
  let si = start;
  while (available > 0 && si < end) {
    if (ci >= clipCount) {
      si = end;
      break;
    }
    const s = spans[si];
    const c = clipSpans[ci];
    if (c.y > s.y) {
      si += 1;
      continue;
    }
    if (s.y !== c.y) {
      const line2 = s.y < clipCount ? clip.lines.get(s.y) : void 0;
      if (line2 !== void 0) ci = line2;
      else ci += 1;
      continue;
    }
    const sx1 = s.x;
    const sx2 = sx1 + s.len;
    const cx1 = c.x;
    const cx2 = cx1 + c.len;
    if (cx1 < sx1 && cx2 < sx1) {
      ci += 1;
      continue;
    } else if (sx1 < cx1 && sx2 < cx1) {
      si += 1;
      continue;
    }
    const x = Math.max(sx1, cx1);
    const len = Math.min(sx2, cx2) - x;
    if (len) {
      out.push({ x, y: s.y, len, coverage: div2552(s.coverage * c.coverage) });
      available -= 1;
    }
    if (sx2 < cx2) si += 1;
    else ci += 1;
  }
  state2.current = ci;
  return si;
}
function deliverSpans(spans, clip, blend) {
  for (let start = 0; start < spans.length; start += SPAN_BATCH) {
    const end = Math.min(spans.length, start + SPAN_BATCH);
    if (!clip) {
      blend(spans.slice(start, end));
      continue;
    }
    const state2 = { current: 0 };
    let si = start;
    while (si < end) {
      const out = [];
      si = intersect(clip, state2, spans, si, end, out, CLIPPED_BATCH);
      if (out.length) blend(out);
    }
  }
}
var BUFFER_SIZE2 = 2048;
function handleSpans(spans, constAlpha, fetch2, process2) {
  let coverage = 0;
  let i = 0;
  const count = spans.length;
  while (i < count) {
    if (!spans[i].len) {
      i += 1;
      continue;
    }
    let x = spans[i].x;
    const y = spans[i].y;
    let right = x + spans[i].len;
    for (let j = i + 1; j < count && spans[j].y === y && spans[j].x === right; j += 1) right += spans[j].len;
    let length = right - x;
    while (length) {
      let l = Math.min(BUFFER_SIZE2, length);
      length -= l;
      const src = fetch2(x, y, l);
      let offset = 0;
      while (l > 0) {
        const s = spans[i];
        if (x === s.x) coverage = s.coverage * constAlpha >> 8;
        const spanRight = s.x + s.len;
        const len = Math.min(l, spanRight - x);
        process2(x, y, len, coverage, src, offset);
        l -= len;
        x += len;
        offset += len;
        if (x === spanRight) i += 1;
      }
    }
  }
}

// ../engine/src/render/qt/draw-image.ts
var FIXED = 65536;
var HALF = 32768;
function setupMatrix(t) {
  const delta = new QTransform().translate(1 / 65536, 1 / 65536);
  const inv = delta.multiply(t).inverted();
  if (!inv) return null;
  const f1 = fma2(inv.m11, inv.m11, inv.m21 * inv.m21);
  const f2 = fma2(inv.m12, inv.m12, inv.m22 * inv.m22);
  const fast = f1 < 1e4 && f2 < 1e4 && f1 > 1 / 65536 && f2 > 1 / 65536 && Math.abs(inv.dx) < 1e4 && Math.abs(inv.dy) < 1e4;
  return { m11: inv.m11, m12: inv.m12, m21: inv.m21, m22: inv.m22, dx: inv.dx, dy: inv.dy, fast };
}
function sourceX(m, cx, cy) {
  return fma2(m.m21, cy, m.m11 * cx) + m.dx;
}
function sourceY(m, cx, cy) {
  return fma2(m.m22, cy, m.m12 * cx) + m.dy;
}
function fastPathFits(m, cx, cy, length) {
  if (!m.fast) return false;
  let fx = sourceX(m, cx, cy) * FIXED;
  let fy = sourceY(m, cx, cy) * FIXED;
  let minc = Math.min(fx, fy);
  let maxc = Math.max(fx, fy);
  fx = fma2(Math.trunc(m.m11 * FIXED), length, fx);
  fy = fma2(Math.trunc(m.m12 * FIXED), length, fy);
  minc = Math.min(minc, Math.min(fx, fy));
  maxc = Math.max(maxc, Math.max(fx, fy));
  return minc >= -2147483648 && maxc <= 2147483647;
}
function sampleBilinear(src, x1, y1, distx, disty, out, o) {
  const w = src.width;
  const h = src.height;
  let xa;
  let xb;
  if (x1 < 0) xa = xb = 0;
  else if (x1 >= w - 1) xa = xb = w - 1;
  else {
    xa = x1;
    xb = x1 + 1;
  }
  let ya;
  let yb;
  if (y1 < 0) ya = yb = 0;
  else if (y1 >= h - 1) ya = yb = h - 1;
  else {
    ya = y1;
    yb = y1 + 1;
  }
  const s = src.data;
  const tl = (ya * w + xa) * 4;
  const tr = (ya * w + xb) * 4;
  const bl = (yb * w + xa) * 4;
  const br = (yb * w + xb) * 4;
  const idy = 256 - disty;
  const idx = 256 - distx;
  for (let c = 0; c < 4; c += 1) {
    const left = s[tl + c] * idy + s[bl + c] * disty >> 8;
    const right = s[tr + c] * idy + s[br + c] * disty >> 8;
    out[o + c] = left * idx + right * distx >> 8;
  }
}
function fetchBilinear(src, m, x, y, length, out) {
  const cx = x + 0.5;
  const cy = y + 0.5;
  if (fastPathFits(m, cx, cy, length)) {
    const fdx = Math.trunc(m.m11 * FIXED);
    const fdy = Math.trunc(m.m12 * FIXED);
    let fx2 = Math.trunc(sourceX(m, cx, cy) * FIXED) - HALF;
    let fy2 = Math.trunc(sourceY(m, cx, cy) * FIXED) - HALF;
    for (let i = 0; i < length; i += 1) {
      sampleBilinear(src, fx2 >> 16, fy2 >> 16, (fx2 & 65535) >> 8, (fy2 & 65535) >> 8, out, i * 4);
      fx2 = fx2 + fdx | 0;
      fy2 = fy2 + fdy | 0;
    }
    return;
  }
  let fx = sourceX(m, cx, cy);
  let fy = sourceY(m, cx, cy);
  for (let i = 0; i < length; i += 1) {
    const px = fx - 0.5;
    const py = fy - 0.5;
    const x1 = Math.trunc(px) - (px < 0 ? 1 : 0);
    const y1 = Math.trunc(py) - (py < 0 ? 1 : 0);
    const distx = Math.trunc((px - x1) * 256);
    const disty = Math.trunc((py - y1) * 256);
    sampleBilinear(src, x1, y1, distx, disty, out, i * 4);
    fx += m.m11;
    fy += m.m12;
  }
}
function fetchNearest(src, m, x, y, length, out) {
  const w = src.width;
  const h = src.height;
  const s = src.data;
  const cx = x + 0.5;
  const cy = y + 0.5;
  const put = (px, py, i) => {
    const sx = px < 0 ? 0 : px > w - 1 ? w - 1 : px;
    const sy = py < 0 ? 0 : py > h - 1 ? h - 1 : py;
    const si = (sy * w + sx) * 4;
    out[i * 4] = s[si];
    out[i * 4 + 1] = s[si + 1];
    out[i * 4 + 2] = s[si + 2];
    out[i * 4 + 3] = s[si + 3];
  };
  if (fastPathFits(m, cx, cy, length)) {
    const fdx = Math.trunc(m.m11 * FIXED);
    const fdy = Math.trunc(m.m12 * FIXED);
    let fx2 = Math.trunc(sourceX(m, cx, cy) * FIXED);
    let fy2 = Math.trunc(sourceY(m, cx, cy) * FIXED);
    for (let i = 0; i < length; i += 1) {
      put(fx2 >> 16, fy2 >> 16, i);
      fx2 = fx2 + fdx | 0;
      fy2 = fy2 + fdy | 0;
    }
    return;
  }
  let fx = sourceX(m, cx, cy);
  let fy = sourceY(m, cx, cy);
  for (let i = 0; i < length; i += 1) {
    put(Math.trunc(fx) - (fx < 0 ? 1 : 0), Math.trunc(fy) - (fy < 0 ? 1 : 0), i);
    fx += m.m11;
    fy += m.m12;
  }
}
function rectSpans(x, y, w, h, device, clip) {
  const spans = [];
  const sink = (sx, sy, len, coverage) => {
    spans.push({ x: sx, y: sy, len, coverage });
  };
  if (clip) {
    const x1 = Math.max(x, clip.xmin);
    const x2 = Math.min(x + w, clip.xmax);
    const y1 = Math.max(y, clip.ymin);
    const y2 = Math.min(y + h, clip.ymax);
    if (x2 > x1 && y2 > y1) for (let row = y1; row < y2; row += 1) sink(x1, row, x2 - x1, 255);
    return spans;
  }
  fillRectSpans(x, y, w, h, device, sink);
  return spans;
}
function rasterizerBox(device, clip) {
  if (!clip) return device;
  return {
    left: Math.max(device.left, clip.xmin),
    top: Math.max(device.top, clip.ymin),
    right: Math.min(device.right, clip.xmax - 1),
    bottom: Math.min(device.bottom, clip.ymax - 1)
  };
}
function drawImage(dst, src, state2) {
  if (src.width <= 0 || src.height <= 0 || dst.width <= 0 || dst.height <= 0) return;
  const intOpacity = Math.trunc(Math.min(1, Math.max(0, state2.opacity)) * 256);
  if (intOpacity === 0) return;
  const clip = state2.clip ?? null;
  if (clip && clip.spans.length === 0) return;
  const t = state2.transform;
  const type = t.type();
  const device = clipBoxFor(dst.width, dst.height);
  const compose = composerFor(state2.mode);
  const process2 = (x, y, len, coverage, fetched, offset) => {
    if (coverage > 0) compose(dst.data, (y * dst.width + x) * 4, fetched, offset * 4, len, coverage);
  };
  if (type <= TxTranslate) {
    const ox = qRound(t.dx);
    const oy = qRound(t.dy);
    if (!state2.smooth && state2.mode === CompositionMode.SourceOver && !clip) {
      const x0 = Math.max(0, ox);
      const x1 = Math.min(dst.width, ox + src.width);
      const y0 = Math.max(0, oy);
      const y1 = Math.min(dst.height, oy + src.height);
      if (x1 <= x0) return;
      for (let y = y0; y < y1; y += 1) {
        const di = (y * dst.width + x0) * 4;
        const si = ((y - oy) * src.width + (x0 - ox)) * 4;
        blendSourceOverFast(dst.data, di, src.data, si, x1 - x0, intOpacity);
      }
      return;
    }
    const fetch3 = (x, y, length) => {
      const from = ((y - oy) * src.width + (x - ox)) * 4;
      return src.data.subarray(from, from + length * 4);
    };
    deliverSpans(rectSpans(ox, oy, src.width, src.height, device, clip), clip, (chunk) => handleSpans(chunk, intOpacity, fetch3, process2));
    return;
  }
  const w = src.width;
  const h = src.height;
  if (w === 1 && h === 1 && type <= TxScale && !state2.antialias) {
    const rr = t.mapRect(0, 0, 1, 1);
    const x1 = qRound(rr.x);
    const y1 = qRound(rr.y);
    const color2 = new Uint8ClampedArray(4);
    for (let c = 0; c < 4; c += 1) {
      const c16 = src.data[c] * 257 * intOpacity >> 8 >>> 0;
      color2[c] = c16 - (c16 >> 8) + 128 >> 8;
    }
    let solid3 = new Uint8ClampedArray(0);
    const fetch3 = (_x, _y, length) => {
      if (solid3.length < length * 4) {
        solid3 = new Uint8ClampedArray(length * 4);
        for (let i = 0; i < length; i += 1) solid3.set(color2, i * 4);
      }
      return solid3;
    };
    const spans2 = rectSpans(x1, y1, qRound(rr.x + rr.width) - x1, qRound(rr.y + rr.height) - y1, device, clip);
    deliverSpans(spans2, clip, (chunk) => handleSpans(chunk, 256, fetch3, process2));
    return;
  }
  const m = setupMatrix(t);
  if (!m) return;
  let spans;
  const sink = (x, y, len, coverage) => {
    spans.push({ x, y, len, coverage });
  };
  spans = [];
  if (!state2.antialias && type === TxScale) {
    const rr = t.mapRect(0, 0, w, h);
    const x1 = qRound(rr.x);
    const y1 = qRound(rr.y);
    const x2 = qRound(rr.x + rr.width);
    const y2 = qRound(rr.y + rr.height);
    spans = rectSpans(x1, y1, x2 - x1, y2 - y1, device, clip);
  } else {
    const noShear = scaleIsUniform(t);
    if (noShear || type === TxScale) {
      const [ax, ay] = t.map(0, h * 0.5);
      const [bx, by] = t.map(w, h * 0.5);
      const width = noShear ? h / w : Math.abs(t.m22 * h / (t.m11 * w));
      rasterizeLine(ax, ay, bx, by, width, state2.antialias, rasterizerBox(device, clip), sink);
    } else if (state2.antialias) {
      const path3 = new PainterPath();
      path3.addRect(0, 0, w, h);
      const mask2 = grayRasterize(outlineContours(path3, t), true, dst.width, dst.height);
      spans = mask2 ? maskSpans2(mask2) : [];
    } else {
      const poly = [];
      for (const [px, py] of [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
        [0, 0]
      ]) {
        const [mx, my] = t.map(px, py);
        poly.push(mx, my);
      }
      rasterizePolygonsAliased([poly], true, rasterizerBox(device, clip), sink);
    }
  }
  const scratch2 = new Uint8ClampedArray(BUFFER_SIZE2 * 4);
  const sample = state2.smooth ? fetchBilinear : fetchNearest;
  const fetch2 = (x, y, length) => {
    sample(src, m, x, y, length, scratch2);
    return scratch2;
  };
  deliverSpans(spans, clip, (chunk) => handleSpans(chunk, intOpacity, fetch2, process2));
}
function roundedRectClip(w, h, radius, transform, width, height) {
  const path3 = new PainterPath();
  path3.addRoundedRect(0, 0, w, h, radius, radius);
  return ClipData.fromMask(grayRasterize(outlineContours(path3, transform), true, width, height));
}

// ../engine/src/render/cpu/compositor.ts
function createCompositorState() {
  return { effects: /* @__PURE__ */ new Map() };
}
var EMPTY_IMAGES = /* @__PURE__ */ new Map();
function kernelContext(plan, layer, effect, extras) {
  const ctx = {
    frame: effect.frame,
    canvasWidth: plan.width,
    canvasHeight: plan.height,
    images: extras.images ?? EMPTY_IMAGES,
    effectId: effect.id,
    timelineWidth: plan.timelineWidth ?? plan.width,
    timelineHeight: plan.timelineHeight ?? plan.height
  };
  if (extras.texts) ctx.texts = extras.texts;
  if (effect.imageSizes) ctx.imageSizes = effect.imageSizes;
  if (plan.fps) ctx.fps = plan.fps;
  if (layer.clip) ctx.clip = layer.clip;
  if (extras.audio) ctx.audio = extras.audio;
  if (extras.text) ctx.text = extras.text;
  if (extras.state) {
    let map = extras.state.effects.get(effect.id);
    if (!map) {
      map = /* @__PURE__ */ new Map();
      extras.state.effects.set(effect.id, map);
    }
    ctx.state = map;
  }
  return ctx;
}
function solid2(width, height, rgba2) {
  const img = createPremul(width, height);
  const a = Math.min(255, Math.max(0, Math.round(rgba2[3] ?? 255)));
  const r = byteMul(Math.min(255, Math.max(0, Math.round(rgba2[0] ?? 0))), a);
  const g = byteMul(Math.min(255, Math.max(0, Math.round(rgba2[1] ?? 0))), a);
  const b = byteMul(Math.min(255, Math.max(0, Math.round(rgba2[2] ?? 0))), a);
  if (r || g || b || a) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }
  return img;
}
function sourceImage(layer, source2) {
  if (layer.source.kind === "color") return solid2(layer.drawWidth, layer.drawHeight, layer.source.color);
  if (!source2 || source2.width <= 0 || source2.height <= 0) return null;
  const pm = premultiply(source2);
  if (pm.width === layer.drawWidth && pm.height === layer.drawHeight) return pm;
  return smoothScale(pm, layer.drawWidth, layer.drawHeight);
}
function applyMasks(image, masks, images) {
  for (const m of masks) {
    const src = images.get(m.maskPath);
    if (!src) continue;
    applyMaskFromSource(image, src, { brightness: m.brightness, contrast: m.contrast, replaceImage: m.replaceImage, invert: m.invert ?? false });
  }
}
function drawLayer(canvas, plan, layer, index, sources) {
  let image = sourceImage(layer, sources.layers[index]);
  if (!image) return;
  const images = sources.images ?? EMPTY_IMAGES;
  const request = layer.audio;
  const audio = request?.silent ? { sampleRate: request.sampleRate, channels: Array.from({ length: request.channels }, () => new Float32Array(request.samples)) } : sources.audio?.[index] ?? null;
  const extras = { images, texts: sources.texts, text: sources.text, state: sources.state, audio };
  for (const effect of layer.effects) {
    if (effect.applyBeforeClip === false) continue;
    image = processEffect(image, effect, kernelContext(plan, layer, effect, extras));
    if (image.width <= 0 || image.height <= 0) return;
  }
  applyMasks(
    image,
    layer.masks.filter((m) => m.applyBeforeClip !== false),
    images
  );
  let transform = QTransform.fromAffine(layer.transform);
  if (image.width !== layer.drawWidth || image.height !== layer.drawHeight) {
    transform = new QTransform().scale(layer.drawWidth / image.width, layer.drawHeight / image.height).multiply(transform);
  }
  const radius = (layer.cornerRadius ?? 0) * (image.width / layer.drawWidth);
  const clip = radius > 0 ? roundedRectClip(image.width, image.height, radius, transform, canvas.width, canvas.height) : null;
  const mode = layer.composite ?? CompositionMode.SourceOver;
  const afterEffects = layer.effects.filter((e) => e.applyBeforeClip === false);
  const afterMasks = layer.masks.filter((m) => m.applyBeforeClip === false);
  const state2 = { transform, smooth: !transform.isIdentity(), antialias: radius > 0, opacity: layer.opacity, mode, clip };
  if (mode === CompositionMode.SourceOver && afterEffects.length === 0 && afterMasks.length === 0) {
    drawImage(canvas, image, state2);
    return;
  }
  let layerCanvas = createPremul(canvas.width, canvas.height);
  drawImage(layerCanvas, image, state2);
  for (const effect of afterEffects) {
    layerCanvas = processEffect(layerCanvas, effect, kernelContext(plan, layer, effect, extras));
  }
  applyMasks(layerCanvas, afterMasks, images);
  drawImage(canvas, layerCanvas, { transform: new QTransform(), smooth: false, antialias: false, opacity: 1, mode, clip: null });
}
function compositeFrame(plan, sources, out) {
  const canvas = solid2(plan.width, plan.height, plan.background);
  plan.layers.forEach((layer, i) => drawLayer(canvas, plan, layer, i, sources));
  if (out && (out.width !== plan.width || out.height !== plan.height)) {
    throw new RangeError(`compositeFrame: out is ${out.width}x${out.height}, plan is ${plan.width}x${plan.height}`);
  }
  return unpremultiply(canvas, out);
}

// ../render-node/src/svg/text.ts
import { readFileSync } from "node:fs";

// ../../node_modules/@resvg/resvg-wasm/index.mjs
var wasm;
var heap = new Array(128).fill(void 0);
heap.push(void 0, null, true, false);
var heap_next = heap.length;
function addHeapObject(obj) {
  if (heap_next === heap.length)
    heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];
  heap[idx] = obj;
  return idx;
}
function getObject(idx) {
  return heap[idx];
}
function dropObject(idx) {
  if (idx < 132)
    return;
  heap[idx] = heap_next;
  heap_next = idx;
}
function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}
var WASM_VECTOR_LEN = 0;
var cachedUint8Memory0 = null;
function getUint8Memory0() {
  if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
    cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8Memory0;
}
var cachedTextEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder("utf-8") : { encode: () => {
  throw Error("TextEncoder not available");
} };
var encodeString = typeof cachedTextEncoder.encodeInto === "function" ? function(arg, view) {
  return cachedTextEncoder.encodeInto(arg, view);
} : function(arg, view) {
  const buf = cachedTextEncoder.encode(arg);
  view.set(buf);
  return {
    read: arg.length,
    written: buf.length
  };
};
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === void 0) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8Memory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8Memory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127)
      break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    const view = getUint8Memory0().subarray(ptr + offset, ptr + len);
    const ret = encodeString(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
function isLikeNone(x) {
  return x === void 0 || x === null;
}
var cachedInt32Memory0 = null;
function getInt32Memory0() {
  if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
    cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
  }
  return cachedInt32Memory0;
}
var cachedTextDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }) : { decode: () => {
  throw Error("TextDecoder not available");
} };
if (typeof TextDecoder !== "undefined") {
  cachedTextDecoder.decode();
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}
function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`);
  }
  return instance.ptr;
}
function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_exn_store(addHeapObject(e));
  }
}
var BBoxFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_bbox_free(ptr >>> 0));
var BBox = class _BBox {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_BBox.prototype);
    obj.__wbg_ptr = ptr;
    BBoxFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    BBoxFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_bbox_free(ptr);
  }
  /**
  * @returns {number}
  */
  get x() {
    const ret = wasm.__wbg_get_bbox_x(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} arg0
  */
  set x(arg0) {
    wasm.__wbg_set_bbox_x(this.__wbg_ptr, arg0);
  }
  /**
  * @returns {number}
  */
  get y() {
    const ret = wasm.__wbg_get_bbox_y(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} arg0
  */
  set y(arg0) {
    wasm.__wbg_set_bbox_y(this.__wbg_ptr, arg0);
  }
  /**
  * @returns {number}
  */
  get width() {
    const ret = wasm.__wbg_get_bbox_width(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} arg0
  */
  set width(arg0) {
    wasm.__wbg_set_bbox_width(this.__wbg_ptr, arg0);
  }
  /**
  * @returns {number}
  */
  get height() {
    const ret = wasm.__wbg_get_bbox_height(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} arg0
  */
  set height(arg0) {
    wasm.__wbg_set_bbox_height(this.__wbg_ptr, arg0);
  }
};
var RenderedImageFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_renderedimage_free(ptr >>> 0));
var RenderedImage = class _RenderedImage {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RenderedImage.prototype);
    obj.__wbg_ptr = ptr;
    RenderedImageFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RenderedImageFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_renderedimage_free(ptr);
  }
  /**
  * Get the PNG width
  * @returns {number}
  */
  get width() {
    const ret = wasm.renderedimage_width(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * Get the PNG height
  * @returns {number}
  */
  get height() {
    const ret = wasm.renderedimage_height(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * Write the image data to Uint8Array
  * @returns {Uint8Array}
  */
  asPng() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.renderedimage_asPng(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var r2 = getInt32Memory0()[retptr / 4 + 2];
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Get the RGBA pixels of the image
  * @returns {Uint8Array}
  */
  get pixels() {
    const ret = wasm.renderedimage_pixels(this.__wbg_ptr);
    return takeObject(ret);
  }
};
var ResvgFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_resvg_free(ptr >>> 0));
var Resvg = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ResvgFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_resvg_free(ptr);
  }
  /**
  * @param {Uint8Array | string} svg
  * @param {string | undefined} [options]
  * @param {Array<any> | undefined} [custom_font_buffers]
  */
  constructor(svg, options, custom_font_buffers) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      var ptr0 = isLikeNone(options) ? 0 : passStringToWasm0(options, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len0 = WASM_VECTOR_LEN;
      wasm.resvg_new(retptr, addHeapObject(svg), ptr0, len0, isLikeNone(custom_font_buffers) ? 0 : addHeapObject(custom_font_buffers));
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var r2 = getInt32Memory0()[retptr / 4 + 2];
      if (r2) {
        throw takeObject(r1);
      }
      this.__wbg_ptr = r0 >>> 0;
      return this;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Get the SVG width
  * @returns {number}
  */
  get width() {
    const ret = wasm.resvg_width(this.__wbg_ptr);
    return ret;
  }
  /**
  * Get the SVG height
  * @returns {number}
  */
  get height() {
    const ret = wasm.resvg_height(this.__wbg_ptr);
    return ret;
  }
  /**
  * Renders an SVG in Wasm
  * @returns {RenderedImage}
  */
  render() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.resvg_render(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var r2 = getInt32Memory0()[retptr / 4 + 2];
      if (r2) {
        throw takeObject(r1);
      }
      return RenderedImage.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Output usvg-simplified SVG string
  * @returns {string}
  */
  toString() {
    let deferred1_0;
    let deferred1_1;
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.resvg_toString(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      deferred1_0 = r0;
      deferred1_1 = r1;
      return getStringFromWasm0(r0, r1);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
  * Calculate a maximum bounding box of all visible elements in this SVG.
  *
  * Note: path bounding box are approx values.
  * @returns {BBox | undefined}
  */
  innerBBox() {
    const ret = wasm.resvg_innerBBox(this.__wbg_ptr);
    return ret === 0 ? void 0 : BBox.__wrap(ret);
  }
  /**
  * Calculate a maximum bounding box of all visible elements in this SVG.
  * This will first apply transform.
  * Similar to `SVGGraphicsElement.getBBox()` DOM API.
  * @returns {BBox | undefined}
  */
  getBBox() {
    const ret = wasm.resvg_getBBox(this.__wbg_ptr);
    return ret === 0 ? void 0 : BBox.__wrap(ret);
  }
  /**
  * Use a given `BBox` to crop the svg. Currently this method simply changes
  * the viewbox/size of the svg and do not move the elements for simplicity
  * @param {BBox} bbox
  */
  cropByBBox(bbox) {
    _assertClass(bbox, BBox);
    wasm.resvg_cropByBBox(this.__wbg_ptr, bbox.__wbg_ptr);
  }
  /**
  * @returns {Array<any>}
  */
  imagesToResolve() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.resvg_imagesToResolve(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var r2 = getInt32Memory0()[retptr / 4 + 2];
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {string} href
  * @param {Uint8Array} buffer
  */
  resolveImage(href, buffer) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passStringToWasm0(href, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len0 = WASM_VECTOR_LEN;
      wasm.resvg_resolveImage(retptr, this.__wbg_ptr, ptr0, len0, addHeapObject(buffer));
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      if (r1) {
        throw takeObject(r0);
      }
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
};
async function __wbg_load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        if (module.headers.get("Content-Type") != "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbg_new_28c511d9baebfa89 = function(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_memory = function() {
    const ret = wasm.memory;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_buffer_12d079cc21e14bdb = function(arg0) {
    const ret = getObject(arg0).buffer;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb = function(arg0, arg1, arg2) {
    const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_object_drop_ref = function(arg0) {
    takeObject(arg0);
  };
  imports.wbg.__wbg_new_63b92bc8671ed464 = function(arg0) {
    const ret = new Uint8Array(getObject(arg0));
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_values_839f3396d5aac002 = function(arg0) {
    const ret = getObject(arg0).values();
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_next_196c84450b364254 = function() {
    return handleError(function(arg0) {
      const ret = getObject(arg0).next();
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_done_298b57d23c0fc80c = function(arg0) {
    const ret = getObject(arg0).done;
    return ret;
  };
  imports.wbg.__wbg_value_d93c65011f51a456 = function(arg0) {
    const ret = getObject(arg0).value;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_instanceof_Uint8Array_2b3bbecd033d19f6 = function(arg0) {
    let result;
    try {
      result = getObject(arg0) instanceof Uint8Array;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof obj === "string" ? obj : void 0;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len1;
    getInt32Memory0()[arg0 / 4 + 0] = ptr1;
  };
  imports.wbg.__wbg_new_16b304a2cfa7ff4a = function() {
    const ret = new Array();
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
    const ret = getStringFromWasm0(arg0, arg1);
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_push_a5b05aedc7234f9f = function(arg0, arg1) {
    const ret = getObject(arg0).push(getObject(arg1));
    return ret;
  };
  imports.wbg.__wbg_length_c20a40f15020d68a = function(arg0) {
    const ret = getObject(arg0).length;
    return ret;
  };
  imports.wbg.__wbg_set_a47bac70306a19a7 = function(arg0, arg1, arg2) {
    getObject(arg0).set(getObject(arg1), arg2 >>> 0);
  };
  imports.wbg.__wbindgen_throw = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  };
  return imports;
}
function __wbg_init_memory(imports, maybe_memory) {
}
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  __wbg_init.__wbindgen_wasm_module = module;
  cachedInt32Memory0 = null;
  cachedUint8Memory0 = null;
  return wasm;
}
async function __wbg_init(input) {
  if (wasm !== void 0)
    return wasm;
  if (typeof input === "undefined") {
    input = new URL("index_bg.wasm", void 0);
  }
  const imports = __wbg_get_imports();
  if (typeof input === "string" || typeof Request === "function" && input instanceof Request || typeof URL === "function" && input instanceof URL) {
    input = fetch(input);
  }
  __wbg_init_memory(imports);
  const { instance, module } = await __wbg_load(await input, imports);
  return __wbg_finalize_init(instance, module);
}
var dist_default = __wbg_init;
var initialized = false;
var initWasm = async (module_or_path) => {
  if (initialized) {
    throw new Error("Already initialized. The `initWasm()` function can be used only once.");
  }
  await dist_default(await module_or_path);
  initialized = true;
};
var Resvg2 = class extends Resvg {
  /**
   * @param {Uint8Array | string} svg
   * @param {ResvgRenderOptions | undefined} options
   */
  constructor(svg, options) {
    if (!initialized)
      throw new Error("Wasm has not been initialized. Call `initWasm()` function.");
    const font = options?.font;
    if (!!font && isCustomFontsOptions(font)) {
      const serializableOptions = {
        ...options,
        font: {
          ...font,
          fontBuffers: void 0
        }
      };
      super(svg, JSON.stringify(serializableOptions), font.fontBuffers);
    } else {
      super(svg, JSON.stringify(options));
    }
  }
};
function isCustomFontsOptions(value) {
  return Object.prototype.hasOwnProperty.call(value, "fontBuffers");
}

// ../render-node/src/svg/fonts.ts
import { existsSync as existsSync2 } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path2 from "node:path";

// ../render-node/src/resources.ts
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
function bundleDir() {
  if (true) {
    return path.dirname(fileURLToPath(import.meta.url));
  }
  return void 0;
}
function resourcesOverride() {
  const dir = process.env.ZENVI_RESOURCES_DIR?.trim();
  return dir ? dir : void 0;
}
var packageRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function resvgWasmPath() {
  const override = resourcesOverride();
  if (override && existsSync(path.join(override, "resvg.wasm"))) return path.join(override, "resvg.wasm");
  const bundle = bundleDir();
  if (bundle) return path.join(bundle, "resvg.wasm");
  return createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
}
function bundledFontsDir() {
  const override = resourcesOverride();
  if (override && existsSync(path.join(override, "fonts"))) return path.join(override, "fonts");
  const bundle = bundleDir();
  if (bundle) return path.join(bundle, "fonts");
  return path.join(packageRoot(), "fonts");
}

// ../render-node/src/svg/fonts.ts
function cacheDir(env = process.env) {
  const override = env.ZENVI_CACHE_DIR?.trim();
  if (override) return override;
  const home = env.HOME || env.USERPROFILE || homedir();
  if (process.platform === "darwin") return path2.join(home, "Library", "Caches", "zenvi");
  if (process.platform === "win32") return path2.join(env.LOCALAPPDATA || path2.join(home, "AppData", "Local"), "zenvi", "Cache");
  return path2.join(env.XDG_CACHE_HOME || path2.join(home, ".cache"), "zenvi");
}
var CACHE_VERSION = 3;
async function readCache(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.faces) || !parsed.dirs || !Array.isArray(parsed.roots)) {
      return void 0;
    }
    return parsed;
  } catch {
    return void 0;
  }
}
async function writeCache(file, cache3) {
  try {
    await mkdir(path2.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(cache3));
    await rename(tmp, file);
  } catch {
  }
}
async function cacheIsFresh(cache3, roots) {
  if (cache3.roots.length !== roots.length || cache3.roots.some((r, i) => r !== roots[i])) return false;
  const dirs = Object.entries(cache3.dirs);
  const checks = await Promise.all(
    dirs.map(async ([dir, mtimeMs]) => {
      try {
        return (await stat(dir)).mtimeMs === mtimeMs;
      } catch {
        return false;
      }
    })
  );
  return checks.every(Boolean);
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
var FONT_EXTS = /* @__PURE__ */ new Set([".ttf", ".otf", ".ttc", ".otc"]);
var MAX_FONT_BYTES = 40 * 1024 * 1024;
function systemFontDirs(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (process.platform === "darwin") {
    return ["/System/Library/Fonts", "/Library/Fonts", path2.join(home, "Library", "Fonts")];
  }
  if (process.platform === "win32") {
    const windir = env.WINDIR || env.SystemRoot || "C:\\Windows";
    const local = env.LOCALAPPDATA || path2.join(home, "AppData", "Local");
    return [path2.join(windir, "Fonts"), path2.join(local, "Microsoft", "Windows", "Fonts")];
  }
  return [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    path2.join(home, ".fonts"),
    path2.join(home, ".local", "share", "fonts")
  ];
}
function decodeName(bytes, platform) {
  if (platform === 0 || platform === 3) {
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i] << 8 | bytes[i + 1]);
    return out;
  }
  return Buffer.from(bytes).toString("latin1");
}
function parseNameTable(table) {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  if (table.byteLength < 6) return [];
  const count = view.getUint16(2);
  const stringOffset = view.getUint16(4);
  const names2 = /* @__PURE__ */ new Set();
  for (let i = 0; i < count; i += 1) {
    const rec = 6 + i * 12;
    if (rec + 12 > table.byteLength) break;
    const platform = view.getUint16(rec);
    const nameId = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const offset = view.getUint16(rec + 10);
    if (nameId !== 1 && nameId !== 16) continue;
    const start = stringOffset + offset;
    if (start + length > table.byteLength) continue;
    const name = decodeName(table.subarray(start, start + length), platform).trim();
    if (name) names2.add(name);
  }
  const seen = /* @__PURE__ */ new Set();
  return [...names2].filter((name) => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()));
}
async function readAt(handle2, position, length) {
  const buffer = new Uint8Array(length);
  const { bytesRead } = await handle2.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}
async function readFontFamilies(file) {
  const handle2 = await open(file, "r");
  try {
    const header = await readAt(handle2, 0, 12);
    if (header.length < 12) return [];
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const tag = String.fromCharCode(header[0], header[1], header[2], header[3]);
    let faceOffsets2 = [0];
    if (tag === "ttcf") {
      const numFonts = Math.min(view.getUint32(8), 64);
      const offsets = await readAt(handle2, 12, numFonts * 4);
      const ov = new DataView(offsets.buffer, offsets.byteOffset, offsets.byteLength);
      faceOffsets2 = Array.from({ length: Math.floor(offsets.length / 4) }, (_, i) => ov.getUint32(i * 4));
    }
    const families = /* @__PURE__ */ new Set();
    for (const faceOffset of faceOffsets2) {
      const dirHeader = await readAt(handle2, faceOffset, 12);
      if (dirHeader.length < 12) continue;
      const numTables = new DataView(dirHeader.buffer, dirHeader.byteOffset).getUint16(4);
      const records = await readAt(handle2, faceOffset + 12, numTables * 16);
      const rv = new DataView(records.buffer, records.byteOffset, records.byteLength);
      for (let i = 0; i + 16 <= records.length; i += 16) {
        const t = String.fromCharCode(records[i], records[i + 1], records[i + 2], records[i + 3]);
        if (t !== "name") continue;
        const offset = rv.getUint32(i + 8);
        const length = Math.min(rv.getUint32(i + 12), 256 * 1024);
        for (const name of parseNameTable(await readAt(handle2, offset, length))) families.add(name);
        break;
      }
    }
    return [...families];
  } finally {
    await handle2.close();
  }
}
async function walk(dir, depth, out, dirs, limit) {
  if (depth < 0 || out.length >= limit) return;
  let entries;
  try {
    dirs[dir] = (await stat(dir)).mtimeMs;
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) return;
    const full = path2.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, depth - 1, out, dirs, limit);
    else if (FONT_EXTS.has(path2.extname(entry.name).toLowerCase())) out.push(full);
  }
}
var FontIndex = class _FontIndex {
  constructor(faces) {
    this.faces = faces;
    for (const face of faces) {
      for (const name of face.families) {
        const family = name.toLowerCase();
        const list = this.byFamily.get(family) ?? [];
        list.push(face);
        this.byFamily.set(family, list);
        if (!this.spelling.has(family)) this.spelling.set(family, name);
      }
    }
    for (const list of this.byFamily.values()) list.sort((a, b) => a.size - b.size);
  }
  faces;
  byFamily = /* @__PURE__ */ new Map();
  /** Lowercased family → the name as the first font with it spells it. */
  spelling = /* @__PURE__ */ new Map();
  /**
   * The families installed, as the fonts spell them, sorted: what a tool may
   * name in an SVG title (a Qt font database's `families()`). Hidden system
   * families (".SF NS") are left out.
   */
  familyNames() {
    return [...this.spelling.values()].filter((name) => !name.startsWith(".")).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  }
  /** `familyNames`, plus the fonts an installed metric twin draws in their place ("Arial" when Liberation Sans is here). */
  renderableFamilyNames() {
    const names2 = new Set(this.familyNames());
    for (const [name, twins] of Object.entries(METRIC_TWINS)) {
      if (!this.has(name) && twins.some((twin) => this.has(twin))) names2.add(name);
    }
    return [...names2].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  }
  /**
   * Index the fonts in `dirs`. Family names are cached on disk by
   * path/size/mtime, so later processes only list and stat the folders.
   */
  static async scan(dirs = [...systemFontDirs(), bundledFontsDir()], cacheFile = path2.join(cacheDir(), "font-index.json")) {
    const roots = dirs.filter((dir) => existsSync2(dir));
    const cache3 = cacheFile ? await readCache(cacheFile) : void 0;
    if (cache3 && await cacheIsFresh(cache3, roots)) return _FontIndex.fromCached(cache3.faces);
    const files = [];
    const walked = {};
    for (const dir of roots) await walk(dir, 4, files, walked, 8e3);
    const cached2 = new Map((cache3?.faces ?? []).map((f) => [f.path, f]));
    const entries = await mapLimit(files, 16, async (file) => {
      try {
        const st = await stat(file);
        const hit = cached2.get(file);
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit;
        return { path: file, size: st.size, mtimeMs: st.mtimeMs, families: await readFontFamilies(file) };
      } catch {
        return void 0;
      }
    });
    const kept = entries.filter((e) => e !== void 0);
    if (cacheFile) await writeCache(cacheFile, { version: CACHE_VERSION, dirs: walked, roots, faces: kept });
    return _FontIndex.fromCached(kept);
  }
  static fromCached(entries) {
    const faces = entries.filter((e) => e.families.length > 0).map((e) => ({ path: e.path, families: e.families, size: e.size })).sort((a, b) => a.path.localeCompare(b.path));
    return new _FontIndex(faces);
  }
  has(family) {
    return this.byFamily.has(family.toLowerCase());
  }
  /** Font files for a family (every style), small files first. */
  files(family) {
    const faces = this.byFamily.get(family.toLowerCase()) ?? [];
    const small = faces.filter((f) => f.size <= MAX_FONT_BYTES);
    return (small.length > 0 ? small : faces.slice(0, 1)).map((f) => f.path);
  }
};
var shared;
function sharedFontIndex() {
  shared ??= FontIndex.scan();
  return shared;
}
var GENERIC_FAMILIES = /* @__PURE__ */ new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy"]);
var METRIC_TWINS = {
  Arial: ["liberation sans", "arimo"],
  Helvetica: ["liberation sans", "arimo"],
  "Times New Roman": ["liberation serif", "tinos"],
  Times: ["liberation serif", "tinos"],
  "Courier New": ["liberation mono", "cousine"],
  Courier: ["liberation mono", "cousine"]
};
var ALIASES = {
  "dejavu sans": ["verdana", "bitstream vera sans"],
  "bitstream vera sans": ["dejavu sans", "verdana"],
  sans: ["dejavu sans", "verdana"],
  arial: ["liberation sans", "arimo", "helvetica"],
  helvetica: ["arial", "liberation sans", "arimo", "helvetica neue"],
  "times new roman": ["liberation serif", "tinos", "times", "dejavu serif"],
  times: ["times new roman", "liberation serif", "tinos"],
  "courier new": ["liberation mono", "cousine", "courier", "dejavu sans mono"],
  courier: ["courier new", "liberation mono", "cousine"]
};
var DEFAULT_SANS = ["arial", "helvetica", "liberation sans", "dejavu sans", "noto sans", "verdana", "lato"];
var DEFAULT_SERIF = ["times new roman", "times", "liberation serif", "dejavu serif", "noto serif", "georgia", "lato"];
var DEFAULT_MONO = ["courier new", "menlo", "liberation mono", "dejavu sans mono", "consolas", "courier", "lato"];
function firstInstalled(index, names2) {
  return names2.find((n) => index.has(n));
}
function resolveFonts(index, familyLists) {
  const sansSerif = firstInstalled(index, DEFAULT_SANS) ?? "lato";
  const serif = firstInstalled(index, DEFAULT_SERIF) ?? sansSerif;
  const monospace = firstInstalled(index, DEFAULT_MONO) ?? sansSerif;
  const files = /* @__PURE__ */ new Set();
  const use = (family) => {
    for (const f of index.files(family)) files.add(f);
  };
  const genericTarget = (g) => g === "serif" ? serif : g === "monospace" ? monospace : sansSerif;
  const fallbackFor = (requested) => {
    const lowered = requested.map((f) => f.toLowerCase());
    if (lowered.some((f) => index.has(f) || GENERIC_FAMILIES.has(f))) return void 0;
    for (const family of lowered) {
      const alias = firstInstalled(index, ALIASES[family] ?? []);
      if (alias) return alias;
    }
    return sansSerif;
  };
  for (const list of familyLists) {
    const lowered = list.map((f) => f.toLowerCase());
    let satisfied = false;
    for (const family of lowered) {
      if (GENERIC_FAMILIES.has(family)) {
        use(genericTarget(family));
        satisfied = true;
        break;
      }
      if (index.has(family)) {
        use(family);
        satisfied = true;
        break;
      }
    }
    if (!satisfied) {
      const fb = fallbackFor(list);
      if (fb) use(fb);
    }
  }
  use(sansSerif);
  if (files.size === 0) use("lato");
  return { files: [...files], fallbackFor, sansSerif, serif, monospace };
}

// ../render-node/src/svg/opentype.ts
function tableDirectory(view, faceOffset) {
  const numTables = view.getUint16(faceOffset + 4);
  const tables = {};
  for (let i = 0; i < numTables; i += 1) {
    const rec = faceOffset + 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    tables[tag] = { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) };
  }
  return tables;
}
function faceOffsets(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag !== "ttcf") return [0];
  const n = view.getUint32(8);
  return Array.from({ length: n }, (_, i) => view.getUint32(12 + i * 4));
}
function names(view, t) {
  const name = t.name;
  if (!name) return [];
  const count = view.getUint16(name.offset + 2);
  const strings = name.offset + view.getUint16(name.offset + 4);
  const out = /* @__PURE__ */ new Set();
  for (let i = 0; i < count; i += 1) {
    const rec = name.offset + 6 + i * 12;
    const platform = view.getUint16(rec);
    const id = view.getUint16(rec + 6);
    if (id !== 1 && id !== 16) continue;
    const len = view.getUint16(rec + 8);
    const off = strings + view.getUint16(rec + 10);
    let s = "";
    if (platform === 0 || platform === 3) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(view.getUint16(off + j));
    else for (let j = 0; j < len; j += 1) s += String.fromCharCode(view.getUint8(off + j));
    if (s.trim()) out.add(s.trim());
  }
  return [...out];
}
function cmapLookup(view, t) {
  const cmap = t.cmap;
  if (!cmap) return () => 0;
  const n = view.getUint16(cmap.offset + 2);
  let best;
  for (let i = 0; i < n; i += 1) {
    const rec = cmap.offset + 4 + i * 8;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const offset2 = cmap.offset + view.getUint32(rec + 4);
    const format2 = view.getUint16(offset2);
    const unicode = platform === 0 || platform === 3 && (encoding === 1 || encoding === 10);
    if (!unicode || format2 !== 4 && format2 !== 12) continue;
    const score = format2 === 12 ? 2 : 1;
    if (!best || score > best.score) best = { format: format2, offset: offset2, score };
  }
  if (!best) return () => 0;
  const { format, offset } = best;
  if (format === 12) {
    const groups = view.getUint32(offset + 12);
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = lo + hi >> 1;
        const g = offset + 16 + mid * 12;
        const start = view.getUint32(g);
        const end = view.getUint32(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return view.getUint32(g + 8) + (cp - start);
      }
      return 0;
    };
  }
  const segX2 = view.getUint16(offset + 6);
  const ends = offset + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  return (cp) => {
    if (cp > 65535) return 0;
    for (let i = 0; i < segX2; i += 2) {
      const end = view.getUint16(ends + i);
      if (cp > end) continue;
      const start = view.getUint16(starts + i);
      if (cp < start) return 0;
      const delta = view.getInt16(deltas + i);
      const rangeOffset = view.getUint16(ranges + i);
      if (rangeOffset === 0) return cp + delta & 65535;
      const addr = ranges + i + rangeOffset + (cp - start) * 2;
      const glyph = view.getUint16(addr);
      return glyph === 0 ? 0 : glyph + delta & 65535;
    }
    return 0;
  };
}
function kernTable(view, t) {
  const pairs = /* @__PURE__ */ new Map();
  const kern = t.kern;
  if (!kern) return pairs;
  const version = view.getUint16(kern.offset);
  if (version !== 0) return pairs;
  const nTables = view.getUint16(kern.offset + 2);
  let sub = kern.offset + 4;
  for (let i = 0; i < nTables; i += 1) {
    const length = view.getUint16(sub + 2);
    const coverage = view.getUint16(sub + 4);
    const format = coverage >> 8;
    const horizontal2 = (coverage & 1) === 1;
    if (format === 0 && horizontal2) {
      const n = view.getUint16(sub + 6);
      for (let j = 0; j < n; j += 1) {
        const p = sub + 14 + j * 6;
        pairs.set(view.getUint16(p) * 65536 + view.getUint16(p + 2), view.getInt16(p + 4));
      }
    }
    sub += length;
  }
  return pairs;
}
function parseOpenType(bytes, faceOffset = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = tableDirectory(view, faceOffset);
  if (!t.head || !t.hhea || !t.hmtx || !t.maxp) throw new Error("Not an OpenType font (missing head/hhea/hmtx/maxp).");
  const unitsPerEm = view.getUint16(t.head.offset + 18) || 1e3;
  const indexToLocFormat = view.getInt16(t.head.offset + 50);
  let ascender = view.getInt16(t.hhea.offset + 4);
  let descender = view.getInt16(t.hhea.offset + 6);
  let lineGap = view.getInt16(t.hhea.offset + 8);
  const numberOfHMetrics = view.getUint16(t.hhea.offset + 34);
  const numGlyphs = view.getUint16(t.maxp.offset + 4);
  if (ascender === 0 && descender === 0 && t["OS/2"]) {
    const os2 = t["OS/2"].offset;
    ascender = view.getInt16(os2 + 68);
    descender = view.getInt16(os2 + 70);
    lineGap = view.getInt16(os2 + 72);
  }
  const lookup = cmapLookup(view, t);
  const kern = kernTable(view, t);
  const hmtx = t.hmtx.offset;
  const lastAdvance = numberOfHMetrics > 0 ? view.getUint16(hmtx + (numberOfHMetrics - 1) * 4) : 0;
  const glyf = t.glyf;
  const loca = t.loca;
  const glyphOffset = (g) => {
    if (!glyf || !loca || g < 0 || g >= numGlyphs) return void 0;
    const a = indexToLocFormat === 0 ? view.getUint16(loca.offset + g * 2) * 2 : view.getUint32(loca.offset + g * 4);
    const b = indexToLocFormat === 0 ? view.getUint16(loca.offset + (g + 1) * 2) * 2 : view.getUint32(loca.offset + (g + 1) * 4);
    return [a, b];
  };
  return {
    families: names(view, t),
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    glyphIndex: lookup,
    advanceWidth: (g) => g < numberOfHMetrics ? view.getUint16(hmtx + g * 4) : lastAdvance,
    kerning: (l, r) => kern.get(l * 65536 + r) ?? 0,
    glyphBox: (g) => {
      const range = glyphOffset(g);
      if (!range || range[1] <= range[0]) return void 0;
      const at = glyf.offset + range[0];
      return { xMin: view.getInt16(at + 2), yMin: view.getInt16(at + 4), xMax: view.getInt16(at + 6), yMax: view.getInt16(at + 8) };
    },
    hasGlyphBoxes: Boolean(glyf && loca)
  };
}

// ../render-node/src/svg/rasterize.ts
import { readFile as readFile2, stat as stat2 } from "node:fs/promises";
var ready;
function initResvg() {
  ready ??= readFile2(resvgWasmPath()).then((wasm2) => initWasm(wasm2)).catch((error) => {
    ready = void 0;
    throw error;
  });
  return ready;
}
var MAX_IMAGE_BYTES = 64 * 1024 * 1024;

// ../render-node/src/svg/text.ts
var STYLE_WORDS = /(bold|italic|oblique|light|thin|black|heavy|medium|semibold|demibold|condensed|narrow|extra|ultra)/i;
function esc(text2) {
  return text2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function rgba(color2) {
  return { rgb: `rgb(${color2[0]},${color2[1]},${color2[2]})`, alpha: (color2[3] / 255).toFixed(4) };
}
function codePoints(text2) {
  return Array.from(text2, (ch) => ch.codePointAt(0) ?? 0);
}
var NodeTextRasterizer = class {
  constructor(fonts) {
    this.fonts = fonts;
  }
  fonts;
  loaded = /* @__PURE__ */ new Map();
  inkCache = /* @__PURE__ */ new Map();
  /** The face used for a family (regular style preferred). */
  load(family) {
    const key = family.toLowerCase();
    const hit = this.loaded.get(key);
    if (hit) return hit;
    const resolved = resolveFonts(this.fonts, [[family]]);
    const chosen = this.fonts.has(family) ? family : resolved.fallbackFor([family]) ?? resolved.sansSerif;
    const files = this.fonts.files(chosen);
    const ordered = [...files].sort((a, b) => Number(STYLE_WORDS.test(a.split(/[\\/]/).pop() ?? "")) - Number(STYLE_WORDS.test(b.split(/[\\/]/).pop() ?? "")));
    for (const file of ordered) {
      try {
        const bytes = new Uint8Array(readFileSync(file));
        const faces = faceOffsets(bytes);
        let pick;
        for (const offset of faces) {
          const font = parseOpenType(bytes, offset);
          if (font.families.some((f) => f.toLowerCase() === chosen.toLowerCase())) {
            pick = font;
            break;
          }
          pick ??= font;
        }
        if (!pick) continue;
        const loaded = { file, bytes, font: pick, family: pick.families.find((f) => f.toLowerCase() === chosen.toLowerCase()) ?? pick.families[0] ?? chosen };
        this.loaded.set(key, loaded);
        return loaded;
      } catch {
      }
    }
    throw new Error(`No usable font for "${family}".`);
  }
  scale(loaded, font) {
    return font.pixelSize / loaded.font.unitsPerEm;
  }
  fontMetrics(font) {
    const loaded = this.load(font.family);
    const s = this.scale(loaded, font);
    const ascent = loaded.font.ascender * s;
    const descent = -loaded.font.descender * s;
    return { ascent, descent, lineSpacing: ascent + descent + Math.max(0, loaded.font.lineGap) * s };
  }
  layout(text2, font) {
    const loaded = this.load(font.family);
    const s = this.scale(loaded, font);
    const glyphs = codePoints(text2).map((cp) => loaded.font.glyphIndex(cp));
    const pens = [];
    let pen2 = 0;
    glyphs.forEach((g, i) => {
      if (i > 0) pen2 += loaded.font.kerning(glyphs[i - 1], g) * s;
      pens.push(pen2);
      pen2 += loaded.font.advanceWidth(g) * s;
    });
    return { loaded, glyphs, pens, width: pen2 };
  }
  advance(text2, font) {
    return this.layout(text2, font).width;
  }
  bounds(text2, font) {
    const m = this.fontMetrics(font);
    return { x: 0, y: -m.ascent, width: this.advance(text2, font), height: m.ascent + m.descent };
  }
  inkBounds(text2, font) {
    const key = `${font.family}\0${font.pixelSize}\0${text2}`;
    const cached2 = this.inkCache.get(key);
    if (cached2) return cached2;
    const { loaded, glyphs, pens, width } = this.layout(text2, font);
    const s = this.scale(loaded, font);
    let rect;
    if (loaded.font.hasGlyphBoxes) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      glyphs.forEach((g, i) => {
        const box = loaded.font.glyphBox(g);
        if (!box) return;
        x0 = Math.min(x0, pens[i] + box.xMin * s);
        x1 = Math.max(x1, pens[i] + box.xMax * s);
        y0 = Math.min(y0, -box.yMax * s);
        y1 = Math.max(y1, -box.yMin * s);
      });
      rect = Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: 0, height: 0 };
    } else {
      rect = this.rasterInk(text2, font, width);
    }
    if (this.inkCache.size > 512) this.inkCache.clear();
    this.inkCache.set(key, rect);
    return rect;
  }
  /** Ink bounds by drawing the text (CFF outlines have no glyph boxes to read). */
  rasterInk(text2, font, advance) {
    const px = font.pixelSize;
    const pad2 = Math.ceil(px);
    const w = Math.max(1, Math.ceil(advance + 2 * pad2));
    const h = Math.max(1, Math.ceil(3 * px));
    const baseline = 2 * px;
    const image = this.render(text2, font, { x: -pad2, y: -baseline, width: w, height: h }, 0, 0, [255, 255, 255, 255], null, 0);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (image.data[(y * image.width + x) * 4 + 3] > 0) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x + 1);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y + 1);
        }
      }
    }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: x0 - pad2, y: y0 - baseline, width: x1 - x0, height: y1 - y0 };
  }
  /** Rasterize `text` (baseline at x, y in region coordinates) into a region-sized straight-RGBA image. */
  render(text2, font, region, x, y, fill, stroke, strokeWidth) {
    const loaded = this.load(font.family);
    const f = rgba(fill);
    const strokeAttrs = stroke && strokeWidth > 0 ? ` stroke="${rgba(stroke).rgb}" stroke-opacity="${rgba(stroke).alpha}" stroke-width="${strokeWidth}" stroke-linecap="square" stroke-linejoin="bevel"` : "";
    const w = Math.max(1, Math.ceil(region.width));
    const h = Math.max(1, Math.ceil(region.height));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${region.x} ${region.y} ${w} ${h}"><text x="${x}" y="${y}" font-family="${esc(loaded.family)}" font-size="${font.pixelSize}" fill="${f.rgb}" fill-opacity="${f.alpha}"${strokeAttrs} xml:space="preserve">${esc(text2)}</text></svg>`;
    const renderer = new Resvg2(svg, {
      font: { fontBuffers: [loaded.bytes], defaultFontFamily: loaded.family, sansSerifFamily: loaded.family },
      textRendering: 2,
      shapeRendering: 2
    });
    try {
      const out = renderer.render();
      try {
        const px = out.pixels;
        const data = new Uint8ClampedArray(px.length);
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3];
          if (a === 0) continue;
          const k = 255 / a;
          data[i] = px[i] * k;
          data[i + 1] = px[i + 1] * k;
          data[i + 2] = px[i + 2] * k;
          data[i + 3] = a;
        }
        return { width: out.width, height: out.height, data };
      } finally {
        out.free();
      }
    } finally {
      renderer.free();
    }
  }
  drawText(target, text2, x, y, font, fill, stroke, strokeWidth, clip) {
    if (!text2) return;
    const ink = this.inkBounds(text2, font);
    const pad2 = Math.ceil((stroke ? strokeWidth : 0) + 2);
    let rx0 = Math.floor(x + ink.x - pad2);
    let ry0 = Math.floor(y + ink.y - pad2);
    let rx1 = Math.ceil(x + ink.x + ink.width + pad2);
    let ry1 = Math.ceil(y + ink.y + ink.height + pad2);
    rx0 = Math.max(rx0, 0, clip ? Math.floor(clip.x) : 0);
    ry0 = Math.max(ry0, 0, clip ? Math.floor(clip.y) : 0);
    rx1 = Math.min(rx1, target.width, clip ? Math.ceil(clip.x + clip.width) : target.width);
    ry1 = Math.min(ry1, target.height, clip ? Math.ceil(clip.y + clip.height) : target.height);
    if (rx1 <= rx0 || ry1 <= ry0) return;
    const layer = this.render(text2, font, { x: rx0, y: ry0, width: rx1 - rx0, height: ry1 - ry0 }, x, y, fill, stroke, strokeWidth);
    const t = target.data;
    const l = layer.data;
    for (let yy = 0; yy < layer.height; yy += 1) {
      const ty = ry0 + yy;
      if (ty >= target.height) break;
      for (let xx = 0; xx < layer.width; xx += 1) {
        const tx = rx0 + xx;
        if (tx >= target.width) break;
        const li = (yy * layer.width + xx) * 4;
        const la = l[li + 3] / 255;
        if (la === 0) continue;
        const ti = (ty * target.width + tx) * 4;
        const ta = t[ti + 3] / 255;
        const oa = la + ta * (1 - la);
        t[ti] = (l[li] * la + t[ti] * ta * (1 - la)) / oa;
        t[ti + 1] = (l[li + 1] * la + t[ti + 1] * ta * (1 - la)) / oa;
        t[ti + 2] = (l[li + 2] * la + t[ti + 2] * ta * (1 - la)) / oa;
        t[ti + 3] = oa * 255;
      }
    }
  }
};
var shared2;
function nodeTextRasterizer() {
  shared2 ??= Promise.all([sharedFontIndex(), initResvg()]).then(([index]) => new NodeTextRasterizer(index));
  return shared2;
}

// ../render-node/src/render/composite-worker.ts
var cache2 = /* @__PURE__ */ new Map();
var state = createCompositorState();
var text;
function resolveImage(wire) {
  if ("image" in wire) return wire.image;
  const hit = cache2.get(wire.ref);
  if (!hit) throw new Error(`composite worker: image ${wire.ref} is not cached`);
  return hit;
}
async function handle(request) {
  for (const key of request.evict) cache2.delete(key);
  for (const entry of request.store) cache2.set(entry.key, entry.image);
  const rasterizer = request.text ? await (text ??= nodeTextRasterizer()) : void 0;
  const image = compositeFrame(request.plan, {
    layers: request.layers.map((l) => l ? resolveImage(l) : null),
    images: new Map(request.images.map(([path3, wire]) => [path3, resolveImage(wire)])),
    texts: new Map(request.texts),
    audio: request.audio,
    text: rasterizer,
    state
  });
  return { id: request.id, image };
}
var port = parentPort;
if (port) {
  let chain = Promise.resolve();
  port.on("message", (request) => {
    chain = chain.then(async () => {
      let response;
      try {
        response = await handle(request);
      } catch (error) {
        response = { id: request.id, error: error instanceof Error ? error.stack ?? error.message : String(error) };
      }
      if ("image" in response) port.postMessage(response, [response.image.data.buffer]);
      else port.postMessage(response);
    });
  });
  port.postMessage({ ready: true });
}
