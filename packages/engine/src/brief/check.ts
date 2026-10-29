/**
 * The edit against its saved brief: the frame it was meant to have, its
 * length, a picture change at every beat boundary, and every borrowed
 * technique on the timeline. The style's finish checklist cannot be read
 * from a project; it comes back as the lines to look for on the contact
 * sheet. review_edit_tool reports all of it; the finish (render receipts,
 * review_render_tool) carries only the hard misses.
 */

import { isAudioOnlyMedia } from "../model/media.js";
import type { Project } from "../model/types.js";
import { isSfxClip } from "../sfx/moments.js";
import { timelineEnd } from "../timeline/queries.js";
import { aspectRatio, type Brief } from "./brief.js";
import { toolUsed } from "./evidence.js";

/** A beat boundary counts as hit when a picture starts this close to it, seconds. */
export const BEAT_TOLERANCE = 0.3;
/** The edit's length may be off its brief by this share (or a second, whichever is more). */
const LENGTH_TOLERANCE = 0.15;
/** Width:height may be off the brief's aspect by this share. */
const ASPECT_TOLERANCE = 0.02;

export type TechniqueStatus = "used" | "missing" | "unverified";

export interface BriefTechniqueCheck {
  id: string;
  status: TechniqueStatus;
  /** The tools whose mark was looked for. */
  tools: string[];
}

export interface BriefBeatCheck {
  name: string;
  start: number;
  /** A picture starts within BEAT_TOLERANCE of the beat (the first beat always counts). */
  hit: boolean;
}

export type BriefMissKind = "format" | "length" | "beats" | "techniques";

export interface BriefMiss {
  kind: BriefMissKind;
  message: string;
  /** Hard misses go into the finish; the rest stay in review_edit_tool. */
  hard: boolean;
}

export interface BriefCheck {
  style: string;
  lengthSeconds: number;
  beats: BriefBeatCheck[];
  techniques: BriefTechniqueCheck[];
  /** The style's finish checklist: look for each on the contact sheet. */
  checklist: string[];
  misses: BriefMiss[];
  /** No miss at all. */
  ok: boolean;
}

/** Where pictures start on the timeline: every cut, title, block and scene. */
function pictureStarts(project: Project): number[] {
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  return project.clips
    .filter((c) => !isSfxClip(c) && c.reader?.has_video !== false && !isAudioOnlyMedia(files.get(String(c.file_id)) ?? c.reader))
    .map((c) => Number(c.position) || 0);
}

/** Check `project` against `brief`. */
export function checkBrief(project: Project, brief: Brief): BriefCheck {
  const misses: BriefMiss[] = [];

  const wanted = aspectRatio(brief.aspect);
  const actual = project.width / Math.max(1, project.height);
  if (Math.abs(actual - wanted) / wanted > ASPECT_TOLERANCE) {
    misses.push({ kind: "format", hard: true, message: `The brief is ${brief.aspect} but the project is ${project.width}x${project.height}: set_project_setting_tool width and height before cutting.` });
  }

  const end = timelineEnd(project);
  if (Math.abs(end - brief.length_seconds) > Math.max(1, brief.length_seconds * LENGTH_TOLERANCE)) {
    const fill = end < brief.length_seconds ? ` Fill it (fill_to_length_tool seconds=${brief.length_seconds}: a longer final hold, unseen footage, a slowed last shot) rather than ship it short.` : "";
    misses.push({ kind: "length", hard: true, message: `The brief is ${brief.length_seconds} s and the edit runs ${end.toFixed(1)} s.${fill}` });
  }

  const starts = pictureStarts(project);
  const beats = brief.beats.map((b, i) => ({ name: b.name, start: b.start, hit: i === 0 || b.start <= 0 || starts.some((s) => Math.abs(s - b.start) <= BEAT_TOLERANCE) }));
  const missed = beats.filter((b) => !b.hit);
  if (missed.length > 0) {
    misses.push({
      kind: "beats",
      // Most of the structure gone is a different edit, not a late cut.
      hard: missed.length * 2 > beats.length,
      message: `No picture change at ${missed.length} of the brief's ${beats.length} beats: ${missed.map((b) => `${b.name} @${b.start}s`).join(", ")}.`,
    });
  }

  const techniques = brief.techniques.map((t): BriefTechniqueCheck => {
    const tools = t.tools ?? [];
    const seen = tools.map((tool) => toolUsed(project, tool));
    // Missing only when every tool leaves a readable mark and none did: an unreadable tool may have built it.
    const status: TechniqueStatus = seen.some((s) => s === true) ? "used" : seen.length > 0 && seen.every((s) => s === false) ? "missing" : "unverified";
    return { id: t.id, status, tools };
  });
  const absent = techniques.filter((t) => t.status === "missing");
  if (absent.length > 0) {
    misses.push({
      kind: "techniques",
      hard: true,
      message: `The brief borrows ${absent.map((t) => `${t.id} (${t.tools.join(" or ")})`).join(", ")} and the timeline shows none of it: build it, or save_brief_tool without it if the edit is better that way.`,
    });
  }

  return { style: brief.style, lengthSeconds: brief.length_seconds, beats, techniques, checklist: brief.checklist, misses, ok: misses.length === 0 };
}
