/**
 * The finishing checks cinetic runs on every film (MIT, (c) 2026 Leonxlnx:
 * measure-speed, av-audit, layout-audit, grid-check's text flow, lint-film's
 * hard bans), on the open project: how fast things move, whether every
 * sound has a visible cause, text that overlaps text, and, for a cinetic
 * house style, the copy's pacing and the house bans (not when the person
 * gave a brand: theirs wins). review_edit_tool and review_render_tool list
 * them with their own problems.
 */

import type { Brief } from "../brief/brief.js";
import { houseStyle, tasteProfile } from "../brief/house.js";
import type { Project } from "../model/types.js";
import { fpsFloat } from "../timeline/time.js";
import { sfxHits, syncMisses, timelineCauses } from "./av-sync.js";
import { copyPacing, type CopyFragment } from "./copy-pacing.js";
import { BLUR_PX_PER_FRAME, CEILING_PX_PER_FRAME, clipSpeeds, TEXT_PX_PER_FRAME } from "./motion-speed.js";
import { houseBanFindings } from "./taste.js";
import type { ReviewProblem, TextBox } from "./types.js";

/** Tag add_kinetic_title_tool puts on each word clip of one title (tools/catalog/kinetic-titles.ts KINETIC_TITLE_KEY). */
const KINETIC_TITLE_KEY = "zenvi_kinetic_title";
const KINETIC_CAPTIONS_KEY = "zenvi_kinetic_captions";
/** Boxes overlapping by more than this share of the smaller one collide. */
const OVERLAP_SHARE = 0.25;
/** A keystroke's title starting this soon after the last one ends continues its line. */
const TYPED_GAP_SECONDS = 0.05;

export interface FilmCheckInput {
  project: Project;
  brief: Brief | null;
  /** Title clips on the timeline (review/timeline.ts titleClips). */
  titles: readonly { clipId: string; start: number; end: number }[];
  /** SVG of the titles the host could read, by clip id. */
  svgs: ReadonlyMap<string, string>;
  textBoxes: readonly TextBox[];
}

function svgWords(svg: string): string {
  return [...svg.matchAll(/<(?:tspan|text)\b[^>]*>([^<]*)/gi)].map((m) => m[1]!).join(" ").replace(/\s+/g, " ").trim();
}

/** One fragment per title on screen: a title clip, or the word clips of one kinetic title (grouped while they overlap). */
export function copyFragments(project: Project, titles: FilmCheckInput["titles"], svgs: ReadonlyMap<string, string>): CopyFragment[] {
  const clips = new Map(project.clips.map((c) => [String(c.id), c]));
  const out: CopyFragment[] = [];
  const groups = new Map<string, CopyFragment>();
  let typing: { fragment: CopyFragment; line: string } | null = null;
  for (const t of [...titles].sort((a, b) => a.start - b.start)) {
    const clip = clips.get(t.clipId);
    if (!clip || clip[KINETIC_CAPTIONS_KEY]) continue;
    const tag = clip[KINETIC_TITLE_KEY] as { text?: unknown } | undefined;
    if (tag && typeof tag.text === "string") {
      const open = groups.get(tag.text);
      if (open && t.start <= open.end + 1e-6) {
        open.end = Math.max(open.end, t.end);
        continue;
      }
      const f = { id: t.clipId, text: tag.text, start: t.start, end: t.end };
      groups.set(tag.text, f);
      out.push(f);
      continue;
    }
    const svg = svgs.get(t.clipId);
    const text = svg ? svgWords(svg) : "";
    if (!text) continue;
    // A line typed on (one title per keystroke, the cursor last) is one fragment while it grows.
    const line = text.replace(/\s*[|▌_]+$/u, "");
    if (typing && t.start <= typing.fragment.end + TYPED_GAP_SECONDS && line.startsWith(typing.line)) {
      typing.fragment.end = Math.max(typing.fragment.end, t.end);
      typing.fragment.text = line;
      typing.line = line;
      continue;
    }
    const f = { id: t.clipId, text: line, start: t.start, end: t.end };
    typing = { fragment: f, line };
    out.push(f);
  }
  return out;
}

const list = (xs: readonly string[], n = 4): string => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");

export function filmChecks(input: FilmCheckInput): ReviewProblem[] {
  const { project, brief } = input;
  const out: ReviewProblem[] = [];
  const titleIds = new Set(input.titles.map((t) => t.clipId));

  const speeds = clipSpeeds(project, titleIds);
  const ceiling = speeds.filter((s) => !s.text && s.peak > CEILING_PX_PER_FRAME);
  if (ceiling.length > 0) out.push({ code: "motion-too-fast", severity: "medium", at: ceiling[0]!.at, times: ceiling.map((s) => s.at), message: `Moves faster than ${CEILING_PX_PER_FRAME} px/f (1080p, 60 fps) smear into stepped copies: ${list(ceiling.map((s) => `${s.clipId} ${s.peak} px/f at ${s.at}s`))}.`, fix: "Redesign the move as a cut on the beat, a match cut, a mask wipe or a shorter distance (frame-filling edges excepted)." });
  const fastText = speeds.filter((s) => s.text && s.peak > TEXT_PX_PER_FRAME);
  if (fastText.length > 0) out.push({ code: "text-too-fast", severity: "medium", at: fastText[0]!.at, times: fastText.map((s) => s.at), message: `Text travelling faster than ${TEXT_PX_PER_FRAME} px/f reads as a double image: ${list(fastText.map((s) => `${s.clipId} ${s.peak} px/f`))}.`, fix: "Fly it with the text faded and let it resolve on landing, or shorten the travel." });
  const blur = speeds.filter((s) => s.peak > BLUR_PX_PER_FRAME && !s.blurred && !ceiling.includes(s) && !fastText.includes(s));
  if (blur.length > 0) out.push({ code: "needs-motion-blur", severity: "low", at: blur[0]!.at, times: blur.map((s) => s.at), message: `${blur.length} move${blur.length === 1 ? "" : "s"} over ${BLUR_PX_PER_FRAME} px/f strobe without motion blur: ${list(blur.map((s) => `${s.clipId} ${s.peak} px/f`))}.`, fix: "Bake motion blur on those clips (apply_fx_tool directional_blur or radial_blur on the move's frames), or slow the move." });

  const rate = fpsFloat(project.fps);
  const misses = syncMisses(sfxHits(project), timelineCauses(project), rate > 0 ? 1 / rate : 1 / 30);
  if (misses.length > 0)
    out.push({
      code: "sound-without-cause",
      severity: "low",
      at: misses[0]!.time,
      times: misses.map((m) => m.time),
      message: `${misses.length} sound effect${misses.length === 1 ? " hits" : "s hit"} more than a frame from anything that changes on screen: ${list(misses.map((m) => `${m.recipe} at ${m.time.toFixed(2)}s${m.offset === null ? "" : ` (nearest ${m.offset > 0 ? "+" : ""}${m.offset.toFixed(2)}s)`}`))}.`,
      fix: "Move each sound onto the frame its cause lands (a cut, the clip's arrival, a keyframe), or remove it: every hit has a visible cause.",
    });

  const spans = new Map(input.titles.map((t) => [t.clipId, t]));
  const collisions: string[] = [];
  for (let i = 0; i < input.textBoxes.length; i += 1) {
    for (let j = i + 1; j < input.textBoxes.length; j += 1) {
      const a = input.textBoxes[i]!;
      const b = input.textBoxes[j]!;
      const sa = spans.get(a.clipId);
      const sb = spans.get(b.clipId);
      if (a.clipId === b.clipId || !sa || !sb || !(sa.start < sb.end && sb.start < sa.end)) continue;
      const clipA = project.clips.find((c) => String(c.id) === a.clipId);
      const clipB = project.clips.find((c) => String(c.id) === b.clipId);
      // The word clips of one kinetic title sit side by side by design.
      if (clipA?.[KINETIC_TITLE_KEY] && clipB?.[KINETIC_TITLE_KEY]) continue;
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (w > 0 && h > 0 && smaller > 0 && (w * h) / smaller > OVERLAP_SHARE) collisions.push(`${a.clipId} and ${b.clipId} at ${Math.max(sa.start, sb.start).toFixed(1)}s`);
    }
  }
  if (collisions.length > 0) out.push({ code: "text-overlap", severity: "medium", at: 0, message: `Text lands on text: ${list(collisions)}.`, fix: "Move one title (set_clip_property_tool location_y) or let one clear before the next arrives." });

  if (brief && houseStyle(brief.style)) {
    const pace = brief.draw?.energy === "high" ? "crisp" : "calm";
    const end = Math.max(brief.length_seconds, ...project.clips.map((c) => c.position + (c.end - c.start)));
    for (const issue of copyPacing(copyFragments(project, input.titles, input.svgs), end, pace)) {
      out.push({ code: issue.code, severity: issue.code === "copy-fragment-long" || issue.code === "copy-crowded" ? "medium" : "low", at: issue.at, ...(issue.until !== undefined ? { until: issue.until } : {}), message: `${issue.message} (${brief.style}, ${pace} copy)`, fix: issue.fix });
    }
  }
  if (brief && tasteProfile(brief)) {
    for (const f of houseBanFindings({ project, svgs: input.svgs, textBoxes: input.textBoxes })) {
      out.push({ code: `house-ban-${f.ban}`, severity: "medium", at: f.at, message: `${f.message} (${brief.style} house ban; a brand of the person's would win: save_brief_tool brand)`, fix: f.fix });
    }
  }
  return out;
}
