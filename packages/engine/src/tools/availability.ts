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
  | "storage.open"
  | "storage.readText"
  | "storage.writeText"
  | "ui.openExportDialog"
  | "audio.decodePcm";

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
const WATCH_NOTE = "without frame rendering and the Zenvi backend, windows are not vision-checked";

/** Run-time needs beyond `requires`, per tool. */
export const TOOL_NEEDS: Readonly<Record<string, ToolNeeds>> = {
  // Placement and search refine with a vision watch when the host can watch.
  add_clip_to_timeline_tool: { optional: WATCH, partialNote: WATCH_NOTE },
  split_file_add_clip_tool: { optional: WATCH, partialNote: WATCH_NOTE },
  search_clip_scenes_tool: { optional: ["backend", "frames"], partialNote: "without the Zenvi backend only chapter and scene descriptions are searched" },
  slice_clip_at_best_match_tool: { optional: ["backend", "frames"], partialNote: "without the Zenvi backend only explicit times and scene descriptions work" },
  duck_under_speech_tool: { optional: ["audio"], partialNote: "without audio analysis only indexed transcript cues find the speech" },
  watch_clip_tool: { optional: ["media.importPath"], partialNote: "file_path needs local file access" },
  export_video_tool: { anyOf: ["exporter", "ui.openExportDialog"] },
  save_project_tool: {},
  open_project_tool: { methods: ["storage.open"] },
  import_files_tool: { methods: ["media.importPath"], optional: ["media.listPaths"], partialNote: "folders and globs need path listing" },
  import_video_url_and_add_to_timeline_tool: { methods: ["media.importUrl"] },
  import_stock_media_tool: { methods: ["media.importUrl"], optional: ["backend", "media.importPath"], partialNote: "search needs the Zenvi backend; local_path needs local file access" },
  place_motion_graphic_tool: { optional: ["media.importUrl"], partialNote: "url= needs URL downloads; file_id works" },
  fetch_motion_graphics_video_tool: { methods: ["media.importUrl"] },
  fetch_remotion_video_from_supabase_tool: { methods: ["media.importUrl"] },
  generate_video_and_add_to_timeline_tool: { methods: ["media.importUrl"] },
  generate_tts_and_add_to_timeline_tool: { methods: ["media.writeGenerated"] },
  add_title_tool: { methods: ["media.writeGenerated"] },
  add_captions_tool: {
    methods: ["media.writeGenerated"],
    optional: ["storage.readText"],
    partialNote: "srtPath needs file reading",
    webNote: "captions come from indexed transcripts or an SRT/VTT file; the desktop also transcribes on device",
  },
  export_captions_tool: { methods: ["storage.writeText"], webNote: "captions come from indexed transcripts (no on-device ASR)" },
  list_title_templates_tool: { optional: ["storage.readText"], partialNote: "kind=project needs reading project files" },
  edit_title_tool: {
    methods: ["media.writeGenerated", "storage.readText"],
    webNote: "the edited version is a new Project Files entry (new file_id) in every clip; fonts are not checked against installed fonts",
  },
  add_animated_title_tool: {
    methods: ["media.writeGenerated"],
    webNote: "2D keyframed versions of the Blender templates (no 3D depth or particles); earth, magic_wand, snow and picture_frames_4 need Zenvi desktop",
  },
  add_timer_tool: { optional: ["media.writeGenerated"], partialNote: "without storing generated images only timeline_clip_id works" },
  get_transcript_tool: { webNote: "indexed transcript cues with estimated word timings (no on-device ASR)" },
  reindex_project_file_tool: { webNote: "reports files that are already indexed; uploading for indexing runs in Zenvi desktop" },
  wait_until_project_indexed_tool: { webNote: "reports indexing status once; does not wait" },
  remove_silence_tool: { webNote: "energy VAD on the host's audio analysis" },
  set_clip_audio_video_tool: {
    webNote: "waveform=show changes nothing, since the web timeline draws the waveform of every clip with sound; waveform=hide is refused",
  },
  transcribe_media_tool: { desktopOnly: "on-device speech recognition" },
  remove_words_tool: { desktopOnly: "word timings from on-device speech recognition" },
  detect_beats_tool: { methods: ["audio.decodePcm"] },
  build_reel_tool: {
    optional: ["audio.decodePcm", "media.writeGenerated"],
    partialNote: "without audio decoding the cuts follow the style's tempo, not the music; without generated media there are no titles or flashes",
  },
  diarize_media_tool: { desktopOnly: "on-device speaker diarization" },
  search_media_local_tool: { desktopOnly: "the on-device visual index" },
  modify_clip_tool: { desktopOnly: "the desktop's ffmpeg cut, upload and splice pipeline" },
  generate_transition_clip_tool: { desktopOnly: "the desktop's ffmpeg pipeline (clip A + AI morph + clip B)" },
  suggest_motion_graphics_placements_tool: { desktopOnly: "deprecated on the desktop too; use propose_overlay_windows_tool" },
};

export interface SurfaceProfile {
  title: string;
  /** Where the host is implemented. */
  host: string;
  capabilities: readonly HostCapability[];
  methods: readonly HostMethod[];
  /** Capabilities present only in some sessions (signed in, browser support). */
  conditional?: Partial<Record<HostCapability, string>>;
  /** Tools the surface does not expose at all. */
  hidden?: readonly string[];
}

/** What each web surface's host provides (as implemented in this repo). */
export const SURFACE_PROFILES: Readonly<Record<Exclude<AvailabilitySurface, "desktop">, SurfaceProfile>> = {
  editor: {
    title: "Web editor (Zenvi Assistant, command palette)",
    host: "apps/editor/src/features/editor/assistant/host.ts",
    capabilities: ["media", "player", "ui", "exporter", "frames", "backend", "storage", "assets", "audio"],
    methods: ["media.importUrl", "media.pickFiles", "media.writeGenerated", "storage.readText", "ui.openExportDialog", "audio.decodePcm"],
    conditional: { exporter: "browsers with WebCodecs export", backend: "signed in to Zenvi" },
  },
  cli: {
    title: "CLI and local MCP server (zenvi, zenvi mcp)",
    host: "packages/render-node/src/host/node-host.ts",
    capabilities: ["media", "exporter", "frames", "audio", "storage", "backend", "assets"],
    methods: [
      "media.importPath",
      "media.listPaths",
      "media.importUrl",
      "media.writeGenerated",
      "storage.open",
      "storage.readText",
      "storage.writeText",
      "audio.decodePcm",
    ],
    conditional: { backend: "signed in with zenvi login" },
  },
  cloud: {
    title: "Zenvi Cloud remote MCP server (ChatGPT, Claude.ai)",
    host: "packages/cloud/src/mcp/engine.ts",
    capabilities: ["media", "frames", "storage", "assets", "audio", "backend"],
    methods: ["media.importUrl", "media.writeGenerated", "storage.readText", "storage.writeText", "audio.decodePcm"],
    conditional: {
      frames: "the render worker is configured",
      media: "ffprobe is available",
      assets: "the engine's assets (title templates, emoji) are bundled",
      audio: "ffmpeg is available",
      backend: "the server is set up to call the Zenvi backend",
    },
    hidden: [
      "new_project_tool",
      "open_project_tool",
      "save_project_tool",
      "import_files_tool",
      "export_video_tool",
      "play_tool",
      "go_to_start_tool",
      "go_to_end_tool",
      "zoom_in_tool",
      "zoom_out_tool",
      "center_on_playhead_tool",
      "watch_clip_tool",
      // Slower than a ChatGPT tool call. The cloud server starts generate_video instead.
      "generate_video_and_add_to_timeline_tool",
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
    "storage.open": "opening project files",
    "storage.readText": "reading files",
    "storage.writeText": "writing files",
    "ui.openExportDialog": "an export dialog",
    "audio.decodePcm": "audio decoding",
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
  const conditions = [...(tool.requires ?? [])].map((cap) => profile.conditional?.[cap]).filter((c): c is string => Boolean(c));
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
