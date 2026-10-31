/**
 * The technique draw, ported from cinetic's scripts/pick.py (MIT, (c) 2026
 * Leonxlnx): an agent left to choose takes the first familiar move (the same
 * fade-up, push-in and end card in every film), so a style with a drawn
 * library gets its techniques at random instead, weighted toward what fits
 * the film and toward proven moves, and never the ones the last films drew.
 *
 * - Plan size: one technique per 3.5 s of film when calm, per 2.5 s
 *   otherwise, at least the format's minimum (pick.py plan_size).
 * - Slots: the first `size` categories of the format's order of need; a
 *   category with nothing left passes its slot on down that order.
 * - Weight: role (workhorse 3, accent 2, signature 1) x proof (1 + evidence
 *   / 4, capped at 3) x energy fit (same 1, "any" 0.7, other 0.25); a calm
 *   film never draws a high-energy entry.
 * - One signature move per film, two in a plan of 10 or more.
 * - An entry relying on a house-banned look is drawn with its ban-safe
 *   variant while the house bans hold (no brand of the person's: theirs wins).
 *
 * Pure and seeded: the same seed, request and history draw the same plan.
 */

export const DRAW_CATEGORIES = [
  "opening_hook",
  "transition",
  "camera",
  "typography_motion",
  "ui_choreography",
  "data_and_numbers",
  "product_demo",
  "logo_and_end_card",
  "color_and_light",
  "texture_and_finish",
  "layout_and_composition",
  "pacing_structure",
  "micro_interaction",
  "depth_and_3d",
] as const;
export type DrawCategory = (typeof DRAW_CATEGORIES)[number];

export const DRAW_FORMATS = ["launch", "feature", "loop", "sting", "walkthrough", "vertical"] as const;
export type DrawFormat = (typeof DRAW_FORMATS)[number];

export const DRAW_ENERGIES = ["calm", "medium", "high"] as const;
export type DrawEnergy = (typeof DRAW_ENERGIES)[number];

/** Looks cinetic's house style bans that an entry's full recipe may rely on (pick.py BANS). */
export const DRAW_BANS = ["glass", "glow", "serif", "italic", "orange", "beige", "purple", "gradient", "filler-text", "emoji", "sparkle", "confetti", "particles"] as const;
export type DrawBan = (typeof DRAW_BANS)[number];

export interface DrawEntry {
  /** The library's own id (cinetic's). */
  id: string;
  /** The technique file that builds it when it is not `cin-<id>`: an existing Zenvi technique doing the same move. */
  technique?: string;
  category: DrawCategory;
  /** workhorse: carries a film and can recur; accent: one moment; signature: a hero move used once. */
  role: "workhorse" | "accent" | "signature";
  energy: DrawEnergy | "any";
  formats: readonly (DrawFormat | "any")[];
  /** Shipped films it was measured in. */
  evidence: number;
  /** House-banned looks the full recipe relies on: drawn as its ban-safe variant while the house bans hold. */
  bans?: readonly DrawBan[];
}

export interface DrawPick {
  /** The technique file to read (zenvi://styles/<technique>). */
  technique: string;
  /** The library id it was drawn as. */
  id: string;
  category: DrawCategory;
  role: DrawEntry["role"];
  /** Build the file's ban-safe variant: the full recipe relies on a house-banned look and the house bans hold. */
  ban_safe_variant: boolean;
}

export interface DrawRequest {
  format: DrawFormat;
  energy: DrawEnergy;
  seconds: number;
  seed: number;
  /** Library ids (or technique ids) drawn by recent films: never drawn again while anything else fits. */
  avoid?: readonly string[];
  /** False when the person gave a brand: theirs wins over the house bans (default true). */
  houseBans?: boolean;
}

export interface Draw {
  seed: number;
  format: DrawFormat;
  energy: DrawEnergy;
  picks: DrawPick[];
}

/** The order a plan fills its slots in, by format: first what the format cannot do without (pick.py ORDER). */
export const DRAW_ORDER: Readonly<Record<DrawFormat, readonly DrawCategory[]>> = {
  launch: ["opening_hook", "transition", "typography_motion", "product_demo", "ui_choreography", "logo_and_end_card", "camera", "transition", "data_and_numbers", "micro_interaction", "color_and_light", "pacing_structure", "typography_motion", "depth_and_3d", "layout_and_composition", "texture_and_finish", "transition", "ui_choreography"],
  feature: ["product_demo", "ui_choreography", "opening_hook", "transition", "micro_interaction", "typography_motion", "logo_and_end_card", "data_and_numbers", "camera", "color_and_light", "ui_choreography", "layout_and_composition"],
  loop: ["ui_choreography", "product_demo", "micro_interaction", "typography_motion", "transition", "camera", "pacing_structure", "color_and_light"],
  sting: ["logo_and_end_card", "opening_hook", "typography_motion", "micro_interaction", "camera", "texture_and_finish"],
  walkthrough: ["product_demo", "ui_choreography", "opening_hook", "transition", "micro_interaction", "camera", "typography_motion", "logo_and_end_card", "ui_choreography", "product_demo", "transition", "pacing_structure", "layout_and_composition", "micro_interaction"],
  vertical: ["opening_hook", "product_demo", "ui_choreography", "typography_motion", "transition", "logo_and_end_card", "micro_interaction", "data_and_numbers", "camera", "color_and_light", "transition", "typography_motion"],
};

const MIN_PICKS: Readonly<Record<DrawFormat, number>> = { launch: 6, feature: 5, loop: 4, sting: 4, walkthrough: 6, vertical: 5 };
const ROLE_WEIGHT: Readonly<Record<DrawEntry["role"], number>> = { workhorse: 3, accent: 2, signature: 1 };

/** How many techniques a film of this format, length and energy draws. */
export function drawSize(format: DrawFormat, seconds: number, energy: DrawEnergy): number {
  const n = Math.round(seconds / (energy === "calm" ? 3.5 : 2.5));
  return Math.max(MIN_PICKS[format], Math.min(DRAW_ORDER[format].length, n));
}

function weight(e: DrawEntry, energy: DrawEnergy): number {
  if (energy === "calm" && e.energy === "high") return 0;
  const w = ROLE_WEIGHT[e.role] * Math.min(3, 1 + e.evidence / 4);
  return w * (e.energy === energy ? 1 : e.energy === "any" ? 0.7 : 0.25);
}

/** The technique file of an entry. */
export function drawTechnique(e: Pick<DrawEntry, "id" | "technique">, prefix = "cin-"): string {
  return e.technique ?? `${prefix}${e.id}`;
}

/** A 32-bit seed from text (FNV-1a), for a draw keyed by the request and the history. */
export function drawSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Draw a whole-film plan from `library`. */
export function drawTechniques(library: readonly DrawEntry[], request: DrawRequest): Draw {
  let state = request.seed >>> 0 || 1;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const avoid = new Set(request.avoid ?? []);
  const taken = new Set<string>();
  const fresh = (e: DrawEntry): boolean => !taken.has(e.id) && !avoid.has(e.id) && !avoid.has(drawTechnique(e));
  const pool = library.filter((e) => e.formats.includes("any") || e.formats.includes(request.format));
  const size = drawSize(request.format, request.seconds, request.energy);
  let signatures = size >= 10 ? 2 : 1;
  const picks: DrawEntry[] = [];

  const drawOne = (category: DrawCategory, allowRecent: boolean): boolean => {
    const cand = pool.filter((e) => e.category === category && !taken.has(e.id) && (allowRecent || fresh(e)) && weight(e, request.energy) > 0 && (signatures > 0 || e.role !== "signature"));
    if (cand.length === 0) return false;
    const weights = cand.map((e) => weight(e, request.energy));
    let r = random() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < cand.length - 1 && r >= weights[i]!) r -= weights[i++]!;
    const e = cand[i]!;
    picks.push(e);
    taken.add(e.id);
    if (e.role === "signature") signatures -= 1;
    return true;
  };

  const order = DRAW_ORDER[request.format];
  // Recent films' picks are skipped while anything else fits; a category they used up still gets its slot.
  for (const allowRecent of [false, true]) {
    const queue = [...order.slice(0, size), ...order.slice(size), ...order];
    let slots = size - picks.length;
    for (const category of queue) {
      if (slots <= 0) break;
      if (drawOne(category, allowRecent)) slots -= 1;
    }
    if (picks.length >= size) break;
  }

  const bans = request.houseBans ?? true;
  return {
    seed: request.seed >>> 0,
    format: request.format,
    energy: request.energy,
    picks: picks.map((e) => ({
      technique: drawTechnique(e),
      id: e.id,
      category: e.category,
      role: e.role,
      ban_safe_variant: bans && (e.bans ?? []).length > 0,
    })),
  };
}
