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
  "mcp_health_tool",
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
