/**
 * Index search tools: search_clips_tool, search_clip_scenes_tool,
 * get_project_catalog_tool, slice_clip_at_best_match_tool,
 * watch_clip_window_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * search_clips, search_clip_scenes, get_project_catalog,
 * slice_clip_at_best_match (+ _slice_timeline_clip_at_source_times,
 * _slice_at_source_cut, _scene_description_cut_source), watch_clip_window;
 * with zenvi-core develop #168 (b17a44cd4): search rows picked by rank but
 * numbered by occurrence, strict start/end parsing, explicit slice times
 * redirected to the sibling clip that holds them, and the watch report
 * (frames watched, shot cuts, where the query is visible).
 */

import type { Clip, Project } from "../../model/types.js";
import { splitClip } from "../../ops/clips.js";
import { getEffectiveAiMetadata, getIndexBlock, getSourceWindow, materializeClipAiMetadata } from "../ai-metadata.js";
import { snapCutOutOfSpeech } from "../audio-mix.js";
import {
  collectProjectIndex,
  isIndexingConfigured,
  mapSearchHitToFile,
  projectCatalog,
  searchIndex,
  selectHitsForDisplay,
  selectMatch,
  snapToSliceGrid,
  type EnrichedHit,
  type SearchHit,
} from "../backend.js";
import { buildTimelineClipContext, resolveParentFileData } from "../clip-context.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { parseExplicitSourceTimeRange, parseSecondsArg, TimeArgError } from "../placement.js";
import { pyFixed, pyRepr, pyStr } from "../pyfmt.js";
import { confirmWatchWindow, type WatchResult } from "../watch.js";
import { detectOrdinal, fileById, fmtMmss, parseOccurrence, record, resolveClip, semanticSearchQuery, text } from "./common.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hitPeak(hit: SearchHit, s: number, e: number): number {
  if (hit.peak !== null && hit.peak !== undefined && String(hit.peak).trim() !== "") {
    const n = Number(hit.peak);
    if (Number.isFinite(n)) return n;
  }
  return (s + e) / 2;
}

function hitIsDegraded(hit: SearchHit): boolean {
  return hit.degraded === true || String(hit.role ?? "").trim().toLowerCase() === "orientation";
}

/** tool_handlers._format_search_window. */
function formatSearchWindow(hit: SearchHit, s: number, e: number): string {
  if (hitIsDegraded(hit)) return "chapter-level match only — window not action-bounded; re-index or narrow the query";
  return (
    `start_seconds=${pyFixed(s, 3)} end_seconds=${pyFixed(e, 3)} ` +
    `peak_seconds=${pyFixed(hitPeak(hit, s, e), 3)} (${fmtMmss(s)}–${fmtMmss(e)})`
  );
}

/** Search one video, retrying with an audio-biased query on zero hits (_tl_search_items_in_window). */
async function searchInWindow(call: ToolCall, indexId: string, query: string, pageLimit: number, videoId: string): Promise<{ items: SearchHit[]; error?: string }> {
  const run = async (q: string): Promise<{ items: SearchHit[]; error?: string }> => {
    if (!indexId.trim()) return { items: [], error: "TwelveLabs index_id is missing for this file." };
    const res = await searchIndex(call, q, { indexId, videoId, pageLimit, topK: pageLimit });
    if (res.error) return { items: [], error: res.error };
    const items = videoId ? res.results.filter((it) => String(it.video_id ?? "") === videoId) : res.results;
    return { items };
  };
  const first = await run(query);
  if (first.error || first.items.length > 0) return first;
  const q = semanticSearchQuery(query);
  // eslint-disable-next-line no-control-regex
  const audioQ = !q ? "spoken dialogue" : /[^\x00-\x7F]/.test(q) ? `spoken words: ${q}` : `spoken dialogue about ${q}`;
  return audioQ !== query ? run(audioQ) : first;
}

interface WatchedMatch extends EnrichedHit {
  in_source?: number;
  out_source?: number;
  _watch_warning?: string;
  _watch_fallback?: boolean;
}

async function applyWatchToMatch(call: ToolCall, match: EnrichedHit, file: Parameters<typeof confirmWatchWindow>[1]["file"], query: string, duration: number, cues: unknown[]): Promise<WatchedMatch> {
  let start = Number(match.start ?? match.cut_source ?? 0) || 0;
  let end = Number(match.end ?? start) || start;
  if (end < start) [start, end] = [end, start];
  const watched = await confirmWatchWindow(call, {
    file,
    start,
    end,
    query,
    fallbackCut: match.cut_source ?? (start + end) / 2,
    duration,
    cues,
    fallbackIn: start,
    fallbackOut: end,
  });
  return {
    ...match,
    cut_source: watched.cut_source,
    in_source: watched.in_source,
    out_source: watched.out_source,
    _watch_warning: watched.warning,
    _watch_fallback: watched.used_fallback,
  };
}

/** tool_handlers._search_rank_key: the best-ranked hit first, unranked hits last. */
function searchRankKey(hit: SearchHit): number {
  const raw: unknown = hit.rank;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    if (!Number.isNaN(n)) return n;
  }
  return Number.POSITIVE_INFINITY;
}

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface ClipInfo {
  clip: Clip;
  clipStart: number;
  clipEnd: number;
  clipPos: number;
  layer: number;
  fileId: string;
  indexId: string;
  videoId: string;
  status: string;
  indexError: string;
  sourceAi: Record<string, unknown> | undefined;
  watchFile: ReturnType<typeof fileById>;
  watchDuration: number;
  watchCues: unknown[];
  title: string;
}

/** What slicing/searching a placed clip needs to know about it. */
function clipInfo(project: Project, clip: Clip): ClipInfo {
  const fileId = String(clip.file_id ?? "");
  const file = fileId ? fileById(project, fileId) : undefined;
  const [clipStart, clipEnd] = getSourceWindow(clip, file);
  const parent = resolveParentFileData(project, file, fileId) as Record<string, unknown> | undefined;
  const sourceAi = isRecord(parent?.ai_metadata) ? (parent!.ai_metadata as Record<string, unknown>) : undefined;
  const block = getIndexBlock(sourceAi ?? {});
  const watchData = (parent ?? file) as Record<string, unknown> | undefined;
  const wai = record(watchData?.ai_metadata);
  const ctx = buildTimelineClipContext(project, clip, file, { layers: project.layers });
  return {
    clip,
    clipStart,
    clipEnd,
    clipPos: Number(clip.position) || 0,
    layer: Math.trunc(Number(clip.layer ?? 1)) || 1,
    fileId,
    indexId: String(block.index_id ?? ""),
    videoId: String(block.video_id ?? ""),
    status: String(block.status ?? "").toLowerCase(),
    indexError: String(block.error ?? "").trim(),
    sourceAi,
    watchFile: watchData as ReturnType<typeof fileById>,
    watchDuration: Number(watchData?.duration) || 0,
    watchCues: Array.isArray(wai.transcript_cues) ? wai.transcript_cues : [],
    title: ctx.title || "Timeline clip",
  };
}

/** Cut time from chapters / scene descriptions matching the query (_scene_description_cut_source). */
function sceneDescriptionCut(clipStart: number, clipEnd: number, sourceAi: unknown, query: string, occurrence: number): number | null {
  const local = isRecord(sourceAi) ? materializeClipAiMetadata(sourceAi, clipStart, clipEnd, { rebased: true }) : {};
  const candidates: { time: number; description: string }[] = [];
  for (const ch of Array.isArray(local.chapters) ? local.chapters : []) {
    if (!isRecord(ch)) continue;
    const summary = String(ch.summary || ch.title || "").trim();
    if (summary) candidates.push({ time: Number(ch.start) || 0, description: summary });
  }
  for (const sc of Array.isArray(local.scene_descriptions) ? local.scene_descriptions : []) {
    if (!isRecord(sc)) continue;
    const desc = String(sc.description ?? "").trim();
    if (desc) candidates.push({ time: Number(sc.time) || 0, description: desc });
  }
  if (candidates.length === 0) return null;
  const q = query.toLowerCase();
  const scored: [number, number][] = [];
  for (const c of candidates) {
    if (c.time < clipStart - 1e-3 || c.time > clipEnd + 1e-3) continue;
    let score = 0;
    if (q && c.description.toLowerCase().includes(q)) score = 10;
    else if (q) {
      const qw = new Set(q.split(/\s+/).filter(Boolean));
      const dw = new Set(c.description.toLowerCase().split(/\s+/).filter(Boolean));
      const overlap = [...qw].filter((w) => dw.has(w)).length;
      if (overlap) score = overlap / (Math.sqrt(qw.size) * Math.sqrt(dw.size));
    } else score = 0.01;
    if (score > 0) scored.push([c.time, score]);
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b[1] - a[1]);
  if (occurrence > 0) return scored[Math.min(occurrence, scored.length) - 1]![0];
  return scored[0]![0];
}

/** The clip's transcript cues in source seconds (_clip_transcript_cues). */
function clipTranscriptCues(project: Project, clip: Clip): unknown[] {
  const file = clip.file_id ? fileById(project, String(clip.file_id)) : undefined;
  const effective = getEffectiveAiMetadata(file, clip, { clipAiMetadata: (clip as { ai_metadata?: unknown }).ai_metadata });
  return Array.isArray(effective.transcript_cues) ? effective.transcript_cues.filter(isRecord) : [];
}

function fpsParts(project: Project): [number, number] {
  const fps = record(project.fps);
  return [Number(fps.num ?? 30) || 30, Number(fps.den ?? 1) || 1];
}

/** Slice a placed clip at a source time, off speech (_slice_at_source_cut). */
function sliceAtSourceCut(call: ToolCall, info: ClipInfo, cutSource: number, label: string): string {
  const project = call.doc.project;
  const [num, den] = fpsParts(project);
  let cut = cutSource;
  let what = label;
  const [snappedCut, cue] = snapCutOutOfSpeech(cut, clipTranscriptCues(project, info.clip));
  if (cue) {
    cut = snappedCut;
    what = `${what}, moved off speech`;
  }
  cut = snapToSliceGrid(cut, num, den);
  const slicePos = snapToSliceGrid(info.clipPos + (cut - info.clipStart), num, den);
  const clipTimelineEnd = info.clipPos + (info.clipEnd - info.clipStart);
  if (slicePos <= info.clipPos || slicePos >= clipTimelineEnd) {
    return `Error: Computed slice position (${pyFixed(slicePos, 3)}s) is outside the clip range [${pyFixed(info.clipPos, 3)}s – ${pyFixed(clipTimelineEnd, 3)}s].`;
  }
  const clipId = String(info.clip.id);
  call.commit((tx) => splitClip(tx, clipId, slicePos, "both"));
  return `Sliced at ${fmtMmss(cut - info.clipStart)} (${what}).`;
}

/** Slice once or twice so the middle piece is source [t0, t1] (_slice_timeline_clip_at_source_times). */
function sliceAtSourceTimes(call: ToolCall, info: ClipInfo, t0: number, t1: number): string {
  const [num, den] = fpsParts(call.doc.project);
  const snap = (pos: number): number => snapToSliceGrid(pos, num, den);
  const eps = 1e-3;
  const { clipStart, clipEnd, clipPos } = info;
  const clipTlEnd = clipPos + (clipEnd - clipStart);
  const clipId = String(info.clip.id);
  if (t0 <= clipStart + eps && t1 >= clipEnd - eps) return "Nothing to slice: the requested range spans the whole clip.";
  if (t0 <= clipStart + eps) {
    const pos2 = snap(clipPos + (t1 - clipStart));
    if (pos2 <= clipPos + eps || pos2 >= clipTlEnd - eps) {
      return `Error: End time maps outside the clip (clip source ${pyFixed(clipStart, 3)}s–${pyFixed(clipEnd, 3)}s on timeline).`;
    }
    call.commit((tx) => splitClip(tx, clipId, pos2, "both"));
    return `Sliced at ${fmtMmss(t1 - clipStart)} from clip start; middle+right kept.`;
  }
  if (t1 >= clipEnd - eps) {
    const pos1 = snap(clipPos + (t0 - clipStart));
    if (pos1 <= clipPos + eps || pos1 >= clipTlEnd - eps) {
      return `Error: Start time maps outside the clip (clip source ${pyFixed(clipStart, 3)}s–${pyFixed(clipEnd, 3)}s on timeline).`;
    }
    call.commit((tx) => splitClip(tx, clipId, pos1, "both"));
    return `Sliced at ${fmtMmss(t0 - clipStart)} from clip start; left+middle kept.`;
  }
  const pos1 = snap(clipPos + (t0 - clipStart));
  const pos2abs = snap(clipPos + (t1 - clipStart));
  if (pos1 <= clipPos + eps || pos1 >= clipTlEnd - eps) return "Error: First slice position is outside the clip on the timeline.";
  if (pos2abs <= pos1 + eps || pos2abs >= clipTlEnd - eps) return "Error: Second slice position is outside the clip on the timeline.";
  const pos2 = snap(pos1 + (t1 - t0));
  const rightEnd = pos1 + (clipEnd - t0);
  if (pos2 <= pos1 + eps || pos2 >= rightEnd - eps) return "Error: Second slice maps outside the trimmed segment.";
  call.commit((tx) => {
    const first = splitClip(tx, clipId, pos1, "both");
    if (!first.rightId) throw new Error("the first slice produced no right segment");
    splitClip(tx, first.rightId, pos2, "both");
  });
  return `Sliced at ${fmtMmss(t0 - clipStart)} and ${fmtMmss(t1 - clipStart)} (source). Three segments: before, selected range, after.`;
}

const SIBLING_EPS = 1e-3;

interface SiblingClip {
  clip: Clip;
  id: string;
  sourceStart: number;
  sourceEnd: number;
  position: number;
  layer: number;
}

/** Other placements cut from the same source file, by source start (_sibling_clips_from_same_file). */
function siblingClipsFromSameFile(project: Project, fileId: string, excludeClipId: string): SiblingClip[] {
  // No source identity: every other id-less clip would "match", and a cut
  // outside this clip would land on a clip from a different file.
  if (!fileId.trim()) return [];
  const out: SiblingClip[] = [];
  for (const clip of project.clips ?? []) {
    if (String(clip.file_id ?? "") !== fileId || String(clip.id) === excludeClipId) continue;
    const file = fileById(project, fileId);
    const [cs, ce] = getSourceWindow(clip, file);
    const layer = Math.trunc(Number(clip.layer ?? 1)) || 1;
    out.push({ clip, id: String(clip.id), sourceStart: cs, sourceEnd: ce, position: Number(clip.position) || 0, layer });
  }
  return out.sort((a, b) => a.sourceStart - b.sourceStart);
}

/**
 * First sibling whose source window holds [t0, t1] with room to cut
 * (_sibling_containing): a point cut must be strictly inside; a range may
 * touch one edge but not both.
 */
function siblingContaining(siblings: readonly SiblingClip[], t0: number, t1: number): SiblingClip | undefined {
  for (const sib of siblings) {
    const cs = sib.sourceStart;
    const ce = sib.sourceEnd;
    if (t1 - t0 <= SIBLING_EPS) {
      if (cs + SIBLING_EPS < t0 && t0 < ce - SIBLING_EPS) return sib;
      continue;
    }
    if (cs - SIBLING_EPS <= t0 && t1 <= ce + SIBLING_EPS && (t0 - cs > SIBLING_EPS || ce - t1 > SIBLING_EPS)) return sib;
  }
  return undefined;
}

/** _describe_siblings. */
function describeSiblings(siblings: readonly SiblingClip[]): string {
  if (siblings.length === 0) return "it is the only clip from this file on the timeline";
  const parts = siblings.map(
    (s) => `[${pyFixed(s.sourceStart, 2)}s–${pyFixed(s.sourceEnd, 2)}s] at ${fmtMmss(s.position)} on track ${s.layer} (timeline_clip_id=${s.id})`,
  );
  return `other clips from this file cover ${parts.join("; ")}`;
}

/**
 * A time written into a watch query ("visible at 72.5 seconds", "45-62s")
 * that belongs in start/end (tool_handlers._QUERY_TIME_RE).
 */
const QUERY_TIME_RE = /\b\d+(?:\.\d+)?\s*(?:s|secs?|seconds?)\b|\b\d{1,2}:\d{2}\b|\bat\s+\d+(?:\.\d+)?\b/i;

/** `", ".join(f"{t:.2f}" for t in times)`. */
function secsList(times: readonly number[]): string {
  return times.map((t) => pyFixed(t, 2)).join(", ");
}

async function clipForSearch(call: ToolCall, input: Record<string, unknown>): Promise<{ ok: true; clip: Clip } | { ok: false; error: string }> {
  const resolved = await resolveClip(call, input);
  return resolved.ok ? { ok: true, clip: resolved.clip } : { ok: false, error: resolved.error || "Error: Could not resolve timeline clip." };
}

const SEARCH = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

export const searchTools: CatalogTool[] = [
  contractTool("search_clips_tool", {
    annotations: SEARCH,
    requires: ["backend"],
    run: async (call, input) => {
      const q = text(input.query);
      if (!q) return "Error: query is required.";
      const kRaw = Number(text(input.top_k) || 5);
      const k = Math.max(1, Math.min(Number.isFinite(kRaw) ? Math.trunc(kRaw) : 5, 20));
      const project = call.doc.project;
      const info = collectProjectIndex(project);
      if (info.error && !info.indexId) return `Error: ${info.error} Index/summarize project videos first, then search again.`;
      if (!info.indexId) return "Error: No project video index_id on project files. Reindex clips so they share the project index, then retry.";
      if (!(await isIndexingConfigured(call))) return "Error: Video indexing is not configured on the backend.";
      const pageLimit = Math.max(30, k * 10);
      const res = await searchIndex(call, q, { topK: pageLimit, indexId: info.indexId, pageLimit, lookFor: text(input.look_for) || undefined });
      if (res.error) return `Error: ${res.error}`;
      const results = res.results;
      if (results.length === 0) {
        return (
          `No index matches for '${q}' in this project's index ` +
          `(${info.indexName || info.indexId}, ${info.indexedCount} indexed media item(s)). ` +
          "Try a more specific description, or check indexing finished."
        );
      }
      const nth = detectOrdinal(q);
      const grouped = new Map<string, (SearchHit & { _fid: string; _fname: string; _vid: string })[]>();
      for (const r of results) {
        const vid = String(r.video_id ?? "").trim();
        const [fid, fname] = mapSearchHitToFile(r, info.videoMap);
        const key = fid || vid || fname || "unknown";
        grouped.set(key, [...(grouped.get(key) ?? []), { ...r, _fid: fid, _fname: fname, _vid: vid }]);
      }
      const lines = [
        `Found ${results.length} match(es) across ${grouped.size} project media item(s) (index_id=${info.indexId}, index_name=${info.indexName || ""}):`,
      ];
      let shown = 0;
      for (const [key, hits] of grouped) {
        if (shown >= k && nth === 0) break;
        const first = hits[0]!;
        const fname = first._fname || key;
        const idPart = first._fid ? ` media_bin_file_id=${first._fid}` : " media_bin_file_id=(unmapped)";
        const vidPart = first._vid ? ` twelvelabs_video_id=${first._vid}` : "";
        const typePart = ` media_type=${String(first.media_type || "video")}`;
        const sorted = [...hits].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
        if (sorted.length === 1 && nth === 0) {
          const r = sorted[0]!;
          lines.push(`  • ${fname}${idPart}${vidPart}${typePart} — ${formatSearchWindow(r, Number(r.start) || 0, Number(r.end) || 0)} (rank=${pyStr(r.rank ?? null)})`);
          shown += 1;
          continue;
        }
        if (nth > 0) {
          const r = sorted[Math.min(nth - 1, sorted.length - 1)]!;
          lines.push(`  • ${fname}${idPart}${vidPart} — occurrence #${nth} ${formatSearchWindow(r, Number(r.start) || 0, Number(r.end) || 0)}`);
        } else {
          lines.push(`  • ${fname}${idPart}${vidPart} — ${sorted.length} occurrences:`);
          // Pick WHICH occurrences to show by rank, show them in time order,
          // and number each by its place in the full chronological list (what
          // "the 3rd time" resolves against), so rank selection never renumbers.
          const byRank = [...hits].sort((a, b) => compareNumbers(searchRankKey(a), searchRankKey(b)));
          const best = byRank[0];
          const nthOf = new Map(sorted.map((h, i) => [h, i + 1] as const));
          const shownRows = [...byRank.slice(0, 8)].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
          for (const r of shownRows) {
            const marker = r === best ? "  <-- best match" : "";
            lines.push(
              `      ${nthOf.get(r) ?? "?"}. ${formatSearchWindow(r, Number(r.start) || 0, Number(r.end) || 0)} (rank=${pyStr(r.rank ?? null)})${marker}`,
            );
          }
          if (sorted.length > 1) lines.push("      Place the best match unless the user asked for a different one (e.g. 'the 2nd time').");
        }
        shown += 1;
      }
      const unmapped = [...grouped.values()].filter((hits) => !hits[0]!._fid).length;
      if (unmapped) lines.push(`Note: ${unmapped} hit group(s) had no media_bin_file_id mapping — reindex those files into this project index.`);
      lines.push(
        "To PLACE a moment: place_moment(file_id=..., start_seconds=<keep in>, " +
          "end_seconds=<keep out>, query=<same description>, track=..., position_seconds=...). " +
          "Watch+trim+place are built in — do not call watch_clip_window_tool or convert to frames. " +
          "To SLICE an already-placed clip: slice_moment(query, clip_query=... or timeline_clip_id=...).",
      );
      return lines.join("\n");
    },
  }),

  contractTool("search_clip_scenes_tool", {
    annotations: SEARCH,
    run: async (call, input) => {
      const query = text(input.query);
      const kRaw = Number(text(input.top_k) || 5);
      const k = Number.isFinite(kRaw) ? Math.trunc(kRaw) : 5;
      const target = await clipForSearch(call, input);
      if (!target.ok) return target.error;
      const project = call.doc.project;
      const info = clipInfo(project, target.clip);
      const nth = parseOccurrence(input.occurrence ?? "0", query);
      const header = `Index matches in '${info.title}' (${fmtMmss(info.clipStart)} - ${fmtMmss(info.clipEnd)}):`;

      if (call.host.backend && (await isIndexingConfigured(call)) && info.status === "ready" && info.indexId && info.videoId) {
        const searchQuery = semanticSearchQuery(query);
        const narrow = await searchInWindow(call, info.indexId, searchQuery, Math.max(30, k * 10), info.videoId);
        if (!narrow.error && narrow.items.length > 0) {
          let matches: WatchedMatch[] = selectHitsForDisplay(narrow.items, info.clipStart, info.clipEnd, nth, k);
          if (matches.length > 0) {
            matches = await Promise.all(matches.map((m) => applyWatchToMatch(call, m, info.watchFile, query, info.watchDuration, info.watchCues)));
            const lines = [header];
            for (const m of matches) {
              const inS = m.in_source ?? m.start;
              const outS = m.out_source ?? m.end;
              lines.push(
                `- keep ${fmtMmss(inS - info.clipStart)}-${fmtMmss(outS - info.clipStart)}` +
                  ` peak ${fmtMmss((m.cut_source ?? 0) - info.clipStart)}` +
                  ` (rank=${pyRepr(m.rank ?? null)}, overlap=${pyFixed(m.overlap_ratio, 2)})`,
              );
              if (m.transcription) lines.push(`  transcript: ${Array.from(String(m.transcription).trim()).slice(0, 180).join("")}`);
              if (m._watch_fallback) lines.push("  (text-index time; no visual match in watch window)");
            }
            const warn = matches.find((m) => m._watch_warning)?._watch_warning;
            if (warn) lines.push(`Note: ${warn}`);
            return lines.join("\n");
          }
        }
        const broad = await searchInWindow(call, info.indexId, searchQuery, Math.max(50, k * 15), "");
        if (!broad.error && broad.items.length > 0) {
          const filtered = broad.items.filter((it) => String(it.video_id || it.twelvelabs_video_id || "") === info.videoId);
          let matches: WatchedMatch[] = filtered.length > 0 ? selectHitsForDisplay(filtered, info.clipStart, info.clipEnd, nth, k) : [];
          if (matches.length > 0) {
            matches = await Promise.all(matches.map((m) => applyWatchToMatch(call, m, info.watchFile, query, info.watchDuration, info.watchCues)));
            const lines = [header];
            for (const m of matches) {
              const relCut = (m.cut_source ?? 0) - info.clipStart;
              const inS = m.in_source ?? (m.start || relCut);
              const outS = m.out_source ?? (m.end || relCut);
              lines.push(`- keep ${fmtMmss(inS - info.clipStart)}-${fmtMmss(outS - info.clipStart)} peak ${fmtMmss(relCut)} (project search)`);
            }
            const warn = matches.find((m) => m._watch_warning)?._watch_warning;
            if (warn) lines.push(`Note: ${warn}`);
            return lines.join("\n");
          }
        }
      }

      // Local chapter / description fallback.
      const perClip = record((target.clip as { ai_metadata?: unknown }).ai_metadata);
      const file = info.fileId ? fileById(project, info.fileId) : undefined;
      const parent = resolveParentFileData(project, file, info.fileId);
      const local = Object.keys(perClip).length > 0 ? perClip : getEffectiveAiMetadata(parent ?? file, target.clip, { rebased: true });
      const candidates: { time: number; description: string }[] = [];
      for (const ch of Array.isArray(local.chapters) ? local.chapters : []) {
        if (!isRecord(ch)) continue;
        const summary = String(ch.summary || ch.title || "").trim();
        if (summary) candidates.push({ time: Number(ch.start) || 0, description: summary });
      }
      for (const sc of Array.isArray(local.scene_descriptions) ? local.scene_descriptions : []) {
        if (!isRecord(sc)) continue;
        const desc = String(sc.description ?? "").trim();
        if (desc) candidates.push({ time: Number(sc.time) || 0, description: desc });
      }
      for (const key of ["transcript", "sounds", "description", "short_summary"]) {
        const t = String(local[key] ?? "").trim();
        if (t) candidates.push({ time: info.clipStart || 0, description: Array.from(t).slice(0, 500).join("") });
      }
      if (candidates.length === 0) return "No matches found.";
      const q = query.toLowerCase();
      const scored: { time: number; description: string; score: number }[] = [];
      for (const c of candidates) {
        let score = 0;
        if (c.description.toLowerCase().includes(q)) score = 10;
        else {
          const qw = new Set(q.split(/\s+/).filter(Boolean));
          const dw = new Set(c.description.toLowerCase().split(/\s+/).filter(Boolean));
          const overlap = [...qw].filter((w) => dw.has(w)).length;
          if (overlap) score = overlap / (Math.sqrt(qw.size) * Math.sqrt(dw.size));
        }
        if (score > 0) scored.push({ ...c, score });
      }
      scored.sort((a, b) => b.score - a.score);
      const results = scored.slice(0, k);
      if (results.length === 0) return "No matches found.";
      const lines = [`Description matches in '${info.title}':`];
      for (const r of results) {
        const watched = await confirmWatchWindow(call, {
          file: info.watchFile,
          start: r.time,
          end: r.time,
          query,
          fallbackCut: r.time,
          duration: info.watchDuration,
          cues: info.watchCues,
        });
        lines.push(`- [${fmtMmss(watched.cut_source)}] score=${pyFixed(r.score, 3)}: ${Array.from(r.description).slice(0, 200).join("")}`);
        if (watched.warning) lines.push(`  Note: ${watched.warning}`);
      }
      return lines.join("\n");
    },
  }),

  contractTool("get_project_catalog_tool", {
    annotations: SEARCH,
    requires: ["backend"],
    run: async (call) => {
      const projectId = String(call.doc.project.id ?? "");
      if (!projectId) return "Error: project_id unavailable.";
      const data = await projectCatalog(call, projectId);
      if (data.error) return `Error: ${data.error}`;
      if (data.items.length === 0) {
        return (
          "Catalog is empty — index/summarize project videos, images, and audio first, " +
          "then call get_project_catalog_tool again."
        );
      }
      const lines = [`Project catalog (${data.items.length} media items):`];
      for (const it of data.items) {
        const name = it.filename || it.file_id || it.video_id;
        const summary = String(it.short_summary ?? "").trim() || "(no summary)";
        const mt = String(it.media_type || "video");
        const dur = it.duration_sec;
        const durPart = typeof dur === "number" && mt !== "image" ? ` [${pyFixed(dur, 1)}s]` : "";
        lines.push(`- [${mt}] ${String(name)}${durPart} file_id=${String(it.file_id)}: ${summary}`);
      }
      return lines.join("\n");
    },
  }),

  contractTool("slice_clip_at_best_match_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (call, input) => {
      const query = text(input.query);
      // Explicit source seconds skip search and watch. One that does not
      // parse is refused, never a fall-through to a search cut (#168).
      let tIn: number | null;
      let tOut: number | null;
      try {
        tIn = parseSecondsArg(input.start_seconds, null, "start_seconds");
        tOut = parseSecondsArg(input.end_seconds, null, "end_seconds");
      } catch (error) {
        if (error instanceof TimeArgError) return `Error: ${error.message}`;
        throw error;
      }
      const target = await clipForSearch(call, { ...input, occurrence: parseOccurrence(input.occurrence ?? "0", query) });
      if (!target.ok) return target.error;
      const project = call.doc.project;
      const info = clipInfo(project, target.clip);
      const siblings = siblingClipsFromSameFile(project, info.fileId, String(info.clip.id));

      if ((tIn === null) !== (tOut === null)) {
        const cutAt = (tIn ?? tOut)!;
        if (!(info.clipStart < cutAt && cutAt < info.clipEnd)) {
          // A cut on the clip's own edge splits off nothing: say so plainly so the caller does not retry it.
          const window = `(source window [${pyFixed(info.clipStart, 2)}s–${pyFixed(info.clipEnd, 2)}s])`;
          if (Math.abs(cutAt - info.clipStart) <= SIBLING_EPS) {
            return `Nothing to slice: ${pyFixed(cutAt, 2)}s is already the start of this clip ${window}.`;
          }
          if (Math.abs(cutAt - info.clipEnd) <= SIBLING_EPS) {
            return `Nothing to slice: ${pyFixed(cutAt, 2)}s is already the end of this clip ${window}.`;
          }
          const sib = siblingContaining(siblings, cutAt, cutAt);
          if (sib) {
            return sliceAtSourceCut(call, clipInfo(project, sib.clip), cutAt, `requested time, on the clip that holds it: timeline_clip_id=${sib.id}`);
          }
          return (
            `Error: Requested cut ${pyFixed(cutAt, 2)}s is outside this clip's source window ` +
            `[${pyFixed(info.clipStart, 2)}s–${pyFixed(info.clipEnd, 2)}s], and ${describeSiblings(siblings)}. ` +
            "Pick a time inside a clip's window, or pass that clip's timeline_clip_id."
          );
        }
        return sliceAtSourceCut(call, info, cutAt, "requested time");
      }

      let explicit = parseExplicitSourceTimeRange(query);
      if (tIn !== null && tOut !== null) explicit = [Math.min(tIn, tOut), Math.max(tIn, tOut)];
      if (explicit) {
        const [t0, t1] = explicit;
        const eps = 1e-3;
        let targetInfo = info;
        if (t0 < info.clipStart - eps || t1 > info.clipEnd + eps) {
          const sib = siblingContaining(siblings, t0, t1);
          if (!sib) {
            return (
              `Error: Requested range [${pyFixed(t0, 2)}s–${pyFixed(t1, 2)}s] is outside this clip's source window ` +
              `[${pyFixed(info.clipStart, 2)}s–${pyFixed(info.clipEnd, 2)}s], and ${describeSiblings(siblings)}. ` +
              "Pick a range inside one clip's window, or pass that clip's timeline_clip_id."
            );
          }
          targetInfo = clipInfo(project, sib.clip);
        } else if (Math.abs(t0 - info.clipStart) <= eps && Math.abs(t1 - info.clipEnd) <= eps) {
          return `Nothing to slice: [${pyFixed(t0, 2)}s–${pyFixed(t1, 2)}s] is already exactly this clip's source window.`;
        }
        return sliceAtSourceTimes(call, targetInfo, t0, t1);
      }
      if (info.status === "failed") {
        const detail = info.indexError ? ` (${info.indexError})` : "";
        return (
          `TwelveLabs indexing failed for this video${detail}. Re-import the file or run reindex_project_file_tool to upload and index again. ` +
          "You can still slice by explicit times, e.g. 'from 4 seconds to 10 seconds'."
        );
      }
      if (info.status === "indexing") return "TwelveLabs is still indexing this video. Please wait for indexing to finish and try again.";
      if (!call.host.backend || !(await isIndexingConfigured(call))) return "Error: TwelveLabs is not configured.";
      if (!info.indexId) return "Error: This clip's source file has no TwelveLabs index_id. Re-import or re-index the file.";
      if (!info.videoId) {
        return "Error: This clip's source file has no TwelveLabs video_id. Re-import or re-index the file so searches target the correct video.";
      }
      const searchQuery = semanticSearchQuery(query);
      if (!searchQuery) return "Error: Empty search query.";
      const res = await searchIndex(call, searchQuery, { indexId: info.indexId, videoId: info.videoId, pageLimit: 30, topK: 30 });
      if (res.error) return `Error: ${res.error}`;
      const items = res.results.filter((it) => String(it.video_id ?? "") === info.videoId);
      const nth = parseOccurrence(input.occurrence ?? "0", query);
      const ownAi = record(fileById(project, info.fileId)?.ai_metadata);
      const fallbackToScenes = async (emptyText: string): Promise<string> => {
        const cut = sceneDescriptionCut(info.clipStart, info.clipEnd, Object.keys(ownAi).length ? ownAi : undefined, query, nth);
        if (cut === null) return emptyText;
        const watched: WatchResult = await confirmWatchWindow(call, {
          file: info.watchFile, start: cut, end: cut, query, fallbackCut: cut, duration: info.watchDuration, cues: info.watchCues,
        });
        return sliceAtSourceCut(call, info, watched.cut_source, "scene description match");
      };
      if (items.length === 0) return fallbackToScenes("No matches found.");
      const chosen = selectMatch(items, info.clipStart, info.clipEnd, nth, "mid");
      if (!chosen) return fallbackToScenes("No matches overlapped the clip window.");
      const winS = chosen.start ?? chosen.cut_source ?? 0;
      const winE = chosen.end ?? winS;
      const watched = await confirmWatchWindow(call, {
        file: info.watchFile,
        start: winS,
        end: winE,
        query,
        fallbackCut: chosen.cut_source,
        duration: info.watchDuration,
        cues: info.watchCues,
        fallbackIn: winS,
        fallbackOut: winE,
      });
      return sliceAtSourceCut(call, info, watched.cut_source ?? chosen.cut_source ?? 0, nth > 0 ? `occurrence #${nth}` : "best match");
    },
  }),

  contractTool("watch_clip_window_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    // The watch is a vision check: frames rendered here, judged by the backend.
    requires: ["frames", "backend"],
    run: async (call, input) => {
      const query = text(input.query);
      // A time that does not parse must not silently become "no window" (#168).
      let t0: number | null;
      let t1: number | null;
      try {
        t0 = parseSecondsArg(input.start, null, "start");
        t1 = parseSecondsArg(input.end, null, "end");
      } catch (error) {
        if (error instanceof TimeArgError) return `Error: ${error.message}`;
        throw error;
      }
      const target = await clipForSearch(call, input);
      if (!target.ok) return target.error;
      const info = clipInfo(call.doc.project, target.clip);
      if ((t0 === null) !== (t1 === null)) {
        return "Error: Pass both start and end (source seconds), or neither to watch the best search match.";
      }
      if (t0 === null && QUERY_TIME_RE.test(query)) {
        return (
          "Error: The query names a time but start/end are empty. Put the window in " +
          "start and end (source seconds) and describe only what to look for in query."
        );
      }
      if (t0 !== null && t1 !== null) {
        const lo = Math.min(t0, t1);
        const hi = Math.max(t0, t1);
        if (hi <= info.clipStart || lo >= info.clipEnd) {
          return (
            `Error: Window ${pyFixed(lo, 2)}-${pyFixed(hi, 2)}s is outside this clip's source range ` +
            `${pyFixed(info.clipStart, 2)}-${pyFixed(info.clipEnd, 2)}s (start/end are source seconds).`
          );
        }
        // Only what this clip plays can confirm an edit to it.
        t0 = Math.max(lo, info.clipStart);
        t1 = Math.min(hi, info.clipEnd);
      } else {
        const searchQuery = semanticSearchQuery(query);
        let hitStart: number | null = null;
        let hitEnd: number | null = null;
        if (searchQuery && (await isIndexingConfigured(call)) && info.indexId && info.videoId) {
          const found = await searchInWindow(call, info.indexId, searchQuery, 30, info.videoId);
          if (!found.error && found.items.length > 0) {
            const matches = selectHitsForDisplay(found.items, info.clipStart, info.clipEnd, parseOccurrence(String(input.occurrence ?? "0"), query), 1);
            if (matches.length > 0) {
              hitStart = Number(matches[0]!.start) || 0;
              hitEnd = Number(matches[0]!.end) || hitStart;
            }
          }
        }
        if (hitStart === null) {
          t0 = info.clipStart;
          t1 = info.clipEnd;
        } else {
          t0 = hitStart;
          t1 = hitEnd!;
        }
      }
      if (t1! < t0!) [t0, t1] = [t1, t0];
      const watched = await confirmWatchWindow(call, {
        file: info.watchFile, start: t0!, end: t1!, query, fallbackCut: t0!, duration: info.watchDuration, cues: info.watchCues,
      });
      const cut = watched.cut_source || t0!;
      const inS = watched.in_source;
      const outS = watched.out_source;
      const clipLo = info.clipStart;
      const clipHi = info.clipEnd;
      const lines = [
        `Watched ${watched.frame_times.length} frames of '${info.title || "clip"}' ` +
          `(source seconds; this clip plays ${pyFixed(clipLo, 2)}-${pyFixed(clipHi, 2)}): ` +
          `${secsList(watched.frame_times) || "none"}.`,
        watched.scene_times.length > 0 ? `Shot cuts in window (source s): ${secsList(watched.scene_times)}.` : "Shot cuts in window: none.",
      ];
      // The watch pads its window for context, so a match can sit in frames
      // this clip never plays. Only what the clip plays confirms an edit.
      const visible = watched.visible_at;
      const visibleInClip = visible.filter((t) => clipLo - 1e-3 <= t && t <= clipHi + 1e-3);
      const seen = watched.matched && !watched.used_fallback;
      const outsideOnly = (visible.length > 0 && visibleInClip.length === 0) || outS < clipLo || inS > clipHi;
      if (seen && !outsideOnly) {
        const inC = Math.max(inS, clipLo);
        const outC = Math.min(outS, clipHi);
        const cutC = Math.max(inC, Math.min(cut, outC));
        lines.push(
          `Visible ${pyFixed(inC, 3)}s–${pyFixed(outC, 3)}s source; peak ${pyFixed(cutC, 3)}s source ` +
            `(${fmtMmss(cutC - clipLo)} into the clip).` +
            (visibleInClip.length > 0 ? ` Seen in frames: ${secsList(visibleInClip)}.` : ""),
        );
      } else if (seen) {
        lines.push(`Not visible in this clip's frames${visible.length > 0 ? ` - only outside it, at ${secsList(visible)}s source.` : "."}`);
      } else {
        lines.push("Not visible in these frames.");
      }
      if (watched.reason) lines.push(watched.reason);
      if (watched.warning) lines.push(watched.warning);
      return lines.join("\n");
    },
  }),
];
