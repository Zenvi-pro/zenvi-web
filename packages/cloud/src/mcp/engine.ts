/**
 * The engine tool catalog (`@zenvi/engine/tools`, W4) on the remote MCP
 * server. Every call: resolve the project → load it → `runTool` on a
 * ProjectDocument with the cloud ToolHost (one transaction, validated before
 * anything changes) → save with If-Match (mcp/projects.ts `editProject`).
 *
 * Tools that only make sense next to a local app (file dialogs, playback, UI
 * zoom, local save/open) or that the cloud replaces with its own
 * (`preview_frame`, renders, new/open project) are not exposed.
 */

import type { AnyTool, HostCapability, ToolContext, ToolResult } from "@zenvi/engine";
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
}

/** Engine tools that stay off the remote MCP server. */
export const HIDDEN_ENGINE_TOOLS = new Set([
  // Local project files and dialogs — cloud projects are managed by the cloud tools.
  "new_project_tool",
  "open_project_tool",
  "save_project_tool",
  "import_files_tool",
  "export_video_tool",
  "render_video",
  "render_video_tool",
  // Playback and timeline-view state belong to an open editor window.
  "play_tool",
  "go_to_start_tool",
  "go_to_end_tool",
  "zoom_in_tool",
  "zoom_out_tool",
  "center_on_playhead_tool",
  "watch_clip_tool",
  // Kling is slower than ChatGPT's tool budget. generate_video starts a job instead.
  "generate_video_and_add_to_timeline_tool",
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
 * Find the engine registry if this build of `@zenvi/engine` exports one
 * (`allTools` + `runTool`, W4's documented contract). Owner W7: switch to a
 * static import once the registry has landed everywhere.
 */
export async function loadEngineRegistry(): Promise<EngineRegistry | null> {
  const mod = (await import("@zenvi/engine/tools")) as unknown as Record<string, unknown>;
  const allTools = mod.allTools;
  const runTool = mod.runTool;
  if (!Array.isArray(allTools) || typeof runTool !== "function") return null;
  const run = runTool as (ctx: ToolContext, name: string, args: unknown) => Promise<ToolResult>;
  return { tools: allTools as AnyTool[], run: (ctx, name, args) => run(ctx, name, args) };
}
