/**
 * House styles: styles that come with their own drawn technique library and
 * their own taste profile. The cinetic styles (zenvi-styles
 * styles/cinetic-*.md, after cinetic, MIT, (c) 2026 Leonxlnx) draw from
 * cinetic's measured library and carry its hard bans (review/taste.ts). The
 * bans are one house look, not a global rule: the person's brand always
 * wins, and no other style is held to them.
 */

import type { Brief, BriefAspect, BriefDraw } from "./brief.js";
import { CINETIC_TECHNIQUES } from "./cinetic-library.js";
import { drawSeed, drawTechnique, drawTechniques, type Draw, type DrawEnergy, type DrawEntry, type DrawFormat } from "./draw.js";

export type TasteProfile = "cinetic";

export interface HouseStyle {
  profile: TasteProfile;
  library: readonly DrawEntry[];
  format: DrawFormat;
  /** The style's own pace; a request that asks for energy raises it. */
  energy: DrawEnergy;
}

export const HOUSE_STYLES: Readonly<Record<string, HouseStyle>> = {
  "cinetic-launch-film": { profile: "cinetic", library: CINETIC_TECHNIQUES, format: "launch", energy: "calm" },
  "cinetic-teaser": { profile: "cinetic", library: CINETIC_TECHNIQUES, format: "launch", energy: "high" },
  "cinetic-feature-loop": { profile: "cinetic", library: CINETIC_TECHNIQUES, format: "loop", energy: "calm" },
  "cinetic-logo-sting": { profile: "cinetic", library: CINETIC_TECHNIQUES, format: "sting", energy: "calm" },
  "cinetic-ui-walkthrough": { profile: "cinetic", library: CINETIC_TECHNIQUES, format: "walkthrough", energy: "calm" },
};

/** Words that opt a calm house style into its crisp, high-energy profile (cinetic SKILL.md section 5). */
const ENERGY_WORDS = /\b(energy|energetic|hype|crisp|punchy|drop|fast|high[- ]energy|teaser|aggressive)\b/i;

export function houseStyle(style: string): HouseStyle | undefined {
  return HOUSE_STYLES[style];
}

/** The taste profile whose bans `brief` is held to: a house style's, unless the person gave a brand of their own. */
export function tasteProfile(brief: Pick<Brief, "style" | "brand">): TasteProfile | null {
  const house = houseStyle(brief.style);
  return house && !brief.brand ? house.profile : null;
}

export interface HouseDrawInput {
  style: string;
  aspect: BriefAspect;
  seconds: number;
  /** The request's words: its energy, and the seed with the history. */
  text: string;
  /** Technique and library ids recent films drew (the host's memory, the project's last draw). */
  avoid?: readonly string[];
  brand?: string;
}

/** The technique draw for a house style, or null for any other style. A vertical frame draws the vertical format's order. */
export function houseDraw(input: HouseDrawInput): (Draw & { library: TasteProfile }) | null {
  const house = houseStyle(input.style);
  if (!house) return null;
  const format: DrawFormat = input.aspect === "9:16" && (house.format === "launch" || house.format === "feature") ? "vertical" : house.format;
  const energy: DrawEnergy = house.energy === "calm" && ENERGY_WORDS.test(input.text) ? "high" : house.energy;
  const avoid = [...(input.avoid ?? [])];
  const seed = drawSeed(`${input.style}\n${input.text}\n${avoid.join(",")}`);
  return { library: house.profile, ...drawTechniques(house.library, { format, energy, seconds: input.seconds, seed, avoid, houseBans: !input.brand }) };
}

/** `draw` under the brief's brand: a brand saved after the draw lifts its ban-safe variants, and dropping the brand brings them back. */
export function drawForBrand(draw: BriefDraw, style: string, brand?: string): BriefDraw {
  const house = houseStyle(style);
  if (!house) return draw;
  const bans = new Map(house.library.map((e) => [e.id, (e.bans ?? []).length > 0]));
  return { ...draw, picks: draw.picks.map((p) => ({ ...p, ban_safe_variant: !brand && (bans.get(p.id) ?? p.ban_safe_variant) })) };
}

/**
 * Why a draw saved with `style` is not one its library could have drawn
 * (an agent's own `draw` in save_brief_tool), or null when it is: the house
 * style's library, picks that are its entries with their own technique,
 * category and role, none twice. The draw is how films stop converging on the
 * same moves, so a hand-made one is refused, not saved.
 */
export function drawProblem(draw: BriefDraw, style: string): string | null {
  const house = houseStyle(style);
  if (!house) return `${style} draws no techniques (only the cinetic-* styles do): leave draw out.`;
  if (draw.library !== house.profile) return `${style} draws from the ${house.profile} library, not ${draw.library}.`;
  const entries = new Map(house.library.map((e) => [e.id, e]));
  const seen = new Set<string>();
  for (const p of draw.picks) {
    const e = entries.get(p.id);
    if (!e) return `${p.id} is not in the ${house.profile} library: keep the picks Zenvi drew (get_brief_tool), or save without draw to draw again.`;
    if (p.technique !== drawTechnique(e) || p.category !== e.category || p.role !== e.role) return `${p.id} is ${drawTechnique(e)} (${e.category}, ${e.role}) in the library, not ${p.technique} (${p.category}, ${p.role}).`;
    if (seen.has(p.id)) return `${p.id} is drawn twice.`;
    seen.add(p.id);
  }
  return null;
}
