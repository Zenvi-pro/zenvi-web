/**
 * `zenvi mcp`: the local MCP server (stdio) for Claude Code, Claude Desktop,
 * Codex and Cursor. It knows four hosts (SPEC §3.8): the Zenvi desktop app,
 * the portable Zenvi engine (this process), After Effects and Premiere Pro
 * (Zenvi Link).
 *
 * Tools: the engine catalog for surface `mcp` with this machine's Node host
 * (local media, ffmpeg renders, frame previews); open_project_file,
 * render_video, preview_frame, launch_editor, push_to_cloud; list_hosts, the
 * desktop's handoff tools and bring_from_after_effects / bring_from_premiere;
 * and the `ae_*` / `premiere_*` families from the Zenvi Link catalogs
 * (listed per ZENVI_MCP_ADOBE). Results follow the desktop's MCP (zenvi-core
 * agent_tools/output.py `mcp_content`): a text block with the contract-3
 * receipt JSON, image blocks for frames, and the receipt again as
 * `structuredContent`. Arguments are coerced like the desktop's
 * `validate_input=False` server, so the SDK does not pre-validate them.
 *
 * Resources: zenvi://hosts, zenvi://taste, zenvi://handoff, zenvi://director
 * (and zenvi://director/<genre>). Prompts: taste_motion_design, edit_review,
 * motion_director.
 */

import { once } from "node:events";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { HOST_IDS } from "@zenvi/adobe-link";
import type { ToolImage } from "@zenvi/engine";
import { failed, parseReceipt, refused, type ToolReceipt } from "@zenvi/engine/tools";
import type { CommandContext } from "../commands/context.js";
import { adobeToolDefinitions, callAdobeTool, hostOfTool, hostRefusal, isOkHostStatus } from "../hosts/adobe-tools.js";
import { guideText, PROMPTS, promptText, RESOURCES } from "../hosts/guides.js";
import { APP_LABEL, type FamilyDecision, type FamilyDecisions } from "../hosts/policy.js";
import { findProject } from "../project/select.js";
import { unknownArgumentsMessage } from "../util/unknown-args.js";
import { VERSION } from "../version.js";
import { extraTools, type ExtraTool } from "./extra-tools.js";
import { HANDOFF_TOOL_NAMES, hostTools } from "./host-tools.js";
import { McpState, type McpStateOptions } from "./state.js";

export const SERVER_INSTRUCTIONS = [
  "Zenvi edits video. This server drives four hosts: the Zenvi desktop app, the portable Zenvi engine (this server, editing the .zvn project file with ffmpeg on this machine), and After Effects and Premiere Pro through the Zenvi Link extension. list_hosts shows which are connected and which is active (used most recently): call it first whenever the user mentions After Effects or Premiere Pro, and before a handoff.",
  "Picking tools: ae_* tools act inside After Effects and premiere_* tools inside Premiere Pro, on the project open there, with that app's own undo. Unprefixed tools act on the Zenvi project: in the desktop app while it has the project open (the person sees edits live; receipts say engine desktop), otherwise in the portable engine. Never edit a .zvn file or an Adobe project by hand.",
  "Zenvi workflow: (1) open_project_file with a .zvn path (created if missing; the project in the working folder is opened automatically). (2) import_files_tool with media paths, then add_clip_to_timeline_tool, apply_transition_tool, add_title_tool, set_clip_volume_tool, set_keyframes_tool, delete_from_timeline_tool and the other tools. (3) render_video exports (mp4 by default). (4) launch_editor shows the project in the Zenvi desktop app; push_to_cloud returns a zenvi.pro web editor link to share.",
  "Handoffs run in the Zenvi desktop app on the saved project, which is opened for you: send_to_after_effects_tool / export_to_after_effects_tool, send_to_premiere_tool / export_to_premiere_tool, import_timeline_xml_tool, the Remotion and HyperFrames import and export tools, and linked clips (get_linked_clip_tool, update_linked_clip_tool, rerender_linked_clip_tool, open_linked_source_tool, unlink_clip_tool). bring_from_after_effects renders a comp into the project as a linked clip; bring_from_premiere brings a sequence back as native clips. zenvi://handoff says what survives each direction.",
  "Making a whole video (a reel, ad, promo, montage, a reference to recreate): before the first edit, load the zenvi-motion-director skill when your client has it (the Zenvi Claude Code plugin), else read zenvi://director (the motion_director prompt carries it) and the genre's recipe zenvi://director/<genre>. It plans the edit with timings, gives each genre's exact tool calls and puts a sound on every cut.",
  "Taste: omitted arguments take the defaults in zenvi://taste (entrances 0.6 s, exits 0.4 s, smooth easing, nothing that moves is linear, text inside title-safe). Look before you say done: after any visual change capture frames (preview_frame, with grid=true for a 0-1 coordinate grid; ae_capture_frame; premiere_capture_frame) at the first frame, entrance ends, holds and the last frame, check them against the review checklist (prompt edit_review), fix, and look again. After cutting a multi-shot edit, call review_edit_tool: one contact sheet of the cut plus pacing, beat and loudness numbers and a ranked problem list; fix what it flags and call it again.",
  "Web videos: for a YouTube or other web page link call ingest_web_video_tool once (intent=timeline only when the person asked to put it on the timeline, reference for a colour or look reference; it needs yt-dlp on this machine). If it answers status=running, call it again with the job_id until completed or failed: each call waits up to about 45 s, and a client timeout is not a failure. On ok=false report the reason once and stop. A direct link to a media file can use import_video_url_and_add_to_timeline_tool.",
  "Every tool returns a JSON receipt (contract 3): status applied|unchanged|refused|error (read-only Adobe tools: ok), summary, and what changed (clips, shifted, removedClipIds, createdTracks, undoSteps; Adobe tools: ids in data). Patch your view from receipts instead of re-listing everything. Failures start with \"Error:\"; refused means nothing changed, so read the summary and adjust. Each Zenvi call is one undo step (undo_tool); edits autosave to the project file with their undo history. Use these tools instead of running ffmpeg yourself: they keep the project editable in Zenvi. Times are seconds.",
].join("\n\n");

/** A receipt as MCP content: JSON text (+ images on success), the receipt as structuredContent, isError on failure. */
function toCallResult(receipt: { status: string }, images: readonly ToolImage[] = [], extra: Record<string, unknown> = {}): CallToolResult {
  const ok = isOkHostStatus(receipt.status);
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(receipt) }];
  if (ok) for (const image of images) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  return {
    content,
    structuredContent: { ...receipt, ...extra } as Record<string, unknown>,
    ...(ok ? {} : { isError: true }),
  };
}

export interface ZenviMcpServer {
  server: McpServer;
  state: McpState;
  close(): Promise<void>;
}

/** What the tool list depends on: the Adobe families and the handoff tools that are listed. */
const listingKey = (families: FamilyDecisions, handoff: FamilyDecision): string => `${HOST_IDS.filter((host) => families[host].listed).join(",")}|handoff:${handoff.listed}`;

export async function createZenviMcpServer(ctx: CommandContext, projectFile?: string, options: McpStateOptions = {}): Promise<ZenviMcpServer> {
  const state = await McpState.create(ctx, projectFile, options);
  const extras: ExtraTool[] = [...extraTools(ctx), ...hostTools(ctx)];
  const extraByName = new Map<string, ExtraTool>(extras.map((t) => [t.name, t]));
  const server = new McpServer(
    { name: "zenvi", title: "Zenvi video editor", version: VERSION },
    { capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  /** The Adobe families in the client's last tools/list (undefined until it lists). */
  let listedFamilies: string | undefined;

  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const host = state.session.host;
    const engineTools = ctx.registry.list("mcp", host).filter((t) => !extraByName.has(t.name) && !hostOfTool(t.name));
    const [families, handoff] = await Promise.all([state.hosts.families(), state.handoffDecision()]);
    listedFamilies = listingKey(families, handoff);
    return {
      tools: [
        ...engineTools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema as unknown as { type: "object"; [key: string]: unknown },
          ...(t.annotations ? { annotations: { ...t.annotations, title: t.title } } : {}),
        })),
        ...extras
          .filter((t) => handoff.listed || !HANDOFF_TOOL_NAMES.has(t.name))
          .map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema as unknown as { type: "object"; [key: string]: unknown },
          annotations: { title: t.title, ...t.annotations },
        })),
        ...HOST_IDS.filter((h) => families[h].listed).flatMap((h) => adobeToolDefinitions(h)),
      ],
    };
  });

  /** Tell the client to list tools again when an Adobe family appeared or went away (e.g. after `zenvi adobe install`). */
  async function announceFamilyChanges(): Promise<void> {
    if (listedFamilies === undefined) return;
    const [families, handoff] = await Promise.all([state.hosts.families(), state.handoffDecision()]);
    const key = listingKey(families, handoff);
    if (key === listedFamilies) return;
    listedFamilies = key;
    await server.server.sendToolListChanged().catch(() => undefined);
  }

  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const progressToken = request.params._meta?.progressToken;
    // MCP progress must increase within a request: steps and relayed progress that do not are dropped.
    let lastProgress = -Infinity;
    const progress =
      progressToken !== undefined
        ? (value: number, total: number, message: string) => {
            if (!(value > lastProgress)) return;
            lastProgress = value;
            void extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress: value, ...(total > 0 ? { total } : {}), message } }).catch(() => undefined);
          }
        : undefined;
    try {
      const extraTool = extraByName.get(name);
      if (extraTool && HANDOFF_TOOL_NAMES.has(name)) {
        const handoff = await state.handoffDecision();
        if (!handoff.listed && handoff.reason === "ZENVI_MCP_HANDOFF=off") {
          return toCallResult(refused(name, `Handoff tools are turned off in this server (ZENVI_MCP_HANDOFF=off). ${handoff.enable ?? ""}`.trim()));
        }
      }
      if (extraTool) {
        const unknown = extraTool.checksOwnArguments ? undefined : unknownArgumentsMessage(name, args, extraTool.inputSchema as { properties?: Record<string, unknown> });
        if (unknown) return toCallResult(failed(name, unknown), undefined, { engine: "portable" });
        const out = await extraTool.run(state, args, { signal: extra.signal, progress });
        const engine = out.engine === undefined ? "portable" : out.engine;
        return toCallResult(out.receipt, out.images, engine ? { engine } : {});
      }
      const adobe = hostOfTool(name);
      if (adobe) {
        const families = await state.hosts.families();
        if (!families[adobe].listed && families[adobe].reason === "ZENVI_MCP_ADOBE=off") {
          return toCallResult(hostRefusal(adobe, name, "UNSUPPORTED", `${APP_LABEL[adobe]} tools are turned off in this server (ZENVI_MCP_ADOBE=off). ${families[adobe].enable ?? ""}`.trim()));
        }
        const result = await callAdobeTool(state.hosts, name, args);
        return toCallResult(result.receipt, result.images);
      }
      const desktop = await state.desktopExecutor();
      if (desktop) {
        const outcome = await desktop.call(name, args);
        const receipt = outcome.receipt ?? parseReceipt(outcome.text) ?? (outcome.ok ? undefined : failed(name, outcome.text));
        if (receipt) return toCallResult(receipt, outcome.images, { engine: "desktop" });
        return { content: [{ type: "text", text: outcome.text }], ...(outcome.ok ? {} : { isError: true }) };
      }
      state.notePortableCall();
      const { result } = await state.session.run(name, args, extra.signal);
      const receipt = (result.data as ToolReceipt | undefined) ?? parseReceipt(result.text);
      if (!receipt) return { content: [{ type: "text", text: result.text }], ...(result.ok ? {} : { isError: true }) };
      if (name === "review_edit_tool" && result.ok) state.noteReview();
      if (!state.session.file && receipt.undoSteps > 0) {
        receipt.notes = [...receipt.notes, "Not saved yet: this project has no file. Call open_project_file with a .zvn path to save it (your edits are kept)."];
      }
      return toCallResult(receipt, result.images, { engine: "portable" });
    } catch (error) {
      if (ctx.env.ZENVI_DEBUG) process.stderr.write(`[zenvi mcp] ${name} failed: ${(error as Error).stack ?? String(error)}\n`);
      return toCallResult(failed(name, (error as Error).message || String(error)));
    } finally {
      await announceFamilyChanges().catch(() => undefined);
    }
  });

  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES.map((r) => ({ ...r })) }));
  // No parameterised resources; answer instead of -32601 (clients list templates next to resources).
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));

  server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const info = RESOURCES.find((r) => r.uri === uri);
    if (!info) throw new McpError(-32002, `Resource not found: ${uri}. Resources: ${RESOURCES.map((r) => r.uri).join(", ")}.`);
    const text = uri === "zenvi://hosts" ? JSON.stringify(await state.hosts.list(), null, 2) : (guideText(uri) ?? "");
    return { contents: [{ uri, mimeType: info.mimeType, text }] };
  });

  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS.map((p) => ({ ...p, arguments: p.arguments.map((a) => ({ ...a })) })) }));

  server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, string | undefined>;
    // The host defaults to the active one, so look it up only when the prompt needs it.
    const report = args.host?.trim() ? undefined : await state.hosts.list().catch(() => undefined);
    let prompt: { description: string; text: string };
    try {
      prompt = promptText(request.params.name, args, report);
    } catch (error) {
      throw new McpError(ErrorCode.InvalidParams, (error as Error).message);
    }
    return { description: prompt.description, messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.text } }] };
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
