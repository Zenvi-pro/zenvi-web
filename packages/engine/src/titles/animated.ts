/**
 * Animated titles as the engine renders them on every surface: the desktop's
 * Title > Animated Title templates (zenvi-core src/blender/*.xml, rendered
 * there in 3D by Blender) remade as 2D titles: an SVG title (or a transparent
 * overlay with an effect) animated with clip keyframes (scale, position,
 * rotation, opacity) and engine effects (Glow, Blur, LensFlare). Every
 * renderer draws them the same way (browser canvas, Node/resvg in the CLI and
 * the cloud), with no Blender.
 *
 * Template names, parameters, defaults and lengths are the desktop's
 * (animated-templates.data.ts). What a 2D version keeps of each template is in
 * `WEB_LOOKS`; depth (extrude, bevel, specular light), particles and 3D
 * camera moves are approximated or dropped. Four templates are 3D scenes with
 * no 2D equivalent (a globe, particles, snow, picture frames) and stay
 * desktop-only.
 */

import type { Effect, Keyframe } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { defaultEffectJson } from "../effects/registry.js";
import { makeKeyframePoint } from "../keyframe/edit.js";
import { pyRound } from "../model/rounding.js";
import { ANIMATED_TITLE_DATA, type AnimatedTitleData, type AnimatedTitleParamData } from "./animated-templates.data.js";
import { estimatedTextWidth } from "./title-svg.js";

export type { AnimatedTitleData, AnimatedTitleParamData };

/** Every template is authored at 25 fps (blender_titles.TITLE_FPS). */
export const TITLE_FPS = 25;

/** Parameters the dialog does not show (titles_text_animated.HIDDEN). */
export const HIDDEN_PARAMS: ReadonlySet<string> = new Set(["start_frame", "end_frame", "file_name", "length_multiplier"]);

/** A parameter value as blender_titles `default_params` / the tool hold it. */
export type ParamValue = string | number | number[];
export type ParamValues = Record<string, ParamValue>;

export const ANIMATED_TITLES: readonly AnimatedTitleData[] = ANIMATED_TITLE_DATA;

/** `end_frame`'s default: the template's length in frames at 25 fps. */
export function templateFrames(template: AnimatedTitleData): number {
  const end = template.params.find((p) => p.name === "end_frame");
  return Math.trunc(Number(end?.default || 0)) || 0;
}

/** `project_fps_diff`: Blender remaps frames by whole multiples only: round(project fps / 25). */
export function projectFpsDiff(fps: { num: number; den: number }): number {
  return pyRound(fps.num / (fps.den || 1) / TITLE_FPS);
}

/** `color_value`: '#RRGGBB[AA]' → [r, g, b] in 0..1, plus alpha for `diffuse_color` parameters. */
export function colorValue(hex: string, name: string): number[] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const channel = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16) / 255;
  const value = [channel(0), channel(2), channel(4)];
  if (name.includes("diffuse_color")) value.push(h.length === 8 ? channel(6) : 1);
  return value;
}

/** `default_params`: the values the dialog holds right after a template is selected. */
export function defaultParams(template: AnimatedTitleData, fpsDiff = 1): ParamValues {
  const params: ParamValues = {};
  for (const p of template.params) {
    const def = p.default ?? "";
    if (p.name === "start_frame" || p.name === "end_frame") params[p.name] = Math.trunc(Number(def));
    else if (p.type === "spinner") params[p.name] = Number(def);
    else if (p.type === "text" || p.type === "multiline") params[p.name] = def;
    else if (p.type === "dropdown") {
      const values = Object.values(p.values);
      const sorted = Object.entries(p.values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const value = values.includes(def) ? def : (sorted[0]?.[1] ?? "");
      params[p.name] = p.name === "length_multiplier" ? Number(value || 1) * fpsDiff : value;
    } else if (p.type === "color") params[p.name] = colorValue(def || "#ffffff", p.name);
  }
  return params;
}

// ---------------------------------------------------------------------------
// What each template becomes in 2D
// ---------------------------------------------------------------------------

/** How the web version of each template looks (shown by list_title_templates_tool kind=animated). */
export const WEB_LOOKS: Readonly<Record<string, string>> = {
  blinds: "title and subtitle on horizontal bands that open and close like blinds",
  colors: "three colour tiles one after another, each with its title",
  dissolve: "the title fades in, holds, then blurs, drifts and fades away",
  explode: "the title holds, then bursts outward (scale, blur, fade)",
  fly_by_1: "the title flies toward the camera from far away and past it",
  fly_by_two_titles: "title and subtitle fly in from far away, hold, then fly past the camera",
  glare: "the title with a pulsing glow",
  glass_slider: "a translucent glass bar with the title slides in from the left, holds and slides out",
  lens_flare: "a lens flare that moves across the frame (no text)",
  neon_curves: "a glowing neon title over four coloured curves",
  rotate_360: "the title spins once around its vertical axis",
  slide_left_to_right: "the title slides in from the left, holds, and leaves to the right",
  spacemovie_intro: "the opening crawl: the 'long time ago' line, the logo shrinking away, then the text scrolling up (flat, no perspective)",
  wireframe_text: "outlined (wireframe) title that slowly pushes in",
  zoom_clapboard: "a clapboard with the title, zooming in",
};

/** Templates that are 3D scenes with no 2D version: Zenvi desktop renders them with Blender. */
export const DESKTOP_ONLY_TITLES: Readonly<Record<string, string>> = {
  earth: "a flight path on a 3D globe",
  magic_wand: "a particle trail",
  picture_frames_4: "four pictures in 3D frames",
  snow: "falling snow particles",
};

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

type Point = readonly [t: number, value: number, interpolation?: Interpolation];

/** A keyframe over a clip of `frames` frames from normalized times (0..1). The interpolation of a point shapes the segment that ends there. */
export function curve(points: readonly Point[], frames: number): Keyframe {
  const last = Math.max(1, frames);
  const byFrame = new Map<number, [number, Interpolation]>();
  for (const [t, value, interp] of points) {
    const x = 1 + Math.round(Math.max(0, Math.min(1, t)) * (last - 1));
    byFrame.set(x, [value, interp ?? Interpolation.BEZIER]);
  }
  return {
    Points: [...byFrame.entries()].sort((a, b) => a[0] - b[0]).map(([x, [y, interp]]) => makeKeyframePoint(x, y, interp)),
  };
}

const LINEAR = Interpolation.LINEAR;

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n * 255)))
    .toString(16)
    .padStart(2, "0");
}

/** [r, g, b(, a)] in 0..1 → ["#rrggbb", opacity]. */
function paint(value: ParamValue | undefined, fallback: string): [string, number] {
  if (!Array.isArray(value) || value.length < 3) return [fallback, 1];
  return [`#${hex2(value[0]!)}${hex2(value[1]!)}${hex2(value[2]!)}`, value.length > 3 ? Math.max(0, Math.min(1, value[3]!)) : 1];
}

/** A colour darkened toward black (the shaded side of extruded text). */
function shade(hex: string, factor: number): string {
  const c = (i: number): string =>
    Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * factor)
      .toString(16)
      .padStart(2, "0");
  return `#${c(1)}${c(3)}${c(5)}`;
}

function num(value: ParamValue | undefined, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: ParamValue | undefined): string {
  return typeof value === "string" ? value : value === undefined ? "" : String(value);
}

interface FontSpec {
  family: string;
  weight: "normal" | "bold";
  style: "normal" | "italic";
}

/** Blender font choices → SVG font families (Bfont is Blender's built-in sans). */
function fontSpec(name: string, bold = true): FontSpec {
  const mono = "'FreeMono', 'Liberation Mono', 'Courier New', monospace";
  const sans = "'FreeSans', 'Liberation Sans', Arial, sans-serif";
  switch (name) {
    case "FreeMono":
      return { family: mono, weight: "normal", style: "normal" };
    case "FreeMonoBold":
      return { family: mono, weight: "bold", style: "normal" };
    case "FreeSans":
      return { family: sans, weight: "normal", style: "normal" };
    case "FreeSansBold":
      return { family: sans, weight: "bold", style: "normal" };
    case "FreeSansBoldOblique":
      return { family: sans, weight: "bold", style: "italic" };
    case "WenQuanYiMicroHei":
      return { family: "'WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'PingFang SC', sans-serif", weight: bold ? "bold" : "normal", style: "normal" };
    default:
      return { family: "'DejaVu Sans', 'Liberation Sans', Arial, sans-serif", weight: bold ? "bold" : "normal", style: "normal" };
  }
}

interface TextOptions {
  /** Centre of the block (anchor middle), or its left / right edge for start / end. */
  x: number;
  y: number;
  size: number;
  fill: string;
  opacity?: number;
  font: FontSpec;
  anchor?: "start" | "middle" | "end";
  letterSpacing?: number;
  lineHeight?: number;
  stroke?: string;
  strokeWidth?: number;
  /** Draw a darker copy behind, offset by this many px (2D stand-in for extruded depth). */
  depth?: number;
}

/** A multi-line SVG text block, vertically centred on `y`. */
function textBlock(lines: readonly string[], o: TextOptions): string {
  const lh = (o.lineHeight ?? 1.2) * o.size;
  const first = o.y - ((lines.length - 1) * lh) / 2 + 0.35 * o.size;
  const attrs = (fill: string, dx: number, dy: number): string =>
    [
      `x="${(o.x + dx).toFixed(1)}"`,
      `y="${(first + dy).toFixed(1)}"`,
      `font-family="${o.font.family}"`,
      `font-size="${o.size.toFixed(1)}"`,
      `font-weight="${o.font.weight}"`,
      `font-style="${o.font.style}"`,
      `text-anchor="${o.anchor ?? "middle"}"`,
      o.letterSpacing ? `letter-spacing="${o.letterSpacing.toFixed(2)}"` : "",
      fill === "none" ? 'fill="none"' : `fill="${fill}"`,
      o.opacity !== undefined && o.opacity < 1 ? `fill-opacity="${o.opacity.toFixed(3)}"` : "",
      o.stroke ? `stroke="${o.stroke}" stroke-width="${(o.strokeWidth ?? 2).toFixed(1)}" stroke-linejoin="round"` : "",
    ]
      .filter(Boolean)
      .join(" ");
  const tspans = (dx: number): string =>
    lines.map((line, i) => `<tspan x="${(o.x + dx).toFixed(1)}" dy="${i === 0 ? 0 : lh.toFixed(1)}">${escape(line)}</tspan>`).join("");
  const depth = o.depth ?? 0;
  const back = depth > 0.5 && o.fill !== "none" ? `<text ${attrs(shade(o.fill, 0.45), depth, depth)}>${tspans(depth)}</text>` : "";
  return `${back}<text ${attrs(o.fill, 0, 0)}>${tspans(0)}</text>`;
}

function svgDoc(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;
}

function lines(text: string): string[] {
  const out = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim());
  while (out.length > 1 && !out[out.length - 1]) out.pop();
  return out.length > 0 ? out : [""];
}

/** Greedy word wrap to `width` px with the title tools' width estimate. */
function wrap(text: string, size: number, width: number, bold: boolean): string[] {
  const out: string[] = [];
  for (const para of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && estimatedTextWidth(next, size, bold) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Common text placement from the spacemode / text_size / width parameters. */
function placement(v: ParamValues, width: number, height: number, sizeFactor = 0.12): { x: number; anchor: "start" | "middle" | "end"; size: number; spacing: number } {
  const size = sizeFactor * height * Math.max(0.05, num(v.text_size, 1));
  const spacing = (num(v.width, 1) - 1) * 0.25 * size;
  const mode = str(v.spacemode);
  if (mode === "LEFT") return { x: width * 0.08, anchor: "start", size, spacing };
  if (mode === "RIGHT") return { x: width * 0.92, anchor: "end", size, spacing };
  return { x: width / 2, anchor: "middle", size, spacing };
}

function effect(className: string, overrides: Record<string, unknown>): Omit<Effect, "id"> {
  const { id: _id, ...json } = defaultEffectJson(className, "TEMPLATE00");
  return { ...json, ...overrides } as Omit<Effect, "id">;
}

function constant(value: number): Keyframe {
  return { Points: [makeKeyframePoint(1, value, Interpolation.BEZIER)] };
}

function colorKeyframe(hex: string, alpha = 1): Record<string, Keyframe> {
  const c = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16);
  return { red: constant(c(1)), green: constant(c(3)), blue: constant(c(5)), alpha: constant(Math.round(alpha * 255)) };
}

function fadeInOut(frames: number, fadeIn = 0.08, fadeOut = 0.08): Keyframe {
  return curve(
    [
      [0, 0],
      [fadeIn, 1],
      [1 - fadeOut, 1, LINEAR],
      [1, 0],
    ],
    frames,
  );
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** One clip of an animated title. */
export interface AnimatedSegment {
  /** Where the clip starts and ends, as fractions of the whole animation. */
  from: number;
  to: number;
  /** The title SVG for this clip, or null for an effect on the transparent overlay. */
  svg: string | null;
  /** Clip properties (keyframes in the clip's own frames). */
  props: Record<string, unknown>;
  /** Effects on the clip, without ids. */
  effects: Omit<Effect, "id">[];
}

interface RecipeInput {
  v: ParamValues;
  width: number;
  height: number;
  /** Frames of a segment from `from` to `to`. */
  framesOf(from: number, to: number): number;
}

type Recipe = (input: RecipeInput) => AnimatedSegment[];

function single(input: RecipeInput, svg: string | null, props: (frames: number) => Record<string, unknown>, effects: (frames: number) => Omit<Effect, "id">[] = () => []): AnimatedSegment[] {
  const frames = input.framesOf(0, 1);
  return [{ from: 0, to: 1, svg, props: props(frames), effects: effects(frames) }];
}

/** The usual extruded title: text (and an optional second line) in the diffuse colour with a darker depth copy. */
function solidTitle(input: RecipeInput, textLines: string[], opts: { sub?: string; sizeFactor?: number; bold?: boolean } = {}): string {
  const { v, width, height } = input;
  const p = placement(v, width, height, opts.sizeFactor);
  const [fill, opacity] = paint(v.diffuse_color, "#7f7f7f");
  const font = fontSpec(str(v.fontname), opts.bold ?? true);
  const depth = Math.min(0.08, Math.max(0, num(v.extrude, 0.1))) * p.size * 0.6;
  let body: string;
  if (opts.sub) {
    const subSize = p.size * 0.55;
    const gap = p.size * 0.35;
    const titleH = textLines.length * p.size * 1.2;
    const total = titleH + gap + subSize * 1.2;
    const top = height / 2 - total / 2;
    body =
      textBlock(textLines, { x: p.x, y: top + titleH / 2, size: p.size, fill, opacity, font, anchor: p.anchor, letterSpacing: p.spacing, depth }) +
      textBlock([opts.sub], { x: p.x, y: top + titleH + gap + (subSize * 1.2) / 2, size: subSize, fill, opacity, font, anchor: p.anchor, letterSpacing: p.spacing * 0.55, depth: depth * 0.55 });
  } else {
    body = textBlock(textLines, { x: p.x, y: height / 2, size: p.size, fill, opacity, font, anchor: p.anchor, letterSpacing: p.spacing, depth });
  }
  return svgDoc(width, height, body);
}

const RECIPES: Readonly<Record<string, Recipe>> = {
  fly_by_1: (input) =>
    single(input, solidTitle(input, lines(str(input.v.title))), (n) => {
      const scale = curve([[0, 0.04], [0.45, 0.8, LINEAR], [0.7, 1, LINEAR], [1, 2, LINEAR]], n);
      return { scale_x: scale, scale_y: scale, alpha: fadeInOut(n, 0.08, 0.15) };
    }),

  fly_by_two_titles: (input) =>
    single(input, solidTitle(input, lines(str(input.v.title)), { sub: str(input.v.sub_title) }), (n) => {
      const scale = curve([[0, 0.04], [0.3, 1], [0.75, 1, LINEAR], [1, 2, LINEAR]], n);
      return { scale_x: scale, scale_y: scale, alpha: fadeInOut(n, 0.06, 0.15) };
    }),

  rotate_360: (input) =>
    single(input, solidTitle(input, lines(str(input.v.title))), (n) => {
      // A turn around the vertical axis seen head-on: the width follows cos(angle).
      const turn: Point[] = Array.from({ length: 17 }, (_, i) => [0.1 + (0.8 * i) / 16, Math.round(Math.cos((2 * Math.PI * i) / 16) * 1000) / 1000, LINEAR] as const);
      return { scale_x: curve([[0, 1], ...turn, [1, 1, LINEAR]], n), alpha: fadeInOut(n, 0.06, 0.06) };
    }),

  slide_left_to_right: (input) =>
    single(input, solidTitle(input, lines(str(input.v.title))), (n) => ({
      location_x: curve([[0, -1], [0.25, 0], [0.75, 0, LINEAR], [1, 1]], n),
    })),

  dissolve: (input) =>
    single(
      input,
      solidTitle(input, lines(str(input.v.title))),
      (n) => {
        const drift = 0.02 + Math.min(15, num(input.v.wind_field_strength, 0.5)) * 0.01;
        return {
          alpha: curve([[0, 0], [0.12, 1], [0.5, 1, LINEAR], [1, 0, LINEAR]], n),
          scale_x: curve([[0, 1], [0.5, 1, LINEAR], [1, 1.12, LINEAR]], n),
          scale_y: curve([[0, 1], [0.5, 1, LINEAR], [1, 1.12, LINEAR]], n),
          location_x: curve([[0, 0], [0.5, 0, LINEAR], [1, drift, LINEAR]], n),
          location_y: curve([[0, 0], [0.5, 0, LINEAR], [1, -drift, LINEAR]], n),
        };
      },
      (n) => {
        const radius = curve([[0, 0], [0.5, 0, LINEAR], [1, 12 + Math.min(30, num(input.v.turbulence_field_strength, 10)), LINEAR]], n);
        return [effect("Blur", { horizontal_radius: radius, vertical_radius: radius })];
      },
    ),

  explode: (input) =>
    single(
      input,
      solidTitle(input, lines(str(input.v.title))),
      (n) => {
        const scale = curve([[0, 1], [0.55, 1, LINEAR], [0.8, 1.8, LINEAR], [1, 1.8, LINEAR]], n);
        return { scale_x: scale, scale_y: scale, alpha: curve([[0, 0], [0.1, 1], [0.55, 1, LINEAR], [0.8, 0, LINEAR], [1, 0, LINEAR]], n) };
      },
      (n) => {
        const radius = curve([[0, 0], [0.55, 0, LINEAR], [0.8, 30, LINEAR]], n);
        return [effect("Blur", { horizontal_radius: radius, vertical_radius: radius })];
      },
    ),

  glare: (input) => {
    const { v, width, height } = input;
    const opaque = str(v.use_alpha) === "No";
    const svg = solidTitle(input, lines(str(v.title)));
    const withBg = opaque ? svg.replace(/(<svg[^>]*>)/, `$1<rect width="${width}" height="${height}" fill="#000000"/>`) : svg;
    const [fill] = paint(v.diffuse_color, "#ffffff");
    return single(
      input,
      withBg,
      (n) => ({ alpha: fadeInOut(n, 0.1, 0.1) }),
      (n) => [
        effect("Glow", {
          color: colorKeyframe(fill),
          blur_radius: constant(30),
          spread: constant(0.3),
          opacity: curve([[0, 0], [0.25, 0.9], [0.5, 0.5], [0.75, 0.9], [1, 0.4]], n),
        }),
      ],
    );
  },

  neon_curves: (input) => {
    const { v, width, height } = input;
    const p = placement(v, width, height);
    const [fill] = paint(v.diffuse_color, "#ffab00");
    const strength = Math.max(0, Math.min(1, num(v.strength, 1)));
    const curves = [v.line1_diffuse_color, v.line2_diffuse_color, v.line3_diffuse_color, v.line4_diffuse_color]
      .map((c, i) => {
        const [stroke] = paint(c, "#67bcff");
        const y = height * (0.3 + i * 0.13);
        const amp = height * (0.12 + 0.03 * i) * (i % 2 === 0 ? 1 : -1);
        return `<path d="M${-0.05 * width},${y.toFixed(1)} C${(0.3 * width).toFixed(1)},${(y - amp).toFixed(1)} ${(0.7 * width).toFixed(1)},${(y + amp).toFixed(1)} ${(1.05 * width).toFixed(1)},${(y - amp / 3).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${(height * 0.006).toFixed(1)}" stroke-linecap="round" opacity="0.85"/>`;
      })
      .join("");
    const text = textBlock(lines(str(v.title)), { x: p.x, y: height / 2, size: p.size, fill, font: fontSpec(str(v.fontname)), anchor: p.anchor, letterSpacing: p.spacing, stroke: "#ffffff", strokeWidth: Math.max(1, p.size * 0.02) });
    return single(
      input,
      svgDoc(width, height, curves + text),
      (n) => ({ alpha: fadeInOut(n, 0.12, 0.1) }),
      (n) => [
        effect("Glow", {
          color: colorKeyframe(fill),
          blur_radius: constant(25),
          spread: constant(0.25),
          opacity: curve([[0, 0.5 * strength], [0.5, 0.85 * strength], [1, 0.6 * strength]], n),
        }),
      ],
    );
  },

  wireframe_text: (input) => {
    const { v, width, height } = input;
    const p = placement(v, width, height);
    const [stroke] = paint(v.diffuse_color, "#0074e7");
    const [glint] = paint(v.specular_color, "#00bdff");
    const strokeWidth = Math.max(1, Math.min(12, num(v.thickness, 0.01) * 300 * (height / 1080)));
    const text = textBlock(lines(str(v.title)), { x: p.x, y: height / 2, size: p.size, fill: glint, opacity: 0.15, font: fontSpec(str(v.fontname)), anchor: p.anchor, letterSpacing: p.spacing, stroke, strokeWidth });
    return single(input, svgDoc(width, height, text), (n) => {
      const scale = curve([[0, 0.85], [1, 1.05, LINEAR]], n);
      return { scale_x: scale, scale_y: scale, rotation: curve([[0, -3], [1, 3, LINEAR]], n), alpha: fadeInOut(n, 0.1, 0.1) };
    });
  },

  zoom_clapboard: (input) => {
    const { v, width, height } = input;
    const p = placement(v, width, height, 0.09);
    const [fill] = paint(v.diffuse_color, "#ffffff");
    const bw = width * 0.42;
    const bh = height * 0.42;
    const bx = (width - bw) / 2;
    const by = height * 0.36;
    const barH = bh * 0.12;
    /** A clapper bar: black with white diagonal stripes, its top left at (x, y). */
    const striped = (x: number, y: number): string =>
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}" fill="#111111"/>` +
      Array.from({ length: 8 }, (_, i) => {
        const sx = x + (i * bw) / 8;
        const pts = [
          [sx + barH * 0.5, y],
          [sx + bw / 16 + barH * 0.5, y],
          [sx + bw / 16, y + barH],
          [sx, y + barH],
        ];
        return `<polygon points="${pts.map(([a, b]) => `${a!.toFixed(1)},${b!.toFixed(1)}`).join(" ")}" fill="#f2f2f2"/>`;
      }).join("");
    const clapperY = by - barH * 1.1;
    const clapper = `<g transform="rotate(-10 ${bx.toFixed(1)} ${(clapperY + barH).toFixed(1)})">${striped(bx, clapperY)}</g>`;
    const board = `<rect x="${bx.toFixed(1)}" y="${(by + barH).toFixed(1)}" width="${bw.toFixed(1)}" height="${(bh - barH).toFixed(1)}" rx="${(bh * 0.03).toFixed(1)}" fill="#2a2a2a" stroke="#555555" stroke-width="${(height * 0.003).toFixed(1)}"/>`;
    const text = textBlock([str(v.title)], { x: width / 2, y: by + barH + (bh - barH) / 2, size: p.size, fill, font: fontSpec(str(v.fontname)), letterSpacing: p.spacing, depth: p.size * 0.04 });
    const bg = str(v.use_alpha) === "No" ? `<rect width="${width}" height="${height}" fill="#000000"/>` : "";
    return single(input, svgDoc(width, height, bg + board + striped(bx, by) + clapper + text), (n) => {
      const scale = curve([[0, 2], [0.35, 1], [1, 1, LINEAR]], n);
      return { scale_x: scale, scale_y: scale, alpha: fadeInOut(n, 0.08, 0.08) };
    });
  },

  blinds: (input) => {
    const { v, width, height } = input;
    const [fill, opacity] = paint(v.diffuse_color, "#270f00");
    // Slats in two tints of the title colour, opaque like the template's blinds.
    const tint = (white: number): string =>
      `#${[1, 3, 5].map((i) => Math.round(Number.parseInt(fill.slice(i, i + 2), 16) * (1 - white) + 255 * white).toString(16).padStart(2, "0")).join("")}`;
    const bands =
      `<rect width="${width}" height="${height}" fill="${tint(0.48)}"/>` +
      Array.from({ length: 4 }, (_, i) => `<rect x="0" y="${((2 * i * height) / 8).toFixed(1)}" width="${width}" height="${(height / 8).toFixed(1)}" fill="${tint(0.55)}"/>`).join("");
    const p = placement(v, width, height);
    const font = fontSpec(str(v.fontname));
    const title = textBlock([str(v.title)], { x: p.x, y: height * 0.47, size: p.size, fill, opacity, font, anchor: p.anchor, letterSpacing: p.spacing });
    const sub = textBlock([str(v.sub_title)], { x: p.x, y: height * 0.47 + p.size * 1.15, size: p.size * 0.6, fill, opacity, font, anchor: p.anchor, letterSpacing: p.spacing * 0.6 });
    return single(input, svgDoc(width, height, bands + title + sub), (n) => ({
      scale_y: curve([[0, 0], [0.12, 1], [0.88, 1, LINEAR], [1, 0]], n),
    }));
  },

  colors: (input) => {
    const { v, width, height } = input;
    const [fill, opacity] = paint(v.diffuse_color, "#ffffff");
    const p = placement(v, width, height);
    const font = fontSpec(str(v.fontname));
    const tiles: [ParamValue | undefined, string][] = [
      [v.diffuse_color_t1, str(v.title1)],
      [v.diffuse_color_t2, str(v.title2)],
      [v.diffuse_color_t3, str(v.title3)],
    ];
    return tiles.map(([tile, title], i) => {
      const [color] = paint(tile, "#008be7");
      const svg = svgDoc(
        width,
        height,
        `<rect width="${width}" height="${height}" fill="${color}"/>` + textBlock(lines(title), { x: p.x, y: height / 2, size: p.size, fill, opacity, font, anchor: p.anchor, letterSpacing: p.spacing }),
      );
      const from = i / 3;
      const to = (i + 1) / 3;
      const n = input.framesOf(from, to);
      const scale = curve([[0, 1.08], [0.15, 1], [1, 1, LINEAR]], n);
      return { from, to, svg, props: { scale_x: scale, scale_y: scale, alpha: fadeInOut(n, 0.1, 0.1) }, effects: [] };
    });
  },

  glass_slider: (input) => {
    const { v, width, height } = input;
    const [fill, opacity] = paint(v.diffuse_color, "#ffffff");
    const [glass] = paint(v.diffuse_color_bg, "#dfdce7");
    const alpha = Math.max(0, Math.min(1, num(v.alpha_bg, 0.733)));
    const size = 0.07 * height * Math.max(0.05, num(v.text_size, 1));
    const bar = `<ellipse cx="${(width * 0.4).toFixed(1)}" cy="${(height * 0.9).toFixed(1)}" rx="${(width * 0.46).toFixed(1)}" ry="${(height * 0.13).toFixed(1)}" fill="${glass}" fill-opacity="${alpha.toFixed(3)}"/>`;
    const text = textBlock(lines(str(v.title1)), { x: width * 0.03, y: height * 0.9, size, fill, opacity, font: fontSpec(str(v.fontname)), anchor: "start", letterSpacing: (num(v.width, 1) - 1) * 0.25 * size });
    return single(input, svgDoc(width, height, bar + text), (n) => ({
      location_x: curve([[0, -1], [0.2, 0], [0.8, 0, LINEAR], [1, -1]], n),
    }));
  },

  lens_flare: (input) => {
    const { v } = input;
    // Blender world units (camera at the origin looking along +y) to the flare's -1..1 frame position.
    const fx = (x: number): number => Math.max(-1, Math.min(1, x / 6));
    const fy = (z: number): number => Math.max(-1, Math.min(1, -(z - 1) / 3));
    const [color] = paint(v.diffuse_color, "#ffffff");
    const brightness = Math.max(0, Math.min(1, num(v.strength, 0.75)));
    return single(
      input,
      null,
      (n) => ({ alpha: fadeInOut(n, 0.1, 0.1) }),
      (n) => [
        effect("LensFlare", {
          x: curve([[0, fx(num(v.start_x, 3.8))], [1, fx(num(v.end_x, -4.6)), LINEAR]], n),
          y: curve([[0, fy(num(v.start_z, 2.65))], [1, fy(num(v.end_z, 3.21)), LINEAR]], n),
          brightness: constant(brightness),
          color: colorKeyframe(color),
        }),
      ],
    );
  },

  spacemovie_intro: (input) => {
    const { v, width, height } = input;
    const blue = "#4bd5ee";
    const yellow = "#ffe81f";
    const sans = fontSpec("FreeSans", false);
    const bold = fontSpec("FreeSansBold");
    const introSize = height * 0.05;
    const intro = svgDoc(width, height, textBlock(lines(str(v.Alongtimeago)), { x: width * 0.22, y: height / 2, size: introSize, fill: blue, font: sans, anchor: "start", lineHeight: 1.3 }));
    const logoSize = height * 0.2;
    const logo = svgDoc(width, height, textBlock(lines(str(v.TitleSpaceMovie)).map((l) => l.toUpperCase()), { x: width / 2, y: height / 2, size: logoSize, fill: "none", font: bold, stroke: yellow, strokeWidth: logoSize * 0.035, lineHeight: 0.95, letterSpacing: logoSize * 0.05 }));
    // The crawl: episode, its title, then the text, scrolled up through the frame.
    const crawlWidth = width * 0.6;
    let size = height * 0.05;
    let body: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      body = wrap(str(v.MainText), size, crawlWidth, true);
      const total = (body.length + 4) * size * 1.35;
      if (total <= height * 0.98) break;
      size *= Math.max(0.6, (height * 0.98) / total);
    }
    const lh = size * 1.35;
    const blockLines = 3 + body.length;
    const top = (height - blockLines * lh) / 2;
    const crawl = svgDoc(
      width,
      height,
      textBlock([str(v.Episode)], { x: width / 2, y: top + lh / 2, size, fill: yellow, font: bold }) +
        textBlock([str(v.EpisodeTitle)], { x: width / 2, y: top + lh * 1.6, size: size * 1.3, fill: yellow, font: bold }) +
        textBlock(body, { x: (width - crawlWidth) / 2, y: top + lh * 3 + (body.length * lh) / 2, size, fill: yellow, font: bold, anchor: "start", lineHeight: 1.35 }),
    );
    const segments: [number, number, string, (n: number) => Record<string, unknown>][] = [
      [0, 0.08, intro, (n) => ({ alpha: fadeInOut(n, 0.2, 0.2) })],
      [
        0.08,
        0.2,
        logo,
        (n) => {
          const scale = curve([[0, 1.6], [1, 0.05, LINEAR]], n);
          return { scale_x: scale, scale_y: scale, alpha: curve([[0, 1], [0.85, 1, LINEAR], [1, 0, LINEAR]], n) };
        },
      ],
      [0.2, 1, crawl, (n) => ({ location_y: curve([[0, 1], [1, -1.05, LINEAR]], n), alpha: curve([[0, 1], [0.9, 1, LINEAR], [1, 0, LINEAR]], n) })],
    ];
    return segments.map(([from, to, svg, props]) => ({ from, to, svg, props: props(input.framesOf(from, to)), effects: [] }));
  },
};

/** True when the engine can render `name` (a template name from `ANIMATED_TITLES`). */
export function rendersOnWeb(name: string): boolean {
  return Object.hasOwn(RECIPES, name);
}

/**
 * The clips of an animated title: `values` are the template's parameter
 * values, `frames` the whole animation's length in project frames.
 */
export function buildAnimatedTitle(name: string, values: ParamValues, size: { width: number; height: number }, frames: number): AnimatedSegment[] {
  const recipe = RECIPES[name];
  if (!recipe) throw new Error(`no 2D version of the animated title ${name}`);
  const total = Math.max(1, Math.trunc(frames));
  const framesOf = (from: number, to: number): number => Math.max(1, Math.round(to * total) - Math.round(from * total));
  return recipe({ v: values, width: size.width, height: size.height, framesOf });
}
