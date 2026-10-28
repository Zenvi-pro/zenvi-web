/**
 * The brief, asked for where agents look: the receipts of the calls that
 * start a whole video. Bench sk0's first runs read the director card and the
 * recipe (both open with "compile the brief") and still cut without one;
 * receipts are what they act on. Only until a brief is saved, and only while
 * the timeline is nearly empty, so a single quick edit hears it at most once
 * or twice.
 *
 * Notes alone were not enough (the next bench pilot read three of them and
 * cut anyway), so the first call that lays down material without a brief is
 * refused once per server: a speed bump, not a wall. The same call made again
 * goes through. ZENVI_MCP_BRIEF=off turns the bump off.
 */

import { readBrief, type Project } from "@zenvi/engine";

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
  "generate_tts_and_add_to_timeline_tool",
]);

/** Past this many clips the edit is under way: a brief now would describe it, not plan it. */
const EARLY_CLIPS = 3;

export const BRIEF_NOTE =
  'No brief saved: a whole video starts with the creative brief (a detailed request is not one: the brief adds the 0-2 s hook, beat timings, the shot plan and its critique). read_director_recipe {styles: "brief"}, then save_brief_tool, before cutting.';

/** The note for `tool`'s receipt on `project`, if it is owed. */
export function briefNote(tool: string, project: Project): string | undefined {
  if (!STARTS_A_VIDEO.has(tool) || project.clips.length >= EARLY_CLIPS || readBrief(project)) return undefined;
  return BRIEF_NOTE;
}

/** Calls the bump stops: they lay material on the timeline or fetch it for a plan (searches, the person's own imports and the frame setting stay free). */
const BUMPED = new Set([...STARTS_A_VIDEO].filter((t) => !["set_project_setting_tool", "search_pexels_videos_tool", "search_freesound_music_tool", "import_files_tool"].includes(t)));

export const BRIEF_BUMP =
  'Error: refused once, nothing changed: compile the creative brief before the first cut (read_director_recipe {styles: "brief"}: the hook, beats with timings, shot plan and critique), save it with save_brief_tool, then make this call again. A request with no time for a brief can repeat this call as it is: it goes through.';

/** Whether `tool` on `project` is the first unbriefed cut, which the bump refuses. */
export function briefBump(tool: string, project: Project): boolean {
  return BUMPED.has(tool) && project.clips.length < EARLY_CLIPS && !readBrief(project);
}
