/**
 * The brief produce_video_tool saves when the project has none: the
 * request's own facts (request.ts) and the routed style's defaults
 * (route.ts), in the shape save_brief_tool keeps (brief/brief.ts). It is a
 * minimal brief, not a motif plan: review and the finish check the edit
 * against its frame, length and beats, and an agent that wants the full
 * method saves its own with save_brief_tool, which replaces it.
 *
 * Bench rounds 6-7: refusing work until a brief was saved made agents write
 * placeholder briefs (2.1 save_brief_tool errors a run) and changed nothing
 * in the edit; a brief the director compiles costs no call.
 */

import { BRIEF_ASPECTS, briefSchema, type Brief, type BriefAspect } from "../brief/brief.js";
import type { RequestFacts } from "./request.js";
import type { Route } from "./route.js";

/** The longest goal a brief holds (brief.ts `goal`). */
const GOAL_CHARS = 300;

/** The brief aspect nearest a frame. */
export function nearestAspect(width: number, height: number): BriefAspect {
  const ratio = width / Math.max(1, height);
  let best: BriefAspect = BRIEF_ASPECTS[0];
  for (const aspect of BRIEF_ASPECTS) {
    const [w, h] = aspect.split(":").map(Number) as [number, number];
    const [bw, bh] = best.split(":").map(Number) as [number, number];
    if (Math.abs(Math.log(ratio / (w / h))) < Math.abs(Math.log(ratio / (bw / bh)))) best = aspect;
  }
  return best;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface AutoBriefInput {
  request: string;
  facts: RequestFacts;
  route: Route;
  aspect: BriefAspect;
  seconds: number;
  /** What the builder needs that nobody gave (route fallback, a missing product name). */
  missing: readonly string[];
}

/** The minimal brief for a request, validated like save_brief_tool's input. */
export function compileBrief(input: AutoBriefInput): Brief {
  const { facts, route, seconds } = input;
  const rule = route.rule;
  const at = (share: number) => Math.round(share * seconds * 10) / 10;
  const beats = rule.beats.map(([name, from, to, does]) => ({ name, start: at(from), end: Math.max(at(to), at(from) + 0.1), does }));
  const firstSentence = input.request.split(/(?<=[.!?])\s|\n/)[0] ?? input.request;
  const bpm = facts.bpm ?? rule.music.bpm;
  return briefSchema.parse({
    goal: clip(firstSentence, GOAL_CHARS),
    platform: facts.platform ?? (input.aspect === "9:16" ? "Reels" : "YouTube"),
    aspect: input.aspect,
    length_seconds: seconds,
    style: rule.id,
    hook: clip(facts.headline ? `"${facts.headline}" over the first shot, on the first hit at 0.0 s` : `${beats[0]?.does ?? "the strongest image"}`, 300),
    beats,
    music: clip(`${facts.musicQuery ?? rule.music.query}, about ${bpm} BPM, ${rule.music.energy} energy`, 300),
    sound: clip(`${rule.sound} palette, ${rule.intensity}: a sound on the cuts and moves, mastered to -14 LUFS`, 300),
    ...(facts.url ? { end_card: facts.url } : {}),
    critique: clip(
      `Compiled by produce_video_tool from the request: style ${rule.id} (${route.why}).${route.fallback ? ` Its builder ${route.fallback.wanted} could not run (${route.fallback.why}).` : ""} A minimal brief; save_brief_tool replaces it with a full plan.`,
      800,
    ),
    missing: input.missing.slice(0, 8).map((m) => clip(m, 200)),
  });
}
