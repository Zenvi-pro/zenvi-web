import { describe, expect, it } from "vitest";
import { editorToolState, parseToolResult } from "./editorTools";

describe("editorToolState", () => {
  it("runs browser tools here and hides tools this build lacks", () => {
    expect(editorToolState("auto_sound_design_tool")).toEqual({ kind: "ready" });
    expect(editorToolState("no_such_tool")).toEqual({ kind: "missing" });
  });

  it("sends web-only tools that need Blender or headless Chrome to the CLI, not the desktop", () => {
    for (const name of ["add_3d_scene_tool", "add_motion_block_tool"]) {
      expect(editorToolState(name)).toMatchObject({ kind: "elsewhere", where: "CLI" });
    }
  });
});

describe("parseToolResult", () => {
  it("reads a receipt", () => {
    const run = parseToolResult(JSON.stringify({ status: "applied", summary: "Added 2", data: { ids: ["a"] }, warnings: ["w", 3], undoSteps: 1 }));
    expect(run).toEqual({ ok: true, status: "applied", summary: "Added 2", data: { ids: ["a"] }, warnings: ["w"], undoSteps: 1 });
  });

  it("counts no undo steps for refusals and plain-text errors", () => {
    expect(parseToolResult(JSON.stringify({ status: "refused", summary: "Error: no cut", undoSteps: 1 }))).toMatchObject({ ok: false, summary: "no cut", undoSteps: 0 });
    expect(parseToolResult("Error: unknown clip")).toMatchObject({ ok: false, status: "error", summary: "unknown clip", undoSteps: 0 });
  });
});
