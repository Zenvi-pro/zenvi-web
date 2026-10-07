import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createRgba } from "../image/rgba.js";
import { bundledFontsDir } from "../resources.js";
import { FontIndex } from "./fonts.js";
import { parseOpenType } from "./opentype.js";
import { initResvg } from "./rasterize.js";
import { NodeTextRasterizer } from "./text.js";

const latoPath = path.join(bundledFontsDir(), "Lato-Regular.ttf");
const index = new FontIndex([{ path: latoPath, families: ["lato"], size: 1 }]);
const font = { family: "Lato", pixelSize: 40 };

beforeAll(async () => {
  await initResvg();
});

function inked(img: { width: number; height: number; data: Uint8ClampedArray }) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let count = 0;
  for (let y = 0; y < img.height; y += 1)
    for (let x = 0; x < img.width; x += 1)
      if (img.data[(y * img.width + x) * 4 + 3]! > 64) {
        count += 1;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return { x0, y0, x1, y1, count };
}

describe("OpenType metrics", () => {
  it("reads Lato's tables", () => {
    const lato = parseOpenType(new Uint8Array(readFileSync(latoPath)));
    expect(lato.families).toContain("Lato");
    expect(lato.unitsPerEm).toBe(2000);
    expect(lato.ascender).toBeGreaterThan(1500);
    expect(lato.descender).toBeLessThan(0);
    const a = lato.glyphIndex("A".codePointAt(0)!);
    expect(a).toBeGreaterThan(0);
    expect(lato.advanceWidth(a)).toBeGreaterThan(1000);
    expect(lato.glyphBox(a)).toMatchObject({ yMin: 0 });
    expect(lato.hasGlyphBoxes).toBe(true);
  });
});

describe("NodeTextRasterizer", () => {
  const text = new NodeTextRasterizer(index);

  it("reports QFontMetricsF-style metrics in pixels", () => {
    const lato = parseOpenType(new Uint8Array(readFileSync(latoPath)));
    const m = text.fontMetrics(font);
    expect(m.ascent).toBeCloseTo((lato.ascender * 40) / 2000, 6);
    expect(m.descent).toBeCloseTo((-lato.descender * 40) / 2000, 6);
    expect(m.lineSpacing).toBeGreaterThanOrEqual(m.ascent + m.descent);
    expect(text.advance("WWW", font)).toBeGreaterThan(text.advance("iii", font));
    expect(text.advance("", font)).toBe(0);
    const b = text.bounds("Zenvi", font);
    expect(b).toMatchObject({ x: 0, y: -m.ascent });
    expect(b.width).toBeCloseTo(text.advance("Zenvi", font), 6);
  });

  it("measures ink above the baseline", () => {
    const ink = text.inkBounds("Hx", font);
    expect(ink.y).toBeLessThan(0);
    expect(ink.y + ink.height).toBeCloseTo(0, 0);
    expect(ink.height).toBeGreaterThan(25);
    expect(ink.width).toBeLessThanOrEqual(text.advance("Hx", font) + 1);
  });

  it("draws glyphs where the metrics say they are", () => {
    const target = createRgba(300, 80);
    text.drawText(target, "Zenvi", 20, 60, font, [255, 255, 255, 255], null, 0);
    const ink = text.inkBounds("Zenvi", font);
    const drawn = inked(target);
    expect(drawn.count).toBeGreaterThan(300);
    expect(Math.abs(drawn.x0 - (20 + ink.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(drawn.y0 - (60 + ink.y))).toBeLessThanOrEqual(2);
    expect(Math.abs(drawn.x1 - (20 + ink.x + ink.width))).toBeLessThanOrEqual(2);
    // straight alpha: fully covered pixels are white
    const i = ((drawn.y0 + drawn.y1) >> 1) * 300 * 4;
    expect(target.data.slice(i, i + 300 * 4).some((v, k) => k % 4 === 3 && v === 255)).toBe(true);
  });

  it("strokes outside the fill and respects the clip", () => {
    const plain = createRgba(300, 80);
    const stroked = createRgba(300, 80);
    text.drawText(plain, "Zenvi", 20, 60, font, [255, 255, 255, 255], null, 0);
    text.drawText(stroked, "Zenvi", 20, 60, font, [255, 255, 255, 255], [0, 0, 0, 255], 4);
    expect(inked(stroked).count).toBeGreaterThan(inked(plain).count);
    const clipped = createRgba(300, 80);
    text.drawText(clipped, "Zenvi", 20, 60, font, [255, 0, 0, 255], null, 0, { x: 0, y: 0, width: 60, height: 80 });
    expect(inked(clipped).x1).toBeLessThan(60);
  });

  it("falls back to an installed face for unknown families", () => {
    expect(text.fontMetrics({ family: "No Such Font", pixelSize: 20 }).ascent).toBeGreaterThan(0);
  });
});
