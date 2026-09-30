/**
 * Fakes for the parts other workstreams build: a renderer that writes a
 * placeholder file, a prober that returns fixed reader info, and a tiny engine
 * tool registry with one read and one mutating tool.
 */

import { writeFile } from "node:fs/promises";
import type { AnyTool, ReaderInfo, ToolContext, ToolResult } from "@zenvi/engine";
import { z } from "zod";
import type { EngineRegistry } from "../mcp/engine.js";
import type { MediaProber, Renderer } from "../render/renderer.js";

/** A 1×1 transparent PNG. */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export function fakeRenderer(options: { fail?: string; onRender?: (input: Parameters<Renderer["render"]>[0]) => void } = {}): Renderer & {
  renders: number;
  frames: number;
} {
  const renderer = {
    available: true,
    renders: 0,
    frames: 0,
    async render(input: Parameters<Renderer["render"]>[0]): Promise<void> {
      renderer.renders += 1;
      options.onRender?.(input);
      for (const clip of input.project.clips) {
        const file = input.project.files.find((f) => f.id === clip.file_id);
        if (file) await input.resolveMedia(file);
      }
      input.onProgress(0.5);
      if (options.fail) throw new Error(options.fail);
      await writeFile(input.output, `FAKE ${input.options.format} ${input.options.width}x${input.options.height}`);
    },
    async frame(): Promise<Uint8Array> {
      renderer.frames += 1;
      return PNG_1X1;
    },
  };
  return renderer;
}

export const fakeProber: MediaProber = {
  available: true,
  async probe(path: string): Promise<ReaderInfo> {
    return {
      type: "FFmpegReader",
      path,
      has_video: true,
      has_audio: true,
      has_single_image: false,
      duration: 2,
      width: 320,
      height: 240,
      fps: { num: 30, den: 1 },
      video_length: 60,
      pixel_ratio: { num: 1, den: 1 },
      display_ratio: { num: 4, den: 3 },
      sample_rate: 48000,
      channels: 2,
      channel_layout: 3,
      media_type: "video",
    };
  },
};

/** Engine-shaped tools: `count_markers_tool` (read) and `add_marker_tool` (one transaction). */
export function fakeEngine(hooks: { beforeAddMarker?: () => Promise<void> } = {}): EngineRegistry & { runs: string[] } {
  const countMarkers: AnyTool = {
    name: "count_markers_tool",
    title: "Count markers",
    description: "Count timeline markers.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    surfaces: ["mcp", "assistant"],
    run: (ctx: ToolContext): ToolResult => ({ ok: true, text: `${ctx.doc.project.markers.length} markers`, data: { count: ctx.doc.project.markers.length } }),
  };
  const addMarker: AnyTool = {
    name: "add_marker_tool",
    title: "Add marker",
    description: "Add a timeline marker.",
    input: z.object({ position: z.coerce.number().min(0) }),
    surfaces: ["mcp", "assistant"],
    run: async (ctx: ToolContext, input: unknown): Promise<ToolResult> => {
      await hooks.beforeAddMarker?.();
      const { position } = input as { position: number };
      const id = `M${ctx.doc.project.markers.length + 1}`;
      ctx.doc.transaction("Add marker", (tx) => tx.insert(["markers"], { id, position, icon: "blue.png" }));
      return { ok: true, text: `Added marker ${id}`, data: { created: [{ kind: "marker", id }] } };
    },
  };
  const localOnly: AnyTool = {
    name: "play_tool",
    title: "Play",
    description: "Start playback.",
    input: z.object({}),
    surfaces: ["mcp", "assistant"],
    requires: ["player"],
    run: () => ({ ok: true, text: "playing" }),
  };
  const registry = {
    runs: [] as string[],
    tools: [countMarkers, addMarker, localOnly],
    async run(ctx: ToolContext, name: string, args: unknown): Promise<ToolResult> {
      registry.runs.push(name);
      const tool = registry.tools.find((t) => t.name === name);
      if (!tool) return { ok: false, text: `Error: ${name} is not available` };
      const parsed = tool.input.safeParse(args);
      if (!parsed.success) return { ok: false, text: `Error: invalid arguments` };
      return tool.run(ctx, parsed.data);
    },
  };
  return registry;
}
