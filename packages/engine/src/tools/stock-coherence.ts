/**
 * Footage that belongs to one film, for gather_stock_footage_tool's
 * coherence mode: which Pexels contributors shot more than one of the
 * searches (a shoot uploaded as many clips shares light, lens and grade),
 * and how far a downloaded clip's look sits from the set's.
 *
 * The look is unify_grade_tool's continuity measure (exposure, white
 * balance, contrast as a LookProfile, distance in its tolerances) plus how
 * much detail the frame holds, a rough stand-in for the lens: a shallow
 * depth of field blurs most of the picture, a wide deep-focus shot keeps it
 * sharp. Both come from the one small frame the near-duplicate check
 * renders anyway.
 */

import type { PexelsVideo } from "../stock/stock.js";
import { buildLookProfile } from "./color-agent.js";
import { bandScore } from "./color-unify.js";
import { scopesOf } from "./catalog/color-agent.js";

type Json = Record<string, unknown>;
type Pixels = Parameters<typeof scopesOf>[0];

/** A clip's measured look. */
export interface StockLook {
  profile: Json;
  /** Mean luma step between neighbouring pixels, 0-1. */
  detail: number;
}

/**
 * Farthest a clip may sit from the set's look and still be taken before the
 * clips closer to it, in squared unify tolerances: one key four tolerances
 * off (a daylight shot next to tungsten), or all of them about two.
 */
export const COHERENT_LOOK = 16;
/** Detail ratio that counts as one tolerance: 1.8x sharper or softer. */
const DETAIL_STEP = Math.log(1.8);

export function lookOf(pixels: Pixels): StockLook | null {
  const profile = buildLookProfile(scopesOf(pixels));
  if (!profile.present) return null;
  return { profile, detail: pictureDetail(pixels) };
}

function lumaAt(p: Pixels, i: number): number {
  return (0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!) / 255;
}

/** Mean absolute luma difference to the right and below neighbours. */
export function pictureDetail(p: Pixels): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y + 1 < p.height; y += 1) {
    for (let x = 0; x + 1 < p.width; x += 1) {
      const i = (y * p.width + x) * 4;
      const v = lumaAt(p, i);
      sum += Math.abs(v - lumaAt(p, i + 4)) + Math.abs(v - lumaAt(p, i + p.width * 4));
      n += 2;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** How far apart two looks are, in squared tolerances; 0 = the same light, grade and lens. */
export function lookDistance(a: StockLook, b: StockLook): number {
  const detail = Math.log(Math.max(a.detail, 1e-3) / Math.max(b.detail, 1e-3)) / DETAIL_STEP;
  return bandScore(a.profile, b.profile) + detail * detail;
}

/**
 * Each contributor's reach: how many of the searches have a usable result
 * from them, plus one for contributors already in the project (their shoot
 * is part of the film). Results without a contributor reach nothing.
 */
export function creatorReach(lists: readonly (readonly { video: PexelsVideo }[])[], known: ReadonlySet<string>): Map<string, number> {
  const queries = new Map<string, Set<number>>();
  lists.forEach((list, i) => {
    for (const { video } of list) {
      if (!video.user_name) continue;
      const set = queries.get(video.user_name) ?? new Set<number>();
      set.add(i);
      queries.set(video.user_name, set);
    }
  });
  const reach = new Map<string, number>();
  for (const [user, set] of queries) reach.set(user, set.size + (known.has(user) ? 1 : 0));
  return reach;
}

/**
 * One search's results in coherence order: contributors who shot two or
 * more of the searches first (widest reach first), as long as the page
 * still matches the search at least half as well as its best result; then
 * the rest in relevance order. `list` comes best first.
 */
export function coherenceOrder<C extends { video: PexelsVideo; score?: number }>(list: readonly C[], reach: ReadonlyMap<string, number>): C[] {
  const best = list.reduce((m, c) => Math.max(m, c.score ?? 0), 0);
  const rank = (c: C): number => {
    const r = reach.get(c.video.user_name ?? "") ?? 0;
    return r >= 2 && (c.score ?? 0) >= best / 2 ? r : 0;
  };
  return list
    .map((c, k) => ({ c, k, r: rank(c) }))
    .sort((a, b) => b.r - a.r || a.k - b.k)
    .map((e) => e.c);
}
