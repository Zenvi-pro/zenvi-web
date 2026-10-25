/**
 * Editor tools coerce arguments like zenvi-core develop's @editor_tool
 * registry (`_registry.coerce_args`), before the strict validation.
 */

import { describe, expect, it } from "vitest";
import { coerceEditorArgs, isEditorToolHandler } from "./editor-args.js";
import type { JsonSchemaObject } from "./json-schema.js";
import { getTool } from "./registry.js";

const SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    ids: { type: "array", items: { type: "string" } },
    speed: { type: "number", minimum: 0, maximum: 16 },
    times: { type: "integer", minimum: 2 },
    ripple: { type: "boolean" },
    keep: { type: "string", enum: ["both", "left", "right"] },
    scope: { type: "string", enum: ["", "selected", "track", "all"] },
    track: { type: "string" },
    voice: { type: "string", default: "alloy" },
    items: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["file_id"], properties: { file_id: { type: "string" }, start: { type: "number" } } },
    },
    time: { type: ["number", "null"] },
  },
};

describe("coerceEditorArgs", () => {
  it("reads what models send the way the desktop's registry does", () => {
    expect(
      coerceEditorArgs(SCHEMA, {
        ids: "A1, B2",
        speed: "1.5s",
        times: "3.0",
        ripple: "y",
        keep: "Left",
        scope: "",
        track: 2,
        items: '[{"file_id": "F1", "start": "4"}]',
        chat_session_id: "s1",
      }),
    ).toEqual({ ids: ["A1", "B2"], speed: 1.5, times: 3, ripple: true, keep: "left", scope: "", track: "2", items: [{ file_id: "F1", start: 4 }] });
    expect(coerceEditorArgs(SCHEMA, { ids: '["A1"]', ripple: "off", speed: 2 })).toEqual({ ids: ["A1"], ripple: false, speed: 2 });
    expect(coerceEditorArgs(SCHEMA, { ids: "A1" })).toEqual({ ids: ["A1"] });
  });

  it("leaves what it cannot coerce for the validator, and treats empty stubs as unset", () => {
    expect(coerceEditorArgs(SCHEMA, { speed: "fast", times: "2.5", keep: "middle", items: [{ file_id: "F1", bogus: 1 }], extra: "1" })).toEqual({
      speed: "fast",
      times: "2.5",
      keep: "middle",
      items: [{ file_id: "F1", bogus: 1 }],
      extra: "1",
    });
    expect(coerceEditorArgs(SCHEMA, { speed: "", keep: "", ripple: null, time: null, track: "", voice: "", extra: "" })).toEqual({ time: null, track: "" });
    expect(coerceEditorArgs(SCHEMA, { speed: "40" })).toEqual({ speed: "40" });
  });

  it("is used for the desktop's editor tools only", () => {
    expect(isEditorToolHandler(getTool("move_clips_tool")!.desktopHandler)).toBe(true);
    expect(isEditorToolHandler(getTool("reverse_clip_tool")!.desktopHandler)).toBe(false);
  });
});
