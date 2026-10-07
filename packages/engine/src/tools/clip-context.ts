/**
 * Per-placement context: trim-aware metadata, parent file, index status.
 *
 * Port of zenvi-core src/classes/timeline_clip_context.py (ref b63c39be7).
 * Pure functions over a project snapshot (the desktop's per-request caches are
 * unnecessary: snapshots are immutable).
 */

import type { Clip, Layer, Project, ProjectFile } from "../model/types.js";
import {
  buildSummaryPreview,
  getEffectiveAiMetadata,
  getIndexBlock,
  getSourceWindow,
  isIndexed,
  pyNum,
  type AiMetadata,
} from "./ai-metadata.js";
import { layerNumberToDisplayIndex } from "./tracks.js";

export interface TimelineClipContext {
  timelineClipId: string;
  fileId: string;
  parentFileId: string;
  sourcePath: string;
  sourceStart: number;
  sourceEnd: number;
  timelinePosition: number;
  timelineDuration: number;
  timelineEnd: number;
  layer: number | null;
  uiTrack: number | null;
  title: string;
  fileName: string;
  effectiveMetadata: AiMetadata;
  summaryPreview: string;
  indexStatus: string;
  score: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Last path segment (os.path.basename; also splits on backslashes). */
export function basename(path: string): string {
  const parts = String(path ?? "").split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function normPath(path: string): string {
  const segments: string[] = [];
  const absolute = path.startsWith("/");
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
    else segments.push(part);
  }
  return (absolute ? "/" : "") + segments.join("/");
}

export function findFileData(project: Project, fileId: string): ProjectFile | undefined {
  if (!fileId) return undefined;
  return (project.files ?? []).find((f) => String(f.id) === fileId);
}

/** Root media-bin file id for indexing, following parent_file_id (resolve_parent_file_id). */
export function resolveParentFileId(project: Project, fileData: unknown, fileId = ""): string {
  const data = isRecord(fileData) ? fileData : undefined;
  const fid = String(fileId || data?.id || "");
  if (!data) return fid;
  const explicit = String(data.parent_file_id ?? "").trim();
  if (explicit) return explicit;
  if (!data.zenvi_subclip) return fid || String(data.id ?? "");
  const path = String(data.path ?? "");
  if (path && fid) {
    for (const candidate of project.files ?? []) {
      if (candidate.zenvi_subclip) continue;
      const candPath = String(candidate.path ?? "");
      if (candPath && normPath(candPath) === normPath(path)) return String(candidate.id ?? "");
    }
  }
  return fid || String(data.id ?? "");
}

/** The root parent file's data (resolve_parent_file_data). */
export function resolveParentFileData(project: Project, fileData: unknown, fileId = ""): Record<string, unknown> | undefined {
  const data = isRecord(fileData) ? fileData : undefined;
  const fid = String(fileId || data?.id || "");
  const parentId = resolveParentFileId(project, fileData, fid);
  if (!parentId || parentId === fid) return data;
  return findFileData(project, parentId) ?? data;
}

/** [root ai_metadata when analyzed, root file data] (resolve_root_ai_metadata). */
export function resolveRootAiMetadata(
  project: Project,
  fileData: unknown,
  fileId = "",
): [AiMetadata | undefined, Record<string, unknown> | undefined] {
  const parent = resolveParentFileData(project, fileData, fileId);
  if (!isRecord(parent)) return [undefined, undefined];
  const rootAi = parent.ai_metadata;
  if (isRecord(rootAi) && rootAi.analyzed) return [rootAi, parent];
  return [undefined, parent];
}

export interface ClipContextOptions {
  layers?: readonly Layer[];
  rootAi?: AiMetadata;
  parentData?: Record<string, unknown>;
}

/** build_timeline_clip_context. */
export function buildTimelineClipContext(
  project: Project,
  clip: Clip,
  fileData: unknown,
  options: ClipContextOptions = {},
): TimelineClipContext {
  const clipData = clip as unknown as Record<string, unknown>;
  const fid = String(clipData.file_id ?? "");
  const parentData = options.parentData ?? resolveParentFileData(project, fileData, fid);
  const parentId = resolveParentFileId(project, fileData, fid);
  const rootAi = options.rootAi ?? resolveRootAiMetadata(project, fileData, fid)[0];

  const [sourceStart, sourceEnd] = getSourceWindow(clipData, fileData);
  const timelinePosition = pyNum(clipData.position);
  const timelineDuration = Math.max(0.01, sourceEnd - sourceStart);
  const clipAi = isRecord(clipData.ai_metadata) ? clipData.ai_metadata : undefined;
  const effective = getEffectiveAiMetadata(parentData && Object.keys(parentData).length > 0 ? parentData : fileData, clipData, {
    clipAiMetadata: clipAi,
    rootAiMetadata: rootAi,
    rebased: true,
  });
  const file = isRecord(fileData) ? fileData : undefined;
  const path = file ? String(file.path ?? "") : "";
  const rawLayer = clipData.layer;
  const layerNum = rawLayer === null || rawLayer === undefined || rawLayer === "" ? null : Math.trunc(Number(rawLayer));
  const layer = layerNum !== null && Number.isFinite(layerNum) ? layerNum : null;
  const uiTrack = layer !== null ? layerNumberToDisplayIndex(layer, options.layers ?? []) : null;
  const fileName = String(file?.name || basename(path) || "").trim();
  const title = String(clipData.title || clipData.label || fileName || "Clip").trim();

  let tlMeta: Record<string, unknown> = getIndexBlock(parentData ?? {});
  if (Object.keys(tlMeta).length === 0) tlMeta = getIndexBlock(file ?? {});
  if (Object.keys(tlMeta).length === 0 && isRecord(parentData)) tlMeta = getIndexBlock(parentData.ai_metadata ?? {});
  if (Object.keys(tlMeta).length === 0 && file) tlMeta = getIndexBlock(file.ai_metadata ?? {});
  if (Object.keys(tlMeta).length === 0) {
    const raw = (parentData ?? {}).twelvelabs ?? file?.twelvelabs;
    if (isRecord(raw)) tlMeta = raw;
  }
  let indexStatus = String(tlMeta.status ?? "");
  if (isIndexed(tlMeta)) indexStatus = "ready";

  return {
    timelineClipId: String(clip.id ?? clipData.id ?? ""),
    fileId: fid,
    parentFileId: parentId,
    sourcePath: path,
    sourceStart,
    sourceEnd,
    timelinePosition,
    timelineDuration,
    timelineEnd: timelinePosition + timelineDuration,
    layer,
    uiTrack,
    title,
    fileName,
    effectiveMetadata: effective,
    summaryPreview: buildSummaryPreview(effective),
    indexStatus,
    score: 0,
  };
}

/** One context per timeline clip (enumerate_timeline_contexts). */
export function enumerateTimelineContexts(project: Project): TimelineClipContext[] {
  const layers = project.layers ?? [];
  return (project.clips ?? []).map((clip) => {
    const fid = String(clip.file_id ?? "");
    const fileData = findFileData(project, fid);
    const [rootAi, parentData] = resolveRootAiMetadata(project, fileData, fid);
    return buildTimelineClipContext(project, clip, fileData, { layers, rootAi, parentData });
  });
}
