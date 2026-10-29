/**
 * The brief never blocks work. Bench rounds 6-7 (fleet w61-bench7) found the
 * old gate (cuts refused until save_brief_tool) was most of the agents' tool
 * errors and bought placeholder briefs, so instead the first call that starts
 * a video on a project without a brief saves a minimal one by itself
 * (@zenvi/engine brief/auto.ts: the style its words match in the styles
 * index, the frame, the length) and its receipt says so. While the brief is
 * still that auto one, later calls keep its frame and length in step with
 * the project. ZENVI_MCP_BRIEF=off turns it off.
 */

import { ensureBrief, type Brief, type ProjectDocument } from "@zenvi/engine";
import { STYLE_FILES } from "@zenvi/engine/styles";

/** Calls that gather or lay down the material of a whole video (searches and the frame setting do not commit to one). */
const STARTS_A_VIDEO = new Set([
  "gather_stock_footage_tool",
  "import_stock_media_tool",
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

const STYLES = STYLE_FILES.filter((f) => f.kind === "style");

/** The receipt line for an auto brief. */
export function autoBriefNote(brief: Brief): string {
  return `Saved a minimal brief for this project (auto: style ${brief.style} matched from the styles index, ${brief.aspect}, ${brief.length_seconds} s, one beat). Nothing waits for it; save_brief_tool with your own hook, beats and storyboard plans the edit and has review check it.`;
}

/**
 * After `tool` succeeded on `doc`: the auto brief's receipt note when this
 * call saved one, else undefined. `text` is what the call says about the
 * piece (its arguments), matched against the styles with the bin's names.
 */
export function autoBriefFor(tool: string, doc: ProjectDocument, text: string): string | undefined {
  if (!STARTS_A_VIDEO.has(tool)) return undefined;
  const names = doc.project.files.map((f) => String(f.name ?? f.path ?? "")).join(" ");
  const saved = ensureBrief(doc, `${text} ${names}`, STYLES);
  return saved ? autoBriefNote(saved) : undefined;
}
