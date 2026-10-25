/**
 * Effects-color editor tools, part 3: analyze_frame_colors_tool, and the
 * green/blue screen sampling and keyed-share measurement chroma_key_clip_tool
 * uses.
 *
 * Port of zenvi-core develop (1f80cb3d0) src/classes/editor_tools/
 * effects_color_analysis.py. The frame comes from the host's renderer
 * (tools/color-frames.ts: the composite timeline frame, or one clip alone
 * with its effects and transparency) and the numbers from the FrameScope
 * port, as on the desktop. Frames are measured at most 960 px wide (the
 * desktop renders at the project size); save_frame_path attaches the frame
 * to the result instead of writing a file (web surfaces write no files).
 */

import type { Clip } from "../../model/types.js";
import { isAbsoluteFilePath } from "../../effects/luts.js";
import { renderClipAlone, renderTimeline, FrameRenderError, type RenderedFrame, type Strip } from "../color-frames.js";
import {
  AnalysisError,
  computeStats,
  EDGE_STRIPS,
  framePixels,
  GRID,
  pixelStats,
  regionArg,
  roundTo,
  scopeData,
  screenColorFromHistograms,
  screenFromScopes,
  type FrameStats,
} from "../color-stats.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed, pyG } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { ScopeRegion } from "../../render/frame-scope.js";
import { playheadSeconds } from "./common.js";
import { clipExtent } from "./effect-values.js";
import { resolveOneClip } from "./effects-color-common.js";
import { editorRun, ToolError } from "./timeline-edit-common.js";

/** Run analysis code; its own errors become the desktop's ToolError text. */
async function analysis<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof AnalysisError || error instanceof FrameRenderError) throw new ToolError(error.message);
    throw error;
  }
}

/** `_analysis_time`: the clip's middle by default, the playhead for the whole timeline; inside the clip. */
export function analysisTime(call: ToolCall, clip: Clip | null, time: number | null | undefined): number {
  if (!clip) return time !== null && time !== undefined ? Number(time) : playheadSeconds(call);
  const [start, end, duration] = clipExtent(clip);
  if (time === null || time === undefined) return start + duration / 2.0;
  const t = Number(time);
  if (!(start - 1e-6 <= t && t <= end + 1e-6)) throw new ToolError(`time ${pyG(t)}s is outside the clip (${pyG(start)}-${pyG(end)}s on the timeline)`);
  return end > start ? Math.min(t, end - 1e-3) : start;
}

/** render_frame(clip_data or None, t, strip). */
function render(call: ToolCall, clip: Clip | null, t: number, strip: Strip = null): Promise<RenderedFrame> {
  return clip ? renderClipAlone(call, clip, t, { strip }) : renderTimeline(call, t, { strip });
}

/** compute_stats(scope_data(frame, region), pixel_stats(frame_pixels(frame, region))) and the frame size. */
function measure(frame: RenderedFrame, region: ScopeRegion | null): { stats: FrameStats; size: [number, number] } {
  const stats = computeStats(scopeData(frame.pixels, region), pixelStats(framePixels(frame.pixels, region)));
  return { stats, size: [frame.pixels.width, frame.pixels.height] };
}

/**
 * `sample_screen_color`: [#rrggbb, detail, suggested fuzz] of the clip's
 * green/blue screen (the frame without its ChromaKey); ToolError when there
 * is none. `kind` asks for that screen even when the edges are something else.
 */
export async function sampleScreenColor(
  call: ToolCall,
  clip: Clip,
  sampleTime: number | null | undefined,
  kind: "green" | "blue" | null = null,
): Promise<[string, string, number]> {
  const t = analysisTime(call, clip, sampleTime);
  const frame = await analysis(() => renderClipAlone(call, clip, t, { strip: new Set(["ChromaKey"]) }));
  const edges = EDGE_STRIPS.map((strip) => scopeData(frame.pixels, strip));
  const grid = GRID.map((cell) => scopeData(frame.pixels, cell));
  const found = screenFromScopes(edges, grid, kind);
  if (!found) {
    const edgeColor = screenColorFromHistograms(edges)[0];
    if (kind) throw new ToolError(`found no ${kind} screen in clip ${clip.id} at ${pyFixed(t, 2)}s (its edges are ${edgeColor})`);
    throw new ToolError(
      `the edges of clip ${clip.id} at ${pyFixed(t, 2)}s are ${edgeColor}, not a green or blue screen; pass key_color ('green', 'blue' or #RRGGBB)`,
    );
  }
  const [color, where, fuzz] = found;
  return [color, `${where} at ${pyFixed(t, 2)}s, fuzz ${pyG(fuzz)} for its unevenness`, fuzz];
}

/** `keyed_share`: percent of the clip's frame its effects make transparent (the chroma key's result). */
export async function keyedShare(call: ToolCall, clip: Clip, sampleTime: number | null | undefined): Promise<number> {
  const t = analysisTime(call, clip, sampleTime);
  const frame = await analysis(() => renderClipAlone(call, clip, t));
  const d = scopeData(frame.pixels);
  const counted = d.luma.reduce((a, b) => a + b, 0);
  const total = Math.max(Math.trunc(d.total_pixels || counted), counted, 1);
  return roundTo(100.0 * (1.0 - counted / total), 1);
}

export const effectsColorAnalysisTools: CatalogTool[] = [
  contractTool("analyze_frame_colors_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    requires: ["frames"],
    run: (call, input) =>
      editorRun(async () => {
        let region: ScopeRegion | null;
        try {
          region = regionArg(input.region);
        } catch (error) {
          if (error instanceof AnalysisError) throw new ToolError(error.message);
          throw error;
        }
        let clip: Clip | null = null;
        if (!input.whole_timeline) {
          try {
            clip = await resolveOneClip(call, input);
          } catch (error) {
            if (!(error instanceof ToolError) || input.timeline_clip_id || input.clip_query) throw error;
          }
        }
        const t = analysisTime(call, clip, input.time);
        const savePath = input.save_frame_path ?? "";
        if (savePath && !isAbsoluteFilePath(savePath)) throw new ToolError("save_frame_path must be an absolute path ending in .png");
        const frame = await analysis(() => render(call, clip, t));
        const { stats, size } = await analysis(async () => measure(frame, region));
        const receipt: Record<string, unknown> = {
          time: roundTo(t, 3),
          target: clip ? `clip ${clip.id}` : "timeline",
          frame_size: size,
          stats,
        };
        if (clip) {
          receipt.timeline_clip_id = clip.id;
          receipt.effects = (clip.effects ?? []).filter((e) => e && typeof e === "object").map((e) => e.class_name ?? null);
        }
        if (region) receipt.region = region;
        if (input.compare_without_effects) {
          const plain = await analysis(() => render(call, clip, t, "all"));
          receipt.without_effects = (await analysis(async () => measure(plain, region))).stats;
        }
        const warnings: string[] = [];
        if (savePath) {
          receipt.frame_attached = true;
          warnings.push(`This Zenvi surface writes no files: the analyzed frame is attached to this result instead of saved to ${savePath}.`);
        }
        const where = clip ? `clip ${clip.id}` : "the timeline";
        const words = stats.verdict ?? [String(stats.note ?? "")];
        const result = applied(call.tool, `Frame at ${pyFixed(t, 2)}s of ${where}: ${words.join("; ")}`, { data: receipt, warnings });
        return savePath ? { receipt: result, images: [frame.image] } : result;
      }),
  }),
];
