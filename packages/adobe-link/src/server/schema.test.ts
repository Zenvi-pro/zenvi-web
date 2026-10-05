import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineHostTool, inputSchemaFor, color, easing, layerRef, seconds, trackRef } from "../catalog/types.js";
import { schemaModule } from "../testing/link-server.js";

const { validateArguments } = schemaModule;

const example = defineHostTool({
  name: "ae_example",
  title: "Example",
  description: "A tool used to test argument validation in the host server.",
  input: z.strictObject({
    text: z.string().min(1).describe("Text"),
    duration: seconds.default(0.6).describe("Seconds"),
    preset: z.enum(["1080p", "4k"]).optional().describe("Preset"),
    layer: layerRef.optional().describe("Layer"),
    fill: color.optional().describe("Fill"),
    ease: easing.optional().describe("Easing"),
    track: trackRef.optional().describe("Track"),
    parent: z.int().min(1).nullable().optional().describe("Parent layer id, null to unparent"),
    box: z.strictObject({ width: z.number().min(1).describe("W"), height: z.number().min(1).default(100).describe("H") }).optional().describe("Box"),
    tags: z.array(z.string()).max(2).optional().describe("Tags"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false },
});
const schema = inputSchemaFor(example);

describe("validateArguments", () => {
  test("fills defaults, keeps given values, drops nulls the schema does not allow", () => {
    expect(validateArguments(schema, { text: "Hi", preset: null })).toEqual({ ok: true, args: { text: "Hi", duration: 0.6 } });
    expect(validateArguments(schema, { text: "Hi", duration: 2, box: { width: 10 } })).toEqual({ ok: true, args: { text: "Hi", duration: 2, box: { width: 10, height: 100 } } });
  });

  test("keeps null where the schema allows it", () => {
    expect(validateArguments(schema, { text: "Hi", parent: null })).toEqual({ ok: true, args: { text: "Hi", duration: 0.6, parent: null } });
  });

  test("accepts every union form", () => {
    for (const layer of [33, { index: 2 }, "Title"]) expect(validateArguments(schema, { text: "x", layer }).ok).toBe(true);
    for (const fill of ["#FF5A36", [1, 0.5, 0]]) expect(validateArguments(schema, { text: "x", fill }).ok).toBe(true);
    for (const ease of ["snap", { x1: 0.2, y1: 0, x2: 0, y2: 1 }]) expect(validateArguments(schema, { text: "x", ease }).ok).toBe(true);
  });

  test.each([
    [{}, "`text` is required"],
    [{ text: "" }, "`text` must not be empty"],
    [{ text: 3 }, "`text` must be a string, got integer"],
    [{ text: "x", duration: -1 }, "`duration` must be a number >= 0, got -1"],
    [{ text: "x", preset: "8k" }, '`preset` must be one of "1080p", "4k", got "8k"'],
    [{ text: "x", colour: "#fff" }, "`colour` is not a known argument (expected: text, duration, preset, layer, fill, ease, track, parent, box, tags)"],
    [{ text: "x", layer: 0 }, "`layer` must be an integer >= 1, got 0"],
    [{ text: "x", layer: { index: 1, name: "x" } }, "`layer.name` is not a known argument (expected: index)"],
    [{ text: "x", layer: true }, "`layer` must be an integer >= 1, or an object with index, or a string, got boolean"],
    [{ text: "x", fill: "#FFF" }, '`fill` must match ^#[0-9A-Fa-f]{6}$, got "#FFF"'],
    [{ text: "x", fill: [1, 2, 3] }, "`fill.1` must be a number >= 0 and <= 1, got 2"],
    [{ text: "x", track: { kind: "video" } }, "`track.index` is required"],
    [{ text: "x", box: { height: 2 } }, "`box.width` is required"],
    [{ text: "x", tags: ["a", "b", "c"] }, "`tags` takes at most 2 items"],
  ])("refuses %j", (args, message) => {
    expect(validateArguments(schema, args)).toEqual({ ok: false, message });
  });

  test("arguments must be an object; none means {}", () => {
    expect(validateArguments(schema, [1])).toEqual({ ok: false, message: "arguments must be a JSON object, got array" });
    expect(validateArguments({ type: "object", properties: {}, additionalProperties: false }, undefined)).toEqual({ ok: true, args: {} });
  });
});
