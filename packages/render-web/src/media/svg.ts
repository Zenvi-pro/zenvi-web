/**
 * SVG sizing and rasterization.
 *
 * libopenshot reads SVG (titles, transition masks) with QtSvg
 * (`QtImageReader.cpp`, libopenshot-semantics §5.3). Its default size rules
 * differ from browsers, and the reported size is stored in the project, so
 * `parseSvgSize` reproduces QtSvg (Qt 5.15 `qsvghandler.cpp` `createSvgNode`,
 * `QSvgTinyDocument::size`), measured through libopenshot:
 *
 * - `width`/`height` win when both are valid; lengths are truncated to int.
 * - Absolute units use 90 DPI: in ×90, cm ×35.43307, mm ×3.543307. `pt` and
 *   `pc` are NOT converted (a Qt quirk: `72pt` is 72 px). `em`/`ex` are invalid.
 * - Percentages scale the viewBox size.
 * - Otherwise the viewBox size, rounded.
 * - Otherwise the content bounds, which only a renderer knows (null here).
 *
 * Rasterization is pluggable (`SvgRasterizer`) because the browser's only SVG
 * renderer is the `<img>` element, which exists on the main thread only.
 */

export interface SvgSize {
  width: number;
  height: number;
}

const ROOT_TAG = /<svg\b([^>]*)>/i;

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attributes);
  return match ? (match[2] ?? match[3]) : undefined;
}

interface Length {
  value: number;
  percent: boolean;
}

function parseLength(text: string | undefined): Length | null {
  if (text === undefined) return null;
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|%|em|ex)?\s*$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2] ?? "px";
  switch (unit) {
    case "in":
      return { value: value * 90, percent: false };
    case "cm":
      return { value: value * 35.43307, percent: false };
    case "mm":
      return { value: value * 3.543307, percent: false };
    case "%":
      return { value, percent: true };
    case "em":
    case "ex":
      return null;
    default:
      return { value, percent: false };
  }
}

function parseViewBox(text: string | undefined): SvgSize | null {
  if (text === undefined) return null;
  const numbers = text
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) return null;
  const [, , w, h] = numbers as [number, number, number, number];
  return w > 0 && h > 0 ? { width: w, height: h } : null;
}

/** QtSvg's default size of an SVG document, or null when it depends on the content bounds. */
export function parseSvgSize(svgText: string): SvgSize | null {
  const root = ROOT_TAG.exec(svgText);
  if (!root) return null;
  const attributes = root[1] ?? "";
  const viewBox = parseViewBox(attribute(attributes, "viewBox"));
  const width = parseLength(attribute(attributes, "width"));
  const height = parseLength(attribute(attributes, "height"));

  const resolve = (length: Length | null, viewBoxLength: number | undefined): number => {
    if (!length) return 0;
    // QSvgTinyDocument stores int(width) first, then scales the viewBox by it.
    if (length.percent) return viewBoxLength !== undefined ? Math.round(0.01 * Math.trunc(length.value) * viewBoxLength) : 0;
    return Math.trunc(length.value);
  };
  const w = resolve(width, viewBox?.width);
  const h = resolve(height, viewBox?.height);
  if (w > 0 && h > 0) return { width: w, height: h };
  if (viewBox) return { width: Math.round(viewBox.width), height: Math.round(viewBox.height) };
  return null;
}

/**
 * Renders an SVG document into a bitmap of exactly `width × height` pixels,
 * stretching the document's viewport to fill it (QtSvg `render()` ignores the
 * aspect ratio, libopenshot-semantics §5.3).
 */
export type SvgRasterizer = (svg: Blob, width: number, height: number) => Promise<ImageBitmap>;

/**
 * The target size libopenshot rasterizes an SVG at before stretching it to
 * `box`: the document size scaled into the box keeping its aspect ratio
 * (`QtImageReader.cpp`, `QSize::scaled(box, KeepAspectRatio)`).
 */
export function svgRasterSize(svgSize: SvgSize, box: SvgSize): SvgSize {
  if (svgSize.width <= 0 || svgSize.height <= 0) return { width: Math.max(1, box.width), height: Math.max(1, box.height) };
  // QSize::scale(KeepAspectRatio) with Qt's integer math (libopenshot-semantics §0).
  const rw = Math.trunc((box.height * svgSize.width) / svgSize.height);
  if (rw <= box.width) return { width: Math.max(1, rw), height: Math.max(1, box.height) };
  return { width: Math.max(1, box.width), height: Math.max(1, Math.trunc((box.width * svgSize.height) / svgSize.width)) };
}
