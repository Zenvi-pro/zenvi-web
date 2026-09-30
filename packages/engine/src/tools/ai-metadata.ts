/**
 * AI metadata on files and clips (`ai_metadata`: summary, chapters, scene
 * descriptions, transcript cues, index block).
 *
 * Port of zenvi-core src/classes/ai_metadata_utils.py (ref b63c39be7). Scene
 * and cue times are resolved in root source-file seconds; a placement's
 * "effective" metadata is the root file's metadata filtered to the clip's
 * source window, with times rebased clip-local.
 */

import { pySlice } from "./pyfmt.js";

export type AiMetadata = Record<string, unknown>;

const SCENE_EPS = 1e-3;

// Python str.splitlines() boundaries (it splits on these control characters too).
// eslint-disable-next-line no-control-regex
const PY_LINE_BREAKS = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Python `float(x or fallback)`: falsy values (None, False, 0, "") give
 * `fallback`; junk that `float()` would reject also gives `fallback`.
 */
export function pyNum(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return fallback;
  if (value === true) return 1;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : fallback;
}

/** Python `str(x or "").strip()`. */
export function pyText(value: unknown): string {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return "";
  return String(value).trim();
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return list(value).filter(isRecord);
}

/** (source_start, source_end) of a placement in root source seconds (get_source_window). */
export function getSourceWindow(clipData: unknown, fileData?: unknown): [number, number] {
  const data = isRecord(clipData) ? clipData : {};
  let start = pyNum(data.start);
  let end = pyNum(data.end);
  if (end <= start + SCENE_EPS && isRecord(fileData)) {
    const fileDur = pyNum(fileData.duration);
    if (fileDur > start + SCENE_EPS) {
      end = fileDur;
    } else {
      const fStart = pyNum(fileData.start);
      const fEnd = pyNum(fileData.end);
      if (fEnd > fStart + SCENE_EPS) {
        start = fStart;
        end = fEnd;
      } else if (fileDur > start + SCENE_EPS) {
        end = fileDur;
      }
    }
  }
  if (end <= start + SCENE_EPS) end = start + 0.1;
  return [start, end];
}

/** A scene entry in absolute root source seconds (scene_source_time). */
export function sceneSourceTime(scene: unknown, metadata?: unknown): number {
  if (!isRecord(scene)) return 0;
  if (scene.source_time !== undefined && scene.source_time !== null) return pyNum(scene.source_time);
  const t = pyNum(scene.time);
  if (isRecord(metadata) && isRecord(metadata.source_window)) {
    const ws = pyNum(metadata.source_window.start);
    const we = pyNum(metadata.source_window.end);
    const span = Math.max(0, we - ws);
    if (span > 0 && t <= span + 1) return ws + t;
  }
  return t;
}

function filterScenesInWindow(
  scenes: unknown,
  startTime: number,
  endTime: number,
  rebased: boolean,
  metadata: unknown,
  exclusiveStart: boolean,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const scene of records(scenes)) {
    if (!scene.description) continue;
    const abs = sceneSourceTime(scene, metadata);
    if (exclusiveStart) {
      if (abs <= startTime + SCENE_EPS) continue;
    } else if (abs < startTime - SCENE_EPS) continue;
    if (abs > endTime + SCENE_EPS) continue;
    out.push({
      description: String(scene.description ?? ""),
      source_time: abs,
      time: rebased ? Math.max(0, abs - startTime) : abs,
    });
  }
  return out.sort((a, b) => pyNum(a.source_time) - pyNum(b.source_time));
}

function filterTagsForWindow(tags: unknown, windowScenes: Record<string, unknown>[]): Record<string, unknown> {
  if (!isRecord(tags)) return { objects: [], scenes: [], activities: [], mood: [], quality: {} };
  const corpus = windowScenes.map((s) => String(s.description ?? "").toLowerCase()).join(" ");
  const filtered: Record<string, unknown> = {};
  for (const key of ["objects", "scenes", "activities", "mood"]) {
    const values = tags[key];
    if (!Array.isArray(values)) {
      filtered[key] = [];
      continue;
    }
    const kept: string[] = [];
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (!text) continue;
      const norm = text.toLowerCase();
      if (corpus.includes(norm) || norm.split(/\s+/).some((tok) => tok.length > 2 && corpus.includes(tok))) kept.push(text);
    }
    filtered[key] = kept;
  }
  filtered.quality = isRecord(tags.quality) ? tags.quality : {};
  return filtered;
}

/** Timed items (cues, moments) clipped to a window; keeps absolute source_start/source_end. */
export function filterTimedItems(items: unknown, sourceStart: number, sourceEnd: number, rebased = true): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of records(items)) {
    const i0 = pyNum(item.start);
    const i1 = pyNum(item.end, i0);
    if (i1 < sourceStart - SCENE_EPS || i0 > sourceEnd + SCENE_EPS) continue;
    const entry: Record<string, unknown> = { ...item };
    const clippedStart = Math.max(i0, sourceStart);
    const clippedEnd = Math.min(i1, sourceEnd);
    entry.source_start = clippedStart;
    entry.source_end = Math.max(clippedStart, clippedEnd);
    if (rebased) {
      entry.start = Math.max(0, clippedStart - sourceStart);
      entry.end = Math.max(entry.start as number, clippedEnd - sourceStart);
    }
    out.push(entry);
  }
  return out;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (structuredClone(value) as T);
}

/** Clip-local metadata from root metadata and a source window (materialize_clip_ai_metadata). */
export function materializeClipAiMetadata(
  rootAi: unknown,
  sourceStart: number,
  sourceEnd: number,
  options: { rebased?: boolean; exclusiveStart?: boolean } = {},
): AiMetadata {
  const rebased = options.rebased ?? true;
  if (!isRecord(rootAi) || !rootAi.analyzed) return {};
  const scenes = filterScenesInWindow(rootAi.scene_descriptions, sourceStart, sourceEnd, rebased, rootAi, options.exclusiveStart ?? false);
  const tags = filterTagsForWindow(isRecord(rootAi.tags) ? rootAi.tags : {}, scenes);

  const chapters: Record<string, unknown>[] = [];
  for (const ch of records(rootAi.chapters)) {
    const c0 = pyNum(ch.start);
    const c1 = pyNum(ch.end, c0);
    if (c1 < sourceStart - 1e-3 || c0 > sourceEnd + 1e-3) continue;
    const entry: Record<string, unknown> = { ...ch };
    if (rebased) {
      entry.start = Math.max(0, c0 - sourceStart);
      entry.end = Math.max(entry.start as number, c1 - sourceStart);
    }
    chapters.push(entry);
  }

  const cues = filterTimedItems(rootAi.transcript_cues, sourceStart, sourceEnd, rebased);
  const moments = filterTimedItems(rootAi.moments, sourceStart, sourceEnd, rebased);
  const short = pyText(rootAi.short_summary);
  let description = pyText(rootAi.description);
  const sounds = pyText(rootAi.sounds);
  const transcript = pyText(rootAi.transcript);
  if (!description && scenes.length > 0) {
    description = scenes.map((s) => s.description).filter(Boolean).join(" ");
  }
  return {
    analyzed: true,
    analysis_version: rootAi.analysis_version ?? "2.0",
    analysis_date: rootAi.analysis_date ?? "",
    provider: rootAi.provider ?? "twelvelabs-pegasus",
    short_summary: short,
    description,
    sounds,
    transcript,
    chapters,
    transcript_cues: cues,
    moments,
    has_speech: cues.length > 0,
    scene_descriptions: scenes,
    tags,
    faces: clone(rootAi.faces ?? []),
    colors: clone(rootAi.colors ?? {}),
    audio_analysis: clone(rootAi.audio_analysis ?? {}),
    confidence: rootAi.confidence ?? 0,
    twelvelabs: clone(rootAi.twelvelabs ?? {}),
    source_window: { start: sourceStart, end: sourceEnd },
  };
}

/** True when persisted clip metadata matches the trim window (clip_metadata_is_valid). */
export function clipMetadataIsValid(clipAi: unknown, sourceStart: number, sourceEnd: number): boolean {
  if (!isRecord(clipAi) || !clipAi.analyzed) return false;
  const sw = clipAi.source_window;
  if (!isRecord(sw)) return false;
  const ws = pyNum(sw.start, -1) || -1;
  const we = pyNum(sw.end, -1) || -1;
  if (Math.abs(ws - sourceStart) > SCENE_EPS || Math.abs(we - sourceEnd) > SCENE_EPS) return false;
  if (!("transcript_cues" in clipAi)) return false;
  const scenes = list(clipAi.scene_descriptions);
  if (scenes.length === 0) return true;
  return scenes.every((s) => isRecord(s) && s.source_time !== undefined && s.source_time !== null);
}

/** Metadata for a placement's source window (get_effective_ai_metadata). */
export function getEffectiveAiMetadata(
  fileData: unknown,
  clipData?: unknown,
  options: { clipAiMetadata?: unknown; rootAiMetadata?: unknown; rebased?: boolean } = {},
): AiMetadata {
  const rebased = options.rebased ?? true;
  const [startTime, endTime] = getSourceWindow(clipData, fileData);
  let rootAi = options.rootAiMetadata;
  if ((rootAi === undefined || rootAi === null) && isRecord(fileData)) rootAi = fileData.ai_metadata;
  if (!isRecord(rootAi) || !rootAi.analyzed) return {};
  const clipAi = options.clipAiMetadata;
  if (clipMetadataIsValid(clipAi, startTime, endTime) && isRecord(clipAi)) {
    if (!rebased) return clipAi;
    return {
      ...clipAi,
      scene_descriptions: records(clipAi.scene_descriptions)
        .filter((s) => s.description)
        .map((s) => ({
          description: String(s.description ?? ""),
          source_time: pyNum(s.source_time),
          time: Math.max(0, pyNum(s.source_time) - startTime),
        })),
      source_window: { start: startTime, end: endTime },
    };
  }
  return materializeClipAiMetadata(rootAi, startTime, endTime, { rebased });
}

/**
 * Compact summary for agent listings (build_summary_preview). Truncated
 * previews end with "…"; the desktop source has a mojibake "ΓÇª" there
 * (ai_metadata_utils.py:378), which is not reproduced.
 */
export function buildSummaryPreview(effective: unknown, maxItems = 5): string {
  if (!isRecord(effective)) return "";
  const parts: string[] = [];
  const short = pyText(effective.short_summary);
  if (short) parts.push(pySlice(short, 0, 80));
  if (parts.length === 0) {
    const desc = pyText(effective.description);
    if (desc) {
      for (const raw of desc.split(PY_LINE_BREAKS)) {
        const line = raw.trim();
        if (line && !line.endsWith(":") && !["scene:", "sounds:", "transcript:"].includes(line.toLowerCase())) {
          parts.push(pySlice(line, 0, 80));
          break;
        }
      }
      if (parts.length === 0) parts.push(pySlice(desc, 0, 80));
    }
  }
  if (parts.length === 0) {
    for (const ch of records(effective.chapters).slice(0, 2)) {
      if (ch.summary) parts.push(pySlice(String(ch.summary), 0, 40));
    }
  }
  if (parts.length === 0) {
    for (const key of ["transcript", "sounds"]) {
      const value = pyText(effective[key]);
      if (value) {
        parts.push(pySlice(value, 0, 60));
        break;
      }
    }
  }
  if (parts.length === 0) {
    const tags = isRecord(effective.tags) ? effective.tags : {};
    for (const key of ["objects", "scenes", "activities"]) {
      const values = tags[key];
      if (Array.isArray(values)) {
        for (const v of values.slice(0, maxItems)) if (v) parts.push(String(v).trim());
      }
    }
  }
  let preview = parts.slice(0, maxItems).join(", ");
  if (Array.from(preview).length > 80) preview = pySlice(preview, 0, 79).trimEnd() + "…";
  return preview;
}

/** Keep comma-separated tags relevant to the effective window (filter_tags_string_for_window). */
export function filterTagsStringForWindow(tags: string, effective: unknown): string {
  if (!tags) return buildSummaryPreview(effective);
  const corpus = buildSummaryPreview(effective).toLowerCase();
  if (!corpus) return tags;
  const kept: string[] = [];
  for (const part of tags.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const low = token.toLowerCase();
    if (corpus.includes(low) || low.split(/\s+/).some((w) => w.length > 2 && corpus.includes(w))) kept.push(token);
  }
  return kept.length > 0 ? kept.join(", ") : buildSummaryPreview(effective);
}

/** `ai_metadata.analyzed` of a file. */
export function fileIsAnalyzed(fileData: unknown): boolean {
  return isRecord(fileData) && isRecord(fileData.ai_metadata) && Boolean(fileData.ai_metadata.analyzed);
}

// ---------------------------------------------------------------------------
// Index block (twelvelabs_match.py get_index_block / twelvelabs_is_indexed)
// ---------------------------------------------------------------------------

/** The index block of ai_metadata (`index` preferred, legacy `twelvelabs`). */
export function getIndexBlock(aiMetadata: unknown): Record<string, unknown> {
  if (!isRecord(aiMetadata)) return {};
  if (isRecord(aiMetadata.index) && Object.keys(aiMetadata.index).length > 0) return { ...aiMetadata.index };
  if (isRecord(aiMetadata.twelvelabs)) return { ...aiMetadata.twelvelabs };
  return {};
}

/** True when index metadata shows a completed index (status ready + index_id + video_id). */
export function isIndexed(meta: unknown): boolean {
  if (!isRecord(meta)) return false;
  let block: unknown = meta;
  if ("index" in meta || "twelvelabs" in meta || "provider" in meta) {
    block = isRecord(meta.index) && Object.keys(meta.index).length > 0 ? meta.index : isRecord(meta.twelvelabs) ? meta.twelvelabs : meta;
  }
  if (!isRecord(block)) return false;
  return String(block.status ?? "").toLowerCase() === "ready" && pyText(block.index_id) !== "" && pyText(block.video_id) !== "";
}

// ---------------------------------------------------------------------------
// tl_search_strategy.py
// ---------------------------------------------------------------------------

const AUDIO_MARKERS = [
  "podcast", "interview", "dialogue", "voiceover", "voice over", "talking", "speech",
  "monologue", "narrat", "lecture", "conversation", "music", "lyrics", "subtitle",
];

function tagCorpusSparse(ai: Record<string, unknown>): boolean {
  const combined = `${pyText(ai.short_summary)} ${pyText(ai.description)} ${pyText(ai.transcript)} ${pyText(ai.sounds)}`.trim();
  const chapters = list(ai.chapters);
  if (Array.from(combined).length < 40 && chapters.length <= 1) return true;
  const tags = isRecord(ai.tags) ? ai.tags : {};
  const unique = new Set([...list(tags.objects), ...list(tags.scenes), ...list(tags.activities)].filter(Boolean).map((x) => String(x).toLowerCase()));
  const sceneCount = list(ai.scene_descriptions).length;
  if (unique.size > 0 && unique.size <= 2 && sceneCount <= 2 && Array.from(combined).length < 40) return true;
  if (unique.size === 0 && !combined && sceneCount <= 2) return true;
  return false;
}

/** "prefer_audio_and_visual" or "visual_ok" (infer_tl_search_hint). */
export function inferSearchHint(ai: unknown, filename = ""): "prefer_audio_and_visual" | "visual_ok" {
  if (!isRecord(ai)) return "visual_ok";
  const tl = isRecord(ai.twelvelabs) ? ai.twelvelabs : {};
  if (String(tl.status ?? "").toLowerCase() !== "ready") return "visual_ok";
  const desc = `${String(ai.description ?? "")} ${filename.toLowerCase()}`.toLowerCase();
  if (AUDIO_MARKERS.some((m) => desc.includes(m))) return "prefer_audio_and_visual";
  const lang = String(ai.language || tl.language || "").toLowerCase();
  if (lang && lang !== "en" && lang !== "english") return "prefer_audio_and_visual";
  const transcription = ai.transcription || tl.transcription || "";
  // tl_search_strategy._NON_LATIN: any non-ASCII character.
  // eslint-disable-next-line no-control-regex
  if (typeof transcription === "string" && /[^\x00-\x7F]/.test(transcription)) return "prefer_audio_and_visual";
  if (tagCorpusSparse(ai)) return "prefer_audio_and_visual";
  return "visual_ok";
}
