/**
 * Video profiles: every profile shipped in zenvi-core `src/profiles/`
 * (key=value files: description, frame rate, size, aspect ratios). The table
 * is generated at dev time by `scripts/gen-profiles.mjs` into
 * `profiles.data.ts`; `legacy/` profiles are included and flagged.
 */

import { limitDenominator } from "../timeline/time.js";
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

// ---------------------------------------------------------------------------
// Custom profiles and receipts (zenvi-core develop src/classes/project_profile.py)
// ---------------------------------------------------------------------------

/** A profile as the tools list it: built in, or the user's own (profiles folder). */
export interface CatalogProfile extends Profile {
  /** A custom profile (the desktop's `user`). */
  user: boolean;
  /** Where a custom profile's file is. */
  path?: string;
}

/** `int(text)` for profile values: optional sign and digits only. */
function profileInt(text: string | undefined): number | null {
  const t = (text ?? "").trim();
  return /^[+-]?\d+$/.test(t) ? Number.parseInt(t, 10) : null;
}

/**
 * One profile file (MLT `key=value` text), like `read_profile_file`: null
 * when it is not a profile (a size, rate or description missing, or not
 * positive). Missing ratios default to square pixels and the frame's shape.
 */
export function parseProfileFile(text: string, key: string): Profile | null {
  const values = new Map<string, string>();
  for (const line of text.split(/\r\n|\r|\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const width = profileInt(values.get("width"));
  const height = profileInt(values.get("height"));
  const fpsNum = profileInt(values.get("frame_rate_num"));
  const fpsDen = values.get("frame_rate_den") === "" ? 1 : profileInt(values.get("frame_rate_den"));
  const description = values.get("description") ?? "";
  if (width === null || height === null || fpsNum === null || fpsDen === null || !description) return null;
  if (width <= 0 || height <= 0 || fpsNum <= 0 || fpsDen <= 0) return null;
  const sarNum = profileInt(values.get("sample_aspect_num") || "1") ?? 1;
  const sarDen = profileInt(values.get("sample_aspect_den") || "1") ?? 1;
  const darNum = profileInt(values.get("display_aspect_num") || String(width * sarNum)) ?? width * sarNum;
  const darDen = profileInt(values.get("display_aspect_den") || String(height * sarDen)) ?? height * sarDen;
  return {
    key,
    description,
    width,
    height,
    fps: { num: fpsNum, den: fpsDen },
    progressive: (values.get("progressive") ?? "1") !== "0",
    pixel_ratio: { num: sarNum, den: sarDen },
    display_ratio: { num: darNum, den: darDen },
    spherical: (values.get("spherical") ?? "0") === "1",
  };
}

/** The text of a custom profile file, in the desktop profile editor's format (`write_user_profile`). */
export function profileFileText(profile: Profile): string {
  return [
    `description=${profile.description}`,
    `frame_rate_num=${profile.fps.num}`,
    `frame_rate_den=${profile.fps.den}`,
    `width=${profile.width}`,
    `height=${profile.height}`,
    `progressive=${profile.progressive ? 1 : 0}`,
    `sample_aspect_num=${profile.pixel_ratio.num}`,
    `sample_aspect_den=${profile.pixel_ratio.den}`,
    `display_aspect_num=${profile.display_ratio.num}`,
    `display_aspect_den=${profile.display_ratio.den}`,
    `spherical=${profile.spherical ? 1 : 0}`,
  ].join("\n").concat("\n");
}

const NTSC_PROFILE_RATES: readonly [number, Fraction][] = [
  [23.976, { num: 24000, den: 1001 }],
  [23.98, { num: 24000, den: 1001 }],
  [29.97, { num: 30000, den: 1001 }],
  [47.95, { num: 48000, den: 1001 }],
  [59.94, { num: 60000, den: 1001 }],
  [119.88, { num: 120000, den: 1001 }],
];

/** A frame rate people say as the fraction profiles use (`project_profile.fps_fraction`): 29.97 → 30000/1001. */
export function profileFpsFraction(rate: number): Fraction {
  if (!(rate > 0) || !Number.isFinite(rate)) throw new RangeError("fps must be positive");
  for (const [approx, fraction] of NTSC_PROFILE_RATES) if (Math.abs(rate - approx) < 0.011) return { ...fraction };
  if (Math.abs(rate - Math.round(rate)) < 1e-6) return { num: Math.round(rate), den: 1 };
  return limitDenominator(rate, 1001);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) [x, y] = [y, x % y];
  return x;
}

/** "16:9" for 1920×1080 (`aspect_text`). */
export function aspectText(width: number, height: number): string {
  const g = gcd(width, height) || 1;
  return `${Math.trunc(width) / g}:${Math.trunc(height) / g}`;
}

export type Orientation = "landscape" | "portrait" | "square";

export function orientationOf(width: number, height: number): Orientation {
  const w = Math.trunc(width || 0);
  const h = Math.trunc(height || 0);
  if (w === h) return "square";
  return h > w ? "portrait" : "landscape";
}

/** The display aspect of a frame with these pixels, reduced (`reduced_display_ratio`). */
export function reducedDisplayRatio(width: number, height: number, pixelNum = 1, pixelDen = 1): Fraction {
  const num = Math.trunc(width) * Math.trunc(pixelNum);
  const den = Math.trunc(height) * Math.trunc(pixelDen);
  const g = gcd(num, den) || 1;
  return { num: num / g, den: den / g };
}

/** A profile in a receipt (`describe_profile`). */
export interface ProfileSummary {
  name: string;
  key: string;
  width: number;
  height: number;
  fps: number;
  fps_num: number;
  fps_den: number;
  aspect: string;
  orientation: Orientation;
  interlaced: boolean;
  spherical: boolean;
  user: boolean;
}

export function describeProfile(profile: Profile & { user?: boolean }): ProfileSummary {
  return {
    name: profile.description,
    key: profile.key,
    width: profile.width,
    height: profile.height,
    fps: Math.round((profile.fps.num / profile.fps.den) * 1000) / 1000,
    fps_num: profile.fps.num,
    fps_den: profile.fps.den,
    aspect: aspectText(profile.display_ratio.num, profile.display_ratio.den),
    orientation: orientationOf(profile.width, profile.height),
    interlaced: !profile.progressive,
    spherical: Boolean(profile.spherical),
    user: Boolean(profile.user),
  };
}
