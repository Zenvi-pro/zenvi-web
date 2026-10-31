/**
 * The minimal brief Zenvi saves by itself. Rounds 6-7 of the motion bench
 * (fleet w61-bench7) found the brief gate was most of the agents' tool
 * errors: they wrote placeholder briefs to get past it and cost per run went
 * up a third. So nothing waits for a brief any more: the first call that
 * starts a video on a project without one saves this (the style the
 * request's words match in the styles index, the project's frame, the
 * timeline's length or a 15 s default, one beat) outside the undo history,
 * and its receipt says so. A brief the agent saves replaces it; checks
 * against it only advise (`auto`, check.ts).
 */

import type { ProjectDocument } from "../history/document.js";
import type { Project } from "../model/types.js";
import { timelineEnd } from "../timeline/queries.js";
import { aspectRatio, BRIEF_ASPECTS, BRIEF_KEY, readBrief, type Brief, type BriefAspect } from "./brief.js";

/** Length of an auto brief when the timeline is still empty: a social reel. */
export const AUTO_LENGTH_SECONDS = 15;
/** The style when no word matches: the most asked-for shape on the bench and the platforms. */
export const AUTO_DEFAULT_STYLE = "hype-reel";

/** Words that point at the seeded styles (the director recipes), beyond their own summaries. */
const STYLE_WORDS: Readonly<Record<string, readonly string[]>> = {
  "hype-reel": ["hype", "sport", "sports", "car", "cars", "trailer", "launch", "event", "energy", "fast", "song", "beat", "teaser"],
  "match-cut-montage": ["match", "shape", "shapes", "circle", "circles", "pose", "align"],
  "flash-montage": ["flash", "evolution", "frames", "strobe"],
  "kinetic-captions": ["talking", "captions", "caption", "speaker", "podcast", "interview", "testimonial"],
  documentary: ["documentary", "essay", "story", "voice-over", "voiceover", "narration", "explainer", "history"],
  "saas-ui-promo": ["app", "saas", "software", "dashboard", "ui", "startup", "ai", "tool"],
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

/**
 * Every style's score for `text` and the words that scored: the seeded
 * styles' words count three, a word of any style's id or summary in
 * `candidates` (the styles index) one.
 */
export function styleScores(text: string, candidates: readonly { id: string; summary: string }[] = []): Map<string, { score: number; words: string[] }> {
  const said = new Set(words(text));
  const scores = new Map<string, { score: number; words: string[] }>();
  for (const [id, list] of Object.entries(STYLE_WORDS)) {
    const hit = list.filter((w) => said.has(w));
    scores.set(id, { score: hit.length * 3, words: hit });
  }
  for (const c of candidates) {
    const hit = [...new Set(words(`${c.id.replace(/-/g, " ")} ${c.summary}`).filter((w) => said.has(w)))];
    const prev = scores.get(c.id) ?? { score: 0, words: [] };
    scores.set(c.id, { score: prev.score + hit.length, words: [...new Set([...prev.words, ...hit])] });
  }
  return scores;
}

/** The style `text` points at (styleScores' best; the default when no word matches). */
export function matchStyle(text: string, candidates: readonly { id: string; summary: string }[] = []): string {
  let best = AUTO_DEFAULT_STYLE;
  let top = 0;
  for (const [id, { score }] of styleScores(text, candidates)) if (score > top) [best, top] = [id, score];
  return best;
}

/** The brief aspect nearest the project's frame. */
export function nearestAspect(project: Project): BriefAspect {
  const ratio = project.width / Math.max(1, project.height);
  return BRIEF_ASPECTS.reduce((a, b) => (Math.abs(aspectRatio(b) - ratio) < Math.abs(aspectRatio(a) - ratio) ? b : a));
}

const PLATFORM: Record<BriefAspect, string> = { "9:16": "Reels / TikTok / Shorts", "16:9": "YouTube / web", "1:1": "Instagram feed", "4:5": "Instagram feed" };

/** A minimal brief for `project` from what is known: the words of the request so far, the frame, the timeline. */
export function autoBrief(project: Project, text = "", candidates: readonly { id: string; summary: string }[] = []): Brief {
  const aspect = nearestAspect(project);
  const end = timelineEnd(project);
  const length = Math.round((end >= 1 ? end : AUTO_LENGTH_SECONDS) * 10) / 10;
  return {
    goal: "Not given yet: refine with save_brief_tool.",
    platform: PLATFORM[aspect],
    aspect,
    length_seconds: length,
    style: matchStyle(text, candidates),
    techniques: [],
    hook: "The strongest shot first, with motion and sound from frame 1.",
    beats: [{ start: 0, end: length, name: "whole piece" }],
    shots: [],
    motifs: [],
    storyboard: [],
    direction: [],
    checklist: [],
    missing: [],
    auto: true,
  };
}

/**
 * Save an auto brief on `doc` when it has no brief, outside the undo history
 * (the call that triggered it keeps its own one step), and keep an existing
 * auto brief's frame and length in step with the project. Returns the brief
 * when this call saved it, else null (a brief already there, the agent's or
 * an auto one).
 */
export function ensureBrief(doc: ProjectDocument, text = "", candidates: readonly { id: string; summary: string }[] = []): Brief | null {
  const current = readBrief(doc.project);
  if (current && !current.auto) return null;
  const fresh = autoBrief(doc.project, text, candidates);
  const brief = current ? { ...current, aspect: fresh.aspect, platform: fresh.platform, length_seconds: fresh.length_seconds, beats: fresh.beats } : fresh;
  if (current && JSON.stringify(current) === JSON.stringify(brief)) return null;
  doc.setUntracked(["settings"], { ...(doc.project.settings ?? {}), [BRIEF_KEY]: brief });
  return current ? null : brief;
}
