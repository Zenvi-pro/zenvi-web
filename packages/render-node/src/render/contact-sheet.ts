/**
 * A labelled contact sheet of timeline frames (`FrameHost.renderSheet`): the
 * engine's review_edit_tool picks the frames and the grid, this renders them
 * (one decoder set shared across tiles, frames in time order), pastes them
 * into one JPEG, prints each tile's label, and measures each tile's mean
 * brightness so flashes and black frames can be told apart from the footage.
 */

import type { Project, RgbaImage, SheetLayoutRequest, SheetResult, SheetTileRequest } from "@zenvi/engine";
import { SourceManager, type MediaResolver } from "../decode/sources.js";
import { createRgba, flattenOver, resizeRgba } from "../image/rgba.js";
import { rasterizeSvg } from "../svg/rasterize.js";
import { blendOver, esc, textWidth } from "./overlay.js";
import { encodeJpeg, renderFrameImage } from "./render-frame.js";
import type { RenderEngine } from "./engine.js";

export interface ContactSheetOptions {
  resolveMedia: MediaResolver;
  engine?: RenderEngine;
  signal?: AbortSignal;
  log?: (message: string) => void;
  /** JPEG quality 1-100 (default 72: legible at 1,500 image tokens, a small base64). */
  jpegQuality?: number;
}

const BACKGROUND: [number, number, number] = [16, 16, 16];
const BRIGHT_BORDER: [number, number, number] = [255, 176, 0];
const DARK_BORDER: [number, number, number] = [230, 57, 70];
const BORDER = 3;

/** Rec. 709 luma of an opaque-over-black image, 0-1. */
export function meanLuma(image: RgbaImage): number {
  const d = image.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) * (d[i + 3]! / 255);
  return d.length ? sum / (d.length / 4) / 255 : 0;
}

function paste(sheet: RgbaImage, tile: RgbaImage, x: number, y: number): void {
  for (let row = 0; row < tile.height; row += 1) {
    const from = row * tile.width * 4;
    sheet.data.set(tile.data.subarray(from, from + tile.width * 4), ((y + row) * sheet.width + x) * 4);
  }
}

function border(sheet: RgbaImage, x: number, y: number, w: number, h: number, [r, g, b]: [number, number, number]): void {
  const put = (px: number, py: number): void => {
    const i = (py * sheet.width + px) * 4;
    sheet.data[i] = r;
    sheet.data[i + 1] = g;
    sheet.data[i + 2] = b;
    sheet.data[i + 3] = 255;
  };
  for (let t = 0; t < BORDER; t += 1) {
    for (let px = x; px < x + w; px += 1) {
      put(px, y + t);
      put(px, y + h - 1 - t);
    }
    for (let py = y; py < y + h; py += 1) {
      put(x + t, py);
      put(x + w - 1 - t, py);
    }
  }
}

interface Chip {
  text: string;
  x: number;
  y: number;
  fill: string;
}

/** Label chips as one SVG the size of the sheet. */
function labelsSvg(width: number, height: number, size: number, chips: readonly Chip[]): string {
  const th = Math.ceil(size * 1.2);
  const parts = chips.map((chip) => {
    const tw = textWidth(chip.text, size);
    return `<rect x="${chip.x}" y="${chip.y}" width="${tw + 6}" height="${th + 3}" fill="${chip.fill}" fill-opacity="0.78"/><text x="${chip.x + 3}" y="${chip.y + th}" fill="#fff">${esc(chip.text)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${size}">${parts.join("")}</g></svg>`;
}

/** Render `tiles` into one JPEG sheet laid out as `layout` says. */
export async function renderContactSheet(project: Project, tiles: readonly SheetTileRequest[], layout: SheetLayoutRequest, options: ContactSheetOptions): Promise<SheetResult> {
  const { columns, tileWidth, tileHeight, gap } = layout;
  const rows = Math.max(1, Math.ceil(tiles.length / columns));
  const width = columns * tileWidth + (columns + 1) * gap;
  const height = rows * tileHeight + (rows + 1) * gap;
  const sheet = createRgba(width, height);
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = BACKGROUND[0];
    sheet.data[i + 1] = BACKGROUND[1];
    sheet.data[i + 2] = BACKGROUND[2];
    sheet.data[i + 3] = 255;
  }

  const luma: (number | null)[] = [];
  const chips: Chip[] = [];
  const fontSize = Math.max(9, Math.min(15, Math.round(tileWidth / 11)));
  const sources = new SourceManager(project, { resolveMedia: options.resolveMedia, quality: "preview", signal: options.signal });
  try {
    // Time order keeps every decoder moving forward.
    const order = tiles.map((_, i) => i).sort((a, b) => tiles[a]!.seconds - tiles[b]!.seconds);
    const rendered = new Map<number, RgbaImage | null>();
    for (const index of order) {
      if (options.signal?.aborted) break;
      try {
        const frame = await renderFrameImage(project, tiles[index]!.seconds, { resolveMedia: options.resolveMedia, width: tileWidth, engine: options.engine, sources, scaleQuality: "preview", signal: options.signal });
        rendered.set(index, flattenOver(frame.width === tileWidth && frame.height === tileHeight ? frame : resizeRgba(frame, tileWidth, tileHeight), [0, 0, 0]));
      } catch (error) {
        options.log?.(`sheet frame at ${tiles[index]!.seconds}s failed: ${error instanceof Error ? error.message : String(error)}`);
        rendered.set(index, null);
      }
    }
    tiles.forEach((tile, i) => {
      const x = gap + (i % columns) * (tileWidth + gap);
      const y = gap + Math.floor(i / columns) * (tileHeight + gap);
      const image = rendered.get(i) ?? null;
      if (image) {
        paste(sheet, image, x, y);
        const l = meanLuma(image);
        luma.push(l);
        if (layout.mark && l >= layout.mark.bright) border(sheet, x, y, tileWidth, tileHeight, BRIGHT_BORDER);
        else if (layout.mark && l <= layout.mark.dark) border(sheet, x, y, tileWidth, tileHeight, DARK_BORDER);
        const marked = layout.mark ? (l >= layout.mark.bright ? "FLASH" : l <= layout.mark.dark ? "BLACK" : "") : "";
        if (marked) chips.push({ text: marked, x: x + BORDER, y: y + tileHeight - Math.ceil(fontSize * 1.2) - BORDER - 3, fill: l >= (layout.mark?.bright ?? 1) ? "#b36b00" : "#a4161a" });
      } else {
        luma.push(null);
      }
      chips.push({ text: tile.label, x: x + BORDER, y: y + BORDER, fill: "#000" });
    });
  } finally {
    await sources.close();
  }

  const layer = await rasterizeSvg(labelsSvg(width, height, fontSize, chips), { width, height });
  blendOver(sheet, layer);
  const jpeg = await encodeJpeg(sheet, options.jpegQuality ?? 72, options.signal);
  return { image: { mimeType: "image/jpeg", data: jpeg.toString("base64") }, width, height, luma };
}
