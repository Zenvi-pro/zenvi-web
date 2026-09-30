/**
 * `TextRasterizer` for Node (engine render/types.ts): what Caption and Timer
 * need from a font engine. The engine does the layout; this answers metric
 * questions from the font's own tables (opentype.ts) and draws glyphs with
 * resvg using the same font file, so measurements and pixels agree.
 *
 * Fonts resolve like SVG titles (fonts.ts): installed family, then a close
 * substitute, then the system sans, then the bundled Lato.
 */

import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-wasm";
import type { RGBA, RgbaImage, TextFont, TextRasterizer, TextRect } from "@zenvi/engine";
import { FontIndex, resolveFonts, sharedFontIndex } from "./fonts.js";
import { faceOffsets, parseOpenType, type OpenTypeFont } from "./opentype.js";
import { initResvg } from "./rasterize.js";

interface LoadedFont {
  file: string;
  bytes: Uint8Array;
  font: OpenTypeFont;
  /** The family name resvg knows the face by. */
  family: string;
}

const STYLE_WORDS = /(bold|italic|oblique|light|thin|black|heavy|medium|semibold|demibold|condensed|narrow|extra|ultra)/i;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rgba(color: RGBA): { rgb: string; alpha: string } {
  return { rgb: `rgb(${color[0]},${color[1]},${color[2]})`, alpha: (color[3] / 255).toFixed(4) };
}

function codePoints(text: string): number[] {
  return Array.from(text, (ch) => ch.codePointAt(0) ?? 0);
}

export class NodeTextRasterizer implements TextRasterizer {
  private readonly loaded = new Map<string, LoadedFont>();
  private readonly inkCache = new Map<string, TextRect>();

  constructor(private readonly fonts: FontIndex) {}

  /** The face used for a family (regular style preferred). */
  private load(family: string): LoadedFont {
    const key = family.toLowerCase();
    const hit = this.loaded.get(key);
    if (hit) return hit;
    const resolved = resolveFonts(this.fonts, [[family]]);
    const chosen = this.fonts.has(family) ? family : (resolved.fallbackFor([family]) ?? resolved.sansSerif);
    const files = this.fonts.files(chosen);
    const ordered = [...files].sort((a, b) => Number(STYLE_WORDS.test(a.split(/[\\/]/).pop() ?? "")) - Number(STYLE_WORDS.test(b.split(/[\\/]/).pop() ?? "")));
    for (const file of ordered) {
      try {
        const bytes = new Uint8Array(readFileSync(file));
        const faces = faceOffsets(bytes);
        let pick: OpenTypeFont | undefined;
        for (const offset of faces) {
          const font = parseOpenType(bytes, offset);
          if (font.families.some((f) => f.toLowerCase() === chosen.toLowerCase())) {
            pick = font;
            break;
          }
          pick ??= font;
        }
        if (!pick) continue;
        const loaded: LoadedFont = { file, bytes, font: pick, family: pick.families.find((f) => f.toLowerCase() === chosen.toLowerCase()) ?? pick.families[0] ?? chosen };
        this.loaded.set(key, loaded);
        return loaded;
      } catch {
        // Unparseable face: try the next file.
      }
    }
    throw new Error(`No usable font for "${family}".`);
  }

  private scale(loaded: LoadedFont, font: TextFont): number {
    return font.pixelSize / loaded.font.unitsPerEm;
  }

  fontMetrics(font: TextFont): { ascent: number; descent: number; lineSpacing: number } {
    const loaded = this.load(font.family);
    const s = this.scale(loaded, font);
    const ascent = loaded.font.ascender * s;
    const descent = -loaded.font.descender * s;
    return { ascent, descent, lineSpacing: ascent + descent + Math.max(0, loaded.font.lineGap) * s };
  }

  private layout(text: string, font: TextFont): { loaded: LoadedFont; glyphs: number[]; pens: number[]; width: number } {
    const loaded = this.load(font.family);
    const s = this.scale(loaded, font);
    const glyphs = codePoints(text).map((cp) => loaded.font.glyphIndex(cp));
    const pens: number[] = [];
    let pen = 0;
    glyphs.forEach((g, i) => {
      if (i > 0) pen += loaded.font.kerning(glyphs[i - 1]!, g) * s;
      pens.push(pen);
      pen += loaded.font.advanceWidth(g) * s;
    });
    return { loaded, glyphs, pens, width: pen };
  }

  advance(text: string, font: TextFont): number {
    return this.layout(text, font).width;
  }

  bounds(text: string, font: TextFont): TextRect {
    const m = this.fontMetrics(font);
    return { x: 0, y: -m.ascent, width: this.advance(text, font), height: m.ascent + m.descent };
  }

  inkBounds(text: string, font: TextFont): TextRect {
    const key = `${font.family}\0${font.pixelSize}\0${text}`;
    const cached = this.inkCache.get(key);
    if (cached) return cached;
    const { loaded, glyphs, pens, width } = this.layout(text, font);
    const s = this.scale(loaded, font);
    let rect: TextRect | undefined;
    if (loaded.font.hasGlyphBoxes) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      glyphs.forEach((g, i) => {
        const box = loaded.font.glyphBox(g);
        if (!box) return;
        x0 = Math.min(x0, pens[i]! + box.xMin * s);
        x1 = Math.max(x1, pens[i]! + box.xMax * s);
        y0 = Math.min(y0, -box.yMax * s);
        y1 = Math.max(y1, -box.yMin * s);
      });
      rect = Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: 0, height: 0 };
    } else {
      rect = this.rasterInk(text, font, width);
    }
    if (this.inkCache.size > 512) this.inkCache.clear();
    this.inkCache.set(key, rect);
    return rect;
  }

  /** Ink bounds by drawing the text (CFF outlines have no glyph boxes to read). */
  private rasterInk(text: string, font: TextFont, advance: number): TextRect {
    const px = font.pixelSize;
    const pad = Math.ceil(px);
    const w = Math.max(1, Math.ceil(advance + 2 * pad));
    const h = Math.max(1, Math.ceil(3 * px));
    const baseline = 2 * px;
    const image = this.render(text, font, { x: -pad, y: -baseline, width: w, height: h }, 0, 0, [255, 255, 255, 255], null, 0);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (image.data[(y * image.width + x) * 4 + 3]! > 0) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x + 1);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y + 1);
        }
      }
    }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: x0 - pad, y: y0 - baseline, width: x1 - x0, height: y1 - y0 };
  }

  /** Rasterize `text` (baseline at x, y in region coordinates) into a region-sized straight-RGBA image. */
  private render(text: string, font: TextFont, region: TextRect, x: number, y: number, fill: RGBA, stroke: RGBA | null, strokeWidth: number): RgbaImage {
    const loaded = this.load(font.family);
    const f = rgba(fill);
    const strokeAttrs =
      stroke && strokeWidth > 0
        ? ` stroke="${rgba(stroke).rgb}" stroke-opacity="${rgba(stroke).alpha}" stroke-width="${strokeWidth}" stroke-linecap="square" stroke-linejoin="bevel"`
        : "";
    const w = Math.max(1, Math.ceil(region.width));
    const h = Math.max(1, Math.ceil(region.height));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${region.x} ${region.y} ${w} ${h}">` +
      `<text x="${x}" y="${y}" font-family="${esc(loaded.family)}" font-size="${font.pixelSize}" fill="${f.rgb}" fill-opacity="${f.alpha}"${strokeAttrs} xml:space="preserve">${esc(text)}</text></svg>`;
    const renderer = new Resvg(svg, {
      font: { fontBuffers: [loaded.bytes], defaultFontFamily: loaded.family, sansSerifFamily: loaded.family },
      textRendering: 2,
      shapeRendering: 2,
    });
    try {
      const out = renderer.render();
      try {
        const px = out.pixels;
        const data = new Uint8ClampedArray(px.length);
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3]!;
          if (a === 0) continue;
          const k = 255 / a;
          data[i] = px[i]! * k;
          data[i + 1] = px[i + 1]! * k;
          data[i + 2] = px[i + 2]! * k;
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

  drawText(target: RgbaImage, text: string, x: number, y: number, font: TextFont, fill: RGBA, stroke: RGBA | null, strokeWidth: number, clip?: TextRect): void {
    if (!text) return;
    const ink = this.inkBounds(text, font);
    const pad = Math.ceil((stroke ? strokeWidth : 0) + 2);
    let rx0 = Math.floor(x + ink.x - pad);
    let ry0 = Math.floor(y + ink.y - pad);
    let rx1 = Math.ceil(x + ink.x + ink.width + pad);
    let ry1 = Math.ceil(y + ink.y + ink.height + pad);
    rx0 = Math.max(rx0, 0, clip ? Math.floor(clip.x) : 0);
    ry0 = Math.max(ry0, 0, clip ? Math.floor(clip.y) : 0);
    rx1 = Math.min(rx1, target.width, clip ? Math.ceil(clip.x + clip.width) : target.width);
    ry1 = Math.min(ry1, target.height, clip ? Math.ceil(clip.y + clip.height) : target.height);
    if (rx1 <= rx0 || ry1 <= ry0) return;
    const layer = this.render(text, font, { x: rx0, y: ry0, width: rx1 - rx0, height: ry1 - ry0 }, x, y, fill, stroke, strokeWidth);
    const t = target.data;
    const l = layer.data;
    for (let yy = 0; yy < layer.height; yy += 1) {
      const ty = ry0 + yy;
      if (ty >= target.height) break;
      for (let xx = 0; xx < layer.width; xx += 1) {
        const tx = rx0 + xx;
        if (tx >= target.width) break;
        const li = (yy * layer.width + xx) * 4;
        const la = l[li + 3]! / 255;
        if (la === 0) continue;
        const ti = (ty * target.width + tx) * 4;
        const ta = t[ti + 3]! / 255;
        const oa = la + ta * (1 - la);
        t[ti] = (l[li]! * la + t[ti]! * ta * (1 - la)) / oa;
        t[ti + 1] = (l[li + 1]! * la + t[ti + 1]! * ta * (1 - la)) / oa;
        t[ti + 2] = (l[li + 2]! * la + t[ti + 2]! * ta * (1 - la)) / oa;
        t[ti + 3] = oa * 255;
      }
    }
  }
}

let shared: Promise<NodeTextRasterizer> | undefined;

/** Process-wide rasterizer (font index scanned and resvg loaded once). */
export function nodeTextRasterizer(): Promise<NodeTextRasterizer> {
  shared ??= Promise.all([sharedFontIndex(), initResvg()]).then(([index]) => new NodeTextRasterizer(index));
  return shared;
}
