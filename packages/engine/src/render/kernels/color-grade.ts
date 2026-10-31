/**
 * ColorGrade, ported from libopenshot 1.0 src/effects/ColorGrade.cpp:222-393
 * (wheels/curves loading at :106-122, :154-167; the LUT stage is ColorMap's,
 * `color-map.ts`).
 *
 * Float32 on un-premultiplied, gamma-encoded RGB, Rec.601 luma. The arm64
 * build fuses most `a*b + c` into `fmadd`; the per-pixel order below follows
 * the disassembly of the outlined OpenMP loop (luma is
 * `fma(0.114, B, fma(0.299, R, 0.587*G))`, the curve index is
 * `int(fma(v, 255, 0.5))`, the mix is `fma(orig, 1-mix, graded*mix)`).
 * `std::pow(2.0f, exposure)` compiles to macOS libm `exp2f`, which is not
 * correctly rounded; `appleExp2f` reproduces it bit for bit.
 */

import { fma } from "../../model/fma.js";
import type { PremulImage } from "../pixels.js";
import { evaluateAnimatedCurve } from "../plan/effect-params.js";
import type { EvaluatedParam, KernelContext, RGBA } from "../types.js";
import { applyCubeLut, lutForPath } from "./color-map.js";
import { color, getInt, num, numbers, record, str } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;
const INV_255 = f32(1 / 255);
const EPSILON = f32(0.00001);
const LUMA_R = f32(0.299);
const LUMA_G = f32(0.587);
const LUMA_B = f32(0.114);
const TINT_G = f32(0.1);
const TINT_RB = f32(0.05);
const RECOVERY = f32(0.35);

/** Fused float multiply-add: the float product is exact in double. */
function fmaf(a: number, b: number, c: number): number {
  return f32(a * b + c);
}

/** `std::max(lo, std::min(hi, v))` as `fminnm`/`fmaxnm` (NaN → hi). */
function clampF(v: number, lo: number, hi: number): number {
  return v < hi ? (v > lo ? v : lo) : hi;
}

function clamp01(v: number): number {
  return v < 1 ? (v > 0 ? v : 0) : 1;
}

/** `clampByte` (ColorGrade.cpp:36-42): round half up of a float. */
function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(f32(v + 0.5));
}

/** `(0.299f * R) + (0.587f * G) + (0.114f * B)` with clang's contraction. */
function luma(r: number, g: number, b: number): number {
  return fmaf(LUMA_B, b, fmaf(r, LUMA_R, f32(LUMA_G * g)));
}

/** `lut[int(v * 255 + 0.5)]`, fused (ColorGrade.cpp:68-70). */
function sampleCurve(lut: Float32Array, v: number): number {
  return lut[Math.trunc(f32(v * 255 + 0.5))]!;
}

/**
 * Results kept per call: an opaque pixel's grade is a pure function of its 8-bit RGB, and pictures repeat colours, so a
 * repeat skips the arithmetic. Direct-mapped by a multiplicative hash of the RGB; the bytes are the same either way.
 */
const MEMO_BITS = 16;

/** `inv_alpha[i] = 255.0f / i` (ColorGrade.cpp:264-270). */
const INV_ALPHA: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i += 1) t[i] = f32(255 / i);
  return t;
})();

// ---------------------------------------------------------------------------
// macOS arm64 libm exp2f
// ---------------------------------------------------------------------------

/**
 * `2^(j/128)` for j = 0..127: the libm table entry `T[j] + (j << 45)`, read
 * from the running libSystem (exact doubles; each literal round-trips).
 */
const EXP2_TABLE: readonly number[] = [
  1.0, 1.0054299011128027, 1.0108892860517005, 1.016378314910953,
  1.0218971486541166, 1.0274459491187637, 1.0330248790212284, 1.0386341019613787,
  1.0442737824274138, 1.0499440858006872, 1.0556451783605572, 1.061377227289262,
  1.0671404006768237, 1.0729348675259756, 1.0787607977571199, 1.0846183622133092,
  1.0905077326652577, 1.0964290818163769, 1.102382583307841, 1.1083684117236787,
  1.1143867425958924, 1.1204377524096067, 1.1265216186082418, 1.1326385195987192,
  1.1387886347566916, 1.1449721444318042, 1.1511892299529827, 1.1574400736337511,
  1.1637248587775775, 1.1700437696832502, 1.1763969916502812, 1.182784710984341,
  1.189207115002721, 1.1956643920398273, 1.202156731452703, 1.2086843236265816,
  1.215247359980469, 1.2218460329727576, 1.22848053610687, 1.2351510639369334,
  1.241857812073484, 1.2486009771892048, 1.255380757024691, 1.2621973503942507,
  1.2690509571917332, 1.275941778396392, 1.2828700160787783, 1.2898358734066657,
  1.2968395546510096, 1.3038812651919358, 1.3109612115247644, 1.318079601266064,
  1.3252366431597413, 1.3324325470831615, 1.339667524053303, 1.3469417862329458,
  1.3542555469368927, 1.3616090206382248, 1.3690024229745905, 1.3764359707545302,
  1.383909881963832, 1.3914243757719262, 1.3989796725383112, 1.4065759938190154,
  1.4142135623730951, 1.4218926021691656, 1.42961333839197, 1.4373759974489824,
  1.4451808069770467, 1.4530279958490526, 1.460917794180647, 1.4688504333369818,
  1.4768261459394993, 1.4848451658727524, 1.4929077282912648, 1.5010140696264256,
  1.5091644275934228, 1.5173590411982147, 1.5255981507445384, 1.533881997840956,
  1.5422108254079407, 1.550584877685, 1.559004400237837, 1.567469639965553,
  1.5759808451078865, 1.5845382652524937, 1.593142151342267, 1.6017927556826934,
  1.6104903319492543, 1.6192351351948637, 1.6280274218573478, 1.6368674497669644,
  1.645755478153965, 1.6546917676561943, 1.6636765803267364, 1.6727101796415966,
  1.681792830507429, 1.6909247992693053, 1.7001063537185235, 1.709337763100463,
  1.718619298122478, 1.7279512309618377, 1.7373338352737062, 1.746767386199169,
  1.7562521603732995, 1.7657884359332727, 1.7753764925265212, 1.785016611318935,
  1.7947090750031072, 1.804454167806624, 1.8142521755003989, 1.8241033854070534,
  1.8340080864093424, 1.843966568958626, 1.8539791250833855, 1.864046048397789,
  1.8741676341103, 1.8843441790323345, 1.8945759815869656, 1.9048633418176741,
  1.9152065613971474, 1.925605943636125, 1.9360617934922943, 1.9465744175792332,
  1.9571441241754002, 1.9677712232331759, 1.978456026387951, 1.9891988469672663,
];

/** The degree-2 polynomial for `2^r - 1 ≈ r*(C1 + C0*r)`, |r| <= 1/256 (bits 0x3fcebfbdff30d656, 0x3fe62e4453e10dae). */
const EXP2_C0 = 0.2402265068100628;
const EXP2_C1 = 0.6931478155387845;
/** 1.5 * 2^45: adding it rounds x to a multiple of 1/128. */
const EXP2_SHIFT = 52776558133248;

const exp2Bits = new DataView(new ArrayBuffer(8));

/**
 * macOS (Darwin 25, arm64) `exp2f`, disassembled from libsystem_m and
 * checked bit for bit against it on 228k inputs:
 * `x = k/128 + r; s = 2^(k/128); y = fma((C0*r + C1)*r, s, s)`, all in
 * double, then rounded to float. Valid for |x| < 256 (ColorGrade clamps
 * exposure to ±4); outside it libm takes an overflow/underflow branch.
 */
export function appleExp2f(x: number): number {
  const xd = f32(x);
  const kd = xd + EXP2_SHIFT;
  const k128 = kd - EXP2_SHIFT;
  const r = xd - k128;
  const k = k128 * 128;
  const j = k & 127;
  const m = (k - j) / 128;
  // s = 2^(j/128) * 2^m: the libm adds m straight into the exponent bits.
  exp2Bits.setFloat64(0, EXP2_TABLE[j]!);
  exp2Bits.setUint32(0, (exp2Bits.getUint32(0) + m * 0x100000) >>> 0);
  const s = exp2Bits.getFloat64(0);
  const p = fma(EXP2_C0, r, EXP2_C1) * r;
  return f32(fma(p, s, s));
}

// ---------------------------------------------------------------------------
// QColor(QString)
// ---------------------------------------------------------------------------

/** Qt 5.15 SVG/CSS color names (qcolor.cpp `rgbTbl`), "name rrggbb" pairs; "transparent" is separate. */
const NAMED_COLORS =
  "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc " +
  "bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a " +
  "burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 " +
  "cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b " +
  "darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 " +
  "darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc " +
  "darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f " +
  "darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff " +
  "dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 " +
  "forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 " +
  "goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 " +
  "hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa " +
  "lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 " +
  "lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 " +
  "lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa " +
  "lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 " +
  "lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa " +
  "mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 " +
  "mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 " +
  "midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead " +
  "navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 " +
  "orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 " +
  "papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 " +
  "purple 800080 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 " +
  "sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb " +
  "slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f " +
  "steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 " +
  "violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32";

let namedColors: Map<string, RGBA> | undefined;

function namedColor(name: string): RGBA | undefined {
  if (!namedColors) {
    namedColors = new Map<string, RGBA>([["transparent", [0, 0, 0, 0]]]);
    const parts = NAMED_COLORS.split(" ");
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const hex = Number.parseInt(parts[i + 1]!, 16);
      namedColors.set(parts[i]!, [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255]);
    }
  }
  return namedColors.get(name);
}

/** `qt_div_257` (qdrawhelper_p.h:888-889): 16-bit channel → 8-bit, rounded. */
function div257(x: number): number {
  const y = x + 128;
  return (y - (y >> 8)) >> 8;
}

/** `hex2int` (qcolor.cpp:62-75): -1 when any digit is not hex. */
function hex2int(s: string, at: number, n: number): number {
  let result = 0;
  for (let i = at; i < at + n; i += 1) {
    const h = Number.parseInt(s[i]!, 16);
    if (Number.isNaN(h)) return -1;
    result = result * 16 + h;
  }
  return result;
}

/**
 * `QColor(QString)` then `QColor::red()/green()/blue()/alpha()`
 * (qcolor.cpp:76-120, 317-353, 980-1010): `#rgb`, `#rrggbb`, `#aarrggbb`,
 * `#rrrgggbbb`, `#rrrrggggbbbb`, SVG names (case and spaces ignored) and
 * "transparent". Undefined when the color is invalid.
 */
export function qColorFromString(name: string): RGBA | undefined {
  if (name.length === 0) return undefined;
  if (name[0] === "#") {
    if (name.length > 13) return undefined;
    const s = name.slice(1);
    let a = 65535;
    let r: number;
    let g: number;
    let b: number;
    if (s.length === 12) {
      r = hex2int(s, 0, 4);
      g = hex2int(s, 4, 4);
      b = hex2int(s, 8, 4);
    } else if (s.length === 9) {
      r = hex2int(s, 0, 3);
      g = hex2int(s, 3, 3);
      b = hex2int(s, 6, 3);
      if (r < 0 || g < 0 || b < 0) return undefined;
      r = (r << 4) | (r >> 8);
      g = (g << 4) | (g >> 8);
      b = (b << 4) | (b >> 8);
    } else if (s.length === 8) {
      a = hex2int(s, 0, 2) * 0x101;
      r = hex2int(s, 2, 2) * 0x101;
      g = hex2int(s, 4, 2) * 0x101;
      b = hex2int(s, 6, 2) * 0x101;
    } else if (s.length === 6) {
      r = hex2int(s, 0, 2) * 0x101;
      g = hex2int(s, 2, 2) * 0x101;
      b = hex2int(s, 4, 2) * 0x101;
    } else if (s.length === 3) {
      r = hex2int(s, 0, 1) * 0x1111;
      g = hex2int(s, 1, 1) * 0x1111;
      b = hex2int(s, 2, 1) * 0x1111;
    } else {
      return undefined;
    }
    if (r < 0 || g < 0 || b < 0 || a < 0) return undefined;
    return [div257(r), div257(g), div257(b), div257(a)];
  }
  if (name.length > 255) return undefined;
  let key = "";
  for (const ch of name) {
    if (ch !== "\t" && ch !== " ") key += ch.toLowerCase();
  }
  return namedColor(key);
}

// ---------------------------------------------------------------------------
// Wheels and curves
// ---------------------------------------------------------------------------

type Bias = readonly [number, number, number];

const WHITE: RGBA = [255, 255, 255, 255];
const NO_BIAS: Bias = [0, 0, 0];

function isPresent(v: EvaluatedParam | undefined): boolean {
  return v !== undefined;
}

/**
 * `ColorGradeWheelEntry::SetJsonValue` precedence (ColorGrade.cpp:106-122):
 * `*_keyframes` beats the scalar key; a scalar amount/luma is narrowed to
 * float and clamped to ±1; a `color` string replaces white only when valid.
 */
export function wheelBias(entry: Params | undefined): Bias {
  let rgba: RGBA = WHITE;
  let amount = 0;
  let lumaShift = 0;
  if (entry) {
    if (isPresent(entry.color_keyframes)) rgba = color(entry, "color_keyframes", WHITE);
    else if (typeof entry.color === "string") rgba = qColorFromString(entry.color) ?? WHITE;
    if (isPresent(entry.amount_keyframes)) amount = num(entry, "amount_keyframes", 0);
    else if (isPresent(entry.amount)) amount = num(entry, "amount", 0);
    if (isPresent(entry.luma_keyframes)) lumaShift = num(entry, "luma_keyframes", 0);
    else if (isPresent(entry.luma)) lumaShift = num(entry, "luma", 0);
  }
  // GetColor: QColor(GetInt(r), GetInt(g), GetInt(b), GetInt(a)), invalid
  // (redF() == 0) unless every channel is 0..255 (build_wheel_bias, :72-85).
  const ints = rgba.map(getInt);
  const valid = ints.every((v) => v >= 0 && v <= 255);
  const cr = valid ? f32((ints[0]! * 257) / 65535) : 0;
  const cg = valid ? f32((ints[1]! * 257) / 65535) : 0;
  const cb = valid ? f32((ints[2]! * 257) / 65535) : 0;
  const avg = f32(f32(f32(cr + cg) + cb) / 3);
  const a = clampF(f32(amount), -1, 1);
  const l = clampF(f32(lumaShift), -1, 1);
  return [fmaf(f32(cr - avg), a, l), fmaf(f32(cg - avg), a, l), fmaf(f32(cb - avg), a, l)];
}

/**
 * `ColorGradeWheelsData` (ColorGrade.cpp:154-176): a boolean `enabled` beats
 * `enabled_keyframes` (so an animated enable is lost on reload); a numeric
 * `enabled` is ignored. Default enabled.
 */
function wheelsEnabled(wheels: Params | undefined): boolean {
  let value = 1;
  if (wheels) {
    if (typeof wheels.enabled === "boolean") value = wheels.enabled ? 1 : 0;
    else if (isPresent(wheels.enabled_keyframes)) value = num(wheels, "enabled_keyframes", 0);
  }
  return value >= 0.5;
}

/** AnimatedCurve defaults: enabled, identity nodes (0,0)-(1,1) LINEAR (AnimatedCurve.cpp:103-107). */
let identityTable: readonly number[] | undefined;

interface CurveParam {
  enabled: number;
  /** `clamp01(BuildCurve(frame, 255).GetValue(i))`. */
  table: readonly number[];
}

/**
 * An evaluated `curve_*` parameter: `{ enabled, table }` from the planner,
 * or a partial object (no `nodes` in the JSON: libopenshot keeps the
 * default nodes), or nothing (the constructor default).
 */
function curveParam(params: Params, key: string): CurveParam {
  identityTable ??= evaluateAnimatedCurve(undefined, 1).table;
  const v = record(params, key);
  if (!v) return { enabled: 1, table: identityTable };
  const table = numbers(v, "table");
  return { enabled: num(v, "enabled", 1), table: table && table.length >= 256 ? table : identityTable };
}

/** `build_curve_lut` (ColorGrade.cpp:53-66). */
function curveLut(curve: CurveParam): Float32Array {
  const lut = new Float32Array(256);
  if (curve.enabled < 0.5) {
    for (let i = 0; i < 256; i += 1) lut[i] = f32(i * INV_255);
  } else {
    for (let i = 0; i < 256; i += 1) lut[i] = f32(curve.table[i]!);
  }
  return lut;
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

/** ColorGrade's internal ColorMap: intensity = lut_intensity, per-channel 1 (ColorGrade.cpp:208-220). */
function lutStage(image: PremulImage, ctx: KernelContext, path: string, intensity: number): void {
  if (path === "" || !(intensity > 0)) return;
  const lut = lutForPath(ctx, path);
  if (lut) applyCubeLut(image, lut, intensity, 1, 1, 1);
}

export const colorGrade: KernelSpec = {
  type: "ColorGrade",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): void {
    const temperature = clampF(f32(num(params, "temperature", 0)), -1, 1);
    const tint = clampF(f32(num(params, "tint", 0)), -1, 1);
    const exposure = clampF(f32(num(params, "exposure", 0)), -4, 4);
    const contrast = clampF(f32(num(params, "contrast", 0)), -1, 2);
    const highlights = clampF(f32(num(params, "highlights", 0)), -1, 1);
    const shadows = clampF(f32(num(params, "shadows", 0)), -1, 1);
    const saturation = clampF(f32(num(params, "saturation", 1)), 0, 4);
    const vibrance = clampF(f32(num(params, "vibrance", 0)), -1, 1);
    const mix = clampF(f32(num(params, "mix", 1)), 0, 1);
    const inverseMix = f32(1 - mix);
    const wheels = record(params, "wheels");
    const useWheels = wheelsEnabled(wheels);
    const curves = [curveParam(params, "curve_all"), curveParam(params, "curve_red"), curveParam(params, "curve_green"), curveParam(params, "curve_blue")];
    const lutPath = str(params, "lut_path", "");
    const lutIntensity = num(params, "lut_intensity", 1);

    // Fast path (ColorGrade.cpp:238-252): only the LUT runs.
    if (
      temperature === 0 &&
      tint === 0 &&
      exposure === 0 &&
      contrast === 0 &&
      highlights === 0 &&
      shadows === 0 &&
      saturation === 1 &&
      vibrance === 0 &&
      mix === 1 &&
      !useWheels &&
      curves.every((c) => c.enabled < 0.5)
    ) {
      lutStage(image, ctx, lutPath, lutIntensity);
      return;
    }

    const gain = appleExp2f(exposure);
    const contrastFactor = clampF(f32(1 + contrast), 0, Infinity);
    const [lutAll, lutRed, lutGreen, lutBlue] = curves.map(curveLut) as [Float32Array, Float32Array, Float32Array, Float32Array];
    const [gR, gG, gB] = useWheels ? wheelBias(record(wheels!, "global")) : NO_BIAS;
    const [sR, sG, sB] = useWheels ? wheelBias(record(wheels!, "shadows")) : NO_BIAS;
    const [mR, mG, mB] = useWheels ? wheelBias(record(wheels!, "midtones")) : NO_BIAS;
    const [hR, hG, hB] = useWheels ? wheelBias(record(wheels!, "highlights")) : NO_BIAS;
    const minusTint = -tint;

    const d = image.data;
    const memoRgb = new Int32Array(1 << MEMO_BITS).fill(-1);
    const memoOut = new Int32Array(1 << MEMO_BITS);
    for (let i = 0; i < d.length; i += 4) {
      const A = d[i + 3]!;
      if (A === 0) continue;
      let R: number;
      let G: number;
      let B: number;
      let rgb = -1;
      let slot = 0;
      if (A === 255) {
        rgb = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
        slot = Math.imul(rgb, 0x9e3779b1) >>> (32 - MEMO_BITS);
        if (memoRgb[slot] === rgb) {
          const out = memoOut[slot]!;
          d[i] = out >>> 16;
          d[i + 1] = (out >>> 8) & 255;
          d[i + 2] = out & 255;
          continue;
        }
        R = f32(d[i]! * INV_255);
        G = f32(d[i + 1]! * INV_255);
        B = f32(d[i + 2]! * INV_255);
      } else {
        const inv = INV_ALPHA[A]!;
        R = f32(f32(d[i]! * inv) * INV_255);
        G = f32(f32(d[i + 1]! * inv) * INV_255);
        B = f32(f32(d[i + 2]! * inv) * INV_255);
      }
      const origR = R;
      const origG = G;
      const origB = B;

      // White balance (:311-315).
      R = clamp01(fmaf(temperature, 0.125, R));
      B = clamp01(fmaf(-temperature, 0.125, B));
      G = clamp01(fmaf(TINT_G, minusTint, G));
      R = clamp01(fmaf(tint, TINT_RB, R));
      B = clamp01(fmaf(TINT_RB, tint, B));

      // Exposure and contrast (:318-324).
      R = clamp01(f32(R * gain));
      G = clamp01(f32(G * gain));
      B = clamp01(f32(B * gain));
      R = clamp01(fmaf(f32(R - 0.5), contrastFactor, 0.5));
      G = clamp01(fmaf(f32(G - 0.5), contrastFactor, 0.5));
      B = clamp01(fmaf(f32(B - 0.5), contrastFactor, 0.5));

      // Shadows/highlights recovery (:326-335).
      let L = luma(R, G, B);
      const dark = f32(1 - L);
      const shadowAdjust = f32(f32(shadows * f32(dark * dark)) * RECOVERY);
      const highlightAdjust = f32(f32(highlights * f32(L * L)) * RECOVERY);
      R = clamp01(f32(f32(R + shadowAdjust) + highlightAdjust));
      G = clamp01(f32(f32(G + shadowAdjust) + highlightAdjust));
      B = clamp01(f32(f32(B + shadowAdjust) + highlightAdjust));

      // Tonal wheels (:338-350); a weight with |w| <= 1e-5 is skipped.
      if (useWheels) {
        L = luma(R, G, B);
        R = f32(R + gR);
        G = f32(G + gG);
        B = f32(B + gB);
        const lo = f32(1 - L);
        let w = f32(lo * lo);
        if (Math.abs(w) > EPSILON) {
          R = fmaf(sR, w, R);
          G = fmaf(sG, w, G);
          B = fmaf(sB, w, B);
        }
        const centered = f32(Math.abs(f32(L - 0.5)) * 2);
        w = clamp01(f32(1 - centered * centered));
        if (w > EPSILON) {
          R = fmaf(mR, w, R);
          G = fmaf(mG, w, G);
          B = fmaf(mB, w, B);
        }
        w = f32(L * L);
        if (Math.abs(w) > EPSILON) {
          R = fmaf(hR, w, R);
          G = fmaf(hG, w, G);
          B = fmaf(hB, w, B);
        }
      }
      R = clamp01(R);
      G = clamp01(G);
      B = clamp01(B);

      // Saturation and vibrance (:353-361).
      L = luma(R, G, B);
      const maxC = R < (G < B ? B : G) ? (G < B ? B : G) : R;
      const minC = (B < G ? B : G) < R ? (B < G ? B : G) : R;
      const vibranceFactor = fmaf(vibrance, f32(1 - f32(maxC - minC)), 1);
      const satFactor = f32(saturation * (vibranceFactor > 0 ? vibranceFactor : 0));
      R = clamp01(fmaf(f32(R - L), satFactor, L));
      G = clamp01(fmaf(f32(G - L), satFactor, L));
      B = clamp01(fmaf(f32(B - L), satFactor, L));

      // Curves (:364-369).
      R = sampleCurve(lutRed, sampleCurve(lutAll, R));
      G = sampleCurve(lutGreen, sampleCurve(lutAll, G));
      B = sampleCurve(lutBlue, sampleCurve(lutAll, B));

      // Mix (:372-374) and re-premultiply (:376-384).
      R = clamp01(fmaf(origR, inverseMix, f32(R * mix)));
      G = clamp01(fmaf(origG, inverseMix, f32(G * mix)));
      B = clamp01(fmaf(origB, inverseMix, f32(B * mix)));
      if (A === 255) {
        const r8 = clampByte(f32(R * 255));
        const g8 = clampByte(f32(G * 255));
        const b8 = clampByte(f32(B * 255));
        d[i] = r8;
        d[i + 1] = g8;
        d[i + 2] = b8;
        memoRgb[slot] = rgb;
        memoOut[slot] = (r8 << 16) | (g8 << 8) | b8;
      } else {
        const ap = f32(A * INV_255);
        d[i] = clampByte(f32(f32(R * 255) * ap));
        d[i + 1] = clampByte(f32(f32(G * 255) * ap));
        d[i + 2] = clampByte(f32(f32(B * 255) * ap));
      }
    }

    lutStage(image, ctx, lutPath, lutIntensity);
  },
};
