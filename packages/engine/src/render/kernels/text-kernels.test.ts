import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createPremul, fillPremul, type PremulImage } from "../pixels.js";
import { evaluateEffectParams } from "../plan/effect-params.js";
import type { EvaluatedParam, KernelClipContext, KernelContext, RGBA, RgbaImage, TextFont, TextRasterizer, TextRect } from "../types.js";
import { CAPTION_DEFAULT_TEXT, caption, captionFps, cueFrameRange, layoutCaption, parseCaptions, type CaptionCue } from "./caption.js";
import {
  alpha16,
  approximateMetrics,
  clipRectRegion,
  fillRoundedRect,
  flattenBezier,
  fusedMulAdd,
  grayRasterize,
  hexColor,
  imageRegion,
  roundedRectPolygon,
  solidPremul,
  straightColor,
} from "./text-layout.js";
import { formatSeconds, formatTimecode, layoutTimer, resolveTimerFps, timer, timerLayoutText, timerText, type TimerContext } from "./timer.js";

// ---------------------------------------------------------------------------
// A deterministic fake font
// ---------------------------------------------------------------------------

interface DrawCall {
  text: string;
  x: number;
  y: number;
  font: TextFont;
  fill: RGBA;
  stroke: RGBA | null;
  strokeWidth: number;
  layerWidth: number;
  layerHeight: number;
}

type FakeRaster = TextRasterizer & { calls: DrawCall[] };

const DESCENDERS = new Set(["g", "j", "p", "q", "y"]);

/** Straight-alpha SourceOver of one color onto a straight RGBA pixel. */
function overStraight(d: Uint8ClampedArray, i: number, c: RGBA): void {
  const sa = c[3] / 255;
  if (sa <= 0) return;
  const da = d[i + 3]! / 255;
  const oa = sa + da * (1 - sa);
  for (let k = 0; k < 3; k += 1) d[i + k] = Math.round((c[k]! * sa + d[i + k]! * da * (1 - sa)) / oa);
  d[i + 3] = Math.round(oa * 255);
}

/**
 * Monospace-ish metrics: each UTF-16 unit advances 0.5 em (or `widths[ch]` em),
 * ascent .75, descent .25, line spacing 1.25 em. A non-space character's ink
 * is the box [pen + .1 em, pen + .4 em] × [-.7 em, 0] (to +.2 em for g j p q y).
 * drawText fills those boxes and strokes their edges (pixel-center sampling).
 */
function fakeRaster(widths: Record<string, number> = {}): FakeRaster {
  const advanceOf = (ch: string, em: number): number => (widths[ch] ?? 0.5) * em;
  const boxes = (text: string, em: number): { x0: number; y0: number; x1: number; y1: number }[] => {
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    let pen = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]!;
      if (ch.trim().length > 0) out.push({ x0: pen + 0.1 * em, y0: -0.7 * em, x1: pen + 0.4 * em, y1: DESCENDERS.has(ch) ? 0.2 * em : 0 });
      pen += advanceOf(ch, em);
    }
    return out;
  };
  const calls: DrawCall[] = [];
  return {
    calls,
    fontMetrics: (font) => ({ ascent: 0.75 * font.pixelSize, descent: 0.25 * font.pixelSize, lineSpacing: 1.25 * font.pixelSize }),
    advance(text, font) {
      let w = 0;
      for (let i = 0; i < text.length; i += 1) w += advanceOf(text[i]!, font.pixelSize);
      return w;
    },
    bounds(text, font) {
      return { x: 0, y: -0.75 * font.pixelSize, width: this.advance(text, font), height: font.pixelSize };
    },
    inkBounds(text, font) {
      const b = boxes(text, font.pixelSize);
      if (b.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      const x0 = Math.min(...b.map((r) => r.x0));
      const y0 = Math.min(...b.map((r) => r.y0));
      return { x: x0, y: y0, width: Math.max(...b.map((r) => r.x1)) - x0, height: Math.max(...b.map((r) => r.y1)) - y0 };
    },
    drawText(target, text, x, y, font, fill, stroke, strokeWidth) {
      calls.push({ text, x, y, font, fill, stroke, strokeWidth, layerWidth: target.width, layerHeight: target.height });
      const em = font.pixelSize;
      for (const pass of ["fill", "stroke"] as const) {
        if (pass === "stroke" && (!stroke || strokeWidth <= 0)) continue;
        const half = strokeWidth / 2;
        for (const b of boxes(text, em)) {
          const bx0 = x + b.x0;
          const by0 = y + b.y0;
          const bx1 = x + b.x1;
          const by1 = y + b.y1;
          for (let py = 0; py < target.height; py += 1) {
            for (let px = 0; px < target.width; px += 1) {
              const cx = px + 0.5;
              const cy = py + 0.5;
              const inside = cx >= bx0 && cx < bx1 && cy >= by0 && cy < by1;
              if (pass === "fill") {
                if (inside) overStraight(target.data, (py * target.width + px) * 4, fill);
                continue;
              }
              const outer = cx >= bx0 - half && cx < bx1 + half && cy >= by0 - half && cy < by1 + half;
              const inner = cx >= bx0 + half && cx < bx1 - half && cy >= by0 + half && cy < by1 - half;
              if (outer && !inner) overStraight(target.data, (py * target.width + px) * 4, stroke!);
            }
          }
        }
      }
    },
  };
}

function solid(width: number, height: number, rgba: RGBA): PremulImage {
  const img = createPremul(width, height);
  fillPremul(img, rgba[0], rgba[1], rgba[2], rgba[3]);
  return img;
}

function px(img: PremulImage, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.subarray(i, i + 4));
}

function ctxFor(width: number, height: number, frame: number, extra: Partial<KernelContext> = {}): KernelContext {
  return { frame, canvasWidth: width, canvasHeight: height, images: new Map(), ...extra };
}

// ---------------------------------------------------------------------------
// Helpers in text-layout.ts
// ---------------------------------------------------------------------------

describe("text-layout helpers", () => {
  it("fusedMulAdd rounds a·b + c once, like arm64 fmadd/fmsub", () => {
    expect(fusedMulAdd(0.1, 10, -1)).toBe(5.551115123125783e-17);
    expect(0.1 * 10 - 1).toBe(0);
    expect(fusedMulAdd(1 + 2 ** -52, 1 - 2 ** -53, -1)).toBe(2 ** -53 - 2 ** -105);
    expect(fusedMulAdd(3, 4, 5)).toBe(17);
    expect(fusedMulAdd(2, 3, Infinity)).toBe(Infinity);
    expect(fusedMulAdd(-2, 2.5, 5)).toBe(0);
  });

  it("hexColor follows QColor(GetColorHex): GetInt rounding, black when any channel is out of range", () => {
    expect(hexColor([12.5, 99.4, 254.6, 255])).toEqual([13, 99, 255]);
    expect(hexColor([300, 40, 40, 255])).toEqual([0, 0, 0]);
    expect(hexColor([10, 20, 30, 256])).toEqual([0, 0, 0]);
    expect(hexColor([-0.4, 20, 30, 0])).toEqual([0, 20, 30]);
  });

  it("solidPremul matches Qt's 16-bit premultiply + toArgb32 (values measured with QPainter)", () => {
    expect(alpha16(0.05263157894736842)).toBe(3449);
    expect(solidPremul([242, 33, 6], alpha16(0.05263157894736842))).toEqual([13, 2, 0, 13]);
    expect(solidPremul([240, 132, 119], alpha16(0.10526315789473684))).toEqual([25, 14, 13, 27]);
    expect(solidPremul([10, 20, 30], alpha16(1))).toEqual([10, 20, 30, 255]);
    expect(solidPremul([10, 20, 30], alpha16(0))).toEqual([0, 0, 0, 0]);
    expect(alpha16(1.7)).toBe(65535);
    expect(alpha16(-1)).toBe(0);
    expect(straightColor([1, 2, 3], alpha16(0.5))).toEqual([1, 2, 3, 128]);
  });

  it("rasterizes coverage like qgrayraster (26.6 qRound, floor of the cell area, odd-even)", () => {
    // A 2 x 1 px rectangle from x = .5: half, full, half coverage.
    const m = grayRasterize([[0.5, 0, 2.5, 0, 2.5, 1, 0.5, 1]], true, 10, 10)!;
    expect([m.x, m.y, m.width, m.height]).toEqual([0, 0, 3, 1]);
    expect(Array.from(m.data)).toEqual([128, 255, 128]);
    // y = .2449 rounds to 16/64 in 26.6: the row is 75% covered (192), not 75.5%.
    const t = grayRasterize([[0, 0.2449, 1, 0.2449, 1, 1, 0, 1]], true, 4, 4)!;
    expect(Array.from(t.data)).toEqual([192]);
    // Overlapping contours cancel under odd-even and add under nonzero.
    const square = [0, 0, 2, 0, 2, 2, 0, 2];
    expect(Array.from(grayRasterize([square, square], true, 4, 4)!.data)).toEqual([0, 0, 0, 0]);
    expect(Array.from(grayRasterize([square, square], false, 4, 4)!.data)).toEqual([255, 255, 255, 255]);
    // Clipped to the device; nothing when outside.
    expect(grayRasterize([[-5, -5, -1, -5, -1, -1, -5, -1]], true, 4, 4)).toBeNull();
    expect(Array.from(grayRasterize([[-1, 0, 1, 0, 1, 1, -1, 1]], true, 4, 4)!.data)).toEqual([255]);
  });

  it("flattens quarter circles like QBezier::addToPolygon (end point last, subdivided)", () => {
    const out: number[] = [];
    flattenBezier(out, 0, 0, 5.52, 0, 10, 4.48, 10, 10);
    expect(out.slice(-2)).toEqual([10, 10]);
    expect(out.length / 2).toBeGreaterThan(4);
    const flat: number[] = [];
    flattenBezier(flat, 0, 0, 1, 0, 2, 0, 3, 0);
    expect(flat).toEqual([3, 0]);
  });

  it("builds the drawRoundedRect outline with radii clamped to half the size", () => {
    const pts = roundedRectPolygon(10, 20, 30, 8, 10);
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(10, 9);
    expect(Math.max(...xs)).toBeCloseTo(40, 9);
    expect(Math.min(...ys)).toBeCloseTo(20, 9);
    expect(Math.max(...ys)).toBeCloseTo(28, 9);
    expect(pts.slice(0, 2)).toEqual([20, 20]); // x1 + min(10, 30 / 2)
    expect(pts.slice(-2)).toEqual([20, 20]); // closed
  });

  it("fills a rounded rect with exact interior color and antialiased edges", () => {
    const img = solid(20, 12, [0, 0, 0, 0]);
    fillRoundedRect(img, { x: 2.5, y: 2, width: 15, height: 8 }, 3, solidPremul([200, 100, 50], alpha16(0.5)), imageRegion(20, 12));
    expect(px(img, 10, 6)).toEqual(solidPremul([200, 100, 50], alpha16(0.5)));
    expect(px(img, 2, 6)[3]).toBeGreaterThan(0); // half-covered left column
    expect(px(img, 2, 6)[3]).toBeLessThan(128);
    expect(px(img, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(img, 2, 2)).toEqual([0, 0, 0, 0]); // rounded corner
    const square = solid(20, 12, [0, 0, 0, 0]);
    fillRoundedRect(square, { x: 2, y: 2, width: 15, height: 8 }, 0, [255, 0, 0, 255], imageRegion(20, 12));
    expect(px(square, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(px(square, 16, 9)).toEqual([255, 0, 0, 255]);
    expect(px(square, 17, 9)).toEqual([0, 0, 0, 0]);
  });

  it("turns setClipRect(QRectF) into an aligned hard clip, an empty clip, or a mirrored path clip", () => {
    expect(clipRectRegion(10.4, 5.6, 20.2, 3.1, 100, 50)).toEqual({ x0: 10, y0: 5, x1: 31, y1: 9 });
    expect(clipRectRegion(10, 5, 20, 0, 100, 50)).toBeNull();
    expect(clipRectRegion(10, 5, 0, 10, 100, 50)).toBeNull();
    const mirrored = clipRectRegion(30, 5, -10.5, 4, 100, 50)!;
    expect([mirrored.x0, mirrored.x1]).toEqual([19, 30]);
    expect(mirrored.mask).toBeDefined();
  });

  it("approximate metrics are deterministic Helvetica-like widths", () => {
    const font = { family: "sans", pixelSize: 30 };
    expect(approximateMetrics.advance("Hello world", font)).toBeCloseTo(148.35, 6);
    expect(approximateMetrics.inkBounds("  ", font)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(approximateMetrics.inkBounds("Ag", font).height).toBeCloseTo(0.926 * 30, 6);
    expect(approximateMetrics.fontMetrics(font).lineSpacing).toBeCloseTo(34.8, 9);
  });
});

// ---------------------------------------------------------------------------
// Caption
// ---------------------------------------------------------------------------

function cueSummary(cues: readonly CaptionCue[]): { start: number; end: number; lines: readonly string[] }[] {
  return cues.map((c) => ({ start: c.start, end: c.end, lines: c.lines }));
}

describe("Caption cue parsing (Caption.cpp:80-104, 201-226)", () => {
  it("parses the placeholder text", () => {
    expect(cueSummary(parseCaptions(CAPTION_DEFAULT_TEXT))).toEqual([{ start: 0, end: 600, lines: ["Edit this caption with our caption editor"] }]);
  });

  it("keeps libopenshot's regex quirks", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nOne\n\n12\n00:00:03,000 --> 00:00:04,500\nTwo";
    // A one-character index is dropped as a 1-char line; "12" is drawn as a line of cue 1.
    expect(cueSummary(parseCaptions(srt))).toEqual([
      { start: 1, end: 2, lines: ["One", "12"] },
      { start: 3, end: 4.5, lines: ["Two"] },
    ]);
    const vtt = "WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nCue\nNOTE skipped\nx";
    expect(cueSummary(parseCaptions(vtt))).toEqual([{ start: 1, end: 2, lines: [" align:start", "Cue"] }]);
    // A dd:dd in the text ends the cue at the start of its line.
    const clock = "00:00:00.000 --> 00:00:05.000\nfirst\nMeet at 10:30\nlost\n";
    expect(cueSummary(parseCaptions(clock))).toEqual([{ start: 0, end: 5, lines: ["first"] }]);
    // Fractions are right-padded; one digit is not a timestamp.
    expect(cueSummary(parseCaptions("00:00:01.50 --> 00:00:01.05\nok"))).toEqual([{ start: 1.5, end: 1.05, lines: ["ok"] }]);
    expect(parseCaptions("00:00:01.5 --> 00:00:02.000\nno")).toEqual([]);
    // std::string::c_str() stops at a NUL.
    expect(cueSummary(parseCaptions("00:00:00.000 --> 00:00:01.000\nkept\u0000\n00:00:01.000 --> 00:00:02.000\ngone"))).toEqual([
      { start: 0, end: 1, lines: ["kept"] },
    ]);
  });

  it("caches parses by text", () => {
    const text = "00:00:00.000 --> 00:00:01.000\ncached";
    expect(parseCaptions(text)).toBe(parseCaptions(text));
  });

  it("computes visible frames as int(start*fps)+1 .. int(end*fps) with a float fps", () => {
    const cue: CaptionCue = { start: 1, end: 2, lines: [] };
    expect(cueFrameRange(cue, { num: 30, den: 1 })).toEqual({ first: 31, last: 60 });
    expect(cueFrameRange({ start: 10.01, end: 11, lines: [] }, { num: 30000, den: 1001 })).toEqual({ first: 300, last: 329 });
    expect(cueFrameRange(cue, { num: 1, den: 1 })).toEqual({ first: 2, last: 2 });
  });

  it("takes fps from the timeline, then the clip reader, then 1/1", () => {
    const clip: KernelClipContext = { mappedFrame: 1, readerFps: 25, duration: 4 };
    expect(captionFps({ fps: { num: 24, den: 1 }, clip })).toEqual({ num: 24, den: 1 });
    expect(captionFps({ clip })).toEqual({ num: 25, den: 1 });
    expect(captionFps({})).toEqual({ num: 1, den: 1 });
  });
});

describe("Caption layout (Caption.cpp:142-332)", () => {
  const W = 600;
  const H = 400;
  const fps = { num: 30, den: 1 };
  const base = (text: string, extra: Record<string, EvaluatedParam> = {}): Record<string, EvaluatedParam> => ({
    caption_text: `00:00:00.000 --> 00:00:10.000\n${text}`,
    font_size: 20,
    ...extra,
  });

  it("wraps greedily by measured width and stacks lines by lineSpacing × line_spacing", () => {
    const f = fakeRaster();
    // left/right .4 → area 240..360 (120 px = 12 characters of 10 px).
    const L = layoutCaption(base("one two three four five", { left: 0.4, right: 0.4, line_spacing: 1.5 }), W, H, 5, fps, f);
    expect(L.font).toEqual({ family: "sans", pixelSize: 20 });
    expect(L.lines.map((l) => l.text)).toEqual(["one two", "three four", "five"]);
    // First baseline H*top + lineSpacing = 300 + 25; then + 25 * 1.5, truncated.
    expect(L.lines.map((l) => l.y)).toEqual([325, 362, 400]);
    // Centered by the widest ink width ("three four": 2..98 → 96 px): (120 - 96) / 2 = 12.
    expect(L.lines.map((l) => l.x)).toEqual([252, 252, 252]);
    expect(L.background).toEqual({ x: 240 - 10 + 12, y: 325 - 14 - 10, width: 96 + 20, height: 400 - (325 - 14) + 20 });
    expect(L.clip).toEqual({ x: 240, y: 300, width: 120, height: 100 });
  });

  it("drops the rest of a line when not even one word fits", () => {
    const f = fakeRaster();
    const L = layoutCaption(base("ok Supercalifragilistic done\nnext", { left: 0.4, right: 0.4 }), W, H, 5, fps, f);
    expect(L.lines.map((l) => l.text)).toEqual(["ok", "next"]);
  });

  it("splits long lines without spaces per character, measuring with spaces", () => {
    const f = fakeRaster();
    // Area 132 px: " a b c d e f" (12 units) fits, 7 characters per later line, then the trailing "" element.
    const L = layoutCaption(base("abcdefghijklmnopqrstuvwxyz0", { left: 0.39, right: 0.39 }), W, H, 5, fps, f);
    expect(L.clip.width).toBe(132);
    expect(L.lines.map((l) => l.text)).toEqual(["abcdef", "ghijklm", "nopqrst", "uvwxyz0", ""]);
    // The empty path's bounding rect is (0,0,0,0): the background reaches y = 0 (then the clip cuts it).
    expect(L.background.y).toBe(-10);
    expect(f.calls).toEqual([]);
  });

  it("treats a blank line as an empty path at the origin", () => {
    const f = fakeRaster();
    const L = layoutCaption(base("  \nafter"), W, H, 5, fps, f);
    expect(L.lines.map((l) => l.text)).toEqual(["  ", "after"]);
    expect(L.lines[0]!.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(L.background.y).toBe(-10);
  });

  it("measures tabs and carriage returns as spaces", () => {
    const f = fakeRaster({ "\t": 4, "\r": 0 });
    const L = layoutCaption(base("a\tb c\r", { left: 0.45, right: 0.45 }), W, H, 5, fps, f);
    // Area 60 px: "a\tb c\r" measures as "a b c " (60 px) and fits.
    expect(L.lines.map((l) => l.text)).toEqual(["a\tb c\r"]);
  });

  it("fades with the last active line's percentages", () => {
    const f = fakeRaster();
    const text = "00:00:01.000 --> 00:00:05.000\nfirst cue\n00:00:02.000 --> 00:00:06.000\nsecond cue";
    const params = { caption_text: text, fade_in: 1, fade_out: 1, background_alpha: 0.8, font_alpha: 0.5 };
    // Frame 76: cue 1 [31, 150], cue 2 [61, 180]. fin = (76 - 61) / 30 = .5 from cue 2.
    const mid = layoutCaption(params, W, H, 76, fps, f);
    expect(mid.fadeIn).toBe(0.5);
    expect(mid.backgroundAlpha).toBeCloseTo(0.4, 12);
    expect(mid.textAlpha).toBe(0.25);
    expect(mid.lines.map((l) => l.text)).toEqual(["first cue", "second cue"]);
    // Frame 180 is cue 2's last frame: fout = 1 - (180 - (180 - 30)) / 30 = 0.
    const end = layoutCaption(params, W, H, 180, fps, f);
    expect(end.fadeOut).toBe(0);
    expect(end.backgroundAlpha).toBe(0);
    // Frame 120: fin > 1, fout = 1 - (120 - 150) / 30 = 2 → full alpha.
    expect(layoutCaption(params, W, H, 120, fps, f).backgroundAlpha).toBe(0.8);
    // Nothing active: fin stays 0, so the background is fully transparent.
    const none = layoutCaption(params, W, H, 500, fps, f);
    expect(none.lines).toEqual([]);
    expect(none.backgroundAlpha).toBe(0);
  });

  it("scales sizes by width / 600 and truncates the pixel size", () => {
    const f = fakeRaster();
    const L = layoutCaption(base("x", { font_size: 30, stroke_width: 2, background_corner: 10, background_padding: 20 }), 320, 180, 5, fps, f);
    expect(L.font.pixelSize).toBe(16);
    expect(L.strokeWidth).toBeCloseTo(2 * (320 / 600), 12);
    expect(L.cornerRadius).toBeCloseTo(10 * (320 / 600), 12);
    expect(layoutCaption(base("x", { font_size: 0.2 }), 320, 180, 5, fps, f).font.pixelSize).toBe(1);
  });

  it("reads colors through GetColorHex", () => {
    const f = fakeRaster();
    const L = layoutCaption(base("x", { color: [255, 128.5, 0, 255], stroke: [10, 20, 30, 999], background: [1, 2, 3, 4] }), W, H, 5, fps, f);
    expect(L.textColor).toEqual([255, 129, 0]);
    expect(L.strokeColor).toEqual([0, 0, 0]);
    expect(L.backgroundColor).toEqual([1, 2, 3]);
    const defaults = layoutCaption(base("x"), W, H, 5, fps, f);
    expect([defaults.textColor, defaults.strokeColor, defaults.backgroundColor]).toEqual([
      [255, 255, 255],
      [169, 169, 169],
      [0, 0, 0],
    ]);
  });
});

describe("Caption kernel", () => {
  it("draws the clipped background and composites host glyphs", () => {
    const W = 600;
    const H = 400;
    const f = fakeRaster();
    const img = solid(W, H, [0, 0, 255, 255]);
    const params = {
      caption_text: "00:00:00.000 --> 00:00:10.000\nhello\nsecond",
      font_size: 20,
      background_alpha: 1,
      background: [200, 0, 0, 255] as RGBA,
      background_padding: 60,
      stroke_width: 0,
      top: 0.7,
    };
    // Both lines start at trunc(60) + (480 - 56) / 2, centered by "second" (ink 2..58).
    const layout = layoutCaption(params, W, H, 5, { num: 30, den: 1 }, f);
    expect(layout.lines.map((l) => [l.text, l.x, l.y])).toEqual([
      ["hello", 272, 305],
      ["second", 272, 330],
    ]);
    caption.run(img, params, ctxFor(W, H, 5, { fps: { num: 30, den: 1 }, text: f }));
    // Clip top = floor(400 * .7) = 280: the padded box would start at 280 + 25 - 14 - 30 = 261.
    expect(px(img, 300, 279)).toEqual([0, 0, 255, 255]);
    expect(px(img, 280, 281)).toEqual([200, 0, 0, 255]);
    expect(f.calls.map((c) => c.text)).toEqual(["hello", "second"]);
    const call = f.calls[0]!;
    expect(call.fill).toEqual([255, 255, 255, 255]);
    expect(call.stroke).toBeNull();
    // "hello" starts at trunc(60) + (480 - 56) / 2 = 272; its first glyph box is 274..280 × 291..305.
    expect(px(img, 277, 300)).toEqual([255, 255, 255, 255]);
    expect(px(img, 281, 300)).toEqual([200, 0, 0, 255]);
  });

  it("strokes with stroke_width × scale and fades text with the background", () => {
    const f = fakeRaster();
    const img = solid(600, 400, [0, 0, 0, 255]);
    const params = {
      caption_text: "00:00:01.000 --> 00:00:05.000\nfade",
      font_size: 20,
      fade_in: 1,
      font_alpha: 0.8,
      stroke_width: 3,
      stroke: [0, 255, 0, 255] as RGBA,
    };
    caption.run(img, params, ctxFor(600, 400, 46, { fps: { num: 30, den: 1 }, text: f }));
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.strokeWidth).toBe(3);
    expect(f.calls[0]!.fill).toEqual([255, 255, 255, 102]); // .5 * .8
    expect(f.calls[0]!.stroke).toEqual([0, 255, 0, 102]);
  });

  it("without a host rasterizer draws the background only", () => {
    const img = solid(320, 180, [0, 0, 0, 255]);
    caption.run(img, { background_alpha: 1, background: [0, 200, 0, 255] }, ctxFor(320, 180, 1));
    let green = 0;
    let white = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 1] === 200 && img.data[i] === 0) green += 1;
      if (img.data[i] === 255) white += 1;
    }
    expect(green).toBeGreaterThan(1000);
    expect(white).toBe(0);
  });

  it("draws nothing when the clip area has no height", () => {
    const img = solid(100, 100, [9, 9, 9, 255]);
    caption.run(img, { background_alpha: 1, top: 1 }, ctxFor(100, 100, 1, { text: fakeRaster() }));
    expect(px(img, 50, 99)).toEqual([9, 9, 9, 255]);
  });
});

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

describe("Timer text (Timer.cpp:84-242)", () => {
  const at = (frame: number, extra: Partial<TimerContext> = {}): TimerContext => ({ frame, fps: { num: 30, den: 1 }, ...extra });
  const cases: [string, Record<string, EvaluatedParam>, TimerContext, string][] = [
    ["count up at frame 1", {}, at(1), "00:00"],
    ["count up one second", {}, at(31), "00:01"],
    ["total minutes", { start_time: 7500 }, at(1), "125:00"],
    ["HH:MM:SS", { format: 1, start_time: 3725 }, at(1), "01:02:05"],
    ["milliseconds round half away", { format: 2, start_time: 1.0625 }, at(1), "00:00:01.063"],
    ["count down", { mode: 1, end_time: 10 }, at(1), "00:10"],
    ["count down clamps", { mode: 1, end_time: 1 }, at(61), "00:00"],
    ["count down unclamped", { mode: 1, end_time: 1, clamp: 0 }, at(61), "-00:01"],
    ["count down uses the clip duration", { mode: 1, time_source: 0 }, at(31, { clip: { mappedFrame: 99, readerFps: 30, duration: 3.5 } }), "00:02"],
    ["clock wraps", { mode: 2, format: 1, start_time: 86399.5 }, at(31), "00:00:00"],
    ["clock wraps negatives", { mode: 2, format: 1, start_time: -1 }, at(1), "23:59:59"],
    ["timecode mode", { mode: 3 }, at(36), "00:00:01:05"],
    ["timecode is not clamped", { mode: 1, format: 3, end_time: 0.5 }, at(31), "-00:00:00:15"],
    ["frame number", { mode: 4, start_time: 2 }, at(12), "72"],
    ["frames format", { format: 4, start_time: -1 }, at(5), "-25"],
    ["prefix and suffix", { prefix: "T-", suffix: " s" }, at(1), "T-00:00 s"],
    ["source time follows the clip curve", { time_source: 1 }, at(10, { clip: { mappedFrame: 51, readerFps: 25, duration: 9 } }), "00:02"],
    ["clip time ignores it", { time_source: 0 }, at(61, { clip: { mappedFrame: 1, readerFps: 25, duration: 9 } }), "00:02"],
    ["no fps anywhere is 30", {}, { frame: 61 }, "00:02"],
  ];
  for (const [name, params, ctx, expected] of cases) {
    it(name, () => {
      expect(timerText(params, ctx)).toBe(expected);
    });
  }

  it("resolves fps like ResolveFps", () => {
    const clip: KernelClipContext = { mappedFrame: 1, readerFps: 25, duration: 1 };
    expect(resolveTimerFps(1, { frame: 1, fps: { num: 24, den: 1 }, clip })).toBe(25);
    expect(resolveTimerFps(0, { frame: 1, fps: { num: 24, den: 1 }, clip })).toBe(24);
    expect(resolveTimerFps(0, { frame: 1, clip })).toBe(25);
    expect(resolveTimerFps(1, { frame: 1, fps: { num: 30000, den: 1001 } })).toBe(30000 / 1001);
    expect(resolveTimerFps(1, { frame: 1 })).toBe(30);
  });

  it("formats like FormatSeconds / FormatTimecode", () => {
    expect(formatSeconds(-0.0004, 30, false, 0, true)).toBe("-00:00");
    expect(formatSeconds(-3, 30, true, 0, true)).toBe("00:00");
    expect(formatTimecode(3600 + 0.5, 30)).toBe("01:00:00:15");
    expect(formatTimecode(3600 + 0.5, 29.97)).toBe("00:59:56:27");
    expect(formatTimecode(1, 0.2)).toBe("00:00:00:00");
  });

  it("lays out against the template", () => {
    expect(timerLayoutText({ format: 2, prefix: "<", suffix: ">" }, { frame: 1 })).toBe("<88:88:88.888>");
    expect(timerLayoutText({ mode: 3 }, { frame: 1 })).toBe("88:88:88:88");
    expect(timerLayoutText({ mode: 4, start_time: 1 }, { frame: 3, fps: { num: 10, den: 1 } })).toBe("13");
  });
});

describe("Timer layout (Timer.cpp:269-378)", () => {
  const W = 600;
  const H = 400;
  const ctx: TimerContext = { frame: 31, fps: { num: 30, den: 1 } };

  it("uses fixed digit slots sized by the widest digit", () => {
    const f = fakeRaster({ "1": 0.3, "8": 0.6 });
    const L = layoutTimer({ font_size: 20 }, W, H, ctx, f);
    expect(L.text).toBe("00:01");
    expect(L.slotLayout).toBe(true);
    // Slots: 4 digits × 12 + ":" 10 = 58; box = 58 + 2 * 14.
    expect(L.box.width).toBe(58 + 28);
    // Ink of "00:01": 2 .. 10+10+10+12+... height .7 em = 14 → box height 14 + 28.
    expect(L.box.height).toBe(14 + 28);
    // Bottom center: x = (600 - 86) / 2 = 257, y = 400 - 42 = 358.
    expect([L.box.x, L.box.y]).toEqual([257, 358]);
    // Each character sits at round(cursor) - its ink left (2 px).
    expect(L.runs.map((r) => [r.text, r.x])).toEqual([
      ["0", 271 - 2],
      ["0", 283 - 2],
      [":", 295 - 2],
      ["0", 305 - 2],
      ["1", 317 - 2],
    ]);
    expect(L.runs.every((r) => r.y === 358 + 14 + 14)).toBe(true);
  });

  it("falls back to one run when the text does not match the template length", () => {
    const f = fakeRaster();
    const L = layoutTimer({ font_size: 20, start_time: -5.5, clamp: 0 }, W, H, ctx, f);
    expect(L.text).toBe("-00:04");
    expect(L.slotLayout).toBe(false);
    expect(L.runs).toHaveLength(1);
    // Ink 2 .. 58 → width 56; template ink 2..48 → 46; layout = 56.
    expect(L.box.width).toBe(56 + 28);
    // Centered text: x + 14 + (56 - 56) / 2 - 2.
    expect(L.runs[0]!.x).toBe(L.box.x + 14 - 2);
  });

  it("places the box by gravity, offsets and rounding", () => {
    const f = fakeRaster();
    const positions: [number, number][] = [];
    for (let g = 0; g <= 8; g += 1) {
      const L = layoutTimer({ font_size: 20, gravity: g }, W, H, ctx, f);
      positions.push([L.box.x, L.box.y]);
    }
    // box 50 + 28 = 78 wide, 42 high; left inset by the padding, top/bottom not.
    expect(positions).toEqual([
      [14, 0],
      [261, 0],
      [508, 0],
      [14, 179],
      [261, 179],
      [508, 179],
      [14, 358],
      [261, 358],
      [508, 358],
    ]);
    // Out-of-range gravity is bottom center; offsets are % of the frame, rounded half away from zero.
    expect(layoutTimer({ font_size: 20, gravity: 12 }, W, H, ctx, f).box).toMatchObject({ x: 261, y: 358 });
    const off = layoutTimer({ font_size: 20, gravity: 0, x_offset: 0.25, y_offset: -0.125 }, W, H, ctx, f).box;
    expect([off.x, off.y]).toEqual([16, -1]);
  });

  it("reads sizes, colors and alphas like the C++", () => {
    const f = fakeRaster();
    const L = layoutTimer({ font_size: 48, stroke_width: 2, background_alpha: 1.5, font_alpha: Number.NaN, background: [0, 0, 300, 255] }, 320, 180, ctx, f);
    expect(L.font.pixelSize).toBe(25);
    expect(L.strokeWidth).toBeCloseTo(2 * (320 / 600), 12);
    expect(L.backgroundAlpha).toBe(1);
    expect(L.textAlpha).toBe(1);
    expect(L.backgroundColor).toEqual([0, 0, 0]);
    expect(L.strokeColor).toEqual([0, 0, 0]);
  });
});

describe("Timer kernel", () => {
  it("fills every glyph before stroking any", () => {
    const f = fakeRaster();
    const img = solid(600, 400, [0, 0, 0, 255]);
    timer.run(img, { font_size: 20, stroke_width: 2 }, ctxFor(600, 400, 31, { fps: { num: 30, den: 1 }, text: f }));
    expect(f.calls.map((c) => [c.text, c.stroke === null ? "fill" : "stroke"])).toEqual([
      ["0", "fill"],
      ["0", "fill"],
      [":", "fill"],
      ["0", "fill"],
      ["1", "fill"],
      ["0", "stroke"],
      ["0", "stroke"],
      [":", "stroke"],
      ["0", "stroke"],
      ["1", "stroke"],
    ]);
    expect(f.calls[5]!.fill[3]).toBe(0);
    expect(f.calls[5]!.strokeWidth).toBe(2);
    // Background: .45 alpha black over black stays black. The box is 78 wide at x 261, so the
    // first "0" sits at round(275) - 2 on baseline 386: its glyph box 275..281 × 372..386 is
    // white inside the 2 px stroke band.
    expect(px(img, 300, 390)).toEqual([0, 0, 0, 255]);
    expect(px(img, 278, 380)).toEqual([255, 255, 255, 255]);
    expect(px(img, 275, 380)).toEqual([0, 0, 0, 255]);
  });

  it("draws one fill + stroke path without slots, and only the box without a host", () => {
    const f = fakeRaster();
    timer.run(solid(600, 400, [0, 0, 0, 255]), { mode: 4, font_size: 20 }, ctxFor(600, 400, 7, { fps: { num: 30, den: 1 }, text: f }));
    expect(f.calls.map((c) => [c.text, c.strokeWidth])).toEqual([["7", 2]]);
    const img = solid(600, 400, [255, 255, 255, 255]);
    timer.run(img, { background_alpha: 1 }, ctxFor(600, 400, 1));
    expect(px(img, 300, 398)).toEqual([0, 0, 0, 255]);
    expect(px(img, 300, 0)).toEqual([255, 255, 255, 255]);
  });
});

// ---------------------------------------------------------------------------
// libopenshot goldens (scripts/parity/text_goldens.py)
// ---------------------------------------------------------------------------

interface StringMetrics {
  adv: number;
  fmt: number;
  path: [number, number, number, number];
  tight: [number, number, number, number];
  br: [number, number, number, number];
}

interface FontMetricsDoc {
  family: string;
  pixelSize: number;
  ascent: number;
  descent: number;
  lineSpacing: number;
  strings: Record<string, StringMetrics>;
}

interface GoldenBase {
  width: number;
  height: number;
  frame: number;
  input: [number, number, number, number];
  effect: Record<string, unknown>;
  metrics: FontMetricsDoc;
  backgroundOnly: string;
  textBox: [number, number, number, number] | null;
}

interface CaptionGolden extends GoldenBase {
  fps: [number, number] | null;
  lines: string[];
}

interface TimerGolden extends GoldenBase {
  ctx: { fps: [number, number] | null; clip: KernelClipContext | null };
  timerText: string;
  layoutText: string;
}

interface GoldenDoc {
  libopenshot: string;
  cues: { text: string; cues: { start: number; end: number; lines: string[] }[] }[];
  caption: Record<string, CaptionGolden>;
  timer: Record<string, TimerGolden>;
}

const doc = JSON.parse(readFileSync(new URL("./text-goldens.json", import.meta.url), "utf8")) as GoldenDoc;

const toRect = (r: [number, number, number, number]): TextRect => ({ x: r[0], y: r[1], width: r[2], height: r[3] });

/**
 * Serves Qt's recorded metrics. Caption measures with
 * `boundingRect(rect, TextSingleLine, s).width()` (served as the advance) and
 * path bounds; Timer with `horizontalAdvance` and `tightBoundingRect`.
 */
function recordedRaster(m: FontMetricsDoc, kind: "caption" | "timer"): FakeRaster {
  const calls: DrawCall[] = [];
  const get = (s: string, font: TextFont): StringMetrics => {
    expect(font).toEqual({ family: m.family, pixelSize: m.pixelSize });
    const rec = m.strings[s];
    if (!rec) throw new Error(`no recorded metrics for ${JSON.stringify(s)}`);
    return rec;
  };
  return {
    calls,
    fontMetrics(font) {
      expect(font).toEqual({ family: m.family, pixelSize: m.pixelSize });
      return { ascent: m.ascent, descent: m.descent, lineSpacing: m.lineSpacing };
    },
    advance: (s, font) => (kind === "caption" ? get(s, font).fmt : get(s, font).adv),
    bounds: (s, font) => toRect(get(s, font).br),
    inkBounds: (s, font) => toRect(kind === "caption" ? get(s, font).path : get(s, font).tight),
    drawText(target: RgbaImage, text, x, y, font, fill, stroke, strokeWidth) {
      calls.push({ text, x, y, font, fill, stroke, strokeWidth, layerWidth: target.width, layerHeight: target.height });
    },
  };
}

function inputImage(g: GoldenBase): PremulImage {
  return solid(g.width, g.height, g.input);
}

function expectedImage(g: GoldenBase): Uint8Array {
  return new Uint8Array(inflateSync(Buffer.from(g.backgroundOnly, "base64")));
}

/** Pixel comparison summary: differing pixels and the largest channel difference. */
function compare(actual: PremulImage, expected: Uint8Array): { pixels: number; maxDiff: number } {
  let pixels = 0;
  let maxDiff = 0;
  for (let i = 0; i < expected.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c += 1) d = Math.max(d, Math.abs(actual.data[i + c]! - expected[i + c]!));
    if (d > 0) pixels += 1;
    maxDiff = Math.max(maxDiff, d);
  }
  return { pixels, maxDiff };
}

/** Union of positioned ink rects (plus half the stroke) in whole pixels, clipped to `clip`. */
function inkBox(
  items: readonly { x: number; y: number; ink: TextRect }[],
  half: number,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const { x, y, ink } of items) {
    if (!(ink.width > 0) || !(ink.height > 0)) continue;
    x0 = Math.min(x0, x + ink.x - half);
    y0 = Math.min(y0, y + ink.y - half);
    x1 = Math.max(x1, x + ink.x + ink.width + half);
    y1 = Math.max(y1, y + ink.y + ink.height + half);
  }
  if (!Number.isFinite(x0)) return null;
  let box: [number, number, number, number] = [Math.floor(x0), Math.floor(y0), Math.ceil(x1) - 1, Math.ceil(y1) - 1];
  if (clip) box = [Math.max(box[0], clip.x0), Math.max(box[1], clip.y0), Math.min(box[2], clip.x1 - 1), Math.min(box[3], clip.y1 - 1)];
  return box;
}

function expectTextBox(actual: [number, number, number, number] | null, expected: [number, number, number, number] | null): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  for (let k = 0; k < 4; k += 1) expect(Math.abs(actual![k]! - expected[k]!), `edge ${k}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1);
}

const fpsOf = (f: [number, number] | null | undefined): { num: number; den: number } | undefined => (f ? { num: f[0], den: f[1] } : undefined);

describe(`Caption matches libopenshot ${doc.libopenshot}`, () => {
  it("parses every cue corpus text like Qt's QRegularExpression", () => {
    for (const c of doc.cues) expect(cueSummary(parseCaptions(c.text)), JSON.stringify(c.text)).toEqual(c.cues.map(({ start, end, lines }) => ({ start, end, lines })));
  });

  for (const [name, g] of Object.entries(doc.caption)) {
    it(name, () => {
      const params = evaluateEffectParams(g.effect, g.frame);
      const raster = recordedRaster(g.metrics, "caption");
      const ctx = ctxFor(g.width, g.height, g.frame, { fps: fpsOf(g.fps), text: raster });
      const layout = layoutCaption(params, g.width, g.height, g.frame, captionFps(ctx), raster);
      expect(layout.lines.map((l) => l.text)).toEqual(g.lines);

      // The background alone (font_alpha 0) against libopenshot's render: bit-exact.
      const bg = inputImage(g);
      caption.run(bg, { ...params, font_alpha: 0 }, ctx);
      expect(raster.calls).toEqual([]);
      const diff = compare(bg, expectedImage(g));
      expect(diff.maxDiff, `${diff.pixels} pixels differ`).toBe(0);

      // Where the text lands: the laid-out ink (+ stroke) against the pixels libopenshot's text changed.
      caption.run(inputImage(g), params, ctx);
      const visible = alpha16(layout.textAlpha) > 0;
      expect(raster.calls.map((c) => c.text)).toEqual(visible ? layout.lines.filter((l) => l.ink.width > 0 && l.ink.height > 0).map((l) => l.text) : []);
      const clip = clipRectRegion(layout.clip.x, layout.clip.y, layout.clip.width, layout.clip.height, g.width, g.height);
      const half = layout.strokeWidth > 0 ? layout.strokeWidth / 2 : 0;
      expectTextBox(visible && clip ? inkBox(layout.lines, half, clip) : null, g.textBox);
    });
  }
});

describe(`Timer matches libopenshot ${doc.libopenshot}`, () => {
  for (const [name, g] of Object.entries(doc.timer)) {
    it(name, () => {
      const params = evaluateEffectParams(g.effect, g.frame);
      const raster = recordedRaster(g.metrics, "timer");
      const ctx = ctxFor(g.width, g.height, g.frame, { fps: fpsOf(g.ctx.fps), text: raster, ...(g.ctx.clip ? { clip: g.ctx.clip } : {}) });
      expect(timerText(params, ctx)).toBe(g.timerText);
      expect(timerLayoutText(params, ctx)).toBe(g.layoutText);

      const bg = inputImage(g);
      timer.run(bg, { ...params, font_alpha: 0 }, ctx);
      expect(raster.calls).toEqual([]);
      const diff = compare(bg, expectedImage(g));
      expect(diff.maxDiff, `${diff.pixels} pixels differ`).toBe(0);

      const layout = layoutTimer(params, g.width, g.height, ctx, raster);
      timer.run(inputImage(g), params, ctx);
      const visible = alpha16(layout.textAlpha) > 0;
      expect(raster.calls.length > 0).toBe(visible);
      expectTextBox(visible ? inkBox(layout.runs, layout.strokeWidth / 2) : null, g.textBox);
    });
  }
});
