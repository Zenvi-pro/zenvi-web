/**
 * Desktop tools the engine has not ported yet.
 *
 * The contract (schemas.gen.ts) is every tool Zenvi desktop lists. A name in
 * PENDING_DESKTOP_TOOLS has no engine implementation: it is not in
 * `allTools`, no surface lists it, and `runTool` answers it with the standard
 * "Error: <name> is not available in this Zenvi surface" refusal, which the
 * Zenvi Assistant does not retry. To port a tool, implement it in catalog/
 * with `contractTool` and delete its line here. One name per line, sorted.
 */

import type { JsonSchemaObject } from "./json-schema.js";
import type { ContractToolName } from "./schemas.gen.js";

export const PENDING_DESKTOP_TOOLS: ReadonlySet<ContractToolName> = new Set<ContractToolName>([
  "add_transitions_between_clips_tool",
  "cancel_comfyui_job_tool",
  "capture_editor_screenshot_tool",
  "consolidate_project_media_tool",
  "copy_transition_tool",
  "create_media_with_comfyui_tool",
  "create_subclips_tool",
  "enhance_file_with_comfyui_tool",
  "export_files_to_folder_tool",
  "export_project_file_tool",
  "forget_recent_projects_tool",
  "generate_image_and_add_to_timeline_tool",
  "get_editor_layout_tool",
  "get_log_paths_tool",
  "get_preferences_tool",
  "import_image_sequence_tool",
  "import_project_file_tool",
  "ingest_web_video_tool",
  "list_comfyui_jobs_tool",
  "list_comfyui_templates_tool",
  "list_export_presets_tool",
  "list_project_files_tool",
  "list_project_profiles_tool",
  "list_recent_projects_tool",
  "list_recovery_versions_tool",
  "list_timeline_transitions_tool",
  "manage_custom_profiles_tool",
  "manage_optimized_previews_tool",
  "mcp_health_tool",
  "prepare_recording_tool",
  "remove_files_from_project_tool",
  "remove_transition_tool",
  "reset_caches_and_history_tool",
  "restore_recovery_version_tool",
  "reverse_transition_tool",
  "save_frame_image_tool",
  "send_assistant_prompt_tool",
  "set_editor_layout_tool",
  "set_preference_tool",
  "set_project_profile_tool",
  "update_project_files_tool",
  "update_transition_tool",
  "wait_for_editor_job_tool",
  "zenvi_api_request",
]);

/**
 * Arguments of ported tools that Zenvi desktop accepts and the engine does not
 * honour yet (the desktop's schema grew after the port). A call that sets one
 * to anything but its schema default is refused before anything changes
 * (`pendingArgumentMessage`), rather than ignored. Each list is sorted; port
 * an argument, then delete it here. Arguments whose desktop default the engine
 * does not follow either are listed in docs/TOOLS.md under Divergences.
 */
export const PENDING_DESKTOP_ARGS: { readonly [N in ContractToolName]?: readonly string[] } = {
  add_effect_tool: ["processing", "properties", "scope", "timeline_clip_ids"],
  add_title_tool: [
    "background_color",
    "fade_in_seconds",
    "fade_out_seconds",
    "font",
    "font_scale",
    "font_style",
    "font_weight",
    "lines",
    "screen_position",
    "subtitle",
    "text_color",
  ],
  export_video_tool: [
    "audio_bitrate",
    "audio_codec",
    "channels",
    "container",
    "end",
    "export_type",
    "file_name",
    "folder",
    "fps",
    "height",
    "image_format",
    "interlaced",
    "preset",
    "profile",
    "quality",
    "range",
    "sample_rate",
    "start",
    "video_bitrate",
    "video_codec",
    "width",
  ],
  new_project_tool: ["profile"],
  open_project_tool: ["recent_index"],
  set_export_setting_tool: ["clear"],
  set_keyframes_tool: ["ease"],
  set_project_setting_tool: ["channels", "orientation", "preset", "profile", "reframe", "save_as_default"],
};

/** The refusal for a pending argument: not "not available", so the Assistant retries without it. */
export function pendingArgumentMessage(tool: string, arg: string): string {
  return `Error: ${tool} cannot use ${arg} in this Zenvi surface yet (only Zenvi desktop can). Call it again without ${arg}.`;
}

function isUnset(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

/** The first pending argument a validated call sets to something other than its default (empty lists and objects count as unset). */
export function pendingArgumentIn(tool: string, input: unknown, schema: JsonSchemaObject): string | undefined {
  const pending = PENDING_DESKTOP_ARGS[tool as ContractToolName];
  if (!pending || typeof input !== "object" || input === null) return undefined;
  const values = input as Record<string, unknown>;
  return pending.find((arg) => {
    const value = values[arg];
    if (isUnset(value)) return false;
    const fallback = schema.properties[arg]?.default;
    return fallback === undefined || JSON.stringify(value) !== JSON.stringify(fallback);
  });
}

/**
 * Desktop tool names the engine already uses for a web-only direct tool
 * (catalog/direct.ts) with older, different arguments. The name works on
 * every surface, but the desktop's version of the tool is not ported: porting
 * it replaces the direct tool (keep the direct tool's arguments as aliases)
 * and removes the name here. All of them are ported now.
 */
export const DESKTOP_NAMES_ON_DIRECT_TOOLS: ReadonlySet<ContractToolName> = new Set<ContractToolName>([]);
