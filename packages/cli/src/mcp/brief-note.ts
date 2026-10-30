/**
 * The brief, where agents look: the receipts of the calls that start a whole
 * video. Bench sk0's first runs read the director card and the recipe and
 * still cut without one, so for rounds 6-7 those calls were refused until a
 * brief was saved; that made the gate most of the agents' tool errors (2.1
 * save_brief_tool refusals, 0.8 gather and 0.8 import refusals a run), agents
 * wrote placeholder briefs to pass it and the edits did not improve.
 *
 * Now nothing is refused: once the first call that lays down material on an
 * unplanned project has changed it, a minimal brief (the director's, from
 * that call's arguments and the bin: director/brief.ts) is saved in its own
 * undo step (a refused or failed call saves none), and the
 * receipt says so and points at produce_video_tool, which compiles one from
 * the request and makes the whole edit. ZENVI_MCP_BRIEF=off turns it off.
 */

import { minimalBrief, readBrief, type Brief, type Project } from "@zenvi/engine";

/** Calls that gather or lay down the material of a whole video. */
const STARTS_A_VIDEO = new Set([
  "set_project_setting_tool",
  "gather_stock_footage_tool",
  "import_stock_media_tool",
  "search_pexels_videos_tool",
  "search_freesound_music_tool",
  "import_files_tool",
  "add_clip_to_timeline_tool",
  "add_clips_to_timeline_tool",
  "match_cut_montage_tool",
  "build_reel_tool",
  "add_motion_block_tool",
  "add_motion_template_tool",
  "add_3d_scene_tool",
  "generate_image_and_add_to_timeline_tool",
  "generate_video_and_add_to_timeline_tool",
  "generate_broll_set_tool",
  "generate_tts_and_add_to_timeline_tool",
]);

/** Past this many clips the edit is under way: a brief now would describe it, not plan it. */
const EARLY_CLIPS = 3;

export const BRIEF_NOTE =
  "No brief saved: for a whole video call produce_video_tool {request: the person's words} first; it saves the brief, cuts, finishes, renders and reviews in one call, then fix what its findings list.";

/** The note on the session's first result while the timeline is empty. */
export const PRODUCE_FIRST =
  "Making a whole video? Call produce_video_tool now, even for a detailed brief (request = the whole brief, output = the delivery file): frame, stock, music, cut, finish, render and review in one call, with the findings to fix next.";

/** The note for `tool`'s receipt on `project`, if it is owed. */
export function briefNote(tool: string, project: Project): string | undefined {
  if (!STARTS_A_VIDEO.has(tool) || project.clips.length >= EARLY_CLIPS || readBrief(project)) return undefined;
  return BRIEF_NOTE;
}

/** Calls that lay material on the timeline or fetch it for a plan (searches, the person's own imports and the frame setting stay free of it). */
const PLANNED = new Set([...STARTS_A_VIDEO].filter((t) => !["set_project_setting_tool", "search_pexels_videos_tool", "search_freesound_music_tool", "import_files_tool"].includes(t)));

/** Words of a call's arguments that say what the video is (queries, a style, a hook, a prompt). */
function requestWords(tool: string, args: Readonly<Record<string, unknown>>): string {
  const words: string[] = [tool.replace(/_tool$/, "").replace(/_/g, " ")];
  for (const value of Object.values(args)) {
    if (typeof value === "string") words.push(value);
    else if (Array.isArray(value)) words.push(...value.filter((v): v is string => typeof v === "string"));
  }
  return words.join(". ").slice(0, 2000);
}

/** The minimal brief owed when `tool` lays down material on an unplanned `project` (saved once the call changed it), or null. */
export function autoBrief(tool: string, project: Project, args: Readonly<Record<string, unknown>>): Brief | null {
  if (!PLANNED.has(tool) || project.clips.length >= EARLY_CLIPS || readBrief(project)) return null;
  const seconds = Number(args.duration_seconds);
  return minimalBrief(project, requestWords(tool, args), Number.isFinite(seconds) && seconds > 0 ? seconds : undefined);
}

/** The receipt note when the server saved `brief`. */
export function autoBriefNote(brief: Brief): string {
  return `No brief was saved, so a minimal one was (${brief.style}, ${brief.aspect} ${brief.length_seconds}s; one undo step). produce_video_tool {request} replaces it with one from the person's words and makes the whole edit; save_brief_tool takes control of the plan.`;
}
