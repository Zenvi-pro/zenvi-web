/**
 * cinetic's hard bans as one house taste profile (SKILL.md "Hard bans",
 * scripts/lint-film.mjs and palette.py, MIT, (c) 2026 Leonxlnx): the tells
 * of generated work it never lets into a film it invents the look of. They
 * apply only to a brief whose style is a cinetic house style and that names
 * no brand of the person's (brief/house.ts tasteProfile): other styles use
 * serif accents and glass cards on purpose, and a brand always wins.
 *
 * Read from the project: the fonts, colours and words of the titles (their
 * SVG), the motion blocks and their params, Zenvi FX, motion transitions
 * and the eases on text.
 */

import { evaluate } from "../keyframe/evaluate.js";
import { readMotionLink } from "../links/zenvi-link.js";
import { readFxLink } from "../fx/link.js";
import type { Project } from "../model/types.js";
import { listProjectMotionTransitions } from "../ops/motion-transitions.js";
import type { TextBox } from "./types.js";

export type HouseBan = "serif" | "italic" | "condensed" | "orange" | "beige" | "purple" | "neon" | "gradient" | "glass" | "glow" | "particles" | "emoji" | "introducing" | "eyebrow" | "gimmick-transition" | "bounce";

export interface TasteFinding {
  ban: HouseBan;
  clipId?: string;
  at: number;
  message: string;
  fix: string;
}

export interface TasteInput {
  project: Project;
  /** The SVG of each title clip the host could read, by clip id. */
  svgs?: ReadonlyMap<string, string>;
  /** Where each title's text lands (review/text-boxes.ts), for eyebrow labels. */
  textBoxes?: readonly TextBox[];
}

const SERIF = /\b(serif|instrument serif|playfair|georgia|times|garamond|merriweather|lora|baskerville|cormorant|fraunces|bodoni|didot|caslon|libre caslon|dm serif|crimson|spectral|noto serif)\b/i;
const CONDENSED = /\b(anton|bebas|oswald|league gothic|condensed|compressed|impact)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const KINETIC_TITLE_KEY = "zenvi_kinetic_title";

/** Hue (0-360), saturation and lightness (0-1) of #rrggbb. */
function hsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const v = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** The banned hue family of a colour, or null when it is allowed (neutrals, red, green, teal, blue, yellow). */
export function bannedColour(hex: string): "orange" | "beige" | "purple" | "neon" | null {
  const c = hsl(hex);
  if (!c) return null;
  const [h, s, l] = c;
  if (s < 0.12 || l < 0.08 || l > 0.97) return null;
  if (h >= 22 && h < 60 && l >= 0.7 && s >= 0.15) return "beige";
  if (h >= 22 && h < 50 && l >= 0.4 && l < 0.7 && s < 0.55) return "beige";
  if (h >= 15 && h < 48 && s >= 0.45) return "orange";
  if (h >= 245 && h < 325 && s >= 0.25 && l >= 0.15 && l <= 0.85) return "purple";
  if (s >= 0.9 && l >= 0.45 && l <= 0.62 && ((h >= 70 && h < 190) || (h >= 300 && h < 345))) return "neon";
  return null;
}

function hexes(text: string): string[] {
  return [...text.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => m[0]);
}

function svgText(svg: string): string {
  return [...svg.matchAll(/<(?:tspan|text)\b[^>]*>([^<]*)/gi)].map((m) => m[1]!).join(" ").replace(/\s+/g, " ").trim();
}

function paramColours(params: Record<string, unknown>): string[] {
  return Object.entries(params).flatMap(([, v]) => (typeof v === "string" ? hexes(v) : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").flatMap(hexes) : []));
}

const GLASS_BLOCKS = new Set(["glass_cards", "liquid_glass"]);
const PARTICLE_BLOCKS = new Set(["particle_burst", "hyperspace"]);
const GLOW_FX = new Set(["bloom", "light_leak"]);
const GIMMICK_TRANSITIONS = new Set(["glitch", "flash_white", "spin"]);
const FIX = {
  type: "One clean modern sans at two weights (add_title_tool / add_kinetic_title_tool style documentary, motion blocks display_font sans).",
  colour: "Ink and paper (neutral or cool) plus one accent from red, green, teal, blue or yellow, with a meaning.",
  decoration: "Cut it: every element names its job (reveal, route, validate, emphasise).",
};

/** Where `input.project` breaks the cinetic house bans. */
export function houseBanFindings(input: TasteInput): TasteFinding[] {
  const { project } = input;
  const out: TasteFinding[] = [];
  const seen = new Set<string>();
  const add = (f: TasteFinding) => {
    const key = `${f.ban}:${f.clipId ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  };
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  for (const clip of project.clips) {
    const id = String(clip.id);
    const at = clip.position;
    // add_kinetic_title_tool outlines its words, so its style tag says the face (tools/catalog/kinetic-titles.ts).
    const kinetic = clip[KINETIC_TITLE_KEY] as { text?: unknown; style?: unknown } | undefined;
    if (kinetic) {
      const style = String(kinetic.style ?? "");
      const words = String(kinetic.text ?? "");
      if (style === "editorial") {
        add({ ban: "serif", clipId: id, at, message: `Title "${words}" uses the editorial style (Instrument Serif).`, fix: FIX.type });
        add({ ban: "italic", clipId: id, at, message: `Title "${words}" uses the editorial style's italic emphasis.`, fix: FIX.type });
      }
      if (style === "stack" || style === "creator") add({ ban: "condensed", clipId: id, at, message: `Title "${words}" uses the ${style} style's condensed capitals (Bebas Neue): a generated-look tell.`, fix: FIX.type });
      if (EMOJI.test(words)) add({ ban: "emoji", clipId: id, at, message: `Title "${words}" has an emoji.`, fix: FIX.decoration });
      if (/^\s*introducing\b/i.test(words)) add({ ban: "introducing", clipId: id, at, message: `Title "${words}" opens on "Introducing".`, fix: "Open inside the problem; the product arrives as the answer, named once." });
    }
    const svg = input.svgs?.get(id);
    if (svg) {
      const families = [...svg.matchAll(/font-family\s*[:=]\s*["']?([^;"'>]+)/gi)].map((m) => m[1]!);
      if (families.some((f) => SERIF.test(f.replace(/sans-serif/gi, "")))) add({ ban: "serif", clipId: id, at, message: `Title ${id} is set in a serif (${families.join(", ")}).`, fix: FIX.type });
      if (/font-style\s*[:=]\s*["']?(italic|oblique)|skewX\(/i.test(svg)) add({ ban: "italic", clipId: id, at, message: `Title ${id} is italic or skewed.`, fix: FIX.type });
      if (families.some((f) => CONDENSED.test(f))) add({ ban: "condensed", clipId: id, at, message: `Title ${id} uses a condensed display face (${families.join(", ")}): a generated-look tell.`, fix: FIX.type });
      for (const hex of hexes(svg)) {
        const ban = bannedColour(hex);
        if (ban) add({ ban, clipId: id, at, message: `Title ${id} uses ${hex} (${ban}).`, fix: FIX.colour });
      }
      const words = svgText(svg);
      if (EMOJI.test(words)) add({ ban: "emoji", clipId: id, at, message: `Title ${id} has an emoji.`, fix: FIX.decoration });
      if (/^\s*introducing\b/i.test(words)) add({ ban: "introducing", clipId: id, at, message: `Title ${id} opens on "Introducing".`, fix: "Open inside the problem; the product arrives as the answer, named once." });
      // Overshoot on copy: a text curve that passes its target between two keys.
      for (const k of ["location_x", "location_y", "scale_x", "scale_y"] as const) {
        const points = (clip[k] as { Points?: { co?: { X?: number; Y?: number } }[] } | undefined)?.Points ?? [];
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1]!.co;
          const b = points[i]!.co;
          if (typeof a?.X !== "number" || typeof b?.X !== "number" || typeof a.Y !== "number" || typeof b.Y !== "number" || b.X - a.X < 2) continue;
          const lo = Math.min(a.Y, b.Y);
          const hi = Math.max(a.Y, b.Y);
          const slack = Math.max(1e-4, (hi - lo) * 0.01);
          for (let x = a.X + 1; x < b.X; x += 1) {
            const v = evaluate(clip[k], x, 0);
            if (v > hi + slack || v < lo - slack) {
              add({ ban: "bounce", clipId: id, at, message: `Title ${id} overshoots on ${k} (a back or bounce ease on copy).`, fix: "Copy settles on an ease-out with no overshoot (ease_out_expo / ease_out_cubic); only a true landing bounces." });
              break;
            }
          }
        }
      }
    }
    const file = files.get(String(clip.file_id));
    if (!file) continue;
    const motion = readMotionLink(file as unknown as Record<string, unknown>);
    if (motion) {
      if (GLASS_BLOCKS.has(motion.block)) add({ ban: "glass", clipId: id, at, message: `Motion block ${motion.block} is glassmorphism.`, fix: "Solid surfaces with a 1 px hairline and a soft shadow instead of frosted glass." });
      if (PARTICLE_BLOCKS.has(motion.block)) add({ ban: "particles", clipId: id, at, message: `Motion block ${motion.block} is particles / a starfield.`, fix: FIX.decoration });
      const font = String(motion.params.display_font ?? "");
      if (font === "serif") add({ ban: "serif", clipId: id, at, message: `Motion block ${motion.block} sets its headline in a serif.`, fix: FIX.type });
      if (font === "display") add({ ban: "condensed", clipId: id, at, message: `Motion block ${motion.block} uses the condensed display face.`, fix: FIX.type });
      const colours = paramColours(motion.params);
      for (const hex of colours) {
        const ban = bannedColour(hex);
        if (ban) add({ ban, clipId: id, at, message: `Motion block ${motion.block} uses ${hex} (${ban}).`, fix: FIX.colour });
      }
      const hues = colours.map(hsl).filter((c): c is [number, number, number] => c !== null && c[1] >= 0.2).map((c) => c[0]);
      const spread = hues.length > 1 ? Math.min(...hues.map((h) => Math.max(...hues.map((g) => Math.min(Math.abs(g - h), 360 - Math.abs(g - h)))))) : 0;
      if (motion.block === "gradient_field" && spread > 40) add({ ban: "gradient", clipId: id, at, message: "A multi-hue gradient ground.", fix: "One hue in two values (or ink to paper), dithered; never a hue-to-hue gradient." });
    }
    const fx = readFxLink(file);
    for (const e of (fx?.effects ?? []) as { effect?: string }[]) {
      if (e.effect && GLOW_FX.has(e.effect)) add({ ban: "glow", clipId: id, at, message: `Zenvi FX ${e.effect} on clip ${id}: glow, bloom and light leaks are out.`, fix: "Light with contrast and one accent; shadows, not halos." });
    }
  }
  for (const t of listProjectMotionTransitions(project)) {
    if (GIMMICK_TRANSITIONS.has(t.preset)) add({ ban: "gimmick-transition", clipId: t.outClipId, at: t.cut, message: `A ${t.preset} transition at ${t.cut.toFixed(1)}s: a preset gimmick.`, fix: "A cut on the grid, a match cut, a mask wipe or the film's one signature move." });
  }
  // Eyebrow labels: a small line sitting just above a larger one while both are up.
  const boxes = input.textBoxes ?? [];
  const spans = new Map(project.clips.map((c) => [String(c.id), [c.position, c.position + (c.end - c.start)] as const]));
  for (const small of boxes) {
    for (const big of boxes) {
      if (small.clipId === big.clipId) continue;
      const hs = small.y1 - small.y0;
      const hb = big.y1 - big.y0;
      const [s0, s1] = spans.get(small.clipId) ?? [0, 0];
      const [b0, b1] = spans.get(big.clipId) ?? [0, 0];
      const together = s0 < b1 && b0 < s1;
      const above = small.y1 <= big.y0 + hb * 0.15 && big.y0 - small.y1 < hb * 0.6;
      const aligned = small.x0 < big.x1 && big.x0 < small.x1;
      if (together && above && aligned && hs < hb * 0.45) add({ ban: "eyebrow", clipId: small.clipId, at: s0, message: `Title ${small.clipId} is a small label over the headline ${big.clipId} (an eyebrow).`, fix: "Drop the label: one fragment at a time, the headline alone." });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
