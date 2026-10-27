import { describe, expect, it } from "vitest";
import backendTools from "../../../../docs/specs/backend-frontend-tools.json";
import { normalizeArgs } from "./coerce.js";
import type { JsonSchema } from "./json-schema.js";
import { DESKTOP_NAMES_ON_DIRECT_TOOLS, PENDING_DESKTOP_TOOLS } from "./pending.js";
import { allTools, getTool, listTools, runTool } from "./registry.js";
import { CONTRACT_TOOL_NAMES, contractMeta } from "./schemas.gen.js";
import { fakeHost } from "./test-support/fake-host.js";
import { fixtureDoc, snapshotOf } from "./test-support/fixture.js";
import { toolAvailability } from "./availability.js";
import type { HostCapability } from "./types.js";

const DIRECT_TOOLS = [
  "describe_project_tool",
  "move_clip_tool",
  "trim_clip_tool",
  "split_clip_tool",
  "set_clip_property_tool",
  "set_effect_property_tool",
  "fade_clip_tool",
  "add_transition_tool",
  "probe_media_tool",
  "build_reel_tool",
  "review_render_tool",
  "add_motion_template_tool",
  "list_3d_scenes_tool",
  "add_3d_scene_tool",
  "rerender_3d_scene_tool",
  "search_pexels_videos_tool",
  "search_freesound_music_tool",
];

/** A valid string form of a scalar property, the way the Assistant backend sends arguments. */
function stringForm(schema: JsonSchema): string | undefined {
  if (schema.enum && schema.enum.length > 0) return String(schema.enum[0]);
  const types = new Set([schema.type, ...(schema.oneOf ?? []).map((b) => b.type), ...(schema.anyOf ?? []).map((b) => b.type)].flat());
  if (types.has("boolean")) return "true";
  if (types.has("integer")) return String(Math.max(schema.minimum ?? 1, 1));
  if (types.has("number")) {
    const lo = schema.minimum ?? 0;
    const hi = schema.maximum ?? Number.POSITIVE_INFINITY;
    return String(Math.min(Math.max(1.5, lo), hi));
  }
  if (types.has("string")) return "x";
  return undefined;
}

describe("tool catalog", () => {
  it("registers every ported desktop tool, in the contract's order, then the direct tools", () => {
    const ported = CONTRACT_TOOL_NAMES.filter((name) => !PENDING_DESKTOP_TOOLS.has(name) && !DESKTOP_NAMES_ON_DIRECT_TOOLS.has(name));
    expect(ported).toHaveLength(163);
    expect(allTools.map((t) => t.name)).toEqual([...ported, ...DIRECT_TOOLS]);
    expect(new Set(allTools.map((t) => t.name)).size).toBe(allTools.length);
    for (const name of ported) expect(getTool(name)?.contract).toBe(true);
    for (const name of DIRECT_TOOLS) expect(getTool(name)?.contract).toBe(false);
  });

  it("gives every tool a title, a description, MCP annotations and a closed object schema", () => {
    for (const tool of allTools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description.length, tool.name).toBeGreaterThan(10);
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations?.openWorldHint, tool.name).toBe("boolean");
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(tool.surfaces, tool.name).toEqual(expect.arrayContaining(["mcp", "cli", "editor"]));
    }
  });

  it("exposes exactly the backend's tools on the Assistant surface", () => {
    const spec = backendTools as { tools: Record<string, unknown>; missing: string[] };
    const backendNames = new Set([...Object.keys(spec.tools), ...spec.missing]);
    for (const tool of allTools) {
      const onAssistant = tool.surfaces.includes("assistant");
      expect(onAssistant, tool.name).toBe(tool.contract && contractMeta[tool.name as keyof typeof contractMeta].assistant);
      if (onAssistant) expect(backendNames.has(tool.name), tool.name).toBe(true);
    }
  });

  it("accepts every numeric and boolean argument as a string (the backend sends strings)", () => {
    for (const tool of allTools) {
      const args: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(tool.inputSchema.properties)) {
        const value = stringForm(schema);
        if (value !== undefined) args[key] = value;
      }
      for (const key of tool.inputSchema.required ?? []) {
        if (key in args) continue;
        const type = tool.inputSchema.properties[key]?.type;
        if (key === "points") args[key] = [{ frame: 1, value: 1 }];
        else if (key === "subclips") args[key] = [{ source_start_seconds: 1, source_end_seconds: 2 }];
        else if (type === "array") args[key] = ["x"];
        // update_effect_tool's properties are an effect's (sigma is Blur's); set_clip_properties_tool takes any object.
        else if (type === "object") args[key] = key === "properties" ? { sigma: 1 } : { x: 1 };
        else args[key] = "x";
      }
      const parsed = tool.input.safeParse(normalizeArgs(tool.inputSchema, args));
      expect(parsed.success ? "ok" : `${tool.name}: ${JSON.stringify(parsed.error.issues[0])}`).toBe("ok");
    }
  });

  it("refuses unknown arguments before anything changes", async () => {
    for (const tool of allTools) {
      const doc = fixtureDoc();
      const before = snapshotOf(doc.project);
      const result = await runTool({ doc, host: fakeHost() }, tool.name, { definitely_not_an_arg: "1" });
      expect(result.ok, tool.name).toBe(false);
      expect(result.data?.status, tool.name).toBe("refused");
      expect(result.data?.summary, tool.name).toMatch(/^Error: Invalid arguments for /);
      expect(doc.undoLabels, tool.name).toEqual([]);
      expect(snapshotOf(doc.project), tool.name).toEqual(before);
    }
  }, 60_000);
});

describe("listTools", () => {
  it("hides tools whose capabilities the host lacks, unless asked", () => {
    const bare = fakeHost({ without: ["media", "player", "ui", "exporter", "frames", "backend", "storage", "audio", "assets"] });
    const names = listTools({ surface: "mcp", host: bare }).map((t) => t.name);
    expect(names).toContain("get_timeline_state_tool");
    expect(names).not.toContain("play_tool");
    expect(names).not.toContain("search_clips_tool");
    expect(names).not.toContain("inspect_timeline_tool");
    expect(listTools({ surface: "mcp", host: bare, includeUnavailable: true }).map((t) => t.name)).toContain("play_tool");
  });

  it("filters by surface and hides deprecated tools by default", () => {
    const assistant = listTools({ surface: "assistant" }).map((t) => t.name);
    expect(assistant).toContain("add_clip_to_timeline_tool");
    expect(assistant).not.toContain("move_clip_tool");
    const all = listTools({ includeDeprecated: true }).map((t) => t.name);
    const visible = listTools().map((t) => t.name);
    expect(all.length).toBeGreaterThan(visible.length);
    expect(visible).not.toContain("remove_clip_tool");
    expect(all).toContain("remove_clip_tool");
  });
});

describe("runTool", () => {
  it("answers an unknown tool with a not-available refusal and no history", async () => {
    const doc = fixtureDoc();
    const result = await runTool({ doc, host: fakeHost() }, "teleport_tool", {});
    expect(result.ok).toBe(false);
    expect(result.data?.status).toBe("refused");
    expect(result.data?.summary).toBe("Error: teleport_tool is not available in this Zenvi surface");
    expect(JSON.parse(result.text).summary).toBe(result.data?.summary);
    expect(doc.undoLabels).toEqual([]);
  });

  it("refuses a tool that is not on the requested surface", async () => {
    const result = await runTool({ doc: fixtureDoc(), host: fakeHost() }, "move_clip_tool", { clip_id: "X" }, { surface: "assistant" });
    expect(result.data?.summary).toBe("Error: move_clip_tool is not available in this Zenvi surface");
  });

  it("never throws, even for a host that throws", async () => {
    const host = fakeHost();
    host.player!.toggle = () => {
      throw new Error("player crashed");
    };
    const result = await runTool({ doc: fixtureDoc(), host }, "play_tool", {});
    expect(result.ok).toBe(false);
    expect(result.data?.summary).toContain("player crashed");
  });
});

describe("availability matrix", () => {
  it("marks every contract tool available on the desktop and the direct tools web-only", () => {
    for (const tool of allTools) expect(toolAvailability(tool).desktop, tool.name).toBe(tool.contract ? "yes" : "no");
  });

  it("agrees with the capability check on every web surface", () => {
    const profiles: Record<"editor" | "cli" | "cloud", HostCapability[]> = {
      editor: ["media", "player", "ui", "exporter", "frames", "backend", "storage", "assets", "audio"],
      cli: ["media", "exporter", "frames", "audio", "storage", "backend", "assets", "scenes3d"],
      cloud: ["media", "frames", "storage", "assets", "audio", "backend", "exporter"],
    };
    for (const tool of allTools) {
      const a = toolAvailability(tool);
      for (const surface of ["editor", "cli", "cloud"] as const) {
        const missing = (tool.requires ?? []).filter((cap) => !profiles[surface].includes(cap));
        if (missing.length > 0) expect(a[surface], `${tool.name} on ${surface}`).toBe("no");
      }
    }
  });

  it("has export_video_tool on every web surface, partial (no interlacing) and each with its own output", () => {
    const a = toolAvailability(allTools.find((t) => t.name === "export_video_tool")!);
    expect([a.editor, a.cli, a.cloud]).toEqual(["partial", "partial", "partial"]);
    expect(a.notes.cloud).toMatch(/interlaced is refused.*Zenvi Cloud starts a render job/);
    const presets = toolAvailability(allTools.find((t) => t.name === "list_export_presets_tool")!);
    expect(presets.cloud).not.toBe("no");
  });
});
