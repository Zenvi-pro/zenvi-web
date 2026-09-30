/**
 * SVG → RGBA with resvg (WebAssembly), the same renderer libopenshot's
 * QtImageReader uses for titles, transition masks and emojis.
 *
 * Fonts: the SVG's `font-family` lists are resolved against the OS fonts
 * (see fonts.ts). A family that is not installed gets an installed fallback
 * appended to its list, so a DejaVu Sans title renders in a similar sans face
 * instead of resvg's serif default.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { RgbaImage } from "@zenvi/engine";
import { resvgWasmPath } from "../resources.js";
import { resizeRgba } from "../image/rgba.js";
import { readFontFile, resolveFonts, sharedFontIndex, type FontIndex } from "./fonts.js";

let ready: Promise<void> | undefined;

/** Load resvg's WASM once per process. */
export function initResvg(): Promise<void> {
  ready ??= readFile(resvgWasmPath())
    .then((wasm) => initWasm(wasm))
    .catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
  return ready;
}

/** Read an .svg or .svgz file as text. */
export async function readSvgFile(file: string): Promise<string> {
  const bytes = await readFile(file);
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (isGzip ? gunzipSync(bytes) : bytes).toString("utf8");
}

/** `font-family="…"` / `font-family='…'` presentation attributes. */
const ATTR_RE = /(\bfont-family\s*=\s*)(["'])(.*?)\2/gi;
/** `font-family:…` inside a style attribute (no double quotes can occur there). */
const INLINE_CSS_RE = /(\bfont-family\s*:\s*)((?:'[^']*'|[^;"'}<>])+)/gi;
/** `font-family:…` inside a <style> element (either quote style). */
const SHEET_CSS_RE = /(\bfont-family\s*:\s*)((?:"[^"]*"|'[^']*'|[^;"'}<>])+)/gi;
const STYLE_ELEMENT_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;

function splitFamilies(value: string): string[] {
  return value
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, "").trim())
    .filter((f) => f.length > 0);
}

/** A family name as CSS: bare when it is a plain identifier sequence. */
function cssFamily(name: string, avoidQuote: "'" | '"'): string {
  if (/^[A-Za-z][A-Za-z0-9 _-]*$/.test(name)) return name;
  return avoidQuote === "'" ? `"${name}"` : `'${name}'`;
}

type FamilyVisitor = (families: string[]) => string | undefined;

/** Split an SVG into non-<style> text (even indexes) and <style> sheets (odd indexes). */
function segments(svg: string): string[] {
  const parts: string[] = [];
  let last = 0;
  for (const match of svg.matchAll(STYLE_ELEMENT_RE)) {
    const start = match.index + match[1]!.length;
    parts.push(svg.slice(last, start), match[2]!);
    last = start + match[2]!.length;
  }
  parts.push(svg.slice(last));
  return parts;
}

function rewrite(svg: string, visit: FamilyVisitor): string {
  return segments(svg)
    .map((part, i) => {
      if (i % 2 === 1) {
        return part.replace(SHEET_CSS_RE, (whole, prefix: string, value: string) => {
          const fallback = visit(splitFamilies(value));
          return fallback ? `${prefix}${value.trimEnd()}, ${cssFamily(fallback, '"')}` : whole;
        });
      }
      return part
        .replace(ATTR_RE, (whole, prefix: string, quote: "'" | '"', value: string) => {
          const fallback = visit(splitFamilies(value));
          return fallback ? `${prefix}${quote}${value.trimEnd()}, ${cssFamily(fallback, quote)}${quote}` : whole;
        })
        .replace(INLINE_CSS_RE, (whole, prefix: string, value: string) => {
          const fallback = visit(splitFamilies(value));
          return fallback ? `${prefix}${value.trimEnd()}, ${cssFamily(fallback, '"')}` : whole;
        });
    })
    .join("");
}

/** Every font-family list declared in attributes, inline styles or style sheets. */
export function extractFontFamilies(svg: string): string[][] {
  const lists: string[][] = [];
  rewrite(svg, (families) => {
    if (families.length > 0) lists.push(families);
    return undefined;
  });
  return lists;
}

/** Append an installed fallback to each family list that has none installed. */
export function appendFontFallbacks(svg: string, fallbackFor: (requested: string[]) => string | undefined): string {
  return rewrite(svg, (families) => (families.length > 0 ? fallbackFor(families) : undefined));
}

function demultiply(pixels: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]!;
    if (a === 0) continue;
    if (a === 255) {
      out[i] = pixels[i]!;
      out[i + 1] = pixels[i + 1]!;
      out[i + 2] = pixels[i + 2]!;
    } else {
      const k = 255 / a;
      out[i] = Math.round(pixels[i]! * k);
      out[i + 1] = Math.round(pixels[i + 1]! * k);
      out[i + 2] = Math.round(pixels[i + 2]! * k);
    }
    out[i + 3] = a;
  }
  return out;
}

export interface SvgRenderOptions {
  /** Exact output size. Omit both to render at the SVG's own size. */
  width?: number;
  height?: number;
  /** Folder that relative `<image href>` paths resolve against. */
  baseDir?: string;
  fonts?: FontIndex;
}

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

async function resolveImages(renderer: InstanceType<typeof Resvg>, baseDir: string | undefined): Promise<void> {
  const hrefs = renderer.imagesToResolve() as unknown[];
  for (const raw of hrefs) {
    const href = String(raw);
    if (/^(data:|https?:)/i.test(href) || !baseDir) continue;
    const target = path.resolve(baseDir, decodeURI(href.replace(/^file:\/\//, "")));
    try {
      if ((await stat(target)).size > MAX_IMAGE_BYTES) continue;
      renderer.resolveImage(href, new Uint8Array(await readFile(target)));
    } catch {
      // Missing linked image: resvg draws nothing for it, like the desktop.
    }
  }
}

/** SVGs without text (transition masks, emojis) need no fonts at all. */
function hasText(svg: string): boolean {
  return /<(?:\w+:)?(?:text|tspan|textPath)\b/.test(svg);
}

async function prepare(svg: string, fonts?: FontIndex): Promise<{ svg: string; options: ConstructorParameters<typeof Resvg>[1] }> {
  await initResvg();
  const base = { shapeRendering: 2, textRendering: 1, imageRendering: 0 } as const;
  if (!hasText(svg)) return { svg, options: { ...base, font: { fontBuffers: [] } } };
  const index = fonts ?? (await sharedFontIndex());
  const resolved = resolveFonts(index, extractFontFamilies(svg));
  const fontBuffers = await Promise.all(resolved.files.map(readFontFile));
  return {
    svg: appendFontFallbacks(svg, resolved.fallbackFor),
    options: {
      ...base,
      font: {
        fontBuffers,
        defaultFontFamily: resolved.sansSerif,
        sansSerifFamily: resolved.sansSerif,
        serifFamily: resolved.serif,
        monospaceFamily: resolved.monospace,
      },
    },
  };
}

/** Intrinsic size of an SVG in pixels (QtImageReader `default_svg_size`). */
export async function svgIntrinsicSize(svg: string): Promise<{ width: number; height: number }> {
  await initResvg();
  const renderer = new Resvg(svg, { font: { fontBuffers: [] } });
  try {
    return { width: Math.round(renderer.width), height: Math.round(renderer.height) };
  } finally {
    renderer.free();
  }
}

/** Rasterize to straight RGBA at exactly `width`×`height` (or the intrinsic size). */
export async function rasterizeSvg(svgText: string, options: SvgRenderOptions = {}): Promise<RgbaImage> {
  const { svg, options: resvgOptions } = await prepare(svgText, options.fonts);
  const probe = new Resvg(svg, resvgOptions);
  let image: RgbaImage;
  try {
    const iw = probe.width;
    const ih = probe.height;
    if (!(iw > 0 && ih > 0)) throw new Error("SVG has no size (missing width/height and viewBox).");
    const targetW = Math.max(1, Math.round(options.width ?? (options.height ? (options.height * iw) / ih : iw)));
    const targetH = Math.max(1, Math.round(options.height ?? (options.width ? (options.width * ih) / iw : ih)));
    // Render at the target width with the SVG's own aspect, then resample if
    // the requested aspect differs (stretch scale mode).
    const renderer = new Resvg(svg, { ...resvgOptions, fitTo: { mode: "width", value: targetW } });
    try {
      await resolveImages(renderer, options.baseDir);
      const rendered = renderer.render();
      try {
        image = { width: rendered.width, height: rendered.height, data: demultiply(rendered.pixels) };
      } finally {
        rendered.free();
      }
    } finally {
      renderer.free();
    }
    if (image.width !== targetW || image.height !== targetH) image = resizeRgba(image, targetW, targetH);
  } finally {
    probe.free();
  }
  return image;
}

/** Rasterize an SVG file (relative images resolve next to it). */
export async function rasterizeSvgFile(file: string, options: Omit<SvgRenderOptions, "baseDir"> = {}): Promise<RgbaImage> {
  return rasterizeSvg(await readSvgFile(file), { ...options, baseDir: path.dirname(file) });
}
