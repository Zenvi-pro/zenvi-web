/**
 * The catalog: every tool by name, and the one dispatcher every Zenvi
 * surface calls (the Assistant bridge, the local and remote MCP servers, the
 * CLI, the editor's command palette).
 *
 *   runTool(ctx, name, args) → coerce → validate (refused receipt, history
 *   untouched) → capability check → run (at most one `doc.transaction`) →
 *   contract-3 receipt as ToolResult.
 *
 * Contract tools come first, in the desktop's order (schemas.gen.ts), then
 * the direct tools for coding agents. Desktop tools not ported yet
 * (pending.ts) are in neither: no surface lists them and `runTool` refuses
 * them like any unknown name. `runTool` never throws: unknown names and
 * unexpected failures come back as receipts too.
 */

import { animatedTitleTools } from "./catalog/animated-titles.js";
import { audioTools } from "./catalog/audio.js";
import { captionTools } from "./catalog/captions.js";
import { clipPropsTools } from "./catalog/clip-props.js";
import { clipTools } from "./catalog/clips.js";
import { colorAgentTools } from "./catalog/color-agent.js";
import { comfyuiRecordingTools } from "./catalog/comfyui-recording.js";
import { directTools } from "./catalog/direct.js";
import { effectsColorTools } from "./catalog/effects-color.js";
import { effectsColorAnalysisTools } from "./catalog/effects-color-analysis.js";
import { effectsColorLookTools } from "./catalog/effects-color-looks.js";
import { exportTools } from "./catalog/export.js";
import { generationTools } from "./catalog/generation.js";
import { inspectTools } from "./catalog/inspect.js";
import { matchCutTools } from "./catalog/match-cut.js";
import { matteTools } from "./catalog/mattes.js";
import { mediaTools } from "./catalog/media.js";
import { mediaFilesTools } from "./catalog/media-files.js";
import { mediaFilesTransitionTools } from "./catalog/media-files-transitions.js";
import { metadataTools } from "./catalog/metadata.js";
import { motionTools } from "./catalog/motion.js";
import { motionTemplateTools } from "./catalog/motion-templates.js";
import { kineticCaptionTools } from "./catalog/kinetic-captions.js";
import { motionTransitionTools } from "./catalog/motion-transitions.js";
import { overlayTools } from "./catalog/overlays.js";
import { phase3Tools } from "./catalog/phase3.js";
import { playbackTools } from "./catalog/playback.js";
import { projectTools } from "./catalog/project.js";
import { projectExportTools } from "./catalog/project-export.js";
import { projectPrefsTools } from "./catalog/project-export-prefs.js";
import { projectProfileTools } from "./catalog/project-export-profiles.js";
import { projectRenderTools } from "./catalog/project-export-render.js";
import { reelTools } from "./catalog/reels.js";
import { searchTools } from "./catalog/search.js";
import { soundDesignTools } from "./catalog/sound-design.js";
import { speedRampTools } from "./catalog/speed-ramp.js";
import { speechTools } from "./catalog/speech-tools.js";
import { stockTools } from "./catalog/stock.js";
import { timelineTools } from "./catalog/timeline.js";
import { timelineEditTools } from "./catalog/timeline-edit.js";
import { timelineTimeTools } from "./catalog/timeline-time.js";
import { tracksNavTools } from "./catalog/tracks-nav.js";
import { titleTemplateTools } from "./catalog/title-templates.js";
import { titleTools } from "./catalog/titles.js";
import { transitionTools } from "./catalog/transitions.js";
import { webVideoTools } from "./catalog/web-video.js";
import { missingCapabilities, resultFor, type CatalogTool } from "./define.js";
import { DESKTOP_NAMES_ON_DIRECT_TOOLS, PENDING_DESKTOP_TOOLS } from "./pending.js";
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
    ...timelineEditTools,
    ...timelineTimeTools,
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
    ...webVideoTools,
    ...comfyuiRecordingTools,
    ...transitionTools,
    ...mediaFilesTransitionTools,
    ...mediaFilesTools,
    ...titleTools,
    ...titleTemplateTools,
    ...animatedTitleTools,
    ...captionTools,
    ...overlayTools,
    ...clipPropsTools,
    ...tracksNavTools,
    ...effectsColorTools,
    ...effectsColorLookTools,
    ...effectsColorAnalysisTools,
    ...colorAgentTools,
    ...projectExportTools,
    ...projectProfileTools,
    ...projectRenderTools,
    ...projectPrefsTools,
  ];
  const byName = new Map<string, CatalogTool>();
  for (const tool of [...implemented, ...directTools, ...reelTools, ...matchCutTools, ...motionTemplateTools, ...kineticCaptionTools, ...soundDesignTools, ...motionTransitionTools, ...speedRampTools, ...stockTools, ...matteTools]) {
    if (byName.has(tool.name)) throw new Error(`tool catalog: ${tool.name} is defined twice`);
    byName.set(tool.name, tool);
  }
  const extra = implemented.filter((tool) => !tool.contract);
  if (extra.length > 0) throw new Error(`tool catalog: non-contract tools outside the direct list: ${extra.map((t) => t.name).join(", ")}`);
  // Every desktop tool is ported, pending, or (for now) a direct tool's name.
  const contract: CatalogTool[] = [];
  const problems: string[] = [];
  for (const name of CONTRACT_TOOL_NAMES) {
    const tool = byName.get(name);
    if (PENDING_DESKTOP_TOOLS.has(name)) {
      if (tool) problems.push(`${name} is implemented: remove it from PENDING_DESKTOP_TOOLS`);
    } else if (DESKTOP_NAMES_ON_DIRECT_TOOLS.has(name)) {
      if (!tool || tool.contract) problems.push(`${name} is not a direct tool: remove it from DESKTOP_NAMES_ON_DIRECT_TOOLS`);
    } else if (!tool) {
      problems.push(`${name} has no implementation: port it or add it to PENDING_DESKTOP_TOOLS`);
    } else if (!tool.contract) {
      problems.push(`direct tool ${name} has a desktop tool's name: add it to DESKTOP_NAMES_ON_DIRECT_TOOLS`);
    } else {
      contract.push(tool);
    }
  }
  if (problems.length > 0) throw new Error(`tool catalog: ${problems.join("; ")}`);
  return [...contract, ...directTools, ...reelTools, ...matchCutTools, ...motionTemplateTools, ...kineticCaptionTools, ...soundDesignTools, ...motionTransitionTools, ...speedRampTools, ...stockTools, ...matteTools];
}

/** Every tool: the ported desktop (contract) tools in the desktop's order, then the direct tools. */
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
