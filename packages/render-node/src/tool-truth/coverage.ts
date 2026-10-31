/**
 * Tool truth coverage: every argument of every mutating tool in the catalog
 * is in exactly one class.
 *
 *   proven     a truth case renders it at its default and changed
 *   selector   picks what the tool acts on (ids, queries, tracks, scope)
 *   inert      legitimately changes nothing on its own (names, dry runs,
 *              permissions), with the reason
 *   offscreen  the whole tool changes no picture and no sound (project
 *              files, markers, the editor UI), with the reason
 *   backlog    should change the picture or the sound and is not proven
 *              yet; listed by name in BACKLOG so a new argument cannot slip
 *              in unclassified (coverage.test.ts fails on it)
 */

import { allTools } from "@zenvi/engine/tools";
import type { TruthCase } from "./harness.js";

export type ParamClass =
  | { kind: "proven"; cases: string[] }
  | { kind: "selector"; reason: string }
  | { kind: "inert"; reason: string }
  | { kind: "offscreen"; reason: string }
  | { kind: "backlog"; reason: string };

/** Argument names that only choose the target, in every tool. */
const SELECTORS: Readonly<Record<string, string>> = {
  timeline_clip_id: "the clip to change",
  timeline_clip_ids: "the clips to change",
  clip_id: "the clip to change",
  clip_ids: "the clips to change",
  clipId: "the clip to change",
  clipIds: "the clips to change",
  clip_query: "describes the clip to change",
  query: "describes the clip or file to act on",
  track: "the track to act on",
  occurrence: "which match of clip_query",
  position_near: "which match of clip_query",
  scope: "which clips (selection, track, all)",
  all_clips: "every clip as the target",
  allClips: "every clip as the target",
  role: "the stem whose clips to change",
  file_id: "the file to act on",
  file_ids: "the files to act on",
  file_query: "describes the files to act on",
  transition_ids: "the transitions to change",
  between_clip_ids: "the transition between these clips",
  source_clip_id: "the clip to copy from",
  source_query: "describes the clip to copy from",
  source_clip_query: "describes the clip to copy from",
  source_track: "the track of the clip to copy from",
  source_transition_id: "the transition to copy",
  effect_id: "the effect to change",
  effect: "the effect to change or remove (add_effect_tool's own `effect` is proven by the effect= cases)",
  effect_ids: "the effects to change",
  title_clip_id: "the title clip to change",
  title_query: "describes the title to change",
  clip1_id: "the outgoing clip",
  clip2_id: "the incoming clip",
  clip_a_id: "the outgoing clip",
  clip_b_id: "the incoming clip",
  clip_a_query: "describes the outgoing clip",
  clip_b_query: "describes the incoming clip",
  bed_clip_ids: "the bed clips to duck",
  bed_query: "describes the bed clip",
  bed_track: "the bed track",
  speech_clip_ids: "the speech clips",
  music_clip_ids: "the music clips",
  sfx_clip_ids: "the sound-effect clips",
  transition_id: "the transition to change",
  marker_id: "the marker whose time is the moment",
  trackIndex: "the caption track",
};

/** Argument names that change nothing on their own, in every tool. */
const INERT: Readonly<Record<string, string>> = {
  dry_run: "a preview: by contract it writes nothing",
  dryRun: "a preview: by contract it writes nothing",
  allow_overlap: "a permission: lets an edit through that would otherwise be refused",
  confirm: "a confirmation for a destructive step",
  name: "a display name",
  label: "a display name",
  file_name: "the name of the generated file in Project Files",
  overwrite: "a permission to replace a file",
  show_dialog: "the desktop's dialog only",
  timeout_seconds: "how long to wait for a render, not what it draws",
  draft: "a faster preview render of the same drawing",
  if_exists: "update vs stack when the effect is already there: same picture for one call",
  interpolation: "the default interpolation for keyframes the call adds; static values have none",
  replace_existing: "replaces this tool's earlier output instead of stacking: same picture for one call",
  replace: "replaces this tool's earlier output instead of stacking: same picture for one call",
};

/** One tool's arguments that change nothing on their own (`tool.param` → why). */
const PARAM_NOTES: Readonly<Record<string, string>> = {
  "set_clip_audio_video_tool.waveform": "the timeline's waveform display in the editor, not the picture",
  "separate_clip_audio_tool.per_channel": "one clip per channel plays the same mix as one clip with all channels",
  "separate_clip_audio_tool.to_track": "where the separated audio clip goes: same mix",
  "add_clips_to_timeline_tool.min_clip_seconds": "a floor for fit_total_seconds' trims: equal fixtures trim evenly above it",
  "add_effect_tool.effect_name": "the same as effect (either works)",
  "add_effect_tool.processing": "OpenCV analysis options: Zenvi desktop only",
  "add_emoji_tool.group": "narrows an emoji name lookup; the emoji argument is proven",
  "set_project_setting_tool.save_as_default": "a Preferences default for new projects",
  "set_clip_speed_tool.ripple": "moves the later clips on the track; with one clip, the same picture",
  "trim_clips_tool.ripple": "moves the later clips on the track; with one clip, the same picture",
  "slice_clips_tool.ripple": "moves the later clips on the track; with one clip, the same picture",
  "freeze_frame_tool.ripple": "moves the later clips on the track; with one clip, the same picture",
  "speed_ramp_tool.ripple": "moves the later clips on the track; with one clip, the same picture",
  "repeat_clip_tool.ripple": "moves the later clips on the track; with one clip, the same picture",
  "move_clips_tool.ripple": "moves the later clips on the track; with one clip, the same picture",
  "duplicate_clips_tool.ripple": "pushes clips at the destination later; with one clip, the same picture",
  "delete_from_timeline_tool.ripple": "closes the gap by moving later clips; with one clip, the same picture",
  "update_transition_tool.ripple": "moves the later clips on the track; with two clips, the same picture",
  "update_transition_tool.keep_overlap": "leaves the clips where they are when the duration changes (proven with position_seconds)",
};

/** Tools that change no picture and no sound (whole tool, every argument). */
export const OFFSCREEN: Readonly<Record<string, string>> = {
  new_project_tool: "replaces the project (no media)",
  save_project_tool: "writes the project file",
  open_project_tool: "opens another project file",
  watch_clip_tool: "plays a clip in the player",
  undo_tool: "history: restores an earlier state (history tests cover it)",
  redo_tool: "history: restores a later state (history tests cover it)",
  add_track_tool: "an empty track",
  add_marker_tool: "a timeline marker",
  update_marker_tool: "a timeline marker",
  remove_marker_tool: "a timeline marker",
  set_export_setting_tool: "export preferences, read at export time (export tests cover them)",
  export_video_tool: "writes a file from the timeline; render-project tests cover the encoders",
  export_captions_tool: "writes an SRT/VTT file",
  export_files_to_folder_tool: "copies files",
  export_project_file_tool: "writes another project format",
  import_project_file_tool: "reads another project format",
  import_files_tool: "adds files to Project Files, not the timeline",
  import_image_sequence_tool: "adds a file to Project Files, not the timeline",
  create_subclips_tool: "adds subclip files to Project Files",
  update_project_files_tool: "file metadata in Project Files",
  reindex_project_file_tool: "the search index",
  resummarize_project_file_tool: "the search index",
  consolidate_project_media_tool: "moves media files on disk; the picture is the same media",
  manage_optimized_previews_tool: "proxy files for playback; exports use the originals",
  manage_custom_profiles_tool: "profile files",
  forget_recent_projects_tool: "the recent projects list",
  reset_caches_and_history_tool: "caches and the undo history",
  restore_recovery_version_tool: "opens a recovery copy",
  save_frame_image_tool: "writes a PNG of the current frame",
  select_timeline_items_tool: "the editor's selection",
  set_editor_layout_tool: "the editor's panels",
  set_preference_tool: "editor preferences",
  set_timeline_view_tool: "the timeline view",
  seek_playhead_tool: "the playhead",
  update_track_tool: "a track's name and lock",
  set_track_role_tool: "a track's mix role, read by the mix tools (their cases cover roles)",
  cancel_comfyui_job_tool: "cancels a remote job",
  prepare_recording_tool: "sets up a screen recording session",
  setup_motion_runtime_tool: "installs the motion runtime",
  fetch_motion_graphics_video_tool: "downloads a render the backend made",
  remove_files_from_project_tool: "Project Files (its clips go too; delete_from_timeline_tool covers removing clips)",
  fork_project_tool: "writes a copy of the project file and stays on the open one",
  pick_best_variant_tool: "opens the winning variant's project (like open_project_tool)",
  align_lyrics_tool: "word timings on the file's transcript, read by the caption and word tools",
  detect_music_structure_tool: "the song's sections as snap points and timeline markers",
  make_transition_mask_tool: "adds a mask image to Project Files, not the timeline",
  save_brief_tool: "the creative brief, saved with the project for the director to read",
};

export interface BacklogEntry {
  reason: string;
  /** Arguments not proven yet; `*` for every argument of the tool. */
  params: readonly string[] | "*";
}

/**
 * Arguments that should change the picture or the sound and have no case
 * yet. Shrink it: prove one, then delete it here (coverage.test.ts fails on
 * a stale entry).
 */
export const BACKLOG: Readonly<Record<string, BacklogEntry>> = {
  delete_from_timeline_tool: { reason: "not proven yet", params: ["include_transitions"] },
  delete_clips_on_track_tool: { reason: "not proven yet", params: ["include_transitions"] },
  duck_under_speech_tool: { reason: "needs speech clips with transcript cues", params: ["duck_db", "attack_ms", "release_ms", "pad_before_ms", "pad_after_ms", "boost_speech_db"] },
  split_file_add_clip_tool: { reason: "needs the media index for queries; seconds/frames not proven yet", params: ["start_seconds", "end_seconds", "start_frame", "end_frame", "require_visual_match"] },
  add_clip_to_timeline_tool: { reason: "duration_seconds alone is refused on media nothing has watched (it needs a watched keep window)", params: ["duration_seconds"] },
  import_video_url_and_add_to_timeline_tool: { reason: "downloads from a URL (network): the clip it adds is footage like any other", params: ["video_url", "position_seconds", "start_seconds", "end_seconds", "duration_seconds", "full_file"] },
  ingest_web_video_tool: { reason: "downloads from a URL (network, yt-dlp)", params: ["url", "video_url", "intent", "place", "position_seconds", "write_subs", "job_id"] },
  match_color_to_reference_tool: { reason: "not proven yet: iterative grade matching against a reference frame", params: ["reference", "referenceClipId", "referenceFileId", "referenceImagePath", "max_iterations"] },
  slice_clip_at_best_match_tool: { reason: "needs the media index (backend summaries)", params: ["start_seconds", "end_seconds"] },
  place_motion_graphic_tool: { reason: "places a backend-rendered motion graphic", params: ["mode", "position_seconds", "duration_seconds", "layout_region"] },
  fetch_remotion_video_from_supabase_tool: { reason: "downloads a backend render (deprecated)", params: ["segment_urls", "supabase_url", "supabase_path", "render_job_id"] },
  generate_video_and_add_to_timeline_tool: { reason: "generates media through the Zenvi backend (account, credits)", params: ["prompt", "position_seconds", "duration_seconds"] },
  generate_image_and_add_to_timeline_tool: { reason: "generates media through the Zenvi backend (account, credits)", params: ["prompt", "position_seconds", "duration_seconds"] },
  modify_clip_tool: { reason: "not proven yet: free-text clip edits", params: ["mode", "description", "fade_ms", "duration_seconds"] },
  generate_transition_clip_tool: { reason: "generates a transition clip through the backend", params: ["prompt_hint", "duration_seconds"] },
  generate_tts_and_add_to_timeline_tool: { reason: "speech through the Zenvi backend (account, credits)", params: ["model", "position", "position_seconds", "speed", "text", "voice"] },
  import_stock_media_tool: { reason: "downloads stock media (network)", params: ["source", "video_id", "link", "sound_id", "preview_url", "filename", "local_path", "position_seconds", "duration_seconds", "start_seconds"] },
  add_title_tool: { reason: "not proven yet", params: ["screen_position"] },
  remove_words_tool: { reason: "needs a transcript (Zenvi backend speech recognition)", params: ["wordIndices", "matches", "fillerPreset", "transcriptGeneration", "language", "modelId", "engine"] },
  remove_silence_tool: { reason: "not proven yet: silence detection needs a fixture with pauses", params: ["minPauseSec", "padSec", "maxRemoveFraction"] },
  add_captions_tool: { reason: "not proven yet (the transcript arguments need speech recognition)", params: ["engine", "language", "maxChars", "maxWords", "modelId", "overlay_track", "srtPath", "time_base"] },
  add_animated_title_tool: { reason: "not proven yet: animated title templates (Blender/Chrome renders)", params: ["length_multiplier", "params", "position_seconds", "template", "text"] },
  add_transitions_between_clips_tool: { reason: "not proven yet", params: ["audio_crossfade", "max_gap_seconds", "method"] },
  align_clips_tool: { reason: "not proven yet: aligning two stacked clips showed no frame change in a first try (check the probe, then the tool)", params: ["edge", "to_seconds"] },
  chroma_key_clip_tool: { reason: "not proven yet", params: ["align", "background_query", "sample_time"] },
  copy_clip_keyframes_tool: { reason: "not proven yet: timing (stretch/offset) needs clips of different lengths", params: ["timing"] },
  copy_transition_tool: { reason: "not proven yet", params: ["at_seconds", "fit_duration", "what"] },
  create_media_with_comfyui_tool: { reason: "generates media on a ComfyUI server", params: ["kind", "prompt", "reference_image_file_id", "template"] },
  duplicate_clips_tool: { reason: "not proven yet", params: ["include_transitions", "to_track"] },
  edit_title_tool: { reason: "not proven yet", params: ["fit_text", "lines", "subtitle"] },
  enhance_file_with_comfyui_tool: { reason: "processes media on a ComfyUI server", params: ["action", "auto_detect", "background_brightness", "border_color", "border_width", "boxes", "highlight_color", "highlight_opacity", "mask_brightness", "negative_boxes", "negative_points", "points", "prompt", "reference_image_file_id", "seed_frame", "template"] },
  move_clips_tool: { reason: "not proven yet", params: ["after_clip_id", "before_clip_id", "to_track"] },
  process_clip_effect_tool: { reason: "OpenCV analysis effects: Zenvi desktop only", params: ["boxes", "class_filter", "confidence", "device", "download_model", "mask_quality", "model", "negative_points", "points", "properties", "region", "region_time", "smoothing", "tracker_type"] },
  remove_keyframes_tool: { reason: "not proven yet: start_seconds alone (end_seconds is proven)", params: ["start_seconds"] },
  remove_transition_tool: { reason: "not proven yet", params: ["at_seconds"] },
  reverse_transition_tool: { reason: "not proven yet", params: ["at_seconds"] },
  slice_clips_tool: { reason: "not proven yet", params: ["include_transitions"] },
  update_transition_tool: { reason: "not proven yet", params: ["at_seconds", "contrast_keyframes", "mask_file_id"] },
  master_audio_tool: { reason: "not proven yet: a loudness plan over a whole mix (mastering tests cover the plan)", params: ["balance", "duck", "genre", "score", "iterate"] },
  duck_tool: { reason: "not proven yet", params: ["bed", "under", "target_vbr_db"] },
  build_reel_tool: { reason: "not proven yet: builds a whole reel (many tools at once)", params: ["style", "music_file_id", "duration_seconds", "hook", "end_card", "end_card_subtitle", "labels", "words", "beats", "bpm", "offset_seconds", "strict_variety", "grade", "keep_order"] },
  align_match_cut_tool: { reason: "not proven yet: render-node/src/render/match-cut.test.ts proves the alignment end to end", params: "*" },
  match_cut_montage_tool: { reason: "not proven yet: builds a montage from detected subjects", params: ["subjects", "music_file_id", "beats", "bpm", "offset_seconds", "duration_seconds", "target", "fit", "cover", "min_frames", "max_frames", "flash", "zoom_drift", "transitions", "strict_variety", "keep_order", "order"] },
  unify_grade_tool: { reason: "not proven yet: iterative grade matching across clips", params: ["reference_clip_id", "reference_file_id", "strength", "look", "look_intensity", "samples", "max_iterations"] },
  kinetic_captions_tool: { reason: "not proven yet: script cues work without a transcript; cases to write", params: ["behind_subject", "placement", "language", "rotation"] },
  add_sfx_tool: { reason: "not proven yet", params: ["provider", "sound_id", "title", "max_seconds", "allow_noncommercial", "kit"] },
  auto_sound_design_tool: { reason: "not proven yet: density and beats need a music bed with several cuts; genre ids to look up", params: ["sources", "kit", "density", "genre", "beats"] },
  speed_ramp_tool: { reason: "not proven yet: hero hold_seconds moves the slow moment, but no single probed frame has shown it", params: ["hold_seconds"] },
  add_motion_block_tool: { reason: "Zenvi Motion blocks render in headless Chrome (packages/motion), not on this host; word_rotator size (sk2 report) lives here", params: ["block", "params", "position_seconds", "duration_seconds", "placement", "motion_blur"] },
  update_motion_block_tool: { reason: "Zenvi Motion blocks render in headless Chrome (packages/motion), not on this host", params: ["params", "duration_seconds", "motion_blur"] },
  add_3d_scene_tool: { reason: "Zenvi 3D renders in Blender", params: ["scene", "params", "position_seconds", "duration_seconds", "quality"] },
  rerender_3d_scene_tool: { reason: "Zenvi 3D renders in Blender", params: ["params", "quality", "duration_seconds"] },
  create_sound_kit_tool: { reason: "not proven yet: builds a sound kit the sfx tools then play", params: ["source", "tone", "pitch", "brightness", "seed", "style", "license", "variants"] },
  generate_sfx_tool: { reason: "generates a sound with ElevenLabs (API key, paid plan)", params: ["prompt", "duration_seconds", "at_seconds", "align", "gain_db", "prompt_influence", "loop"] },
  gather_stock_footage_tool: { reason: "searches and downloads stock footage (network, account)", params: "*" },
  generate_subject_matte_tool: { reason: "subject matting needs the RVM model (onnxruntime-node)", params: ["subject", "size", "regenerate"] },
  text_behind_subject_tool: { reason: "needs a subject matte (RVM model)", params: ["text", "color", "font", "size", "y", "subject"] },
  replace_background_tool: { reason: "needs a subject matte (RVM model)", params: ["background", "color", "color2", "blur", "subject"] },
  subject_glow_tool: { reason: "needs a subject matte (RVM model)", params: ["look", "color", "glow_color", "glow", "background", "subject"] },
  pop_out_tool: { reason: "needs a subject matte (RVM model)", params: ["band_aspect", "bar_color", "subject"] },
  place_on_word_tool: { reason: "needs word timings (speech recognition)", params: "*" },
  insert_broll_on_words_tool: { reason: "needs word timings (speech recognition)", params: "*" },
  snap_cuts_to_onsets_tool: { reason: "not proven yet: needs a fixture with audible onsets off the cuts", params: "*" },
  shot_length_ramp_tool: { reason: "not proven yet: builds a montage of ramping shot lengths", params: "*" },
  spot_action_foley_tool: { reason: "not proven yet: needs footage with visible impacts and taps", params: "*" },
  add_guide_overlay_tool: { reason: "not proven yet: tracking needs moving footage with a known point", params: "*" },
  auto_reframe_tool: { reason: "not proven yet: needs footage with a detectable subject", params: "*" },
  hold_point_reframe_tool: { reason: "not proven yet: tracking needs moving footage with a known point", params: "*" },
  pin_to_track_tool: { reason: "not proven yet: tracking needs moving footage with a known point", params: "*" },
  screen_zoom_follow_tool: { reason: "not proven yet: needs a screen recording with activity", params: "*" },
  add_motion_template_tool: { reason: "not proven yet: one template per case (ui_cards, kinetic_type, end_card, grid …)", params: ["labels", "values", "points", "boxes", "button", "step", "steps", "phase", "transitions", "strict_variety", "sound", "replay", "states", "pace"] },
  add_plate_wipe_tool: { reason: "not proven yet", params: "*" },
  add_shape_mask_tool: { reason: "not proven yet: polygon points", params: ["points"] },
  add_type_block_tool: { reason: "not proven yet: one type block per case (text_on_path, write_on, stencil ...)", params: "*" },
  datamosh_cut_tool: { reason: "not proven yet: datamosh_carry needs two clips with motion at the cut", params: "*" },
  sequence_shots_tool: { reason: "not proven yet: reorders shots (sequence tests cover the order)", params: "*" },
  generate_broll_set_tool: { reason: "generates footage through the Zenvi backend (account, credits)", params: "*" },
  build_explainer_tool: { reason: "not proven yet: builds a whole first cut (many tools at once), like build_reel_tool", params: "*" },
  build_product_launch_tool: { reason: "not proven yet: builds a whole first cut (many tools at once), like build_reel_tool", params: "*" },
  build_talking_head_tool: { reason: "not proven yet: builds a whole first cut (many tools at once), like build_reel_tool", params: "*" },
  build_trailer_tool: { reason: "not proven yet: builds a whole first cut (many tools at once), like build_reel_tool", params: "*" },
  apply_motion_transitions_tool: { reason: "not proven yet: the focus point moves where a zoom or spin transition centres", params: ["focus_x", "focus_y"] },
  apply_matched_dissolve_tool: { reason: "not proven yet: needs two shots whose subjects line up at the cut", params: "*" },
};

export function paramNoteKeys(): string[] {
  return Object.keys(PARAM_NOTES);
}

/** Every (tool, argument) the coverage gate classifies: mutating tools, deprecated ones included. */
export function catalogParams(): { tool: string; param: string }[] {
  const out: { tool: string; param: string }[] = [];
  for (const tool of allTools) {
    if (tool.annotations?.readOnlyHint) continue;
    for (const param of Object.keys(tool.inputSchema.properties ?? {})) out.push({ tool: tool.name, param });
  }
  return out;
}

/** The top-level argument a case proves (`properties.alpha` proves `properties`). */
const rootParam = (param: string): string => param.split(".")[0]!;

export function classify(tool: string, param: string, provenBy: ReadonlyMap<string, string[]>): ParamClass | undefined {
  const cases = provenBy.get(`${tool} ${param}`);
  if (cases) return { kind: "proven", cases };
  if (OFFSCREEN[tool]) return { kind: "offscreen", reason: OFFSCREEN[tool] };
  if (param in SELECTORS) return { kind: "selector", reason: SELECTORS[param]! };
  if (param in INERT) return { kind: "inert", reason: INERT[param]! };
  const note = PARAM_NOTES[`${tool}.${param}`];
  if (note) return { kind: "inert", reason: note };
  const backlog = BACKLOG[tool];
  if (backlog && (backlog.params === "*" || backlog.params.includes(param))) return { kind: "backlog", reason: backlog.reason };
  return undefined;
}

export function provenIndex(cases: readonly TruthCase[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const c of cases) {
    if (c.inert) continue;
    const key = `${c.tool} ${rootParam(c.param)}`;
    index.set(key, [...(index.get(key) ?? []), c.id]);
  }
  return index;
}
