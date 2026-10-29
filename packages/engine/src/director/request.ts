/**
 * What a person's request says outright, read without a model: the length,
 * the frame, the tempo, the names in quotes, a URL and the searches it
 * suggests. produce_video_tool fills its brief from these and leaves what
 * the request does not say to the style's defaults; facts it cannot read
 * (a product's name, its features) go to the brief's `missing`, never made up.
 */

import type { BriefAspect } from "../brief/brief.js";

export interface RequestFacts {
  seconds: number | null;
  aspect: BriefAspect | null;
  /** Frame size the request names ("1920x1080"). */
  size: { width: number; height: number } | null;
  bpm: number | null;
  /** Frame rate the request names ("25 fps"). */
  fps: number | null;
  /** The request rules out stock footage ("use this footage only", "no stock"). */
  noStock: boolean;
  /** The name after "called" / "named" / "titled", else null. */
  name: string | null;
  /** A headline, hook or title line in quotes. */
  headline: string | null;
  url: string | null;
  /** Quoted phrases that read like searches (stock footage ideas), in order. */
  searches: string[];
  /** A quoted music search ("music: '...'", "freesound search: '...'"). */
  musicQuery: string | null;
  /** The platform it is for. */
  platform: string | null;
  /** A few words of what the video is about, for stock searches when it suggests none. */
  subject: string;
}

const QUOTED = /['"‘“]([^'"’”\n]{2,90})['"’”]/g;
const STOP = new Set(
  "a an the of for to and or with in on at by from about into over under is are be it its this that these those make made create video edit reel promo clip film second seconds sec s long short vertical landscape square deliver mp4 please some one two three four five my our your their me us like style fps".split(" "),
);
const PLATFORMS: readonly [RegExp, string][] = [
  [/\btik ?tok\b/i, "TikTok"],
  [/\breels?\b|\binstagram\b/i, "Reels"],
  [/\bshorts\b/i, "YouTube Shorts"],
  [/\byoutube\b/i, "YouTube"],
  [/\blinkedin\b/i, "LinkedIn"],
];

function aspectOf(request: string): BriefAspect | null {
  const ratio = request.match(/\b(9:16|16:9|1:1|4:5)\b/);
  if (ratio) return ratio[1] as BriefAspect;
  if (/\b(vertical|portrait)\b/i.test(request)) return "9:16";
  if (/\bsquare\b/i.test(request)) return "1:1";
  if (/\b(landscape|widescreen)\b/i.test(request)) return "16:9";
  return null;
}

function secondsOf(request: string): number | null {
  const minutes = request.match(/\b(\d+(?:\.\d+)?)[- ]?(?:minutes?|mins?)\b/i);
  if (minutes) return Math.round(Number(minutes[1]) * 60);
  const seconds = request.match(/\b(\d+(?:\.\d+)?)[- ]?(?:seconds?|secs?|s)\b/i);
  const n = seconds ? Number(seconds[1]) : NaN;
  return Number.isFinite(n) && n >= 2 && n <= 600 ? n : null;
}

/** Facts stated in `request`. */
export function readRequest(request: string): RequestFacts {
  const quoted = [...request.matchAll(QUOTED)].map((m) => ({ text: m[1]!.trim(), at: m.index ?? 0 }));
  const before = (at: number) => request.slice(Math.max(0, at - 40), at).toLowerCase();
  const named = quoted.find((q) => /\b(called|named|titled|brand|for)\s*$/.test(before(q.at)));
  const headline = quoted.find((q) => /\b(headline|hook|title|tagline|line|says?|reads?)\b[^'"‘“]*$/.test(before(q.at)) && q !== named);
  const music = quoted.find((q) => /\b(music|song|track|freesound)\b[^.]*$/.test(before(q.at)) || /\bbpm\b/i.test(q.text));
  const searches = quoted
    .filter((q) => q !== named && q !== headline && q !== music && q.text.split(/\s+/).length >= 2 && !/[A-Z]{2,}/.test(q.text))
    .filter((q) => /\b(search|searches|stock|footage|pexels|b-?roll|shots?)\b/.test(before(q.at)) || /;\s*$/.test(request.slice(Math.max(0, q.at - 3), q.at)))
    .map((q) => q.text);
  const size = request.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  const bpm = request.match(/\b(\d{2,3})\s*bpm\b/i);
  const fps = request.match(/\b(\d{2,3}(?:\.\d+)?)\s*fps\b/i);
  const url = request.match(/\b((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|ai|app|co|dev|pro|org|net)(?:\/\S*)?)\b/i);
  const firstSentence = request.split(/[.\n]/)[0] ?? request;
  const subject = firstSentence
    .replace(QUOTED, " ")
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 5)
    .join(" ");
  return {
    seconds: secondsOf(request),
    aspect: aspectOf(request),
    size: size ? { width: Number(size[1]), height: Number(size[2]) } : null,
    bpm: bpm ? Number(bpm[1]) : null,
    fps: fps ? Number(fps[1]) : null,
    noStock: /\bno stock\b|\b(this|the given|my|our) (footage|shots|media) only\b|\buse only (the|this|my)\b|\bonly (the|this) (footage|shots|media)\b/i.test(request),
    name: named?.text ?? null,
    headline: headline?.text ?? null,
    url: url ? url[1]! : null,
    searches: [...new Set(searches)].slice(0, 6),
    musicQuery: music ? music.text.replace(/\b\d{2,3}\s*bpm\b/i, "").trim() || null : null,
    platform: PLATFORMS.find(([re]) => re.test(request))?.[1] ?? null,
    subject,
  };
}
