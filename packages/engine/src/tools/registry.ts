/**
 * The catalog: every tool by name, and the one dispatcher every Zenvi
 * surface calls (the Assistant bridge, the local and remote MCP servers, the
 * CLI, the editor's command palette).
 *
 *   runTool(ctx, name, args) → coerce → validate (refused receipt, history
 *   untouched) → capability check → run (at most one `doc.transaction`) →
 *   contract-3 receipt as ToolResult.
 *
 * Contract tools come first, in zenvi-core TOOL_SCHEMAS order, then the
 * direct tools for coding agents. `runTool` never throws: unknown names and
 * unexpected failures come back as receipts too.
 */

import { audioTools } from "./catalog/audio.js";
import { clipTools } from "./catalog/clips.js";
import { directTools } from "./catalog/direct.js";
import { exportTools } from "./catalog/export.js";
import { generationTools } from "./catalog/generation.js";
import { inspectTools } from "./catalog/inspect.js";
import { mediaTools } from "./catalog/media.js";
import { metadataTools } from "./catalog/metadata.js";
import { motionTools } from "./catalog/motion.js";
import { phase3Tools } from "./catalog/phase3.js";
import { playbackTools } from "./catalog/playback.js";
import { projectTools } from "./catalog/project.js";
import { reelTools } from "./catalog/reels.js";
import { searchTools } from "./catalog/search.js";
import { speechTools } from "./catalog/speech-tools.js";
import { timelineTools } from "./catalog/timeline.js";
import { titleTools } from "./catalog/titles.js";
import { transitionTools } from "./catalog/transitions.js";
import { missingCapabilities, resultFor, type CatalogTool } from "./define.js";
import { failed, refused, type ToolReceipt } from "./receipt.js";
import { CONTRACT_TOOL_NAMES } from "./schemas.gen.js";
import type { ToolContext, ToolHost, ToolResult, ToolSurface } from "./types.js";

/** The refusal for a tool this surface does not have (zenvi-backend #40: "Error: … not available"). */
export function unknownToolMessage(name: string): string {
  return `Error: ${name} is not available in this Zenvi surface`;
}

function buildCatalog(): readonly CatalogTool[] {
  const implemented = [
    ...projectTools,
    ...timelineTools,
    ...clipTools,
    ...playbackTools,
    ...audioTools,
    ...exportTools,
    ...mediaTools,
    ...searchTools,
    ...motionTools,
    ...metadataTools,
    ...phase3Tools,
    ...inspectTools,
    ...speechTools,
    ...generationTools,
    ...transitionTools,
    ...titleTools,
  ];
  const byName = new Map<string, CatalogTool>();
  for (const tool of [...implemented, ...directTools, ...reelTools]) {
    if (byName.has(tool.name)) throw new Error(`tool catalog: ${tool.name} is defined twice`);
    byName.set(tool.name, tool);
  }
  const missing = CONTRACT_TOOL_NAMES.filter((name) => !byName.has(name));
  if (missing.length > 0) throw new Error(`tool catalog: contract tools without an implementation: ${missing.join(", ")}`);
  const extra = implemented.filter((tool) => !tool.contract);
  if (extra.length > 0) throw new Error(`tool catalog: non-contract tools outside the direct list: ${extra.map((t) => t.name).join(", ")}`);
  return [...CONTRACT_TOOL_NAMES.map((name) => byName.get(name)!), ...directTools, ...reelTools];
}

/** Every tool: the 73 contract tools (TOOL_SCHEMAS order), then the direct tools. */
export const allTools: readonly CatalogTool[] = buildCatalog();

const TOOLS_BY_NAME: ReadonlyMap<string, CatalogTool> = new Map(allTools.map((tool) => [tool.name, tool]));

export function getTool(name: string): CatalogTool | undefined {
  return TOOLS_BY_NAME.get(name);
}

export interface ListToolsOptions {
  /** Only tools exposed on this surface. */
  surface?: ToolSurface;
  /** Hide tools whose required capabilities this host lacks (unless `includeUnavailable`). */
  host?: ToolHost;
  includeUnavailable?: boolean;
  /** Deprecated tools are kept for stored plans and hidden from listings by default. */
  includeDeprecated?: boolean;
}

/** The tools to offer: by surface, without deprecated ones, and only those the host can run. */
export function listTools(options: ListToolsOptions = {}): CatalogTool[] {
  const { surface, host, includeUnavailable = false, includeDeprecated = false } = options;
  return allTools.filter(
    (tool) =>
      (surface === undefined || tool.surfaces.includes(surface)) &&
      (includeDeprecated || !tool.deprecated) &&
      (includeUnavailable || host === undefined || missingCapabilities(tool.requires, host).length === 0),
  );
}

export interface RunToolOptions {
  /** Refuse tools not exposed on this surface (e.g. direct tools on the Assistant bridge). */
  surface?: ToolSurface;
}

/**
 * Run a tool by name. Never throws: an unknown (or off-surface) name is a
 * refused receipt "Error: <name> is not available in this Zenvi surface", and
 * an unexpected exception is an error receipt; neither touches history.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  rawArgs: unknown = {},
  options: RunToolOptions = {},
): Promise<ToolResult<ToolReceipt>> {
  const toolName = String(name ?? "");
  const tool = TOOLS_BY_NAME.get(toolName);
  if (!tool || (options.surface !== undefined && !tool.surfaces.includes(options.surface))) {
    return resultFor(refused(toolName, unknownToolMessage(toolName)));
  }
  try {
    return (await tool.run(ctx, rawArgs ?? {})) as ToolResult<ToolReceipt>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.host.log?.(`tool ${toolName} threw: ${error instanceof Error && error.stack ? error.stack : message}`);
    return resultFor(failed(toolName, `Error: tool execution failed: ${message}`));
  }
}
