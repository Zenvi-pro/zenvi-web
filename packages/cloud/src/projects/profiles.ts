/**
 * Choosing a video profile for a new cloud project, over the engine's copy of
 * the desktop profile table (zenvi-core src/profiles, `@zenvi/engine` PROFILES),
 * so a project stores exactly the `profile` description, size, rate and
 * aspect the desktop would.
 *
 * People and models ask in words ("vertical 1080p 30", "4k 24", "square"), so
 * a request is resolved in this order:
 *   1. an exact profile key or description (a legacy one maps to its current twin);
 *   2. intent words: orientation (vertical/portrait/9:16, square/1:1, 4:5),
 *      resolution (4K/UHD/2160p, 1440p, 1080p/FHD, 720p/HD, 480p/SD, or WxH)
 *      and frame rate (24, 25, 29.97, 30, 50, 59.94, 60 …);
 *   3. otherwise an error listing close profiles — never a guess.
 * Progressive profiles always win; interlaced ones only when asked for
 * ("1080i", "interlaced", or their exact name).
 */

import { type Fraction, findProfile, PROFILES, type Profile } from "@zenvi/engine";

export const PROJECT_FORMATS = ["landscape_1080p", "landscape_720p", "landscape_4k", "vertical_1080p", "square_1080p"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

/** Frame rates the `fps` argument accepts. */
export const PROJECT_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

export const PROFILE_SHORTHANDS =
  'an exact desktop profile name ("FHD Vertical 1080p 30 fps") or words: orientation (vertical, portrait, 9:16, square, 1:1, 4:5, landscape), resolution (4k, 1440p, 1080p, 720p, 480p, or 1920x1080) and frame rate (24, 25, 29.97, 30, 50, 59.94, 60), e.g. "vertical 1080p 30", "square", "4k 24", "720p 60"';

const SIZES: Record<ProjectFormat, { width: number; height: number }> = {
  landscape_1080p: { width: 1920, height: 1080 },
  landscape_720p: { width: 1280, height: 720 },
  landscape_4k: { width: 3840, height: 2160 },
  vertical_1080p: { width: 1080, height: 1920 },
  square_1080p: { width: 1080, height: 1080 },
};

type Orientation = "landscape" | "vertical" | "square" | "portrait45";

/** Frame size for an orientation and a resolution class (the short side). */
const SIZE_FOR: Record<Orientation, Record<number, [number, number]>> = {
  landscape: { 2160: [3840, 2160], 1440: [2560, 1440], 1080: [1920, 1080], 720: [1280, 720], 480: [854, 480] },
  vertical: { 1080: [1080, 1920], 720: [720, 1280] },
  square: { 1080: [1080, 1080], 480: [480, 480] },
  portrait45: { 1080: [1080, 1350] },
};

export type ProfileChoice = { ok: true; profile: Profile } | { ok: false; message: string; suggestions: string[] };

function fpsFraction(value: number): Fraction {
  const rounded = Math.round(value * 1000) / 1000;
  for (const base of [24, 30, 48, 60, 120]) {
    // 23.976 / 23.98, 29.97, 47.952, 59.94, 119.88 are the NTSC x/1.001 rates.
    if (Math.abs(rounded - (base * 1000) / 1001) < 0.01) return { num: base * 1000, den: 1001 };
  }
  return { num: Math.round(value), den: 1 };
}

const sameFps = (a: Fraction, b: Fraction): boolean => a.num * b.den === b.num * a.den;
const fpsValue = (f: Fraction): number => f.num / f.den;

/** Current (non-legacy) profile with the same size, rate and scan, if the table has one. */
function current(profile: Profile): Profile {
  if (!profile.legacy) return profile;
  return (
    PROFILES.find(
      (p) => !p.legacy && p.width === profile.width && p.height === profile.height && p.progressive === profile.progressive && sameFps(p.fps, profile.fps),
    ) ?? profile
  );
}

/** Order candidates: requested scan first, current before legacy, 30 fps before other rates when none was asked for. */
function rank(candidates: Profile[], interlaced: boolean, fps: Fraction | undefined): Profile[] {
  const fpsPreference = [30, 25, 24, 60, 50];
  const score = (p: Profile): number[] => [
    p.progressive === !interlaced ? 0 : 1,
    p.legacy ? 1 : 0,
    fps ? 0 : (fpsPreference.includes(Math.round(fpsValue(p.fps))) ? fpsPreference.indexOf(Math.round(fpsValue(p.fps))) : 9) + (Number.isInteger(fpsValue(p.fps)) ? 0 : 10),
  ];
  return [...candidates].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
    return 0;
  });
}

function orientationOf(p: { width: number; height: number }): Orientation {
  if (p.width === p.height) return "square";
  if (p.height > p.width) return Math.abs(p.height / p.width - 1.25) < 0.01 ? "portrait45" : "vertical";
  return "landscape";
}

/** Close, sensible alternatives for an error message: progressive, current, same orientation first. */
function suggestionsFor(orientation: Orientation | undefined, size: number | undefined, fps: Fraction | undefined): string[] {
  const pool = PROFILES.filter((p) => p.progressive && !p.legacy && Number.isInteger(fpsValue(p.fps)));
  const scored = pool.map((p) => {
    const short = Math.min(p.width, p.height);
    return {
      p,
      score:
        (orientation && orientationOf(p) !== orientation ? 10_000 : 0) +
        (size ? Math.abs(short - size) : Math.abs(short - 1080)) +
        (fps ? Math.abs(fpsValue(p.fps) - fpsValue(fps)) * 10 : Math.abs(fpsValue(p.fps) - 30)),
    };
  });
  scored.sort((a, b) => a.score - b.score);
  const names: string[] = [];
  for (const { p } of scored) {
    if (!names.includes(p.description)) names.push(p.description);
    if (names.length === 5) break;
  }
  return names;
}

function failure(request: string, suggestions: string[], why = "No Zenvi profile matches"): ProfileChoice {
  return {
    ok: false,
    suggestions,
    message: `${why} "${request}". Close profiles: ${suggestions.map((s) => `"${s}"`).join(", ")}. Pass one of them as profile, or describe it like "vertical 1080p 30".`,
  };
}

/** Resolve a profile request (see the module comment). */
export function resolveProfile(request: string): ProfileChoice {
  const text = request.trim();
  if (text === "") return failure(request, suggestionsFor(undefined, undefined, undefined), "Empty profile request");
  const exact = findProfile(text);
  if (exact) return { ok: true, profile: current(exact) };
  const format = PROJECT_FORMATS.find((f) => f === text.toLowerCase());
  if (format) return profileFor(format, 30);

  // "1080p60" / "4k30" are a size and a rate.
  const lower = ` ${text.toLowerCase().replace(/[_,]/g, " ").replace(/(\d{3,4}[pi]|[48]k)(\d{2,3})\b/g, "$1 $2")} `;
  const interlaced = /\b\d{3,4}i\b|interlaced/.test(lower);
  let orientation: Orientation | undefined;
  if (/\b(vertical|portrait|tiktok|reels?|shorts|stor(y|ies))\b|9\s*[:x/]\s*16/.test(lower)) orientation = "vertical";
  if (/\bsquare\b|\b1\s*[:x/]\s*1\b/.test(lower)) orientation = "square";
  if (/\b4\s*[:x/]\s*5\b/.test(lower)) orientation = "portrait45";
  if (/\b(landscape|horizontal|widescreen)\b|16\s*[:x/]\s*9/.test(lower)) orientation ??= "landscape";

  let width: number | undefined;
  let height: number | undefined;
  const explicit = /\b(\d{3,4})\s*[x×*]\s*(\d{3,4})\b/.exec(lower);
  let rest = lower;
  if (explicit) {
    width = Number(explicit[1]);
    height = Number(explicit[2]);
    rest = rest.replace(explicit[0], " ");
  }
  let size: number | undefined;
  const classes: [RegExp, number][] = [
    [/\b(4k|uhd|2160[pi]?)\b/, 2160],
    [/\b(1440[pi]?|qhd|2k)\b/, 1440],
    [/\b(1080[pi]?|fhd|full\s*hd)\b/, 1080],
    [/\b(720[pi]?|hd)\b/, 720],
    [/\b(480[pi]?|sd)\b/, 480],
  ];
  for (const [pattern, value] of classes) {
    const match = pattern.exec(rest);
    if (match) {
      size = value;
      rest = rest.replace(match[0], " ");
      break;
    }
  }
  let fps: Fraction | undefined;
  const withUnit = /(\d{2,3}(?:\.\d+)?)\s*(fps|hz|p)\b/.exec(rest);
  const bare = /\b(23\.976|23\.98|24|25|29\.97|30|48|50|59\.94|60|120)\b/.exec(rest);
  const fpsText = withUnit?.[1] ?? bare?.[1];
  if (fpsText) fps = fpsFraction(Number(fpsText));

  if (!explicit && !orientation && !size && !fps && !interlaced) {
    return failure(request, suggestionsFor(undefined, undefined, undefined));
  }
  if (!explicit) {
    const target = SIZE_FOR[orientation ?? "landscape"][size ?? 1080];
    if (!target) return failure(request, suggestionsFor(orientation ?? "landscape", size, fps));
    [width, height] = target;
  }
  const candidates = PROFILES.filter(
    (p) => p.width === width && p.height === height && (fps === undefined || sameFps(p.fps, fps)) && (interlaced || p.progressive),
  );
  const best = rank(candidates, interlaced, fps)[0];
  if (!best) return failure(request, suggestionsFor(orientation ?? orientationOf({ width: width!, height: height! }), size ?? Math.min(width!, height!), fps));
  return { ok: true, profile: current(best) };
}

/** The profile for a `format` + `fps` pair: progressive and current, or an error with close profiles. */
export function profileFor(format: ProjectFormat, fps: number): ProfileChoice {
  const { width, height } = SIZES[format];
  const wanted = fpsFraction(fps);
  const best = rank(
    PROFILES.filter((p) => p.width === width && p.height === height && p.progressive && sameFps(p.fps, wanted)),
    false,
    wanted,
  )[0];
  if (!best) return failure(`${format} at ${fps} fps`, suggestionsFor(orientationOf({ width, height }), Math.min(width, height), wanted));
  return { ok: true, profile: current(best) };
}
