/**
 * Desktop-identical text reports: timeline state, the chat editor snapshot,
 * and the read tools' listings.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7; the
 * editor snapshot also matches origin/develop L7733): get_project_info,
 * list_files, list_clips, list_layers, list_markers, get_timeline_state,
 * build_editor_snapshot_for_chat. Formatting follows the Python f-strings
 * exactly (repr quoting, `:.2f`, float `str`), because the backend parses the
 * snapshot back (zenvi-backend core/chat/context_compactor.py).
 */

import type { Clip, Layer, Project, ProjectFile, Transition } from "../model/types.js";
import { buildSummaryPreview, fileIsAnalyzed, getEffectiveAiMetadata, getIndexBlock, getSourceWindow, isIndexed } from "./ai-metadata.js";
import { classifyClipAudioRole } from "./audio-mix.js";
import { basename, buildTimelineClipContext, findFileData } from "./clip-context.js";
import { pyBool, pyFixed, pyFloat, pyNumber, pyRepr, pyReprString } from "./pyfmt.js";
import { buildTrackStack, layerNumberToDisplayIndex, layersSortedByNumber, trackStackJson } from "./tracks.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `float(x or 0)`. */
function fnum(value: unknown): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Python `d.get(key, 0)` printed with `:.2f`. */
function fixed2(value: unknown): string {
  return pyFixed(fnum(value), 2);
}

function layerOf(clip: Clip): number {
  const n = Math.trunc(Number(clip.layer ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function fileName(file: Record<string, unknown>): string {
  return String(file.name || basename(String(file.path ?? "")) || "");
}

// ---------------------------------------------------------------------------
// get_project_info_tool
// ---------------------------------------------------------------------------

/** `Project: profile=…, fps=…/…, duration=…, scale=…`. */
export function projectInfoText(project: Project): string {
  const profile = project.profile || "unknown";
  const fps: Record<string, unknown> = isRecord(project.fps) ? project.fps : {};
  const num = fps.num ?? "";
  const den = fps.den ?? 1;
  const duration = project.duration || 0;
  const scale = project.scale || 0;
  // `scale` is always a float in desktop projects (_default.project 15.0); `duration` starts as the int 300.
  return `Project: profile=${String(profile)}, fps=${String(num)}/${String(den)}, duration=${pyNumber(Number(duration))}, scale=${scale ? pyFloat(Number(scale)) : "0"}`;
}

// ---------------------------------------------------------------------------
// Media bin
// ---------------------------------------------------------------------------

/** Summary preview of a whole file (tool_handlers._summary_preview_for_file_data). */
export function fileSummaryPreview(file: ProjectFile | Record<string, unknown>, clip?: Record<string, unknown>): string {
  return buildSummaryPreview(getEffectiveAiMetadata(file, clip, { rebased: true }));
}

/** Visible media-bin files (subclips hidden), in project order. */
export function visibleFiles(project: Project): ProjectFile[] {
  return (project.files ?? []).filter((f) => !f.zenvi_subclip);
}

function mediaBinFields(file: ProjectFile): { name: string; dur: string; analyzed: string; indexed: string; preview: string } {
  const data = file as unknown as Record<string, unknown>;
  const ai = isRecord(data.ai_metadata) ? data.ai_metadata : {};
  return {
    name: fileName(data) || "?",
    dur: pyFixed(fnum(data.duration), 2),
    analyzed: pyBool(Boolean(ai.analyzed)),
    indexed: pyBool(isIndexed(getIndexBlock(ai))),
    preview: fileSummaryPreview(file),
  };
}

/** list_files_tool text. */
export function listFilesText(project: Project): string {
  const files = visibleFiles(project);
  if (files.length === 0) return "No files in project.";
  const lines = files.map((file) => {
    const m = mediaBinFields(file);
    return (
      `  media_bin_file_id=${file.id} name=${pyReprString(m.name)} duration=${m.dur}s ` +
      `analyzed=${m.analyzed} indexed=${m.indexed} ` +
      `summary_preview=${pyReprString(m.preview)} ` +
      `path=${basename(String(file.path ?? ""))}`
    );
  });
  return `Media bin files (${files.length}):\n` + lines.join("\n");
}

// ---------------------------------------------------------------------------
// list_clips_tool
// ---------------------------------------------------------------------------

export interface StructuredClip {
  id: string;
  file_id: string;
  title: string;
  layer: number | null;
  track: number | null;
  position: number;
  start: number;
  end: number;
}

function structuredClip(clip: Clip, layers: readonly Layer[]): StructuredClip {
  const data = clip as unknown as Record<string, unknown>;
  const lid = data.layer === "" || data.layer === null || data.layer === undefined ? null : Math.trunc(Number(data.layer));
  const layer = lid !== null && Number.isFinite(lid) ? lid : null;
  return {
    id: String(clip.id),
    file_id: String(data.file_id || ""),
    title: String(data.title || data.label || ""),
    layer,
    track: layer !== null ? layerNumberToDisplayIndex(layer, layers) : null,
    position: fnum(data.position),
    start: fnum(data.start),
    end: fnum(data.end),
  };
}

/** list_clips_tool: the legacy text lines plus the structured rows. */
export function listClipsReport(project: Project, layerFilter?: number): { text: string; clips: StructuredClip[] } | null {
  const layers = project.layers ?? [];
  const clips = (project.clips ?? []).filter((c) => layerFilter === undefined || layerOf(c) === layerFilter);
  if (clips.length === 0) return null;

  const dupes = new Map<string, Clip[]>();
  for (const c of clips) {
    const fid = String(c.file_id ?? "");
    if (fid) {
      const key = `${fid}:${String(c.layer)}`;
      dupes.set(key, [...(dupes.get(key) ?? []), c]);
    }
  }

  const lines = clips.map((c) => {
    const data = c as unknown as Record<string, unknown>;
    const lidRaw = data.layer ?? "";
    const lidNum = lidRaw === "" || lidRaw === null ? null : Math.trunc(Number(lidRaw));
    const lidInt = lidNum !== null && Number.isFinite(lidNum) ? lidNum : null;
    const ui = lidInt !== null ? layerNumberToDisplayIndex(lidInt, layers) : null;
    const uiPart = ui !== null ? ` ui_track=${ui}` : "";
    const tids = lidInt !== null ? layers.filter((L) => Math.trunc(Number(L.number || 0)) === lidInt).map((L) => String(L.id ?? "")) : [];
    const tidPart = tids.length > 0 && tids[0] ? ` track_id=${tids[0]}` : "";
    const title = String(data.title || data.label || "");
    const fid = String(data.file_id ?? "");
    let fname = "";
    let summary = "";
    let parentFileId = "";
    let role = "";
    let sourceStart: unknown = data.start ?? 0;
    let sourceEnd: unknown = data.end ?? 0;
    let timelineEnd = fnum(data.position);
    const file = fid ? findFileData(project, fid) : undefined;
    if (file) {
      fname = fileName(file as unknown as Record<string, unknown>);
      const ctx = buildTimelineClipContext(project, c, file, { layers });
      summary = ctx.summaryPreview;
      parentFileId = ctx.parentFileId;
      sourceStart = ctx.sourceStart;
      sourceEnd = ctx.sourceEnd;
      timelineEnd = ctx.timelineEnd;
      role = classifyClipAudioRole(c, file, ctx.effectiveMetadata);
    }
    const summaryPart = summary ? ` summary_preview=${pyReprString(summary)}` : "";
    let occHint = "";
    const group = dupes.get(`${fid}:${String(lidInt)}`) ?? [];
    if (group.length > 1) {
      const ranked = [...group].sort((a, b) => fnum(a.position) - fnum(b.position));
      const idx = ranked.findIndex((dc) => dc.id === c.id);
      if (idx >= 0) occHint = ` occurrence_hint=${idx + 1}`;
    }
    const parentPart = parentFileId && parentFileId !== fid ? ` parent_file_id=${parentFileId}` : "";
    const layerText = lidInt !== null ? String(lidInt) : String(lidRaw);
    return (
      `  timeline_clip_id=${c.id} media_bin_file_id=${fid}${parentPart} ` +
      `title=${pyReprString(title)} file=${pyReprString(fname)}${summaryPart}${occHint} ` +
      `layer_number=${layerText}${uiPart}${tidPart} ` +
      `position=${pyFloat(fnum(data.position))} timeline_end=${pyFixed(timelineEnd, 2)} ` +
      `source_start=${pyFloat(fnum(sourceStart))} source_end=${pyFloat(fnum(sourceEnd))}` +
      (role ? ` audio_role=${role}` : "")
    );
  });
  return {
    text: `Timeline clips (${clips.length}):\n` + lines.join("\n"),
    clips: clips.map((c) => structuredClip(c, layers)),
  };
}

// ---------------------------------------------------------------------------
// list_layers_tool / list_markers_tool
// ---------------------------------------------------------------------------

export function listLayersText(project: Project): string {
  const layers = project.layers ?? [];
  if (layers.length === 0) return "No layers in project.";
  const stack = buildTrackStack(layers);
  const lock = new Map(layers.map((L) => [Math.trunc(Number(L.number || 0)), Boolean(L.lock)]));
  const bottom = stack[0];
  const top = stack[stack.length - 1];
  const lines = [
    `Layers (${stack.length}). Z-ORDER uses layer_number only (higher covers lower). ` +
      "Track labels/names are cosmetic — they can be anything and do NOT imply priority.",
    `BOTTOM (drawn under): layer_number=${bottom?.layer_number} label=${pyReprString(bottom?.label ?? "")}`,
    `TOP (covers all below): layer_number=${top?.layer_number} label=${pyReprString(top?.label ?? "")}`,
    "Stack bottom→top:",
  ];
  for (const e of stack) {
    lines.push(
      `  layer_number=${e.layer_number} ui_track=${e.ui_track} ` +
        `z_from_bottom=${e.z_from_bottom} label=${pyReprString(e.label)} ` +
        `track_id=${pyReprString(e.track_id)} ` +
        `lock=${pyBool(lock.get(e.layer_number) ?? false)}`,
    );
  }
  lines.push(`TRACK_STACK_JSON=${trackStackJson(layers)}`);
  return lines.join("\n");
}

export function listMarkersText(project: Project): string {
  const markers = project.markers ?? [];
  if (markers.length === 0) return "No markers in project.";
  const lines = markers.map((m) => {
    const data = m as unknown as Record<string, unknown>;
    const position = data.position ?? 0;
    // Desktop marker positions are floats ((frame - 1) / fps), printed with str().
    // Desktop markers carry no label; the web's `label` (ops addMarker) shows as the name.
    const name = data.name ?? data.label ?? "";
    return `  id=${String(data.id ?? "")} position=${typeof position === "number" ? pyFloat(position) : String(position)} name=${String(name)}`;
  });
  return `Markers (${markers.length}):\n` + lines.join("\n");
}

// ---------------------------------------------------------------------------
// get_timeline_state_tool
// ---------------------------------------------------------------------------

export interface TimelineStateData {
  clips: StructuredClip[];
  tracks: { id: string; layer: number; track: number | null; label: string }[];
  effects: Transition[];
  legacy_text: string;
}

function trackHeading(layerNum: number, layers: readonly Layer[], layer?: Layer): string {
  const ui = layerNumberToDisplayIndex(layerNum, layers);
  let tid = "";
  let label = "";
  const source = layer ?? layers.find((L) => Math.trunc(Number(L.number || 0)) === layerNum);
  if (source) {
    tid = String(source.id ?? "");
    label = String(source.label || (source as { name?: unknown }).name || "").trim();
  }
  const parts = [`layer_number=${layerNum}`, `z_from_bottom=${ui !== null ? ui - 1 : "?"}`];
  if (ui !== null) parts.push(`ui_track=${ui}`);
  if (tid) parts.push(`track_id=${tid}`);
  if (label) parts.push(`label=${pyReprString(label)}`);
  return parts.join(" | ");
}

/** The get_timeline_state_tool text (desktop `lines`, also embedded in the editor snapshot). */
export function timelineStateText(project: Project): string {
  const layers = project.layers ?? [];
  const clips = project.clips ?? [];
  const effects = project.effects ?? [];
  const byLayer = new Map<number, Clip[]>();
  for (const c of clips) {
    const key = Number(c.layer ?? 0);
    byLayer.set(key, [...(byLayer.get(key) ?? []), c]);
  }

  const lines = ["=== TIMELINE STATE ==="];
  lines.push(
    "Z-ORDER: higher layer_number covers lower. " +
      "Track labels are cosmetic names only — never infer priority from the label text. " +
      "Call list_layers_tool for TRACK_STACK_JSON before multi-track placement. " +
      "Hero/foreground → highest layer_number; backgrounds → lowest.",
  );
  if (clips.length === 0 && effects.length === 0) lines.push("Timeline is empty — no clips or effects have been added yet.");

  const byPosition = (list: Clip[]): Clip[] => [...list].sort((a, b) => fnum(a.position) - fnum(b.position));
  const asc = layersSortedByNumber(layers);
  const emitted = new Set<number>();
  if (asc.length > 0) {
    for (const L of [...asc].reverse()) {
      const layerNum = Math.trunc(Number(L.number || 0));
      emitted.add(layerNum);
      lines.push(`\n${trackHeading(layerNum, layers, L)}:`);
      const layerClips = byLayer.get(layerNum) ?? [];
      if (layerClips.length === 0) {
        lines.push("  (empty)");
        continue;
      }
      for (const c of byPosition(layerClips)) {
        const data = c as unknown as Record<string, unknown>;
        let clipDur = fnum(data.end) - fnum(data.start);
        const file = findFileData(project, String(data.file_id ?? ""));
        if (clipDur <= 0 && file) {
          const [ss, se] = getSourceWindow(data, file);
          clipDur = se - ss;
        }
        const clipEnd = fnum(data.position) + clipDur;
        let fname: string = String(data.file_id ?? "?");
        let summaryPart = "";
        let analyzedPart = "";
        let sourcePart = "";
        let rolePart = "";
        if (file) {
          fname = fileName(file as unknown as Record<string, unknown>) || String(data.file_id ?? "?");
          const ctx = buildTimelineClipContext(project, c, file, { layers });
          if (ctx.summaryPreview) summaryPart = ` summary_preview=${pyReprString(ctx.summaryPreview)}`;
          sourcePart = ` source=${pyFixed(ctx.sourceStart, 1)}-${pyFixed(ctx.sourceEnd, 1)}s`;
          rolePart = ` audio_role=${classifyClipAudioRole(c, file, ctx.effectiveMetadata)}`;
          if (!fileIsAnalyzed(file)) analyzedPart = " analyzed=False";
        }
        lines.push(
          `  timeline_clip_id=${c.id} media_bin_file_id=${String(data.file_id ?? "")} ` +
            `file=${pyReprString(fname)} title=${pyReprString(String(data.title || data.label || ""))}` +
            `${summaryPart}${analyzedPart}${sourcePart}${rolePart}` +
            ` @ ${fixed2(data.position)}s–${pyFixed(clipEnd, 2)}s (dur=${pyFixed(clipDur, 2)}s)`,
        );
      }
    }
  } else {
    lines.push("\n(No layers/tracks in project.)");
  }

  for (const layerNum of [...byLayer.keys()].sort((a, b) => b - a)) {
    if (emitted.has(Math.trunc(layerNum))) continue;
    lines.push(`\n${trackHeading(layerNum, layers)}:`);
    for (const c of byPosition(byLayer.get(layerNum)!)) {
      const data = c as unknown as Record<string, unknown>;
      const clipDur = fnum(data.end) - fnum(data.start);
      const clipEnd = fnum(data.position) + clipDur;
      lines.push(
        `  timeline_clip_id=${c.id} media_bin_file_id=${String(data.file_id ?? "")} ` +
          `file=${pyReprString(String(data.file_id ?? ""))} title=${pyReprString(String(data.title || data.label || ""))}` +
          ` @ ${fixed2(data.position)}s–${pyFixed(clipEnd, 2)}s (dur=${pyFixed(clipDur, 2)}s)`,
      );
    }
  }

  if (effects.length > 0) {
    lines.push(`\nEffects/Transitions (${effects.length}):`);
    for (const e of effects) {
      const data = e as unknown as Record<string, unknown>;
      const title = "title" in data ? data.title : "?";
      const layer = data.layer ?? "";
      lines.push(
        `  id=${String(data.id ?? "")} title=${pyRepr(title)}` +
          ` layer=${typeof layer === "number" ? pyNumber(layer) : String(layer)} @ ${fixed2(data.position)}s end=${fixed2(data.end)}s`,
      );
    }
  }

  if (clips.length === 0) {
    lines.push("\nTotal timeline duration: 0.00s");
  } else {
    const ends = clips.map((c) => Number(c.position ?? 0) + (Number(c.end ?? 0) - Number(c.start ?? 0)));
    lines.push(`\nTotal timeline duration: ${pyFixed(Math.max(...ends), 2)}s`);
  }
  lines.push(`\nTRACK_STACK_JSON=${trackStackJson(layers)}`);
  return lines.join("\n");
}

/** The get_timeline_state_tool receipt data. */
export function timelineStateData(project: Project): TimelineStateData {
  const layers = project.layers ?? [];
  return {
    clips: (project.clips ?? []).map((c) => {
      const row = structuredClip(c, layers);
      return { ...row, layer: row.layer ?? 0, track: layerNumberToDisplayIndex(row.layer ?? 0, layers) };
    }),
    tracks: layersSortedByNumber(layers).map((L) => {
      const layerNum = Math.trunc(Number(L.number || 0));
      return {
        id: String(L.id ?? ""),
        layer: layerNum,
        track: layerNumberToDisplayIndex(layerNum, layers),
        label: String(L.label || (L as { name?: unknown }).name || ""),
      };
    }),
    effects: [...(project.effects ?? [])],
    legacy_text: timelineStateText(project),
  };
}

// ---------------------------------------------------------------------------
// Editor snapshot for chat (build_editor_snapshot_for_chat)
// ---------------------------------------------------------------------------

export interface EditorSnapshotOptions {
  /** Default 5500, like the desktop. */
  maxChars?: number;
}

/**
 * The `[Editor snapshot] … [/Editor snapshot]` block the desktop appends to
 * every Assistant user message: media bin (up to 20 visible files) plus the
 * get_timeline_state_tool text, truncated to `maxChars`.
 */
export function buildEditorSnapshot(project: Project, options: EditorSnapshotOptions = {}): string {
  const maxChars = options.maxChars ?? 5500;
  const mediaLines = visibleFiles(project).map((file) => {
    const m = mediaBinFields(file);
    return (
      `  media_bin_file_id=${file.id} name=${pyReprString(m.name)} duration=${m.dur}s ` +
      `analyzed=${m.analyzed} indexed=${m.indexed} ` +
      `summary_preview=${pyReprString(m.preview)}`
    );
  });
  const visible = mediaLines.length;
  let head =
    "[Editor snapshot]\n" +
    `Project files count: ${visible}\n` +
    "NOTE: media-bin files exist independently of the timeline; " +
    "an empty timeline does NOT mean no project files.\n";
  if (mediaLines.length > 0) {
    const shown = mediaLines.slice(0, 20);
    head += "MEDIA_BIN:\n" + shown.join("\n");
    if (visible > shown.length) {
      head += `\n  ... and ${visible - shown.length} more (use list_files_tool / get_clips_with_full_metadata_tool)\n`;
    } else {
      head += "\n";
    }
  } else {
    head += "MEDIA_BIN: (empty)\n";
  }
  const body = timelineStateText(project).trim();
  let out = body ? `${head}TIMELINE:\n${body}\n` : `${head}TIMELINE: (empty or unavailable)\n`;
  // Python measures and slices by code point.
  const chars = Array.from(out);
  if (chars.length > maxChars) {
    out = chars.slice(0, Math.max(0, maxChars - 24)).join("").trimEnd() + "\n... (truncated)\n";
  }
  return out + "[/Editor snapshot]\n";
}
