/**
 * MCP tools about hosts: `list_hosts`, the Zenvi desktop app's handoff tools
 * (forwarded to the desktop app, which is opened on the session's project
 * when the tool needs it), and the cross-host orchestrations
 * `bring_from_after_effects` / `bring_from_premiere`, which report both apps'
 * receipts in one receipt.
 *
 * Side effects come last: argument names are checked against the running
 * desktop's own schema (or this zenvi's copy when none runs) and Adobe apps
 * are checked before the desktop is opened, switched or started.
 */

import type { Progress } from "@modelcontextprotocol/sdk/types.js";
import type { HostId } from "@zenvi/adobe-link";
import { applied, failed, refused, type JsonSchemaObject, type ToolReceipt } from "@zenvi/engine/tools";
import type { CommandContext } from "../commands/context.js";
import { DesktopClient } from "../desktop/client.js";
import { desktopProcessAlive, discoverDesktop, type DesktopEndpoint } from "../desktop/discovery.js";
import { findDesktopApp } from "../desktop/launcher.js";
import { DOWNLOAD_URL, openInDesktop } from "../desktop/open.js";
import { DesktopExecutor } from "../engine/executor.js";
import { callAdobeTool, coerceHostArgs, isOkHostStatus, liveToolSchema, type CliHostReceipt, type HostCallResult } from "../hosts/adobe-tools.js";
import { aeRenderLink, declaredName, DESKTOP_HANDOFF_TOOLS, exportedXmlPath, resolvePathArgs } from "../hosts/handoff.js";
import { APP_LABEL } from "../hosts/policy.js";
import { describeHosts, howToConnect } from "../hosts/registry.js";
import { CliError } from "../output.js";
import { unknownArgumentsMessage } from "../util/unknown-args.js";
import { VERSION } from "../version.js";
import type { ExtraCallContext, ExtraTool, ExtraToolResult } from "./extra-tools.js";
import type { McpState } from "./state.js";

/** Client-side ceiling for an Adobe render; Zenvi Link answers within the tool's own timeout first. */
const ADOBE_RENDER_WAIT_MS = 3 * 60 * 60 * 1000;

/**
 * What a desktop handoff tool needs open in the desktop app:
 * - `any`: nothing of this session (it runs wherever the app is; no project switch);
 * - `read`: this session's project, but it never switches an app that shows another project;
 * - `edit` (default): this session's project, opened there first (an export, send, import or linked-clip edit is that intent).
 */
type ProjectNeed = "any" | "read" | "edit";
const PROJECT_NEED: Readonly<Record<string, ProjectNeed>> = {
  list_remotion_compositions_tool: "any",
  get_linked_clip_tool: "read",
  open_linked_source_tool: "read",
};

/** Desktop tools that drive an Adobe app: that app must be connected before anything else happens. */
const NEEDS_ADOBE: Readonly<Record<string, HostId>> = {
  send_to_after_effects_tool: "aftereffects",
  send_to_premiere_tool: "premiere",
};

/**
 * Progress for one call: strictly increasing ticks (MCP requires it) with a
 * message, relayed desktop progress, and keep-alive messages while a long
 * step runs, so clients with short timeouts do not give up on a render.
 */
class Ticker {
  private tick = 0;

  constructor(
    private readonly call: ExtraCallContext,
    private readonly keepAliveMs: number,
  ) {}

  say(message: string): void {
    this.tick += 1;
    this.call.progress?.(this.tick, 0, message);
  }

  /** The desktop's own progress, as messages on this call's ticks. */
  relay(fallback: string): ((p: Progress) => void) | undefined {
    return this.call.progress ? (p) => this.say(p.message || fallback) : undefined;
  }

  /** `work`, saying `message` with the elapsed time every keep-alive interval until it settles. */
  async during<T>(message: string, work: Promise<T>): Promise<T> {
    if (!this.call.progress) return work;
    const started = Date.now();
    const timer = setInterval(() => this.say(`${message} (${Math.round((Date.now() - started) / 1000)} s)`), this.keepAliveMs);
    try {
      return await work;
    } finally {
      clearInterval(timer);
    }
  }
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

type DesktopReady = { ok: true; desktop: DesktopExecutor; note?: string; release(): Promise<void> } | { ok: false; receipt: ToolReceipt };

type OpenOutcome = { kind: "opened" | "starting"; summary: string } | { kind: "not-installed" } | { kind: "failed"; message: string };

/**
 * Bring the desktop app to this session's project: focus it, load the
 * project into the running app, or start it; when an app this server
 * started (or one that is busy and missed the 1.5 s probe) is coming up,
 * only wait for it. Shared by concurrent calls (McpState.openOnce).
 */
async function openDesktop(ctx: CommandContext, state: McpState): Promise<OpenOutcome> {
  const gui = (await discoverDesktop(ctx.config)).find((e) => e.kind === "gui");
  if (!gui && (state.launchPending || (await desktopProcessAlive(ctx.config)))) return { kind: "starting", summary: "The Zenvi desktop app is starting." };
  if (!gui && !(await findDesktopApp(state.launcher).catch(() => undefined))) return { kind: "not-installed" };
  try {
    const opened = await openInDesktop({ config: ctx.config, project: state.session.file, deps: state.launcher, clientVersion: VERSION });
    if (opened.method === "launched") state.noteLaunch();
    return { kind: "opened", summary: opened.summary };
  } catch (error) {
    return { kind: "failed", message: error instanceof CliError ? [error.message, error.hint].filter(Boolean).join(" ") : (error as Error).message };
  }
}

const keep = async (): Promise<void> => undefined;

/** A live endpoint of the desktop app, GUI first (any project). */
async function anyDesktop(ctx: CommandContext): Promise<DesktopEndpoint | undefined> {
  return (await discoverDesktop(ctx.config))[0];
}

function transient(endpoint: DesktopEndpoint): { desktop: DesktopExecutor; release(): Promise<void> } {
  const desktop = new DesktopExecutor(new DesktopClient(endpoint, VERSION), endpoint.project);
  return { desktop, release: () => desktop.close() };
}

/**
 * The desktop app, ready for `tool`: the one with this session's project
 * open; for `any` tools whichever runs; otherwise open the project there
 * (focus / load / launch, like launch_editor, never two launches) and wait
 * for its discovery file to show it.
 */
/** Refusals that need nothing but this server's settings and session (checked before anything else). */
function preflight(ctx: CommandContext, state: McpState, tool: string, need: ProjectNeed): ToolReceipt | undefined {
  if (ctx.env.ZENVI_MCP_ENGINE === "portable") {
    return refused(tool, `${tool} runs in the Zenvi desktop app, but this server never uses the app (ZENVI_MCP_ENGINE=portable). Remove that setting to use handoffs.`);
  }
  if (!state.session.file && need !== "any") {
    return refused(tool, `${tool} runs in the Zenvi desktop app on a saved project, and this session's project has no file yet: call open_project_file first.`);
  }
  return undefined;
}

async function ensureDesktop(ctx: CommandContext, state: McpState, tool: string, call: ExtraCallContext, ticker: Ticker, need: ProjectNeed): Promise<DesktopReady> {
  const file = state.session.file;
  const refusal = preflight(ctx, state, tool, need);
  if (refusal) return { ok: false, receipt: refusal };
  if (file) {
    const live = await state.desktopExecutor();
    if (live) return { ok: true, desktop: live, release: keep };
  }
  const running = await anyDesktop(ctx);
  if (running && need === "any") return { ok: true, ...transient(running) };
  if (running && need === "read" && running.kind === "gui") {
    return {
      ok: false,
      receipt: refused(
        tool,
        `The Zenvi desktop app has ${running.project ?? "an untitled project"} open, not ${file}. ${tool} reads this session's project there and does not switch projects on its own: call launch_editor to open ${file} in the app (ask the user first if they are working in it), then try again.`,
      ),
    };
  }

  const opened = await state.openOnce(() => openDesktop(ctx, state));
  if (opened.kind === "not-installed") {
    return {
      ok: false,
      receipt: refused(tool, `${tool} runs in the Zenvi desktop app, which is not installed on this machine. Get it at ${DOWNLOAD_URL} (a development checkout: set ZENVI_DESKTOP_CMD).`),
    };
  }
  if (opened.kind === "failed") {
    return { ok: false, receipt: refused(tool, `${tool} runs in the Zenvi desktop app, which could not open ${file ?? "Zenvi"}: ${opened.message} If Zenvi has unsaved changes in another project, ask the user to save or close it, then try again.`) };
  }
  const summary = opened.summary;
  state.hosts.invalidate();
  ticker.say(`${summary} Waiting for it to ${file ? "show the project" : "start"}…`);
  const deadline = Date.now() + state.desktopWaitMs;
  for (;;) {
    if (file) {
      const desktop = await state.desktopExecutor();
      if (desktop) return { ok: true, desktop, note: `${summary} This session's Zenvi edits now go through the app.`, release: keep };
    } else {
      const endpoint = await anyDesktop(ctx);
      if (endpoint) return { ok: true, ...transient(endpoint), note: summary };
    }
    if (Date.now() >= deadline || call.signal.aborted) break;
    await sleep(Math.min(1000, Math.max(0, deadline - Date.now())), call.signal);
  }
  if (call.signal.aborted) return { ok: false, receipt: refused(tool, `Cancelled while waiting for the Zenvi desktop app; nothing was sent to it.`) };
  return {
    ok: false,
    receipt: failed(tool, `${summary} But the app did not ${file ? `show ${file}` : "answer"} within ${Math.round(state.desktopWaitMs / 1000)} s. Try again once Zenvi ${file ? "shows the project" : "is open"}.`),
  };
}

async function requireDesktopTool(desktop: DesktopExecutor, tool: string, forTool: string): Promise<ToolReceipt | undefined> {
  if (await desktop.hasTool(tool)) return undefined;
  return refused(forTool, `The Zenvi desktop app running here has no ${tool} yet: update Zenvi (${DOWNLOAD_URL}).`);
}

function withNote(receipt: ToolReceipt, note: string | undefined): ToolReceipt {
  return note ? { ...receipt, notes: [...(receipt.notes ?? []), note] } : receipt;
}

async function forward(desktop: DesktopExecutor, tool: string, args: Record<string, unknown>, call: ExtraCallContext, ticker: Ticker): Promise<{ receipt: ToolReceipt; images: ExtraToolResult["images"] }> {
  const outcome = await ticker.during("Working in the Zenvi desktop app", desktop.call(tool, args, call.signal, { onprogress: ticker.relay("Working in the Zenvi desktop app…") }));
  const receipt = outcome.receipt ?? (outcome.ok ? applied(tool, outcome.text, {}, 0) : failed(tool, outcome.text || `${tool} failed`));
  return { receipt, images: outcome.images };
}

/**
 * Argument names a desktop accepts: its own tools/list when it publishes
 * properties (a newer desktop's new arguments pass), else nothing to check
 * (the desktop validates). `undefined` = no check possible here.
 */
async function liveUnknownArguments(desktop: DesktopExecutor, tool: string, args: Record<string, unknown>): Promise<string | undefined> {
  const live = await desktop.toolSchema(tool);
  return live ? unknownArgumentsMessage(tool, args, live) : undefined;
}

/** The desktop's handoff tools, listed with the desktop's schemas and forwarded. */
function desktopHandoffTools(ctx: CommandContext): ExtraTool[] {
  return DESKTOP_HANDOFF_TOOLS.map((def) => ({
    name: def.name,
    title: def.title,
    description: `Zenvi desktop app: ${def.description}`,
    inputSchema: def.inputSchema,
    annotations: def.annotations,
    checksOwnArguments: true,
    async run(state, args, call) {
      const ticker = new Ticker(call, state.keepAliveMs);
      const need = PROJECT_NEED[def.name] ?? "edit";
      const refusal = preflight(ctx, state, def.name, need);
      if (refusal) return { receipt: refusal, engine: null };
      // 1. Arguments, against the running desktop's own schema (this zenvi's copy when none runs), before any switch or launch.
      const running = await anyDesktop(ctx);
      if (running) {
        const probe = transient(running);
        try {
          const unknown = await liveUnknownArguments(probe.desktop, def.name, args);
          if (unknown) return { receipt: refused(def.name, unknown), engine: null };
        } finally {
          await probe.release();
        }
      } else {
        const unknown = unknownArgumentsMessage(def.name, args, def.inputSchema);
        if (unknown) {
          return { receipt: refused(def.name, `${unknown} (this zenvi's copy of the desktop's tools; with a newer Zenvi desktop app, open the project in it first with launch_editor, then try again)`), engine: null };
        }
      }
      // 2. The Adobe app a send needs, before the desktop is touched.
      const adobe = NEEDS_ADOBE[def.name];
      if (adobe) {
        const connection = await state.hosts.connect(adobe);
        if (!connection.ok) {
          return { receipt: refused(def.name, `${APP_LABEL[adobe]} is not connected: ${connection.discovery.detail}. ${howToConnect(adobe, connection.discovery)}`), engine: null };
        }
      }
      // 3. The desktop app, then the call.
      const ready = await ensureDesktop(ctx, state, def.name, call, ticker, need);
      if (!ready.ok) return { receipt: ready.receipt, engine: null };
      try {
        const missing = await requireDesktopTool(ready.desktop, def.name, def.name);
        if (missing) return { receipt: withNote(missing, ready.note), engine: "desktop" };
        const unknown = await liveUnknownArguments(ready.desktop, def.name, args);
        if (unknown) return { receipt: withNote(refused(def.name, unknown), ready.note), engine: "desktop" };
        const { receipt, images } = await forward(ready.desktop, def.name, resolvePathArgs(args, ctx.cwd, ctx.config.home), call, ticker);
        return { receipt: withNote(receipt, ready.note), images, engine: "desktop" };
      } finally {
        await ready.release();
      }
    },
  }));
}

type AdobeKey = "after_effects" | "premiere";

/** A failed Adobe step as this tool's receipt (nothing was added to Zenvi). */
function adobeStepFailed(tool: string, step: string, host: CliHostReceipt): ToolReceipt {
  const make = host.status === "refused" ? refused : failed;
  return make(tool, `${host.summary.replace(/^Error:\s*/, "")} (${step}; nothing was added to the Zenvi project)`, { data: { [host.host === "aftereffects" ? "after_effects" : "premiere"]: host }, warnings: host.warnings ?? [] });
}

/** One receipt for both apps: the desktop's (clips, undo steps) with the Adobe receipt beside it. */
function combined(tool: string, summary: string, adobeKey: AdobeKey, adobe: CliHostReceipt, zenvi: ToolReceipt, note: string | undefined): ToolReceipt {
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

/**
 * The Adobe step ran but nothing reached the Zenvi project (cancelled, the
 * project is no longer open, the import failed): say so, keep the Adobe
 * receipt and the call that adds the result later.
 */
function notImported(tool: string, status: "refused" | "error", why: string, adobeKey: AdobeKey, adobe: CliHostReceipt, retry: { tool: string; arguments: Record<string, unknown> }, note: string | undefined): ToolReceipt {
  const make = status === "refused" ? refused : failed;
  const receipt = make(tool, `${why} Nothing was added to the Zenvi project; data.retry adds the result later (${retry.tool}).`, {
    data: { [adobeKey]: adobe, retry },
    warnings: adobe.warnings ?? [],
  });
  return withNote(receipt, note);
}

/**
 * The desktop that has this session's project open right now, for the import
 * that ends an orchestration (the Adobe step can take minutes; the app may
 * have switched projects meanwhile).
 */
async function importTarget(state: McpState): Promise<DesktopExecutor | undefined> {
  return state.desktopExecutor();
}

/** An orchestration's arguments: text converted like the Adobe tools' (digits are ids); "" and null mean "use the default". */
function optionalArgs(schema: JsonSchemaObject, raw: Record<string, unknown>): Record<string, unknown> {
  const coerced = coerceHostArgs(schema as unknown as { properties?: Record<string, unknown> }, raw);
  return Object.fromEntries(Object.entries(coerced).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

const NO_FILE = "this session's project has no file yet: call open_project_file first (the clips go into a saved project in the Zenvi desktop app).";

/** Run the Adobe step with keep-alive progress; a cancelled call is refused afterwards (ExtendScript cannot be interrupted). */
async function adobeStep(state: McpState, ticker: Ticker, message: string, tool: string, args: Record<string, unknown>): Promise<HostCallResult> {
  ticker.say(`${message}…`);
  return ticker.during(message, callAdobeTool(state.hosts, tool, args, { timeoutMs: ADOBE_RENDER_WAIT_MS }));
}

/** The import's outcome, or a receipt that keeps the Adobe result when it never landed. */
async function importStep(
  state: McpState,
  ticker: Ticker,
  call: ExtraCallContext,
  tool: string,
  importTool: string,
  importArgs: Record<string, unknown>,
  adobeKey: AdobeKey,
  adobe: CliHostReceipt,
  what: string,
  note: string | undefined,
): Promise<{ ok: true; zenvi: ToolReceipt } | { ok: false; receipt: ToolReceipt }> {
  const retry = { tool: importTool, arguments: importArgs };
  if (call.signal.aborted) {
    return { ok: false, receipt: notImported(tool, "refused", `Cancelled after ${what}.`, adobeKey, adobe, retry, note) };
  }
  const target = await importTarget(state);
  if (!target) {
    const why = `${what}, but the Zenvi desktop app no longer has ${state.session.file} open (it switched projects or quit meanwhile).`;
    return { ok: false, receipt: notImported(tool, "refused", why, adobeKey, adobe, retry, note) };
  }
  ticker.say("Adding it to the Zenvi project…");
  try {
    const { receipt } = await forward(target, importTool, importArgs, call, ticker);
    return { ok: true, zenvi: receipt };
  } catch (error) {
    const why = `${what}, but the Zenvi desktop app failed during ${importTool}: ${error instanceof Error ? error.message : String(error)}.`;
    return { ok: false, receipt: notImported(tool, "error", why, adobeKey, adobe, retry, note) };
  }
}

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
      "(data.after_effects, data.zenvi) and the new clip; when the render could not be added, data.retry is the call that adds it. Needs After " +
      "Effects connected (list_hosts) and a saved project (open_project_file).",
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(state, raw, call) {
      const ticker = new Ticker(call, state.keepAliveMs);
      const args = optionalArgs(inputSchema, raw) as { comp?: unknown; alpha?: unknown; position?: unknown; track?: unknown };
      if (args.alpha !== undefined && typeof args.alpha !== "boolean") return { receipt: refused(tool, "alpha must be true or false"), engine: null };
      if (args.position !== undefined && (typeof args.position !== "number" || !(args.position >= 0))) return { receipt: refused(tool, "position must be a time in seconds, 0 or more"), engine: null };
      if (!state.session.file) return { receipt: refused(tool, NO_FILE), engine: null };
      const connection = await state.hosts.connect("aftereffects");
      if (!connection.ok) {
        return { receipt: refused(tool, `After Effects is not connected: ${connection.discovery.detail}. ${howToConnect("aftereffects", connection.discovery)}`), engine: null };
      }
      const ready = await ensureDesktop(ctx, state, tool, call, ticker, "edit");
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
      if (call.signal.aborted) return { receipt: withNote(refused(tool, "Cancelled before rendering; nothing changed."), ready.note), engine: null };
      const render = await adobeStep(state, ticker, "Rendering in After Effects", "ae_render_for_zenvi", renderArgs);
      if (!isOkHostStatus(render.receipt.status)) return { receipt: withNote(adobeStepFailed(tool, "rendering in After Effects", render.receipt), ready.note), engine: "desktop" };
      const media = aeRenderLink(render.receipt.data ?? {}, args.alpha as boolean | undefined);
      if (!media) {
        return {
          receipt: withNote(failed(tool, "After Effects finished ae_render_for_zenvi without naming the rendered file (data.path); nothing was added to the Zenvi project", { data: { after_effects: render.receipt } }), ready.note),
          engine: "desktop",
        };
      }
      const importArgs: Record<string, unknown> = { path: media.path, link: media.link };
      if (args.position !== undefined) importArgs.position = args.position;
      if (args.track !== undefined) importArgs.track = String(args.track);
      const comp = String((media.link.source as { composition?: unknown } | undefined)?.composition ?? render.receipt.data?.comp_name ?? "the comp");
      const step = await importStep(state, ticker, call, tool, "import_linked_media_tool", importArgs, "after_effects", render.receipt, `After Effects rendered "${comp}" to ${media.path}`, ready.note);
      if (!step.ok) return { receipt: step.receipt, engine: "desktop" };
      const zenvi = step.zenvi;
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
      "Clips, trims, speed, motion/opacity/volume keyframes, cross dissolves and markers survive. Returns both apps' receipts (data.premiere, " +
      "data.zenvi); when the sequence could not be imported, data.retry is the call that imports it. Needs Premiere Pro connected (list_hosts) and " +
      "a saved project (open_project_file).",
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(state, raw, call) {
      const ticker = new Ticker(call, state.keepAliveMs);
      const args = optionalArgs(inputSchema, raw) as { sequence?: unknown; placement?: unknown };
      if (args.placement !== undefined && args.placement !== "new_tracks" && args.placement !== "at_playhead") {
        return { receipt: refused(tool, "placement must be new_tracks or at_playhead"), engine: null };
      }
      if (!state.session.file) return { receipt: refused(tool, NO_FILE), engine: null };
      const connection = await state.hosts.connect("premiere");
      if (!connection.ok) {
        return { receipt: refused(tool, `Premiere Pro is not connected: ${connection.discovery.detail}. ${howToConnect("premiere", connection.discovery)}`), engine: null };
      }
      const ready = await ensureDesktop(ctx, state, tool, call, ticker, "edit");
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
      if (call.signal.aborted) return { receipt: withNote(refused(tool, "Cancelled before exporting; nothing changed."), ready.note), engine: null };
      const exported = await adobeStep(state, ticker, "Exporting the sequence from Premiere Pro", "premiere_export_xml", exportArgs);
      if (!isOkHostStatus(exported.receipt.status)) return { receipt: withNote(adobeStepFailed(tool, "exporting from Premiere Pro", exported.receipt), ready.note), engine: "desktop" };
      const xml = exportedXmlPath(exported.receipt.data ?? {});
      if (!xml) {
        return {
          receipt: withNote(failed(tool, "Premiere Pro finished premiere_export_xml without naming the XML file (data.path); nothing was added to the Zenvi project", { data: { premiere: exported.receipt } }), ready.note),
          engine: "desktop",
        };
      }
      const name = String(exported.receipt.data?.sequence_name ?? exported.receipt.data?.name ?? args.sequence ?? "the active sequence");
      const importArgs = { path: xml, placement: args.placement ?? "new_tracks" };
      const step = await importStep(state, ticker, call, tool, "import_timeline_xml_tool", importArgs, "premiere", exported.receipt, `Premiere Pro exported "${name}" to ${xml}`, ready.note);
      if (!step.ok) return { receipt: step.receipt, engine: "desktop" };
      const zenvi = step.zenvi;
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
