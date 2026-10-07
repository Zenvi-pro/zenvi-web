/**
 * Caption: timed text cues over the image, ported from libopenshot
 * src/effects/Caption.cpp (constructor defaults :30-47, `process_regex`
 * :80-104, `GetFrame` :108-382).
 *
 * Cue parsing, timing, word wrapping, line stacking, centering, the rounded
 * background, clipping and fades follow the C++ literally, quirks included
 * (see `parseCaptions` and `layoutCaption`). Only glyph outlines come from the
 * host: `KernelContext.text` measures and draws; without it the background is
 * still laid out with approximate metrics and drawn, and no glyphs are drawn.
 */

import { num, color, str } from "./params.js";
import {
  alpha16,
  approximateMetrics,
  clipRectRegion,
  drawTextPath,
  fillRoundedRect,
  fusedMulAdd,
  hexColor,
  isEmptyRect,
  solidPremul,
  straightColor,
  type RectF,
  type Rgb,
  type TextMeasurer,
} from "./text-layout.js";
import type { KernelSpec, Params } from "./types.js";
import type { KernelContext, TextFont, TextRect } from "../types.js";
import type { PremulImage } from "../pixels.js";

/** `Caption::init_effect_details` placeholder text (Caption.cpp:63-65). */
export const CAPTION_DEFAULT_TEXT = "00:00:00:000 --> 00:10:00:000\nEdit this caption with our caption editor";

export interface CaptionCue {
  /** Seconds, as `Caption::GetFrame` computes them (Caption.cpp:204-214). */
  start: number;
  end: number;
  /**
   * Capture group 9 split on "\n", without the lines GetFrame skips: empty,
   * one character long, or starting with "NOTE" (Caption.cpp:220-226).
   */
  readonly lines: readonly string[];
}

/**
 * The cue regex (Caption.cpp:94), translated from PCRE2 as Qt 5.15 compiles
 * it (UTF, no UCP, newline = LF; measured with QRegularExpression):
 * `.` matches anything but "\n" (so "\r" too), `\s` is ASCII
 * [\t\n\v\f\r ], `\d` ASCII, and `\Z` is the end or before a final "\n".
 * Backtracking order is the same in both engines, so the quirks carry over:
 * group 9 lazily runs to the start of the line holding the next `dd:dd` (or
 * the end), and the part of that line before the `dd:dd` is group 10, which
 * libopenshot drops.
 */
const CUE_PATTERN =
  /(\d{2})?:*(\d{2}):(\d{2})[^\n](\d{2,3})[\t\n\v\f\r ]*-->[\t\n\v\f\r ]*(\d{2})?:*(\d{2}):(\d{2})[^\n](\d{2,3})([\s\S]*?)([^\n]*?)(?=\d{2}:\d{2,3}|\n?$)/gu;

/** `QString::toFloat` of a captured 2-digit group; an unset group is 0. */
function groupValue(g: string | undefined): number {
  return g ? Number(g) : 0;
}

/** `fracToSeconds`: right-pad to 3 digits ("50" → 500 ms, "05" → 50 ms), then / 1000 (Caption.cpp:195-198). */
function fraction(g: string | undefined): number {
  return Number((g ?? "").padEnd(3, "0")) / 1000;
}

const cueCache = new Map<string, readonly CaptionCue[]>();
const CUE_CACHE_LIMIT = 32;

/**
 * Parse caption text into cues like `Caption::process_regex` + the per-cue
 * part of GetFrame. The text is cut at a NUL (it passes through
 * `std::string::c_str()`), "\n\n" is appended unless it already ends so, and
 * every regex match is a cue, in text order.
 */
export function parseCaptions(text: string): readonly CaptionCue[] {
  const cached = cueCache.get(text);
  if (cached) return cached;
  const nul = text.indexOf("\u0000");
  let prepared = nul >= 0 ? text.slice(0, nul) : text;
  if (!prepared.endsWith("\n\n")) prepared += "\n\n";
  const cues: CaptionCue[] = [];
  for (const m of prepared.matchAll(CUE_PATTERN)) {
    const start = groupValue(m[1]) * 3600 + groupValue(m[2]) * 60 + groupValue(m[3]) + fraction(m[4]);
    const end = groupValue(m[5]) * 3600 + groupValue(m[6]) * 60 + groupValue(m[7]) + fraction(m[8]);
    const lines = (m[9] ?? "").split("\n").filter((line) => !line.startsWith("NOTE") && line.length > 1);
    cues.push({ start, end, lines });
  }
  if (cueCache.size >= CUE_CACHE_LIMIT) cueCache.delete(cueCache.keys().next().value!);
  cueCache.set(text, cues);
  return cues;
}

export interface Fps {
  num: number;
  den: number;
}

/**
 * Frames a cue is visible on: `int64(start * fps.ToFloat()) + 1` through
 * `int64(end * fps.ToFloat())` (Caption.cpp:216-217; the float fps is
 * promoted to double for the product).
 */
export function cueFrameRange(cue: CaptionCue, fps: Fps): { first: number; last: number } {
  const fpsF = Math.fround(fps.num / fps.den);
  return { first: Math.trunc(cue.start * fpsF) + 1, last: Math.trunc(cue.end * fpsF) };
}

export interface CaptionLine {
  /** The drawn text (joined without spaces for split no-space lines). */
  text: string;
  /** Baseline origin: `QPoint(left_margin_x, current_y)` (truncated) plus the centering offset. */
  x: number;
  y: number;
  /** The host's ink bounds of `text`, relative to its origin. */
  ink: TextRect;
  /** `QPainterPath::boundingRect()` of the line before centering, in image pixels. */
  bounds: TextRect;
}

export interface CaptionLayout {
  font: TextFont;
  /** `caption_clip_area` (Caption.cpp:185-186). */
  clip: RectF;
  lines: CaptionLine[];
  /** `caption_area_with_padding` after centering (Caption.cpp:304-316). */
  background: RectF;
  cornerRadius: number;
  backgroundColor: Rgb;
  /** The alphaF handed to `QColor::setAlphaF` (clamped there). */
  backgroundAlpha: number;
  textColor: Rgb;
  strokeColor: Rgb;
  textAlpha: number;
  strokeWidth: number;
  /** Fade percentages of the last active line (0 and 0 when none is active). */
  fadeIn: number;
  fadeOut: number;
}

/** `QFontMetricsF::boundingRect(rect, Qt::TextSingleLine, s).width()`: qt_format_text's natural width. */
function singleLineWidth(measure: TextMeasurer, font: TextFont, text: string): number {
  // qt_format_text turns "\r" and (single line) "\n" into spaces, and tabs too
  // without TextExpandTabs (qpainter.cpp:7554-7567).
  const t = text.replace(/[\r\n\t]/g, " ");
  if (t.length === 0) return 0;
  const advance = measure.advance(t, font);
  // QTextLine adds the last glyph's overhang (negative right bearing) to the
  // natural width; the ink's right edge stands in for it.
  const ink = measure.inkBounds(t, font);
  return isEmptyRect(ink) ? advance : Math.max(advance, ink.x + ink.width);
}

/**
 * `QPainterPath::addText(QPointF(x, y), font, text).boundingRect()`: the ink
 * moved to the origin, except that a path without outlines (empty or blank
 * text) keeps its initial `MoveTo(0, 0)` and reports (0, 0, 0, 0) in image
 * coordinates, which pulls the background's top to y = 0.
 */
function pathBounds(ink: TextRect, text: string, x: number, y: number): TextRect {
  if (text.length === 0 || isEmptyRect(ink)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x + ink.x, y: y + ink.y, width: ink.width, height: ink.height };
}

/** Timeline fps, else the clip reader's, else 1/1 (Caption.cpp:116-132). */
export function captionFps(ctx: Pick<KernelContext, "fps" | "clip">): Fps {
  if (ctx.fps && ctx.fps.num > 0 && ctx.fps.den > 0) return ctx.fps;
  if (ctx.clip && ctx.clip.readerFps > 0) return { num: ctx.clip.readerFps, den: 1 };
  return { num: 1, den: 1 };
}

/**
 * Everything `Caption::GetFrame` computes before painting, for an image of
 * `width` × `height` at effect frame `frame` (Caption.cpp:142-332).
 */
export function layoutCaption(params: Params, width: number, height: number, frame: number, fps: Fps, measure: TextMeasurer): CaptionLayout {
  const cues = parseCaptions(str(params, "caption_text", CAPTION_DEFAULT_TEXT));
  const scale = width / 600;
  const fontSizeValue = num(params, "font_size", 30) * scale;
  // QFont::setPixelSize(int) truncates std::max(font_size_value, 1.0).
  const font: TextFont = { family: str(params, "caption_font", "sans"), pixelSize: Math.trunc(Math.max(fontSizeValue, 1)) };
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
  // `W - W*right` and `H - H*bottom` compile to fmsub on arm64.
  const rightMarginX = fusedMulAdd(-width, rightValue, width);
  const captionAreaWidth = rightMarginX - leftMarginX;
  const bottomMarginY = fusedMulAdd(-height, bottomValue, height);
  const clip: RectF = { x: leftMarginX, y: topMarginY, width: captionAreaWidth, height: Math.max(bottomMarginY - topMarginY, 0) };

  const lines: CaptionLine[] = [];
  let fadeIn = 0;
  let fadeOut = 0;
  const lineHeight = metricsLineSpacing * lineSpacingValue;
  const widths = new Map<string, number>();
  const measureWidth = (s: string): number => {
    let w = widths.get(s);
    if (w === undefined) {
      w = singleLineWidth(measure, font, s);
      widths.set(s, w);
    }
    return w;
  };
  const f32 = Math.fround;

  for (const cue of cues) {
    const { first, last } = cueFrameRange(cue, fps);
    if (frame < first || frame > last) continue;
    for (const line of cue.lines) {
      fadeIn = fadeInValue > 0 ? f32(f32(frame) - f32(first)) / fadeInValue : 1;
      fadeOut = fadeOutValue > 0 ? 1 - (f32(frame) - (f32(last) - fadeOutValue)) / fadeOutValue : -1;

      let words = line.split(" ");
      // Languages without spaces: QString::split("") yields "" before and after the characters.
      let useSpaces = true;
      if (line.length > 20 && words.length === 1) {
        words = ["", ...line.split(""), ""];
        useSpaces = false;
      }
      while (words.length > 0) {
        let displayed = false;
        for (let wordIndex = words.length; wordIndex > 0; wordIndex -= 1) {
          const part = words.slice(0, wordIndex);
          // Measured with spaces even when drawn without (Caption.cpp:250-265).
          if (measureWidth(part.join(" ")) <= captionAreaWidth) {
            const text = useSpaces ? part.join(" ") : part.join("");
            const x = Math.trunc(leftMarginX);
            const y = Math.trunc(currentY);
            const ink = text.length > 0 ? measure.inkBounds(text, font) : { x: 0, y: 0, width: 0, height: 0 };
            const bounds = pathBounds(ink, text, x, y);
            lines.push({ text, x, y, ink, bounds });
            words = words.slice(wordIndex);
            displayed = true;
            currentY += lineHeight;
            if (bounds.width > maxTextWidth) maxTextWidth = bounds.width;
            if (bounds.y < topY) topY = bounds.y;
            if (bounds.y + bounds.height > bottomY) bottomY = bounds.y + bounds.height;
            break;
          }
        }
        // Not even one word fits: the rest of the line is dropped.
        if (!displayed) break;
      }
    }
  }

  const alignmentOffset = Math.max((captionAreaWidth - maxTextWidth) / 2, 0);
  const background: RectF = {
    x: leftMarginX - paddingValue / 2 + alignmentOffset,
    y: topY - paddingValue / 2,
    width: maxTextWidth + paddingValue,
    height: bottomY - topY + paddingValue,
  };
  for (const line of lines) line.x += alignmentOffset;

  // The fade is decided once, from the last active line (Caption.cpp:317-325, 353-361).
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
    fadeOut,
  };
}

/** Paint a caption layout like Caption.cpp:312-375. */
export function paintCaption(image: PremulImage, layout: CaptionLayout, ctx: Pick<KernelContext, "text">): void {
  const region = clipRectRegion(layout.clip.x, layout.clip.y, layout.clip.width, layout.clip.height, image.width, image.height);
  if (!region) return;
  const bgAlpha = alpha16(layout.backgroundAlpha);
  if (bgAlpha > 0) fillRoundedRect(image, layout.background, layout.cornerRadius, solidPremul(layout.backgroundColor, bgAlpha), region);
  const raster = ctx.text;
  const textAlpha = alpha16(layout.textAlpha);
  if (!raster || textAlpha === 0) return;
  const fill = straightColor(layout.textColor, textAlpha);
  const stroke = layout.strokeWidth > 0 ? straightColor(layout.strokeColor, textAlpha) : null;
  for (const line of layout.lines) {
    drawTextPath(image, raster, line.text, line.x, line.y, layout.font, line.ink, fill, stroke, layout.strokeWidth, region);
  }
}

export const caption: KernelSpec = {
  type: "Caption",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): void {
    if (image.width <= 0 || image.height <= 0) return;
    const layout = layoutCaption(params, image.width, image.height, ctx.frame, captionFps(ctx), ctx.text ?? approximateMetrics);
    paintCaption(image, layout, ctx);
  },
};
