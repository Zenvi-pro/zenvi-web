/**
 * Frame statistics for grading and checking effects: the scopes as numbers.
 *
 * Port of zenvi-core develop (1f80cb3d0) src/classes/editor_tools/
 * effects_color_analysis.py (`scope_data`, `frame_pixels`, `pixel_stats`,
 * `compute_stats`, `_verdict`, `_suggest`, `_region_arg`, and the green/blue
 * screen helpers `screen_color_from_histograms`, `screen_fuzz_from_histograms`,
 * `screen_from_scopes`). The scopes come from the FrameScope port
 * (render/frame-scope.ts) on a premultiplied frame, as on the desktop.
 */

import { pyRound } from "../model/rounding.js";
import { analyzeFrameScope, type ScopeRegion } from "../render/frame-scope.js";
import { unpremultiply, type PremulImage } from "../render/pixels.js";
import { smoothScale } from "../render/qt/smooth-scale.js";
import { parsePythonFloat } from "./coerce.js";
import { pyFixed } from "./pyfmt.js";

/** FrameScope's vectorscope axes (libopenshot FrameScope.cpp kVectorscopeUMax / VMax). */
const U_MAX = 0.436;
const V_MAX = 0.615;

/** `round(x, n)` (correctly rounded, ties to even on the binary value). */
export function roundTo(x: number, digits: number): number {
  return Number(pyFixed(x, digits));
}

/** What `scope_data` hands `compute_stats`. */
export interface ScopeData {
  luma: number[];
  red: number[];
  green: number[];
  blue: number[];
  vectorscope: number[];
  vectorscope_size: number;
  clipped_shadows: number;
  clipped_highlights: number;
  total_pixels: number;
  width: number;
  height: number;
}

/** A caller-side problem with the analysis (the desktop's ToolError). */
export class AnalysisError extends Error {
  override readonly name = "AnalysisError";
}

/** effects_color_analysis.scope_data: FrameScope histograms and a 128² vectorscope for a frame or a region. */
export function scopeData(frame: PremulImage, region?: ScopeRegion | null): ScopeData {
  const scope = analyzeFrameScope(frame, { vectorscopeSize: 128, ...(region ? { region } : {}) });
  if (!scope) throw new AnalysisError("the rendered frame has no picture");
  const area = region ? region.width * region.height : 1.0;
  return {
    luma: Array.from(scope.luma),
    red: Array.from(scope.red),
    green: Array.from(scope.green),
    blue: Array.from(scope.blue),
    vectorscope: Array.from(scope.vectorscope),
    vectorscope_size: scope.vectorscopeSize,
    clipped_shadows: scope.clippedShadows,
    clipped_highlights: scope.clippedHighlights,
    total_pixels: pyRound(frame.width * frame.height * area),
    width: frame.width,
    height: frame.height,
  };
}

/** `_percentile(hist, q)`: the bin (0-1) where the running count reaches q of the total. */
export function percentile(hist: readonly number[], q: number): number {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0.0;
  const target = q * total;
  let run = 0;
  for (let i = 0; i < hist.length; i += 1) {
    run += hist[i]!;
    if (run >= target) return i / (hist.length - 1);
  }
  return 1.0;
}

/** `_mean(hist)` on the 0-1 scale. */
export function histMean(hist: readonly number[]): number {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return 0.0;
  let sum = 0;
  hist.forEach((n, i) => (sum += i * n));
  return sum / total / (hist.length - 1);
}

/** QSize::scaled(…, Qt::KeepAspectRatio). */
function keepAspect(w: number, h: number, tw: number, th: number): [number, number] {
  if (w === 0 || h === 0) return [tw, th];
  const rh = Math.trunc((tw * h) / w);
  if (rh <= th) return [tw, rh];
  return [Math.trunc((th * w) / h), th];
}

export type RgbaTuple = [number, number, number, number];

/**
 * effects_color_analysis.frame_pixels: a small straight-RGBA sample of the
 * frame (`Frame.Save(path, scale)` = Qt's smooth scale to `targetWidth`
 * wide, read back), limited to `region`.
 */
export function framePixels(frame: PremulImage, region?: ScopeRegion | null, targetWidth = 160): RgbaTuple[] {
  const width = Math.max(1, frame.width);
  const scale = Math.min(1.0, targetWidth / width);
  let image: PremulImage = frame;
  if (Math.abs(scale) > 1.001 || Math.abs(scale) < 0.999) {
    const [tw, th] = keepAspect(frame.width, frame.height, Math.trunc(frame.width * scale), Math.trunc(frame.height * scale));
    if (tw > 0 && th > 0) image = smoothScale(frame, tw, th);
  }
  const straight = unpremultiply(image);
  const w = straight.width;
  const h = straight.height;
  let [x0, y0, x1, y1] = [0, 0, w, h];
  if (region) {
    x0 = Math.trunc(region.x * w);
    y0 = Math.trunc(region.y * h);
    x1 = Math.max(x0 + 1, pyRound((region.x + region.width) * w));
    y1 = Math.max(y0 + 1, pyRound((region.y + region.height) * h));
  }
  const out: RgbaTuple[] = [];
  const d = straight.data;
  for (let y = y0; y < Math.min(y1, h); y += 1) {
    for (let x = x0; x < Math.min(x1, w); x += 1) {
      const o = (y * w + x) * 4;
      out.push([d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!]);
    }
  }
  return out;
}

export interface PixelStats {
  saturation_mean: number;
  saturation_p90: number;
  neutral_pct: number;
  neutral_rgb?: [number, number, number];
  neutral_warmth?: number;
  neutral_green_magenta?: number;
}

/** effects_color_analysis.pixel_stats: HSV saturation and the white balance of near-neutral mid-tones. */
export function pixelStats(pixels: readonly RgbaTuple[]): PixelStats | null {
  const sats: number[] = [];
  const neutral: [number, number, number, number] = [0.0, 0.0, 0.0, 0];
  for (const [r8, g8, b8, a] of pixels) {
    if (a < 128) continue;
    const r = r8 / 255.0;
    const g = g8 / 255.0;
    const b = b8 / 255.0;
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    const sat = hi > 0 ? (hi - lo) / hi : 0.0;
    sats.push(sat);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma >= 0.25 && luma <= 0.92 && sat < 0.25) {
      neutral[0] += r;
      neutral[1] += g;
      neutral[2] += b;
      neutral[3] += 1;
    }
  }
  if (sats.length === 0) return null;
  let sum = 0;
  for (const s of sats) sum += s;
  sats.sort((a, b) => a - b);
  const out: PixelStats = {
    saturation_mean: roundTo(sum / sats.length, 3),
    saturation_p90: roundTo(sats[Math.min(sats.length - 1, Math.trunc(0.9 * sats.length))]!, 3),
    neutral_pct: roundTo((100.0 * neutral[3]) / sats.length, 1),
  };
  if (neutral[3] >= Math.max(20, 0.03 * sats.length)) {
    const [nr, ng, nb] = [neutral[0] / neutral[3], neutral[1] / neutral[3], neutral[2] / neutral[3]];
    out.neutral_rgb = [roundTo(nr, 3), roundTo(ng, 3), roundTo(nb, 3)];
    out.neutral_warmth = roundTo(nr - nb, 3);
    out.neutral_green_magenta = roundTo(ng - (nr + nb) / 2.0, 3);
  }
  return out;
}

const PERCENTILES: readonly [string, number][] = [
  ["p1", 0.01],
  ["p5", 0.05],
  ["p25", 0.25],
  ["p50", 0.5],
  ["p75", 0.75],
  ["p95", 0.95],
  ["p99", 0.99],
];

/** compute_stats' result (keys in the desktop's order). */
export type FrameStats = Record<string, unknown> & {
  luma?: Record<string, number>;
  verdict?: string[];
  suggested_grade?: Record<string, number>;
};

/** effects_color_analysis.compute_stats: the numbers a colorist reads off the scopes. */
export function computeStats(d: ScopeData, pixels?: PixelStats | null): FrameStats {
  const luma = d.luma;
  const counted = luma.reduce((a, b) => a + b, 0);
  if (counted <= 0) return { transparent_pct: 100.0, note: "every pixel is transparent" };
  const pct: Record<string, number> = {};
  for (const [key, q] of PERCENTILES) pct[key] = roundTo(percentile(luma, q), 3);
  const meanRgb = [d.red, d.green, d.blue].map((h) => roundTo(histMean(h), 3)) as [number, number, number];
  const [r, g, b] = meanRgb;
  const warmth = roundTo(r - b, 3);
  const greenMagenta = roundTo(g - (r + b) / 2.0, 3);
  const size = Math.trunc(Number(d.vectorscope_size) || 0);
  const vec = d.vectorscope ?? [];
  const chromaHist = new Array<number>(101).fill(0);
  let nu = 0.0;
  let nv = 0.0;
  let nn = 0.0;
  if (size > 1 && vec.length === size * size) {
    const c = (size - 1) / 2.0;
    vec.forEach((n, idx) => {
      if (!n) return;
      const y = Math.floor(idx / size);
      const x = idx % size;
      const u = ((x - c) / c) * U_MAX;
      const v = ((c - y) / c) * V_MAX;
      const chroma = Math.hypot(u, v);
      chromaHist[Math.min(100, Math.trunc(pyRound(chroma / 0.005)))]! += n;
      if (chroma < 0.06) {
        nu += u * n;
        nv += v * n;
        nn += n;
      }
    });
  }
  const chromaTotal = chromaHist.reduce((a, x) => a + x, 0);
  let chromaSum = 0;
  chromaHist.forEach((n, i) => (chromaSum += i * 0.005 * n));
  const chromaMean = chromaTotal ? chromaSum / chromaTotal : 0.0;
  const gray = chromaTotal ? chromaHist.slice(0, 7).reduce((a, x) => a + x, 0) / chromaTotal : 0.0;
  let cast = "neutral";
  let neutralUv: [number, number] | null = null;
  if (pixels && pixels.neutral_warmth !== undefined) {
    const w = pixels.neutral_warmth;
    const gm = pixels.neutral_green_magenta!;
    if (Math.max(Math.abs(w), Math.abs(gm)) >= 0.025) {
      if (Math.abs(w) >= Math.abs(gm)) cast = w > 0 ? "warm (orange)" : "cool (blue)";
      else cast = gm > 0 ? "green" : "magenta";
    }
  } else if (chromaTotal && nn / chromaTotal >= 0.05) {
    // U > 0 = blue, U < 0 = yellow/orange; V > 0 = red/magenta, V < 0 = green.
    neutralUv = [nu / nn, nv / nn];
    const [mu, mv] = neutralUv;
    if (Math.max(Math.abs(mu), Math.abs(mv)) >= 0.008) {
      if (Math.abs(mu) >= Math.abs(mv)) cast = mu > 0 ? "cool (blue)" : "warm (orange)";
      else cast = mv > 0 ? "magenta" : "green";
    }
  } else if (Math.abs(warmth) >= 0.04 || Math.abs(greenMagenta) >= 0.04) {
    // Few neutral pixels: fall back to the mean RGB.
    if (Math.abs(warmth) >= Math.abs(greenMagenta)) cast = warmth > 0 ? "warm (orange)" : "cool (blue)";
    else cast = greenMagenta > 0 ? "green" : "magenta";
  }
  const total = Math.max(Math.trunc(Number(d.total_pixels) || counted), counted);
  const stats: FrameStats = {
    luma: { ...pct, mean: roundTo(histMean(luma), 3) },
    clipped_shadows_pct: roundTo((100.0 * (d.clipped_shadows ?? 0)) / counted, 2),
    clipped_highlights_pct: roundTo((100.0 * (d.clipped_highlights ?? 0)) / counted, 2),
    mean_rgb: meanRgb,
    warmth,
    green_magenta: greenMagenta,
    cast,
    neutral_tint_uv: neutralUv ? [roundTo(neutralUv[0], 4), roundTo(neutralUv[1], 4)] : null,
    chroma_mean: roundTo(chromaMean, 4),
    chroma_p90: roundTo(percentile(chromaHist, 0.9) * 0.5, 4),
    gray_pct: roundTo(100.0 * gray, 1),
    transparent_pct: roundTo(100.0 * (1.0 - counted / total), 1),
  };
  if (pixels) Object.assign(stats, pixels);
  stats.verdict = verdict(stats);
  stats.suggested_grade = suggest(stats);
  return stats;
}

function num(stats: Record<string, unknown>, key: string): number {
  return Number(stats[key]);
}

/** `_verdict`: the frame in plain words. */
export function verdict(s: FrameStats): string[] {
  const out: string[] = [];
  const luma = s.luma!;
  const p50 = luma.p50!;
  const p95 = luma.p95!;
  const p5 = luma.p5!;
  if (p50 < 0.28) out.push(`underexposed (median luma ${pyFixed(p50, 2)})`);
  else if (p50 > 0.65) out.push(`overexposed (median luma ${pyFixed(p50, 2)})`);
  else out.push(`exposure ok (median luma ${pyFixed(p50, 2)})`);
  if (num(s, "clipped_highlights_pct") > 2) out.push(`highlights clipped (${pyFixed(num(s, "clipped_highlights_pct"), 1)}%)`);
  if (num(s, "clipped_shadows_pct") > 5) out.push(`crushed shadows (${pyFixed(num(s, "clipped_shadows_pct"), 1)}%)`);
  if (p95 - p5 < 0.4) out.push(`flat / low contrast (p5-p95 ${pyFixed(p95 - p5, 2)})`);
  else if (p95 - p5 > 0.9) out.push("very high contrast");
  const sat = typeof s.saturation_mean === "number" ? s.saturation_mean : null;
  if (num(s, "gray_pct") > 97) out.push("black and white");
  else if ((sat !== null && sat < 0.12) || (sat === null && num(s, "chroma_mean") < 0.03)) out.push("muted colors");
  else if ((sat !== null && sat > 0.55) || (sat === null && num(s, "chroma_mean") > 0.14)) out.push("very saturated");
  if (s.cast !== "neutral") out.push(`${String(s.cast)} cast`);
  return out;
}

const clamp = (lo: number, hi: number, x: number): number => Math.max(lo, Math.min(hi, x));

/** `_suggest`: heuristic color_grade_clip_tool values toward a neutral, well-exposed frame. */
export function suggest(s: FrameStats): Record<string, number> {
  const out: Record<string, number> = {};
  const p50 = s.luma!.p50!;
  if ((p50 < 0.3 || p50 > 0.62) && p50 > 0.005) out.exposure = roundTo(clamp(-1.5, 1.5, 0.8 * Math.log2(0.45 / p50)), 2);
  if (num(s, "clipped_highlights_pct") > 2) out.highlights = -0.25;
  if (num(s, "clipped_shadows_pct") > 5) out.shadows = 0.15;
  if (s.luma!.p95! - s.luma!.p5! < 0.4) out.contrast = 0.2;
  const uv = s.neutral_tint_uv as [number, number] | null | undefined;
  if (s.neutral_warmth !== undefined) {
    if (s.cast !== "neutral") {
      if (Math.abs(num(s, "neutral_warmth")) >= 0.025) out.temperature = roundTo(clamp(-0.4, 0.4, -3.0 * num(s, "neutral_warmth")), 2);
      if (Math.abs(num(s, "neutral_green_magenta")) >= 0.025) out.tint = roundTo(clamp(-0.4, 0.4, 4.0 * num(s, "neutral_green_magenta")), 2);
    }
  } else if (uv && s.cast !== "neutral") {
    if (Math.abs(uv[0]) >= 0.008) out.temperature = roundTo(clamp(-0.4, 0.4, 12.0 * uv[0]), 2);
    if (Math.abs(uv[1]) >= 0.008) out.tint = roundTo(clamp(-0.4, 0.4, -12.0 * uv[1]), 2);
  } else if (s.cast !== "neutral") {
    if (Math.abs(num(s, "warmth")) >= 0.04) out.temperature = roundTo(clamp(-0.4, 0.4, -2.0 * num(s, "warmth")), 2);
    if (Math.abs(num(s, "green_magenta")) >= 0.04) out.tint = roundTo(clamp(-0.4, 0.4, 3.0 * num(s, "green_magenta")), 2);
  }
  if ((s.verdict ?? verdict(s)).includes("muted colors")) out.saturation = 1.25;
  return out;
}

/** Python `float(x)` for a JSON value, or null. */
function toFloat(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") return parsePythonFloat(value);
  return null;
}

/** `_region_arg`: a validated {x, y, width, height} (fractions of the frame), or null for none. */
export function regionArg(region: unknown): ScopeRegion | null {
  if (region === null || region === undefined || region === "" || (typeof region === "object" && Object.keys(region as object).length === 0)) {
    return null;
  }
  if (typeof region !== "object" || Array.isArray(region)) {
    throw new AnalysisError('region is {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5} (fractions of the frame)');
  }
  const raw = region as Record<string, unknown>;
  const values = (["x", "y", "width", "height"] as const).map((k) => toFloat(raw[k]));
  if (values.some((v) => v === null)) throw new AnalysisError("region needs x, y, width, height as fractions 0-1 of the frame");
  const [x, y, width, height] = values as [number, number, number, number];
  if (
    !(x >= 0 && x < 1 && y >= 0 && y < 1 && width > 0 && width <= 1 && height > 0 && height <= 1 && x + width <= 1.0001 && y + height <= 1.0001)
  ) {
    throw new AnalysisError("region must lie inside the frame (x, y, width, height are fractions 0-1)");
  }
  return { x, y, width, height };
}

// ---------------------------------------------------------------------------
// Green / blue screens (chroma_key_clip_tool)
// ---------------------------------------------------------------------------

/** The left, right and top strips of the frame (`_EDGE_STRIPS`). */
export const EDGE_STRIPS: readonly ScopeRegion[] = [
  { x: 0.0, y: 0.0, width: 0.08, height: 1.0 },
  { x: 0.92, y: 0.0, width: 0.08, height: 1.0 },
  { x: 0.0, y: 0.0, width: 1.0, height: 0.08 },
];

/** The whole frame as a 6×4 grid (`_GRID`): a screen that misses the edges is found by its cells. */
export const GRID: readonly ScopeRegion[] = Array.from({ length: 24 }, (_, i) => {
  const r = Math.floor(i / 6);
  const c = i % 6;
  return { x: c / 6.0, y: r / 4.0, width: 1 / 6.0, height: 1 / 4.0 };
});

const MIN_SCREEN_CELLS = 3;

type ChannelHists = Pick<ScopeData, "red" | "green" | "blue">;

function summed(hists: readonly ChannelHists[], channel: "red" | "green" | "blue"): number[] {
  const total = new Array<number>(256).fill(0);
  for (const h of hists) h[channel].forEach((n, i) => (total[i]! += n));
  return total;
}

/** `screen_color_from_histograms`: per-channel medians → [#rrggbb, 'green' | 'blue' | null]. */
export function screenColorFromHistograms(hists: readonly ChannelHists[]): [string, "green" | "blue" | null] {
  const [r, g, b] = (["red", "green", "blue"] as const).map((c) => pyRound(percentile(summed(hists, c), 0.5) * 255)) as [number, number, number];
  let kind: "green" | "blue" | null = null;
  if (g > 60 && g - Math.max(r, b) >= 30) kind = "green";
  else if (b > 60 && b - Math.max(r, g) >= 30) kind = "blue";
  return [`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`, kind];
}

/** `screen_fuzz_from_histograms`: ChromaKey fuzz for the colours' spread (an even screen keys at ~20). */
export function screenFuzzFromHistograms(hists: readonly ChannelHists[]): number {
  let spread = 0.0;
  for (const channel of ["red", "green", "blue"] as const) {
    const total = summed(hists, channel);
    spread = Math.max(spread, (percentile(total, 0.9) - percentile(total, 0.1)) * 255);
  }
  // Live on a patchy screen: spread 22 -> fuzz 33 keyed 69%, fuzz 55 keyed 91% (edges under-sample mid-frame patches).
  return Math.max(20, Math.min(80, pyRound(15 + 1.6 * spread)));
}

/**
 * `screen_from_scopes`: [#rrggbb, where, fuzz] of the green/blue screen in a
 * frame's edge and grid histograms, or null. The edges decide when they are
 * that screen; otherwise the grid cells of the screen colour do, the most
 * even half of them (cells the subject reaches into would widen the fuzz).
 */
export function screenFromScopes(
  edges: readonly ChannelHists[],
  grid: readonly ChannelHists[],
  kind: "green" | "blue" | null = null,
): [string, string, number] | null {
  const [color, edgeKind] = screenColorFromHistograms(edges);
  if (edgeKind && (kind === null || kind === edgeKind)) return [color, `${edgeKind} screen at the frame edges`, screenFuzzFromHistograms(edges)];
  const cells: Record<"green" | "blue", ChannelHists[]> = { green: [], blue: [] };
  for (const h of grid) {
    const cellKind = screenColorFromHistograms([h])[1];
    if (cellKind) cells[cellKind].push(h);
  }
  // max() keeps the first of equal counts: green.
  const found = kind ?? (cells.blue.length > cells.green.length ? "blue" : "green");
  const screen = cells[found];
  if (screen.length < MIN_SCREEN_CELLS) return null;
  const even = [...screen]
    .map((h, i) => ({ h, i, fuzz: screenFuzzFromHistograms([h]) }))
    .sort((a, b) => a.fuzz - b.fuzz || a.i - b.i)
    .slice(0, Math.max(1, Math.floor(screen.length / 2)))
    .map((e) => e.h);
  const evenColor = screenColorFromHistograms(even)[0];
  return [evenColor, `${found} screen in ${screen.length} of ${grid.length} frame areas`, screenFuzzFromHistograms(even)];
}
