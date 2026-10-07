/**
 * AudioVisualization, ported from libopenshot 1.0
 * src/effects/AudioVisualization.cpp:440-907: nine modes (waveform, filled
 * waveform, bars, radial, spectrum, phase scope, particles, VU meter, radial
 * bars) drawn from this frame's audio over a Source / transparent / solid /
 * fade / gradient background. `Clip.waveform` clips use the same kernel
 * (Clip::apply_waveform, Clip.cpp:1472-1520: style Minimal on a transparent
 * timeline-sized canvas); the planner emits that EffectInstance.
 *
 * The analysis (`audio-visualization-analysis.ts`) and every geometry
 * expression follow the arm64 build bit for bit (fused float and double
 * multiply-adds where clang emitted them). Drawing goes through a port of the
 * QPainter raster paths the effect uses (`audio-visualization-paint.ts`).
 */

import { clonePremul, createPremul, type PremulImage } from "../pixels.js";
import { fma, fmaf } from "../qt/fma.js";
import { smoothScale } from "../qt/smooth-scale.js";
import type { KernelAudio, KernelContext } from "../types.js";
import {
  bandLevel,
  bucketSamples,
  clampf,
  clampi,
  f32,
  frameSampleCount,
  lround,
  mt19937Floats,
  normalizedFrequencyToHz,
  reactiveLevel,
  spectrumBins,
} from "./audio-visualization-analysis.js";
import {
  alpha8,
  alphaColor,
  hueShift,
  makePalette,
  mixColor,
  rainbowColor,
  rainbowStops,
  rgb8,
  setColorAt,
  STYLE_MINIMAL,
  styleFillAlpha,
  styleGlowAmount,
  styleStrokeWidth,
  verticalStyleFill,
  type GradientStop,
  type Palette,
  type QtColor,
  type StyleFill,
} from "./audio-visualization-color.js";
import { Painter, type Brush, type Pen } from "./audio-visualization-paint.js";
import { cubicTo, lineTo, moveTo, newPath } from "./audio-visualization-stroke.js";
import { color, getInt, int, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const WAVEFORM = 0;
const FILLED_WAVEFORM = 1;
const BARS = 2;
const RADIAL = 3;
const SPECTRUM = 4;
const PHASE_SCOPE = 5;
const PARTICLES = 6;
const VU_METER = 7;
const RADIAL_BARS = 8;

const LAYOUT_AUTO = 0;
const LAYOUT_SPLIT = 2;
const LAYOUT_OVERLAY = 3;

const BACKGROUND_SOLID = 1;
const BACKGROUND_FADE = 2;
const BACKGROUND_GRADIENT = 3;
const BACKGROUND_SOURCE = 4;

const RAINBOW = 1;

const PI = Math.PI;
const TWO_PI = 2 * Math.PI;
const HALF_PI_NEG = -Math.PI * 0.5;
const GLOW_MIN = f32(0.01);

function fillBrush(fill: StyleFill): Brush {
  return fill.kind === "solid" ? { kind: "solid", color: fill.color } : fill;
}

function solid(c: QtColor): Brush {
  return { kind: "solid", color: c };
}

function horizontal(width: number, stops: GradientStop[]): Brush {
  return { kind: "linear", x1: 0, y1: 0, x2: width, y2: 0, stops };
}

function pen(brush: Brush, width: number, cap: Pen["cap"] = "square", join: Pen["join"] = "bevel"): Pen {
  return { brush, width, cap, join };
}

/** The parameters every mode reads, evaluated like GetFrame's prologue (:453-519). */
interface Setup {
  width: number;
  height: number;
  frame: number;
  audio: KernelAudio | undefined;
  channels: number;
  mode: number;
  style: number;
  colorMode: number;
  smoothing: number;
  detail: number;
  spread: number;
  lowHz: number;
  highHz: number;
  split: boolean;
  overlay: boolean;
  base: QtColor;
  styledGlow: number;
  palette: Palette;
  gain: number;
  stroke: number;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function drawWaveform(p: Painter, s: Setup): void {
  p.antialias = false;
  const { width, height, gain, smoothing, styledGlow, style, spread, base, palette } = s;
  const lanes = s.split || s.overlay ? Math.min(s.channels, 8) : 1;
  const columns = clampi(lround(f32(fmaf(s.detail, 0.25, 0.75) * width)), 16, Math.max(16, width));
  const alphaScale = s.overlay ? f32(0.48) : 1;
  const rainbow = s.colorMode === RAINBOW;
  const lineWidth = s.stroke > 1 ? s.stroke : 1;
  for (let lane = 0; lane < lanes; lane += 1) {
    const values = bucketSamples(s.audio, s.split || s.overlay ? lane : -1, columns, gain, smoothing);
    const size = values.length;
    const laneTop = s.split ? f32((height * lane) / lanes) : 0;
    const laneHeight = s.split ? f32(height / lanes) : height;
    const centerY = fmaf(laneHeight, 0.5, laneTop);
    const amplitude = f32(laneHeight * f32(0.44));
    const laneBase = rainbow
      ? rainbowColor(base, f32(lane / Math.max(1, lanes)), spread)
      : s.overlay
        ? mixColor(base, hueShift(base, lane * 18), f32(spread * f32(0.18)))
        : lane % 2
          ? palette.accent
          : base;
    const lanePalette = makePalette(laneBase, styledGlow, style, spread);

    if (s.mode === FILLED_WAVEFORM) {
      const envelopeOf = (v: number): number => {
        if (v === 0) return 0;
        const m = f32(amplitude * Math.abs(v));
        return m > 1 ? m : 1;
      };
      if (styledGlow > GLOW_MIN) {
        const glowBrush = rainbow ? horizontal(width, rainbowStops(base, spread, f32(f32(0.78) * alphaScale))) : solid(alphaColor(lanePalette.glow, f32(f32(0.78) * alphaScale)));
        const pad = Math.max(1, Math.ceil(f32(styledGlow * 5)));
        for (let i = 0; i < size; i += 4) {
          const x0 = Math.floor((i * width) / size);
          const x1 = Math.floor((Math.min(i + 4, size) * width) / size);
          let envelope = 0;
          for (let j = i; j < Math.min(i + 4, size); j += 1) {
            const e = envelopeOf(values[j]!);
            if (envelope < e) envelope = e;
          }
          const y0 = clampi(Math.floor(f32(centerY - envelope)) - pad, 0, height);
          const y1 = clampi(Math.ceil(f32(centerY + envelope)) + pad, y0 + 1, height);
          p.drawRectI(x0, y0, Math.max(1, x1 - x0), y1 - y0, glowBrush);
        }
      }
      const fill = rainbow
        ? horizontal(width, rainbowStops(base, spread, f32(styleFillAlpha(style) * alphaScale)))
        : fillBrush(verticalStyleFill(0, laneTop, 0, f32(laneTop + laneHeight), lanePalette, style, alphaScale));
      for (let i = 0; i < size; i += 1) {
        const x0 = Math.floor((i * width) / size);
        const x1 = Math.floor(((i + 1) * width) / size);
        const envelope = envelopeOf(values[i]!);
        const y0 = clampi(Math.floor(f32(centerY - envelope)), 0, height);
        const y1 = clampi(Math.ceil(f32(centerY + envelope)), y0 + 1, height);
        p.drawRectI(x0, y0, Math.max(1, x1 - x0), y1 - y0, fill);
      }
      continue;
    }

    const points: number[] = [];
    for (let i = 0; i < size; i += 1) {
      const x = size <= 1 ? 0 : f32(((width - 1) * i) / (size - 1));
      points.push(x, fmaf(-values[i]!, amplitude, centerY));
    }
    const glowWidth = fmaf(styledGlow, 16, lineWidth);
    if (rainbow) {
      if (styledGlow > GLOW_MIN) p.drawPolyline(points, pen(horizontal(width, rainbowStops(base, spread, f32(f32(0.88) * alphaScale))), glowWidth, "flat"));
      p.drawPolyline(points, pen(horizontal(width, rainbowStops(base, spread, alphaScale)), lineWidth, "flat"));
    } else {
      if (styledGlow > GLOW_MIN) p.drawPolyline(points, pen(solid(alphaColor(lanePalette.glow, f32(f32(0.88) * alphaScale))), glowWidth, "flat"));
      p.drawPolyline(points, pen(solid(alphaColor(lanePalette.base, alphaScale)), lineWidth, "flat"));
    }
  }
}

function drawBars(p: Painter, s: Setup): void {
  const { width, height, styledGlow, style, spread, base } = s;
  const bars = clampi(lround(fmaf(s.detail, 112, 16)), 8, Math.max(8, Math.floor(width / 3)));
  const bins = spectrumBins(s.audio, bars, s.gain, s.smoothing, s.lowHz, s.highHz);
  const step = f32(width / bars);
  const g = f32(step * f32(0.18));
  const gap = g > 1 ? g : 1;
  const bw = f32(step - gap);
  const barWidth = bw > 1 ? bw : 1;
  const pitch = f32(gap + barWidth);
  for (let i = 0; i < bars; i += 1) {
    const x = f32(pitch * i);
    const hh = f32(f32(bins[i]! * height) * f32(0.88));
    const h = hh > 1 ? hh : 1;
    const top = f32(height - h);
    const barPalette = s.colorMode === RAINBOW ? makePalette(rainbowColor(base, f32(i / Math.max(1, bars - 1)), spread), styledGlow, style, spread) : s.palette;
    if (styledGlow > GLOW_MIN) {
      // rect.adjusted(-2g, -5g, 2g, 0) in double (QRectF::adjusted).
      const dx1 = f32(styledGlow * -2);
      const dy1 = f32(styledGlow * -5);
      const dx2 = f32(styledGlow * 2);
      p.fillRect(x + dx1, top + dy1, barWidth + dx2 - dx1, h + 0 - dy1, solid(alphaColor(barPalette.glow, f32(0.55))));
    }
    p.fillRect(x, top, barWidth, h, fillBrush(verticalStyleFill(0, top, 0, height, barPalette, style)));
  }
}

function drawSpectrum(p: Painter, s: Setup): void {
  const { width, height, styledGlow, style, spread, base, palette } = s;
  const count = clampi(lround(fmaf(s.detail, 220, 56)), 40, Math.max(40, Math.floor(width / 2)));
  const bins = spectrumBins(s.audio, count, s.gain, s.smoothing, s.lowHz, s.highHz);
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < count; i += 1) {
    px.push(f32((i * width) / Math.max(1, count - 1)));
    const hh = f32(f32(bins[i]! * height) * f32(0.84));
    py.push(f32(height - (hh > 1 ? hh : 1)));
  }
  const ridge = newPath();
  moveTo(ridge, px[0]!, py[0]!);
  for (let i = 0; i + 1 < count; i += 1) {
    const i0 = i === 0 ? i : i - 1;
    const i3 = Math.min(i + 2, count - 1);
    const c1x = (px[i + 1]! - px[i0]!) / 6 + px[i]!;
    const c1y = (py[i + 1]! - py[i0]!) / 6 + py[i]!;
    const c2x = px[i + 1]! - (px[i3]! - px[i]!) / 6;
    const c2y = py[i + 1]! - (py[i3]! - py[i]!) / 6;
    cubicTo(ridge, c1x, c1y, c2x, c2y, px[i + 1]!, py[i + 1]!);
  }
  const terrain = s.colorMode === RAINBOW ? horizontal(width, rainbowStops(base, spread, styleFillAlpha(style))) : fillBrush(verticalStyleFill(0, 0, 0, height, palette, style));
  if (count > 1) {
    const layer = createPremul(width, height);
    new Painter(layer).fillRect(0, 0, width, height, terrain);
    const mask = createPremul(width, height);
    const maskPainter = new Painter(mask);
    const white = pen(solid(rgb8(255, 255, 255)), 1);
    for (let x = 0; x < width; x += 1) {
      const position = f32(f32(x * (count - 1)) / Math.max(1, width - 1));
      const index = clampi(Math.floor(position), 0, count - 2);
      const mix = f32(position - index);
      const y = f32(fma(py[index]!, f32(1 - mix), py[index + 1]! * mix));
      const lx = f32(x + 0.5);
      maskPainter.drawLine(lx, y, lx, height, white);
    }
    const layerPainter = new Painter(layer);
    layerPainter.drawImageDestinationIn(mask);
    p.drawImageSourceOver(layer);
  }
  const rs = f32(s.stroke * f32(0.75));
  const ridgeWidth = rs > 1 ? rs : 1;
  if (s.colorMode === RAINBOW) {
    if (styledGlow > GLOW_MIN) p.drawPath(ridge, pen(horizontal(width, rainbowStops(base, spread, f32(0.45))), fmaf(styledGlow, 10, ridgeWidth), "round", "round"));
    p.drawPath(ridge, pen(horizontal(width, rainbowStops(base, spread)), ridgeWidth, "round", "round"));
  } else {
    // draw_glow_path (:380-389) with glow = styled_glow * 0.55f.
    const glow = f32(styledGlow * f32(0.55));
    if (glow > GLOW_MIN) p.drawPath(ridge, pen(solid(palette.glow), fmaf(glow, 18, ridgeWidth), "round", "round"));
    p.drawPath(ridge, pen(solid(palette.base), ridgeWidth, "round", "round"));
  }
}

function drawRadial(p: Painter, s: Setup): void {
  const { width, height, styledGlow, spread, base, palette, stroke } = s;
  const segments = clampi(lround(fmaf(s.detail, 192, 48)), 24, 256);
  const bins = spectrumBins(s.audio, segments, s.gain, s.smoothing, s.lowHz, s.highHz);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const radius = f32(Math.min(width, height) * f32(0.24));
  const ring = newPath();
  for (let i = 0; i <= segments; i += 1) {
    const angle = (TWO_PI * i) / segments + HALF_PI_NEG;
    const r = fmaf(bins[i % segments]!, radius, radius);
    const x = fma(Math.cos(angle), r, cx);
    const y = fma(Math.sin(angle), r, cy);
    if (i === 0) moveTo(ring, x, y);
    else lineTo(ring, x, y);
  }
  let stops: GradientStop[];
  if (s.colorMode === RAINBOW) stops = rainbowStops(base, spread);
  else {
    stops = [];
    setColorAt(stops, 0, palette.base);
    setColorAt(stops, 0.45, palette.light);
    setColorAt(stops, 1, palette.accent);
  }
  if (styledGlow > GLOW_MIN) {
    const glowBrush: Brush = s.colorMode === RAINBOW ? { kind: "conical", cx, cy, angle: -90, stops: rainbowStops(base, spread, f32(0.48)) } : solid(palette.glow);
    p.drawPath(ring, pen(glowBrush, fmaf(styledGlow, 16, stroke), "round", "round"));
  }
  p.drawPath(ring, pen({ kind: "conical", cx, cy, angle: -90, stops }, f32(stroke + 1), "round", "round"));
}

function drawRadialBars(p: Painter, s: Setup): void {
  const { width, height, styledGlow, spread, base, palette } = s;
  const bars = clampi(lround(fmaf(s.detail, 156, 36)), 24, 220);
  const bins = spectrumBins(s.audio, bars, s.gain, s.smoothing, s.lowHz, s.highHz);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const minDimension = Math.min(width, height);
  const inner = f32(minDimension * f32(0.22));
  const maxLength = f32(minDimension * f32(0.28));
  const bw = f32(((TWO_PI * inner) / bars) * 0.55);
  const barWidth = bw > 1 ? bw : 1;
  const minLength = f32(minDimension * f32(0.012));
  const glowWidth = fmaf(styledGlow, 8, barWidth);
  for (let i = 0; i < bars; i += 1) {
    const angle = (TWO_PI * i) / bars + HALF_PI_NEG;
    const scaled = f32(maxLength * bins[i]!);
    const length = minLength < scaled ? scaled : minLength;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const sx = fma(cos, inner, cx);
    const sy = fma(sin, inner, cy);
    const outer = f32(inner + length);
    const ex = fma(cos, outer, cx);
    const ey = fma(sin, outer, cy);
    const c = s.colorMode === RAINBOW ? rainbowColor(base, f32(i / Math.max(1, bars - 1)), spread) : mixColor(palette.base, palette.light, f32(bins[i]! * f32(0.35)));
    if (styledGlow > GLOW_MIN) {
      const glowColor = s.colorMode === RAINBOW ? alphaColor(c, f32(0.58)) : alphaColor(palette.glow, f32(0.65));
      p.drawLine(sx, sy, ex, ey, pen(solid(glowColor), glowWidth, "round"));
    }
    p.drawLine(sx, sy, ex, ey, pen(solid(c), barWidth, "round"));
  }
}

function drawPhaseScope(p: Painter, s: Setup): void {
  p.antialias = false;
  const { width, height, styledGlow, spread, base, palette, gain } = s;
  const count = clampi(lround(fmaf(s.detail, 224, 96)), 64, 320);
  const audio = s.audio!;
  const samples = frameSampleCount(audio);
  const left = audio.channels[0]!;
  const right = audio.channels[1]!;
  const halfW = f32(width * 0.5);
  const halfH = f32(height * 0.5);
  let prevX = halfW;
  let prevY = halfH;
  const trace: number[] = [];
  const kx = f32(0.38);
  const ky = f32(-0.42);
  for (let i = 0; i < count; i += 1) {
    const sample = clampi(Math.trunc((i * samples) / count), 0, samples - 1);
    const l = left[sample]!;
    const r = right[sample]!;
    const ax = clampf(f32(f32(f32(l - r) * gain) * f32(0.75)), -1, 1);
    const ay = clampf(f32(f32(f32(l + r) * gain) * f32(0.38)), -1, 1);
    const rawX = fmaf(0.5, width, f32(f32(ax * width) * kx));
    const rawY = fmaf(0.5, height, f32(f32(ay * height) * ky));
    const x = fmaf(f32(0.72), prevX, f32(rawX * f32(0.28)));
    const y = fmaf(f32(0.72), prevY, f32(rawY * f32(0.28)));
    trace.push(x, y);
    prevX = x;
    prevY = y;
  }
  const cross = pen(solid(alphaColor(palette.dark, f32(0.35))), 1);
  p.drawLine(halfW, f32(height * f32(0.12)), halfW, f32(height * f32(0.88)), cross);
  p.drawLine(f32(width * f32(0.12)), halfH, f32(width * f32(0.88)), halfH, cross);
  const traceWidth = s.stroke > 1 ? s.stroke : 1;
  const glowWidth = fmaf(styledGlow, 10, traceWidth);
  if (s.colorMode === RAINBOW) {
    // QPolygonF::boundingRect, widened to min_span, intersected with the canvas.
    let minX = trace[0]!;
    let maxX = minX;
    let minY = trace[1]!;
    let maxY = minY;
    for (let i = 2; i < trace.length; i += 2) {
      const tx = trace[i]!;
      const ty = trace[i + 1]!;
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
    const grad = (stops: GradientStop[]): Brush => ({ kind: "linear", x1: bx, y1: centerY, x2: bx + bw, y2: centerY, stops });
    if (styledGlow > GLOW_MIN) p.drawPolyline(trace, pen(grad(rainbowStops(base, spread, f32(0.42))), glowWidth, "flat"));
    p.drawPolyline(trace, pen(grad(rainbowStops(base, spread)), traceWidth, "flat"));
  } else {
    if (styledGlow > GLOW_MIN) p.drawPolyline(trace, pen(solid(palette.glow), glowWidth, "flat"));
    p.drawPolyline(trace, pen(solid(palette.base), traceWidth, "flat"));
  }
}

/** `QRectF::operator&` (qrect.cpp): the null rect when they do not overlap. */
function intersectRect(x1: number, y1: number, w1: number, h1: number, x2: number, y2: number, w2: number, h2: number): [number, number, number, number] {
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

const PARTICLE_SEED = 747796405;

function drawParticles(p: Painter, s: Setup): void {
  const { width, height, styledGlow, style, spread, base, palette, gain } = s;
  const count = clampi(lround(fmaf(s.detail, 920, 220)), 160, 1280);
  const level = reactiveLevel(s.audio, -1, gain);
  const bands = spectrumBins(s.audio, 36, gain, s.smoothing, s.lowHz, s.highHz);
  const low = bandLevel(bands, 0, f32(0.18));
  const mid = bandLevel(bands, f32(0.18), f32(0.56));
  const high = bandLevel(bands, f32(0.56), 1);
  const time = f32(f32(s.frame) * fmaf(level, f32(0.075), f32(0.028)));
  const cx = f32(width * 0.5);
  const cy = f32(fmaf(level, f32(-0.08), f32(0.55)) * height);
  const maxRadius = f32(Math.sqrt(width * width + height * height) * f32(0.42));
  const swirl = fmaf(low, f32(2.4), f32(0.65));
  const twist = fmaf(mid, f32(2.1), f32(0.45));
  const sparkle2 = f32(fmaf(high, f32(1.8), f32(0.2)) + 2);
  const radiusTerm = fmaf(low, f32(0.35), f32(0.88));
  const levelTerm = fmaf(level, f32(0.74), f32(0.62));
  const ribbonAmp = fmaf(height, f32(0.018), f32(f32(mid * height) * f32(0.055)));
  const trail = fmaf(level, 64, fmaf(low, 58, 16));
  const sizeTerm = fmaf(level, 2, fmaf(high, f32(2.25), f32(0.95)));
  const spreadTerm = fmaf(spread, f32(0.35), 0.25);
  const alphaTerm = fmaf(high, f32(0.22), fmaf(level, f32(0.52), f32(0.12)));
  const trailAlpha = fmaf(mid, f32(0.16), f32(0.26));
  const trailWidthTerm = fmaf(low, f32(0.12), f32(0.28));
  const gradTerm = fmaf(styledGlow, 4, f32(2.2));
  const k035 = f32(0.35);
  for (let i = 0; i < count; i += 1) {
    const draws = mt19937Floats(Math.imul(i + 1, PARTICLE_SEED) >>> 0, 4);
    const seed = draws[0]!;
    const arm = Math.floor(f32(draws[1]! * 5));
    const ageRaw = fmaf(time, fmaf(level, f32(0.55), fmaf(draws[2]!, f32(0.62), f32(0.18))), seed);
    const age = f32(ageRaw - Math.trunc(ageRaw));
    const eased = f32(Math.pow(age, f32(0.58)));
    const armFrac = f32(arm / 5);
    const baseAngle = f32(fma(f32(armFrac + armFrac), PI, f32(draws[3]! * f32(0.42))));
    const sway = f32(f32(f32(Math.sin(fmaf(seed, 12, time))) * twist) * f32(0.22));
    const orbit = f32(fma(f32(swirl * eased), PI, baseAngle) + sway);
    const wave = f32(Math.sin(fma(eased * PI, sparkle2, f32(seed * 10))));
    const radius = f32(levelTerm * f32(f32(fmaf(eased, radiusTerm, f32(0.06))) * maxRadius));
    const ribbon = f32(ribbonAmp * wave);
    const sinO = f32(Math.sin(orbit));
    const cosO = f32(Math.cos(orbit));
    const px = fma(-sinO, ribbon, fma(cosO, radius, cx));
    const py = fma(cosO, ribbon, fma(sinO, radius, cy));
    const fade = f32(Math.sin(age * PI));
    let c = s.colorMode === RAINBOW ? rainbowColor(base, fmodOne(f32(armFrac + age)), spread) : mixColor(palette.base, palette.light, f32(spreadTerm * fade));
    c = alphaColor(c, f32(alphaTerm * fade));
    const size = fmaf(fade, sizeTerm, f32(0.42));
    const tw = f32(trailWidthTerm * size);
    const trailPen = pen(solid(alphaColor(c, trailAlpha)), tw > f32(0.45) ? tw : f32(0.45), "round");
    const tailX = fma(ribbon * sinO, k035, fma(-cosO, trail, px));
    const tailY = fma(-(ribbon * cosO), k035, fma(-sinO, trail, py));
    p.drawLine(tailX, tailY, px, py, trailPen);
    let brush: Brush;
    if (style === STYLE_MINIMAL) brush = solid(alphaColor(c, 1));
    else {
      const stops: GradientStop[] = [];
      setColorAt(stops, 0, c);
      setColorAt(stops, 1, alphaColor(c, 0));
      brush = { kind: "radial", cx: px, cy: py, radius: f32(gradTerm * size), stops };
    }
    const r2 = f32(size + size);
    p.fillEllipse(px, py, r2, r2, brush);
  }
}

/** `std::fmod(x, 1.0f)` for non-negative x. */
function fmodOne(x: number): number {
  return f32(x - Math.trunc(x));
}

function drawVuMeter(p: Painter, s: Setup): void {
  const { width, height, style, base, palette, gain } = s;
  const meters = s.split ? Math.min(s.channels, 8) : 1;
  const segments = clampi(lround(fmaf(s.detail, 32, 8)), 6, 48);
  const laneWidth = f32(width / meters);
  const offsetX = f32(laneWidth * f32(0.08));
  const g = f32(height * f32(0.01));
  const gap = g > 1 ? g : 1;
  const segH = f32(fmaf(height, f32(0.88), -f32((segments - 1) * gap)) / segments);
  const rectWidth = f32(laneWidth * f32(0.84));
  const a = alpha8(base);
  for (let meter = 0; meter < meters; meter += 1) {
    const level = reactiveLevel(s.audio, s.split ? meter : -1, gain);
    const x0 = fmaf(meter, laneWidth, offsetX);
    for (let segment = 0; segment < segments; segment += 1) {
      const t = f32((segment + 1) / segments);
      let c: QtColor;
      if (style === STYLE_MINIMAL) c = palette.base;
      else if (t > f32(0.82)) c = rgb8(255, 86, 68, a);
      else if (t > f32(0.55)) c = mixColor(palette.accent, rgb8(255, 214, 90, a), f32(f32(t + f32(-0.55)) / f32(0.27)));
      else c = mixColor(palette.base, palette.light, f32(t * 1.5));
      if (!(t <= level)) c = alphaColor(palette.dark, 0.25);
      const y = fmaf(-segment, gap, fmaf(height, f32(0.94), -f32((segment + 1) * segH)));
      p.fillRect(x0, y, rectWidth, segH, solid(c));
    }
  }
}

// ---------------------------------------------------------------------------
// GetFrame
// ---------------------------------------------------------------------------

function render(image: PremulImage, params: Params, ctx: KernelContext, modeOverride?: number): PremulImage {
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
  const intensity = clampf(f32(num(params, "intensity", 1)), 0, 10);
  const smoothing = clampf(f32(num(params, "smoothing", 0.35)), 0, 1);
  const detail = clampf(f32(num(params, "detail", 0.75)), 0, 1);
  const glow = clampf(f32(num(params, "glow", 0.25)), 0, 1);
  const spread = clampf(f32(num(params, "color_spread", 0.6)), 0, 1);
  const mode = modeOverride ?? clampi(int(params, "visualization_type", WAVEFORM), 0, RADIAL_BARS);
  const style = int(params, "style", 0);
  const colorMode = int(params, "color_mode", 0);
  const layout = int(params, "channel_layout", LAYOUT_AUTO);
  const background = int(params, "background", BACKGROUND_SOURCE);
  const usesFrequency = mode === BARS || mode === SPECTRUM || mode === RADIAL || mode === RADIAL_BARS || mode === PARTICLES;
  const lowHz = usesFrequency ? normalizedFrequencyToHz(f32(num(params, "frequency_low", 0)), false) : 20;
  const hiRaw = usesFrequency ? normalizedFrequencyToHz(f32(num(params, "frequency_high", 1)), true) : 20000;
  const highHz = usesFrequency ? Math.max(f32(lowHz + 1), hiRaw) : 20000;
  const audio = ctx.audio;
  const channels = Math.max(1, audio ? audio.channels.length : 0);
  const split = layout === LAYOUT_SPLIT || (layout === LAYOUT_AUTO && channels > 1 && (mode === WAVEFORM || mode === FILLED_WAVEFORM || mode === VU_METER));
  const overlay = layout === LAYOUT_OVERLAY;

  if (mode === PHASE_SCOPE && channels < 2 && frameSampleCount(audio) > 0) {
    // A mono phase scope renders exactly like the waveform (:767-772).
    return render(image, params, ctx, WAVEFORM);
  }

  let visual: PremulImage;
  if (background === BACKGROUND_SOURCE && image.width > 0 && image.height > 0) {
    visual = image.width === width && image.height === height ? clonePremul(image) : smoothScale(image, width, height);
  } else visual = createPremul(width, height);

  const base = color(params, "color", [68, 170, 255, 255]);
  const baseColor = rgb8(clampi(getInt(base[0]), 0, 255), clampi(getInt(base[1]), 0, 255), clampi(getInt(base[2]), 0, 255), clampi(getInt(base[3]), 0, 255));
  const styledGlow = styleGlowAmount(style, glow);
  const palette = makePalette(baseColor, styledGlow, style, spread);
  const p = new Painter(visual);
  if (background === BACKGROUND_SOLID) p.fillRect(0, 0, width, height, solid(palette.dark));
  else if (background === BACKGROUND_FADE) {
    const stops: GradientStop[] = [];
    setColorAt(stops, 0, alphaColor(palette.dark, 0));
    setColorAt(stops, 1, alphaColor(palette.dark, f32(0.55)));
    p.fillRect(0, 0, width, height, { kind: "linear", x1: 0, y1: 0, x2: 0, y2: height, stops });
  } else if (background === BACKGROUND_GRADIENT) {
    const stops: GradientStop[] = [];
    setColorAt(stops, 0, alphaColor(palette.dark, f32(0.55)));
    setColorAt(stops, 1, alphaColor(palette.accent, f32(0.35)));
    p.fillRect(0, 0, width, height, { kind: "linear", x1: 0, y1: 0, x2: width, y2: height, stops });
  }
  if (frameSampleCount(audio) <= 0) return visual;

  const gain = intensity > GLOW_MIN ? intensity : GLOW_MIN;
  const stroke = styleStrokeWidth(style, styledGlow);
  const waveformMode = mode === WAVEFORM || mode === FILLED_WAVEFORM;
  p.antialias = !waveformMode || styledGlow > GLOW_MIN || stroke > f32(1.05);
  const setup: Setup = {
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
    spread,
    lowHz,
    highHz,
    split,
    overlay,
    base: baseColor,
    styledGlow,
    palette,
    gain,
    stroke,
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

export const audioVisualization: KernelSpec = {
  type: "AudioVisualization",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): PremulImage {
    return render(image, params, ctx);
  },
};
