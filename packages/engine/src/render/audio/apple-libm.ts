/**
 * Exact ports of the macOS libm float functions the audio effects call on
 * their per-sample and per-frame paths: `expf` (Distortion), `__exp10f`
 * (`powf(10.0f, x)` after clang's rewrite: Compressor, Expander, Distortion)
 * and `powf` (Compressor/Expander attack and release).
 *
 * Apple's implementations (libsystem_m, macOS 26 arm64; disassembled from
 * the running library) are table-driven double-precision evaluations:
 * - exp: `t = K·x`, `n = round(t)`, `r = t − n`,
 *   `2^(t/128) ≈ s + s·r·(C1 + C2·r)` with `s = 2^((n mod 128)/128) · 2^(n div 128)`
 *   (K = 128/ln 2 for expf, 128·log2 10 for exp10f);
 * - powf: `128·log2(x) = 128·log2(c) + k·128 + p(z/c − 1)` from a 128-entry
 *   table and a degree-4 polynomial, then the same exp2 step on `y·log`.
 * They are not correctly rounded (about 1 % of results differ by one ulp from
 * the nearest float), so only reproducing the arithmetic reproduces the
 * desktop. The tables and coefficients below are the library's own values.
 * Fused steps (`fmadd d`) are evaluated in plain doubles and checked: when the
 * result is too close to a float rounding boundary for the difference to be
 * excluded, they are recomputed with the exact `fma64` (about once per 10^7
 * calls). `powf` runs once per frame and uses `fma64` throughout.
 * Verified bit for bit against the system functions on 2·10^6 arguments
 * each (`expf`, `__exp10f`) and 3·10^5 argument pairs (`powf`), special
 * values included.
 *
 * `cosf`/`sinf` (STFT windows, Whisperization phases) are not ported: their
 * results feed vDSP-dependent FFTs that are approximate anyway.
 */

import { f32, fma64 } from "./float.js";

/** 2^(j/128) for j = 0..127, as 64-bit patterns (16 hex digits each). */
const EXP2_TABLE_HEX = [
  "3ff00000000000003ff0163da9fb33353ff02c9a3e7780613ff04315e86e7f853ff059b0d31585743ff0706b29ddf6de3ff0874518759bc83ff09e3ecac6f383",
  "3ff0b5586cf9890f3ff0cc922b7247f73ff0e3ec32d3d1a23ff0fb66affed31b3ff11301d0125b513ff12abdc06c31cc3ff1429aaea92de03ff15a98c8a58e51",
  "3ff172b83c7d517b3ff18af9388c8dea3ff1a35beb6fcb753ff1bbe084045cd43ff1d4873168b9aa3ff1ed5022fcd91d3ff2063b88628cd63ff21f49917ddc96",
  "3ff2387a6e7562383ff251ce4fb2a63f3ff26b4565e27cdd3ff284dfe1f563813ff29e9df51fdee13ff2b87fd0dad9903ff2d285a6e4030b3ff2ecafa93e2f56",
  "3ff306fe0a31b7153ff32170fc4cd8313ff33c08b26416ff3ff356c55f929ff13ff371a7373aa9cb3ff38cae6d05d8663ff3a7db34e59ff73ff3c32dc313a8e5",
  "3ff3dea64c1234223ff3fa4504ac801c3ff4160a21f72e2a3ff431f5d950a8973ff44e086061892d3ff46a41ed1d00573ff486a2b5c13cd03ff4a32af0d7d3de",
  "3ff4bfdad5362a273ff4dcb299fddd0d3ff4f9b2769d2ca73ff516daa2cf66423ff5342b569d4f823ff551a4ca5d920f3ff56f4736b527da3ff58d12d497c7fd",
  "3ff5ab07dd4854293ff5c9268a5946b73ff5e76f15ad21483ff605e1b976dc093ff6247eb03a55853ff6434634ccc3203ff66238825522253ff68155d44ca973",
  "3ff6a09e667f3bcd3ff6c012750bdabf3ff6dfb23c651a2f3ff6ff7df95194843ff71f75e8ec5f743ff73f9a48a581743ff75feb564267c93ff780694fde5d3f",
  "3ff7a11473eb01873ff7c1ed0130c1323ff7e2f336cf4e623ff80427543e1a123ff82589994cce133ff8471a4623c7ad3ff868d99b4492ed3ff88ac7d98a6699",
  "3ff8ace5422aa0db3ff8cf3216b5448c3ff8f1ae991577363ff9145b0b91ffc63ff93737b0cdc5e53ff95a44cbc8520f3ff97d829fde4e503ff9a0f170ca07ba",
  "3ff9c49182a3f0903ff9e86319e323233ffa0c667b5de5653ffa309bec4a2d333ffa5503b23e255d3ffa799e1330b3583ffa9e6b5579fdbf3ffac36bbfd3f37a",
  "3ffae89f995ad3ad3ffb0e07298db6663ffb33a2b84f15fb3ffb59728de5593a3ffb7f76f2fb5e473ffba5b030a1064a3ffbcc1e904bc1d23ffbf2c25bd71e09",
  "3ffc199bdd85529c3ffc40ab5fffd07a3ffc67f12e57d14b3ffc8f6d9406e7b53ffcb720dcef90693ffcdf0b555dc3fa3ffd072d4a07897c3ffd2f87080d89f2",
  "3ffd5818dcfba4873ffd80e316c983983ffda9e603db32853ffdd321f301b4603ffdfc97337b9b5f3ffe264614f5a1293ffe502ee78b3ff63ffe7a51fbc74c83",
  "3ffea4afa2a490da3ffecf482d8e67f13ffefa1bee615a273fff252b376bba973fff50765b6e45403fff7bfdad9cbe143fffa7c1819e90d83fffd3c22b8f71f1",
].join("");
/** (1/c, 128·log2(c)) pairs for powf's 128 subintervals, as 64-bit patterns. */
const LOG2_TABLE_HEX = [
  "3ff6c16c16c16c17c05042bd4b9a7c993ff6a13cd1537290c050014332be00333ff6816816816817c04f804ae8d0cd023ff661ec6a5122f9c04efec61b011f85",
  "3ff642c8590b2164c04e7df5fe538ab33ff623fa77016240c04dfdd89d586e2b3ff6058160581606c04d7e6c0abc35793ff5e75bb8d015e7c04cffae611ad12b",
  "3ff5c9882b931057c04c819dc2d45fe43ff5ac056b015ac0c04c043859e2fdb33ff58ed2308158edc04b877c57b1b0703ff571ed3c506b3ac04b0b67f4f46810",
  "3ff5555555555555c04a8ff971810a5e3ff5390948f40febc04a152f142981b43ff51d07eae2f815c0499b072a96c6b23ff5015015015015c04921800924dd3b",
  "3ff4e5e0a72f0539c048a8980abfbd323ff4cab88725af6ec048304d90c11fd33ff4afd6a052bf5bc047b89f02cf2aad3ff49539e3b2d067c047418acebbf18f",
  "3ff47ae147ae147bc046cb0f6865c8ea3ff460cbc7f5cf9ac046552b499862773ff446f86562d9fbc045dfdcf1eeae0e3ff42d6625d51f87c0456b22e6b578e5",
  "3ff4141414141414c044f6fbb2cec5983ff3fb013fb013fbc0448365e695d7973ff3e22cbce4a902c044106017c3eca33ff3c995a47babe7c0439de8e1559f6f",
  "3ff3b13b13b13b14c0432bfee370ee683ff3991c2c187f63c042baa0c34be1ec3ff3813813813814c04249cd2b13cd6c3ff3698df3de0748c041d982c9d52708",
  "3ff3521cfb2b78c1c04169c05363f1583ff33ae45b57bcb2c040fa848044b3513ff323e34a2b10bfc0408bce0d95fa383ff30d190130d190c0401d9bbcfa61d4",
  "3ff2f684bda12f68c03f5fd8a9063e353ff2e025c04b8097c03e857d3d3613683ff2c9fb4d812ca0c03dac22d3e441d33ff2b404ad012b40c03cd3c712d31109",
  "3ff29e4129e4129ec03bfc67a7fff4cc3ff288b01288b013c03b2602497d53463ff27350b8812735c03a5094b54d28283ff25e22708092f1c0397c1cb13c7ec1",
  "3ff2492492492492c038a8980abfbd323ff23456789abcdfc037d60496cfbb4c3ff21fb78121fb78c037046031c79f853ff20b470c67c0d9c03633a8bf437ce1",
  "3ff1f7047dc11f70c03563dc29ffacb23ff1e2ef3b3fb874c03494f863b8df353ff1cf06ada2811dc033c6fb650cde513ff1bb4a4046ed29c032f9e32d5bfdd1",
  "3ff1a7b9611a7b96c0322dadc2ab34973ff19453808ca29cc03162593186da703ff1811811811812c03097e38ce606493ff16e0689427379c02f9c95dc1d1165",
  "3ff15b1e5f75270dc02e0b1ae8f2fd563ff1485f0e0acd3bc02c7b528b70f1c53ff135c81135c811c02aed391ab6674e3ff12358e75d3033c02960caf9abb7ca",
  "3ff1111111111111c027d60496cfbb4c3ff0fef010fef011c0264ce26c0671573ff0ecf56be69c90c024c560fe68af883ff0db20a88f4696c0233f7cde14cf5a",
  "3ff0c9714fbcda3bc021bb32a600549d3ff0b7e6ec259dc8c020387efbca869e3ff0a6810a6810a7c01d6ebd1f1febfe3ff0953f39010954c01a6f9c377dd31b",
  "3ff0842108421084c0177394c9d958d53ff073260a47f7c6c0147aa07357704f3ff0624dd2f1a9fcc01184b8e4c56af83ff05197f7d73404c00d23afc49139f9",
  "3ff0410410410410c00743ee861f35563ff03091b51f5e1ac0016a21e20a0a453ff0204081020408bff72c7ba20f73273ff0101010101010bfe720d9c06a835f",
  "3ff000000000000000000000000000003fefc07f01fc07f03ff6fe50b6ef08513fef81f81f81f8204006e79685c2d22a3fef44659e4a427140111cd1d5133413",
  "3fef07c1f07c1f084016bad3758efd873feecc07b301ecc0401c4dfab90aab5f3fee9131abf0b7674020eb389fa29f9b3fee573ac901e5744023aa2fdd27f1c3",
  "3fee1e1e1e1e1e1e402663f6fac913163fede5d6e3f8868a402918a16e46335b3fedae6076b981db402bc84240adabba3fed77b654b82c34402e72ec117fa5b2",
  "3fed41d41d41d41d40308c588cda79e43fed0cb58f6ec0744031dcd197552b7b3fecd85689039b0b40332ae9e278ae1a3feca4b3055ee191403476a9f983f74d",
  "3fec71c71c71c71c4035c01a39fbd6883fec3f8f01c3f8f040370742d4ef027f3fec0e070381c0e040384c2bd02f03b33febdd2b899406f740398edd077e70df",
  "3febacf914c1bad0403acf5e2db4ec943feb7d6c3dda338b403c0db6cdd94dee3feb4e81b4e81b4f403d49ee4c3259703feb2036406c80d9403e840be74e6a4d",
  "3feaf286bca1af28403fbc16b902680a3feac5701ac5701b4040790adbb030093fea98ef606a63be40411307dad30b763fea6d01a6d01a6d4041ac05b291f070",
  "3fea41a41a41a41a40424407ab0e073a3fea16d3f97a4b024042db10fc4d9aaf3fe9ec8e951033d940437124cea4cded3fe9c2d14ee4a102404406463b1b0449",
  "3fe999999999999a40449a784bcd1b8b3fe970e4f80cb87240452dbdfc4c96b33fe948b0fcd6e9e04045c01a39fbd6883fe920fb49d0e2294046518fe4677ba7",
  "3fe8f9c18f9c18fa4046e221cd9d0cde3fe8d3018d3018d3404771d2ba7efb3c3fe8acb90f6bf3aa404800a563161c543fe886e5f0abb04a40488e9c72e0b226",
  "3fe861861861861840491bba891f17093fe83c977ab2bedd4049a802391e232f3fe8181818181818404a33760a7f60513fe7f405fd017f40404abe18797f1f49",
  "3fe7d05f417d05f4404b47ebf73882a13fe7ad2208e0ecc3404bd0f2e9e790313fe78a4c8178a4c8404c592fad295b563fe767dce434a9b1404ce0a4923a587d",
  "3fe745d1745d1746404d6753e032ea0f3fe724287f46debc404ded3fd442364c3fe702e05c0b8170404e726aa1e754d23fe6e1f76b4337c7404ef6d67328e220",
].join("");

const VIEW = new DataView(new ArrayBuffer(8));

function double(hex: string, at: number): number {
  VIEW.setUint32(0, Number.parseInt(hex.slice(at, at + 8), 16));
  VIEW.setUint32(4, Number.parseInt(hex.slice(at + 8, at + 16), 16));
  return VIEW.getFloat64(0);
}

const EXP2 = Float64Array.from({ length: 128 }, (_, j) => double(EXP2_TABLE_HEX, 16 * j));
const INV_C = Float64Array.from({ length: 128 }, (_, i) => double(LOG2_TABLE_HEX, 32 * i));
const LOG_C = Float64Array.from({ length: 128 }, (_, i) => double(LOG2_TABLE_HEX, 32 * i + 16));

/** 2^q for q in [-POW2_BIAS, POW2_BIAS], built by exact doubling. */
const POW2_BIAS = 300;
const POW2 = (() => {
  const t = new Float64Array(2 * POW2_BIAS + 1);
  t[POW2_BIAS] = 1;
  for (let q = 1; q <= POW2_BIAS; q += 1) {
    t[POW2_BIAS + q] = t[POW2_BIAS + q - 1]! * 2;
    t[POW2_BIAS - q] = t[POW2_BIAS - q + 1]! / 2;
  }
  return t;
})();

const C1 = double("3f762e4453e10dae", 0);
const C2 = double("3eeebfbdff30d656", 0);
const EXPF_K = double("40671547652b82fe", 0);
/** EXPF_K split for exact products with a float: 26 + 27 significant bits. */
const EXPF_KH = (() => {
  const c = 134217729 * EXPF_K; // 2^27 + 1 (Veltkamp)
  return c - (c - EXPF_K);
})();
const EXPF_KL = EXPF_K - EXPF_KH;
const EXP10F_K = double("407a934f0979a371", 0);
const LOG_A0 = double("c0471559dca827eb", 0);
const LOG_A1 = double("404ec71c53b3b1e8", 0);
const LOG_A2 = double("c05715476529654c", 0);
const LOG_A3 = double("40671547652aef42", 0);
const POWF_OFF = 0x3f338000;

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

function floatBits(x: number): number {
  F32[0] = x;
  return U32[0]!;
}

function bitsFloat(bits: number): number {
  U32[0] = bits >>> 0;
  return F32[0]!;
}

/** `s = 2^(n/128)` as the library forms it: table value with `n >> 7` added to the exponent. */
function scaleOf(n: number): number {
  return EXP2[n & 127]! * POW2[(n >> 7) + POW2_BIAS]!;
}

/** `(float)(s + s·r·(C1 + C2·r))` with both multiply-adds fused, exactly. */
function exp2Tail(n: number, r: number): number {
  const s = scaleOf(n);
  const d = (C2 * r + C1) * r * s + s;
  const out = f32(d);
  // Plain vs fused differ by at most ~2 ulp(d); decide only when no float boundary is that close.
  const err = Math.abs(d) * 2 ** -49;
  if (f32(d - err) === out && f32(d + err) === out) return out;
  return f32(fma64(fma64(C2, r, C1) * r, s, s));
}

/** Overflow/underflow/NaN branch shared by expf and exp10f: `x · FLT_MAX` for x ≥ 0 or NaN, else 0. */
function expSpecial(x: number): number {
  if (Number.isNaN(x)) return x;
  return x > 0 ? Infinity : 0;
}

/** macOS `expf`. */
export function expf(x: number): number {
  if (!(Math.abs(x) < 128)) return expSpecial(x);
  // n = round-to-even(K·x) (fused with the 1.5·2^52 shifter), r = K·x − n (fused): exact via the split product.
  const a = EXPF_KH * x;
  const b = EXPF_KL * x;
  const fl = Math.floor(a);
  const fa = a - fl;
  let n = fl;
  if (fa >= 0.25) {
    const d = fa - 0.5;
    if (d > -b || (d === -b && fl % 2 !== 0)) n = fl + 1;
  }
  return exp2Tail(n, a - n + b);
}

/** macOS `__exp10f` (what `powf(10.0f, x)` compiles to). */
export function exp10f(x: number): number {
  if (!(Math.abs(x) < 64)) return expSpecial(x);
  const t = EXP10F_K * x;
  // frinta: round half away from zero.
  const tr = Math.trunc(t);
  const frac = t - tr;
  const n = frac >= 0.5 ? tr + 1 : frac <= -0.5 ? tr - 1 : tr;
  return exp2Tail(n, t - n);
}

/** `w = |y|` as an integer-valued float capped at 2^24 is odd (`frintz`/`fcvtzs` checks). */
function oddInteger(yAbsBits: number): boolean | null {
  if (yAbsBits < 0x3f800000) return null;
  const fy = bitsFloat(yAbsBits <= 0x4b800000 ? yAbsBits : 0x4b800000);
  if (Math.trunc(fy) !== fy) return null;
  return fy % 2 === 1;
}

/** The main path for a positive normal `x` given by its bits (possibly pre-scaled). */
function powMain(xBits: number, y: number, negate: boolean): number {
  const w2 = (xBits - POWF_OFF) | 0;
  const i = (w2 >>> 16) & 0x7f;
  const kBits = w2 & 0xff800000;
  const z = bitsFloat((xBits - kBits) | 0);
  const r = fma64(z, INV_C[i]!, -1);
  const y0 = LOG_C[i]! + (kBits >> 16);
  const r2 = r * r;
  const p = fma64(fma64(r, LOG_A0, LOG_A1), r2, fma64(r, LOG_A2, LOG_A3));
  const log128 = fma64(p, r, y0);
  let t = y * log128;
  t = Math.max(Math.min(t, 32768), -32768);
  const tr = Math.trunc(t);
  const frac = t - tr;
  const n = frac >= 0.5 ? tr + 1 : frac <= -0.5 ? tr - 1 : tr;
  const rr = t - n;
  const s = scaleOf(n);
  const out = f32(fma64(fma64(C2, rr, C1) * rr, s, s));
  return negate ? -out : out;
}

/** macOS `powf`. */
export function powf(x: number, y: number): number {
  if (x === 1) return 1;
  if (y === 1) return x;
  const xb = floatBits(x);
  const yb = floatBits(y);
  const ya = yb & 0x7fffffff;
  if (((ya - 1) >>> 0) >= 0x7f7fffff) {
    if (ya > 0x7f800000) return y; // NaN
    if (ya === 0) return 1;
    // |y| = inf
    const xa = xb & 0x7fffffff;
    if (xa === 0) return powZeroOrInf(x, yb);
    if (xa > 0x7f800000) return x;
    if (xa === 0x3f800000) return 1;
    return xa < 0x3f800000 === yb >>> 31 > 0 ? Infinity : 0;
  }
  if (((xb - 0x800000) >>> 0) < 0x7f000000) return powMain(xb, y, false);
  const xa = xb & 0x7fffffff;
  if (((xa - 1) >>> 0) >= 0x7f7fffff) {
    if (xa > 0x7f800000) return x; // NaN
    return powZeroOrInf(x, yb);
  }
  let negate = false;
  if (xb >>> 31) {
    const odd = oddInteger(ya);
    if (odd === null) return NaN;
    negate = odd;
    if (xa >= 0x800000) return powMain(xa, y, negate);
  }
  // Subnormal |x|: 1.m − 1 renormalizes the mantissa; the exponent is then lowered by 126.
  const scaled = f32(bitsFloat(xa | 0x3f800000) - 1);
  return powMain((floatBits(scaled) - 0x3f000000) | 0, y, negate);
}

/** `powf(±0 or ±inf, y)`: keep the sign for odd integer y, reciprocal for negative y. */
function powZeroOrInf(x: number, yBits: number): number {
  const keepSign = oddInteger(yBits & 0x7fffffff) === true;
  const base = keepSign ? x : Math.abs(x);
  return yBits >>> 31 ? f32(1 / base) : base;
}

/** `cosf` (not ported: rounded double cosine; see the module comment). */
export function cosf(x: number): number {
  return f32(Math.cos(x));
}

/** `sinf` (not ported: rounded double sine; see the module comment). */
export function sinf(x: number): number {
  return f32(Math.sin(x));
}
