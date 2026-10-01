/**
 * A small tool registry for CLI/MCP tests, built on the engine's real ops,
 * so sessions, saving, history and receipts are exercised for real without
 * depending on the full catalog. Test-only.
 */

import { addClip, addFile, addMarker, createProject, type ImportedMedia, type ToolContext, type ToolResult } from "@zenvi/engine";
import { applied, failed, refused, unchanged, type ToolReceipt } from "@zenvi/engine/tools";
import type { JsonSchema } from "@zenvi/engine/tools";
import { createRegistry, type Registry, type RegistryTool } from "../engine/registry.js";

function result(receipt: ToolReceipt): ToolResult {
  return { ok: receipt.status === "applied" || receipt.status === "unchanged", text: JSON.stringify(receipt), data: receipt };
}

function tool(
  name: string,
  properties: Record<string, JsonSchema>,
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolReceipt> | ToolReceipt,
  requires?: RegistryTool["requires"],
): RegistryTool {
  return {
    name,
    title: name,
    description: `Test implementation of ${name}.`,
    inputSchema: { type: "object", properties, additionalProperties: false },
    surfaces: ["mcp", "cli", "editor"],
    requires,
    async run(ctx, input) {
      try {
        return result(await run(ctx, (input ?? {}) as Record<string, unknown>));
      } catch (error) {
        return result(failed(name, (error as Error).message));
      }
    },
  };
}

export function testRegistry(): Registry {
  return createRegistry([
    tool("get_project_info_tool", {}, (ctx) => {
      const p = ctx.doc.project;
      return applied("get_project_info_tool", `Project ${p.id}: ${p.clips.length} clips, ${p.files.length} files`, { data: { clips: p.clips.length, files: p.files.length } }, 0);
    }),
    tool(
      "import_files_tool",
      { paths: { type: "string" }, skip_indexing: { type: "string" } },
      async (ctx, args) => {
        const media = ctx.host.media;
        if (!media?.importPath) return refused("import_files_tool", "no media host");
        const paths = JSON.parse(String(args.paths ?? "[]")) as string[];
        const imported: ImportedMedia[] = [];
        for (const p of paths) imported.push(await media.importPath(p));
        const files = ctx.doc.transaction("Import files", (tx) => imported.map((m) => addFile(tx, m)));
        return applied("import_files_tool", `Imported ${files.length} file(s)`, { data: { files: files.map((f) => ({ id: f.id, path: f.path })) } });
      },
      ["media"],
    ),
    tool("add_clip_to_timeline_tool", {
      file_id: { type: "string" },
      position_seconds: { type: ["string", "number"] },
      track: { type: "string" },
      query: { type: "string" },
      start_seconds: { type: ["string", "number"] },
      end_seconds: { type: ["string", "number"] },
      full_file: { type: "string" },
    }, (ctx, args) => {
      const fileId = String(args.file_id ?? ctx.doc.project.files.find((f) => String(f.path).endsWith(String(args.query)))?.id ?? "");
      const layer = ctx.doc.project.layers[0]?.number ?? 1_000_000;
      const clip = ctx.doc.transaction("Add clip", (tx) => addClip(tx, { fileId, position: Number(args.position_seconds ?? 0), layer }));
      return applied("add_clip_to_timeline_tool", `Added ${clip.id} at ${clip.position}s`, { clips: [{ id: clip.id, position: clip.position }] });
    }),
    tool("add_marker_tool", { position_seconds: { type: ["string", "number"] }, label: { type: "string" } }, (ctx, args) => {
      const marker = ctx.doc.transaction("Add marker", (tx) => addMarker(tx, Number(args.position_seconds ?? 0), args.label === undefined ? undefined : String(args.label)));
      return applied("add_marker_tool", `Added marker ${marker.id} at ${marker.position}s`, { markers: [{ id: marker.id, position: marker.position }] });
    }),
    tool("list_markers_tool", {}, (ctx) =>
      applied("list_markers_tool", ctx.doc.project.markers.map((m) => `${m.id} ${m.position}s ${m.label ?? ""}`.trim()).join("\n") || "No markers", { data: ctx.doc.project.markers }, 0),
    ),
    tool("undo_tool", { steps: { type: ["string", "number"] } }, (ctx, args) => {
      const done = ctx.doc.undo(Number(args.steps ?? 1));
      return done.length ? applied("undo_tool", `Undid ${done.join(", ")}`, {}, done.length) : unchanged("undo_tool", "Nothing to undo");
    }),
    tool("new_project_tool", {}, (ctx) => {
      ctx.doc.load(createProject());
      return applied("new_project_tool", "Started a new project", {}, 0);
    }),
  ]);
}
