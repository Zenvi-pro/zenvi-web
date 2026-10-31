/**
 * The minimal brief Zenvi saves by itself. Rounds 6-7 of the motion bench
 * (fleet w61-bench7) found the brief gate was most of the agents' tool
 * errors: they wrote placeholder briefs to get past it and cost per run went
 * up a third. So nothing waits for a brief any more: the first call that
 * starts a video on a project without one saves this (the style the
 * request's words match in the styles index, the project's frame, the
 * timeline's length or a 15 s default, one beat) outside the undo history,
 * and its receipt says so. A brief the agent saves replaces it; checks
 * against it only advise (`auto`, check.ts). produce_video_tool saves the
 * same auto brief with what it read of the whole request (a plan: the routed
 * style, the length, the hook, the music).
 */

import type { ProjectDocument } from "../history/document.js";
import type { Project } from "../model/types.js";
import { timelineEnd } from "../timeline/queries.js";
import { aspectRatio, BRIEF_ASPECTS, BRIEF_KEY, readBrief, type Brief, type BriefAspect } from "./brief.js";

/** Length of an auto brief when the timeline is still empty: a social reel. */
export const AUTO_LENGTH_SECONDS = 15;
/** The style when no word matches: the most asked-for shape on the bench and the platforms. */
export const AUTO_DEFAULT_STYLE = "hype-reel";

/**
 * Words that point at the seeded styles (the director recipes and the styles
 * the director's router cuts with their own builder, director/route.ts),
 * beyond their own summaries.
 */
const STYLE_WORDS: Readonly<Record<string, readonly string[]>> = {
  "hype-reel": ["hype", "sport", "sports", "car", "cars", "event", "energy", "fast", "song", "beat", "highlights", "gaming"],
  "movie-game-trailer": ["trailer", "teaser", "braam", "braams"],
  "product-launch-film": ["launch", "launching", "promo", "commercial", "ad", "ads"],
  "travel-cinematic-montage": ["travel", "trip", "city", "destination", "cinematic", "moody", "wedding"],
  "match-cut-montage": ["match", "shape", "shapes", "circle", "circles", "pose", "align"],
  "flash-montage": ["flash", "evolution", "frames", "strobe"],
  "kinetic-captions": ["talking", "captions", "caption", "speaker", "podcast", "interview", "testimonial"],
  documentary: ["documentary", "essay", "story", "voice-over", "voiceover", "narration", "explainer", "history"],
  "saas-ui-promo": ["app", "saas", "software", "dashboard", "ui", "startup", "ai", "tool", "platform", "glass"],
  "3d-product-ad": ["product", "3d", "device", "bottle", "packshot", "spin"],
  "editorial-type": ["type", "typography", "editorial", "brand", "fashion", "design"],
  "grid-montage": ["grid", "split", "tiles", "panels", "collage"],
  tutorial: ["tutorial", "how-to", "howto", "tips", "steps", "recipe", "breakdown"],
  "showreel-intro": ["showreel", "intro", "portfolio", "studio", "about"],
};

const STOP = new Set(["the", "and", "for", "with", "a", "an", "of", "to", "in", "on", "it", "is", "my", "your", "this", "that", "from", "one", "use", "when", "into"]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 1 && !STOP.has(w));
}

export interface StyleMatch {
  /** The style id; AUTO_DEFAULT_STYLE when no word matched. */
  id: string;
  /** The request's words that picked it (empty for the default). */
  words: string[];
  /** Every style that scored, best first (ties: the earlier seeded style). */
  ranked: { id: string; score: number; words: string[] }[];
}

/**
 * The style `text` points at: the seeded styles' words count three, a word
 * of any style's id or summary in `candidates` (the styles index) one; on a
 * tie the earlier seeded style wins.
 */
export function styleMatch(text: string, candidates: readonly { id: string; summary: string }[] = []): StyleMatch {
  const said = new Set(words(text));
  const hits = new Map<string, string[]>();
  const score = new Map<string, number>();
  for (const [id, list] of Object.entries(STYLE_WORDS)) {
    const found = list.filter((w) => said.has(w));
    hits.set(id, found);
    score.set(id, found.length * 3);
  }
  for (const c of candidates) {
    const found = [...new Set(words(`${c.id.replace(/-/g, " ")} ${c.summary}`).filter((w) => said.has(w)))];
    hits.set(c.id, [...new Set([...(hits.get(c.id) ?? []), ...found])]);
    score.set(c.id, (score.get(c.id) ?? 0) + found.length);
  }
  const ranked = [...score].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, score: n, words: hits.get(id) ?? [] }));
  const best = ranked[0];
  return best ? { id: best.id, words: best.words, ranked } : { id: AUTO_DEFAULT_STYLE, words: [], ranked };
}

/** The style id `text` points at (styleMatch). */
export function matchStyle(text: string, candidates: readonly { id: string; summary: string }[] = []): string {
  return styleMatch(text, candidates).id;
}

/** The brief aspect nearest a frame (the project's, or a size the request names). */
export function nearestAspect(frame: { width: number; height: number }): BriefAspect {
  const ratio = frame.width / Math.max(1, frame.height);
  return BRIEF_ASPECTS.reduce((a, b) => (Math.abs(aspectRatio(b) - ratio) < Math.abs(aspectRatio(a) - ratio) ? b : a));
}

const PLATFORM: Record<BriefAspect, string> = { "9:16": "Reels / TikTok / Shorts", "16:9": "YouTube / web", "1:1": "Instagram feed", "4:5": "Instagram feed" };

/**
 * What a caller that read the whole request knows beyond its words
 * (produce_video_tool: the routed style, the asked length and frame, a
 * quoted headline, the music it will fetch). Each field given replaces the
 * auto brief's guess; the brief stays auto, one beat.
 */
export interface AutoBriefPlan {
  style?: string;
  aspect?: BriefAspect;
  length_seconds?: number;
  goal?: string;
  platform?: string;
  hook?: string;
  music?: string;
  sound?: string;
  end_card?: string;
  missing?: string[];
}

/** A minimal brief for `project` from what is known: the words of the request so far, the frame, the timeline, a caller's plan. */
export function autoBrief(project: Project, text = "", candidates: readonly { id: string; summary: string }[] = [], plan: AutoBriefPlan = {}): Brief {
  const aspect = plan.aspect ?? nearestAspect(project);
  const end = timelineEnd(project);
  const length = Math.round((plan.length_seconds ?? (end >= 1 ? end : AUTO_LENGTH_SECONDS)) * 10) / 10;
  return {
    goal: plan.goal ?? "Not given yet: refine with save_brief_tool.",
    platform: plan.platform ?? PLATFORM[aspect],
    aspect,
    length_seconds: length,
    style: plan.style ?? matchStyle(text, candidates),
    techniques: [],
    hook: plan.hook ?? "The strongest shot first, with motion and sound from frame 1.",
    beats: [{ start: 0, end: length, name: "whole piece" }],
    shots: [],
    motifs: [],
    storyboard: [],
    direction: [],
    checklist: [],
    ...(plan.music ? { music: plan.music } : {}),
    ...(plan.sound ? { sound: plan.sound } : {}),
    ...(plan.end_card ? { end_card: plan.end_card } : {}),
    missing: plan.missing ?? [],
    auto: true,
  };
}

/**
 * Save an auto brief on `doc` when it has no brief, outside the undo history
 * (the call that triggered it keeps its own one step), and keep an existing
 * auto brief's frame and length in step with the project. With a `plan` (a
 * caller that read the whole request) an existing auto brief is redrawn from
 * it. Returns the brief when this call saved it (or, with a plan, redrew
 * it), else null (a brief already there, the agent's or an auto one).
 */
export function ensureBrief(doc: ProjectDocument, text = "", candidates: readonly { id: string; summary: string }[] = [], plan?: AutoBriefPlan): Brief | null {
  const current = readBrief(doc.project);
  if (current && !current.auto) return null;
  const fresh = autoBrief(doc.project, text, candidates, plan);
  const brief = current && !plan ? { ...current, aspect: fresh.aspect, platform: fresh.platform, length_seconds: fresh.length_seconds, beats: fresh.beats } : fresh;
  if (current && JSON.stringify(current) === JSON.stringify(brief)) return null;
  doc.setUntracked(["settings"], { ...(doc.project.settings ?? {}), [BRIEF_KEY]: brief });
  return current && !plan ? null : brief;
}
