/**
 * Resolve the timeline clip an agent means: an explicit id, a natural
 * language query scored against trim-aware metadata, the playhead, or the
 * single clip on the timeline.
 *
 * Port of zenvi-core src/classes/clip_resolver.py (ref b63c39be7). When no
 * summary scores well enough and the host can reach the Zenvi backend, the
 * project's video index is searched as the desktop does
 * (`_twelvelabs_project_candidates`).
 */

import type { Clip, Project } from "../model/types.js";
import { inferSearchHint } from "./ai-metadata.js";
import { enumerateTimelineContexts, type TimelineClipContext } from "./clip-context.js";
import { pyFixed, pyReprString } from "./pyfmt.js";
import { normalizeTrackOrLayerArg } from "./tracks.js";

export const MIN_CONFIDENCE = 0.15;
export const AMBIGUITY_GAP = 0.08;
export const AUDIO_HEAVY_MIN_CONFIDENCE = 0.08;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** clip_resolver._coerce_optional_float: blank/garbage is unset. */
export function optionalFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeText(text: string): string {
  return String(text ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

function tokenize(text: string): string[] {
  return (normalizeText(text).match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1);
}

function metadataCorpus(ai: unknown, maxScenes = 8): string {
  if (!isRecord(ai)) return "";
  const parts: string[] = [];
  for (const key of ["short_summary", "description", "sounds", "transcript"]) {
    if (ai[key]) parts.push(String(ai[key]));
  }
  for (const ch of (Array.isArray(ai.chapters) ? ai.chapters : []).slice(0, maxScenes)) {
    if (isRecord(ch)) {
      if (ch.title) parts.push(String(ch.title));
      if (ch.summary) parts.push(String(ch.summary));
    }
  }
  for (const sc of (Array.isArray(ai.scene_descriptions) ? ai.scene_descriptions : []).slice(0, maxScenes)) {
    if (isRecord(sc) && sc.description) parts.push(String(sc.description));
  }
  const tags = isRecord(ai.tags) ? ai.tags : {};
  for (const key of ["objects", "scenes", "activities", "mood"]) {
    const vals = tags[key];
    if (Array.isArray(vals)) for (const v of vals) if (v) parts.push(String(v));
  }
  return parts.join(" ");
}

function fmtPositionMmss(pos: number): string {
  const m = Math.floor(pos / 60);
  const s = Math.floor(pos % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function basenameOf(path: string): string {
  const parts = String(path ?? "").split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/** How well a placement matches a query, 0..1 (_score_context_against_query). */
export function scoreContextAgainstQuery(ctx: TimelineClipContext, query: string, preferPositionNear = 0): number {
  const q = normalizeText(query);
  if (!q) return 0;
  const ai = ctx.effectiveMetadata;
  const qTokens = new Set(tokenize(q));
  const parts: string[] = [ctx.title, ctx.fileName, ctx.summaryPreview, String(ctx.fileId || ""), basenameOf(ctx.sourcePath || "")];
  if (ctx.uiTrack !== null) parts.push(`track ${ctx.uiTrack}`);
  parts.push(fmtPositionMmss(ctx.timelinePosition));
  if (ai && Object.keys(ai).length > 0) parts.push(metadataCorpus(ai));
  const corpus = normalizeText(parts.filter(Boolean).join(" "));
  if (!corpus) return 0;

  if (ai && ai.analyzed) {
    const hasText = Boolean(
      String(ai.short_summary ?? "").trim() ||
        String(ai.description ?? "").trim() ||
        String(ai.sounds ?? "").trim() ||
        String(ai.transcript ?? "").trim() ||
        (Array.isArray(ai.chapters) && ai.chapters.length > 0) ||
        (Array.isArray(ai.scene_descriptions) && ai.scene_descriptions.length > 0),
    );
    if (!hasText && ![...qTokens].some((t) => corpus.includes(t))) return 0;
  }

  let score = 0;
  if (corpus.includes(q)) score += 0.45;
  const corpusTokens = new Set(tokenize(corpus));
  const overlap = [...qTokens].filter((t) => corpusTokens.has(t)).length;
  if (qTokens.size > 0) score += 0.55 * (overlap / qTokens.size);
  if (preferPositionNear > 0) {
    if (ctx.timelinePosition <= preferPositionNear && preferPositionNear <= ctx.timelineEnd) score += 0.15;
    else {
      const dist = Math.min(Math.abs(preferPositionNear - ctx.timelinePosition), Math.abs(preferPositionNear - ctx.timelineEnd));
      score += Math.max(0, 0.08 - dist * 0.01);
    }
  }
  return Math.min(score, 1);
}

function effectiveMinConfidence(contexts: readonly TimelineClipContext[]): number {
  for (const ctx of contexts) {
    if (inferSearchHint(ctx.effectiveMetadata ?? {}, ctx.fileName || "") === "prefer_audio_and_visual") return AUDIO_HEAVY_MIN_CONFIDENCE;
  }
  return MIN_CONFIDENCE;
}

function byScore(a: TimelineClipContext, b: TimelineClipContext): number {
  return b.score - a.score || (a.layer ?? 0) - (b.layer ?? 0) || a.timelinePosition - b.timelinePosition;
}

export interface PlacementSearchOptions {
  track?: string;
  positionNear?: number | null;
  occurrence?: number;
  parentFileId?: string;
  minConfidence?: number;
}

/** Placements ranked by trim-aware metadata match (search_timeline_placements). */
export function searchTimelinePlacements(project: Project, query: string, options: PlacementSearchOptions = {}): TimelineClipContext[] {
  const trackArg = (options.track ?? "").trim();
  const track = normalizeTrackOrLayerArg(trackArg, project.layers);
  if (track.error) return [];
  const layerFilter = track.layer;
  const contexts = enumerateTimelineContexts(project);
  const posNear = options.positionNear ?? null;
  const posNearValue = posNear ?? 0;
  const parentFilter = (options.parentFileId ?? "").trim();
  const minConfidence = options.minConfidence ?? MIN_CONFIDENCE;
  const scored: TimelineClipContext[] = [];
  for (const ctx of contexts) {
    if (layerFilter !== undefined && ctx.layer !== layerFilter) continue;
    if (parentFilter && ctx.parentFileId !== parentFilter && ctx.fileId !== parentFilter) continue;
    if (posNear !== null && !(ctx.timelinePosition <= posNearValue && posNearValue <= ctx.timelineEnd)) continue;
    const s = scoreContextAgainstQuery(ctx, query, posNearValue);
    if (s >= minConfidence) {
      ctx.score = s;
      scored.push(ctx);
    }
  }
  scored.sort(byScore);
  const occurrence = options.occurrence ?? 0;
  if (occurrence > 0) {
    const pick = scored[occurrence - 1];
    return pick ? [pick] : [];
  }
  return scored;
}

/** One ranked candidate (ClipCandidate). */
export interface ClipCandidate {
  timelineClipId: string;
  title: string;
  layer: number | null;
  position: number;
  fileId: string;
  fileName: string;
  score: number;
  parentFileId: string;
  sourceStart: number;
  sourceEnd: number;
  uiTrack: number | null;
  summaryPreview: string;
}

function candidateFrom(ctx: TimelineClipContext): ClipCandidate {
  return {
    timelineClipId: ctx.timelineClipId,
    title: ctx.title || ctx.fileName || "Clip",
    layer: ctx.layer,
    position: ctx.timelinePosition,
    fileId: ctx.fileId,
    fileName: ctx.fileName,
    score: ctx.score,
    parentFileId: ctx.parentFileId,
    sourceStart: ctx.sourceStart,
    sourceEnd: ctx.sourceEnd,
    uiTrack: ctx.uiTrack,
    summaryPreview: ctx.summaryPreview,
  };
}

/** The "pass timeline_clip_id …" error with the top three candidates (_format_candidates_error). */
export function formatCandidatesError(candidates: readonly ClipCandidate[], prefix: string): string {
  const lines = [prefix];
  candidates.slice(0, 3).forEach((c, i) => {
    const trackPart = c.uiTrack !== null ? ` ui_track=${c.uiTrack}` : "";
    lines.push(
      `  ${i + 1}. timeline_clip_id=${c.timelineClipId} title=${pyReprString(c.title)} ` +
        `track=${c.layer === null ? "None" : c.layer}${trackPart} file=${pyReprString(c.fileName)} ` +
        `source=${pyFixed(c.sourceStart, 1)}-${pyFixed(c.sourceEnd, 1)}s score=${pyFixed(c.score, 2)}`,
    );
  });
  lines.push(
    "Pass timeline_clip_id from list_clips_tool, or disambiguate with track, " +
      "occurrence (1-based), or position_near (timeline seconds).",
  );
  return lines.join("\n");
}

function checkAmbiguity(scored: readonly ClipCandidate[], trackFilter: number | undefined, occurrence: number, positionNear: number | null): string | null {
  if (scored.length === 0 || occurrence > 0 || positionNear !== null) return null;
  const best = scored[0]!;
  const sameFile = scored.filter((c) => c.fileId && c.fileId === best.fileId);
  const sameTrackDupes = sameFile.filter((c) => c.layer === best.layer);
  if (sameTrackDupes.length > 1) {
    return (
      `Same source file appears ${sameTrackDupes.length} times on the same track for ` +
      "clip_query — pass occurrence (1-based), position_near (timeline seconds), " +
      "or timeline_clip_id:"
    );
  }
  const layers = new Set(sameFile.map((c) => c.layer));
  if (sameFile.length > 1 && layers.size > 1 && trackFilter === undefined) {
    return "Same source file appears on multiple tracks for clip_query — pass track, timeline_clip_id, or position_near:";
  }
  if (scored.length > 1 && best.score - scored[1]!.score < AMBIGUITY_GAP) return "Ambiguous clip_query — multiple close matches:";
  return null;
}

/** Project-index search the resolver falls back to. Returns hits in rank order. */
export type ProjectIndexSearch = (query: string, contexts: readonly TimelineClipContext[]) => Promise<ClipCandidate[]>;

export interface ResolveInput {
  timelineClipId?: string;
  clipQuery?: string;
  track?: string;
  positionNear?: unknown;
  occurrence?: number;
  /** Timeline seconds of the playhead (host player, else project.playhead_position). */
  playhead?: number;
  /** Backend fallback when summaries do not match (desktop `_twelvelabs_project_candidates`). */
  indexSearch?: ProjectIndexSearch;
}

export type ResolveResult =
  | { ok: true; clip: Clip; candidates: ClipCandidate[] }
  | { ok: false; error: string; candidates: ClipCandidate[] };

function clipById(project: Project, id: string): Clip | undefined {
  return (project.clips ?? []).find((c) => String(c.id) === id);
}

/** resolve_timeline_clip. Never throws. */
export async function resolveTimelineClip(project: Project, input: ResolveInput): Promise<ResolveResult> {
  const id = String(input.timelineClipId ?? "").trim();
  if (id) {
    const clip = clipById(project, id);
    if (clip) return { ok: true, clip, candidates: [] };
    return { ok: false, error: `Error: No timeline clip with id=${pyReprString(id)}.`, candidates: [] };
  }

  const contexts = enumerateTimelineContexts(project);
  if (contexts.length === 0) {
    return { ok: false, error: "Error: Timeline is empty — add clips before using this tool.", candidates: [] };
  }

  const trackArg = String(input.track ?? "").trim();
  const track = normalizeTrackOrLayerArg(trackArg, project.layers);
  if (track.error) return { ok: false, error: track.error, candidates: [] };
  const layerFilter = track.layer;

  const provided = optionalFloat(input.positionNear);
  const playhead = input.playhead ?? optionalFloat(project.playhead_position) ?? 0;
  const posNear = provided ?? playhead;
  const occurrence = Number.isFinite(input.occurrence) ? Math.trunc(input.occurrence as number) : 0;

  const q = String(input.clipQuery ?? "").trim();
  if (q) {
    const placements = searchTimelinePlacements(project, q, {
      track: trackArg,
      positionNear: provided,
      occurrence,
      minConfidence: 0,
    });
    let scored = placements.filter((c) => c.score > 0 || occurrence > 0).map(candidateFrom);
    if (scored.length === 0 && placements.length > 0) scored = placements.map(candidateFrom);
    if (scored.length === 0) {
      const fallback: TimelineClipContext[] = [];
      for (const ctx of contexts) {
        if (layerFilter !== undefined && ctx.layer !== layerFilter) continue;
        const s = scoreContextAgainstQuery(ctx, q, posNear);
        if (s > 0) {
          ctx.score = s;
          fallback.push(ctx);
        }
      }
      scored = fallback.sort(byScore).map(candidateFrom);
    }

    if (scored.length > 0) {
      let best: ClipCandidate;
      if (occurrence > 0) {
        if (placements.length === 1) best = scored[0]!;
        else if (scored.length >= occurrence) {
          const ranked = [...scored].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.position - b.position);
          best = ranked[occurrence - 1]!;
        } else {
          return {
            ok: false,
            error: `Error: occurrence=${occurrence} but only ${scored.length} match(es) for ${pyReprString(q)}.`,
            candidates: scored.slice(0, 3),
          };
        }
      } else {
        best = scored[0]!;
        if (best.score < effectiveMinConfidence(contexts)) {
          const indexed = input.indexSearch ? await input.indexSearch(q, contexts) : [];
          if (indexed.length > 0) {
            best = indexed[0]!;
            scored = indexed;
          } else {
            return {
              ok: false,
              error: formatCandidatesError(scored, `No confident match for clip_query ${pyReprString(q)}.`),
              candidates: scored.slice(0, 3),
            };
          }
        }
        const amb = checkAmbiguity(scored, layerFilter, occurrence, provided);
        if (amb) return { ok: false, error: formatCandidatesError(scored, amb), candidates: scored.slice(0, 3) };
      }
      const clip = clipById(project, best.timelineClipId);
      if (clip) return { ok: true, clip, candidates: scored.slice(0, 3) };
    }

    // The desktop always runs this search here but only uses it when nothing scored.
    const indexed = scored.length === 0 && input.indexSearch ? await input.indexSearch(q, contexts) : [];
    let error: string;
    if (scored.length > 0) error = formatCandidatesError(scored, `No confident match for clip_query ${pyReprString(q)}.`);
    else if (indexed.length > 0) error = formatCandidatesError(indexed, `No timeline clip matched clip_query ${pyReprString(q)}.`);
    else {
      error =
        `Error: No timeline clip matched clip_query ${pyReprString(q)}. ` +
        "Use list_clips_tool or get_timeline_placements_metadata_tool.";
    }
    return { ok: false, error, candidates: (scored.length > 0 ? scored : indexed).slice(0, 3) };
  }

  const hits: Clip[] = [];
  for (const ctx of contexts) {
    if (layerFilter !== undefined && ctx.layer !== layerFilter) continue;
    if (ctx.timelinePosition <= posNear && posNear <= ctx.timelineEnd) {
      const clip = clipById(project, ctx.timelineClipId);
      if (clip) hits.push(clip);
    }
  }
  if (hits.length === 1) return { ok: true, clip: hits[0]!, candidates: [] };
  if (contexts.length === 1) {
    const clip = clipById(project, contexts[0]!.timelineClipId);
    if (clip) return { ok: true, clip, candidates: [] };
  }
  return {
    ok: false,
    error:
      "Error: Multiple clips on timeline — pass clip_query (filename, subject, track) " +
      "or timeline_clip_id from list_clips_tool.",
    candidates: [],
  };
}

export type PairResult = { ok: true; clipA: Clip; clipB: Clip } | { ok: false; error: string };

/** Two adjacent clips for a transition (resolve_clip_pair). */
export async function resolveClipPair(
  project: Project,
  input: { clipAId?: string; clipBId?: string; clipAQuery?: string; clipBQuery?: string; allowGapSeconds?: number; indexSearch?: ProjectIndexSearch },
): Promise<PairResult> {
  const aId = String(input.clipAId ?? "").trim();
  const bId = String(input.clipBId ?? "").trim();
  if (aId && bId) {
    const a = clipById(project, aId);
    const b = clipById(project, bId);
    if (a && b) return { ok: true, clipA: a, clipB: b };
    return { ok: false, error: "Error: Could not find both clips by id." };
  }
  const contexts = enumerateTimelineContexts(project);
  if (contexts.length < 2) return { ok: false, error: "Error: Need at least two clips on the timeline." };
  const allowGap = input.allowGapSeconds ?? 2.0;
  const aQuery = String(input.clipAQuery ?? "").trim();
  const bQuery = String(input.clipBQuery ?? "").trim();
  const indexed = [...contexts].sort((x, y) => x.timelinePosition - y.timelinePosition || (x.layer ?? 0) - (y.layer ?? 0));
  let bestPair: [string, string] | null = null;
  let bestScore = -1;
  for (let i = 0; i + 1 < indexed.length; i += 1) {
    const a = indexed[i]!;
    const b = indexed[i + 1]!;
    if (a.layer !== b.layer) continue;
    const gap = b.timelinePosition - a.timelineEnd;
    if (gap < 0 || gap > allowGap) continue;
    if (aId && a.timelineClipId !== aId && b.timelineClipId !== aId) continue;
    if (bId && a.timelineClipId !== bId && b.timelineClipId !== bId) continue;
    const sa = aQuery ? scoreContextAgainstQuery(a, aQuery) : 0.5;
    const sb = bQuery ? scoreContextAgainstQuery(b, bQuery) : 0.5;
    if (aQuery && sa < MIN_CONFIDENCE) continue;
    if (bQuery && sb < MIN_CONFIDENCE) continue;
    let pairScore = sa + sb - Math.abs(gap) * 0.02;
    if (a.parentFileId && a.parentFileId === b.parentFileId && Math.abs(b.sourceStart - a.sourceEnd) < 0.5) pairScore += 0.25;
    if (pairScore > bestScore) {
      bestScore = pairScore;
      bestPair = [a.timelineClipId, b.timelineClipId];
    }
  }
  if (bestPair) {
    const a = clipById(project, bestPair[0]);
    const b = clipById(project, bestPair[1]);
    if (a && b) return { ok: true, clipA: a, clipB: b };
  }
  const ra = await resolveTimelineClip(project, { timelineClipId: aId, clipQuery: aQuery, indexSearch: input.indexSearch });
  const rb = await resolveTimelineClip(project, { timelineClipId: bId, clipQuery: bQuery, indexSearch: input.indexSearch });
  if (ra.ok && rb.ok) return { ok: true, clipA: ra.clip, clipB: rb.clip };
  const errors = [ra.ok ? "" : ra.error, rb.ok ? "" : rb.error].filter(Boolean);
  return { ok: false, error: errors.join("\n") || "Error: Could not resolve transition clip pair." };
}
