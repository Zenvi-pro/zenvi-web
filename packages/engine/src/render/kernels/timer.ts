/**
 * Timer: a count up / count down / clock / timecode / frame number overlay,
 * ported from libopenshot src/effects/Timer.cpp (defaults :47-72, time
 * :84-242, layout and paint :244-393).
 *
 * Text, digit-slot layout, gravity, offsets, rounding and the background box
 * follow the C++. Glyphs come from the host (`KernelContext.text`); Qt's
 * `QFontMetricsF::tightBoundingRect` is read as the host's `inkBounds`. Without
 * a host the box is laid out with approximate metrics and no glyphs are drawn.
 */

import { roundHalfAway } from "../../model/rounding.js";
import type { PremulImage } from "../pixels.js";
import type { KernelContext, TextFont, TextRect } from "../types.js";
import { color, int, num, str } from "./params.js";
import {
  alpha16,
  approximateMetrics,
  drawTextPath,
  fillRoundedRect,
  fusedMulAdd,
  hexColor,
  imageRegion,
  isEmptyRect,
  solidPremul,
  straightColor,
  type RectF,
  type Rgb,
  type TextMeasurer,
} from "./text-layout.js";
import type { KernelSpec, Params } from "./types.js";

/** Timer.h TimerMode. */
export const TimerMode = { CountUp: 0, CountDown: 1, Clock: 2, Timecode: 3, FrameNumber: 4 } as const;
/** Timer.h TimerTimeSource. */
export const TimerTimeSource = { Clip: 0, Source: 1 } as const;
/** Timer.h TimerFormat. */
export const TimerFormat = { MmSs: 0, HhMmSs: 1, HhMmSsMs: 2, Timecode: 3, Frames: 4 } as const;
/** Enums.h GravityType. */
export const Gravity = { TopLeft: 0, Top: 1, TopRight: 2, Left: 3, Center: 4, Right: 5, BottomLeft: 6, Bottom: 7, BottomRight: 8 } as const;

export type TimerContext = Pick<KernelContext, "frame" | "fps" | "clip">;

/** The plain (non-keyframe) settings, read like `Timer::SetJsonValue` (`asInt`, :446-463). */
export interface TimerSettings {
  mode: number;
  timeSource: number;
  format: number;
  clamp: boolean;
  gravity: number;
  showBackground: boolean;
  fontName: string;
  prefix: string;
  suffix: string;
}

/** `ClampGravity` (Timer.cpp:39-44): out of range becomes bottom center. */
export function clampGravity(g: number): number {
  return g < Gravity.TopLeft || g > Gravity.BottomRight ? Gravity.Bottom : g;
}

export function timerSettings(params: Params): TimerSettings {
  return {
    mode: int(params, "mode", TimerMode.CountUp),
    timeSource: int(params, "time_source", TimerTimeSource.Source),
    format: int(params, "format", TimerFormat.MmSs),
    clamp: int(params, "clamp", 1) !== 0,
    gravity: clampGravity(int(params, "gravity", Gravity.Bottom)),
    showBackground: int(params, "show_background", 1) !== 0,
    fontName: str(params, "font_name", "sans"),
    prefix: str(params, "prefix", ""),
    suffix: str(params, "suffix", ""),
  };
}

/**
 * `ResolveFps` (Timer.cpp:84-102): the reader's fps for Source Time, else the
 * timeline's, else the reader's, else 30.
 */
export function resolveTimerFps(timeSource: number, ctx: TimerContext): number {
  const reader = ctx.clip && ctx.clip.readerFps > 0 ? ctx.clip.readerFps : 0;
  if (timeSource === TimerTimeSource.Source && reader > 0) return reader;
  const timeline = ctx.fps && ctx.fps.den !== 0 ? ctx.fps.num / ctx.fps.den : 0;
  if (timeline > 0) return timeline;
  if (reader > 0) return reader;
  return 30;
}

/**
 * `EffectiveFrameNumber` (Timer.cpp:104-114): Source Time follows the clip's
 * time remapping (`KernelClipContext.mappedFrame`), Clip Time does not.
 */
export function effectiveTimerFrame(timeSource: number, ctx: TimerContext): number {
  if (timeSource === TimerTimeSource.Source && ctx.clip) return Math.max(1, ctx.clip.mappedFrame);
  return Math.max(1, ctx.frame);
}

/** `CountdownDuration` (Timer.cpp:116-127): end_time when positive, else max(0f, clip End - Start). */
export function countdownDuration(params: Params, ctx: TimerContext): number {
  const configured = num(params, "end_time", 0);
  if (configured > 0) return configured;
  if (ctx.clip) return Math.max(0, Math.fround(ctx.clip.duration));
  return 0;
}

/** `TimerSeconds` (Timer.cpp:189-199). */
export function timerSeconds(params: Params, ctx: TimerContext, settings: TimerSettings = timerSettings(params)): number {
  const fps = resolveTimerFps(settings.timeSource, ctx);
  const elapsed = (effectiveTimerFrame(settings.timeSource, ctx) - 1) / fps;
  const start = num(params, "start_time", 0);
  if (settings.mode === TimerMode.CountDown) return countdownDuration(params, ctx) - start - elapsed;
  return start + elapsed;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** `FormatTimecode` (Timer.cpp:168-187): HH:MM:SS:FF, never clamped. */
export function formatTimecode(seconds: number, fps: number): string {
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

/** `FormatSeconds` (Timer.cpp:129-166). MM:SS prints total minutes. */
export function formatSeconds(seconds: number, fps: number, durationStyle: boolean, format: number, clamp: boolean): string {
  let s = seconds;
  if (durationStyle && clamp && s < 0) s = 0;
  const negative = s < 0;
  const totalMs = roundHalfAway(Math.abs(s) * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
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

function usesFrames(settings: TimerSettings): boolean {
  return settings.mode === TimerMode.FrameNumber || settings.format === TimerFormat.Frames;
}

function usesTimecode(settings: TimerSettings): boolean {
  return settings.mode === TimerMode.Timecode || settings.format === TimerFormat.Timecode;
}

/** `TimerText` (Timer.cpp:201-224): prefix + value + suffix. */
export function timerText(params: Params, ctx: TimerContext, settings: TimerSettings = timerSettings(params)): string {
  const fps = resolveTimerFps(settings.timeSource, ctx);
  let value: string;
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

/** `TimerLayoutText` (Timer.cpp:226-242): the fixed-width template the box is sized against. */
export function timerLayoutText(params: Params, ctx: TimerContext, settings: TimerSettings = timerSettings(params)): string {
  if (usesFrames(settings)) return timerText(params, ctx, settings);
  let template = "88:88";
  if (usesTimecode(settings)) template = "88:88:88:88";
  else if (settings.format === TimerFormat.HhMmSsMs) template = "88:88:88.888";
  else if (settings.format === TimerFormat.HhMmSs) template = "88:88:88";
  return settings.prefix + template + settings.suffix;
}

/** One `QPainterPath::addText` of the timer path. */
export interface TimerGlyphRun {
  text: string;
  /** Baseline origin. */
  x: number;
  y: number;
  /** The host's ink bounds of `text`, relative to its origin. */
  ink: TextRect;
}

export interface TimerLayout {
  font: TextFont;
  text: string;
  layoutText: string;
  /** Per-character fixed slots (text and template have the same length, not frame mode). */
  slotLayout: boolean;
  /** The background box `QRectF(x, y, rendered_box_width, box_height)`. */
  box: RectF;
  cornerRadius: number;
  showBackground: boolean;
  backgroundColor: Rgb;
  backgroundAlpha: number;
  textColor: Rgb;
  strokeColor: Rgb;
  textAlpha: number;
  strokeWidth: number;
  /** The addText calls, in path order: one per character with slots, else one. */
  runs: TimerGlyphRun[];
}

/** `QColor::setAlphaF(std::max(0.0, std::min(1.0, v)))` as written (NaN becomes 1). */
function clampAlpha(v: number): number {
  const m = v < 1 ? v : 1;
  return 0 < m ? m : 0;
}

const DIGIT = /^\p{Nd}$/u;

/** Timer.cpp:269-349 and :363-378 for an image of `width` × `height`. */
export function layoutTimer(params: Params, width: number, height: number, ctx: TimerContext, measure: TextMeasurer): TimerLayout {
  const settings = timerSettings(params);
  const scale = width / 600;
  const fontSizeValue = Math.max(1, num(params, "font_size", 48) * scale);
  const strokeWidthValue = Math.max(0, num(params, "stroke_width", 2) * scale);
  const paddingValue = Math.max(0, num(params, "background_padding", 14) * scale);
  const cornerValue = Math.max(0, num(params, "background_corner", 6) * scale);
  const text = timerText(params, ctx, settings);
  const layoutText = timerLayoutText(params, ctx, settings);
  // QFont::setPixelSize(int) truncates.
  const font: TextFont = { family: settings.fontName, pixelSize: Math.trunc(fontSizeValue) };

  // tightBoundingRect, falling back to boundingRect when it is empty.
  const tight = (s: string): TextRect => {
    const ink = s.length > 0 ? measure.inkBounds(s, font) : { x: 0, y: 0, width: 0, height: 0 };
    if (!isEmptyRect(ink)) return ink;
    return s.length > 0 ? measure.bounds(s, font) : { x: 0, y: 0, width: 0, height: 0 };
  };
  const textBounds = tight(text);
  const layoutBounds = tight(layoutText);
  const textWidth = Math.max(1, textBounds.width);
  const textHeight = Math.max(1, textBounds.height);
  let digitSlotWidth = 0;
  for (let digit = 0; digit <= 9; digit += 1) digitSlotWidth = Math.max(digitSlotWidth, measure.advance(String(digit), font));

  const slotLayout = text.length === layoutText.length && !usesFrames(settings);
  const slotWidths: number[] = [];
  let layoutWidth = 0;
  if (slotLayout) {
    for (let index = 0; index < layoutText.length; index += 1) {
      const ch = layoutText[index]!;
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
  const column = g % 3; // 0 left, 1 center, 2 right
  const row = Math.floor(g / 3); // 0 top, 1 middle, 2 bottom
  let x = paddingValue;
  let y = 0;
  if (column === 1) x = (width - boxWidth) / 2;
  else if (column === 2) x = width - boxWidth - paddingValue;
  if (row === 1) y = (height - boxHeight) / 2;
  else if (row === 2) y = height - boxHeight;
  // `x += W * (x_offset / 100)` compiles to fmadd; then std::round.
  x = roundHalfAway(fusedMulAdd(width, num(params, "x_offset", 0) / 100, x));
  y = roundHalfAway(fusedMulAdd(height, num(params, "y_offset", 0) / 100, y));

  let textX = x + paddingValue - textBounds.x;
  if (column === 1) textX = x + paddingValue + (layoutWidth - textWidth) / 2 - textBounds.x;
  else if (column === 2) textX = x + paddingValue + layoutWidth - textWidth - textBounds.x;
  textX = roundHalfAway(textX);
  const textY = roundHalfAway(y + paddingValue - textBounds.y);

  const runs: TimerGlyphRun[] = [];
  if (slotLayout) {
    let cursorX = x + paddingValue;
    for (let index = 0; index < text.length; index += 1) {
      const ch = text[index]!;
      const charBounds = tight(ch);
      const charX = roundHalfAway(cursorX);
      runs.push({ text: ch, x: charX - charBounds.x, y: textY, ink: measure.inkBounds(ch, font) });
      cursorX += slotWidths[index]!;
    }
  } else {
    runs.push({ text, x: textX, y: textY, ink: text.length > 0 ? measure.inkBounds(text, font) : { x: 0, y: 0, width: 0, height: 0 } });
  }

  const fontAlpha = clampAlpha(num(params, "font_alpha", 1));
  return {
    font,
    text,
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
    runs,
  };
}

/**
 * Paint a timer layout like Timer.cpp:355-390. The path is filled, then
 * stroked: with per-character runs every fill is drawn before any stroke.
 */
export function paintTimer(image: PremulImage, layout: TimerLayout, ctx: Pick<KernelContext, "text">): void {
  const region = imageRegion(image.width, image.height);
  if (layout.showBackground) {
    const a = alpha16(layout.backgroundAlpha);
    if (a > 0) fillRoundedRect(image, layout.box, layout.cornerRadius, solidPremul(layout.backgroundColor, a), region);
  }
  const raster = ctx.text;
  const a = alpha16(layout.textAlpha);
  if (!raster || a === 0) return;
  const fill = straightColor(layout.textColor, a);
  const stroke = layout.strokeWidth > 0 ? straightColor(layout.strokeColor, a) : null;
  if (!layout.slotLayout) {
    const run = layout.runs[0]!;
    drawTextPath(image, raster, run.text, run.x, run.y, layout.font, run.ink, fill, stroke, layout.strokeWidth, region);
    return;
  }
  for (const run of layout.runs) drawTextPath(image, raster, run.text, run.x, run.y, layout.font, run.ink, fill, null, 0, region);
  if (!stroke) return;
  const clear: typeof fill = [fill[0], fill[1], fill[2], 0];
  for (const run of layout.runs) drawTextPath(image, raster, run.text, run.x, run.y, layout.font, run.ink, clear, stroke, layout.strokeWidth, region);
}

export const timer: KernelSpec = {
  type: "Timer",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): void {
    if (image.width <= 0 || image.height <= 0) return;
    const layout = layoutTimer(params, image.width, image.height, ctx, ctx.text ?? approximateMetrics);
    paintTimer(image, layout, ctx);
  },
};
