/**
 * The engine bridge (docs/ENGINE_BRIDGE.md): run one engine tool on a
 * project the Zenvi desktop app holds in memory and answer the change as
 * desktop UpdateManager calls, which the desktop applies as one undo step.
 *
 * Nothing here saves the project: the desktop owns its file, history and
 * export, so the bridge host has no `storage`, `exporter`, `player` or `ui`
 * (tools that need them answer that they are unavailable). Files a tool
 * writes go to the project's `<name>_assets` folder and are listed in the
 * answer; when the call fails or changes nothing they are removed again.
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import {
  DesktopActionError,
  fromStoredPaths,
  parseProject,
  ProjectDocument,
  projectAssetsDir,
  replaceNonFiniteTokens,
  toDesktopActions,
  type ChangeEvent,
  type DesktopAction,
  type ImportedMedia,
  type MediaHost,
  type Project,
  type ToolHost,
  type ToolImage,
  type ToolSurface,
} from "@zenvi/engine";
import { parseReceipt, refused, type ToolReceipt } from "@zenvi/engine/tools";
import { createNodeHost, isInside, loadRoots, localPath, type NodeHostOptions } from "@zenvi/render-node";
import type { Registry } from "../engine/registry.js";
import { VERSION } from "../version.js";

/** Bumped when a request or answer field changes meaning; the desktop refuses a CLI it does not speak. */
export const BRIDGE_PROTOCOL = 1;

export interface BridgeRequest {
  tool: string;
  args?: Record<string, unknown>;
  /** The project JSON as the desktop holds it in memory (`history` may be left out). */
  project: unknown;
  /** Where the desktop saves the project: relative paths and the `<name>_assets` folder resolve against it. */
  project_file: string;
  /** Surface the tool is listed on (default `mcp`). */
  surface?: ToolSurface;
}

export interface BridgeAnswer {
  protocol: typeof BRIDGE_PROTOCOL;
  engine_version: string;
  ok: boolean;
  /** The tool's result text (a contract-3 receipt as JSON for catalog tools). */
  text: string;
  receipt?: ToolReceipt;
  /** Undo label for the transaction. */
  label?: string;
  /** Desktop UpdateManager calls, in order; empty when nothing changed. */
  actions: DesktopAction[];
  /** Files the call wrote, absolute. */
  files: string[];
  images?: ToolImage[];
  timings: { parse_ms: number; run_ms: number; translate_ms: number };
}

/** Parse a request line: JSON, tolerating the NaN / Infinity tokens Python's json.dumps writes. */
export function parseBridgeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const tolerant = replaceNonFiniteTokens(text);
    if (tolerant === null) throw error;
    return JSON.parse(tolerant);
  }
}

/** The bridge's ToolHost: the Node host minus what the desktop owns, recording files the call writes. */
export function bridgeHost(projectFile: string, written: string[], options: Omit<NodeHostOptions, "projectFile"> = {}): ToolHost {
  const { storage: _storage, exporter: _exporter, player: _player, ui: _ui, ...base } = createNodeHost({ ...options, projectFile });
  const assets = projectAssetsDir(projectFile);
  const media = base.media!;
  const note = (p: string): string => {
    if (isInside(p, assets)) written.push(p);
    return p;
  };
  // An import that keeps a file already in the assets folder where it is wrote nothing: only copies belong to the call.
  const noteCopy = (source: string | undefined, m: ImportedMedia): ImportedMedia => {
    if (source === undefined || path.resolve(m.path) !== source) note(m.path);
    return m;
  };
  const { collect: _collect, removeCopies: _removeCopies, ...kept } = media;
  const bridged: MediaHost = {
    ...kept,
    ...(media.writeGenerated ? { writeGenerated: async (name, bytes, type) => note(await media.writeGenerated!(name, bytes, type)) } : {}),
    ...(media.importPath ? { importPath: async (p) => noteCopy(localPath(p), await media.importPath!(p)) } : {}),
    ...(media.importUrl ? { importUrl: async (u, o) => noteCopy(/^file:/i.test(u) ? localPath(u) : undefined, await media.importUrl!(u, o)) } : {}),
  };
  return { ...base, media: bridged };
}

function elapsed(since: number): number {
  return Math.round((performance.now() - since) * 10) / 10;
}

function errorAnswer(tool: string, message: string, timings: BridgeAnswer["timings"], files: string[] = []): BridgeAnswer {
  const receipt = refused(tool, message.startsWith("Error") ? message : `Error: ${message}`);
  return { protocol: BRIDGE_PROTOCOL, engine_version: VERSION, ok: false, text: JSON.stringify(receipt), receipt, actions: [], files, timings };
}

/** Load the request's project with the desktop's in-memory (absolute) paths kept and the rest resolved against `project_file`. */
function loadProject(request: BridgeRequest): Project {
  const file = path.resolve(request.project_file);
  return fromStoredPaths(parseProject(request.project), path.dirname(file), loadRoots(file));
}

export interface RunBridgeOptions {
  registry: Registry;
  host?: Omit<NodeHostOptions, "projectFile">;
  signal?: AbortSignal;
}

/** Run one bridged tool call. Never throws for a bad request or a failed tool: the answer says `ok: false`. */
export async function runBridgeCall(request: BridgeRequest, options: RunBridgeOptions): Promise<BridgeAnswer> {
  const timings = { parse_ms: 0, run_ms: 0, translate_ms: 0 };
  const tool = typeof request.tool === "string" ? request.tool : "";
  if (!tool) return errorAnswer("bridge", "the request names no tool", timings);
  if (typeof request.project_file !== "string" || !path.isAbsolute(request.project_file)) {
    return errorAnswer(tool, "project_file must be the absolute path the project is saved at", timings);
  }
  let start = performance.now();
  let doc: ProjectDocument;
  try {
    doc = new ProjectDocument(loadProject(request), { historyLimit: 0 });
  } catch (error) {
    return errorAnswer(tool, `the project could not be read: ${(error as Error).message}`, timings);
  }
  timings.parse_ms = elapsed(start);

  const events: ChangeEvent[] = [];
  doc.subscribe((event) => events.push(event));
  const written: string[] = [];
  const host = bridgeHost(path.resolve(request.project_file), written, options.host);
  const discard = async () => {
    await Promise.all(written.map((f) => rm(f, { force: true })));
    return [];
  };

  start = performance.now();
  let result: Awaited<ReturnType<Registry["run"]>>;
  try {
    result = await options.registry.run({ doc, host, signal: options.signal }, tool, request.args ?? {}, request.surface ?? "mcp");
  } catch (error) {
    // A programmer error: still leave no files behind.
    await discard();
    throw error;
  }
  timings.run_ms = elapsed(start);
  const receipt = (result.data as ToolReceipt | undefined) ?? parseReceipt(result.text) ?? undefined;

  const foreign = events.find((e) => e.source !== "apply" && e.source !== "untracked");
  if (foreign) return errorAnswer(tool, `${tool} ${foreign.source === "load" ? "opens or creates a project" : `runs ${foreign.source}`}, which the desktop does itself`, timings, await discard());

  start = performance.now();
  let actions: DesktopAction[] = [];
  try {
    for (const event of events) if (event.source === "apply") actions.push(...toDesktopActions(event.previous, event.actions, event.replaced));
  } catch (error) {
    await discard();
    if (!(error instanceof DesktopActionError)) throw error;
    return errorAnswer(tool, `${tool} made a change the desktop cannot apply (${error.message})`, timings);
  }
  timings.translate_ms = elapsed(start);
  if (!result.ok) actions = [];

  const label = events.find((e) => e.source === "apply")?.label;
  return {
    protocol: BRIDGE_PROTOCOL,
    engine_version: VERSION,
    ok: result.ok,
    text: result.text,
    ...(receipt ? { receipt } : {}),
    ...(label ? { label } : {}),
    actions,
    files: actions.length > 0 ? written : await discard(),
    ...(result.images?.length ? { images: result.images } : {}),
    timings,
  };
}
