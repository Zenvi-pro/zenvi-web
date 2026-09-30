/**
 * `zenvi mcp`: the local MCP server (stdio) for Claude Code, Claude Desktop,
 * Codex and Cursor.
 *
 * Tools: the engine catalog for surface `mcp`, with this machine's Node host
 * (local media, ffmpeg renders, frame previews), plus open_project_file,
 * render_video, preview_frame, launch_editor and push_to_cloud. Results
 * follow the desktop's MCP (zenvi-core agent_tools/output.py `mcp_content`):
 * a text block with the contract-3 receipt JSON, image blocks for frames,
 * and the receipt again as `structuredContent`. Arguments are coerced by the
 * engine exactly like the desktop's `validate_input=False` server, so the
 * SDK does not pre-validate them.
 */

import { once } from "node:events";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolImage } from "@zenvi/engine";
import { failed, parseReceipt, type ToolReceipt } from "@zenvi/engine/tools";
import type { CommandContext } from "../commands/context.js";
import { findProject } from "../project/select.js";
import { VERSION } from "../version.js";
import { extraTools, type ExtraTool } from "./extra-tools.js";
import { McpState } from "./state.js";

export const SERVER_INSTRUCTIONS = [
  "Zenvi edits video projects (.zvn, the Zenvi desktop app's format) with the same editing tools as the Zenvi desktop app and web editor. Everything runs on this machine with ffmpeg.",
  "Workflow: (1) open_project_file with a .zvn path (created if missing; the project in the working folder is opened automatically). (2) import_files_tool with media paths, then add_clip_to_timeline_tool, apply_transition_tool, add_title_tool, set_clip_volume_tool, set_keyframes_tool, delete_from_timeline_tool and the other tools. (3) Before saying an edit is right, look at it: preview_frame returns the composited frame as an image (grid=true adds a 0-1 coordinate grid). (4) render_video exports (mp4 by default). (5) launch_editor shows the project in the Zenvi desktop app; push_to_cloud returns a zenvi.pro web editor link to share.",
  "Every tool returns a JSON receipt (contract 3): status applied|unchanged|refused|error, summary, clips, shifted, removedClipIds, createdTracks, undoSteps. Patch your view of the timeline from receipts instead of re-listing everything. Failures start with \"Error:\". Each call is one undo step; undo_tool reverts it. Edits autosave to the project file with their undo history.",
  "Use these tools for timeline edits instead of running ffmpeg yourself: they keep the project editable in Zenvi. Times are seconds on the timeline. If the Zenvi desktop app has the same project open, edits go through the app so the person sees them live.",
].join("\n\n");

function toCallResult(receipt: ToolReceipt, images: ToolImage[] = [], engine?: string): CallToolResult {
  const ok = receipt.status === "applied" || receipt.status === "unchanged";
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(receipt) }];
  if (ok) for (const image of images) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  return {
    content,
    structuredContent: { ...receipt, ...(engine ? { engine } : {}) } as unknown as Record<string, unknown>,
    ...(ok ? {} : { isError: true }),
  };
}

export interface ZenviMcpServer {
  server: McpServer;
  state: McpState;
  close(): Promise<void>;
}

export async function createZenviMcpServer(ctx: CommandContext, projectFile?: string): Promise<ZenviMcpServer> {
  const state = await McpState.create(ctx, projectFile);
  const extras = extraTools(ctx);
  const extraByName = new Map<string, ExtraTool>(extras.map((t) => [t.name, t]));
  const server = new McpServer({ name: "zenvi", title: "Zenvi video editor", version: VERSION }, { capabilities: { tools: { listChanged: false } }, instructions: SERVER_INSTRUCTIONS });

  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const host = state.session.host;
    const engineTools = ctx.registry.list("mcp", host).filter((t) => !extraByName.has(t.name));
    return {
      tools: [
        ...engineTools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema as unknown as { type: "object"; [key: string]: unknown },
          ...(t.annotations ? { annotations: { ...t.annotations, title: t.title } } : {}),
        })),
        ...extras.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema as unknown as { type: "object"; [key: string]: unknown },
          annotations: { title: t.title, ...t.annotations },
        })),
      ],
    };
  });

  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const progressToken = request.params._meta?.progressToken;
    const progress =
      progressToken !== undefined
        ? (value: number, total: number, message: string) =>
            void extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress: value, total, message } }).catch(() => undefined)
        : undefined;
    try {
      const extraTool = extraByName.get(name);
      if (extraTool) {
        const out = await extraTool.run(state, args, { signal: extra.signal, progress });
        return toCallResult(out.receipt, out.images, "portable");
      }
      const desktop = await state.desktopExecutor();
      if (desktop) {
        const outcome = await desktop.call(name, args);
        const receipt = outcome.receipt ?? parseReceipt(outcome.text) ?? (outcome.ok ? undefined : failed(name, outcome.text));
        if (receipt) return toCallResult(receipt, outcome.images, "desktop");
        return { content: [{ type: "text", text: outcome.text }], ...(outcome.ok ? {} : { isError: true }) };
      }
      const { result } = await state.session.run(name, args, extra.signal);
      const receipt = (result.data as ToolReceipt | undefined) ?? parseReceipt(result.text);
      if (!receipt) return { content: [{ type: "text", text: result.text }], ...(result.ok ? {} : { isError: true }) };
      if (!state.session.file && receipt.undoSteps > 0) {
        receipt.notes = [...receipt.notes, "Not saved yet: this project has no file. Call open_project_file with a .zvn path to save it (your edits are kept)."];
      }
      return toCallResult(receipt, result.images, "portable");
    } catch (error) {
      if (ctx.env.ZENVI_DEBUG) process.stderr.write(`[zenvi mcp] ${name} failed: ${(error as Error).stack ?? String(error)}\n`);
      return toCallResult(failed(name, (error as Error).message || String(error)));
    }
  });

  return {
    server,
    state,
    async close() {
      await state.close();
      await server.close();
    },
  };
}

/** Serve MCP on stdio until the client disconnects. */
export async function runStdioServer(ctx: CommandContext, transport: Transport = new StdioServerTransport()): Promise<void> {
  const flags = ctx.flags();
  let projectFile: string | undefined;
  try {
    projectFile = await findProject({ flag: flags.project, cwd: ctx.cwd, env: ctx.env });
  } catch {
    // Several projects in the folder: start untitled; the agent picks one.
  }
  const { server, close } = await createZenviMcpServer(ctx, projectFile);
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
  });
  await server.connect(transport);
  process.stderr.write(`zenvi mcp ${VERSION} ready${projectFile ? ` (${projectFile})` : ""}\n`);
  await Promise.race([closed, once(process.stdin, "end").then(() => undefined)]);
  await close();
}
