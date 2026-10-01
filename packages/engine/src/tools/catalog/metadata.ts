/**
 * Planning metadata tools: get_clips_with_full_metadata_tool,
 * get_timeline_placements_metadata_tool, get_timeline_state_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * get_clips_with_full_metadata, get_timeline_placements_metadata,
 * get_timeline_state (text in ../reports.ts).
 */

import type { Project } from "../../model/types.js";
import { inferSearchHint, isIndexed } from "../ai-metadata.js";
import { enumerateTimelineContexts, resolveParentFileId } from "../clip-context.js";
import { contractTool, type CatalogTool } from "../define.js";
import { pyFixed, pyReprString, pySlice } from "../pyfmt.js";
import { applied } from "../receipt.js";
import { timelineStateData } from "../reports.js";
import { fmtMmss, record, text } from "./common.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python `str(value)` for metadata flags. */
function pyStr(value: unknown): string {
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  return String(value);
}

/** get_clips_with_full_metadata's text. */
export function fullMetadataText(project: Project, level: string): string {
  const files = project.files ?? [];
  if (files.length === 0) return "No files in project.";
  const lines = ["Project files with full metadata:"];
  for (const f of files) {
    const d = f as unknown as Record<string, unknown>;
    if (d.zenvi_subclip && level !== "full") continue;
    const dur = Math.trunc(Number(d.duration) || 0);
    const m = Math.floor(dur / 60);
    const s = ((dur % 60) + 60) % 60;
    const name = String(d.name || String(d.path ?? "?").split("/").pop());
    const ai = record(d.ai_metadata);
    const tl = record(ai.twelvelabs);
    const short = pySlice(String(ai.short_summary || ""), 0, 160);
    const desc = pySlice(String(ai.description || ""), 0, 400);
    const sounds = pySlice(String(ai.sounds || ""), 0, 160);
    const transcript = pySlice(String(ai.transcript || ""), 0, 200);
    const parentId = resolveParentFileId(project, d, String(f.id || ""));
    const alias = d.zenvi_subclip && parentId && parentId !== String(f.id) ? `  alias_of=${parentId}\n` : "";
    const chapters = Array.isArray(ai.chapters) ? ai.chapters : [];
    const scenes = Array.isArray(ai.scene_descriptions) ? ai.scene_descriptions : [];
    lines.push(
      `\n  media_bin_file_id=${String(f.id)}  name=${name}  type=${pyStr(d.media_type ?? "?")}  ` +
        `duration=${m}:${String(s).padStart(2, "0")}\n` +
        alias +
        `    analyzed=${pyStr(ai.analyzed ?? false)}  indexed=${pyStr(isIndexed(tl))}  ` +
        `chapter_count=${chapters.length}  scene_count=${scenes.length}\n` +
        `    tl_search_hint=${inferSearchHint(ai, name)}\n` +
        `    twelvelabs_index_id=${pyStr(tl.index_id ?? "")}\n` +
        `    twelvelabs_index_name=${pyStr(tl.index_name ?? "")}\n` +
        `    twelvelabs_video_id=${pyStr(tl.video_id ?? "")}\n` +
        `    short_summary=${short}\n` +
        `    description=${desc}`,
    );
    if (!short && !desc) {
      const tags = record(ai.tags);
      const legacy: string[] = [];
      for (const key of ["objects", "scenes", "activities", "mood"]) {
        const vals = tags[key];
        if (Array.isArray(vals) && vals.length > 0) legacy.push(`${key}=[${vals.slice(0, 8).filter(Boolean).map(String).join(", ")}]`);
      }
      if (legacy.length > 0) lines.push(`    legacy_tags=${legacy.join(" ")}`);
      else if (sounds || transcript) {
        if (sounds) lines.push(`    sounds=${sounds}`);
        if (transcript) lines.push(`    transcript=${transcript}`);
      }
    }
    if (level === "full") {
      if (sounds) lines.push(`    sounds=${sounds}`);
      if (transcript) lines.push(`    transcript=${transcript}`);
    }
    if (chapters.length > 0) {
      const n = level === "full" ? chapters.length : Math.min(3, chapters.length);
      lines.push("    chapter_snippets:");
      for (const raw of chapters.slice(0, n)) {
        if (!isRecord(raw) || !(raw.summary || raw.title)) continue;
        const t0 = Number(raw.start) || 0;
        const t1 = Number(raw.end) || t0;
        lines.push(`      [${fmtMmss(t0)}-${fmtMmss(t1)}] ${String(raw.title ?? "")}: ${pySlice(String(raw.summary ?? ""), 0, 160)}`);
      }
    }
    if (scenes.length > 0 && chapters.length === 0) {
      const n = level === "full" ? scenes.length : Math.min(3, scenes.length);
      lines.push("    scene_snippets:");
      for (const raw of scenes.slice(0, n)) {
        if (!isRecord(raw) || !raw.description) continue;
        lines.push(`      [${fmtMmss(Number(raw.time) || 0)}] ${pySlice(String(raw.description), 0, 160)}`);
      }
    }
  }
  return lines.join("\n");
}

/** get_timeline_placements_metadata's text. */
export function placementsMetadataText(project: Project, level: string): string {
  const contexts = enumerateTimelineContexts(project);
  if (contexts.length === 0) return "No clips on timeline.";
  const groups = new Map<string, typeof contexts>();
  for (const ctx of contexts) {
    const key = `${ctx.fileId}:${pyStr(ctx.layer)}`;
    groups.set(key, [...(groups.get(key) ?? []), ctx]);
  }
  const lines = [`Timeline placements (${contexts.length}):`];
  const sorted = contexts
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.layer ?? 0) - (b.c.layer ?? 0) || a.c.timelinePosition - b.c.timelinePosition || a.i - b.i)
    .map(({ c }) => c);
  for (const ctx of sorted) {
    const key = `${ctx.fileId}:${pyStr(ctx.layer)}`;
    const dupes = groups.get(key) ?? [];
    let occ = "";
    if (dupes.length > 1) {
      const ranked = [...dupes].sort((a, b) => a.timelinePosition - b.timelinePosition);
      const idx = ranked.findIndex((dc) => dc.timelineClipId === ctx.timelineClipId);
      if (idx >= 0) occ = ` occurrence_hint=${idx + 1}`;
    }
    const groupId = dupes.length > 1 ? key : "";
    const scenes = Array.isArray(ctx.effectiveMetadata.scene_descriptions) ? ctx.effectiveMetadata.scene_descriptions : [];
    const limit = level === "full" ? scenes.length : Math.min(3, scenes.length);
    lines.push(
      `\n  timeline_clip_id=${ctx.timelineClipId} file_id=${ctx.fileId} ` +
        `parent_file_id=${ctx.parentFileId}${occ}\n` +
        `    title=${pyReprString(ctx.title)} track=${pyStr(ctx.layer)} ui_track=${pyStr(ctx.uiTrack)} ` +
        `position=${pyFixed(ctx.timelinePosition, 2)}s timeline_end=${pyFixed(ctx.timelineEnd, 2)}s\n` +
        `    source_window=${pyFixed(ctx.sourceStart, 2)}-${pyFixed(ctx.sourceEnd, 2)}s ` +
        `index_status=${pyReprString(ctx.indexStatus)} duplicate_group=${pyReprString(groupId)}\n` +
        `    summary_preview=${pyReprString(ctx.summaryPreview)}`,
    );
    if (scenes.length > 0 && limit > 0) {
      lines.push("    effective_scenes:");
      for (const raw of scenes.slice(0, limit)) {
        if (!isRecord(raw) || !raw.description) continue;
        lines.push(`      [${fmtMmss(Number(raw.time) || 0)}] ${pySlice(String(raw.description), 0, 160)}`);
      }
    }
  }
  return lines.join("\n");
}

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

export const metadataTools: CatalogTool[] = [
  contractTool("get_clips_with_full_metadata_tool", {
    annotations: READ,
    run: (call, input) => {
      return fullMetadataText(call.doc.project, (text(input.detail_level) || "summary").toLowerCase());
    },
  }),

  contractTool("get_timeline_placements_metadata_tool", {
    annotations: READ,
    run: (call, input) => {
      return placementsMetadataText(call.doc.project, (text(input.detail_level) || "summary").toLowerCase());
    },
  }),

  contractTool("get_timeline_state_tool", {
    annotations: READ,
    run: (call) => {
      const data = timelineStateData(call.doc.project);
      return applied("get_timeline_state_tool", `Timeline: ${data.clips.length} clip(s), ${data.tracks.length} track(s).`, { data }, 0);
    },
  }),
];

