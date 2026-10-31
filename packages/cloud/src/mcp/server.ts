/**
 * The remote MCP server: one `Server` per HTTP request (stateless Streamable
 * HTTP), with the cloud tools, the engine catalog, the preview view as a
 * `ui://` resource and the zenvi-styles library (the brief compiler, the
 * styles index and every style and technique) as zenvi://styles resources.
 * The tool list is built once at startup.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { STYLE_RESOURCES, styleResource } from "@zenvi/engine/styles";
import type { Services } from "../container.js";
import { cloudTools } from "./cloud-tools.js";
import { engineTools, unavailableToolReason } from "./engine.js";
import { cloudCapabilities } from "./host.js";
import { reelTools } from "./reels.js";
import { errorResult } from "./results.js";
import type { McpCallContext, McpTool } from "./types.js";
import { EDITOR_WIDGET_HTML, EDITOR_WIDGET_MIME, EDITOR_WIDGET_URI, editorWidgetResourceMeta } from "./editor-widget.js";
import { WIDGET_HTML, WIDGET_MIME, WIDGET_URI, widgetResourceMeta } from "./widget.js";

/** Sent in `initialize`; the first 512 characters matter most (ChatGPT). */
export const INSTRUCTIONS =
  "Zenvi edits the person's video projects in Zenvi Cloud. Start with list_projects + open_project, or create_project: both show the Zenvi editor in the chat, which follows your later edits live (open_in_editor shows it again, only if asked). Later tools use that project (or pass project_id). Import with import_media_from_url or get_upload_link. Check edits with preview_frame. render_project and generate_video return immediately: poll get_render_status or get_generation_status.";

const RESOURCE_NOT_FOUND = -32002;

export function buildToolList(services: Services): McpTool[] {
  const cloud = cloudTools({ backend: services.backendSessions.enabled });
  if (!services.engine) return cloud;
  const reels = reelTools(services.engine, { fetchDeadlineMs: services.config.limits.reelFetchDeadlineMs });
  const reserved = new Set([...cloud, ...reels].map((tool) => tool.name));
  const capabilities = cloudCapabilities(services);
  const engine = engineTools(services.engine, capabilities, reserved, (message) => services.log.warn(message));
  return [...cloud, ...reels, ...engine];
}

function descriptor(tool: McpTool): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    annotations: tool.annotations,
    ...(tool._meta ? { _meta: tool._meta } : {}),
  };
}

export function createMcpServer(tools: readonly McpTool[], ctx: McpCallContext): Server {
  const { config, blobs } = ctx.services;
  const server = new Server(
    { name: "zenvi", title: "Zenvi", version: config.version, websiteUrl: "https://zenvi.pro" },
    { capabilities: { tools: { listChanged: false }, resources: { listChanged: false } }, instructions: INSTRUCTIONS },
  );
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const resourceMeta = widgetResourceMeta(blobs.origin);
  const editorMeta = editorWidgetResourceMeta(ctx.origin);
  const resources = [
    { uri: WIDGET_URI, name: "zenvi-preview", title: "Zenvi preview", description: "Shows a previewed frame or a finished render.", mimeType: WIDGET_MIME, text: WIDGET_HTML, _meta: resourceMeta },
    {
      uri: EDITOR_WIDGET_URI,
      name: "zenvi-editor",
      title: "Zenvi editor",
      description: "The Zenvi video editor with a project open.",
      mimeType: EDITOR_WIDGET_MIME,
      text: EDITOR_WIDGET_HTML,
      _meta: editorMeta,
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(descriptor) as never[] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      const engine = ctx.services.engine;
      const reason = engine ? unavailableToolReason(engine, cloudCapabilities(ctx.services), request.params.name) : undefined;
      if (reason) return errorResult(reason);
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    }
    if (!ctx.principal.scopes.includes(tool.scope)) {
      return errorResult(`This connection was granted without ${tool.scope}. Disconnect and reconnect Zenvi, allowing edits.`);
    }
    return tool.call(ctx, (request.params.arguments ?? {}) as Record<string, unknown>);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [...resources.map(({ text: _text, ...listed }) => listed), ...STYLE_RESOURCES.map(({ text: _text, ...listed }) => listed)],
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const style = styleResource(request.params.uri);
    if (style) return { contents: [{ uri: style.uri, mimeType: style.mimeType, text: style.text }] };
    const resource = resources.find((r) => r.uri === request.params.uri);
    if (!resource) throw new McpError(RESOURCE_NOT_FOUND, `Resource not found: ${request.params.uri}`);
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text, _meta: resource._meta }] };
  });

  return server;
}
