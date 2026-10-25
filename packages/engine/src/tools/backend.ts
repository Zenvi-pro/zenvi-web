/**
 * Zenvi backend calls, with the request shapes the desktop sends.
 *
 * Ports of zenvi-core src/classes/api_client.py (ref b63c39be7):
 * `search`, `watch_window`, `is_indexing_configured`, `get_project_catalog`,
 * `generate_video`, `generate_tts`, `summarize_indexed_video`,
 * `pick_pexels_hd_link`; and of classes/project_tl_index.py
 * (the project's shared video index) and classes/twelvelabs_match.py (hit
 * selection). Like the desktop client, failures come back as `{ error }`
 * instead of throwing.
 */

import type { Project } from "../model/types.js";
import type { FreesoundSound, PexelsVideo } from "../stock/stock.js";
import type { ToolCall } from "./define.js";
import { getIndexBlock, isIndexed } from "./ai-metadata.js";
import type { TimelineClipContext } from "./clip-context.js";
import type { ClipCandidate, ProjectIndexSearch } from "./resolve.js";
import type { BackendHost } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type BackendResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** One JSON request to `/api/v1/...`; never throws. */
export async function backendRequest<T = Record<string, unknown>>(
  backend: BackendHost | undefined,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<BackendResult<T>> {
  if (!backend) return { ok: false, error: "The Zenvi backend is not available on this surface (sign in to Zenvi)." };
  try {
    const data = await backend.request<T>(path, init);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** A search hit (backend SearchResultItem). */
export interface SearchHit {
  video_id?: string | null;
  score?: number;
  rank?: number | null;
  start?: number;
  end?: number;
  peak?: number;
  duration?: number;
  filename?: string;
  transcription?: string;
  media_type?: string;
  kind?: string;
  role?: string;
  confirmed?: boolean;
  degraded?: boolean;
  [key: string]: unknown;
}

export interface SearchOptions {
  topK?: number;
  indexId?: string;
  videoId?: string;
  pageLimit?: number;
  mediaType?: string;
  lookFor?: string;
}

/** POST /api/v1/search (api_client.search). */
export async function searchIndex(call: ToolCall, text: string, options: SearchOptions = {}): Promise<{ results: SearchHit[]; error?: string }> {
  let topK = options.topK ?? 5;
  if (options.pageLimit && options.pageLimit > topK) topK = Math.min(Math.trunc(options.pageLimit), 50);
  topK = Math.min(topK, 50);
  const body: Record<string, unknown> = { query: text, top_k: topK, for_place: true };
  if (options.indexId) body.index_id = options.indexId;
  if (options.videoId) body.video_id = options.videoId;
  if (options.pageLimit) body.page_limit = options.pageLimit;
  if (options.mediaType) body.media_type = options.mediaType;
  if (options.lookFor) body.look_for = options.lookFor;
  const res = await backendRequest<Record<string, unknown>>(call.host.backend, "/api/v1/search", { method: "POST", body, signal: call.signal });
  if (!res.ok) return { results: [], error: res.error };
  const results = Array.isArray(res.data.results) ? (res.data.results.filter(isRecord) as SearchHit[]) : [];
  const error = typeof res.data.error === "string" && res.data.error ? res.data.error : undefined;
  return error ? { results, error } : { results };
}

/** GET /api/v1/indexing/status → `configured` (api_client.is_indexing_configured). */
export async function isIndexingConfigured(call: ToolCall): Promise<boolean> {
  if (!call.host.backend) return false;
  const res = await backendRequest<Record<string, unknown>>(call.host.backend, "/api/v1/indexing/status", { signal: call.signal });
  return res.ok && Boolean(res.data.configured);
}

/** GET /api/v1/indexing/catalog?project_id= (api_client.get_project_catalog). */
export async function projectCatalog(call: ToolCall, projectId: string): Promise<{ items: Record<string, unknown>[]; error?: string }> {
  const res = await backendRequest<Record<string, unknown>>(call.host.backend, `/api/v1/indexing/catalog${query({ project_id: projectId })}`, {
    signal: call.signal,
  });
  if (!res.ok) return { items: [], error: res.error };
  const items = Array.isArray(res.data.items) ? res.data.items.filter(isRecord) : [];
  const error = typeof res.data.error === "string" && res.data.error ? res.data.error : undefined;
  return error ? { items, error } : { items };
}

/** POST /api/v1/indexing/watch-window (api_client.watch_window). */
export async function watchWindowRequest(call: ToolCall, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await backendRequest<unknown>(call.host.backend, "/api/v1/indexing/watch-window", { method: "POST", body: payload, signal: call.signal });
  if (!res.ok) return { error: res.error };
  return isRecord(res.data) ? res.data : { error: "bad watch-window response" };
}

/** POST /api/v1/indexing/summarize (api_client.summarize_indexed_video): the new ai_metadata or an error. */
export async function summarizeIndexedVideo(
  call: ToolCall,
  input: { videoId: string; fileId: string; indexId: string; indexName: string },
): Promise<{ ok: true; aiMetadata: Record<string, unknown> } | { ok: false; error: string }> {
  const body = {
    video_id: input.videoId.trim(),
    file_id: input.fileId,
    index_id: input.indexId || null,
    index_name: input.indexName,
  };
  const res = await backendRequest<Record<string, unknown>>(call.host.backend, "/api/v1/indexing/summarize", { method: "POST", body, signal: call.signal });
  if (!res.ok) return { ok: false, error: res.error };
  const meta = isRecord(res.data.ai_metadata) ? res.data.ai_metadata : undefined;
  if (meta && (meta.analyzed || res.data.success)) return { ok: true, aiMetadata: meta };
  return { ok: false, error: String(res.data.error || meta?.error || "Summarize did not complete") };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** POST /api/v1/generation/video (api_client.generate_video). */
export async function generateVideo(
  call: ToolCall,
  prompt: string,
  durationSeconds: number,
  extra: Record<string, unknown>,
): Promise<{ videoUrl: string } | { error: string }> {
  const res = await backendRequest<Record<string, unknown>>(call.host.backend, "/api/v1/generation/video", {
    method: "POST",
    body: { prompt, duration_seconds: durationSeconds, ...extra },
    signal: call.signal,
  });
  if (!res.ok) return { error: res.error };
  if (typeof res.data.error === "string" && res.data.error) return { error: bareError(res.data.error, "Video generation failed") };
  return { videoUrl: String(res.data.video_url ?? "") };
}

/** POST /api/v1/generation/tts (api_client.generate_tts): MP3 bytes as base64. */
export async function generateTts(
  call: ToolCall,
  input: { text: string; voice: string; model: string; speed: number },
): Promise<{ audioBase64: string } | { error: string }> {
  const res = await backendRequest<Record<string, unknown>>(call.host.backend, "/api/v1/generation/tts", {
    method: "POST",
    body: { text: input.text, voice: input.voice, model: input.model, speed: input.speed },
    signal: call.signal,
  });
  if (!res.ok) return { error: res.error };
  if (!res.data.success) return { error: bareError(res.data.error, "TTS generation failed") };
  return { audioBase64: String(res.data.audio_base64 ?? "") };
}

/** A backend error without the "Error:" some backend paths put in front: the tools add their own. */
function bareError(value: unknown, fallback: string): string {
  return String(value || fallback).trim().replace(/^error:\s*/i, "") || fallback;
}

/** GET /api/v1/pexels/search: Pexels videos for a query (the backend holds the API key). */
export async function searchPexelsVideos(call: ToolCall, search: string, perPage: number): Promise<{ videos: PexelsVideo[]; total: number } | { error: string }> {
  const res = await backendRequest<Record<string, unknown>>(call.host.backend, `/api/v1/pexels/search${query({ query: search, per_page: perPage, page: 1 })}`, { signal: call.signal });
  if (!res.ok) return { error: res.error };
  if (typeof res.data.error === "string" && res.data.error) return { error: res.data.error };
  const videos = Array.isArray(res.data.videos) ? (res.data.videos.filter(isRecord) as unknown as PexelsVideo[]) : [];
  return { videos, total: Number(res.data.total_results ?? videos.length) || videos.length };
}

/** GET /api/v1/freesound/search: Freesound sounds for a query, at least `minSeconds` long. */
export async function searchFreesound(call: ToolCall, search: string, pageSize: number, minSeconds: number): Promise<{ sounds: FreesoundSound[]; total: number } | { error: string }> {
  const res = await backendRequest<Record<string, unknown>>(
    call.host.backend,
    `/api/v1/freesound/search${query({ query: search, page_size: pageSize, min_duration: minSeconds > 0 ? Math.round(minSeconds) : undefined })}`,
    { signal: call.signal },
  );
  if (!res.ok) return { error: res.error };
  if (typeof res.data.error === "string" && res.data.error) return { error: res.data.error };
  const sounds = Array.isArray(res.data.sounds) ? (res.data.sounds.filter(isRecord) as unknown as FreesoundSound[]) : [];
  return { sounds, total: Number(res.data.count ?? sounds.length) || sounds.length };
}

/** The HD file of a Pexels video, else its first file (api_client.pick_pexels_hd_link). */
export function pickPexelsHdLink(video: Record<string, unknown>): string {
  const files = Array.isArray(video.video_files) ? video.video_files.filter(isRecord) : [];
  const pick = files.find((f) => f.quality === "hd") ?? files[0];
  return String(pick?.link || "");
}

// ---------------------------------------------------------------------------
// The project's shared index (project_tl_index.py)
// ---------------------------------------------------------------------------

/** zenvi-<project id>, the index name the desktop indexes a project into. */
export function projectIndexName(projectId: string): string {
  const pid = String(projectId ?? "").trim();
  return pid ? `zenvi-${pid}` : "zenvi-videos";
}

export interface ProjectIndexInfo {
  indexId: string;
  indexName: string;
  videoMap: Map<string, { fileId: string; name: string; indexId: string; indexName: string }>;
  indexedCount: number;
  error?: string;
}

function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Ready index blocks across project files (collect_project_twelvelabs_index). */
export function collectProjectIndex(project: Project): ProjectIndexInfo {
  const videoMap: ProjectIndexInfo["videoMap"] = new Map();
  const indexIds: string[] = [];
  const indexNames: string[] = [];
  for (const file of project.files ?? []) {
    if (file.zenvi_subclip) continue;
    const ai = isRecord(file.ai_metadata) ? file.ai_metadata : {};
    const block = getIndexBlock(ai);
    if (!isIndexed(block)) continue;
    const videoId = String(block.video_id ?? "").trim();
    const indexId = String(block.index_id ?? "").trim();
    const indexName = String(block.index_name ?? "").trim();
    if (!videoId || !indexId) continue;
    const fileId = String(file.id ?? "").trim();
    const name = String(file.name || String(file.path ?? "").split("/").pop() || fileId);
    videoMap.set(videoId, { fileId, name, indexId, indexName });
    indexIds.push(indexId);
    if (indexName) indexNames.push(indexName);
  }
  if (videoMap.size === 0) {
    return {
      indexId: "",
      indexName: projectIndexName(String(project.id ?? "")),
      videoMap,
      indexedCount: 0,
      error: "No TwelveLabs-indexed videos in this project yet.",
    };
  }
  return {
    indexId: mostCommon(indexIds),
    indexName: indexNames.length > 0 ? mostCommon(indexNames) : projectIndexName(String(project.id ?? "")),
    videoMap,
    indexedCount: videoMap.size,
  };
}

/** [media_bin_file_id, display name] for a hit (map_search_hit_to_file). */
export function mapSearchHitToFile(hit: SearchHit, videoMap: ProjectIndexInfo["videoMap"]): [string, string] {
  const videoId = String(hit.video_id || hit.twelvelabs_video_id || "").trim();
  const meta = videoMap.get(videoId);
  return [meta?.fileId ?? "", String(meta?.name || hit.filename || videoId || "unknown")];
}

// ---------------------------------------------------------------------------
// Hit selection (twelvelabs_match.py)
// ---------------------------------------------------------------------------

export interface EnrichedHit extends SearchHit {
  start: number;
  end: number;
  overlap_start: number;
  overlap_end: number;
  overlap_ratio: number;
  rank: number;
  cut_source?: number;
}

function hitRank(hit: SearchHit): number {
  const n = Math.trunc(Number(hit.rank));
  return hit.rank !== null && hit.rank !== undefined && Number.isFinite(n) ? n : 999_999;
}

/** (overlap_start, overlap_end, overlap_ratio) of a segment against the clip window. */
export function clipOverlap(segStart: number, segEnd: number, clipStart: number, clipEnd: number): [number, number, number] {
  if (segEnd < clipStart || segStart > clipEnd) return [0, 0, 0];
  const s = Math.max(segStart, clipStart);
  const e = Math.min(segEnd, clipEnd);
  return [s, e, Math.max(0, e - s) / Math.max(segEnd - segStart, 1e-6)];
}

export function enrichHitForClip(hit: SearchHit, clipStart: number, clipEnd: number): EnrichedHit | null {
  const start = Number(hit.start) || 0;
  const end = Number(hit.end) || 0;
  const [os, oe, ratio] = clipOverlap(start, end, clipStart, clipEnd);
  if (ratio <= 0) return null;
  return { ...hit, start, end, overlap_start: os, overlap_end: oe, overlap_ratio: ratio, rank: hitRank(hit) };
}

/** compute_cut_timestamp. */
export function computeCutTimestamp(segStart: number, segEnd: number, clipStart: number, clipEnd: number | null, mode: "start" | "mid" | "end"): number {
  if (mode === "end") return clipEnd !== null ? Math.min(segEnd, clipEnd) : segEnd;
  if (mode === "mid") {
    const cut = (segStart + segEnd) / 2;
    return clipEnd !== null ? Math.min(Math.max(cut, clipStart), clipEnd) : cut;
  }
  return Math.max(segStart, clipStart);
}

/** The best overlapping hit in API order (select_twelvelabs_match). */
export function selectMatch(hits: readonly SearchHit[], clipStart: number, clipEnd: number, occurrence: number, cutMode: "start" | "mid" | "end"): EnrichedHit | null {
  const overlapping = hits.map((h) => enrichHitForClip(h, clipStart, clipEnd)).filter((h): h is EnrichedHit => h !== null);
  if (overlapping.length === 0) return null;
  const idx = occurrence > 0 ? occurrence - 1 : 0;
  if (idx >= overlapping.length) return null;
  const chosen = { ...overlapping[idx]! };
  chosen.cut_source = computeCutTimestamp(chosen.start, chosen.end, clipStart, clipEnd, cutMode);
  return chosen;
}

/** Overlapping hits in API order with mid cut points (select_hits_for_display). */
export function selectHitsForDisplay(hits: readonly SearchHit[], clipStart: number, clipEnd: number, occurrence: number, topK: number): EnrichedHit[] {
  const overlapping = hits
    .map((h) => enrichHitForClip(h, clipStart, clipEnd))
    .filter((h): h is EnrichedHit => h !== null)
    .map((h) => ({ ...h, cut_source: computeCutTimestamp(h.start, h.end, clipStart, clipEnd, "mid") }));
  if (overlapping.length === 0) return [];
  if (occurrence > 0) {
    const pick = overlapping[occurrence - 1];
    return pick ? [pick] : [];
  }
  return overlapping.slice(0, Math.max(1, topK));
}

/** Snap a time to the frame grid the way Slice_Triggered does: round(t*num/den)*den/num (Python round). */
export function snapToSliceGrid(seconds: number, fpsNum: number, fpsDen: number): number {
  if (fpsNum <= 0 || fpsDen <= 0) return seconds;
  const x = (seconds * fpsNum) / fpsDen;
  const f = Math.floor(x);
  const diff = x - f;
  const r = diff > 0.5 ? f + 1 : diff < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return (r * fpsDen) / fpsNum;
}

// ---------------------------------------------------------------------------
// Resolver fallback (clip_resolver._twelvelabs_project_candidates)
// ---------------------------------------------------------------------------

/** Rank timeline placements with the project index when summaries do not match. */
export function indexSearchForResolver(call: ToolCall): ProjectIndexSearch | undefined {
  if (!call.host.backend) return undefined;
  return async (text: string, contexts: readonly TimelineClipContext[]): Promise<ClipCandidate[]> => {
    if (!(await isIndexingConfigured(call))) return [];
    const info = collectProjectIndex(call.doc.project);
    let indexId = info.indexId;
    if (!indexId) {
      const ids: string[] = [];
      for (const ctx of contexts) {
        const tl = isRecord(ctx.effectiveMetadata.twelvelabs) ? ctx.effectiveMetadata.twelvelabs : {};
        if (String(tl.status ?? "").toLowerCase() !== "ready") continue;
        const id = String(tl.index_id ?? "").trim();
        if (id) ids.push(id);
      }
      if (ids.length === 0) return [];
      indexId = mostCommon(ids);
    }
    const res = await searchIndex(call, text, { topK: 10, pageLimit: 30, indexId });
    if (res.error || res.results.length === 0) return [];
    const byVideo = new Map<string, TimelineClipContext[]>();
    for (const ctx of contexts) {
      const tl = isRecord(ctx.effectiveMetadata.twelvelabs) ? ctx.effectiveMetadata.twelvelabs : {};
      if (String(tl.status ?? "").toLowerCase() !== "ready") continue;
      const vid = String(tl.video_id ?? "").trim();
      if (vid) byVideo.set(vid, [...(byVideo.get(vid) ?? []), ctx]);
    }
    const out: ClipCandidate[] = [];
    const seen = new Set<string>();
    res.results.forEach((item, rank) => {
      const vid = String(item.video_id || item.twelvelabs_video_id || "").trim();
      for (const ctx of byVideo.get(vid) ?? []) {
        if (seen.has(ctx.timelineClipId)) continue;
        seen.add(ctx.timelineClipId);
        out.push({
          timelineClipId: ctx.timelineClipId,
          title: ctx.title,
          layer: ctx.layer,
          position: ctx.timelinePosition,
          fileId: ctx.fileId,
          fileName: ctx.fileName,
          score: 0.35 + Math.max(0, (10 - rank) * 0.04),
          parentFileId: ctx.parentFileId || ctx.fileId,
          sourceStart: ctx.sourceStart,
          sourceEnd: ctx.sourceEnd,
          uiTrack: ctx.uiTrack,
          summaryPreview: ctx.summaryPreview,
        });
      }
    });
    return out.sort((a, b) => b.score - a.score || (a.layer ?? 0) - (b.layer ?? 0) || a.position - b.position);
  };
}
