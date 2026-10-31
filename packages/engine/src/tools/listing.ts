/**
 * The MCP tool listing's diet. Every tool's schema rides on every turn of a
 * client's context: on `zenvi mcp` the 260 engine tools were ~568 k
 * characters (~185 k tokens) of the bench's ~210 k-token first turn, and 160
 * of them were never called in 231 bench runs (fleet, 2026-10-28..31). So the
 * listing keeps the whole text only for the tools agents use and the ones
 * the instructions name; every other tool is listed with its first sentence
 * and the first clause of each argument (names, types, enums, ranges and
 * required stay whole), and a refused call to it lists every argument in
 * full. The styles tools (get_style_tool, get_technique_tool) carry the
 * craft that used to sit in those descriptions.
 */

import type { JsonSchemaObject } from "./json-schema.js";

/**
 * Listed in full: tools called in at least 8 of the 231 bench runs (and
 * import_files_tool, fork_project_tool, pick_best_variant_tool at 5-6), and
 * the ones the server instructions, the director card and the builders'
 * receipts send agents to.
 */
export const FULL_LISTING: ReadonlySet<string> = new Set([
  // The bench's (most used first).
  "search_freesound_music_tool", "import_stock_media_tool", "master_audio_tool", "set_project_setting_tool", "gather_stock_footage_tool",
  "auto_sound_design_tool", "add_clip_to_timeline_tool", "add_sfx_tool", "add_title_tool", "save_brief_tool", "unify_grade_tool",
  "color_grade_clip_tool", "search_pexels_videos_tool", "add_clips_to_timeline_tool", "set_clip_properties_tool",
  "generate_tts_and_add_to_timeline_tool", "set_clip_volume_tool", "add_motion_block_tool", "apply_motion_transitions_tool",
  "add_motion_template_tool", "delete_from_timeline_tool", "trim_clips_tool", "generate_image_and_add_to_timeline_tool",
  "list_motion_blocks_tool", "add_captions_tool", "match_cut_montage_tool", "apply_motion_transition_tool", "fade_clip_tool",
  "add_vignette_tool", "kinetic_captions_tool", "apply_clip_preset_tool", "set_clip_audio_video_tool", "add_kinetic_title_tool",
  "review_render_tool", "build_reel_tool", "add_3d_scene_tool", "move_clip_tool", "apply_look_preset_tool", "update_motion_block_tool",
  "edit_title_tool", "watch_render_tool", "apply_fx_tool", "get_transcript_tool", "set_keyframes_tool", "rerender_3d_scene_tool",
  "undo_tool", "add_emoji_tool", "apply_look_tool", "search_sound_library_tool", "add_shape_mask_tool", "duck_under_speech_tool",
  "inspect_media_tool", "import_files_tool", "fork_project_tool", "pick_best_variant_tool",
  // Named by the instructions, the director card or the builders' receipts.
  "find_style_tool", "get_style_tool", "get_technique_tool", "get_brief_tool", "inspect_media_bin_tool", "sequence_shots_tool",
  "spot_sound_tool", "review_edit_tool", "ingest_web_video_tool", "speed_ramp_tool", "build_trailer_tool", "build_explainer_tool",
  "build_talking_head_tool", "build_product_launch_tool",
  // Its method's text warns that the default ripple moves only this track's later clips (other tracks drift).
  "add_transitions_between_clips_tool",
]);

/** A listed tool's first sentence at most this long. */
const DESCRIPTION_MAX = 160;
/** An argument's first clause at most this long. */
const ARGUMENT_MAX = 60;

/** The first sentence (or clause, when it runs long) of `text`, cut at a word to `max`. */
export function firstSentence(text: string, max: number): string {
  const sentence = /^(.+?[.!?])(?=\s|$)/s.exec(text.trim())?.[1] ?? text.trim();
  if (sentence.length <= max) return sentence;
  const clause = /^(.+?)[;:(]/.exec(sentence)?.[1]?.trim();
  if (clause && clause.length >= 20 && clause.length <= max) return `${clause}…`;
  return `${sentence.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function shortDescriptions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(shortDescriptions);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    // An argument named "description" maps to a schema object, so only string values are texts.
    if (key === "description" && typeof value === "string") out[key] = firstSentence(value, ARGUMENT_MAX);
    else out[key] = shortDescriptions(value);
  }
  return out;
}

/** The short listing of a tool not in FULL_LISTING. */
export function leanListing(tool: { description: string; inputSchema: JsonSchemaObject }): { description: string; inputSchema: JsonSchemaObject } {
  return { description: firstSentence(tool.description, DESCRIPTION_MAX), inputSchema: shortDescriptions(tool.inputSchema) as JsonSchemaObject };
}

/** Every top-level argument with its whole description, for a refused call to a short-listed tool. */
export function argumentNotes(name: string, inputSchema: JsonSchemaObject): string {
  const properties = (inputSchema.properties ?? {}) as Record<string, { description?: unknown; type?: unknown; enum?: unknown }>;
  const required = new Set(Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : []);
  const lines = Object.entries(properties).map(([arg, schema]) => {
    const kind = Array.isArray(schema.enum) ? `one of ${schema.enum.map((v) => JSON.stringify(v)).join("|")}` : typeof schema.type === "string" ? schema.type : "value";
    return `${arg}${required.has(arg) ? " (required)" : ""}, ${kind}: ${typeof schema.description === "string" ? schema.description : ""}`.trimEnd();
  });
  return `${name} arguments in full:\n${lines.join("\n")}`;
}
