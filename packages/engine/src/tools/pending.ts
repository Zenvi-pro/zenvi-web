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
  "capture_editor_screenshot_tool",
  "get_log_paths_tool",
  "send_assistant_prompt_tool",
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
  add_effect_tool: ["processing"],
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

/**
 * Desktop tools newer than the contract ref (schemas.gen.ts): the Zenvi
 * Assistant offers them to an editor that says media-index-v2 (zenvi-backend
 * core/tools/openshot/editor_tools_manifest.json at dd6f01c, its frontend
 * entries), and the engine runs none of them. The web editor names them in
 * `unavailable_tools` so the backend neither binds them nor lists them in
 * find_tools. Moving the contract past them makes each a contract name: then
 * it belongs in PENDING_DESKTOP_TOOLS (or is ported) and leaves this list.
 */
export const PENDING_DESKTOP_TOOLS_AFTER_CONTRACT: ReadonlySet<string> = new Set<string>([
  "analyze_music_tool",
  "audition_music_tool",
  "balance_mix_tool",
  "build_recreation_tool",
  "call_link_host_tool",
  "check_media_health_tool",
  "check_recreation_tool",
  "describe_shots_tool",
  "erase_people_data_tool",
  "export_to_after_effects_tool",
  "export_to_hyperframes_tool",
  "export_to_premiere_tool",
  "export_to_remotion_tool",
  "find_retakes_tool",
  "fix_person_track_tool",
  "get_clip_context_tool",
  "get_edit_brief_tool",
  "get_edit_style_tool",
  "get_framing_tool",
  "get_linked_clip_tool",
  "get_look_profile_tool",
  "get_lyrics_tool",
  "get_moment_tool",
  "get_project_overview_tool",
  "get_segment_dossier_tool",
  "get_voice_edges_tool",
  "harmonize_look_tool",
  "hyperframes_edit_file_tool",
  "hyperframes_list_files_tool",
  "hyperframes_read_file_tool",
  "hyperframes_run_tool",
  "hyperframes_setup_tool",
  "hyperframes_write_file_tool",
  "import_hyperframes_project_tool",
  "import_linked_media_tool",
  "import_motion_graphic_tool",
  "import_remotion_project_tool",
  "import_timeline_xml_tool",
  "index_long_file_tool",
  "index_status_tool",
  "list_link_hosts_tool",
  "list_people_tool",
  "list_remotion_compositions_tool",
  "listen_tool",
  "locate_in_footage_tool",
  "locate_person_tool",
  "manim_setup_tool",
  "merge_people_tool",
  "name_person_tool",
  "open_linked_source_tool",
  "people_status_tool",
  "plan_recreation_tool",
  "refine_cut_tool",
  "reframe_to_subject_tool",
  "render_manim_tool",
  "render_motion_graphic_tool",
  "rerender_linked_clip_tool",
  "scan_people_tool",
  "search_footage_tool",
  "search_stock_video_tool",
  "send_to_after_effects_tool",
  "send_to_premiere_tool",
  "set_edit_brief_tool",
  "setup_people_tool",
  "slice_on_beats_tool",
  "storyboard_tool",
  "sync_cuts_to_beats_tool",
  "unlink_clip_tool",
  "update_linked_clip_tool",
  "view_audio_tool",
  "view_frames_tool",
  "who_is_this_tool",
]);
