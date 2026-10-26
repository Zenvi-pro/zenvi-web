/**
 * Subject mattes and the layer stacks built on them (catalog/mattes.ts).
 *
 * A matte is a grayscale video (white = subject) the host made from a file,
 * kept in the bin with `zenvi_matte` naming its source. A cut-out is a copy
 * of the source clip with libopenshot's Mask effect reading the matte
 * (`mask_reader`, `mask_invert` so white keeps; Mask.cpp, kernels/mask.ts):
 * the effect frame is the clip's source frame and `mask_time_mode` 1 maps it
 * to the matte by time, so the matte follows the clip through trims. Every
 * layer is a plain clip with plain effects, so the desktop plays the stack
 * as it is.
 *
 * Pieces carry `zenvi_composite: {tool, source_clip_id, role}`; running a
 * composite again on the same clip rebuilds its pieces in place (same ids)
 * instead of stacking another copy.
 */

import type { Transaction } from "../history/document.js";
import { defaultEffectJson } from "../effects/registry.js";
import type { Clip, Effect, Project, ProjectFile } from "../model/types.js";
import { idFactory } from "../model/ids.js";
import { addClip, deleteClips } from "../ops/clips.js";
import { assignNewEffectIds } from "../ops/effects.js";
import { addFile, removeFile, updateFile } from "../ops/files.js";
import { patchClip } from "../ops/internal.js";
import { ensureTrack } from "../ops/overlays.js";
import type { ToolCall } from "./define.js";
import { clipExtent, constantKeyframe, planOverlayTrack, toolError } from "./titles-text.js";
import type { GeneratedMatte, ImportedMedia, MatteSubject } from "./types.js";

export const MATTE_KEY = "zenvi_matte";
export const COMPOSITE_KEY = "zenvi_composite";
/** Content hash on generated layer files and LUT effects, so a re-run reuses them. */
export const ASSET_KEY = "zenvi_composite_asset";

/** Mattes cover the whole file: longer media is refused (cut a sub-clip or a shorter export first). */
export const MAX_MATTE_SECONDS = 300;

export type CompositeTool = "text_behind_subject" | "replace_background" | "subject_glow" | "pop_out";

/** `zenvi_matte` on a matte file. */
export interface MatteRecord {
  source_file_id: string;
  source_path: string;
  subject: MatteSubject;
  model: string;
  version: string;
  license: string;
  /** Matte size relative to the source (1 or 0.5). */
  scale: number;
  frames: number;
}

/** `zenvi_composite` on a piece of a stack. */
export interface CompositeTag {
  tool: CompositeTool;
  source_clip_id: string;
  role: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A bin file as people name it: its display name, else its file name. */
export function fileLabel(file: ProjectFile): string {
  return String(file.name || file.path.split(/[\\/]/).pop() || file.id);
}

export function matteRecord(file: ProjectFile): MatteRecord | undefined {
  const m = (file as Record<string, unknown>)[MATTE_KEY];
  return isRecord(m) && typeof m.source_file_id === "string" ? (m as unknown as MatteRecord) : undefined;
}

export function compositeTag(clip: Clip): CompositeTag | undefined {
  const t = (clip as Record<string, unknown>)[COMPOSITE_KEY];
  return isRecord(t) && typeof t.tool === "string" && typeof t.source_clip_id === "string" && typeof t.role === "string" ? (t as unknown as CompositeTag) : undefined;
}

/** The newest matte of `subject` made from `fileId` (still pointing at the same media). */
export function findMatte(project: Project, fileId: string, subject: MatteSubject): ProjectFile | undefined {
  const source = project.files.find((f) => f.id === fileId);
  const found = project.files.filter((f) => {
    const m = matteRecord(f);
    return m !== undefined && m.source_file_id === fileId && m.subject === subject && (!source || m.source_path === source.path);
  });
  return found[found.length - 1];
}

/** The pieces `tool` built on `sourceClipId`, bottom to top. */
export function compositePieces(project: Project, tool: CompositeTool, sourceClipId: string): Clip[] {
  return project.clips
    .filter((c) => {
      const t = compositeTag(c);
      return t !== undefined && t.tool === tool && t.source_clip_id === sourceClipId;
    })
    .sort((a, b) => a.layer - b.layer);
}

/** Why a clip cannot be matted, or null. */
export function matteableClipProblem(project: Project, clip: Clip): string | null {
  const file = project.files.find((f) => f.id === clip.file_id);
  if (!file) return `clip ${clip.id} plays no file in the bin`;
  if (file.media_type !== "video" || file.has_video === false || file.has_single_image) {
    return `clip ${clip.id} is not video (${file.media_type}); subject mattes are made from video`;
  }
  if (matteRecord(file)) return `clip ${clip.id} plays a matte; pick the footage clip`;
  if (compositeTag(clip)) return `clip ${clip.id} is part of a ${compositeTag(clip)!.tool} stack; pick the footage clip it was built on (${compositeTag(clip)!.source_clip_id})`;
  const duration = Number(file.duration) || 0;
  if (duration > MAX_MATTE_SECONDS) {
    return `${fileLabel(file)} is ${duration.toFixed(0)} s long; mattes cover the whole file, at most ${MAX_MATTE_SECONDS} s (export the part you need and import it)`;
  }
  return null;
}

/** A time-remapped clip's effects see source frames before the remap, so the matte would drift. */
export function isTimeRemapped(clip: Clip): boolean {
  const time = (clip as Record<string, unknown>).time;
  return isRecord(time) && Array.isArray(time.Points) && time.Points.length > 1;
}

/** Add a just-generated matte to the bin, linked to its source. */
export function addMatteFile(tx: Transaction, source: ProjectFile, matte: GeneratedMatte, subject: MatteSubject, scale: number): ProjectFile {
  const stem = String(source.name ?? source.path.split(/[\\/]/).pop() ?? source.id).replace(/\.[^.]+$/, "");
  const file = addFile(tx, matte.media, { mediaType: "video", name: `${stem} (${subject} matte)`, tags: "matte", dedupe: false });
  const record: MatteRecord = {
    source_file_id: source.id,
    source_path: source.path,
    subject,
    model: matte.model,
    version: matte.version,
    license: matte.license,
    scale,
    frames: matte.frames,
  };
  return updateFile(tx, file.id, { [MATTE_KEY]: record });
}

/** Mask effect that keeps where the matte is white (Mask hides white; `mask_invert` flips it). */
export function cutoutMask(id: string, matte: ProjectFile): Effect {
  return { ...defaultEffectJson("Mask", id), mask_reader: structuredClone(matte), mask_invert: true };
}

/** 32-bit FNV-1a twice (two seeds): a short content id for generated files. */
export function contentHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** A generated layer image (SVG) ready for the bin. */
export interface GeneratedAsset {
  hash: string;
  media: ImportedMedia;
}

/** Where an earlier run stored a generated file with this hash (a bin file, or a LUT effect's `lut_path`). */
function knownAsset(project: Project, hash: string): string | undefined {
  const file = project.files.find((f) => (f as Record<string, unknown>)[ASSET_KEY] === hash);
  if (file) return file.path;
  const lut = project.clips.flatMap((c) => c.effects ?? []).find((e) => (e as Record<string, unknown>)[ASSET_KEY] === hash)?.lut_path;
  return typeof lut === "string" && lut ? lut : undefined;
}

async function writeAsset(call: ToolCall, stem: string, ext: string, text: string, contentType: string): Promise<{ hash: string; path: string }> {
  const hash = contentHash(`${contentType}\n${text}`);
  const known = knownAsset(call.doc.project, hash);
  if (known) return { hash, path: known };
  const media = call.host.media;
  if (!media?.writeGenerated) toolError("this host cannot store generated images");
  return { hash, path: await media.writeGenerated(`${stem}-${hash.slice(0, 8)}.${ext}`, new TextEncoder().encode(text), contentType) };
}

/** Write (or reuse) a frame-size SVG layer and probe it for the bin. */
export async function generatedSvg(call: ToolCall, stem: string, svg: string): Promise<GeneratedAsset> {
  const { hash, path } = await writeAsset(call, stem, "svg", svg, "image/svg+xml");
  return { hash, media: { path, info: await call.host.media!.probe(path), name: `${stem}.svg` } };
}

/** Write (or reuse) a `.cube` LUT and return a ColorMap effect reading it. */
export async function generatedLut(call: ToolCall, stem: string, cube: string): Promise<(id: string) => Effect> {
  const { hash, path } = await writeAsset(call, stem, "cube", cube, "text/plain");
  return (id) => ({ ...defaultEffectJson("ColorMap", id), lut_path: path, [ASSET_KEY]: hash });
}

/** One layer of a stack, bottom to top. */
export type PieceSpec =
  | {
      role: string;
      title: string;
      /** A muted copy of the source clip (same timing and transform). */
      kind: "copy";
      /** Keep the source clip's own effects (grade, crop) under the piece's effects. */
      sourceEffects: boolean;
      effects: (nextId: () => string) => Effect[];
    }
  | {
      role: string;
      title: string;
      /** A frame-size image over the source clip's window. */
      kind: "image";
      asset: GeneratedAsset;
      props?: Record<string, unknown>;
    }
  | {
      role: string;
      title: string;
      /** Another bin file over the source clip's window (scaled to fill). */
      kind: "file";
      fileId: string;
      effects?: (nextId: () => string) => Effect[];
    }
  | {
      role: string;
      /** A clip of the person's own (an existing title): kept, moved above the pieces under it when needed. */
      kind: "existing";
      clipId: string;
    };

export interface StackResult {
  /** Bottom to top: role → clip id and track number. */
  pieces: { role: string; clip_id: string; layer: number; effect_ids: string[]; reused: boolean }[];
  createdIds: string[];
  updatedIds: string[];
  removedIds: string[];
  movedIds: string[];
  removedFileIds: string[];
}

const SCALE_CROP = 0;

/**
 * Rebuild `tool`'s pieces on `source`, bottom to top above it. Pieces of an
 * earlier run are replaced under the same ids; generated files no clip uses
 * any more leave the bin.
 */
export function buildStack(tx: Transaction, tool: CompositeTool, source: Clip, specs: readonly PieceSpec[]): StackResult {
  const old = compositePieces(tx.project, tool, source.id);
  const oldIds = new Map(old.map((c) => [compositeTag(c)!.role, c.id]));
  const oldEffectIds = new Map(old.map((c) => [c.id, (c.effects ?? []).map((e) => e.id)]));
  // A rebuilt piece keeps its effects' ids, in order, so a re-run that changes nothing is a no-op.
  const keepIds = (clipId: string, effects: Effect[]): Effect[] => {
    const ids = oldEffectIds.get(clipId) ?? [];
    return effects.map((e, i) => (i < ids.length ? { ...e, id: ids[i]! } : e));
  };
  const oldFiles = new Set(old.map((c) => c.file_id).filter((id): id is string => typeof id === "string"));
  if (old.length > 0) deleteClips(tx, old.map((c) => c.id));

  const nextId = idFactory(tx.project);
  const [start, end] = clipExtent(source);
  const result: StackResult = { pieces: [], createdIds: [], updatedIds: [], removedIds: [], movedIds: [], removedFileIds: [] };
  const tag = (role: string): CompositeTag => ({ tool, source_clip_id: source.id, role });
  const window = (exclude: ReadonlySet<string>, from = start, to = end): number => {
    const { layer } = planOverlayTrack(tx.project, from, to, undefined, exclude);
    ensureTrack(tx, layer, "Subject");
    return layer;
  };

  for (const spec of specs) {
    if (spec.kind === "existing") {
      const clip = tx.project.clips.find((c) => c.id === spec.clipId);
      if (!clip) toolError(`no timeline clip with id='${spec.clipId}'`);
      const [s, e] = clipExtent(clip);
      const below = result.pieces.length > 0 ? result.pieces[result.pieces.length - 1]!.layer : source.layer;
      if (clip.layer <= below) {
        const layer = window(new Set([clip.id]), Math.min(s, start), Math.max(e, end));
        patchClip(tx, clip.id, { layer });
        result.movedIds.push(clip.id);
      }
      const now = tx.project.clips.find((c) => c.id === spec.clipId)!;
      result.pieces.push({ role: spec.role, clip_id: now.id, layer: now.layer, effect_ids: [], reused: true });
      continue;
    }
    const reuse = oldIds.get(spec.role);
    const id = reuse ?? nextId();
    const layer = window(new Set());
    let clip: Clip;
    if (spec.kind === "copy") {
      const copy = structuredClone(source) as Record<string, unknown>;
      const own = spec.sourceEffects ? structuredClone(source.effects ?? []) : [];
      assignNewEffectIds(own, nextId);
      const effects = keepIds(id, [...own, ...spec.effects(nextId)]);
      Object.assign(copy, { id, layer, title: spec.title, effects, has_audio: constantKeyframe(0), [COMPOSITE_KEY]: tag(spec.role) });
      tx.insert(["clips"], copy);
      clip = copy as unknown as Clip;
    } else {
      let fileId: string;
      let props: Record<string, unknown> = {};
      let effects: Effect[] = [];
      if (spec.kind === "image") {
        const file = addFile(tx, spec.asset.media, { mediaType: "image", name: spec.asset.media.name });
        updateFile(tx, file.id, { [ASSET_KEY]: spec.asset.hash });
        fileId = file.id;
        props = spec.props ?? {};
      } else {
        fileId = spec.fileId;
        props = { scale: SCALE_CROP };
        effects = keepIds(id, spec.effects ? spec.effects(nextId) : []);
      }
      const file = tx.project.files.find((f) => f.id === fileId)!;
      const still = file.media_type === "image";
      const placed = addClip(tx, { fileId, position: start, layer, start: 0, end: still ? end - start : Math.min(end - start, Number(file.duration) || end - start), id, title: spec.title });
      clip = patchClip(tx, placed.id, { ...props, effects, has_audio: constantKeyframe(0), [COMPOSITE_KEY]: tag(spec.role) });
    }
    (reuse ? result.updatedIds : result.createdIds).push(id);
    result.pieces.push({ role: spec.role, clip_id: id, layer: clip.layer, effect_ids: (clip.effects ?? []).map((e) => e.id), reused: reuse !== undefined });
  }

  const kept = new Set(result.pieces.map((p) => p.clip_id));
  result.removedIds = old.map((c) => c.id).filter((id) => !kept.has(id));
  for (const fileId of oldFiles) {
    const file = tx.project.files.find((f) => f.id === fileId);
    if (!file || (file as Record<string, unknown>)[ASSET_KEY] === undefined) continue;
    if (tx.project.clips.some((c) => c.file_id === fileId)) continue;
    removeFile(tx, fileId, { removeClips: false });
    result.removedFileIds.push(fileId);
  }
  return result;
}
