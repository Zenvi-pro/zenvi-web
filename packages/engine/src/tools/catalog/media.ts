/**
 * Media import and indexing tools: import_files_tool,
 * import_video_url_and_add_to_timeline_tool, import_stock_media_tool,
 * wait_until_project_indexed_tool, resummarize_project_file_tool,
 * reindex_project_file_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * import_files (+ _coerce_path_list / _expand_import_paths),
 * import_video_url_and_add_to_timeline, import_stock_media /
 * add_stock_media_to_project, wait_until_project_indexed,
 * resummarize_project_file, reindex_project_file.
 *
 * The web surfaces have no local indexer: imports report
 * `indexing_started=false`, and re-indexing (which needs local chunking and
 * upload) is refused with an explanation.
 */

import type { ProjectFile } from "../../model/types.js";
import { addFile } from "../../ops/files.js";
import { getIndexBlock, isIndexed } from "../ai-metadata.js";
import { freesoundSearch, pexelsSearch, pickPexelsHdLink, projectIndexName, summarizeIndexedVideo } from "../backend.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed } from "../pyfmt.js";
import { applied, unchanged } from "../receipt.js";
import type { ImportedMedia } from "../types.js";
import { importAndPlace, placeExistingFile } from "./clips.js";
import { fileById, record, rememberFile, text } from "./common.js";

/** Extensions collected from folders (tool_handlers._IMPORT_MEDIA_EXTS). */
export const IMPORT_MEDIA_EXTS = [
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg", ".wmv",
  ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp",
];

/** A list, a JSON array, or a comma/newline separated string (tool_handlers._coerce_path_list). */
export function coercePathList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  let items: unknown[] | null = null;
  if (Array.isArray(value)) items = value;
  else {
    const t = String(value).trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(t);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = null;
      }
    }
    if (items === null) items = t.includes(",") || t.includes("\n") ? t.split(/[,\n]/) : [t];
  }
  return items
    .map((p) => String(p).trim())
    .filter(Boolean)
    .map((p) => p.replace(/^["']+|["']+$/g, "").trim())
    .filter(Boolean);
}

function fromFileUrl(entry: string): string {
  const t = entry.trim();
  if (!t.startsWith("file://")) return t;
  try {
    let path = decodeURIComponent(new URL(t).pathname);
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    return path || t;
  } catch {
    return t;
  }
}

function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/** Expand entries into media paths (folders filtered by extension) plus what was missing and notes. */
async function expandImportPaths(call: ToolCall, entries: readonly string[]): Promise<{ resolved: string[]; missing: string[]; notes: string[] }> {
  const resolved: string[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const list = call.host.media?.listPaths;
  for (const entry of entries) {
    const candidate = fromFileUrl(entry);
    if (!list) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        resolved.push(candidate);
      }
      continue;
    }
    const listing = await list.call(call.host.media, candidate);
    if (listing.kind === "missing") {
      if (/[*?[]/.test(candidate)) notes.push(`No files matched: ${entry}`);
      else missing.push(entry);
      continue;
    }
    const files = listing.kind === "directory" ? listing.files.filter((f) => IMPORT_MEDIA_EXTS.includes(extOf(f))) : listing.files;
    if (listing.kind === "glob" && files.length === 0) notes.push(`No files matched: ${entry}`);
    for (const f of files) {
      if (!seen.has(f)) {
        seen.add(f);
        resolved.push(f);
      }
    }
  }
  return { resolved, missing, notes };
}

function sizeMb(media: ImportedMedia): number {
  const bytes = Number(media.fingerprint?.size ?? media.info.file_size ?? 0);
  return Number.isFinite(bytes) ? bytes / (1024 * 1024) : 0;
}

/** Freesound preview URL variants to try in order (api_client.freesound_download). */
export function freesoundCandidates(url: string): string[] {
  const candidates = [url];
  for (const [a, b] of [["-hq.mp3", "-lq.mp3"], ["-lq.mp3", "-hq.mp3"], ["-hq.ogg", "-lq.ogg"], ["-lq.ogg", "-hq.ogg"]] as const) {
    if (url.includes(a)) candidates.push(url.replace(a, b));
  }
  if (url.includes("-hq.mp3")) candidates.push(url.replace("-hq.mp3", "-hq.ogg"));
  return candidates;
}

async function importUrlWithFallbacks(call: ToolCall, urls: readonly string[], filename: string): Promise<ImportedMedia | string> {
  const importUrl = call.host.media?.importUrl;
  if (!importUrl) return "No download support";
  let last = "No download URL";
  for (const url of urls) {
    try {
      return await importUrl.call(call.host.media, url, { filename, signal: call.signal });
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  return last;
}

const IMPORT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const IMPORT_WEB = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

export const mediaTools: CatalogTool[] = [
  contractTool("import_files_tool", {
    annotations: IMPORT,
    requires: ["media"],
    run: async (call, input) => {
      const entries = [input.paths, input.path, input.folder].flatMap((v) => (v ? coercePathList(v) : []));
      if (entries.length === 0) {
        return (
          "Error: paths is required for MCP/harness import. Pass the media " +
          'files or folders to import, e.g. paths=["/clips/dialog_test"]. ' +
          "This tool never opens a file dialog."
        );
      }
      const importPath = call.host.media!.importPath;
      if (!importPath) return unavailable("import_files_tool", "it cannot open local file paths. Use the editor's import dialog.");
      const { resolved, missing, notes } = await expandImportPaths(call, entries);
      if (resolved.length === 0) {
        const detail = notes.length ? notes.join("; ") : `no media files found in: ${entries.join(", ")}`;
        return `Error: Nothing to import (${detail}).`;
      }
      const imported: ImportedMedia[] = [];
      const failures: string[] = [];
      for (const path of resolved) {
        try {
          imported.push(await importPath.call(call.host.media, path));
        } catch (error) {
          failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (imported.length === 0) {
        const detail = notes.length ? notes.join("; ") : failures.length ? failures.join("; ") : "the files could not be opened";
        return `Error: Nothing was added to the media bin (${detail}).`;
      }
      const files = call.commit((tx) => imported.map((media) => addFile(tx, media)));
      const lines = files.map((f, i) => `file_id=${f.id} path=${imported[i]!.path}`);
      rememberFile(call, String(files[files.length - 1]!.id));
      let head = `Imported ${files.length} file(s). indexing_started=false`;
      if (missing.length > 0) head += ` (not found: ${missing.join(", ")})`;
      const allNotes = [...notes, ...failures.map((f) => `Could not open ${f}`)];
      if (allNotes.length > 0) head += "\nNotes: " + allNotes.join("; ");
      return applied(
        "import_files_tool",
        head + "\n" + lines.join("\n"),
        {
          data: { fileIds: files.map((f) => String(f.id)) },
          notes: ["This Zenvi surface does not run AI indexing; files keep any index they already have."],
        },
      );
    },
  }),

  contractTool("import_video_url_and_add_to_timeline_tool", {
    annotations: IMPORT_WEB,
    requires: ["media"],
    run: async (call, input) => {
      const url = text(input.url) || text(input.video_url);
      if (!url) return "Error: video_url is required.";
      if (!call.host.media!.importUrl) return unavailable("import_video_url_and_add_to_timeline_tool", "it cannot download media from URLs.");
      const lowerPath = url.split("?")[0]!.replace(/\/+$/, "").toLowerCase();
      if (lowerPath.includes("freesound.org") || [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma"].some((e) => lowerPath.endsWith(e))) {
        return (
          "Error: import_video_url_and_add_to_timeline_tool is for video URLs only. " +
          "For Freesound / music / SFX use stock_music(query=..., track=...)."
        );
      }
      const rawName = lowerPath.split("/").pop() || "video.mp4";
      const filename = [".mp4", ".mov", ".webm", ".mkv", ".avi"].includes(extOf(rawName)) ? rawName : `${rawName.replace(/\.[^.]*$/, "") || "video"}.mp4`;
      const media = await importUrlWithFallbacks(call, [url], filename);
      if (typeof media === "string") return `Error importing video from URL: ${media}`;
      const existing = (call.doc.project.files ?? []).find((f) => f.path === media.path);
      const placed = existing
        ? await placeExistingFile(call, existing, { position_seconds: input.position_seconds, track: input.track })
        : await importAndPlace(call, media, { position_seconds: input.position_seconds, track: input.track });
      if (!placed.clip) return placed.text;
      const fileId = String(placed.clip.file_id);
      return `✅ Video imported (file_id: ${fileId}, ${pyFixed(sizeMb(media), 1)} MB) and added to the timeline.\n${placed.text}`;
    },
  }),

  contractTool("import_stock_media_tool", {
    annotations: IMPORT_WEB,
    requires: ["media"],
    run: async (call, input) => {
      let media: ImportedMedia | string;
      const localPath = text(input.local_path);
      const source = text(input.source).toLowerCase();
      const filenameHint = text(input.filename);
      if (localPath) {
        const importPath = call.host.media!.importPath;
        if (!importPath) return unavailable("import_stock_media_tool", "it cannot open local file paths (local_path).");
        try {
          media = await importPath.call(call.host.media, localPath);
        } catch (error) {
          return `Error: File not found: ${localPath} (${error instanceof Error ? error.message : String(error)})`;
        }
      } else if ((source === "pexels" || source === "freesound" || text(input.query)) && !call.host.media!.importUrl) {
        return unavailable("import_stock_media_tool", "it cannot download media from URLs.");
      } else if (source === "pexels") {
        const link = text(input.link);
        if (!link) return "Error: link is required (use the MP4 URL from search_pexels_videos_tool).";
        const vid = /^\d+$/.test(text(input.video_id)) ? text(input.video_id) : "0";
        media = await importUrlWithFallbacks(call, [link], `${(filenameHint || `pexels_${vid}`).replace(/[^\w-]/g, "_")}.mp4`);
        if (typeof media === "string") return `Pexels download error: ${media}`;
      } else if (source === "freesound") {
        const preview = text(input.preview_url);
        if (!preview) return "Error: preview_url is required (from search_freesound_music_tool).";
        const sid = text(input.sound_id);
        if (!/^-?\d+$/.test(sid)) return `Error: sound_id must be numeric Freesound ID, not '${sid}'.`;
        const ext = preview.endsWith(".ogg") ? ".ogg" : ".mp3";
        media = await importUrlWithFallbacks(call, freesoundCandidates(preview), `${(filenameHint || `freesound_${sid}`).replace(/[^\w-]/g, "_")}${ext}`);
        if (typeof media === "string") return `Freesound download error: ${media}`;
      } else if (text(input.query)) {
        // Contract: search stock media and import the best result.
        const q = text(input.query);
        const kind = text(input.media_type).toLowerCase() || "video";
        if (!call.host.backend) return unavailable("import_stock_media_tool", "stock search needs the Zenvi backend (sign in to Zenvi).");
        if (kind === "audio") {
          const res = await freesoundSearch(call, q, 15, 1);
          if (res.error) return `Error: ${res.error}`;
          const sound = res.sounds[0];
          const preview = String(record(sound?.previews).hq_mp3 || record(sound?.previews).lq_mp3 || "");
          if (!sound || !preview) return `No stock audio found for '${q}'.`;
          media = await importUrlWithFallbacks(call, freesoundCandidates(preview), `freesound_${String(sound.id)}.mp3`);
          if (typeof media === "string") return `Freesound download error: ${media}`;
        } else {
          const res = await pexelsSearch(call, q, 15, 1);
          if (res.error) return `Error: ${res.error}`;
          const video = res.videos[0];
          const link = video ? pickPexelsHdLink(video) : "";
          if (!video || !link) return `No stock video found for '${q}'.`;
          media = await importUrlWithFallbacks(call, [link], `pexels_${String(video.id)}.mp4`);
          if (typeof media === "string") return `Pexels download error: ${media}`;
        }
      } else {
        return "Error: source must be 'pexels' or 'freesound' (or pass local_path).";
      }

      const project = call.doc.project;
      const existing = project.files.find((f) => f.path === media.path);
      if (existing) {
        rememberFile(call, String(existing.id));
        return (
          `File already in project (file_id=${existing.id}): ${media.path}. ` +
          `IMPORTANT: Call add_clip_to_timeline_tool with file_id='${existing.id}' ` +
          "(or empty file_id to use this just-imported file) to place it on the timeline."
        );
      }
      if (text(input.position_seconds) || text(input.track)) {
        const placed = await importAndPlace(call, media, {
          position_seconds: input.position_seconds,
          track: input.track,
          duration_seconds: input.duration_seconds,
          start_seconds: input.start_seconds,
        });
        if (!placed.clip) return placed.text;
        return `Added to project: ${media.path} (file_id=${String(placed.file?.id)}). ${placed.text}`;
      }
      const file = call.commit((tx) => addFile(tx, media));
      rememberFile(call, String(file.id));
      return (
        `Added to project: ${media.path} (file_id=${file.id}). ` +
        `IMPORTANT: Call add_clip_to_timeline_tool with file_id='${file.id}' ` +
        "(or empty file_id to use this just-imported file) to place it on the timeline."
      );
    },
  }),

  contractTool("wait_until_project_indexed_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: (call, input) => {
      const only = text(input.file_id);
      const targets = (call.doc.project.files ?? []).filter((f) => !f.zenvi_subclip && (!only || String(f.id) === only));
      if (targets.length === 0) return only ? `Error: File not found (id=${only}).` : "No project files to index.";
      const done: string[] = [];
      const pending: string[] = [];
      for (const f of targets) {
        const ai = record(f.ai_metadata);
        const block = getIndexBlock(ai);
        const status = String(block.status ?? "").toLowerCase();
        const indexed = isIndexed(block) || ((status === "" || status === "ready") && Boolean(ai.analyzed));
        (indexed ? done : pending).push(String(f.id));
      }
      // No indexer runs on this surface, so waiting cannot change the answer.
      if (pending.length === 0) return `All ${done.length} project file(s) indexed.`;
      const budget = Math.max(30, Math.trunc(Number(input.timeout_seconds ?? 1800)) || 1800);
      return applied(
        "wait_until_project_indexed_tool",
        `Indexed ${done.length}/${targets.length} file(s) within ${budget}s. pending: ${pending.join(", ")}`,
        {
          data: { indexed: done, pending },
          warnings: ["This Zenvi surface does not run the indexer; index pending files in Zenvi desktop."],
        },
        0,
      );
    },
  }),

  contractTool("resummarize_project_file_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    requires: ["backend"],
    run: async (call, input) => {
      const fileId = text(input.file_id);
      if (!fileId) return "Error: file_id is required.";
      const file = fileById(call.doc.project, fileId);
      if (!file) return `Error: File not found (id=${fileId}).`;
      const ai = record(file.ai_metadata);
      const block = getIndexBlock(ai);
      if (String(block.provider ?? "").toLowerCase().includes("gemini")) {
        return "Error: Summarize-only is not supported for Gemini indexing. Reindex the clip to refresh descriptions.";
      }
      const duration = Number(file.duration) || 0;
      if (duration > 30 * 60) return `Error: Clip is ${pyFixed(duration / 60, 1)} min — exceeds the 30-minute summarize limit.`;
      if (!isIndexed(block) || !String(block.video_id ?? "")) {
        return `Error: File ${fileId} is not indexed yet. Call reindex_project_file_tool first, then resummarize.`;
      }
      const indexName = String(block.index_name || projectIndexName(String(call.doc.project.id ?? "")));
      const result = await summarizeIndexedVideo(call, {
        videoId: String(block.video_id),
        fileId,
        indexId: String(block.index_id ?? ""),
        indexName,
      });
      if (!result.ok) return `Error: Summarize failed: ${result.error}`;
      const tl = { status: "ready", index_id: block.index_id ?? "", video_id: block.video_id, index_name: indexName, provider: block.provider ?? "" };
      const summarized = {
        ...result.aiMetadata,
        index: { ...record(result.aiMetadata.index), ...tl },
        twelvelabs: { ...record(result.aiMetadata.twelvelabs), ...tl },
      };
      call.commit((tx) => tx.update(["files", { id: fileId }], { ai_metadata: summarized }));
      return `Summarize complete for file ${fileId} (video_id=${String(block.video_id)}, ${String(file.path ?? "")}).`;
    },
  }),

  contractTool("reindex_project_file_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    run: (call, input) => {
      const fileId = text(input.file_id);
      if (!fileId) return "Error: file_id is required.";
      const file: ProjectFile | undefined = fileById(call.doc.project, fileId);
      if (!file) return `Error: File not found (id=${fileId}).`;
      const force = ["1", "true", "yes", "force"].includes(String(input.force ?? "false").trim().toLowerCase());
      // The desktop reads only the legacy `twelvelabs` block here; files indexed
      // since carry `index`, so read the index block like every other tool.
      const tl = getIndexBlock(record(file.ai_metadata));
      if (isIndexed(tl) && !force) {
        return unchanged(
          "reindex_project_file_tool",
          `File ${fileId} is already indexed (index_id=${String(tl.index_id ?? "")}, video_id=${String(tl.video_id ?? "")}). ` +
            "Pass force=true only when the file was replaced or indexing failed.",
        );
      }
      const duration = Number(file.duration) || 0;
      if (duration > 30 * 60) return `Error: Clip is ${pyFixed(duration / 60, 1)} min — exceeds the 30-minute re-indexing limit.`;
      return unavailable(
        "reindex_project_file_tool",
        "re-indexing needs the desktop indexer (local chunking and upload to the index). " +
          "Re-index the file in Zenvi desktop — the index travels with the project.",
      );
    },
  }),
];
