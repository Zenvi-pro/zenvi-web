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
  /** 360° (equirectangular) profile; its key ends in `_360`. */
  spherical?: boolean;
  /** From `src/profiles/legacy/` (kept so old projects resolve). */
  legacy?: boolean;
}

export const PROFILES: readonly Profile[] = PROFILE_TABLE;

/** The profile the default project uses (`src/settings/_default.project`). */
export const DEFAULT_PROFILE_DESCRIPTION = "HD 720p 30 fps";

/**
 * libopenshot `Profile::Key()` (src/Profiles.cpp): `%05dx%04d{p|i}{fps}_%02d-%02d`
 * with the frame rate as 4 digits (integer fps, or fps × 100 rounded for
 * fractional rates), e.g. `01920x1080p2997_16-09`.
 */
export function profileKey(
  profile: Pick<Profile, "width" | "height" | "progressive" | "fps" | "display_ratio" | "spherical">,
): string {
  const code = profile.fps.den === 1 ? profile.fps.num : Math.trunc((profile.fps.num * 100) / profile.fps.den + 0.5);
  const pad = (n: number, width: number): string => String(n).padStart(width, "0");
  return (
    `${pad(profile.width, 5)}x${pad(profile.height, 4)}${profile.progressive ? "p" : "i"}${pad(code, 4)}` +
    `_${pad(profile.display_ratio.num, 2)}-${pad(profile.display_ratio.den, 2)}` +
    (profile.spherical ? "_360" : "")
  );
}

const byKey = new Map(PROFILES.map((p) => [p.key.toLowerCase(), p]));
const currentByKey = new Map(PROFILES.filter((p) => !p.legacy).map((p) => [profileKey(p), p]));
const currentByDescription = new Map<string, Profile>();
const legacyByDescription = new Map<string, Profile>();
for (const profile of PROFILES) {
  const k = profile.description.toLowerCase();
  // The desktop scans each folder in reverse sorted order and takes the first
  // match, so the last key in sorted order wins (project_data.py get_profile).
  if (profile.legacy) {
    if (!legacyByDescription.has(k)) legacyByDescription.set(k, profile);
  } else {
    currentByDescription.set(k, profile);
  }
}

/**
 * Find a profile by key (file name) or description, case-insensitively, like
 * the desktop's `get_profile`: a current profile with that description; else
 * a legacy description is upgraded to the current profile with the same
 * `Profile::Key()` (the legacy profile itself when none matches).
 */
export function findProfile(keyOrDescription: string): Profile | undefined {
  const k = keyOrDescription.trim().toLowerCase();
  const direct = byKey.get(k);
  if (direct) return direct.legacy ? (currentByKey.get(profileKey(direct)) ?? direct) : direct;
  const current = currentByDescription.get(k);
  if (current) return current;
  const legacy = legacyByDescription.get(k);
  if (legacy) return currentByKey.get(profileKey(legacy)) ?? legacy;
  return undefined;
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
