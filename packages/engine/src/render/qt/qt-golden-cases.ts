/**
 * Cases for the Qt 5.15 golden outputs in `qt-goldens.json`, produced by the
 * oracle in `packages/engine/scripts/qt-oracle/` (real QPainter/QImage calls,
 * the same ones libopenshot makes) and checked by `qt-parity.test.ts`.
 */

export type GoldenCase =
  | { kind: "smooth"; name: string; w: number; h: number; dw: number; dh: number; seed: number; alpha: "opaque" | "mixed" }
  | { kind: "fast"; name: string; w: number; h: number; dw: number; dh: number; seed: number }
  | {
      kind: "rect";
      name: string;
      canvas: [number, number, number];
      image: [number, number, number];
      target: [number, number, number, number];
      source: [number, number, number, number];
    }
  | {
      kind: "clip";
      name: string;
      w: number;
      h: number;
      cw: number;
      ch: number;
      /** Clip::get_transform locals: x, y, r, shear x/y, origin fractions, Sw, Sh. */
      x: number;
      y: number;
      r: number;
      shx: number;
      shy: number;
      ofx: number;
      ofy: number;
      sw: number;
      sh: number;
      alpha: number;
      corner: number;
      image: "noise" | "gradient" | "mixed";
      seed: number;
    }
  | { kind: "compose"; name: string; mode: number; w: number; h: number; seed: number };

const clip = (
  name: string,
  w: number,
  h: number,
  cw: number,
  ch: number,
  x: number,
  y: number,
  r: number,
  shx: number,
  shy: number,
  sw: number,
  sh: number,
  alpha: number,
  corner: number,
  image: "noise" | "gradient" | "mixed",
): GoldenCase => ({ kind: "clip", name, w, h, cw, ch, x, y, r, shx, shy, ofx: 0.5, ofy: 0.5, sw, sh, alpha, corner, image, seed: w * 31 + h });

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { kind: "smooth", name: "up-xy", w: 7, h: 5, dw: 16, dh: 11, seed: 1, alpha: "mixed" },
  { kind: "smooth", name: "down-xy", w: 23, h: 17, dw: 7, dh: 5, seed: 2, alpha: "mixed" },
  { kind: "smooth", name: "up-x-down-y", w: 9, h: 20, dw: 14, dh: 6, seed: 3, alpha: "mixed" },
  { kind: "smooth", name: "down-x-up-y", w: 20, h: 9, dw: 6, dh: 14, seed: 4, alpha: "opaque" },
  { kind: "fast", name: "line-double", w: 12, h: 4, dw: 12, dh: 9, seed: 5 },
  { kind: "fast", name: "shrink", w: 17, h: 11, dw: 5, dh: 7, seed: 6 },
  { kind: "rect", name: "fractional", canvas: [20, 12, 7], image: [16, 10, 8], target: [2.6, 1, 9.3, 7], source: [3.2, 1.5, 9.3, 7] },
  { kind: "rect", name: "stretch", canvas: [20, 12, 9], image: [8, 5, 10], target: [1, 1, 17, 9], source: [0, 0, 8, 5] },
  clip("identity", 24, 16, 24, 16, 0, 0, 0, 0, 0, 1, 1, 1, 0, "mixed"),
  clip("translate-frac", 16, 12, 28, 20, 5.5, 3.25, 0, 0, 0, 1, 1, 1, 0, "mixed"),
  clip("fit-down", 40, 24, 20, 12, 0, 0, 0, 0, 0, 0.5, 0.5, 1, 0, "gradient"),
  clip("scale-frac", 14, 10, 32, 24, 3.3, 2.7, 0, 0, 0, 1.73, 1.41, 1, 0, "noise"),
  clip("rotate-30", 20, 12, 32, 28, 6, 8, 30, 0, 0, 1, 1, 1, 0, "noise"),
  clip("rotate-scale-nonuniform", 20, 14, 32, 28, 5, 6, 12, 0, 0, 1.2, 0.7, 1, 0, "gradient"),
  clip("shear", 16, 12, 32, 24, 7, 5, 0, 0.35, 0.1, 1, 1, 1, 0, "noise"),
  clip("opacity-scaled", 16, 10, 28, 18, 2, 2, 0, 0, 0, 1.5, 1.5, 0.3, 0, "mixed"),
  clip("opacity-identity", 16, 10, 16, 10, 0, 0, 0, 0, 0, 1, 1, 0.55, 0, "mixed"),
  // Corner radius: antialiased rounded-rect clip path plus antialiased image edges.
  clip("corner-identity", 24, 16, 24, 16, 0, 0, 0, 0, 0, 1, 1, 1, 0.2, "mixed"),
  clip("corner-translate", 16, 12, 28, 20, 5.5, 3.25, 0, 0, 0, 1, 1, 1, 0.25, "mixed"),
  clip("corner-scale", 14, 10, 32, 24, 3.3, 2.7, 0, 0, 0, 1.73, 1.41, 1, 0.3, "noise"),
  clip("corner-fit-down", 40, 24, 20, 12, 0, 0, 0, 0, 0, 0.5, 0.5, 1, 0.5, "gradient"),
  clip("corner-rotate", 20, 12, 32, 28, 6, 8, 30, 0, 0, 1, 1, 1, 0.15, "noise"),
  clip("corner-rotate-scale", 20, 14, 32, 28, 5, 6, 12, 0, 0, 1.2, 0.7, 1, 0.45, "gradient"),
  clip("corner-shear", 16, 12, 32, 24, 7, 5, 0, 0.35, 0.1, 1, 1, 1, 0.2, "noise"),
  clip("corner-opacity", 16, 10, 28, 18, 2, 2, 0, 0, 0, 1.5, 1.5, 0.3, 0.1, "mixed"),
  clip("corner-large-rotate", 120, 80, 200, 160, 40, 30, 17, 0, 0, 1.1, 1.1, 1, 0.12, "noise"),
  clip("corner-large-shear", 96, 64, 180, 140, 30, 20, 8, 0.2, 0, 1.3, 1.2, 0.8, 0.3, "mixed"),
  ...Array.from({ length: 24 }, (_, mode): GoldenCase => ({ kind: "compose", name: `mode-${mode}`, mode, w: 8, h: 8, seed: 100 + mode })),
];
