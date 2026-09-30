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

import type { AnyTool, HostCapability, ToolContext, ToolHost, ToolResult } from "@zenvi/engine";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { sha256Hex } from "../util/crypto.js";
import { guard, jsonSchema } from "./define.js";
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

/** Capabilities the cloud host can offer, given what this build has. */
export function cloudCapabilities(options: { media: boolean; frames: boolean }): Set<HostCapability> {
  const caps = new Set<HostCapability>();
  if (options.media) caps.add("media");
  if (options.frames) caps.add("frames");
  return caps;
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
    if ((tool.requires ?? []).some((cap) => !capabilities.has(cap))) continue;
    let inputSchema: JsonSchemaObject;
    try {
      inputSchema = jsonSchema(tool.input, "input");
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
    try {
      return await registry.run({ doc, host: cloudHost(ctx, projectId), signal: ctx.signal }, tool.name, toolArgs);
    } catch (error) {
      if (error instanceof ApiError) return { ok: false, text: `Error: ${error.message}` } satisfies ToolResult;
      throw error;
    }
  });
  const result = edit.value;
  if (!result.ok) return errorResult(result.text);
  const structured: Record<string, unknown> = { ok: true, project_id: projectId };
  if (result.data !== undefined) structured.data = result.data;
  return okResult(result.text, structured, result.images ?? []);
}

/** The platform capabilities engine tools get in the cloud, for one project. */
export function cloudHost(ctx: McpCallContext, projectId: string): ToolHost {
  const { importer, frames, log } = ctx.services;
  const userId = ctx.principal.userId;
  const host: ToolHost = { log: (message) => log.debug(message) };
  if (importer.available) {
    host.media = {
      probe: async () => {
        throw new ApiError(400, "invalid_request", "Zenvi Cloud cannot read files by path. Import media with import_media_from_url or get_upload_link.");
      },
      importUrl: (url, options) => importer.importUrl(userId, url, { filename: options?.filename, signal: options?.signal ?? ctx.signal }),
    };
  }
  if (frames.available) {
    host.frames = {
      renderFrame: async (project, seconds, options) => {
        const preview = await frames.preview({
          userId,
          projectId,
          project,
          revision: sha256Hex(JSON.stringify(project)),
          seconds,
          width: options?.width,
          signal: ctx.signal,
        });
        return preview.image;
      },
    };
  }
  return host;
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
