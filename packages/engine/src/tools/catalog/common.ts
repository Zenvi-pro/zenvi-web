/**
 * Shared helpers for tool implementations: Python-style argument parsing
 * (tool_handlers.py `_audio_float`, `_coerce_steps`, `_parse_occurrence`, …),
 * clip resolution with the host's playhead and index search, and per-session
 * memory of the last file a tool created.
 */

import type { ProjectDocument } from "../../history/document.js";
import type { Layer, Project, ProjectFile } from "../../model/types.js";
import { parsePythonFloat } from "../coerce.js";
import type { ToolCall } from "../define.js";
import { projectFps } from "../frame-time.js";
import { resolveTimelineClip, type ResolveResult } from "../resolve.js";
import { indexSearchForResolver } from "../backend.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** `str(x or "").strip()`. */
export function text(value: unknown): string {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return "";
  return String(value).trim();
}

/** tool_handlers._audio_float / _coerce_time_arg: blank or junk -> `fallback`. */
export function floatArg(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "boolean") return value ? 1 : 0;
  const t = String(value ?? "").trim();
  if (!t) return fallback;
  const n = parsePythonFloat(t);
  return n === null ? fallback : n;
}

/** tool_handlers._audio_bool: "1/true/yes/y/on" (blank -> `fallback`). */
export function boolArg(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const t = String(value ?? "").trim().toLowerCase();
  if (!t) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(t);
}

/** `int(float(str(x).strip() or 0))`, 0 on junk (the resolver's occurrence parse). */
export function intArg(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : fallback;
  const t = String(value ?? "").trim();
  if (!t) return fallback;
  const n = parsePythonFloat(t);
  return n === null ? fallback : Math.trunc(n);
}

/** Comma/space separated ids, order kept, duplicates dropped (tool_handlers._audio_id_list). */
export function idList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String) : String(value ?? "").replaceAll(",", " ").split(/\s+/);
  const out: string[] = [];
  for (const item of raw) {
    const t = item.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export const MAX_UNDO_STEPS = 20;

const STEP_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, once: 1, twice: 2, thrice: 3, couple: 2, few: 3,
};

/** tool_handlers._coerce_steps: an int in [1, 20]; number words work. */
export function coerceSteps(value: unknown): number {
  let n = 1;
  if (typeof value === "boolean") n = 1;
  else if (typeof value === "number") n = Number.isFinite(value) ? Math.trunc(value) : 1;
  else if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    if (/^\d+$/.test(token)) n = Number.parseInt(token, 10);
    else if (token in STEP_WORDS) n = STEP_WORDS[token]!;
    else {
      const f = parsePythonFloat(token);
      n = f === null ? 1 : Math.trunc(f);
    }
  }
  return Math.max(1, Math.min(n, MAX_UNDO_STEPS));
}

const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5,
};

/** tool_handlers._detect_ordinal. */
export function detectOrdinal(query: string): number {
  for (const word of String(query ?? "").toLowerCase().split(/\s+/)) {
    if (word in ORDINALS) return ORDINALS[word]!;
  }
  return 0;
}

/** tool_handlers._parse_occurrence: 1-based occurrence from the arg or an ordinal word (0 = best). */
export function parseOccurrence(occurrence: unknown, query: string): number {
  const n = floatArg(occurrence, null);
  if (n !== null && Math.trunc(n) > 0) return Math.trunc(n);
  const words = String(query ?? "").toLowerCase().split(/\s+/);
  for (const [word, value] of Object.entries(ORDINALS)) if (words.includes(word)) return value;
  return 0;
}

/** tool_handlers._semantic_search_query: drop ordinal words. */
export function semanticSearchQuery(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "";
  const kept = q.split(/\s+/).filter((word) => !(word.toLowerCase().replace(/^[.,;:!?"']+|[.,;:!?"']+$/g, "") in ORDINALS));
  const cleaned = kept.join(" ").trim();
  return cleaned || q;
}

/** `m:ss` (tool_handlers._fmt_mmss). */
export function fmtMmss(seconds: number): string {
  const s = Number.isFinite(seconds) ? seconds : 0;
  const m = Math.floor(s / 60);
  const rest = Math.floor(((s % 60) + 60) % 60);
  return `${m}:${String(rest).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Project lookups
// ---------------------------------------------------------------------------

export function fileById(project: Project, id: string): ProjectFile | undefined {
  return (project.files ?? []).find((f) => String(f.id) === id);
}

export function layerNumbers(project: Project): number[] {
  return (project.layers ?? []).map((l) => Math.trunc(Number(l.number))).sort((a, b) => a - b);
}

/** Playhead in timeline seconds: the host player, else the saved `playhead_position`. */
export function playheadSeconds(call: ToolCall): number {
  const fromPlayer = call.host.player?.playhead;
  if (typeof fromPlayer === "number" && Number.isFinite(fromPlayer)) return fromPlayer;
  const saved = Number(call.doc.project.playhead_position);
  return Number.isFinite(saved) ? saved : 0;
}

/** The first selected track (host UI selection), like the desktop's `selected_tracks[0]`. */
export function selectedTrack(call: ToolCall): Layer | undefined {
  const ids = call.host.ui?.selectedIds?.() ?? [];
  const layers = call.doc.project.layers ?? [];
  for (const id of ids) {
    const layer = layers.find((l) => String(l.id) === id);
    if (layer) return layer;
  }
  return undefined;
}

export function fpsFloatOf(project: Project): number {
  const fps = projectFps(project);
  return fps.num / fps.den;
}

// ---------------------------------------------------------------------------
// Clip resolution (tool_handlers._resolve_timeline_clip_for_tool)
// ---------------------------------------------------------------------------

export interface ClipTarget {
  timeline_clip_id?: unknown;
  clip_query?: unknown;
  track?: unknown;
  occurrence?: unknown;
  position_near?: unknown;
}

export function resolveClip(call: ToolCall, target: ClipTarget): Promise<ResolveResult> {
  const pos = target.position_near;
  return resolveTimelineClip(call.doc.project, {
    timelineClipId: text(target.timeline_clip_id),
    clipQuery: text(target.clip_query),
    track: text(target.track),
    positionNear: typeof pos === "string" && !pos.trim() ? null : pos,
    occurrence: intArg(target.occurrence, 0),
    playhead: playheadSeconds(call),
    indexSearch: indexSearchForResolver(call),
  });
}

// ---------------------------------------------------------------------------
// Session memory (tool_handlers._last_split_file_id_by_chat_session)
// ---------------------------------------------------------------------------

const lastFiles = new WeakMap<ProjectDocument, Map<string, string>>();

/** Remember the file a tool just created, so add_clip_to_timeline_tool can take an empty file_id. */
export function rememberFile(call: ToolCall, fileId: string): void {
  let bySession = lastFiles.get(call.doc);
  if (!bySession) {
    bySession = new Map();
    lastFiles.set(call.doc, bySession);
  }
  bySession.set(call.session, fileId);
}

export function recallFile(call: ToolCall): string | undefined {
  return lastFiles.get(call.doc)?.get(call.session);
}

export function forgetFile(call: ToolCall): void {
  lastFiles.get(call.doc)?.delete(call.session);
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
