/**
 * Motion-graphics tools: propose_overlay_windows_tool,
 * place_motion_graphic_tool, fetch_motion_graphics_video_tool (and its
 * deprecated alias fetch_remotion_video_from_supabase_tool),
 * suggest_motion_graphics_placements_tool (removed on the desktop).
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/tool_handlers.py
 * propose_overlay_windows / _overlay_index_boosts / place_motion_graphic /
 * fetch_motion_graphics_video / suggest_motion_graphics_placements and
 * src/classes/mg_placement.py.
 *
 * Differences: the desktop probes downloads with ffprobe for real alpha and
 * asks its local HyperFrames service (HYPERFRAMES_URL) for job metadata and
 * storage cleanup. Neither exists here, so transparency comes from the job
 * hint or the file type (WebM renders are HyperFrames' transparent output),
 * and cleanup is left to the render service's retention.
 */

import type { ProjectDocument } from "../../history/document.js";
import type { Project, ProjectFile } from "../../model/types.js";
import { moveClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { collectProjectIndex, isIndexingConfigured, mapSearchHitToFile, searchIndex } from "../backend.js";
import { enumerateTimelineContexts, type TimelineClipContext } from "../clip-context.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { placementWatchQuery } from "../placement.js";
import { pyFixed, pyRepr } from "../pyfmt.js";
import { applied } from "../receipt.js";
import { formatTrackLabelForLlm, normalizeTrackOrLayerArg } from "../tracks.js";
import type { ImportedMedia } from "../types.js";
import { applyPlacement, placementText, planPlacement } from "./clips.js";
import { fileById, record, text } from "./common.js";

// ---------------------------------------------------------------------------
// mg_placement.py
// ---------------------------------------------------------------------------

const AVOID_RE = /\b(close[- ]?up|closeup|face|faces|talking[- ]?head|portrait|hero action|fight|impact|explosion|interview|dialogue)\b/i;
const PREFER_RE = /\b(wide|establishing|b[- ]?roll|landscape|exterior|insert|cutaway|empty|drone|aerial|crowd wide|skyline|cityscape)\b/i;
export const AVOID_QUERY = "close-up face talking head portrait interview dialogue";
export const PREFER_QUERY = "wide establishing b-roll landscape exterior cutaway";

function tokenize(textValue: string): Set<string> {
  return new Set((String(textValue ?? "").match(/[a-z0-9]+/gi) ?? []).filter((t) => t.length > 2).map((t) => t.toLowerCase()));
}

function lexicalSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

/** [score, avoid, prefer] for a scene text (score_scene_blob). */
export function scoreSceneBlob(blob: string): [number, boolean, boolean] {
  const t = blob || "";
  let avoid = AVOID_RE.test(t);
  let prefer = PREFER_RE.test(t);
  let score = 0;
  if (prefer) score += 3;
  if (avoid) score -= 4;
  if (lexicalSimilarity(t, PREFER_QUERY) >= 0.12) {
    score += 2;
    prefer = true;
  }
  if (lexicalSimilarity(t, AVOID_QUERY) >= 0.12) {
    score -= 3;
    avoid = true;
  }
  return [score, avoid, prefer];
}

/** HTML layout region for a placement (layout_region_for). */
export function layoutRegionFor(avoid: boolean, prefer: boolean, isGap: boolean, score: number): string {
  if (isGap) return "mid_plate";
  if (avoid && !prefer) return "lower_third";
  if (avoid && prefer) return "corner_br";
  if (prefer && score >= 2) return "full_frame";
  if (prefer) return "corner_tr";
  return "lower_third";
}

/** True when any clip on `layer` overlaps [t0, t1) (primary_track_overlaps). */
export function primaryTrackOverlaps(project: Project, layer: number, t0: number, t1: number): boolean {
  return (project.clips ?? []).some((c) => {
    if (Math.trunc(Number(c.layer ?? -1)) !== layer) return false;
    const pos = Number(c.position) || 0;
    const dur = Math.max(0, (Number(c.end ?? c.start) || 0) - (Number(c.start) || 0));
    return pos < t1 && pos + dur > t0;
  });
}

/** [clip id, new position] for clips on `layer` at/after t, rightmost first (ripple_positions). */
export function ripplePositions(project: Project, layer: number, t: number, delta: number): [string, number][] {
  const out: [string, number][] = [];
  for (const c of project.clips ?? []) {
    if (Math.trunc(Number(c.layer ?? -1)) !== layer || !c.id) continue;
    const pos = Number(c.position) || 0;
    if (pos + 1e-6 >= t) out.push([String(c.id), pos + delta]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

/** HyperFrames transparent overlay detection from metadata/tags (file_looks_transparent). */
export function fileLooksTransparent(file: unknown): boolean {
  const data = record(file);
  const ai = record(data.ai_metadata);
  if (ai.transparent === true) return true;
  if (["true", "1", "yes"].includes(String(ai.transparent ?? "").toLowerCase())) return true;
  let tags = data.tags ?? ai.tags ?? [];
  if (typeof tags === "string") tags = [tags];
  return Array.isArray(tags) && tags.some((t) => String(t).toLowerCase().includes("transparent"));
}

interface Window {
  t: number;
  score: number;
  avoid: boolean;
  prefer: boolean;
  label: string;
}

function applyTimeBoosts(windows: Window[], boosts: readonly { t: number; delta: number; avoid: boolean; prefer: boolean }[], radius = 1.5): void {
  for (const w of windows) {
    for (const b of boosts) {
      if (Math.abs(w.t - b.t) <= radius) {
        w.score += b.delta;
        if (b.avoid) w.avoid = true;
        if (b.prefer) w.prefer = true;
      }
    }
  }
}

/** Index search boosts mapped onto timeline times (_overlay_index_boosts). */
async function overlayIndexBoosts(call: ToolCall, contexts: readonly TimelineClipContext[]) {
  const boosts: { t: number; delta: number; avoid: boolean; prefer: boolean }[] = [];
  const info = collectProjectIndex(call.doc.project);
  if (!info.indexId || !call.host.backend || !(await isIndexingConfigured(call))) return boosts;
  const byFile = new Map<string, TimelineClipContext[]>();
  for (const ctx of contexts) {
    for (const key of new Set([ctx.fileId, ctx.parentFileId])) {
      if (key) byFile.set(key, [...(byFile.get(key) ?? []), ctx]);
    }
  }
  for (const [query, delta, isAvoid, isPrefer] of [[AVOID_QUERY, -3, true, false], [PREFER_QUERY, 3, false, true]] as const) {
    const res = await searchIndex(call, query, { topK: 12, indexId: info.indexId, pageLimit: 24 });
    if (res.error) continue;
    for (const hit of res.results) {
      const [fid] = mapSearchHitToFile(hit, info.videoMap);
      const start = Number(hit.start);
      if (!fid || !byFile.has(fid) || !Number.isFinite(start)) continue;
      for (const ctx of byFile.get(fid)!) {
        const pos = ctx.timelinePosition;
        const clipDur = Math.max(0.1, (ctx.timelineEnd || pos + 1) - pos);
        const local = start - ctx.sourceStart;
        if (local >= 0 && local <= clipDur) boosts.push({ t: pos + local, delta, avoid: isAvoid, prefer: isPrefer });
      }
    }
  }
  return boosts;
}

// ---------------------------------------------------------------------------
// fetch_motion_graphics_video
// ---------------------------------------------------------------------------

const importedUrls = new WeakMap<ProjectDocument, Map<string, string>>();
const GENERIC_LABELS = ["hyperframes motion graphic", "motion graphic", "motion"];

function normUrl(url: string): string {
  return url.trim().split("?")[0]!.replace(/\/+$/, "");
}

function isGeneric(label: string): boolean {
  return GENERIC_LABELS.includes(label.trim().toLowerCase());
}

function segmentIndex(url: string): number {
  const name = url.split("?")[0]!.split("/").pop() ?? "";
  const m = /segment[_-]?(\d+)/i.exec(name);
  return m ? Number.parseInt(m[1]!, 10) : 1_000_000;
}

function mgFileName(url: string): string {
  const path = url.split("?")[0]!.replace(/\/+$/, "");
  let raw = decodeURIComponent(path.split("/").pop() || "motion_segment.mp4");
  const dot = raw.lastIndexOf(".");
  const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : "";
  if (![".mp4", ".webm", ".mov", ".mkv", ".avi"].includes(ext)) {
    raw = `${(dot >= 0 ? raw.slice(0, dot) : raw) || "motion_segment"}${path.toLowerCase().endsWith(".webm") || path.toLowerCase().includes("/output.webm") ? ".webm" : ".mp4"}`;
  }
  return raw;
}

/** The desktop's _stamp_motion_graphics_file_metadata as a file patch. */
function mgStamp(label: string, transparent: boolean, existing: Partial<ProjectFile> = {}): Partial<ProjectFile> {
  let summary = label.trim() || "HyperFrames motion graphic";
  const tagsRaw = existing.tags;
  const tags = typeof tagsRaw === "string" ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
  if (!tags.includes("motion_graphics")) tags.push("motion_graphics");
  if (transparent && !tags.includes("transparent_overlay")) tags.push("transparent_overlay");
  const ai = { ...record(existing.ai_metadata), short_summary: summary, description: summary, analyzed: true, source: "hyperframes_motion_graphics", transparent };
  const patch: Partial<ProjectFile> = { tags: tags.join(", "), ai_metadata: ai };
  if (summary !== "HyperFrames motion graphic") {
    const short = summary.split("(")[0]!.trim();
    if (short && Array.from(short).length <= 120) patch.name = Array.from(short).slice(0, 120).join("");
  } else if (!existing.name) {
    patch.name = "HyperFrames motion graphic";
    summary = "HyperFrames motion graphic";
  }
  return patch;
}

async function fetchMotionGraphics(call: ToolCall, input: Record<string, unknown>) {
  const tool = call.tool;
  const importUrl = call.host.media?.importUrl;
  if (!importUrl) return unavailable(tool, "it cannot download media from URLs.");
  let label = text(input.label) || "HyperFrames motion graphic";
  const generic = isGeneric(label);
  const genericWarn = generic
    ? " ⚠️ short_summary is generic — pass label= from compose suggested_label (or ensure render_job_id is set so job.summary can be recovered)."
    : "";
  let segs: string[] = [];
  const raw = input.segment_urls;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      segs = Array.isArray(parsed) ? parsed.map(String) : [raw];
    } catch {
      segs = [raw];
    }
  } else if (Array.isArray(raw)) segs = raw.map(String);
  segs = segs.map((u) => u.trim()).filter(Boolean);

  let cache = importedUrls.get(call.doc);
  if (!cache) {
    cache = new Map();
    importedUrls.set(call.doc, cache);
  }
  const alreadyImported = (urls: readonly string[]): string | null => {
    const ids = urls.map((u) => cache!.get(normUrl(u)) ?? "");
    if (ids.length === 0 || ids.some((id) => !id || !fileById(call.doc.project, id))) return null;
    return `Already imported file_id=${ids[0]} (file_ids: ${pyRepr(ids)}) — place only if missing. Do NOT re-download these URLs.`;
  };

  const single = text(input.supabase_url) || text(input.url);
  const urls = segs.length > 0 ? [...segs].map((u, i) => ({ u, i })).sort((a, b) => segmentIndex(a.u) - segmentIndex(b.u) || a.i - b.i).map((x) => x.u) : single ? [single] : [];
  if (urls.length === 0) return "Error: segment_urls or supabase_url is required.";
  const cached = alreadyImported(urls);
  if (cached) return cached;

  const downloads: { url: string; media: ImportedMedia; transparent: boolean }[] = [];
  const failures: [number, string, string][] = [];
  for (const [i, url] of urls.entries()) {
    let media: ImportedMedia | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 2 && !media; attempt += 1) {
      try {
        media = await importUrl.call(call.host.media, url, { filename: mgFileName(url), signal: call.signal });
      } catch (error) {
        lastErr = error instanceof Error ? error.message : String(error);
      }
    }
    if (!media) failures.push([i, url, `download failed: ${lastErr}`]);
    else downloads.push({ url, media, transparent: /\.webm$/i.test(url.split("?")[0]!) });
  }
  if (downloads.length === 0) {
    const [, , err] = failures[0]!;
    return `Error importing video: ${err}${genericWarn}`;
  }
  const files = call.commit((tx) =>
    downloads.map((d) => {
      const file = addFile(tx, d.media, { dedupe: true });
      tx.update(["files", { id: file.id }], mgStamp(label, d.transparent, file));
      return file;
    }),
  );
  downloads.forEach((d, i) => cache!.set(normUrl(d.url), String(files[i]!.id)));
  const ids = files.map((f) => String(f.id));
  const totalMb = downloads.reduce((sum, d) => sum + (Number(d.media.fingerprint?.size ?? d.media.info.file_size ?? 0) || 0), 0) / (1024 * 1024);
  const anyTransparent = downloads.some((d) => d.transparent);
  const alphaNote = anyTransparent
    ? "Transparent WebM alpha preserved — place as overlay on a HIGHER track than footage."
    : "Opaque MP4 — prefer standalone/mid-layer placement away from hero peaks.";
  label = label || "HyperFrames motion graphic";
  if (failures.length > 0) {
    const failed = failures.map(([i, u, e]) => `  [${i}] ${u} (${e})`).join("\n");
    return `⚠️ Imported ${ids.length}/${urls.length} motion segments; ${failures.length} failed. Storage was NOT cleaned up so you can retry the failed ones. file_ids: ${pyRepr(ids)}\nFailed segments:\n${failed}${genericWarn}`;
  }
  if (segs.length > 0) {
    return (
      `✅ Imported ${ids.length}/${urls.length} HyperFrames segments as separate clips ` +
      `(file_id=${ids[0]}, file_ids: ${pyRepr(ids)}, total ${pyFixed(totalMb, 1)} MB). ` +
      `Indexing skipped (motion_graphics tag). transparent_ok=${anyTransparent ? "true" : "false"} pix_fmt=unknown. ${alphaNote}\n` +
      "MUST call place_motion_graphic_tool(file_id=..., mode=overlay|gap|cut_in) " +
      "for each file_id (transparent → mode=overlay high track; opaque → mode=gap or cut_in). " +
      `Do not use add_clip_to_timeline_tool for MG renders.${genericWarn}`
    );
  }
  return (
    `✅ HyperFrames motion graphic imported into project files (file_id=${ids[0]}, size: ${pyFixed(totalMb, 1)} MB). ` +
    `Indexing skipped (motion_graphics tag). transparent_ok=${anyTransparent ? "true" : "false"} pix_fmt=unknown. ${alphaNote}\n` +
    "MUST call place_motion_graphic_tool(file_id=..., mode=overlay|gap|cut_in) with the placement mode above. " +
    `Do not use add_clip_to_timeline_tool for MG renders.${genericWarn}`
  );
}

const IMPORT_WEB = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

export const motionTools: CatalogTool[] = [
  contractTool("suggest_motion_graphics_placements_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    deprecated: true,
    run: () =>
      "Error: suggest_motion_graphics_placements_tool is removed. " +
      "Call propose_overlay_windows_tool(beat_count=...) for timing/layout_region, " +
      "edit session/draft.html (lint optional), publish_session_draft_tool, " +
      "fetch_motion_graphics_video_tool, then place_motion_graphic_tool(mode=overlay|gap|cut_in). " +
      "Never put the creative brief into on-screen title text.",
  }),

  contractTool("propose_overlay_windows_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (call, input) => {
      const nRaw = Number(text(input.beat_count) || text(input.limit) || "4");
      const n = Math.max(1, Math.min(8, Number.isFinite(nRaw) ? Math.trunc(nRaw) : 4));
      const preferTr = !["false", "0", "no"].includes(String(input.prefer_transparent ?? "true").trim().toLowerCase());
      const project = call.doc.project;
      const contexts = enumerateTimelineContexts(project);
      let overlayLayer = 3000000;
      let midLayer = 2000000;
      const nums = (project.layers ?? []).map((L) => Math.trunc(Number(L.number ?? 0))).sort((a, b) => a - b);
      if (nums.length > 0) {
        overlayLayer = nums[nums.length - 1]! < 9000000 ? nums[nums.length - 1]! + 1000000 : nums[nums.length - 1]!;
        midLayer = nums.length > 1 ? nums[Math.floor(nums.length / 2)]! : nums[0]!;
      }
      const segments: { position: number; end: number }[] = [];
      const windows: Window[] = [];
      let timelineEnd = 0;
      for (const ctx of contexts) {
        const pos = ctx.timelinePosition || 0;
        const end = ctx.timelineEnd || pos + 1;
        timelineEnd = Math.max(timelineEnd, end);
        const ai = ctx.effectiveMetadata ?? {};
        const srcStart = ctx.sourceStart || 0;
        const clipDur = Math.max(0.1, end - pos);
        const bits = [ctx.summaryPreview, String(ai.short_summary ?? ""), String(ai.description ?? "")];
        for (const ch of Array.isArray(ai.chapters) ? ai.chapters : []) {
          const c = record(ch);
          bits.push(String(c.title ?? ""), String(c.summary ?? ""));
          const cs = Number(c.start);
          if (c.start !== undefined && c.start !== null && Number.isFinite(cs)) {
            const local = cs - srcStart;
            if (local >= 0 && local <= clipDur) {
              const [sc, avoid, prefer] = scoreSceneBlob(`${String(c.title ?? "")} ${String(c.summary ?? "")}`);
              windows.push({ t: pos + local, score: sc, avoid, prefer, label: Array.from(String(c.title || c.summary || "")).slice(0, 80).join("") });
            }
          }
        }
        for (const scn of Array.isArray(ai.scene_descriptions) ? ai.scene_descriptions : []) {
          const s = record(scn);
          const desc = String(s.description ?? "");
          bits.push(desc);
          const st = s.time ?? s.start;
          const stn = Number(st);
          if (st !== undefined && st !== null && Number.isFinite(stn)) {
            const local = stn - srcStart;
            if (local >= 0 && local <= clipDur) {
              const [sc, avoid, prefer] = scoreSceneBlob(desc);
              windows.push({ t: pos + local, score: sc + 1, avoid, prefer, label: Array.from(desc).slice(0, 80).join("") });
            }
          }
        }
        const blob = bits.join(" ");
        const [sc, avoid, prefer] = scoreSceneBlob(blob);
        segments.push({ position: pos, end });
        for (const frac of [0.08, 0.5, 0.88]) {
          windows.push({ t: pos + clipDur * frac, score: sc, avoid, prefer, label: Array.from(ctx.title || blob).slice(0, 80).join("") });
        }
      }
      applyTimeBoosts(windows, await overlayIndexBoosts(call, contexts));
      const theme = text(input.query);
      if (theme) {
        const themeTokens = tokenize(theme);
        for (const w of windows) if ([...tokenize(w.label)].some((t) => themeTokens.has(t))) w.score += 2;
      }
      segments.sort((a, b) => a.position - b.position);
      const gaps: number[] = [];
      if (segments.length > 0) {
        if (segments[0]!.position > 0.4) gaps.push(Math.max(0, segments[0]!.position * 0.15));
        for (let i = 0; i + 1 < segments.length; i += 1) {
          const a = segments[i]!;
          const b = segments[i + 1]!;
          if (b.position - a.end >= 0.4) {
            gaps.push((a.end + b.position) / 2);
            windows.push({ t: a.end - 0.15, score: 2, avoid: false, prefer: true, label: "near cut" });
          }
        }
      } else {
        timelineEnd = 24;
        for (const t of [0, 6, 12, 18, 22]) windows.push({ t, score: 1, avoid: false, prefer: true, label: "" });
      }
      if (timelineEnd <= 0) timelineEnd = 24;
      const anchors = n === 1 ? [timelineEnd < 1 ? 0 : Math.min(1, timelineEnd * 0.1)] : Array.from({ length: n }, (_, i) => timelineEnd * (i / (n - 1)));
      const used: number[] = [];
      const snapTo = (target: number): [number, string, string, boolean, boolean, number] => {
        const tt = Math.max(0, Math.min(timelineEnd, target));
        const cands = [...windows].sort((a, b) => Math.abs(a.t - tt) - Math.abs(b.t - tt) || b.score - a.score);
        for (const w of cands) {
          const t = Math.max(0, Math.min(timelineEnd, w.t));
          if (preferTr && w.avoid && w.score < 0) continue;
          if (used.every((u) => Math.abs(t - u) >= 1.2)) {
            const conf = w.prefer || w.score >= 2 ? "high" : w.avoid ? "low" : "medium";
            return [t, w.label, conf, w.avoid, w.prefer, Math.trunc(w.score)];
          }
        }
        return [tt, "", "medium", false, false, 0];
      };
      const out: Record<string, unknown>[] = [];
      for (let i = 0; i < n; i += 1) {
        const useGap = !preferTr || (i === Math.max(1, Math.floor(n / 2)) && gaps.length > 0);
        let pos: number | null = null;
        let label = "";
        let conf = "medium";
        let avoid = false;
        let prefer = false;
        let score = 0;
        let trackHint = overlayLayer;
        let isGap = false;
        if (useGap && gaps.length > 0) {
          for (const g0 of gaps) {
            const g = Math.max(0, Math.min(timelineEnd, g0));
            if (used.every((u) => Math.abs(g - u) >= 1.0)) {
              pos = g;
              label = "gap — opaque plate candidate";
              conf = "high";
              trackHint = midLayer;
              isGap = true;
              prefer = true;
              break;
            }
          }
        }
        if (pos === null) {
          [pos, label, conf, avoid, prefer, score] = snapTo(anchors[i]!);
          trackHint = overlayLayer;
          isGap = false;
        }
        pos = Math.round(Math.max(0, Math.min(timelineEnd, pos)) * 100) / 100;
        used.push(pos);
        const suggestTr = preferTr && trackHint === overlayLayer && !isGap;
        out.push({
          t: pos,
          score,
          avoid,
          prefer,
          scene_label: Array.from(label).slice(0, 80).join(""),
          track_hint: trackHint,
          confidence: conf,
          suggest_transparent: suggestTr,
          layout_region: layoutRegionFor(avoid, prefer, isGap, score),
          place_mode: isGap ? "gap" : suggestTr ? "overlay" : "cut_in",
        });
      }
      const payload = {
        timeline_end: Math.round(timelineEnd * 100) / 100,
        clip_count: segments.length,
        windows: out,
        guidance:
          "For each beat: decide transparent vs opaque first. " +
          "layout_region → bake into session/draft.html " +
          "(lower_third/corner_* = non-blocking overlay HTML; full_frame = sting; " +
          "mid_plate = opaque plate). " +
          "publish_session_draft_tool(transparent=true|false) matching suggest_transparent. " +
          "Then place_motion_graphic_tool(mode=overlay|gap|cut_in) — never stack opaque " +
          "plates over hero footage with add_clip on the top overlay track.",
      };
      return applied("propose_overlay_windows_tool", JSON.stringify(payload, null, 2), { data: payload }, 0);
    },
  }),

  contractTool("place_motion_graphic_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, input) => {
      let fid = text(input.file_id);
      let pending: ImportedMedia | null = null;
      if (!fid && text(input.url)) {
        const importUrl = call.host.media?.importUrl;
        if (!importUrl) return unavailable("place_motion_graphic_tool", "it cannot download media from URLs (url=…); pass file_id.");
        try {
          pending = await importUrl.call(call.host.media, text(input.url), { filename: mgFileName(text(input.url)), signal: call.signal });
        } catch (error) {
          return `Error importing video: download failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      if (!fid && !pending) return "Error: file_id is required for place_motion_graphic_tool";
      const project = call.doc.project;
      let file: ProjectFile | undefined = fid ? fileById(project, fid) : undefined;
      if (fid && !file) return `Error: File not found for id=${fid}.`;
      if (pending) {
        const existing = project.files.find((f) => f.path === pending!.path);
        if (existing) {
          file = existing;
          fid = String(existing.id);
          pending = null;
        } else {
          const transparent = /\.webm$/i.test(text(input.url).split("?")[0]!);
          file = { ...pending.info, path: pending.path, id: "", media_type: "video", ...mgStamp("", transparent) } as ProjectFile;
        }
      }
      const fileData = file!;
      const isTransparent = fileLooksTransparent(fileData);
      const mode = String(input.mode ?? "overlay").trim().toLowerCase() || "overlay";
      if (!["overlay", "gap", "cut_in"].includes(mode)) return "Error: mode must be overlay|gap|cut_in";
      const tRaw = text(input.position_seconds) || "0";
      const tNum = Number(tRaw);
      if (!Number.isFinite(tNum)) return "Error: position_seconds must be a number";
      const t = Math.max(0, tNum);
      let dur = Number(text(input.duration_seconds) || "0");
      if (!Number.isFinite(dur)) dur = 0;
      if (dur <= 0) dur = Number(fileData.duration) || Number(record(fileData.reader).duration) || 3.0;
      dur = Math.max(0.5, Math.min(dur, 60));

      const layers = project.layers ?? [];
      let nums = layers.map((L) => Math.trunc(Number(L.number))).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      if (nums.length === 0) nums = [1000000, 2000000, 3000000];
      const primary = nums[0]!;
      const mid = nums.length > 1 ? nums[Math.floor(nums.length / 2)]! : nums[0]!;
      const overlay = nums[nums.length - 1]!;
      let trackNum: number;
      if (text(input.track)) {
        const r = normalizeTrackOrLayerArg(text(input.track), layers);
        if (r.error) return r.error;
        trackNum = r.layer!;
      } else trackNum = mode === "overlay" ? overlay : mode === "gap" ? mid : primary;

      if (mode === "overlay") {
        if (!isTransparent) {
          return (
            "Error: mode=overlay requires a transparent HyperFrames import " +
            "(ai_metadata.transparent / transparent_overlay tag / webm). " +
            "Use mode=gap or mode=cut_in for opaque plates — never stack opaque over hero footage."
          );
        }
        if (trackNum < mid) trackNum = overlay;
      } else {
        if (isTransparent) return `Error: mode=${mode} is for opaque plates. Transparent overlays must use mode=overlay on a high track.`;
        if (mode === "gap" && primaryTrackOverlaps(project, primary, t, t + dur)) {
          return (
            "Error: gap mode refused — primary track has footage overlapping " +
            `[${pyFixed(t, 2)}, ${pyFixed(t + dur, 2)}). Use mode=cut_in to ripple clips, or ` +
            "pick a true gap from propose_overlay_windows_tool."
          );
        }
      }
      const region = text(input.layout_region);
      const watchQuery = placementWatchQuery(fileData, text(input.query), region);
      const plan = await planPlacement(call, fileData, {
        position_seconds: String(t),
        track: String(trackNum),
        duration_seconds: String(dur),
        start_seconds: input.start_seconds,
        query: watchQuery,
      });
      if (typeof plan === "string") return plan;
      const shifts = mode === "cut_in" ? ripplePositions(project, primary, t, dur) : [];
      const stamp = {
        mode,
        layout_region: region,
        transparent: isTransparent,
        position_seconds: t,
        duration_seconds: dur,
        track: trackNum,
      };
      const media = pending;
      const clip = call.commit((tx) => {
        for (const [id, position] of shifts) moveClip(tx, id, { position });
        let targetId = fid;
        if (media) {
          const added = addFile(tx, media, { dedupe: true });
          targetId = String(added.id);
          tx.update(["files", { id: targetId }], mgStamp("", isTransparent, added));
        }
        const current = tx.project.files.find((f) => String(f.id) === targetId);
        const ai = { ...record(current?.ai_metadata), mg_placement: stamp, ...(isTransparent ? {} : { transparent: false }) };
        tx.update(["files", { id: targetId }], { ai_metadata: ai });
        return applyPlacement(tx, targetId, plan);
      });
      const result = placementText(call.doc.project, plan, clip);
      const trackLabel = formatTrackLabelForLlm(trackNum, layers);
      return (
        `${result} [mg_place mode=${mode} layout_region=${region || "n/a"} ` +
        `transparent=${isTransparent ? "True" : "False"} track=${trackLabel}]. ` +
        "NEXT: get_timeline_state_tool once to verify, then continue next beat."
      );
    },
  }),

  contractTool("fetch_motion_graphics_video_tool", {
    annotations: IMPORT_WEB,
    run: (call, input) => fetchMotionGraphics(call, input),
  }),

  contractTool("fetch_remotion_video_from_supabase_tool", {
    annotations: IMPORT_WEB,
    deprecated: true,
    run: (call, input) => fetchMotionGraphics(call, input),
  }),
];

