/**
 * What the shots under kinetic captions show (captions/space.ts), sampled
 * through the host's frame renderer: one frame per stretch of the timeline
 * between cuts (stretches longer than SPAN are split), the picture without
 * the captions and, where the footage on screen has a subject matte, the
 * matte's frame at the same source time (the head).
 *
 * The matte is read through the footage clip itself (a copy of it showing
 * the matte instead, alone on the timeline), so it lands on the frame where
 * the footage does: scaled, cropped or moved with the clip's keyframes.
 */

import { gridSize, matteCells, matteHead, sceneCost, type CaptionScene } from "../captions/space.js";
import { decodePngBase64 } from "../io/png.js";
import type { Clip, Project, ProjectFile } from "../model/types.js";
import type { RgbaImage } from "../render/types.js";
import { isFootage } from "./catalog/color-unify.js";
import type { ToolCall } from "./define.js";

/** Longest stretch one frame stands for, seconds: a speaker moves within a few seconds of one shot. */
const SPAN = 1;
/** Most frames a run reads (a long piece: equal stretches instead). */
const MAX_SAMPLES = 32;
/** Width frames are read at: the cost grid has 16 cells across the long side. */
const READ_WIDTH = 160;

const clipEnd = (c: Clip): number => Number(c.position) + Number(c.end) - Number(c.start);

/** The project showing only `clip`'s matte, through the clip's own placement and keyframes (no effects). */
function matteView(project: Project, clip: Clip, matte: ProjectFile): Project {
  const view: Clip = { ...structuredClone(clip), file_id: matte.id, reader: structuredClone(matte) as unknown as Clip["reader"], effects: [] };
  return { ...project, clips: [view], effects: [] };
}

/** Stretches of [from, to) between the cuts of `clips`, none longer than SPAN, at most MAX_SAMPLES. */
export function sceneWindows(clips: readonly Clip[], from: number, to: number): [number, number][] {
  if (!(to > from)) return [];
  const cuts = [from, to, ...clips.flatMap((c) => [Number(c.position), clipEnd(c)])].filter((t) => t >= from && t <= to).sort((a, b) => a - b);
  const edges = cuts.filter((t, i) => i === 0 || t - cuts[i - 1]! > 0.05);
  const out: [number, number][] = [];
  for (let i = 1; i < edges.length; i += 1) {
    const a = edges[i - 1]!;
    const b = edges[i]!;
    const n = Math.ceil((b - a) / SPAN - 1e-9);
    for (let k = 0; k < n; k += 1) out.push([a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n]);
  }
  if (out.length <= MAX_SAMPLES) return out;
  return Array.from({ length: MAX_SAMPLES }, (_, k) => [from + ((to - from) * k) / MAX_SAMPLES, from + ((to - from) * (k + 1)) / MAX_SAMPLES]);
}

async function read(call: ToolCall, project: Project, seconds: number): Promise<RgbaImage | null> {
  try {
    const png = await call.host.frames!.renderFrame(project, seconds, { width: READ_WIDTH, format: "png" });
    return png.mimeType === "image/png" ? decodePngBase64(png.data) : null;
  } catch (error) {
    call.host.log?.(`caption placement: frame at ${seconds.toFixed(2)}s unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Scenes over [from, to) of `project` (timeline seconds). `hidden` clips
 * (earlier captions) are left out of the picture; `matteOf` gives a
 * footage clip's subject matte. No frame host: no scenes.
 */
export async function captionScenes(call: ToolCall, project: Project, from: number, to: number, hidden: (clip: Clip) => boolean, matteOf: (clip: Clip) => ProjectFile | undefined): Promise<CaptionScene[]> {
  if (!call.host.frames) return [];
  const picture: Project = { ...project, clips: project.clips.filter((c) => !hidden(c)) };
  const footage = picture.clips.filter((c) => isFootage(c) && Number(c.position) < to && clipEnd(c) > from);
  const { cols, rows } = gridSize(Number(project.width) || 1920, Number(project.height) || 1080);
  const scenes: CaptionScene[] = [];
  for (const [a, b] of sceneWindows(footage, from, to)) {
    const t = (a + b) / 2;
    const on = footage.filter((c) => Number(c.position) <= t && t < clipEnd(c));
    const top = on.length > 0 ? on.reduce((x, y) => (y.layer > x.layer ? y : x)) : undefined;
    const matteFile = top ? matteOf(top) : undefined;
    const image = await read(call, picture, t);
    const matte = matteFile && top ? await read(call, matteView(project, top, matteFile), t) : null;
    const cost = sceneCost(image, matte, cols, rows);
    const head = matte ? matteHead(matte) : null;
    scenes.push({ from: a, to: b, ...(head ? { head } : {}), ...(cost ? { cost } : {}), ...(matte ? { subject: { cols, rows, cells: matteCells(matte, cols, rows) } } : {}) });
  }
  return scenes;
}
