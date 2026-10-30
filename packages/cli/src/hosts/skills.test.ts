/**
 * The Claude Code plugin's skills teach agents exact tool calls. Every tool
 * they name must exist, and every JSON example must pass the tool's own
 * argument validation (and a motion block's or 3D scene's parameter check),
 * so a renamed argument breaks this test instead of the agent's first call.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseScene3dParams, type Scene3dId } from "@zenvi/engine";
import { getTool, normalizeArgs } from "@zenvi/engine/tools";
import { checkParams, getBlock } from "@zenvi/motion";
import { describe, expect, it } from "vitest";

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../plugins/zenvi/skills");
const CHECKED = ["zenvi-motion-director", "zenvi-reels", "zenvi-sound-designer", "zenvi-styles"];
/** Tools `zenvi mcp` adds next to the engine catalog (src/mcp/extra-tools.ts). */
const MCP_TOOLS = new Set(["open_project_file", "render_video", "preview_frame", "launch_editor", "push_to_cloud", "list_hosts"]);

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return markdownFiles(file);
    return name.endsWith(".md") ? [file] : [];
  });
}

/**
 * `tool_name {json}` examples inside ```json fences (one call may span lines).
 * A `fragment` names a few arguments of a call in prose (`tool_name {"style": "pop"}`):
 * the arguments it names must be valid, the ones it leaves out are not required.
 */
function examples(markdown: string): { tool: string; args: string; fragment?: true }[] {
  const found: { tool: string; args: string; fragment?: true }[] = [];
  for (const fence of markdown.matchAll(/```json\n([\s\S]*?)```/g)) {
    const body = fence[1]!;
    for (const start of body.matchAll(/^([a-z0-9_]+) \{/gm)) {
      let depth = 0;
      const from = start.index! + start[1]!.length + 1;
      for (let i = from; i < body.length; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}" && --depth === 0) {
          found.push({ tool: start[1]!, args: body.slice(from, i + 1) });
          break;
        }
      }
    }
  }
  // Inline calls: `tool_name` `{json}` (the code span may wrap; placeholders like <climax> or ... are not examples).
  for (const m of markdown.matchAll(/`([a-z0-9_]+_tool)`\s+`(\{[^`]*\})`/g)) {
    if (!/<|\.\.\.|…/.test(m[2]!)) found.push({ tool: m[1]!, args: m[2]!.replace(/\s*\n\s*/g, " ") });
  }
  for (const m of markdown.matchAll(/`([a-z0-9_]+_tool) (\{[^`]*\})`/g)) {
    if (!/<|\.\.\.|…/.test(m[2]!)) found.push({ tool: m[1]!, args: m[2]!.replace(/\s*\n\s*/g, " "), fragment: true });
  }
  return found;
}

/** "ok", or the first argument the tool refuses (a fragment's missing arguments are not refused). */
function argumentCheck(example: { tool: string; args: string; fragment?: true }): string {
  const tool = getTool(example.tool)!;
  const args = JSON.parse(example.args) as Record<string, unknown>;
  const parsed = tool.input.safeParse(normalizeArgs(tool.inputSchema, args));
  const issues = parsed.success
    ? []
    : parsed.error.issues.filter((i) => !example.fragment || i.code === "unrecognized_keys" || String(i.path[0]) in args);
  return issues.length === 0 ? "ok" : `${example.tool}: ${JSON.stringify(issues[0])}`;
}

const files = CHECKED.flatMap((skill) => markdownFiles(path.join(SKILLS, skill)));

describe("plugin skills", () => {
  it.each(files.map((f) => [path.relative(SKILLS, f), f]))("%s names only tools that exist", (_name, file) => {
    const named = new Set([...readFileSync(file, "utf8").matchAll(/`([a-z0-9]+(?:_[a-z0-9]+)*_tool)\b/g)].map((m) => m[1]!));
    const unknown = [...named].filter((tool) => !getTool(tool) && !MCP_TOOLS.has(tool));
    expect(unknown).toEqual([]);
  });

  it.each(files.map((f) => [path.relative(SKILLS, f), f]))("%s examples pass argument validation", (_name, file) => {
    for (const example of examples(readFileSync(file, "utf8"))) {
      const tool = getTool(example.tool);
      expect(tool, example.tool).toBeDefined();
      const args = JSON.parse(example.args) as Record<string, unknown>;
      expect(argumentCheck(example)).toBe("ok");
      if (example.tool === "add_motion_block_tool") {
        const block = getBlock(String(args.block));
        expect(block, String(args.block)).toBeDefined();
        const check = checkParams(block!, (args.params ?? {}) as Record<string, unknown>);
        expect(check.ok ? "ok" : check.error).toBe("ok");
      }
      if (example.tool === "add_3d_scene_tool") {
        const check = parseScene3dParams(args.scene as Scene3dId, args.params);
        expect(check.ok ? "ok" : check.error).toBe("ok");
      }
    }
  });

  it("finds the sound designer's inline calls", () => {
    const sound = files.filter((f) => f.includes("zenvi-sound-designer"));
    expect(sound.reduce((n, f) => n + examples(readFileSync(f, "utf8")).length, 0)).toBeGreaterThanOrEqual(15);
  });

  it("finds the director's examples, and the check can fail", () => {
    const director = files.filter((f) => f.includes("zenvi-motion-director"));
    expect(director.reduce((n, f) => n + examples(readFileSync(f, "utf8")).length, 0)).toBeGreaterThanOrEqual(12);
    const [bad] = examples('```json\nspeed_ramp_tool {"clip_id": "C1", "preset": "velocity", "hit": 2}\n```');
    const tool = getTool(bad!.tool)!;
    expect(tool.input.safeParse(normalizeArgs(tool.inputSchema, JSON.parse(bad!.args))).success).toBe(false);
    const [fragment, badFragment, unknownArg] = examples(
      '`add_kinetic_title_tool {"animation": "scramble"}` `add_kinetic_title_tool {"animation": "wobble"}` `add_kinetic_title_tool {"wobble": 1}`',
    );
    expect([fragment, badFragment, unknownArg].map((e) => argumentCheck(e!) === "ok")).toEqual([true, false, false]);
    expect(checkParams(getBlock("counter")!, { value: "3" }).ok).toBe(false);
    expect(parseScene3dParams("device_mockup", { device: "phone", move: "orbit_wildly" }).ok).toBe(false);
  });
});
