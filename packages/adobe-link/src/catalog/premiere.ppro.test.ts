import { describe, expect, test } from "vitest";
import { TASTE } from "../taste.js";
import { loadPremiere } from "../testing/ppro-fixtures.js";
import { PREMIERE_BLEND_MODES, PREMIERE_MARKER_COLORS, PREMIERE_SEQUENCE_PRESETS, PREMIERE_TOOLS } from "./premiere.js";
import { inputSchemaFor } from "./types.js";

type Schema = { properties: Record<string, { default?: unknown; enum?: unknown[] }> };

function schemaOf(name: string): Schema {
  const def = PREMIERE_TOOLS.find((tool) => tool.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return inputSchemaFor(def) as unknown as Schema;
}

describe("Premiere catalog", () => {
  test("has every tool SPEC 3.4 lists", () => {
    expect(PREMIERE_TOOLS.map((tool) => tool.name).sort()).toEqual(
      [
        "premiere_get_state", "premiere_list_items", "premiere_get_sequence", "premiere_capture_frame", "premiere_import_files",
        "premiere_create_sequence", "premiere_open_sequence", "premiere_place_clip", "premiere_edit_clip", "premiere_razor",
        "premiere_set_clip_properties", "premiere_animate", "premiere_apply_effect", "premiere_add_transition", "premiere_apply_look",
        "premiere_add_text", "premiere_add_marker", "premiere_add_captions", "premiere_auto_reframe", "premiere_scene_detect",
        "premiere_export", "premiere_export_xml", "premiere_import_xml", "premiere_save_project", "premiere_run_script",
      ].sort(),
    );
  });

  test("defaults come from TASTE", () => {
    expect(schemaOf("premiere_add_transition").properties.duration?.default).toBe(TASTE.timing.crossDissolve.default);
    expect(schemaOf("premiere_apply_look").properties.strength?.default).toBe(TASTE.color.lookStrength);
    expect(schemaOf("premiere_animate").properties.easing?.default).toBe(TASTE.easing.default);
    expect(schemaOf("premiere_add_text").properties.color?.default).toBe(TASTE.color.palette.paper);
    expect(schemaOf("premiere_create_sequence").properties.preset?.default).toBe("1080p30");
    expect(schemaOf("premiere_export").properties.preset?.default).toBe("h264-high");
  });

  test("mutating tools say how undo works, or that they leave the project alone", () => {
    for (const tool of PREMIERE_TOOLS.filter((def) => def.annotations.readOnlyHint === false)) {
      expect(tool.description, tool.name).toMatch(/undo step|Changes nothing in the project|not the project/);
    }
  });

  test("long-running tools get long timeouts; capture returns an image", () => {
    const byName = new Map(PREMIERE_TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.get("premiere_capture_frame")?.returnsImage).toBe(true);
    expect(byName.get("premiere_export")?.timeoutMs).toBeGreaterThanOrEqual(3_600_000);
    expect(byName.get("premiere_scene_detect")?.timeoutMs).toBeGreaterThanOrEqual(1_800_000);
    expect(byName.get("premiere_run_script")?.annotations.destructiveHint).toBe(true);
    expect(byName.get("premiere_edit_clip")?.annotations.destructiveHint).toBe(true);
  });

  test("no defaults inside array items: the host script supplies nested fallbacks itself", () => {
    const nested: string[] = [];
    const walk = (node: unknown, where: string, inItems: boolean): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${where}[${i}]`, inItems));
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const [key, child] of Object.entries(node)) {
        if (key === "default" && inItems) nested.push(where);
        walk(child, `${where}.${key}`, inItems || key === "items" || key === "prefixItems");
      }
    };
    for (const tool of PREMIERE_TOOLS) walk(inputSchemaFor(tool), tool.name, false);
    expect(nested).toEqual([]);
  });

  test("enums match the tables the host script uses", () => {
    const fx = loadPremiere();
    const list = (code: string) => String(fx.host.evaluate(code)).split(",");
    expect(list("ZenviLink.ppro.BLEND_MODES.join(',')")).toEqual([...PREMIERE_BLEND_MODES]);
    expect(list("ZenviLink.ppro.MARKER_COLORS.join(',')")).toEqual([...PREMIERE_MARKER_COLORS]);
    expect(list("Object.keys(ZenviLink.ppro.SEQUENCE_PRESETS).join(',')")).toEqual([...PREMIERE_SEQUENCE_PRESETS]);
    expect(fx.host.evaluate("ZenviLink.ppro.BLEND_MODES[18]")).toBe("normal");
  });
});
