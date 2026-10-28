/**
 * The engine tool catalog (`@zenvi/engine/tools`, W4) on the remote MCP
 * server. Every call: resolve the project → load it → `runTool` on a
 * ProjectDocument with the cloud ToolHost (one transaction, validated before
 * anything changes) → save with If-Match (mcp/projects.ts `editProject`).
 *
 * Tools that only make sense next to a local app (file dialogs, playback, UI
 * zoom, local save/open) or that the cloud replaces with its own
 * (`preview_frame`, the CLI's render_video, new/open project) are not
 * exposed. export_video_tool is: its renders are render jobs (mcp/host.ts).
 */

import type { AnyTool, HostCapability, ToolContext, ToolResult } from "@zenvi/engine";
import { allTools, capabilityName, runTool } from "@zenvi/engine/tools";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { guard, jsonSchema } from "./define.js";
import { createCloudHost } from "./host.js";
import { editProject, resolveProjectId } from "./projects.js";
import { errorResult, okResult } from "./results.js";
import type { JsonSchemaObject, McpCallContext, McpTool } from "./types.js";

export interface EngineRegistry {
  tools: readonly AnyTool[];
  run(ctx: ToolContext, name: string, args: unknown): Promise<ToolResult>;
  /** A host capability in words ("Zenvi 3D (Blender on this computer)"). */
  capabilityName?: (capability: HostCapability) => string;
}

/** Engine tools that stay off the remote MCP server. */
export const HIDDEN_ENGINE_TOOLS = new Set([
  // Local project files and dialogs — cloud projects are managed by the cloud tools.
  "new_project_tool",
  "open_project_tool",
  "save_project_tool",
  "import_files_tool",
  "render_video",
  "render_video_tool",
  // Playback, timeline-view state, panels and editor settings belong to an open editor window.
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
  // Kling is slower than ChatGPT's tool budget. generate_video starts a job instead.
  "generate_video_and_add_to_timeline_tool",
  // Zenvi 3D renders with Blender, which this server has not: listing scenes it cannot add misleads.
  "list_3d_scenes_tool",
]);

const PROJECT_ID_PROPERTY = {
  type: "string",
  description: "Cloud project id (c_…). Defaults to the project opened with open_project or create_project.",
} as const;

const ENVELOPE: JsonSchemaObject = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    project_id: { type: "string" },
    data: { description: "Receipt: ids created/changed, or the requested information." },
  },
  required: ["ok", "project_id"],
};

/**
 * The catalog's own MCP input schema when the tool carries one (W4's
 * `CatalogTool.inputSchema`: the desktop's merged schema for contract tools),
 * which describes coerced string arguments better than a zod conversion.
 */
function catalogSchema(tool: AnyTool): JsonSchemaObject | undefined {
  const schema = (tool as { inputSchema?: unknown }).inputSchema;
  if (typeof schema !== "object" || schema === null || (schema as { type?: unknown }).type !== "object") return undefined;
  return structuredClone(schema) as JsonSchemaObject;
}

export function engineTools(
  registry: EngineRegistry,
  capabilities: Set<HostCapability>,
  reserved: ReadonlySet<string>,
  log: (message: string) => void = () => {},
): McpTool[] {
  const out: McpTool[] = [];
  for (const tool of registry.tools) {
    if (!tool.surfaces.includes("mcp") || HIDDEN_ENGINE_TOOLS.has(tool.name) || reserved.has(tool.name)) continue;
    if ((tool as { deprecated?: boolean }).deprecated === true) continue;
    if ((tool.requires ?? []).some((cap) => !capabilities.has(cap))) continue;
    let inputSchema: JsonSchemaObject;
    try {
      inputSchema = catalogSchema(tool) ?? jsonSchema(tool.input, "input");
    } catch (error) {
      log(`skipping engine tool ${tool.name}: no JSON schema (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const properties = { ...((inputSchema.properties as Record<string, unknown> | undefined) ?? {}), project_id: PROJECT_ID_PROPERTY };
    const readOnly = tool.annotations?.readOnlyHint === true;
    out.push({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: { ...inputSchema, properties },
      outputSchema: ENVELOPE,
      annotations: {
        title: tool.title,
        readOnlyHint: readOnly,
        // Undo does not make an edit non-destructive (ChatGPT review rule), so
        // mutating tools default to destructive unless the tool says otherwise.
        destructiveHint: tool.annotations?.destructiveHint ?? !readOnly,
        idempotentHint: tool.annotations?.idempotentHint ?? readOnly,
        openWorldHint: tool.annotations?.openWorldHint ?? false,
      },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: [readOnly ? SCOPE_READ : SCOPE_WRITE] }] },
      scope: readOnly ? SCOPE_READ : SCOPE_WRITE,
      call: (ctx, args) => guard(ctx, tool.name, () => callEngineTool(ctx, registry, tool, args)),
    });
  }
  return out;
}

/**
 * Why an engine tool this server does not list cannot run here, for a client
 * that calls it anyway (a model that knows it from the CLI or a skill): the
 * capabilities this server lacks, in words. Undefined for names that are not
 * engine tools, or that are hidden on purpose.
 */
export function unavailableToolReason(registry: EngineRegistry, capabilities: Set<HostCapability>, name: string): string | undefined {
  const tool = registry.tools.find((t) => t.name === name);
  if (!tool || !tool.surfaces.includes("mcp") || HIDDEN_ENGINE_TOOLS.has(name)) return undefined;
  const missing = (tool.requires ?? []).filter((cap) => !capabilities.has(cap));
  if (missing.length === 0) return undefined;
  const named = missing.map((cap) => registry.capabilityName?.(cap) ?? cap).join(" and ");
  return `${name} does not run on Zenvi Cloud: it needs ${named}. The zenvi CLI and its local MCP server (zenvi mcp) run it on a computer that has it.`;
}

async function callEngineTool(
  ctx: McpCallContext,
  registry: EngineRegistry,
  tool: AnyTool,
  args: Record<string, unknown>,
): Promise<ReturnType<typeof okResult>> {
  const { project_id: rawProjectId, ...toolArgs } = args;
  if (rawProjectId !== undefined && typeof rawProjectId !== "string") return errorResult("project_id must be a string.");
  const projectId = await resolveProjectId(ctx, rawProjectId);
  const edit = await editProject(ctx, projectId, async (doc) => {
    const { host, dispose } = createCloudHost(ctx, projectId, () => doc.project);
    try {
      return await registry.run({ doc, host, signal: ctx.signal }, tool.name, toolArgs);
    } catch (error) {
      if (error instanceof ApiError) return { ok: false, text: `Error: ${error.message}` } satisfies ToolResult;
      throw error;
    } finally {
      await dispose();
    }
  });
  const result = edit.value;
  const text = displayText(result);
  if (!result.ok) return errorResult(text);
  const structured: Record<string, unknown> = { ok: true, project_id: projectId };
  if (result.data !== undefined) structured.data = result.data;
  return okResult(text, structured, result.images ?? []);
}

/**
 * The human line for a result. Catalog tools answer with a contract-3
 * receipt serialized into `text` (what the Assistant bridge sends); on MCP the
 * receipt already travels as structuredContent, so show its `summary`.
 */
export function displayText(result: ToolResult): string {
  const data = result.data as { contract?: unknown; summary?: unknown } | undefined;
  if (data && typeof data === "object" && data.contract === 3 && typeof data.summary === "string" && result.text.trimStart().startsWith("{")) {
    return data.summary;
  }
  return result.text;
}

/**
 * The engine registry. A static import on purpose: a dynamic one makes the
 * esbuild bundle initialise the engine's modules lazily, and modules reached
 * only through `export *` then never initialise (W53 B1: every cloud render
 * failed on an undefined export preset table).
 */
export async function loadEngineRegistry(): Promise<EngineRegistry> {
  return { tools: allTools as readonly AnyTool[], run: (ctx, name, args) => runTool(ctx, name, args), capabilityName };
}
