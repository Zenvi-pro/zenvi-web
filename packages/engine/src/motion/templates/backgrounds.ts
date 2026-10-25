/**
 * grid_background: the field a motion video plays on. One still,
 * full-frame drawing:
 *
 *   paper      grid paper (minor squares, every fourth line darker), for tutorials
 *   editorial  warm paper, a column grid, ruler ticks along the edges,
 *              registration marks in the corners and up to four corner labels
 *              (label size; on 9:16 along the safe area's top and bottom
 *              lines, clear of the platform's UI)
 *   dots       a dark field with a faint dot grid (product callouts)
 *   plain      the palette's flat background
 */

import { backdrop } from "../elements.js";
import { typeSize, type Layout } from "../layout.js";
import { registrationMark } from "../shapes.js";
import type { Drawing } from "../svg.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Palette } from "../types.js";

export const GRID_VARIANTS = ["paper", "editorial", "dots", "plain"] as const;
export type GridVariant = (typeof GRID_VARIANTS)[number];

/** Mix two #rrggbb colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, "0")).join("")}`;
}

function defaultVariant(palette: Palette): GridVariant {
  if (palette.name === "tutorial") return "paper";
  if (palette.name === "editorial") return "editorial";
  if (palette.name === "callout") return "dots";
  return "plain";
}

/** Grid lines centred on the frame: positions from 0 to `size` every `step`, one through the middle. */
function gridLines(size: number, step: number): number[] {
  const mid = size / 2;
  const out: number[] = [];
  for (let v = mid - Math.floor(mid / step) * step; v <= size; v += step) out.push(v);
  return out;
}

export function paintGrid(d: Drawing, variant: GridVariant, palette: Palette, layout: Layout, labels: readonly string[]): void {
  const { W, H, u, m } = layout;
  d.rect(0, 0, W, H, { fill: palette.background });
  if (variant === "paper") {
    // Every fourth line is darker, counted from the one through the middle.
    const step = 40 * u;
    const major = mix(palette.line, palette.ink, 0.12);
    const isMajor = (i: number, size: number) => (((i - Math.floor(size / 2 / step)) % 4) + 4) % 4 === 0;
    gridLines(W, step).forEach((x, i) => d.line(x, 0, x, H, { stroke: isMajor(i, W) ? major : palette.line, strokeWidth: (isMajor(i, W) ? 2 : 1.4) * u }));
    gridLines(H, step).forEach((y, i) => d.line(0, y, W, y, { stroke: isMajor(i, H) ? major : palette.line, strokeWidth: (isMajor(i, H) ? 2 : 1.4) * u }));
  } else if (variant === "editorial") {
    // Columns inside the margins (12 across a landscape frame, 6 across a portrait one), rows, ruler ticks on the edges.
    const cols = layout.portrait ? 6 : 12;
    const colW = (W - 2 * m) / cols;
    for (let i = 0; i <= cols; i += 1) d.line(m + i * colW, 0, m + i * colW, H, { stroke: palette.line, strokeWidth: 1.2 * u });
    const rowH = colW * (layout.portrait ? 1 : 2);
    for (let y = m; y <= H - m + 0.5; y += rowH) d.line(0, y, W, y, { stroke: palette.line, strokeWidth: 1.2 * u });
    const tick = 10 * u;
    for (let x = m; x <= W - m + 0.5; x += colW / 2) {
      d.line(x, 0, x, tick, { stroke: palette.ink, strokeWidth: 1.4 * u });
      d.line(x, H - tick, x, H, { stroke: palette.ink, strokeWidth: 1.4 * u });
    }
    for (let y = m; y <= H - m + 0.5; y += colW / 2) {
      d.line(0, y, tick, y, { stroke: palette.ink, strokeWidth: 1.4 * u });
      d.line(W - tick, y, W, y, { stroke: palette.ink, strokeWidth: 1.4 * u });
    }
    const r = 13 * u;
    const inset = m * 0.62;
    for (const [x, y] of [
      [inset, inset],
      [W - inset, inset],
      [inset, H - inset],
      [W - inset, H - inset],
    ] as const) {
      registrationMark(d, x, y, r, palette.ink, 1.6 * u);
    }
    const size = typeSize(layout, "label", 17 * u);
    const { safe, tall } = layout;
    const right = Math.min(W - m - colW * 0.12, safe.right);
    const [topY, bottomY] = tall ? [safe.top + size * 0.95, safe.bottom - size * 0.35] : [m - 16 * u, H - m + 30 * u];
    const corners: [number, number, "start" | "end"][] = [
      [m + colW * 0.12, topY, "start"],
      [right, topY, "end"],
      [m + colW * 0.12, bottomY, "start"],
      [right, bottomY, "end"],
    ];
    labels.slice(0, 4).forEach((label, i) => {
      const [x, y, anchor] = corners[i]!;
      d.text(x, y, label.toUpperCase(), { size, font: "mono", fill: palette.ink, anchor, tracking: 0.08 });
    });
  } else if (variant === "dots") {
    const step = 48 * u;
    for (const x of gridLines(W, step)) for (const y of gridLines(H, step)) d.circle(x, y, 1.7 * u, { fill: palette.ink, fillOpacity: 0.09 });
  }
}

export const gridBackground: TemplateSpec = {
  id: "grid_background",
  summary: "A still, full-frame field: grid paper (paper), an editorial sheet with column grid, ruler ticks, registration marks and corner labels (editorial), a dark dot grid (dots) or a flat colour (plain).",
  reads: "variant (paper | editorial | dots | plain, default from the palette), labels (editorial: up to 4 corner labels)",
  media: "none",
  beats: () => 8,
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames } = input;
    const variant = (content.variant ?? defaultVariant(palette)) as GridVariant;
    if (!(GRID_VARIANTS as readonly string[]).includes(variant)) refuse(`grid_background variant must be one of ${GRID_VARIANTS.join(", ")} (got ${content.variant})`);
    const labels = content.labels ?? [];
    if (labels.length > 4) refuse("grid_background takes at most 4 corner labels");
    return { elements: [backdrop("grid", 0, 0, frames, layout, (d) => paintGrid(d, variant, palette, layout, labels))], cues: [0] };
  },
};
