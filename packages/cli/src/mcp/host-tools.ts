/**
 * MCP tools about hosts: `list_hosts`, the Zenvi desktop app's handoff tools
 * (forwarded; the app is opened on the session's project first when needed),
 * and the cross-host orchestrations `bring_from_after_effects` /
 * `bring_from_premiere`, which report both apps' receipts in one receipt.
 */

import type { Progress } from "@modelcontextprotocol/sdk/types.js";
import { applied, failed, refused, normalizeArgs, type JsonSchemaObject, type ToolReceipt } from "@zenvi/engine/tools";
import type { CommandContext } from "../commands/context.js";
import { discoverDesktop } from "../desktop/discovery.js";
import { findDesktopApp } from "../desktop/launcher.js";
import { DOWNLOAD_URL, openInDesktop } from "../desktop/open.js";
import type { DesktopExecutor } from "../engine/executor.js";
import { callAdobeTool, isOkHostStatus, liveToolSchema, type CliHostReceipt } from "../hosts/adobe-tools.js";
import { aeRenderLink, declaredName, DESKTOP_HANDOFF_TOOLS, exportedXmlPath, resolvePathArgs } from "../hosts/handoff.js";
import { describeHosts, howToConnect } from "../hosts/registry.js";
import { CliError } from "../output.js";
import { VERSION } from "../version.js";
import type { ExtraCallContext, ExtraTool, ExtraToolResult } from "./extra-tools.js";
import type { McpState } from "./state.js";

/** Client-side ceiling for an Adobe render; Zenvi Link answers within the tool's own timeout first. */
const ADOBE_RENDER_WAIT_MS = 3 * 60 * 60 * 1000;

function onprogress(call: ExtraCallContext): ((p: Progress) => void) | undefined {
  return call.progress ? (p) => call.progress?.(p.progress, p.total ?? 0, p.message ?? "") : undefined;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

type DesktopReady = { ok: true; desktop: DesktopExecutor; note?: string } | { ok: false; receipt: ToolReceipt };

/**
 * The desktop app with this session's project open: the running one, or
 * open it (focus / load / launch, like launch_editor) and wait for its
 * discovery file to show the project.
 */
async function ensureDesktop(ctx: CommandContext, state: McpState, tool: string, call: ExtraCallContext): Promise<DesktopReady> {
  const file = state.session.file;
  if (!file) {
    return { ok: false, receipt: refused(tool, `${tool} runs in the Zenvi desktop app on a saved project, and this session's project has no file yet: call open_project_file first.`) };
  }
  if (ctx.env.ZENVI_MCP_ENGINE === "portable") {
    return { ok: false, receipt: refused(tool, `${tool} runs in the Zenvi desktop app, but this server never uses the app (ZENVI_MCP_ENGINE=portable). Remove that setting to use handoffs.`) };
  }
  const live = await state.desktopExecutor();
  if (live) return { ok: true, desktop: live };

  const running = (await discoverDesktop(ctx.config)).some((e) => e.kind === "gui");
  if (!running && !(await findDesktopApp(state.launcher).catch(() => undefined))) {
    return {
      ok: false,
      receipt: refused(tool, `${tool} runs in the Zenvi desktop app, which is not installed on this machine. Get it at ${DOWNLOAD_URL} (a development checkout: set ZENVI_DESKTOP_CMD).`),
    };
  }
  let summary: string;
  try {
    summary = (await openInDesktop({ config: ctx.config, project: file, deps: state.launcher, clientVersion: VERSION })).summary;
  } catch (error) {
    const message = error instanceof CliError ? [error.message, error.hint].filter(Boolean).join(" ") : (error as Error).message;
    return { ok: false, receipt: refused(tool, `${tool} runs in the Zenvi desktop app, which could not open ${file}: ${message} If Zenvi has unsaved changes in another project, ask the user to save or close it, then try again.`) };
  }
  state.hosts.invalidate();
  call.progress?.(0.05, 0, `${summary} Waiting for it to show the project…`);
  const deadline = Date.now() + state.desktopWaitMs;
  for (;;) {
    const desktop = await state.desktopExecutor();
    if (desktop) return { ok: true, desktop, note: `${summary} This session's Zenvi edits now go through the app.` };
    if (Date.now() >= deadline || call.signal.aborted) break;
    await sleep(Math.min(1000, Math.max(0, deadline - Date.now())), call.signal);
  }
  return {
    ok: false,
    receipt: failed(tool, `${summary} But the app did not show ${file} within ${Math.round(state.desktopWaitMs / 1000)} s. Try again once Zenvi shows the project.`),
  };
}

async function requireDesktopTool(desktop: DesktopExecutor, tool: string, forTool: string): Promise<ToolReceipt | undefined> {
  if (await desktop.hasTool(tool)) return undefined;
  return refused(forTool, `The Zenvi desktop app running here has no ${tool} yet: update Zenvi (${DOWNLOAD_URL}).`);
}

function withNote(receipt: ToolReceipt, note: string | undefined): ToolReceipt {
  return note ? { ...receipt, notes: [...(receipt.notes ?? []), note] } : receipt;
}

async function forward(desktop: DesktopExecutor, tool: string, args: Record<string, unknown>, call: ExtraCallContext): Promise<{ receipt: ToolReceipt; images: ExtraToolResult["images"] }> {
  const outcome = await desktop.call(tool, args, undefined, { onprogress: onprogress(call) });
  const receipt = outcome.receipt ?? (outcome.ok ? applied(tool, outcome.text, {}, 0) : failed(tool, outcome.text || `${tool} failed`));
  return { receipt, images: outcome.images };
}

/** The desktop's handoff tools, forwarded with the desktop's schemas. */
function desktopHandoffTools(ctx: CommandContext): ExtraTool[] {
  return DESKTOP_HANDOFF_TOOLS.map((def) => ({
    name: def.name,
    title: def.title,
    description: `Zenvi desktop app: ${def.description}`,
    inputSchema: def.inputSchema,
    annotations: def.annotations,
    async run(state, args, call) {
      const ready = await ensureDesktop(ctx, state, def.name, call);
      if (!ready.ok) return { receipt: ready.receipt, engine: null };
      const missing = await requireDesktopTool(ready.desktop, def.name, def.name);
      if (missing) return { receipt: withNote(missing, ready.note), engine: "desktop" };
      const { receipt, images } = await forward(ready.desktop, def.name, resolvePathArgs(args, ctx.cwd, ctx.config.home), call);
      return { receipt: withNote(receipt, ready.note), images, engine: "desktop" };
    },
  }));
}

/** A failed Adobe step as this tool's receipt (nothing was added to Zenvi). */
function adobeStepFailed(tool: string, step: string, host: CliHostReceipt): ToolReceipt {
  const make = host.status === "refused" ? refused : failed;
  return make(tool, `${host.summary.replace(/^Error:\s*/, "")} (${step}; nothing was added to the Zenvi project)`, { data: { [host.host === "aftereffects" ? "after_effects" : "premiere"]: host }, warnings: host.warnings ?? [] });
}

/** One receipt for both apps: the desktop's (clips, undo steps) with the Adobe receipt beside it. */
function combined(tool: string, summary: string, adobeKey: "after_effects" | "premiere", adobe: CliHostReceipt, zenvi: ToolReceipt, note: string | undefined): ToolReceipt {
  const ok = zenvi.status === "applied" || zenvi.status === "unchanged";
  const merged: ToolReceipt = {
    ...zenvi,
    tool,
    summary: ok ? summary : `Error: ${summary}`,
    warnings: [...(adobe.warnings ?? []), ...(zenvi.warnings ?? [])],
    data: { [adobeKey]: adobe, zenvi },
  };
  return withNote(merged, note);
}

const NO_FILE = "this session's project has no file yet: call open_project_file first (the clips go into a saved project in the Zenvi desktop app).";

function bringFromAfterEffects(ctx: CommandContext): ExtraTool {
  const inputSchema = {
    type: "object",
    properties: {
      comp: {
        anyOf: [
          { type: "integer", minimum: 1, description: "Comp item id (comp_id from ae_get_state or ae_list_items)" },
          { type: "string", minLength: 1, description: "Exact comp name" },
        ],
        description: "The comp to render. Default: the active comp.",
      },
      alpha: { type: "boolean", description: "Keep transparency (ProRes 4444) for an overlay above other clips. Default false: opaque H.264." },
      position: { type: "number", minimum: 0, description: "Zenvi timeline second where the clip starts. Default: the playhead." },
      track: { type: ["string", "integer"], description: "Zenvi track number (1 = bottom) or name. Default: the lowest free track above the video." },
    },
    additionalProperties: false,
  } as unknown as JsonSchemaObject;
  const tool = "bring_from_after_effects";
  return {
    name: tool,
    title: "Bring an After Effects comp into Zenvi",
    description:
      "Render an After Effects comp and add it to this session's Zenvi project as a linked clip, in one call: ae_render_for_zenvi in After Effects " +
      "(ProRes 4444 with alpha when alpha is true, else H.264), then import_linked_media_tool in the Zenvi desktop app (opened on the project when " +
      "needed). The clip remembers its comp: after changes in After Effects, rerender_linked_clip_tool brings them in. Returns both apps' receipts " +
      "(data.after_effects, data.zenvi) and the new clip. Needs After Effects connected (list_hosts) and a saved project (open_project_file).",
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(state, raw, call) {
      const args = normalizeArgs(inputSchema, raw) as { comp?: unknown; alpha?: unknown; position?: unknown; track?: unknown };
      if (args.alpha !== undefined && typeof args.alpha !== "boolean") return { receipt: refused(tool, "alpha must be true or false"), engine: null };
      if (args.position !== undefined && (typeof args.position !== "number" || !(args.position >= 0))) return { receipt: refused(tool, "position must be a time in seconds, 0 or more"), engine: null };
      if (!state.session.file) return { receipt: refused(tool, NO_FILE), engine: null };
      const connection = await state.hosts.connect("aftereffects");
      if (!connection.ok) {
        return { receipt: refused(tool, `After Effects is not connected: ${connection.discovery.detail}. ${howToConnect("aftereffects", connection.discovery)}`), engine: null };
      }
      const ready = await ensureDesktop(ctx, state, tool, call);
      if (!ready.ok) return { receipt: ready.receipt, engine: null };
      const missing = await requireDesktopTool(ready.desktop, "import_linked_media_tool", tool);
      if (missing) return { receipt: withNote(missing, ready.note), engine: "desktop" };

      const schema = await liveToolSchema(state.hosts, "aftereffects", "ae_render_for_zenvi");
      if (!schema) {
        return { receipt: refused(tool, "Zenvi Link in After Effects has no ae_render_for_zenvi (an older version): run `zenvi adobe install` and restart After Effects."), engine: null };
      }
      const renderArgs: Record<string, unknown> = {};
      if (args.comp !== undefined) {
        const key = declaredName(schema.properties, typeof args.comp === "number" ? ["comp", "comp_id"] : ["comp", "comp_name"]);
        if (!key) return { receipt: refused(tool, "this Zenvi Link's ae_render_for_zenvi does not take a comp; leave comp out to render the active comp"), engine: null };
        renderArgs[key] = args.comp;
      }
      if (args.alpha !== undefined) {
        if (declaredName(schema.properties, ["alpha"])) renderArgs.alpha = args.alpha;
        else if (declaredName(schema.properties, ["codec"])) renderArgs.codec = args.alpha ? "prores4444" : "h264";
      }
      call.progress?.(0.1, 0, "Rendering in After Effects…");
      const render = await callAdobeTool(state.hosts, "ae_render_for_zenvi", renderArgs, { timeoutMs: ADOBE_RENDER_WAIT_MS });
      if (!isOkHostStatus(render.receipt.status)) return { receipt: withNote(adobeStepFailed(tool, "rendering in After Effects", render.receipt), ready.note), engine: "desktop" };
      const media = aeRenderLink(render.receipt.data ?? {}, args.alpha as boolean | undefined);
      if (!media) {
        return {
          receipt: withNote(failed(tool, "After Effects finished ae_render_for_zenvi without naming the rendered file (data.path); nothing was added to the Zenvi project", { data: { after_effects: render.receipt } }), ready.note),
          engine: "desktop",
        };
      }
      call.progress?.(0.9, 0, "Adding the render to the Zenvi project…");
      const importArgs: Record<string, unknown> = { path: media.path, link: media.link };
      if (args.position !== undefined) importArgs.position = args.position;
      if (args.track !== undefined && args.track !== "") importArgs.track = String(args.track);
      const { receipt: zenvi } = await forward(ready.desktop, "import_linked_media_tool", importArgs, call);
      const comp = String((media.link.source as { composition?: unknown } | undefined)?.composition ?? render.receipt.data?.comp_name ?? "the comp");
      const summary =
        zenvi.status === "applied" || zenvi.status === "unchanged"
          ? `Rendered "${comp}" in After Effects and added it to the Zenvi project as a linked clip. ${zenvi.summary}`
          : `After Effects rendered "${comp}" to ${media.path}, but Zenvi could not add it: ${zenvi.summary.replace(/^Error:\s*/, "")}`;
      return { receipt: combined(tool, summary, "after_effects", render.receipt, zenvi, ready.note), engine: "desktop" };
    },
  };
}

function bringFromPremiere(ctx: CommandContext): ExtraTool {
  const inputSchema = {
    type: "object",
    properties: {
      sequence: { type: "string", minLength: 1, description: "Sequence id (sequence_id from premiere_get_state) or exact name. Default: the active sequence." },
      placement: { type: "string", enum: ["new_tracks", "at_playhead"], description: "Where the clips land in Zenvi: new_tracks (default, from 0 s on new tracks) or at_playhead." },
    },
    additionalProperties: false,
  } as unknown as JsonSchemaObject;
  const tool = "bring_from_premiere";
  return {
    name: tool,
    title: "Bring a Premiere Pro sequence into Zenvi",
    description:
      "Bring a Premiere Pro sequence back into this session's Zenvi project as native, editable clips, in one call: premiere_export_xml in Premiere " +
      "(Final Cut Pro 7 XML), then import_timeline_xml_tool in the Zenvi desktop app (opened on the project when needed), as one Zenvi undo step. " +
      "Clips, trims, tracks, motion/opacity keyframes, audio levels, cross dissolves and markers survive. Returns both apps' receipts (data.premiere, " +
      "data.zenvi). Needs Premiere Pro connected (list_hosts) and a saved project (open_project_file).",
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(state, raw, call) {
      const args = normalizeArgs(inputSchema, raw) as { sequence?: unknown; placement?: unknown };
      if (args.placement !== undefined && args.placement !== "new_tracks" && args.placement !== "at_playhead") {
        return { receipt: refused(tool, "placement must be new_tracks or at_playhead"), engine: null };
      }
      if (!state.session.file) return { receipt: refused(tool, NO_FILE), engine: null };
      const connection = await state.hosts.connect("premiere");
      if (!connection.ok) {
        return { receipt: refused(tool, `Premiere Pro is not connected: ${connection.discovery.detail}. ${howToConnect("premiere", connection.discovery)}`), engine: null };
      }
      const ready = await ensureDesktop(ctx, state, tool, call);
      if (!ready.ok) return { receipt: ready.receipt, engine: null };
      const missing = await requireDesktopTool(ready.desktop, "import_timeline_xml_tool", tool);
      if (missing) return { receipt: withNote(missing, ready.note), engine: "desktop" };

      const schema = await liveToolSchema(state.hosts, "premiere", "premiere_export_xml");
      if (!schema) {
        return { receipt: refused(tool, "Zenvi Link in Premiere Pro has no premiere_export_xml (an older version): run `zenvi adobe install` and restart Premiere Pro."), engine: null };
      }
      const exportArgs: Record<string, unknown> = {};
      if (typeof args.sequence === "string" && args.sequence) {
        const key = declaredName(schema.properties, ["sequence", "sequence_id", "sequence_name"]);
        if (!key) return { receipt: refused(tool, "this Zenvi Link's premiere_export_xml does not take a sequence; leave sequence out to export the active one"), engine: null };
        exportArgs[key] = args.sequence;
      }
      call.progress?.(0.1, 0, "Exporting the sequence from Premiere Pro…");
      const exported = await callAdobeTool(state.hosts, "premiere_export_xml", exportArgs, { timeoutMs: ADOBE_RENDER_WAIT_MS });
      if (!isOkHostStatus(exported.receipt.status)) return { receipt: withNote(adobeStepFailed(tool, "exporting from Premiere Pro", exported.receipt), ready.note), engine: "desktop" };
      const xml = exportedXmlPath(exported.receipt.data ?? {});
      if (!xml) {
        return {
          receipt: withNote(failed(tool, "Premiere Pro finished premiere_export_xml without naming the XML file (data.path); nothing was added to the Zenvi project", { data: { premiere: exported.receipt } }), ready.note),
          engine: "desktop",
        };
      }
      call.progress?.(0.9, 0, "Importing the sequence into Zenvi…");
      const { receipt: zenvi } = await forward(ready.desktop, "import_timeline_xml_tool", { path: xml, placement: args.placement ?? "new_tracks" }, call);
      const name = String(exported.receipt.data?.sequence_name ?? exported.receipt.data?.name ?? args.sequence ?? "the active sequence");
      const summary =
        zenvi.status === "applied" || zenvi.status === "unchanged"
          ? `Exported "${name}" from Premiere Pro and imported it into the Zenvi project. ${zenvi.summary}`
          : `Premiere Pro exported "${name}" to ${xml}, but Zenvi could not import it: ${zenvi.summary.replace(/^Error:\s*/, "")}`;
      return { receipt: combined(tool, summary, "premiere", exported.receipt, zenvi, ready.note), engine: "desktop" };
    },
  };
}

function listHostsTool(): ExtraTool {
  return {
    name: "list_hosts",
    title: "Which apps Zenvi can drive",
    description:
      "List the hosts this server drives and which one is active (used most recently): the Zenvi desktop app, the portable Zenvi engine (this " +
      "server, editing the .zvn file), After Effects and Premiere Pro (through the Zenvi Link extension), with their open projects, versions and " +
      "how to connect or enable the missing ones (`zenvi adobe install`). Call it first when the user mentions After Effects or Premiere Pro, and " +
      "before a handoff. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    async run(state) {
      const report = await state.hosts.list();
      return { receipt: applied("list_hosts", describeHosts(report), { data: report }, 0), engine: null };
    },
  };
}

/** list_hosts, the desktop's handoff tools, then the orchestrations. */
export function hostTools(ctx: CommandContext): ExtraTool[] {
  return [listHostsTool(), ...desktopHandoffTools(ctx), bringFromAfterEffects(ctx), bringFromPremiere(ctx)];
}

