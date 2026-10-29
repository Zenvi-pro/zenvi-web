/**
 * Where each tool works: the availability matrix behind docs/TOOLS.md.
 *
 * Availability is computed, not hand-kept: a tool's `requires` (checked by
 * the pipeline), the optional host methods it needs at run time
 * (`TOOL_NEEDS`), and what each surface's host provides (`SURFACE_PROFILES`,
 * a description of the host implementations in this repo). Zenvi desktop
 * runs every contract tool itself (it is the reference implementation);
 * the direct tools exist only on the web surfaces. A ported tool with desktop
 * arguments not ported yet (pending.ts) is partial on the web surfaces.
 */

import { capabilityName, type CatalogTool } from "./define.js";
import { DESKTOP_NAMES_ON_DIRECT_TOOLS, PENDING_DESKTOP_ARGS } from "./pending.js";
import type { ContractToolName } from "./schemas.gen.js";
import type { HostCapability } from "./types.js";

export type AvailabilitySurface = "editor" | "cli" | "cloud" | "desktop";

/** yes: works as on the desktop; partial: works with less (see the note); no: refused or hidden. */
export type Availability = "yes" | "partial" | "no";

/** Optional host methods a tool calls beyond the capability objects. */
export type HostMethod =
  | "media.importPath"
  | "media.listPaths"
  | "media.importUrl"
  | "media.pickFiles"
  | "media.writeGenerated"
  | "media.missing"
  | "media.fetchWebVideo"
  | "media.kitSample"
  | "media.inspectRender"
  | "media.decodeLuma"
  | "storage.open"
  | "storage.readText"
  | "storage.writeText"
  | "ui.openExportDialog"
  | "audio.decodePcm"
  | "audio.mixPcm"
  | "audio.transcribe"
  | "audio.generateSfx"
  | "ui.selection"
  | "ui.setSelection"
  | "ui.timelineView"
  | "ui.showTimelineRange"
  | "ui.setTimelineMode"
  | "ui.layout"
  | "ui.preferences"
  | "ui.clearPlaybackCache"
  | "storage.writeBytes"
  | "storage.saveCopy"
  | "storage.readCopy"
  | "storage.exportMedia"
  | "storage.currentPath"
  | "storage.recentProjects"
  | "storage.recoveryCopies"
  | "storage.customProfiles"
  | "media.collect"
  | "exporter.supports"
  | "frames.fontFamilies"
  | "frames.renderSheet"
  | "frames.sampleFrames"
  | "audio.measureMix";

export interface ToolNeeds {
  /** All of these, or the tool refuses. */
  methods?: HostMethod[];
  /** At least one of these (capabilities or methods), or the tool refuses. */
  anyOf?: (HostCapability | HostMethod)[];
  /** Without these the tool still runs, with less (named in `partialNote`). */
  optional?: (HostCapability | HostMethod)[];
  partialNote?: string;
  /** Always partial on the web surfaces, whatever the host provides. */
  webNote?: string;
  /** Refused on every web surface; the desktop runs it (the reason). */
  desktopOnly?: string;
}

const WATCH = ["frames", "backend"] as (HostCapability | HostMethod)[];
/** How the web surfaces transcribe (zenvi-backend POST /api/v1/transcription; the CLI on device after `zenvi speech setup`). */
const SERVER_ASR =
  "speech recognition runs on the Zenvi server (a Zenvi sign-in, 2 credits per started minute) except in the CLI after `zenvi speech setup`, which hears it on device for free; media Zenvi indexed is read from its transcript for free";
const WATCH_NOTE = "without frame rendering and the Zenvi backend, windows are not vision-checked";
/** Where a host cannot list its fonts (the browser), a title's font is taken as given, as the desktop does without Qt's list. */
const FONTS_UNCHECKED =
  "a font is not checked against the installed fonts (the browser does not list them): one it does not have falls back to another, and a template font it lacks is kept";
/** The desktop's ComfyUI integration: a server on the person's computer, set in its preferences. */
const COMFYUI = "the local ComfyUI server Zenvi desktop drives (Preferences > AI > ComfyUI URL)";

/** Run-time needs beyond `requires`, per tool. */
export const TOOL_NEEDS: Readonly<Record<string, ToolNeeds>> = {
  // Placement and search refine with a vision watch when the host can watch.
  add_clip_to_timeline_tool: { optional: WATCH, partialNote: WATCH_NOTE },
  split_file_add_clip_tool: { optional: WATCH, partialNote: WATCH_NOTE },
  search_clip_scenes_tool: { optional: ["backend", "frames"], partialNote: "without the Zenvi backend only chapter and scene descriptions are searched" },
  slice_clip_at_best_match_tool: { optional: ["backend", "frames"], partialNote: "without the Zenvi backend only explicit times and scene descriptions work" },
  duck_under_speech_tool: {
    optional: ["audio", "audio.transcribe"],
    partialNote: "without audio analysis and speech recognition only indexed transcript cues find the speech",
  },
  watch_clip_tool: { optional: ["media.importPath"], partialNote: "file_path needs local file access" },
  export_video_tool: {
    anyOf: ["exporter", "ui.openExportDialog"],
    webNote:
      "interlaced is refused (no web encoder interlaces); the CLI renders with ffmpeg and writes files (relative paths and the default folder start at the project's folder), " +
      "the web editor renders MP4, MOV, MKV, WebM or WAV in the browser and downloads the file (no folders), Zenvi Cloud starts a render job (get_render_status gives the download link; no image sequences)",
  },
  save_project_tool: {},
  open_project_tool: { methods: ["storage.open"] },
  fork_project_tool: { methods: ["storage.saveCopy"] },
  pick_best_variant_tool: { methods: ["storage.readCopy"] },
  import_files_tool: { methods: ["media.importPath"], optional: ["media.listPaths"], partialNote: "folders and globs need path listing" },
  import_video_url_and_add_to_timeline_tool: { methods: ["media.importUrl"] },
  gather_stock_footage_tool: { methods: ["media.importUrl"] },
  import_stock_media_tool: { methods: ["media.importUrl"], optional: ["stock", "media.importPath"], partialNote: "search needs stock search; local_path needs local file access" },
  place_motion_graphic_tool: { optional: ["media.importUrl"], partialNote: "url= needs URL downloads; file_id works" },
  fetch_motion_graphics_video_tool: { methods: ["media.importUrl"] },
  fetch_remotion_video_from_supabase_tool: { methods: ["media.importUrl"] },
  generate_video_and_add_to_timeline_tool: { methods: ["media.importUrl"] },
  generate_image_and_add_to_timeline_tool: { methods: ["media.writeGenerated"] },
  generate_broll_set_tool: {
    methods: ["media.writeGenerated"],
    optional: ["media.importUrl", "frames"],
    partialNote: "animate=true needs URL downloads; the reference's look and image need frame rendering",
  },
  // Hosted surfaces do not download third-party pages (terms of service, blocked server addresses): only the person's own computer does.
  ingest_web_video_tool: { methods: ["media.fetchWebVideo"] },
  generate_tts_and_add_to_timeline_tool: { methods: ["media.writeGenerated"] },
  add_title_tool: {
    methods: ["media.writeGenerated"],
    optional: ["frames.fontFamilies"],
    partialNote: FONTS_UNCHECKED,
  },
  align_lyrics_tool: { methods: ["audio.transcribe"], webNote: SERVER_ASR },
  place_on_word_tool: {
    optional: ["audio.transcribe"],
    partialNote: "without speech recognition only words of kept transcripts (TTS voices, aligned lyrics) and indexed media are found",
  },
  insert_broll_on_words_tool: {
    optional: ["audio.transcribe", "media.importUrl"],
    partialNote: "without speech recognition only kept or indexed transcripts are searched; stock=true needs URL downloads",
  },
  add_captions_tool: {
    optional: ["media.writeGenerated", "storage.readText", "audio.transcribe"],
    partialNote: "captions not tied to a clip need stored generated media; srtPath needs file reading; media Zenvi has not indexed needs speech recognition",
  },
  export_captions_tool: {
    methods: ["storage.writeText"],
    optional: ["audio.transcribe"],
    partialNote: "without speech recognition only media Zenvi indexed has a transcript",
    webNote: SERVER_ASR,
  },
  list_title_templates_tool: { optional: ["storage.readText"], partialNote: "kind=project needs reading project files" },
  edit_title_tool: {
    methods: ["media.writeGenerated", "storage.readText"],
    optional: ["frames.fontFamilies"],
    partialNote: FONTS_UNCHECKED,
    webNote: "the edited version is a new Project Files entry (new file_id) in every clip",
  },
  add_animated_title_tool: {
    methods: ["media.writeGenerated"],
    webNote: "2D keyframed versions of the Blender templates (no 3D depth or particles); earth, magic_wand, snow and picture_frames_4 need Zenvi desktop",
  },
  add_timer_tool: { optional: ["media.writeGenerated"], partialNote: "without storing generated images only timeline_clip_id works" },
  get_transcript_tool: {
    optional: ["audio.transcribe"],
    partialNote: "without speech recognition only media Zenvi indexed (word timings estimated) and TTS voices (their script over the voice's pauses) have a transcript",
    webNote: SERVER_ASR,
  },
  reindex_project_file_tool: { webNote: "reports files that are already indexed; uploading for indexing runs in Zenvi desktop" },
  wait_until_project_indexed_tool: { webNote: "reports indexing status once; does not wait" },
  remove_silence_tool: { webNote: "energy VAD on the host's audio analysis" },
  set_clip_audio_video_tool: {
    webNote: "waveform=show changes nothing, since the web timeline draws the waveform of every clip with sound; waveform=hide is refused",
  },
  seek_playhead_tool: {
    optional: ["player"],
    partialNote: "without a preview player it moves the playhead saved with the project (where the editors open); play=true needs the web editor",
  },
  get_playhead_and_selection_tool: {
    optional: ["player", "ui.selection", "ui.timelineView"],
    partialNote: "without an editor open it reports the playhead saved with the project; selection, playback and the timeline view exist only in an editor",
  },
  select_timeline_items_tool: { methods: ["ui.selection", "ui.setSelection"] },
  set_timeline_view_tool: {
    methods: ["ui.timelineView", "ui.showTimelineRange", "ui.setTimelineMode"],
    webNote: "the web editor has no timing (retime-by-drag) mode, so timing=true is refused",
  },
  // Colour: frames rendered by the host; LUT files outside the 50 built-ins need local files.
  analyze_frame_colors_tool: { webNote: "save_frame_path attaches the frame to the result instead of writing a file; frames are measured at most 960 px wide" },
  chroma_key_clip_tool: {
    optional: ["frames"],
    partialNote: "without frame rendering key_color='auto' is refused, 'green'/'blue' key the stock shade and keyed_pct is not measured",
  },
  color_grade_clip_tool: { optional: ["media.importPath"], partialNote: "a .cube file outside the built-in LUTs needs local file access" },
  update_effect_tool: { optional: ["media.importPath"], partialNote: "a lut_path .cube file outside the built-in LUTs needs local file access" },
  apply_color_tool: {
    optional: ["frames", "media.importPath"],
    partialNote: "without frame rendering there is no after preview; a .cube file outside the built-in LUTs needs local file access",
  },
  apply_look_tool: {
    optional: ["frames", "media.importPath"],
    partialNote: "without frame rendering there is no after preview; a .cube file outside the built-in LUTs needs local file access",
  },
  match_color_to_reference_tool: { optional: ["media.importPath"], partialNote: "referenceImagePath needs local file access" },
  list_luts_tool: { webNote: "the 50 built-in LUTs; the desktop also lists the user's LUT folder" },
  process_clip_effect_tool: { desktopOnly: "OpenCV clip analysis (Stabilizer, Tracker, Object Detector, Object Mask)" },
  add_effect_tool: {
    webNote: "Stabilizer, Tracker, Object Detector and Object Mask need Zenvi desktop's OpenCV analysis and are refused; Outline is kept for Zenvi desktop to draw",
  },
  set_keyframes_tool: {
    webNote:
      "animates volume, alpha, location_x/y, scale_x/y and rotation (Zenvi desktop: any keyframable clip property) and needs a value for every point (the desktop keeps the curve's value at a point without one)",
  },
  transcribe_media_tool: { methods: ["audio.transcribe"], webNote: SERVER_ASR },
  remove_words_tool: { methods: ["audio.transcribe"], webNote: `${SERVER_ASR}; cuts use exact word timings only` },
  detect_beats_tool: { methods: ["audio.decodePcm"] },
  detect_onsets_tool: { methods: ["audio.decodePcm"] },
  snap_cuts_to_onsets_tool: { methods: ["audio.decodePcm"] },
  detect_music_structure_tool: { methods: ["audio.decodePcm"] },
  spot_action_foley_tool: {
    methods: ["media.decodeLuma"],
    optional: ["audio.decodePcm", "media.writeGenerated"],
    partialNote: "without audio decoding cues are not checked against the clip's own sound; without generated media place=true is refused",
  },
  shot_length_ramp_tool: { optional: ["audio.decodePcm"], partialNote: "without audio decoding snap=beats and snap=onsets are refused; the curve, the motif and the settle shot always work" },
  master_audio_tool: { methods: ["audio.mixPcm"] },
  analyze_mix_tool: { methods: ["audio.mixPcm"] },
  pan_tool: { methods: ["audio.decodePcm", "media.writeGenerated"] },
  duck_tool: { optional: ["audio.mixPcm"], partialNote: "without mix rendering a duck under the voice needs depth_db and the voice's transcript or cues" },
  eq_tool: { webNote: "Zenvi desktop's libopenshot Parametric EQ computes its filters from the samples per frame instead of the sample rate, so the desktop hears these bands at other frequencies until that is fixed" },
  review_edit_tool: {
    optional: ["frames.renderSheet", "audio.measureMix", "storage.readText"],
    partialNote: "without frame composing there is no contact sheet, without audio mixing no loudness, silences or beat alignment, and without file reading no text safe-area check; the timeline numbers always come",
  },
  build_reel_tool: {
    optional: ["audio.decodePcm", "media.writeGenerated"],
    partialNote:
      "without audio decoding the cuts follow the style's tempo, not the music; without generated media there are no titles or flashes, and the motion styles (ui_promo, editorial_motion, product_callout, tutorial) are refused",
  },
  build_explainer_tool: {
    methods: ["media.writeGenerated"],
    optional: ["audio.transcribe", "motion"],
    partialNote: "without speech recognition the voice's words come from the media index (or the script, timed by length); without Zenvi Motion block rendering the counters and charts are kinetic titles (the receipt lists each fallback)",
  },
  build_product_launch_tool: {
    methods: ["media.writeGenerated"],
    optional: ["audio.decodePcm", "motion", "scenes3d", "media.importPath"],
    partialNote: "without Zenvi 3D the reveal is a kinetic headline block, without Zenvi Motion block rendering it, the features, the proof and the end card are native kinetic titles and the end card template; without audio decoding the sections follow 120 BPM (the receipt lists each fallback)",
  },
  build_talking_head_tool: {
    methods: ["media.writeGenerated"],
    optional: ["audio.transcribe", "mattes"],
    partialNote: "without speech recognition the takes' words come from the media index (a take with none plays whole, with no jump cuts); without subject matting the hook is set over the speaker instead of behind them (the receipt lists each fallback)",
  },
  build_trailer_tool: {
    methods: ["media.writeGenerated"],
    optional: ["audio.decodePcm"],
    partialNote: "without audio decoding the cuts follow the frame grid, not the score's beats",
  },
  add_sfx_tool: {
    methods: ["media.writeGenerated"],
    optional: ["library", "media.importUrl", "audio.decodePcm", "media.kitSample"],
    partialNote:
      "without Openverse, downloads and audio decoding only procedural recipes (and Freesound sounds where they can be downloaded and decoded) can be placed; without the recorded kit's cache recipes are synthesised (kit=synth)",
  },
  spot_sound_tool: {
    optional: ["audio.decodePcm", "motion"],
    partialNote: "without audio decoding cuts are weighed by `beats` (when given) instead of the music and the climax comes only from `climax_seconds`; without the motion host, blocks placed before blocks recorded their events are spotted by their edges only",
  },
  auto_sound_design_tool: {
    methods: ["media.writeGenerated"],
    optional: ["audio.decodePcm", "audio.mixPcm", "motion", "library", "media.importUrl", "media.kitSample"],
    partialNote:
      "without audio decoding cuts are weighed by `beats` (when given) instead of the music, the climax comes only from `climax_seconds`, effects keep their designed levels instead of being levelled over what plays under them, and sources=library / mixed are refused; without Openverse library sounds come from Freesound (signed in); without the recorded kit's cache the sounds are synthesised (kit=synth)",
  },
  add_vignette_tool: { methods: ["media.writeGenerated"] },
  add_shape_mask_tool: { methods: ["media.writeGenerated"] },
  search_sound_library_tool: { optional: ["media.kitSample"], partialNote: "without the recorded kit's cache the library is searched but its sounds cannot be placed" },
  generate_sfx_tool: { methods: ["media.writeGenerated", "audio.decodePcm", "audio.generateSfx"] },
  search_sfx_tool: { optional: ["library", "stock"], partialNote: "without Openverse only procedural recipes and Freesound (with stock search) are searched" },
  create_sound_kit_tool: {
    optional: ["library", "media.importUrl", "audio.decodePcm", "media.writeGenerated"],
    partialNote: "without Openverse (or stock search), downloads and audio decoding only procedural kits are made",
  },
  sequence_shots_tool: {
    optional: ["frames.sampleFrames"],
    partialNote: "without frame sampling each shot is compared on a few rendered frames (its ends and five through it), so its energy is coarser",
  },
  match_cut_montage_tool: {
    optional: ["audio.decodePcm", "media.writeGenerated", "frames"],
    partialNote:
      "without audio decoding the cuts follow 120 BPM, not the music; without generated media there are no flash frames; without frame rendering files need subjects boxes (no circle search)",
  },
  review_render_tool: { methods: ["media.inspectRender"] },
  pin_to_track_tool: { optional: ["media.writeGenerated"], partialNote: "without generated media no callout (label) is drawn; existing clips can still be pinned (clip_id)" },
  add_guide_overlay_tool: { methods: ["media.writeGenerated"] },
  add_motion_template_tool: {
    methods: ["media.writeGenerated"],
    optional: ["audio.decodePcm"],
    partialNote: "without audio decoding the entrances follow `beats` or `bpm` (default 120 BPM), not the music on the timeline",
  },
  // Zenvi FX renders with ffmpeg next to the media (the CLI and local MCP server offer fx).
  apply_fx_tool: { methods: ["media.importPath"] },
  update_fx_tool: { methods: ["media.importPath"] },
  datamosh_cut_tool: { methods: ["media.importPath"] },
  remove_fx_tool: {
    optional: ["fx", "media.importPath"],
    partialNote: "removing every effect (back to the original clip) works anywhere; removing one of several re-renders the rest, which needs Zenvi FX",
  },
  diarize_media_tool: { desktopOnly: "on-device speaker diarization" },
  search_media_local_tool: { desktopOnly: "the on-device visual index" },
  modify_clip_tool: { desktopOnly: "the desktop's ffmpeg cut, upload and splice pipeline" },
  generate_transition_clip_tool: { desktopOnly: "the desktop's ffmpeg pipeline (clip A + AI morph + clip B)" },
  suggest_motion_graphics_placements_tool: { desktopOnly: "deprecated on the desktop too; use propose_overlay_windows_tool" },
  // Project Files: missing media is the host's check; relinking and image sequences read local folders.
  list_project_files_tool: {
    optional: ["media.missing"],
    partialNote: "without a media check every file reports missing=null and missing_only is refused",
    webNote: "optimized_preview is always none: only Zenvi desktop makes and plays optimized previews",
  },
  remove_files_from_project_tool: { optional: ["media.missing"], partialNote: "scope='missing' needs a media check" },
  update_project_files_tool: {
    optional: ["media.importPath", "media.listPaths"],
    partialNote: "relinking (path, search_folder) needs local file access",
  },
  import_image_sequence_tool: { methods: ["media.listPaths"] },
  manage_optimized_previews_tool: { desktopOnly: "the optimized previews (proxies) Zenvi desktop builds and plays" },
  list_comfyui_templates_tool: { desktopOnly: COMFYUI },
  list_comfyui_jobs_tool: { desktopOnly: COMFYUI },
  create_media_with_comfyui_tool: { desktopOnly: COMFYUI },
  enhance_file_with_comfyui_tool: { desktopOnly: COMFYUI },
  cancel_comfyui_job_tool: { desktopOnly: COMFYUI },
  prepare_recording_tool: { desktopOnly: "the Recording dock (microphone, screen and webcam capture)" },
  // Project and export (editor_tools/project_export*.py): each surface's own projects, files and settings.
  list_recent_projects_tool: {
    methods: ["storage.recentProjects"],
    webNote: "the CLI lists Zenvi desktop's recent projects (its File > Recent Projects on this computer); the web editor the projects in this browser; Zenvi Cloud the person's cloud projects",
  },
  forget_recent_projects_tool: { desktopOnly: "its own recent projects list (File > Recent Projects)" },
  list_recovery_versions_tool: {
    methods: ["storage.recoveryCopies", "storage.currentPath"],
    webNote: "the copies Zenvi desktop zips each time it saves the project; the CLI's own saves make none",
  },
  restore_recovery_version_tool: {
    methods: ["storage.recoveryCopies", "storage.currentPath"],
    webNote: "the copies Zenvi desktop zips each time it saves the project; the CLI's own saves make none",
  },
  // Zenvi 3D renders with Blender on the person's computer (the host offers scenes3d only when it is installed).
  add_3d_scene_tool: { methods: ["media.importPath"] },
  rerender_3d_scene_tool: { methods: ["media.importPath"] },
  import_project_file_tool: { desktopOnly: "the EDL / Final Cut Pro XML converters (one implementation per conversion, in the desktop app)" },
  export_project_file_tool: { desktopOnly: "the EDL / Final Cut Pro XML converters (one implementation per conversion, in the desktop app)" },
  consolidate_project_media_tool: { methods: ["media.collect", "storage.currentPath"] },
  reset_caches_and_history_tool: {
    optional: ["ui.clearPlaybackCache"],
    partialNote: "target=playback_cache has nothing to clear: every frame is rendered from the project",
  },
  get_editor_layout_tool: {
    methods: ["ui.layout"],
    webNote: "the web editor's panels; it has no Color Grade or Recording view, scopes, saved custom views, floating panels or hidden toolbar",
  },
  set_editor_layout_tool: {
    methods: ["ui.layout"],
    webNote: "the web editor's panels; it has no Color Grade or Recording view, scopes, saved custom views, floating panels or hidden toolbar, and fullscreen needs a click",
  },
  get_preferences_tool: {
    methods: ["ui.preferences"],
    webNote: "the web editor's own settings (timeline snapping; autosave, undo depth, backend and shortcuts are read-only), not Zenvi desktop's Preferences",
  },
  set_preference_tool: {
    methods: ["ui.preferences"],
    webNote: "the web editor's own settings (timeline snapping; autosave, undo depth, backend and shortcuts are read-only), not Zenvi desktop's Preferences",
  },
  list_project_profiles_tool: {
    optional: ["storage.customProfiles"],
    partialNote: "the built-in profiles only: custom profiles live in Zenvi desktop's profiles folder (Zenvi desktop and the zenvi CLI)",
  },
  set_project_profile_tool: {
    optional: ["storage.customProfiles"],
    partialNote: "a size or frame rate no built-in profile has needs a custom profile, which only Zenvi desktop and the zenvi CLI keep",
  },
  set_project_setting_tool: {
    optional: ["storage.customProfiles"],
    partialNote: "a size or frame rate no built-in profile has needs a custom profile, which only Zenvi desktop and the zenvi CLI keep",
    webNote:
      "save_as_default is refused: the web editor's settings have no default sample rate or channels for new projects, and the CLI and Zenvi Cloud have no editor settings",
  },
  manage_custom_profiles_tool: {
    methods: ["storage.customProfiles"],
    webNote: "Zenvi desktop's profiles folder on this computer; set_default is refused (the default profile is a Zenvi desktop preference)",
  },
  list_export_presets_tool: {
    optional: ["exporter.supports"],
    partialNote: "without a codec check, every preset whose container the engine's exporters write counts as available",
    webNote: "the built-in presets (Zenvi desktop also lists the user's own presets folder)",
  },
  save_frame_image_tool: {
    optional: ["storage.writeBytes"],
    partialNote: "without file saving the frame is attached to the result",
    webNote: "the CLI writes the file (a relative path starts at the project's folder, the desktop's default is its export folder); the web editor downloads it; Zenvi Cloud answers with a download link and renders PNG only",
  },
  // Subject mattes: made by the host (the CLI runs Robust Video Matting); composites reuse a matte already in the bin.
  ...Object.fromEntries(
    ["text_behind_subject_tool", "replace_background_tool", "subject_glow_tool", "pop_out_tool"].map((name) => [
      name,
      {
        methods: ["media.writeGenerated"],
        optional: ["mattes"],
        partialNote: "without subject matting only footage whose matte is already in the bin (made by the zenvi CLI) can be composited",
      } satisfies ToolNeeds,
    ]),
  ),
  export_files_to_folder_tool: {
    methods: ["storage.exportMedia"],
    optional: ["exporter"],
    partialNote: "sub-clips and image sequences are rendered to MP4, which needs video rendering",
    webNote: "the CLI copies into the folder (relative to the project's folder; default the project's folder); the web editor downloads each file; Zenvi Cloud answers with download links",
  },
};

export interface SurfaceProfile {
  title: string;
  /** Where the host is implemented. */
  host: string;
  capabilities: readonly HostCapability[];
  methods: readonly HostMethod[];
  /** Capabilities and methods present only in some sessions (signed in, browser support, an installed program). */
  conditional?: Partial<Record<HostCapability | HostMethod, string>>;
  /** Tools the surface does not expose at all. */
  hidden?: readonly string[];
}

/** What each web surface's host provides (as implemented in this repo). */
export const SURFACE_PROFILES: Readonly<Record<Exclude<AvailabilitySurface, "desktop">, SurfaceProfile>> = {
  editor: {
    title: "Web editor (Zenvi Assistant, command palette)",
    host: "apps/editor/src/features/editor/assistant/host.ts",
    capabilities: ["media", "player", "ui", "exporter", "frames", "backend", "stock", "storage", "assets", "audio", "library"],
    methods: [
      "media.importUrl",
      "media.pickFiles",
      "media.writeGenerated",
      "media.missing",
      "storage.readText",
      "storage.writeText",
      "storage.writeBytes",
      "storage.exportMedia",
      "storage.currentPath",
      "storage.recentProjects",
      "ui.openExportDialog",
      "audio.decodePcm",
      "audio.mixPcm",
      "audio.transcribe",
      "ui.selection",
      "ui.setSelection",
      "ui.timelineView",
      "ui.showTimelineRange",
      "ui.setTimelineMode",
      "ui.layout",
      "ui.preferences",
      "ui.clearPlaybackCache",
      "exporter.supports",
    ],
    conditional: { exporter: "browsers with WebCodecs export", backend: "signed in to Zenvi", stock: "signed in to Zenvi" },
  },
  cli: {
    title: "CLI and local MCP server (zenvi, zenvi mcp)",
    host: "packages/render-node/src/host/node-host.ts",
    capabilities: ["media", "exporter", "frames", "audio", "storage", "backend", "stock", "assets", "mattes", "shots", "motion", "scenes3d", "fx", "library", "watch"],
    methods: [
      "media.importPath",
      "media.listPaths",
      "media.importUrl",
      "media.writeGenerated",
      "media.missing",
      "media.fetchWebVideo",
      "media.kitSample",
      "media.inspectRender",
      "media.decodeLuma",
      "storage.open",
      "storage.readText",
      "storage.writeText",
      "storage.writeBytes",
      "storage.saveCopy",
      "storage.readCopy",
      "storage.exportMedia",
      "storage.currentPath",
      "storage.recentProjects",
      "storage.recoveryCopies",
      "storage.customProfiles",
      "media.collect",
      "audio.decodePcm",
      "audio.mixPcm",
      "audio.transcribe",
      "audio.generateSfx",
      "exporter.supports",
      "frames.fontFamilies",
      "frames.renderSheet",
      "frames.sampleFrames",
      "audio.measureMix",
    ],
    conditional: {
      backend: "signed in with zenvi login",
      stock: "signed in with zenvi login",
      "media.fetchWebVideo": "yt-dlp is installed; zenvi doctor checks",
      "audio.generateSfx": "ELEVENLABS_API_KEY is set to a key on a paid ElevenLabs plan",
      mattes: "onnxruntime-node is installed; the matting model downloads on first use",
      "audio.transcribe": "zenvi speech setup ran (on device, free), else signed in with zenvi login",
      shots: "onnxruntime-node is installed; the SigLIP model (about 213 MB) downloads once when the person agrees (zenvi shots setup, or embed_media_tool download=true)",
      motion: "headless Chrome is installed: zenvi motion setup",
      scenes3d: "Blender 4.2+ is installed (or ZENVI_BLENDER points to it)",
      fx: "ffmpeg is installed (ZENVI_FX=0 turns it off)",
      watch: "signed in with zenvi login (or ZENVI_GEMINI_API_KEY is set, for development)",
    },
  },
  cloud: {
    title: "Zenvi Cloud remote MCP server (ChatGPT, Claude.ai)",
    host: "packages/cloud/src/mcp/engine.ts",
    capabilities: ["media", "frames", "storage", "assets", "audio", "backend", "stock", "exporter", "mattes", "motion", "watch"],
    methods: [
      "media.importUrl",
      "media.writeGenerated",
      "media.missing",
      "storage.readText",
      "storage.writeText",
      "storage.writeBytes",
      "storage.exportMedia",
      "storage.currentPath",
      "storage.recentProjects",
      "audio.decodePcm",
      "audio.mixPcm",
      "audio.transcribe",
      "frames.fontFamilies",
      "exporter.supports",
    ],
    conditional: {
      frames: "the render worker is configured",
      exporter: "the render worker is configured",
      media: "ffprobe is available",
      assets: "the engine's assets (title templates, emoji) are bundled",
      audio: "ffmpeg is available",
      "audio.mixPcm": "ffprobe is available",
      backend: "the server is set up to call the Zenvi backend",
      stock: "the server calls the Zenvi backend, or has its own PEXELS_API_KEY / FREESOUND_API_KEY",
      mattes: "onnxruntime-node is in the image (the matting model downloads on first use; up to 10 s of video per call)",
      motion: "the image has chrome-headless-shell (one block renders at a time)",
      watch: "the server calls the Zenvi backend and has ffmpeg; the render must be media in the project's bin",
    },
    hidden: [
      "new_project_tool",
      "open_project_tool",
      "save_project_tool",
      "import_files_tool",
      "play_tool",
      "go_to_start_tool",
      "go_to_end_tool",
      "zoom_in_tool",
      "zoom_out_tool",
      "center_on_playhead_tool",
      "watch_clip_tool",
      "get_editor_layout_tool",
      "set_editor_layout_tool",
      "get_preferences_tool",
      "set_preference_tool",
      // Slower than a ChatGPT tool call. The cloud server starts generate_video instead.
      "generate_video_and_add_to_timeline_tool",
      // Zenvi 3D renders with Blender, which the cloud has not: its scenes cannot be added there.
      "list_3d_scenes_tool",
    ],
  },
};

export interface ToolAvailability {
  editor: Availability;
  cli: Availability;
  cloud: Availability;
  desktop: Availability;
  /** Why a web surface is partial or refuses, keyed by surface. */
  notes: Partial<Record<AvailabilitySurface, string>>;
}

function has(profile: SurfaceProfile, need: HostCapability | HostMethod): boolean {
  return need.includes(".") ? profile.methods.includes(need as HostMethod) : profile.capabilities.includes(need as HostCapability);
}

function needName(need: HostCapability | HostMethod): string {
  if (!need.includes(".")) return capabilityName(need as HostCapability);
  const names: Record<HostMethod, string> = {
    "media.importPath": "local file access",
    "media.listPaths": "path listing",
    "media.importUrl": "URL downloads",
    "media.pickFiles": "a file picker",
    "media.writeGenerated": "storing generated media",
    "media.missing": "checking for missing media",
    "media.fetchWebVideo": "fetching videos from web pages, which only runs on the person's own computer (the zenvi CLI with yt-dlp)",
    "media.kitSample": "fetching Zenvi's recorded sound kit (the zenvi CLI and local MCP cache it)",
    "media.inspectRender": "reading a rendered file with ffmpeg (the zenvi CLI and local MCP)",
    "storage.open": "opening project files",
    "storage.readText": "reading files",
    "storage.writeText": "writing files",
    "ui.openExportDialog": "an export dialog",
    "audio.decodePcm": "audio decoding",
    "audio.mixPcm": "rendering the timeline mix to measure its loudness",
    "audio.transcribe": "speech recognition",
    "audio.generateSfx": "generating sound effects (the zenvi CLI and local MCP with ELEVENLABS_API_KEY on a paid ElevenLabs plan)",
    "ui.selection": "reading the editor's selection",
    "ui.setSelection": "selecting in the editor",
    "ui.timelineView": "reading the timeline view",
    "ui.showTimelineRange": "zooming the timeline to a range",
    "ui.setTimelineMode": "the timeline toolbar's modes",
    "ui.layout": "an editor window's panels",
    "ui.preferences": "an editor's settings",
    "ui.clearPlaybackCache": "a playback cache",
    "storage.writeBytes": "saving files (images)",
    "storage.saveCopy": "saving a copy of the project as another project",
    "storage.readCopy": "reading another project without opening it",
    "storage.exportMedia": "copying media out (to a folder, a download or a link)",
    "storage.currentPath": "knowing where the project is saved",
    "storage.recentProjects": "a list of recent projects",
    "storage.recoveryCopies": "Zenvi desktop's recovery copies",
    "storage.customProfiles": "Zenvi desktop's custom profiles folder",
    "media.collect": "copying media into the project's folder",
    "exporter.supports": "checking which codecs it can encode",
    "frames.fontFamilies": "listing the fonts titles render with",
    "frames.renderSheet": "composing contact sheets",
    "media.decodeLuma": "decoding video frames for motion analysis",
    "frames.sampleFrames": "decoding a stretch of frames in one pass",
    "audio.measureMix": "mixing and measuring the audio",
  };
  return names[need as HostMethod];
}

function onSurface(tool: CatalogTool, surface: Exclude<AvailabilitySurface, "desktop">): { level: Availability; note?: string } {
  const profile = SURFACE_PROFILES[surface];
  const needs = TOOL_NEEDS[tool.name] ?? {};
  const surfaceKey = surface === "cloud" ? "mcp" : surface === "cli" ? "cli" : "editor";
  if (!tool.surfaces.includes(surfaceKey)) return { level: "no", note: "not exposed on this surface" };
  if (profile.hidden?.includes(tool.name)) return { level: "no", note: "hidden: belongs to a local app" };
  if (needs.desktopOnly) return { level: "no", note: `needs ${needs.desktopOnly} (Zenvi desktop)` };
  const missing = [...(tool.requires ?? []), ...(needs.methods ?? [])].filter((n) => !has(profile, n));
  if (needs.anyOf && !needs.anyOf.some((n) => has(profile, n))) missing.push(...needs.anyOf);
  if (missing.length > 0) return { level: "no", note: `needs ${[...new Set(missing)].map(needName).join(" and ")}` };
  const conditions = [...(tool.requires ?? []), ...(needs.methods ?? [])].map((need) => profile.conditional?.[need]).filter((c): c is string => Boolean(c));
  const lacking = (needs.optional ?? []).filter((n) => !has(profile, n));
  const pendingArgs = tool.contract ? (PENDING_DESKTOP_ARGS[tool.name as ContractToolName] ?? []) : [];
  const notes = [
    ...(needs.webNote ? [needs.webNote] : []),
    ...(lacking.length > 0 && needs.partialNote ? [needs.partialNote] : []),
    ...(pendingArgs.length > 0 ? [`only Zenvi desktop takes ${pendingArgs.join(", ")} so far`] : []),
    ...(conditions.length > 0 ? [`only when ${conditions.join(" and ")}`] : []),
  ];
  if (needs.webNote || lacking.length > 0 || pendingArgs.length > 0) return { level: "partial", note: notes.join("; ") };
  return conditions.length > 0 ? { level: "yes", note: notes.join("; ") } : { level: "yes" };
}

/** Where one tool works. */
export function toolAvailability(tool: CatalogTool): ToolAvailability {
  const out: ToolAvailability = { editor: "no", cli: "no", cloud: "no", desktop: tool.contract ? "yes" : "no", notes: {} };
  if (!tool.contract) {
    out.notes.desktop = DESKTOP_NAMES_ON_DIRECT_TOOLS.has(tool.name as ContractToolName)
      ? "web-only direct tool; Zenvi desktop's tool of this name takes other arguments (not ported yet)"
      : "web-only direct tool";
  }
  for (const surface of ["editor", "cli", "cloud"] as const) {
    const { level, note } = onSurface(tool, surface);
    out[surface] = level;
    if (note) out.notes[surface] = note;
  }
  return out;
}

/** The matrix for a list of tools, in order. */
export function availabilityMatrix(tools: readonly CatalogTool[]): { tool: CatalogTool; availability: ToolAvailability }[] {
  return tools.map((tool) => ({ tool, availability: toolAvailability(tool) }));
}
