/**
 * Which video profile a request means: social presets ("instagram_reel"),
 * profile names and keys, "WIDTHxHEIGHT[ fps]", words, an orientation flip,
 * and a custom profile when no profile has the size and rate.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export_profiles.py (`SOCIAL_PRESETS`,
 * `social_preset`, `match_profile`, `ensure_profile`, `_size_for`,
 * `resolve_profile_request`, `_flip`) over a catalog the caller builds:
 * the user's custom profiles first, then the built-in ones, each folder in
 * reverse file-name order, as `project_profile.profile_catalog` lists them.
 */

import {
  PROFILES,
  profileFpsFraction,
  profileKey,
  reducedDisplayRatio,
  type CatalogProfile,
  type Profile,
} from "./profiles.js";
import type { Fraction } from "./types.js";

/** name → [width, height, fps (null = the project's), export preset title, aliases]. */
export const SOCIAL_PRESETS: Readonly<Record<string, readonly [number, number, number | null, string, readonly string[]]>> = {
  instagram_reel: [1080, 1920, null, "Instagram Reels", ["instagram reels", "ig reel", "ig reels", "reel", "reels", "instagram_reels"]],
  instagram_story: [1080, 1920, null, "Instagram Reels", ["instagram stories", "ig story", "story", "stories", "instagram_stories"]],
  tiktok: [1080, 1920, null, "TikTok", ["tik tok", "tik_tok"]],
  youtube_shorts: [1080, 1920, null, "YouTube Shorts", ["shorts", "youtube short", "yt shorts", "yt_shorts", "youtube_short"]],
  snapchat: [1080, 1920, null, "Snapchat", ["snap", "snapchat spotlight"]],
  facebook_reel: [1080, 1920, null, "Facebook", ["facebook reels", "fb reel", "facebook story"]],
  vertical: [1080, 1920, null, "MP4 (h.264)", ["9:16", "portrait", "vertical video", "phone", "9x16"]],
  // "square post" is a web addition (agents ask for it; zenvi-core lacks it).
  instagram_post: [1080, 1080, null, "Instagram", ["instagram square", "ig post", "instagram feed", "square", "1:1", "1x1", "instagram", "square post"]],
  instagram_portrait: [1080, 1350, null, "MP4 (h.264)", ["4:5", "4x5", "instagram 4:5", "ig portrait", "portrait post", "instagram feed portrait"]],
  youtube: [1920, 1080, null, "YouTube", ["youtube 1080p", "youtube hd", "yt", "youtube_1080p", "youtube_hd", "1080p"]],
  youtube_2k: [2560, 1440, null, "YouTube (2K)", ["youtube 1440p", "1440p", "2k", "qhd", "wqhd"]],
  youtube_4k: [3840, 2160, null, "YouTube (4K)", ["youtube 2160p", "yt 4k", "4k youtube"]],
  facebook: [1920, 1080, null, "Facebook", ["fb", "facebook video"]],
  x: [1920, 1080, null, "Twitter / X", ["twitter", "x twitter", "x_twitter", "tweet"]],
  linkedin: [1920, 1080, null, "LinkedIn", ["linked in"]],
  vimeo: [1920, 1080, null, "Vimeo", []],
  landscape: [1920, 1080, null, "MP4 (h.264)", ["16:9", "16x9", "widescreen", "hd", "full hd", "fhd"]],
  hd_720p: [1280, 720, null, "MP4 (h.264)", ["720p", "hd 720p"]],
  "4k": [3840, 2160, null, "MP4 (h.264)", ["uhd", "4k uhd", "2160p", "ultra hd"]],
  cinema: [1920, 1080, 24, "MP4 (h.264)", ["film", "cinematic", "movie", "24fps", "24 fps"]],
  cinema_4k: [3840, 2160, 24, "MP4 (h.264)", ["4k cinema", "4k film", "cinematic 4k", "4k 24 fps"]],
};

/** Thrown for a request no profile answers; the message is the desktop's ToolError text. */
export class ProfileRequestError extends Error {}

/** `_norm`: lower case, runs of space / - / slash become one underscore. */
function norm(text: string): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The social preset a name or alias means (`social_preset`), or null. */
export function socialPreset(name: string): { key: string; width: number; height: number; fps: number | null; exportPreset: string } | null {
  const key = norm(name).replace(/_(profile|preset|format|video)$/, "");
  const found =
    Object.entries(SOCIAL_PRESETS).find(([k]) => k === key) ??
    Object.entries(SOCIAL_PRESETS).find(([, spec]) => spec[4].some((alias) => norm(alias) === key));
  if (!found) return null;
  const [k, [width, height, fps, exportPreset]] = found;
  return { key: k, width, height, fps, exportPreset };
}

/**
 * The built-in profile a social preset name means ("instagram_reel",
 * "shorts", "youtube", "square_post"), at `fps` when the preset leaves the
 * rate to the project, or null for a name that is not a social preset.
 */
export function socialProfile(name: string, fps = 30): CatalogProfile | null {
  const preset = socialPreset(name);
  if (!preset) return null;
  return matchProfile(profileCatalog(), preset.width, preset.height, preset.fps ?? fps);
}

const pyCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The profiles a person can pick, in the desktop's search order: custom
 * profiles, then the built-in ones (not the legacy folder), each in reverse
 * file-name order.
 */
export function profileCatalog(custom: readonly CatalogProfile[] = []): CatalogProfile[] {
  const user = [...custom].sort((a, b) => pyCompare(b.key, a.key)).map((p) => ({ ...p, user: true }));
  const builtIn = PROFILES.filter((p) => !p.legacy)
    .slice()
    .sort((a, b) => pyCompare(b.key, a.key))
    .map((p) => ({ ...p, user: false }));
  return [...user, ...builtIn];
}

export function fpsValue(profile: Pick<Profile, "fps">): number {
  return profile.fps.num / profile.fps.den;
}

const isSquarePixels = (p: Profile): boolean => p.pixel_ratio.num === 1 && p.pixel_ratio.den === 1;

/** `match_profile`: the best profile of this size (and rate): progressive, not 360, square pixels, built in, shortest name. */
export function matchProfile(catalog: readonly CatalogProfile[], width: number, height: number, fps?: number | null): CatalogProfile | null {
  let candidates = catalog.filter((p) => p.width === Math.trunc(width) && p.height === Math.trunc(height));
  if (fps) {
    const exact = candidates.filter((p) => Math.abs(fpsValue(p) - fps) < 0.011);
    if (exact.length === 0) return null;
    candidates = exact;
  }
  if (candidates.length === 0) return null;
  const rank = (p: CatalogProfile): number[] => [
    Number(!p.progressive),
    Number(Boolean(p.spherical)),
    Number(!isSquarePixels(p)),
    Number(p.user),
    Number(p.description.toLowerCase().includes("anamorphic")),
    p.description.length,
  ];
  // Python's sort is stable: ties keep the catalog's order.
  return candidates
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => {
      for (let k = 0; k < a.r.length; k += 1) if (a.r[k] !== b.r[k]) return a.r[k]! - b.r[k]!;
      return a.i - b.i;
    })[0]!.p;
}

/** A profile to use; `create` when it is a new custom profile the host must save first. */
export interface ProfileChoice {
  profile: CatalogProfile;
  create: boolean;
}

/** What a request resolves against: the catalog and the project's frame rate. */
export interface ProfileContext {
  catalog: readonly CatalogProfile[];
  /** The project's frame rate (keeps it for social presets and sizes without one). */
  projectFps: number;
}

/** `f"{fps:.2f}".rstrip("0").rstrip(".")`. */
function fpsText(fps: number): string {
  return fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * `ensure_profile`: an existing profile of this size and exact rate, else a
 * new custom one ("Custom 1000x1000 30 fps", square pixels, progressive)
 * that the host has to save before a project can use it.
 */
export function ensureProfile(ctx: ProfileContext, width: number, height: number, fps: Fraction): ProfileChoice {
  const found = matchProfile(ctx.catalog, width, height, fps.num / fps.den);
  if (found) return { profile: found, create: false };
  const description = `Custom ${width}x${height} ${fpsText(fps.num / fps.den)} fps`;
  const named = ctx.catalog.find((p) => p.description === description);
  if (named) return { profile: named, create: false };
  const record = {
    description,
    width: Math.trunc(width),
    height: Math.trunc(height),
    fps: { num: Math.trunc(fps.num), den: Math.trunc(fps.den) },
    progressive: true,
    pixel_ratio: { num: 1, den: 1 },
    display_ratio: reducedDisplayRatio(width, height),
    spherical: false,
  };
  return { profile: { ...record, key: profileKey(record), user: true }, create: true };
}

/** `_size_for`: a profile at this size: the requested rate, else the project's, else 30, else any. */
export function sizeFor(ctx: ProfileContext, width: number, height: number, fps: number | null): ProfileChoice | null {
  for (const want of [fps, fps ? null : ctx.projectFps, fps ? null : 30]) {
    if (!want) continue;
    const found = matchProfile(ctx.catalog, width, height, want);
    if (found) return { profile: found, create: false };
  }
  if (fps) return ensureProfile(ctx, width, height, profileFpsFraction(fps));
  const any = matchProfile(ctx.catalog, width, height);
  return any ? { profile: any, create: false } : null;
}

const SIZE_RE = /(\d{3,5})\s*[x×*]\s*(\d{3,5})(?:\D+(\d+(?:\.\d+)?)\s*(?:fps|p)?)?/i;

/** `resolve_profile_request`: a profile name or key, social preset, "WIDTHxHEIGHT[ fps]" or words. */
export function resolveProfileRequest(ctx: ProfileContext, request: string, fps: number | null = null): ProfileChoice {
  const text = String(request ?? "").trim();
  if (!text) throw new ProfileRequestError("name a profile or social preset (see list_project_profiles_tool)");
  const social = socialPreset(text);
  if (social) {
    const found = sizeFor(ctx, social.width, social.height, fps || social.fps);
    if (!found) throw new ProfileRequestError(`no profile is ${social.width}x${social.height}`);
    return found;
  }
  const lowered = text.toLowerCase();
  for (const p of ctx.catalog) {
    if (p.description.toLowerCase() === lowered || p.key.toLowerCase() === lowered) {
      if (fps && Math.abs(fpsValue(p) - fps) > 0.011) {
        const resized = sizeFor(ctx, p.width, p.height, fps);
        if (!resized) throw new ProfileRequestError(`no profile is ${p.width}x${p.height}`);
        return resized;
      }
      return { profile: p, create: false };
    }
  }
  const m = SIZE_RE.exec(text);
  if (m) {
    const want = fps || (m[3] ? Number(m[3]) : null);
    const found = sizeFor(ctx, Number(m[1]), Number(m[2]), want);
    if (found) return found;
  }
  const tokens = lowered.split(/[\s,]+/).filter(Boolean);
  let hits = ctx.catalog.filter((p) => tokens.every((t) => p.description.toLowerCase().includes(t)));
  if (fps) {
    const sameRate = hits.filter((p) => Math.abs(fpsValue(p) - fps) < 0.011);
    if (sameRate.length > 0) hits = sameRate;
  }
  if (hits.length === 1) return { profile: hits[0]!, create: false };
  if (hits.length > 1) {
    const names = [...new Set(hits.map((h) => h.description))].sort(pyCompare).slice(0, 6).join(", ");
    throw new ProfileRequestError(`'${text}' matches ${hits.length} profiles (${names}...); use the exact name or add fps`);
  }
  throw new ProfileRequestError(
    `no profile or social preset matches '${text}'. Social presets: ${Object.keys(SOCIAL_PRESETS).join(", ")}. ` +
      "Or give WIDTHxHEIGHT, e.g. '1080x1920'.",
  );
}

/** `_flip`: the same profile family turned to landscape, portrait or square. */
export function flipProfile(ctx: ProfileContext, choice: ProfileChoice, orientation: string, fps: number | null): ProfileChoice {
  let w = choice.profile.width;
  let h = choice.profile.height;
  if (orientation === "square") {
    const side = Math.min(w, h);
    w = side;
    h = side;
  } else if (orientation === "portrait" && w > h) {
    [w, h] = [h, w];
  } else if (orientation === "landscape" && h > w) {
    [w, h] = [h, w];
  } else {
    return choice;
  }
  const found = sizeFor(ctx, w, h, fps || fpsValue(choice.profile));
  if (!found) throw new ProfileRequestError(`no profile is ${w}x${h}`);
  return found;
}
