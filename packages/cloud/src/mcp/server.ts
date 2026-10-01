/**
 * The remote MCP server: one `Server` per HTTP request (stateless Streamable
 * HTTP), with the cloud tools, the engine catalog and the preview view as a
 * `ui://` resource. The tool list is built once at startup.
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
import type { Services } from "../container.js";
import { cloudTools } from "./cloud-tools.js";
import { engineTools } from "./engine.js";
import { cloudCapabilities } from "./host.js";
import { errorResult } from "./results.js";
import type { McpCallContext, McpTool } from "./types.js";
import { WIDGET_HTML, WIDGET_MIME, WIDGET_URI, widgetResourceMeta } from "./widget.js";

/** Sent in `initialize`; the first 512 characters matter most (ChatGPT). */
export const INSTRUCTIONS =
  "Zenvi edits the person's video projects in Zenvi Cloud. Start with list_projects + open_project, or create_project; editing tools then act on that project (or pass project_id). Bring media in with import_media_from_url (public https links) or get_upload_link (files on their device). Check edits with preview_frame. render_project starts a background render: poll get_render_status for the download link. open_in_editor links to the web editor.";

const RESOURCE_NOT_FOUND = -32002;

export function buildToolList(services: Services): McpTool[] {
  const cloud = cloudTools();
  if (!services.engine) return cloud;
  const reserved = new Set(cloud.map((tool) => tool.name));
  const capabilities = cloudCapabilities(services);
  const engine = engineTools(services.engine, capabilities, reserved, (message) => services.log.warn(message));
  return [...cloud, ...engine];
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(descriptor) as never[] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    if (!ctx.principal.scopes.includes(tool.scope)) {
      return errorResult(`This connection was granted without ${tool.scope}. Disconnect and reconnect Zenvi, allowing edits.`);
    }
    return tool.call(ctx, (request.params.arguments ?? {}) as Record<string, unknown>);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: WIDGET_URI,
        name: "zenvi-preview",
        title: "Zenvi preview",
        description: "Shows a previewed frame or a finished render.",
        mimeType: WIDGET_MIME,
        _meta: resourceMeta,
      },
    ],
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== WIDGET_URI) throw new McpError(RESOURCE_NOT_FOUND, `Resource not found: ${request.params.uri}`);
    return { contents: [{ uri: WIDGET_URI, mimeType: WIDGET_MIME, text: WIDGET_HTML, _meta: resourceMeta }] };
  });

  return server;
}
