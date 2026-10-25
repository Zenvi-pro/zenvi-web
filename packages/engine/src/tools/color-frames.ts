/**
 * Frames for the colour tools, rendered by the host (`FrameHost.renderFrame`,
 * the same renderer the person sees) and decoded to pixels in the engine.
 *
 * The desktop renders on a private libopenshot timeline built from a project
 * snapshot (zenvi-core develop editor_tools/effects_color_analysis.py
 * `render_frame`; tool_handlers.py `_render_clip_isolated`). Here a scratch
 * project holds the same content and the host renders it:
 *
 * - the composite timeline frame at a time (optionally with effects
 *   stripped from every clip);
 * - one clip alone with its effects, at its own resolution, transparent where
 *   it is transparent (`Clip::GetFrame` without a background). Host renders
 *   are composited over the opaque black timeline background, so the clip is
 *   rendered twice, as is and with a Negate appended after its transform:
 *   over black the first gives the premultiplied colour c·a, the second
 *   (1 − c)·a, so their sum is the alpha;
 * - the isolated preview the older colour tools measure (the clip alone at
 *   position 0 on a small project-shaped canvas, composited over black).
 */

import { ProjectDocument } from "../history/document.js";
import { decodePngBase64, PngDecodeError } from "../io/png.js";
import { pyRound } from "../model/rounding.js";
import type { Clip, Effect, Project, ProjectFile } from "../model/types.js";
import { defaultEffectJson } from "../effects/registry.js";
import { addClip } from "../ops/clips.js";
import { sameJson } from "../ops/internal.js";
import { createPremul, premultiply, type PremulImage } from "../render/pixels.js";
import { frameWindow, timelineFrameOf, windowContains } from "../timeline/windows.js";
import type { ToolCall } from "./define.js";
import { projectFps } from "./frame-time.js";
import { fitSize } from "./media-frames.js";
import type { ToolImage } from "./types.js";

/** A frame could not be rendered (the desktop's "rendering the frame failed: …"). */
export class FrameRenderError extends Error {
  override readonly name = "FrameRenderError";
}

/** Layer of the one clip on a scratch project (tool_handlers._render_clip_isolated puts it on 1000000). */
const SOLO_LAYER = 1_000_000;
const ALPHA_PROBE_ID = "ZENVIALPHA";

function fpsFloat(project: Project): number {
  const fps = projectFps(project);
  return fps.num / fps.den;
}

/** _base.seconds_to_frame: timeline seconds → the 1-based frame the desktop renders. */
export function secondsToFrame(project: Project, seconds: number): number {
  return pyRound(Math.max(0, seconds) * fpsFloat(project)) + 1;
}

/** Start time of 1-based timeline frame `frame` (a host renders the frame containing a time). */
export function frameStart(project: Project, frame: number): number {
  return (Math.max(1, frame) - 1) / fpsFloat(project);
}

/** A scratch project with `clips` only: no transitions, markers or history; one track per clip layer. */
function scratchProject(project: Project, clips: Clip[], width: number, height: number): Project {
  const layers = [...new Set(clips.map((c) => Number(c.layer) || SOLO_LAYER))].map((number, i) => ({
    id: `L${i + 1}`,
    number,
    label: "",
    y: 0,
    lock: false,
  }));
  return {
    ...project,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    clips,
    effects: [],
    layers,
    markers: [],
    history: { undo: [], redo: [] },
  };
}

/** A rendered frame: the host's PNG and its premultiplied pixels. */
export interface RenderedFrame {
  image: ToolImage;
  pixels: PremulImage;
}

/** Render `project` at timeline frame `frame`, `width` wide, and decode it to premultiplied pixels. */
export async function renderPixels(call: ToolCall, project: Project, frame: number, width: number): Promise<RenderedFrame> {
  const frames = call.host.frames;
  if (!frames) throw new FrameRenderError("frame rendering needs the host's renderer");
  let image: ToolImage;
  try {
    image = await frames.renderFrame(project, frameStart(project, frame), { width: Math.max(16, Math.round(width)), format: "png" });
  } catch (error) {
    throw new FrameRenderError(`rendering the frame failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (image.mimeType !== "image/png") throw new FrameRenderError(`rendering the frame failed: the host answered ${image.mimeType}, not a PNG`);
  try {
    return { image, pixels: premultiply(decodePngBase64(image.data)) };
  } catch (error) {
    if (error instanceof PngDecodeError) throw new FrameRenderError(`rendering the frame failed: ${error.message}`);
    throw error;
  }
}

/** A JPEG of `project` at timeline frame `frame` for a person or a model to look at (the desktop's preview_jpeg). */
export async function renderPreview(call: ToolCall, project: Project, frame: number, longEdge = 480): Promise<ToolImage | null> {
  const frames = call.host.frames;
  if (!frames) return null;
  const [width] = fitSize(project.width, project.height, longEdge);
  try {
    return await frames.renderFrame(project, frameStart(project, frame), { width, format: "jpeg" });
  } catch (error) {
    call.host.log?.(`colour preview failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Effects left out of a render: none, every effect, or these classes. */
export type Strip = null | "all" | ReadonlySet<string>;

function stripEffects(clip: Clip, strip: Strip): Effect[] {
  const effects = Array.isArray(clip.effects) ? clip.effects : [];
  if (strip === "all") return [];
  if (strip) return effects.filter((e) => !strip.has(String(e.class_name)));
  return effects.map((e) => structuredClone(e));
}

/** The composite timeline frame shown at `seconds` (render_frame(None, t, strip)), longest edge `longEdge`. */
export async function renderTimeline(call: ToolCall, seconds: number, opts: { strip?: Strip; longEdge?: number } = {}): Promise<RenderedFrame> {
  const project = call.doc.project;
  const scratch = opts.strip ? { ...project, clips: project.clips.map((c) => ({ ...c, effects: stripEffects(c, opts.strip ?? null) })) } : project;
  const [width] = fitSize(project.width, project.height, opts.longEdge ?? 960);
  return renderPixels(call, scratch, secondsToFrame(project, seconds), width);
}

/** The Negate that turns a clip's colour c into 1 − c after its transform, last in its effect order. */
function alphaProbe(effects: readonly Effect[]): Effect {
  const nums = (key: string): number[] => effects.map((e) => Number((e as Record<string, unknown>)[key]) || 0);
  return {
    ...defaultEffectJson("Negate", ALPHA_PROBE_ID),
    apply_before_clip: false,
    layer: Math.max(0, ...nums("layer")),
    position: Math.max(0, ...nums("position")),
    order: Math.min(0, ...nums("order")) - 1,
  } as Effect;
}

/**
 * render_frame(clip_data, t, strip): the clip alone with its effects at
 * timeline time `seconds`, at its own resolution (longest edge `longEdge`),
 * premultiplied and transparent where the clip is (see the module comment).
 */
export async function renderClipAlone(
  call: ToolCall,
  clip: Clip,
  seconds: number,
  opts: { strip?: Strip; longEdge?: number } = {},
): Promise<RenderedFrame> {
  const project = call.doc.project;
  const reader = (clip.reader ?? {}) as unknown as Record<string, unknown>;
  const ownWidth = Number(reader.width) > 0 ? Number(reader.width) : project.width;
  const ownHeight = Number(reader.height) > 0 ? Number(reader.height) : project.height;
  // Clip::GetFrame(N) with N = clip_frame_at(t); on a scratch timeline with the clip at 0 that is timeline frame F.
  const solo: Clip = { ...structuredClone(clip), position: 0, layer: SOLO_LAYER, effects: stripEffects(clip, opts.strip ?? null) };
  delete (solo as Partial<Clip>).composite;
  const fps = projectFps(project);
  const rate = fps.num / fps.den;
  const local = pyRound((Math.max(0, seconds - (Number(clip.position) || 0)) + (Number(clip.start) || 0)) * rate) + 1;
  const window = frameWindow(solo, fps);
  let frame = timelineFrameOf(window, local);
  if (!windowContains(window, frame)) frame = Math.max(window.startFrame, Math.min(window.endFrame, frame));
  const [width] = fitSize(ownWidth, ownHeight, opts.longEdge ?? 960);
  const plain = scratchProject(project, [solo], ownWidth, ownHeight);
  const negated = scratchProject(project, [{ ...solo, effects: [...(solo.effects ?? []), alphaProbe(solo.effects ?? [])] }], ownWidth, ownHeight);
  const [shown, inverse] = await Promise.all([renderPixels(call, plain, frame, width), renderPixels(call, negated, frame, width)]);
  const a = shown.pixels;
  const n = inverse.pixels;
  if (a.width !== n.width || a.height !== n.height) throw new FrameRenderError("rendering the frame failed: the two passes differ in size");
  const out = createPremul(a.width, a.height);
  const ad = a.data;
  const nd = n.data;
  const od = out.data;
  for (let i = 0; i < ad.length; i += 4) {
    const alpha = Math.max(0, Math.min(255, Math.round((ad[i]! + nd[i]! + ad[i + 1]! + nd[i + 1]! + ad[i + 2]! + nd[i + 2]!) / 3)));
    od[i] = Math.min(ad[i]!, alpha);
    od[i + 1] = Math.min(ad[i + 1]!, alpha);
    od[i + 2] = Math.min(ad[i + 2]!, alpha);
    od[i + 3] = alpha;
  }
  return { image: shown.image, pixels: out };
}

/**
 * The web editor stays editable while a tool waits for frames (the desktop
 * renders on the GUI thread, so nothing can land meanwhile). Before a tool
 * writes what it worked out from `clip` as it was read, check the clip is
 * still there with the same `keys`, so a newer edit is never overwritten:
 * why the tool must not write, or null.
 */
export function editedWhileRendering(call: ToolCall, clip: Clip, keys: readonly (keyof Clip)[]): string | null {
  const current = call.doc.project.clips.find((c) => c.id === clip.id);
  if (!current) return `clip ${clip.id} was removed while ${call.tool} rendered frames; nothing changed`;
  const changed = keys.filter((key) => !sameJson(current[key] ?? null, clip[key] ?? null));
  if (changed.length === 0) return null;
  return `clip ${clip.id} was edited while ${call.tool} rendered frames (${changed.join(", ")}); nothing changed, call it again`;
}

/** tool_handlers._solo_render_size: a canvas with the project's aspect, longest edge at most `longEdge`. */
export function soloRenderSize(width: number, height: number, longEdge = 640): [number, number] {
  const w = Math.max(1, Math.trunc(width));
  const h = Math.max(1, Math.trunc(height));
  const scale = Math.min(1.0, longEdge / Math.max(w, h));
  return [Math.max(1, pyRound(w * scale)), Math.max(1, pyRound(h * scale))];
}

/**
 * tool_handlers._render_clip_isolated's timeline: the clip alone at position 0
 * on layer 1000000 of a solo-size canvas (no transitions, other tracks or
 * timeline effects), composited over black like a timeline frame.
 */
export function isolatedProject(project: Project, clip: Clip): Project {
  const [w, h] = soloRenderSize(project.width, project.height);
  const solo: Clip = { ...structuredClone(clip), position: 0, layer: SOLO_LAYER };
  return scratchProject(project, [solo], w, h);
}

/** tool_handlers._profile_media_path's timeline: a media file at position 0 on a solo-size canvas. */
export function mediaFileProject(project: Project, file: ProjectFile, duration: number): Project {
  const [w, h] = soloRenderSize(project.width, project.height);
  const base = scratchProject(project, [], w, h);
  base.layers = [{ id: "L1", number: SOLO_LAYER, label: "", y: 0, lock: false }];
  base.files = [file];
  const doc = new ProjectDocument(base, { historyLimit: 0 });
  doc.transaction("profile", (tx) =>
    addClip(tx, { fileId: String(file.id), position: 0, layer: SOLO_LAYER, start: 0, end: Math.max(duration, 1 / fpsFloat(project)) }),
  );
  return doc.project;
}
