/**
 * Zenvi FX on the timeline: a clip swaps to the render of its source range
 * (a new bin file carrying the `zenvi-fx` link), a re-render repoints that
 * file under every clip that plays it, and unlinking puts each clip back on
 * the original file at the source times it shows. Clip times on a render
 * are render seconds: the render starts at the link's `source.start` and
 * runs `stretch` times slower when the stack slows down. A clip's
 * informational `duration` is left alone so unlinking restores it exactly.
 * Keyframes count reader frames (see `moveKeyframes`), so they move with
 * the reader too.
 */

import type { Transaction } from "../history/document.js";
import { FX_LINK_KEY, readFxLink, type FxLink } from "../fx/link.js";
import { clipsUsingFile } from "../model/query.js";
import { pyRound } from "../model/rounding.js";
import type { Clip, Keyframe, ProjectFile } from "../model/types.js";
import type { ImportedMedia } from "../tools/types.js";
import { invalid, requireFile, requireUnlocked } from "./errors.js";
import { addFile } from "./files.js";
import { mapKeyframesDeep, patchClip, rateOf, requireEditableClip } from "./internal.js";

export interface LinkFxRenderInput {
  clipId: string;
  media: ImportedMedia;
  link: FxLink;
  /** Bin name of the render. */
  name: string;
  /** Render seconds per source second (1, or 1 / speed with slow motion). */
  stretch: number;
}

/** Put a clip that plays an original file on a new FX render of its source range. */
export function linkFxRender(tx: Transaction, input: LinkFxRenderInput): { file: ProjectFile; clip: Clip } {
  const clip = requireEditableClip(tx.project, input.clipId);
  if (readFxLink(requireFile(tx.project, String(clip.file_id)))) throw invalid(`Clip ${clip.id} already plays an FX render.`);
  const file = addFile(tx, input.media, { mediaType: "video", dedupe: false, name: input.name });
  tx.update(["files", { id: file.id }], { [FX_LINK_KEY]: structuredClone(input.link) });
  const linked = requireFile(tx.project, file.id);
  const start = input.link.source.start;
  // Not clamped to the render's length: hosts render whole frames past the range, and removing the FX must give back the exact times.
  const fit = (t: number) => Math.max(0, (t - start) * input.stretch);
  patchClip(tx, clip.id, {
    ...moveKeyframes(clip, (x) => pyRound((x - 1 - frameOf(tx, start)) * input.stretch) + 1),
    file_id: linked.id,
    reader: structuredClone(linked),
    start: fit(Number(clip.start)),
    end: fit(Number(clip.end)),
  });
  return { file: linked, clip: requireEditableClip(tx.project, clip.id) };
}

/**
 * Swap a new render into an FX file; every clip that plays it keeps its
 * place in the source (clip times scale by `stretchAfter / stretchBefore`).
 */
export function relinkFxRender(tx: Transaction, fileId: string, media: ImportedMedia, link: FxLink, stretchBefore: number, stretchAfter: number): Clip[] {
  const file = requireFile(tx.project, fileId);
  if (!readFxLink(file)) throw invalid(`File ${fileId} is not an FX render.`);
  const clips = clipsUsingFile(tx.project, fileId);
  for (const clip of clips) requireUnlocked(tx.project, clip.layer);
  const { path: _path, ...info } = media.info;
  tx.update(["files", { id: fileId }], structuredClone({ ...info, path: media.path, [FX_LINK_KEY]: link }));
  const next = requireFile(tx.project, fileId);
  const ratio = stretchAfter / stretchBefore;
  const fit = (t: number) => Math.max(0, t * ratio);
  for (const clip of clips) {
    patchClip(tx, clip.id, { ...moveKeyframes(clip, (x) => pyRound((x - 1) * ratio) + 1), reader: structuredClone(next), start: fit(Number(clip.start)), end: fit(Number(clip.end)) });
  }
  return clips.map((c) => requireEditableClip(tx.project, c.id));
}

/** Put every clip of an FX file back on the original file at the source times it shows, and drop the render from the bin. */
export function unlinkFxRender(tx: Transaction, fileId: string, stretch: number): Clip[] {
  const file = requireFile(tx.project, fileId);
  const link = readFxLink(file);
  if (!link) throw invalid(`File ${fileId} is not an FX render.`);
  const original = requireFile(tx.project, link.source.file_id);
  const clips = clipsUsingFile(tx.project, fileId);
  for (const clip of clips) requireUnlocked(tx.project, clip.layer);
  const back = (t: number) => round(link.source.start + t / stretch);
  const first = frameOf(tx, link.source.start);
  for (const clip of clips) {
    patchClip(tx, clip.id, {
      ...moveKeyframes(clip, (x) => pyRound((x - 1) / stretch) + 1 + first),
      file_id: original.id,
      reader: structuredClone(original),
      start: back(Number(clip.start)),
      end: Math.min(back(Number(clip.end)), Number(original.duration) || Infinity),
    });
  }
  tx.delete(["files", { id: fileId }]);
  return clips.map((c) => requireEditableClip(tx.project, c.id));
}

/**
 * A clip's keyframe X is a frame of its reader counted from the reader's
 * first frame (the first one shown is round(start * fps) + 1; zenvi-core
 * editor_tools/clip_props_model.py ClipTime), and a time curve's Y is a
 * reader frame too. Every curve on the clip and its effects goes through
 * `frame` when the reader changes under it; points that land on one frame
 * collapse, last one wins, as libopenshot loads them.
 */
function moveKeyframes(clip: Clip, frame: (x: number) => number): Partial<Clip> {
  const move = (kf: Keyframe, values: boolean): Keyframe => {
    // One point holds its value at every frame (and libopenshot ignores a one-point time curve).
    if (kf.Points.length < 2) return kf;
    const points = new Map<number, Keyframe["Points"][number]>();
    for (const p of kf.Points) {
      const x = frame(Number(p.co.X));
      points.set(x, { ...p, co: { ...p.co, X: x, ...(values ? { Y: frame(Number(p.co.Y)) } : {}) } });
    }
    return { ...kf, Points: [...points.values()] };
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(clip)) {
    if (key !== "reader") out[key] = mapKeyframesDeep(value, (kf) => move(kf, key === "time"));
  }
  return out as Partial<Clip>;
}

/** Source seconds as the 0-based frame keyframes count them in. */
function frameOf(tx: Transaction, seconds: number): number {
  return pyRound(seconds * rateOf(tx.project));
}

/** Sub-microsecond float noise off source times (render seconds × 1/stretch). */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
