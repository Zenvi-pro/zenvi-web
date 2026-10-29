/**
 * Where every unit icon of a pictogram sits in each layout. Icons keep their
 * identity across layouts (icon i is always the same unit of the same group),
 * so a morph is each icon moving from its old slot to its new one.
 */

import type { Params } from "../../params.js";

export const LAYOUTS = ["grid", "groups", "bars", "collapse", "hold"] as const;
export type LayoutKind = (typeof LAYOUTS)[number];

/** Most icons a block draws (each is a node moved every frame). */
export const MAX_ICONS = 400;

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An icon's slot: centre and size, design px. */
export interface Slot {
  x: number;
  y: number;
  s: number;
}

export interface LayoutLabel {
  x: number;
  y: number;
  /** Which group it names (-1: the total). */
  group: number;
  /** Text centred on x; top at y. */
  kind: "name" | "count";
}

export interface Layout {
  slots: Slot[];
  labels: LayoutLabel[];
}

export interface Group {
  label: string;
  value: number;
  /** Icons drawn for it: value / unit, rounded (at least 1 for a value above 0). */
  icons: number;
}

/** Centre to centre, in icon sizes. */
const PITCH = 1.3;
const LABEL_ROOM = 120;

/** The columns and size that fit n icons largest into w × h. */
function bestGrid(n: number, w: number, h: number, pitch: number, maxSize: number): { cols: number; s: number } {
  let best = { cols: 1, s: 0 };
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const s = Math.min(w / (cols * pitch), h / (rows * pitch), maxSize);
    if (s > best.s) best = { cols, s };
  }
  return best;
}

/** n slots in rows of `cols`, centred on (cx, cy). */
function gridSlots(n: number, cols: number, s: number, pitch: number, cx: number, cy: number): Slot[] {
  const rows = Math.ceil(n / cols);
  const p = s * pitch;
  const x0 = cx - ((Math.min(n, cols) - 1) * p) / 2;
  const y0 = cy - ((rows - 1) * p) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * p, y: y0 + Math.floor(i / cols) * p, s }));
}

const starts = (groups: readonly Group[]): number[] => groups.map((_, j) => groups.slice(0, j).reduce((n, g) => n + g.icons, 0));

export function layoutIcons(kind: Exclude<LayoutKind, "hold">, groups: readonly Group[], r: Region, portrait: boolean): Layout {
  const total = groups.reduce((n, g) => n + g.icons, 0);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const maxSize = Math.min(r.w, r.h) / 5;

  if (kind === "grid" || kind === "collapse") {
    // Collapse packs every unit into one tight block.
    const tight = kind === "collapse";
    const pitch = tight ? 1.02 : PITCH;
    const room = tight ? 0.6 : 1;
    const { cols, s } = bestGrid(total, r.w * room, (r.h - LABEL_ROOM) * room, pitch, maxSize);
    const slots = gridSlots(total, cols, s, pitch, cx, cy - LABEL_ROOM / 2);
    const bottom = cy - LABEL_ROOM / 2 + (Math.ceil(total / cols) * s * pitch) / 2;
    return { slots, labels: tight ? [{ x: cx, y: bottom + 28, group: -1, kind: "count" }] : [] };
  }

  const first = starts(groups);
  const slots: Slot[] = new Array<Slot>(total);
  const labels: LayoutLabel[] = [];
  const G = groups.length;

  if (kind === "groups") {
    // Clusters side by side (stacked on vertical frames), one size for all so units compare.
    const across = !portrait;
    const cell = (j: number): Region =>
      across ? { x: r.x + (r.w * j) / G, y: r.y, w: r.w / G, h: r.h } : { x: r.x, y: r.y + (r.h * j) / G, w: r.w, h: r.h / G };
    const s = Math.min(...groups.map((g, j) => bestGrid(Math.max(1, g.icons), cell(j).w * 0.86, cell(j).h - LABEL_ROOM, PITCH, maxSize).s));
    const colsOf = (j: number): number => Math.max(1, Math.min(groups[j]!.icons, Math.floor((cell(j).w * 0.86) / (s * PITCH))));
    const rowsOf = (j: number): number => Math.ceil(groups[j]!.icons / colsOf(j));
    // Side by side, the clusters stand on one line so their labels line up.
    const tallest = Math.max(...groups.map((_, j) => rowsOf(j)));
    groups.forEach((g, j) => {
      const c = cell(j);
      const rows = rowsOf(j);
      const ccy = across ? c.y + (c.h - LABEL_ROOM) / 2 + ((tallest - rows) * s * PITCH) / 2 : c.y + (c.h - LABEL_ROOM) / 2;
      gridSlots(g.icons, colsOf(j), s, PITCH, c.x + c.w / 2, ccy).forEach((slot, m) => (slots[first[j]! + m] = slot));
      const bottom = ccy + (rows * s * PITCH) / 2;
      labels.push({ x: c.x + c.w / 2, y: bottom + 18, group: j, kind: "count" }, { x: c.x + c.w / 2, y: bottom + 70, group: j, kind: "name" });
    });
    return { slots, labels };
  }

  // Bars: each group a column of icons stacked from a shared baseline, `k` icons wide.
  const colW = r.w / G;
  const plotH = r.h - LABEL_ROOM - 70;
  const tallest = Math.max(1, ...groups.map((g) => g.icons));
  let best = { k: 1, s: 0 };
  for (let k = 1; k <= tallest; k += 1) {
    const s = Math.min((colW * 0.8) / (k * PITCH), plotH / (Math.ceil(tallest / k) * PITCH), maxSize);
    if (s > best.s) best = { k, s };
  }
  const { k, s } = best;
  const p = s * PITCH;
  const baseY = r.y + 70 + plotH;
  groups.forEach((g, j) => {
    const x0 = r.x + colW * (j + 0.5) - ((Math.min(k, Math.max(1, g.icons)) - 1) * p) / 2;
    for (let m = 0; m < g.icons; m += 1) slots[first[j]! + m] = { x: x0 + (m % k) * p, y: baseY - p / 2 - Math.floor(m / k) * p, s };
    const top = baseY - Math.ceil(g.icons / k) * p;
    labels.push({ x: r.x + colW * (j + 0.5), y: top - 58, group: j, kind: "count" }, { x: r.x + colW * (j + 0.5), y: baseY + 22, group: j, kind: "name" });
  });
  return { slots, labels };
}

export interface PictogramPlan {
  groups: Group[];
  layouts: LayoutKind[];
}

/** groups ("Label=value"), unit and layouts read and checked; the block and checkParams share it. */
export function planPictogram(params: Params): PictogramPlan | { error: string } {
  const unit = Number(params.unit ?? 1);
  const groups: Group[] = [];
  for (const entry of (params.groups as string[] | undefined) ?? []) {
    const m = /^(.*?)\s*[=:]\s*([-+]?[\d,]*\.?\d+)\s*$/.exec(entry.trim());
    if (!m) return { error: `pictogram_morph groups: "${entry}" is not "Label=number"` };
    const value = Number(m[2]!.replace(/,/g, ""));
    if (value < 0) return { error: `pictogram_morph groups: "${entry}" is negative` };
    groups.push({ label: m[1]!, value, icons: value > 0 ? Math.max(1, Math.round(value / unit)) : 0 });
  }
  const total = groups.reduce((n, g) => n + g.icons, 0);
  if (total === 0) return { error: "pictogram_morph needs at least one group with a value above 0" };
  if (total > MAX_ICONS) return { error: `pictogram_morph would draw ${total} icons (at most ${MAX_ICONS}); set unit to ${Math.ceil((total * unit) / MAX_ICONS)} or more so each icon stands for more` };
  const layouts: LayoutKind[] = [];
  for (const name of (params.layouts as string[] | undefined) ?? []) {
    const key = name.trim().toLowerCase();
    if (!(LAYOUTS as readonly string[]).includes(key)) return { error: `pictogram_morph layouts: "${name}" is not one of ${LAYOUTS.join(", ")}` };
    layouts.push(key as LayoutKind);
  }
  if (layouts[0] === "hold") return { error: "pictogram_morph layouts: hold keeps the previous layout's icons, so it cannot come first" };
  return { groups, layouts };
}

export function checkPictogram(params: Params): string | undefined {
  const plan = planPictogram(params);
  return "error" in plan ? plan.error : undefined;
}
