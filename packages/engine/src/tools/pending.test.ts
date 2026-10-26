/**
 * The desktop contract against this catalog: every tool Zenvi desktop lists
 * is ported, pending (never listed, refused like an unknown name), or for now
 * the name of an older direct tool; ported tools refuse the desktop
 * arguments they do not honour yet instead of ignoring them.
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../docs/specs/desktop-editor-tools-manifest.json" with { type: "json" };
import { schemaTypes, type JsonSchema } from "./json-schema.js";
import { DESKTOP_NAMES_ON_DIRECT_TOOLS, PENDING_DESKTOP_ARGS, PENDING_DESKTOP_TOOLS, pendingArgumentMessage } from "./pending.js";
import { allTools, getTool, listTools, runTool, unknownToolMessage } from "./registry.js";
import { CONTRACT_REF, CONTRACT_TOOL_NAMES, contractMeta, type ContractToolName } from "./schemas.gen.js";
import { fakeHost } from "./test-support/fake-host.js";
import { IDS, fixtureDoc, snapshotOf } from "./test-support/fixture.js";
import type { ToolSurface } from "./types.js";

/** zenvi-core agent_api_proxy.py MCP_EXTRA_TOOLS: listed by the desktop's MCP server only. */
const MCP_EXTRAS = [
  "zenvi_api_request",
  "send_assistant_prompt_tool",
  "mcp_health_tool",
  "wait_for_editor_job_tool",
  "get_log_paths_tool",
  "capture_editor_screenshot_tool",
];

const contractNames: readonly string[] = CONTRACT_TOOL_NAMES;

/** A value the schema accepts that is not its default (and not empty). */
function nonDefault(schema: JsonSchema): unknown {
  const types = schemaTypes(schema);
  if (schema.enum) return schema.enum.find((v) => v !== schema.default && v !== "");
  if (types.has("boolean")) return !(schema.default ?? false);
  if (types.has("integer") || types.has("number")) {
    const lo = schema.minimum ?? 0;
    const hi = schema.maximum ?? lo + 10;
    const mid = types.has("integer") ? Math.round((lo + hi) / 2) : (lo + hi) / 2;
    return [lo, mid, hi].find((v) => v !== schema.default);
  }
  if (types.has("array")) return [nonDefault(schema.items ?? { type: "string" })];
  if (types.has("object")) {
    if (!schema.properties || Object.keys(schema.properties).length === 0) return { key: 1 };
    return Object.fromEntries((schema.required ?? []).map((key) => [key, nonDefault(schema.properties![key]!)]));
  }
  return "x";
}

describe("the desktop contract", () => {
  it("is every tool the desktop app lists: agent handlers, every editor tool, the MCP extras", () => {
    expect(CONTRACT_TOOL_NAMES).toHaveLength(169);
    expect(new Set(CONTRACT_TOOL_NAMES).size).toBe(169);
    for (const tool of manifest.tools) expect(contractNames, tool.name).toContain(tool.name);
    for (const name of MCP_EXTRAS) expect(contractNames, name).toContain(name);
    expect(manifest.commit.startsWith(CONTRACT_REF)).toBe(true);
  });

  it("takes an editor tool's schema, label and read-only flag from the manifest", () => {
    for (const tool of manifest.tools) {
      const meta = contractMeta[tool.name as ContractToolName];
      expect(meta.title, tool.name).toBe(tool.label);
      expect(meta.desktopReadOnly, tool.name).toBe(tool.read_only);
      expect(meta.handler, tool.name).toMatch(/^src\/classes\/editor_tools\/\w+\.py:\w+$/);
      for (const arg of Object.keys(tool.input_schema.properties)) expect(Object.keys(meta.inputSchema.properties), `${tool.name}.${arg}`).toContain(arg);
    }
  });

  it("splits into ported tools and pending tools (no older direct tool keeps a desktop name)", () => {
    const ported = contractNames.filter((name) => getTool(name)?.contract === true);
    expect(ported).toHaveLength(163);
    expect(PENDING_DESKTOP_TOOLS.size).toBe(6);
    expect(DESKTOP_NAMES_ON_DIRECT_TOOLS.size).toBe(0);
    expect(ported.length + PENDING_DESKTOP_TOOLS.size + DESKTOP_NAMES_ON_DIRECT_TOOLS.size).toBe(CONTRACT_TOOL_NAMES.length);
    for (const name of CONTRACT_TOOL_NAMES) {
      const kinds = [ported.includes(name), PENDING_DESKTOP_TOOLS.has(name), DESKTOP_NAMES_ON_DIRECT_TOOLS.has(name)];
      expect(kinds.filter(Boolean), name).toHaveLength(1);
    }
  });
});

describe("pending desktop tools", () => {
  it("are a sorted list of contract names", () => {
    const pending = [...PENDING_DESKTOP_TOOLS];
    expect(pending).toEqual([...pending].sort());
    for (const name of pending) expect(contractNames, name).toContain(name);
  });

  it("have no implementation and are listed on no surface", () => {
    for (const name of PENDING_DESKTOP_TOOLS) expect(getTool(name), name).toBeUndefined();
    const surfaces: (ToolSurface | undefined)[] = [undefined, "assistant", "mcp", "cli", "editor"];
    const listed = new Set(surfaces.flatMap((surface) => listTools({ surface, includeDeprecated: true }).map((t) => t.name)));
    for (const name of PENDING_DESKTOP_TOOLS) expect(listed.has(name), name).toBe(false);
  });

  it("leave the listings as they were: 163 ported tools and 40 direct tools", () => {
    expect(allTools).toHaveLength(203);
    expect(listTools({ includeDeprecated: true })).toHaveLength(203);
    // Hidden by default: remove_clip_tool, delete_clips_on_track_tool, suggest_motion_graphics_placements_tool,
    // fetch_remotion_video_from_supabase_tool (deprecated).
    expect(listTools({ surface: "editor" })).toHaveLength(199);
    expect(listTools({ surface: "assistant", includeDeprecated: true }).every((t) => t.contract)).toBe(true);
  });

  it("are answered with the standard not-available refusal, and history is untouched", async () => {
    for (const name of ["get_log_paths_tool", "capture_editor_screenshot_tool", "mcp_health_tool", "wait_for_editor_job_tool"]) {
      const doc = fixtureDoc();
      const before = snapshotOf(doc.project);
      const result = await runTool({ doc, host: fakeHost() }, name, {});
      expect(result.ok, name).toBe(false);
      expect(result.data?.status, name).toBe("refused");
      expect(result.data?.summary, name).toBe(unknownToolMessage(name));
      expect(doc.undoLabels, name).toEqual([]);
      expect(snapshotOf(doc.project), name).toEqual(before);
    }
  });
});

describe("desktop names on older direct tools", () => {
  it("are exactly the direct tools that share a desktop tool's name", () => {
    const shared = allTools.filter((t) => !t.contract && contractNames.includes(t.name)).map((t) => t.name);
    expect(shared.sort()).toEqual([...DESKTOP_NAMES_ON_DIRECT_TOOLS].sort());
    for (const name of DESKTOP_NAMES_ON_DIRECT_TOOLS) expect(PENDING_DESKTOP_TOOLS.has(name), name).toBe(false);
  });
});

describe("pending desktop arguments", () => {
  const entries = Object.entries(PENDING_DESKTOP_ARGS) as [ContractToolName, readonly string[]][];

  it("name arguments the desktop schema has, on ported tools, sorted", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [tool, args] of entries) {
      expect(getTool(tool)?.contract, tool).toBe(true);
      expect(args, tool).toEqual([...args].sort());
      expect(new Set(args).size, tool).toBe(args.length);
      for (const arg of args) expect(Object.keys(contractMeta[tool].inputSchema.properties), `${tool}.${arg}`).toContain(arg);
    }
  });

  it("are refused, before anything changes, when set to anything but their default", async () => {
    for (const [tool, args] of entries) {
      const schema = contractMeta[tool].inputSchema;
      const required = Object.fromEntries((schema.required ?? []).map((key) => [key, nonDefault(schema.properties[key]!)]));
      for (const arg of args) {
        const doc = fixtureDoc();
        const before = snapshotOf(doc.project);
        const result = await runTool({ doc, host: fakeHost() }, tool, { ...required, [arg]: nonDefault(schema.properties[arg]!) });
        expect(result.data?.summary, `${tool}.${arg}`).toBe(pendingArgumentMessage(tool, arg));
        expect(result.data?.status, `${tool}.${arg}`).toBe("refused");
        expect(doc.undoLabels, `${tool}.${arg}`).toEqual([]);
        expect(snapshotOf(doc.project), `${tool}.${arg}`).toEqual(before);
      }
    }
  });

  it("let the default value through", async () => {
    const host = fakeHost();
    const result = await runTool({ doc: fixtureDoc(), host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur", processing: {} });
    expect(result.ok, result.data?.summary).toBe(true);
    const refused = await runTool({ doc: fixtureDoc(), host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur", processing: { smoothing: 10 } });
    expect(refused.data?.summary).toBe(pendingArgumentMessage("add_effect_tool", "processing"));
  });

  it("are not refused with the not-available wording, so the Assistant retries without them", () => {
    expect(pendingArgumentMessage("add_title_tool", "font")).not.toMatch(/not available/);
  });
});
