/**
 * Video profiles: every profile shipped in zenvi-core `src/profiles/`
 * (key=value files: description, frame rate, size, aspect ratios). The table
 * is generated at dev time by `scripts/gen-profiles.mjs` into
 * `profiles.data.ts`; `legacy/` profiles are included and flagged.
 */

import type { Fraction } from "./types.js";
import { PROFILE_TABLE } from "./profiles.data.js";

export interface Profile {
  /** File name in zenvi-core src/profiles, e.g. `"01280x0720p0030_16-09"`. */
  key: string;
  /** What the project stores in `profile`, e.g. `"HD 720p 30 fps"`. */
  description: string;
  width: number;
  height: number;
  fps: Fraction;
  progressive: boolean;
  /** Sample (pixel) aspect ratio. */
  pixel_ratio: Fraction;
  display_ratio: Fraction;
  colorspace?: number;
  /** From `src/profiles/legacy/` (kept so old projects resolve). */
  legacy?: boolean;
}

export const PROFILES: readonly Profile[] = PROFILE_TABLE;

/** The profile the default project uses (`src/settings/_default.project`). */
export const DEFAULT_PROFILE_DESCRIPTION = "HD 720p 30 fps";

const byKey = new Map(PROFILES.map((p) => [p.key.toLowerCase(), p]));
const byDescription = new Map<string, Profile>();
for (const profile of PROFILES) {
  const k = profile.description.toLowerCase();
  // Prefer current profiles over legacy ones that share a description.
  if (!byDescription.has(k) || byDescription.get(k)!.legacy) byDescription.set(k, profile);
}

/** Find a profile by key (file name) or description, case-insensitively. */
export function findProfile(keyOrDescription: string): Profile | undefined {
  const k = keyOrDescription.trim().toLowerCase();
  return byKey.get(k) ?? byDescription.get(k);
}

/** Profiles matching a size and frame rate (current profiles first). */
export function profilesMatching(width: number, height: number, fps?: Fraction): Profile[] {
  return PROFILES.filter(
    (p) =>
      p.width === width &&
      p.height === height &&
      (fps === undefined || p.fps.num * fps.den === fps.num * p.fps.den),
  ).sort((a, b) => Number(a.legacy ?? false) - Number(b.legacy ?? false));
}
