/**
 * PNG decoding: images encoded here with Node's zlib (every deflate block
 * type and strategy) and every scanline filter, colour type, bit depth and
 * Adam7 interlacing decode back to the pixels they were made from.
 */

import { constants, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PNG_1PX } from "../tools/test-support/fake-host.js";
import { decodePng, decodePngBase64, PngDecodeError, zlibInflate } from "./png.js";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s >>> 24;
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Filter packed scanlines (filter type per row = row index % 5). */
function filterRows(rows: Uint8Array[], bpp: number): Uint8Array {
  const stride = rows[0]?.length ?? 0;
  const out = new Uint8Array(rows.length * (stride + 1));
  rows.forEach((row, y) => {
    const prev = y > 0 ? rows[y - 1]! : new Uint8Array(stride);
    const type = y % 5;
    out[y * (stride + 1)] = type;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? row[x - bpp]! : 0;
      const up = prev[x]!;
      const upLeft = x >= bpp ? prev[x - bpp]! : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type]!;
      out[y * (stride + 1) + 1 + x] = (row[x]! - predictor) & 255;
    }
  });
  return out;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out; // CRC left zero: the decoder does not check it.
}

function png(
  width: number,
  height: number,
  depth: number,
  colorType: number,
  idat: Uint8Array,
  opts: { interlace?: boolean; plte?: Uint8Array; trns?: Uint8Array; split?: number } = {},
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  ihdr[12] = opts.interlace ? 1 : 0;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (opts.plte) parts.push(chunk("PLTE", opts.plte));
  if (opts.trns) parts.push(chunk("tRNS", opts.trns));
  const split = opts.split ?? idat.length;
  for (let i = 0; i < idat.length; i += Math.max(1, split)) parts.push(chunk("IDAT", idat.subarray(i, i + split)));
  parts.push(chunk("IEND", new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An RGBA image with smooth areas and noise (exercises every filter and back-references). */
function testImage(width: number, height: number, seed: number): Uint8ClampedArray {
  const r = rng(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const smooth = x < width / 2;
      data[i] = smooth ? (x * 7) & 255 : r();
      data[i + 1] = smooth ? (y * 5) & 255 : r();
      data[i + 2] = smooth ? ((x + y) * 3) & 255 : r();
      data[i + 3] = smooth ? 255 : r();
    }
  }
  return data;
}

function rgbaRows(data: Uint8ClampedArray, width: number, height: number): Uint8Array[] {
  return Array.from({ length: height }, (_, y) => new Uint8Array(data.buffer, y * width * 4, width * 4).slice());
}

describe("zlibInflate", () => {
  it("inflates stored, fixed and dynamic blocks", () => {
    const text = new TextEncoder().encode("the quick brown fox ".repeat(400) + "jumps".repeat(3));
    for (const options of [
      { level: 0 },
      { level: 1 },
      { level: 9 },
      { level: 6, strategy: constants.Z_FIXED },
      { level: 6, strategy: constants.Z_HUFFMAN_ONLY },
      { level: 6, strategy: constants.Z_RLE },
    ]) {
      expect(Array.from(zlibInflate(new Uint8Array(deflateSync(text, options)))), JSON.stringify(options)).toEqual(Array.from(text));
    }
  });

  it("refuses data that is not zlib", () => {
    expect(() => zlibInflate(new Uint8Array([1, 2, 3, 4]))).toThrow(PngDecodeError);
    const noise = rng(5);
    const good = new Uint8Array(deflateSync(Uint8Array.from({ length: 5000 }, () => noise())));
    expect(good.length).toBeGreaterThan(1000);
    expect(() => zlibInflate(good.subarray(0, 400))).toThrow(PngDecodeError);
  });
});

describe("decodePng", () => {
  it("decodes the 1x1 PNG the fake host renders", () => {
    const image = decodePngBase64(PNG_1PX);
    expect([image.width, image.height]).toEqual([1, 1]);
    expect(Array.from(image.data)).toHaveLength(4);
  });

  it("round-trips 8-bit RGBA through every filter, compression level and chunk split", () => {
    const [w, h] = [37, 23];
    const data = testImage(w, h, 7);
    const raw = filterRows(rgbaRows(data, w, h), 4);
    for (const level of [0, 1, 9]) {
      const file = png(w, h, 8, 6, new Uint8Array(deflateSync(raw, { level })), { split: 97 });
      const image = decodePng(file);
      expect([image.width, image.height]).toEqual([w, h]);
      expect(Array.from(image.data)).toEqual(Array.from(data));
    }
  });

  it("decodes RGB, gray, gray+alpha, palette and 16-bit images to RGBA", () => {
    const [w, h] = [9, 6];
    const r = rng(3);
    // RGB 8-bit with a transparent colour.
    const rgbRows = Array.from({ length: h }, (_, y) => Uint8Array.from({ length: w * 3 }, (_, i) => (y === 0 && i < 3 ? 10 : r())));
    const rgb = decodePng(png(w, h, 8, 2, new Uint8Array(deflateSync(filterRows(rgbRows, 3))), { trns: new Uint8Array([0, 10, 0, 10, 0, 10]) }));
    expect(Array.from(rgb.data.slice(0, 4))).toEqual([10, 10, 10, 0]);
    expect(Array.from(rgb.data.slice(4, 8))).toEqual([rgbRows[0]![3], rgbRows[0]![4], rgbRows[0]![5], 255]);
    // Gray 2-bit: 0..3 scale to 0, 85, 170, 255.
    const grayRows = [new Uint8Array([0b00011011, 0b11100100, 0b00000000])];
    const gray = decodePng(png(9, 1, 2, 0, new Uint8Array(deflateSync(filterRows(grayRows, 1)))));
    expect(Array.from(gray.data.filter((_, i) => i % 4 === 0))).toEqual([0, 85, 170, 255, 255, 170, 85, 0, 0]);
    // Gray + alpha 16-bit keeps the high bytes.
    const gaRows = [new Uint8Array([0x12, 0x34, 0xab, 0xcd])];
    const ga = decodePng(png(1, 1, 16, 4, new Uint8Array(deflateSync(filterRows(gaRows, 4)))));
    expect(Array.from(ga.data)).toEqual([0x12, 0x12, 0x12, 0xab]);
    // Palette 4-bit with partial tRNS.
    const plte = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const palRows = [new Uint8Array([0x01, 0x20])];
    const pal = decodePng(png(3, 1, 4, 3, new Uint8Array(deflateSync(filterRows(palRows, 1))), { plte, trns: new Uint8Array([128]) }));
    expect(Array.from(pal.data)).toEqual([255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 255]);
    // RGBA 16-bit.
    const deepRows = [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])];
    expect(Array.from(decodePng(png(1, 1, 16, 6, new Uint8Array(deflateSync(filterRows(deepRows, 8))))).data)).toEqual([1, 3, 5, 7]);
  });

  it("decodes Adam7 interlaced images", () => {
    const [w, h] = [11, 9];
    const data = testImage(w, h, 11);
    const passes: [number, number, number, number][] = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ];
    const chunks: Uint8Array[] = [];
    for (const [x0, y0, dx, dy] of passes) {
      const rows: Uint8Array[] = [];
      for (let y = y0; y < h; y += dy) {
        const row: number[] = [];
        for (let x = x0; x < w; x += dx) row.push(...data.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
        if (row.length) rows.push(Uint8Array.from(row));
      }
      if (rows.length) chunks.push(filterRows(rows, 4));
    }
    const raw = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      raw.set(c, at);
      at += c.length;
    }
    const image = decodePng(png(w, h, 8, 6, new Uint8Array(deflateSync(raw)), { interlace: true }));
    expect(Array.from(image.data)).toEqual(Array.from(data));
  });

  it("refuses what is not a PNG", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(PngDecodeError);
    expect(() => decodePng(png(1, 1, 3, 6, new Uint8Array(deflateSync(new Uint8Array(5)))))).toThrow(/colour type/);
  });
});
