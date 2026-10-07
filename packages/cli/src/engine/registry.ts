/**
 * The engine's tool catalog (`@zenvi/engine/tools`), as the CLI and the
 * local MCP server use it. One adapter so every command and the MCP server
 * go through the same lookup, availability check and run path.
 */

import type { HostCapability, ToolAnnotations, ToolContext, ToolHost, ToolResult, ToolSurface } from "@zenvi/engine";
import * as tools from "@zenvi/engine/tools";
import type { JsonSchemaObject } from "@zenvi/engine/tools";

/** The catalog fields the CLI relies on (engine `CatalogTool`). */
export interface RegistryTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations?: ToolAnnotations;
  surfaces: ToolSurface[];
  requires?: HostCapability[];
  contract?: boolean;
  deprecated?: boolean;
  run(ctx: ToolContext, input: unknown): Promise<ToolResult> | ToolResult;
}

export interface Registry {
  readonly tools: readonly RegistryTool[];
  get(name: string): RegistryTool | undefined;
  /** Tools for a surface; hides those whose capabilities the host lacks unless asked. */
  list(surface: ToolSurface, host: ToolHost, options?: { includeUnavailable?: boolean }): RegistryTool[];
  /** Run a tool by name on a surface (unknown names give an error receipt, never a throw). */
  run(ctx: ToolContext, name: string, args: unknown, surface?: ToolSurface): Promise<ToolResult>;
}

type ToolsModule = {
  allTools?: readonly RegistryTool[];
  getTool?: (name: string) => RegistryTool | undefined;
  listTools?: (options: { surface?: ToolSurface; host?: ToolHost; includeUnavailable?: boolean }) => RegistryTool[];
  runTool?: (ctx: ToolContext, name: string, args: unknown, options?: { surface?: ToolSurface }) => Promise<ToolResult>;
};

export function missingCapabilities(tool: RegistryTool, host: ToolHost): HostCapability[] {
  return (tool.requires ?? []).filter((cap) => host[cap] === undefined || host[cap] === null);
}

/** A contract-3 error receipt for tools that do not exist on this surface. */
export function unknownToolResult(name: string): ToolResult {
  const summary = `Error: ${name} is not available in this Zenvi surface`;
  const receipt = tools.refused(name, summary);
  return { ok: false, text: JSON.stringify(receipt), data: receipt };
}

export function createRegistry(list: readonly RegistryTool[], engine: Pick<ToolsModule, "runTool" | "listTools"> = {}): Registry {
  const byName = new Map(list.map((t) => [t.name, t]));
  return {
    tools: list,
    get: (name) => byName.get(name),
    list(surface, host, options = {}) {
      if (engine.listTools) return engine.listTools({ surface, host, includeUnavailable: options.includeUnavailable });
      return list.filter(
        (t) => t.surfaces.includes(surface) && !t.deprecated && (options.includeUnavailable || missingCapabilities(t, host).length === 0),
      );
    },
    async run(ctx, name, args, surface) {
      if (engine.runTool) return engine.runTool(ctx, name, args ?? {}, surface ? { surface } : {});
      const tool = byName.get(name);
      if (!tool || (surface && !tool.surfaces.includes(surface))) return unknownToolResult(name);
      return tool.run(ctx, args ?? {});
    },
  };
}

/** The catalog shipped in this build (`@zenvi/engine/tools`). */
export function engineRegistry(): Registry {
  const mod = tools as unknown as ToolsModule;
  return createRegistry(mod.allTools ?? [], { runTool: mod.runTool, listTools: mod.listTools });
}
