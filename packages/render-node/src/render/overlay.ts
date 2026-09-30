/**
 * The inspect-frame overlay: a 0-1 coordinate grid (origin top-left, minor
 * lines every 0.05, labels every 0.1) and a caption chip, drawn like zenvi-core
 * src/classes/agent_tools/inspect_overlay.py `apply_overlay_qimage`, so a
 * model sees the same frame on every surface. Drawn as SVG with resvg and
 * blended over the frame.
 */

import type { FrameOverlay, RgbaImage } from "@zenvi/engine";
import { rasterizeSvg } from "../svg/rasterize.js";

/** Advance widths of Helvetica Bold (em), for sizing label chips like QFontMetrics. */
function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) em += 0.556;
    else if (ch === "." || ch === " " || ch === ":") em += ch === ":" ? 0.333 : 0.278;
    else if (ch === "f") em += 0.333;
    else em += 0.611;
  }
  return Math.ceil(em * size);
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function overlaySvg(width: number, height: number, overlay: FrameOverlay): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const parts: string[] = [];
  const fontSize = Math.max(8, Math.min(11, Math.floor(Math.min(w, h) / 42)));
  // QFontMetrics::height() for Helvetica ≈ ascent + descent ≈ 1.2 em.
  const th = Math.ceil(fontSize * 1.2);
  const chip = (text: string, x: number, y: number): void => {
    const tw = textWidth(text, fontSize);
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    parts.push(`<rect x="${ix}" y="${iy}" width="${tw + 4}" height="${th + 3}" fill="#000" fill-opacity="${(165 / 255).toFixed(3)}"/>`);
    parts.push(`<text x="${ix + 2}" y="${iy + th}" fill="#fff">${esc(text)}</text>`);
  };

  if (overlay.grid) {
    const ticks = Array.from({ length: 21 }, (_, i) => i / 20);
    const stroke = (lineWidth: number, gray: number, alpha: number, major: boolean) => {
      const color = gray === 0 ? "#000" : "#fff";
      const lines: string[] = [];
      ticks.forEach((t, i) => {
        if ((i % 10 === 0) !== major) return;
        const x = Math.trunc(Math.min(Math.max(0.5, t * w), w - 0.5));
        const y = Math.trunc(Math.min(Math.max(0.5, t * h), h - 0.5));
        lines.push(`M${x} 0V${h}`, `M0 ${y}H${w}`);
      });
      parts.push(`<path d="${lines.join("")}" stroke="${color}" stroke-opacity="${(alpha / 255).toFixed(3)}" stroke-width="${lineWidth}" fill="none"/>`);
    };
    stroke(2.0, 0, 140, false);
    stroke(1.0, 255, 190, false);
    stroke(2.5, 0, 165, true);
    stroke(1.5, 255, 240, true);
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      const label = i === 0 ? "0" : i === 10 ? "1" : t.toFixed(1);
      const tw = textWidth(label, fontSize);
      if (i !== 10) chip(label, Math.min(Math.max(0, t * w - tw / 2), w - tw - 2), 2);
      chip(label, w - tw - 6, Math.min(Math.max(2, t * h - th / 2), h - th - 4));
    }
  }
  if (overlay.caption) {
    const tw = textWidth(overlay.caption, fontSize);
    parts.push(`<rect x="0" y="0" width="${tw + 10}" height="${th + 4}" fill="#000" fill-opacity="${(165 / 255).toFixed(3)}"/>`);
    parts.push(`<text x="5" y="${th}" fill="#fff">${esc(overlay.caption)}</text>`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">` +
    `<g font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${fontSize}">${parts.join("")}</g></svg>`
  );
}

/** Source-over blend of straight RGBA `top` onto `base` (same size), in place. */
export function blendOver(base: RgbaImage, top: RgbaImage): void {
  const b = base.data;
  const t = top.data;
  for (let i = 0; i < b.length; i += 4) {
    const ta = t[i + 3]! / 255;
    if (ta === 0) continue;
    const ba = b[i + 3]! / 255;
    const oa = ta + ba * (1 - ta);
    for (let c = 0; c < 3; c += 1) {
      b[i + c] = (t[i + c]! * ta + b[i + c]! * ba * (1 - ta)) / oa;
    }
    b[i + 3] = oa * 255;
  }
}

/** Draw the overlay onto a copy of `image`. */
export async function applyOverlay(image: RgbaImage, overlay: FrameOverlay | undefined): Promise<RgbaImage> {
  if (!overlay || (!overlay.grid && !overlay.caption)) return image;
  const layer = await rasterizeSvg(overlaySvg(image.width, image.height, overlay), { width: image.width, height: image.height });
  const out: RgbaImage = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  blendOver(out, layer);
  return out;
}

/** "f120  00:04.00" (inspect_overlay.py `format_frame_caption`). */
export function frameCaption(projectFrame: number, seconds: number): string {
  const s = Math.max(0, seconds);
  let whole = Math.trunc(s);
  let cent = Math.round((s - whole) * 100);
  if (cent >= 100) {
    whole += 1;
    cent = 0;
  }
  const mm = Math.floor(whole / 60);
  const ss = whole % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return `f${Math.trunc(projectFrame)}  ${two(mm)}:${two(ss)}.${two(cent)}`;
}
