/**
 * Project Files (the media bin): list_project_files_tool,
 * update_project_files_tool, import_image_sequence_tool,
 * remove_files_from_project_tool, create_subclips_tool and
 * manage_optimized_previews_tool.
 *
 * Ports of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/media_files.py. The rules the desktop keeps in
 * classes/project_files.py (image sequences, a sequence's frame rate, in/out
 * frames, relinking, saving a file with its clips) are the engine's
 * ops/project-files.ts and ops/files.ts. Each change validates first and is
 * one `call.commit` (one undo step); a refusal records nothing.
 *
 * What the host provides instead of the desktop's disk and caches:
 * - whether a file's media is missing: `media.missing` (the CLI checks the
 *   disk, the web editor its loaded media, Zenvi Cloud its uploads);
 * - relinking (path, search_folder) and image sequences: local files
 *   (`media.importPath`, `media.listPaths`), so the CLI only;
 * - optimized previews: none. Only Zenvi desktop makes and plays them, so
 *   manage_optimized_previews_tool is refused and files report
 *   optimized_preview "none".
 */

import type { Project, ProjectFile, ReaderInfo } from "../../model/types.js";
import { addFile, addSubclipFiles, detectMediaType, removeFile, writeFile } from "../../ops/files.js";
import {
  detectImageSequence,
  firstSequenceFrame,
  folderAndName,
  fpsFraction,
  isImageSequence,
  joinFolder,
  relinkedFileData,
  sequenceFrameNumbers,
  withInOutFrames,
  withSequenceFps,
  type ImageSequence,
} from "../../ops/project-files.js";
import { sameJson } from "../../ops/internal.js";
import { materializeClipAiMetadata } from "../ai-metadata.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { sourceWindowForFile } from "../placement.js";
import { pyFixed, pyG, pyRepr, pyReprString } from "../pyfmt.js";
import type { ContractInput } from "../schemas.gen.js";
import type { PathListing } from "../types.js";
import { secondsToTimeParts } from "./clips.js";
import { pyTruthy } from "./effect-values.js";
import { ToolError, editorRun, gridOf, nothingChanged, ok, r3, uiTrack } from "./timeline-edit-common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;
const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const REMOVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

type Data = Record<string, unknown>;

/** libopenshot / FFmpeg channel layout masks (media_files._LAYOUT_NAMES). */
const LAYOUT_NAMES: Readonly<Record<number, string>> = {
  0: "unknown",
  3: "stereo",
  4: "mono",
  7: "surround_3",
  11: "2.1",
  51: "quad",
  63: "5.1",
  1551: "5.1",
  1599: "7.1",
};

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

/** `_base_name`: the file name of the media path. */
function baseName(data: Data): string {
  return folderAndName(String(data.path || "")).name;
}

/** `_display_name`: name, else file name, else id. */
function displayName(data: Data): string {
  return String(data.name || baseName(data) || data.id || "?");
}

/** `tags_of`: the comma separated tags as a list, case-insensitively unique. */
function tagsOf(data: Data): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of String(data.tags || "").split(",")) {
    const tag = part.trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
  }
  return out;
}

/** `kind_of`: video | audio | image | image_sequence | title (an SVG title). */
function kindOf(data: Data): string {
  const path = String(data.path || "");
  if (path.includes("%")) return "image_sequence";
  if (path.toLowerCase().endsWith(".svg") && !path.toLowerCase().includes("emoji")) return "title";
  const mediaType = String(data.media_type || "").toLowerCase();
  return ["video", "audio", "image"].includes(mediaType) ? mediaType : "video";
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** `_fps_parts`: (num, den) of a file's frame rate, (0, 1) when it has none. */
function fpsParts(data: Data): [number, number] {
  const fps = data.fps && typeof data.fps === "object" ? (data.fps as Data) : {};
  const num = Math.trunc(Number(fps.num) || 0);
  const den = Math.trunc(Number(fps.den) || 1);
  return [Number.isFinite(num) ? num : 0, den || 1];
}

/** `_clip_usage`: file id → its timeline clip ids, in timeline order. */
function clipUsage(project: Project): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  const clips = project.clips
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (Number(a.c.position) || 0) - (Number(b.c.position) || 0) || (Number(a.c.layer) || 0) - (Number(b.c.layer) || 0) || a.i - b.i);
  for (const { c } of clips) {
    const key = String(c.file_id || "");
    const list = usage.get(key) ?? [];
    list.push(c.id);
    usage.set(key, list);
  }
  return usage;
}

/** Whether each file's media is missing, from the host (`media.missing`); null where it cannot tell. */
async function missingFlags(call: ToolCall, files: readonly ProjectFile[]): Promise<Map<string, boolean | null>> {
  const check = call.host.media?.missing;
  const flags = check && files.length > 0 ? await check.call(call.host.media, files) : null;
  return new Map(files.map((f, i) => [f.id, flags ? Boolean(flags[i]) : null]));
}

/** `describe_file`: what a model needs about one project file. */
function describeFile(file: ProjectFile, usage: Map<string, string[]>, missing: boolean | null, full: boolean): Record<string, unknown> {
  const data = file as Data;
  const clipIds = usage.get(String(file.id)) ?? [];
  const [start, end] = sourceWindowForFile(data);
  const kind = kindOf(data);
  const still = kind === "image" || kind === "title";
  const out: Record<string, unknown> = {
    file_id: String(file.id),
    name: displayName(data),
    file_name: baseName(data),
    kind,
    // A still has no length of its own (libopenshot reports 3600 s); on the timeline it
    // lasts the Image Length preference unless trimmed.
    duration: still ? null : r3(Math.max(0, end - start)),
    tags: tagsOf(data),
    clip_count: clipIds.length,
  };
  if (("start" in data || "end" in data) && !still) {
    out.source_in = r3(start);
    out.source_out = r3(end);
  }
  if (clipIds.length > 0) out.timeline_clip_ids = clipIds.slice(0, 20);
  if (pyTruthy(data.zenvi_subclip) || pyTruthy(data.parent_file_id)) {
    out.subclip = true;
    out.parent_file_id = String(data.parent_file_id || "");
  }
  out.missing = missing;
  // Optimized previews are Zenvi desktop's: no web surface makes or plays one.
  if (kind === "video") out.optimized_preview = "none";
  if (full) {
    const [num, den] = fpsParts(data);
    const display = data.display_ratio && typeof data.display_ratio === "object" ? (data.display_ratio as Data) : {};
    const pixel = data.pixel_ratio && typeof data.pixel_ratio === "object" ? (data.pixel_ratio as Data) : {};
    const hasAudio = pyTruthy(data.has_audio);
    const layout = Math.trunc(Number(data.channel_layout) || 0);
    const ai = data.ai_metadata;
    Object.assign(out, {
      path: String(data.path || ""),
      media_duration: still ? null : r3(Number(data.duration) || 0),
      width: data.width ?? null,
      height: data.height ?? null,
      fps: `${num}/${den}`,
      fps_value: num ? r3(num / den) : null,
      frames: pyTruthy(data.video_length) ? Math.trunc(Number(data.video_length) || 0) : null,
      has_video: pyTruthy(data.has_video),
      has_audio: hasAudio,
      video_codec: data.vcodec || "",
      audio_codec: data.acodec || "",
      sample_rate: data.sample_rate ?? null,
      channels: data.channels ?? null,
      channel_layout: hasAudio ? (LAYOUT_NAMES[layout] ?? String(data.channel_layout)) : "none",
      video_bit_rate: data.video_bit_rate ?? null,
      audio_bit_rate: data.audio_bit_rate ?? null,
      interlaced: pyTruthy(data.interlaced_frame),
      display_ratio: `${display.num ?? ""}:${display.den ?? ""}`,
      pixel_ratio: `${pixel.num ?? ""}:${pixel.den ?? ""}`,
      file_size: data.file_size ?? null,
      analyzed: ai && typeof ai === "object" && !Array.isArray(ai) ? pyTruthy((ai as Data).analyzed) : false,
    });
    const proxy = data.proxy_reader;
    if (proxy && typeof proxy === "object" && (proxy as Data).path) out.optimized_preview_path = String((proxy as Data).path);
  } else {
    out.path = String(data.path || "");
  }
  return out;
}

/** `_query_score`: 3 exact id/name/file/stem/tag, 2 part of the name, 1 every word somewhere, 0 no match. */
function queryScore(file: ProjectFile, q: string, words: readonly string[]): number {
  const data = file as Data;
  const name = displayName(data).toLowerCase();
  const base = baseName(data).toLowerCase();
  const stem = stemOf(base);
  const tags = tagsOf(data).map((t) => t.toLowerCase());
  if ([String(file.id).toLowerCase(), name, base, stem].includes(q) || tags.includes(q)) return 3;
  if (name.includes(q) || base.includes(q)) return 2;
  const corpus = [name, base, ...tags].join(" ");
  if (words.length > 0 && words.every((w) => corpus.includes(w))) return 1;
  return 0;
}

/** `resolve_files`: files by id, or the one file a description names. */
function resolveFiles(project: Project, fileIds: readonly string[] | undefined, fileQuery: string | undefined): ProjectFile[] {
  if (fileIds && fileIds.length > 0) {
    const out: ProjectFile[] = [];
    for (const raw of fileIds) {
      const fid = String(raw).trim();
      const file = project.files.find((f) => f.id === fid);
      if (!file) throw new ToolError(`no project file with id=${pyReprString(fid)} (list_project_files_tool lists them)`);
      if (!out.includes(file)) out.push(file);
    }
    return out;
  }
  const q = String(fileQuery ?? "").trim();
  if (!q) throw new ToolError("say which file: file_ids or file_query");
  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const scored = project.files.map((f) => [queryScore(f, lower, words), f] as const).filter(([s]) => s > 0);
  if (scored.length === 0) throw new ToolError(`no project file matches ${pyReprString(q)} (list_project_files_tool lists them)`);
  const best = Math.max(...scored.map(([s]) => s));
  const top = scored.filter(([s]) => s === best).map(([, f]) => f);
  if (top.length > 1) {
    const names = top.slice(0, 8).map((f) => `${pyReprString(displayName(f))} (file_id=${f.id})`).join(", ");
    throw new ToolError(`${pyReprString(q)} matches ${top.length} files: ${names}; pass file_ids`);
  }
  return top;
}

// ---------------------------------------------------------------------------
// list_project_files_tool
// ---------------------------------------------------------------------------

async function listProjectFiles(call: ToolCall, input: ContractInput<"list_project_files_tool">) {
  const project = call.doc.project;
  const usage = clipUsage(project);
  const mediaType = input.media_type ?? "";
  const usageFilter = input.usage ?? "";
  const missingOnly = input.missing_only ?? false;
  const detail = input.detail ?? "summary";
  const limit = input.limit ?? 100;
  const wantedTags = (input.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const q = String(input.query ?? "").trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const onlyIds = new Set((input.file_ids ?? []).map((i) => String(i).trim()).filter(Boolean));
  const files = project.files;
  if (onlyIds.size > 0) {
    const known = new Set(files.map((f) => String(f.id)));
    const unknown = [...onlyIds].filter((id) => !known.has(id)).sort();
    if (unknown.length > 0) throw new ToolError(`no project file with id(s) ${unknown.join(", ")}`);
  }
  if (missingOnly && !call.host.media?.missing) {
    return unavailable(call.tool, "it cannot check whether media files are missing here; call it without missing_only.");
  }
  const missing = await missingFlags(call, files);
  const matched = files.filter((f) => {
    const data = f as Data;
    if (onlyIds.size > 0 && !onlyIds.has(String(f.id))) return false;
    if (mediaType && kindOf(data) !== mediaType) return false;
    if (words.length > 0 && queryScore(f, q, words) === 0) return false;
    if (wantedTags.length > 0) {
      const have = new Set(tagsOf(data).map((t) => t.toLowerCase()));
      if (!wantedTags.every((t) => have.has(t))) return false;
    }
    const used = (usage.get(String(f.id)) ?? []).length > 0;
    if ((usageFilter === "unused" && used) || (usageFilter === "used" && !used)) return false;
    if (missingOnly && !missing.get(f.id)) return false;
    return true;
  });
  const shown = matched.slice(0, Math.trunc(limit)).map((f) => describeFile(f, usage, missing.get(f.id) ?? null, detail === "full"));
  const filters = [mediaType, q ? `'${q}'` : "", wantedTags.length > 0 ? `tags ${pyRepr(wantedTags)}` : "", usageFilter, missingOnly ? "missing" : ""].filter(Boolean);
  let summary = `${matched.length} of ${files.length} project files match${filters.length > 0 ? ` (${filters.join(", ")})` : ""}.`;
  if (matched.length > shown.length) summary += ` Showing the first ${shown.length}.`;
  return ok(call, summary, { files: shown, matched: matched.length, total_files: files.length });
}

// ---------------------------------------------------------------------------
// update_project_files_tool
// ---------------------------------------------------------------------------

/** The names directly in `folder` from a listing (listings are recursive). */
function namesIn(folder: string, files: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const split = folderAndName(f);
    if (split.folder === folder) out.add(split.name);
  }
  return out;
}

/** A listing's files grouped by folder, folders in the order the walk met them (os.walk). */
function byFolder(files: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    const { folder, name } = folderAndName(f);
    const list = out.get(folder) ?? [];
    list.push(name);
    out.set(folder, list);
  }
  return out;
}

/** The host's folder listing, or a refusal when the host has none. */
function listPathsOf(call: ToolCall): (entry: string) => Promise<PathListing> {
  const media = call.host.media;
  const list = media?.listPaths;
  if (!media || !list) throw new ToolError("listing folders is not available here");
  return (entry) => list.call(media, entry);
}

interface RelinkTarget {
  mediaPath: string;
  sequence: ImageSequence | null;
}

/** `_relink_target`: where one file's media is now, or null when search_folder has no such file. */
async function relinkTarget(call: ToolCall, data: Data, path: string, searchFolder: string): Promise<RelinkTarget | null> {
  const list = listPathsOf(call);
  const wasSequence = isImageSequence(data);
  const oldName = folderAndName(String(data.path || "")).name;
  if (searchFolder) {
    const listing = await list(searchFolder);
    if (listing.kind !== "directory") throw new ToolError(`search_folder ${pyReprString(searchFolder)} is not a folder`);
    if (wasSequence) {
      const prefix = oldName.split("%", 1)[0] ?? "";
      for (const [folder, names] of byFolder(listing.files)) {
        const set = new Set(names);
        for (const n of names.filter((x) => x.startsWith(prefix)).sort()) {
          const sequence = detectImageSequence(joinFolder(folder, n), set);
          if (sequence && folderAndName(sequence.path).name === oldName) return { mediaPath: joinFolder(folder, n), sequence };
        }
      }
      return null;
    }
    // `_find_in_folder`: the first file of that name, walking down from the folder.
    const found = listing.files.find((f) => folderAndName(f).name === oldName);
    return found ? { mediaPath: found, sequence: null } : null;
  }
  const listing = await list(path);
  if (wasSequence) {
    if (listing.kind === "directory") {
      const folder = listing.path ?? folderAndName(listing.files[0] ?? "").folder;
      const found = firstSequenceFrame(folder, namesIn(folder, listing.files));
      if (!found) throw new ToolError(`no numbered image sequence in ${pyReprString(path)}`);
      return { mediaPath: found.first, sequence: found.sequence };
    }
    // detect_image_sequence needs the frame's neighbours, not the frame itself.
    const file = listing.kind === "file" ? listing.files[0]! : (listing.path ?? path);
    const folder = folderAndName(file).folder;
    const folderListing = folder ? await list(folder) : null;
    const sequence = folderListing?.kind === "directory" ? detectImageSequence(file, namesIn(folder, folderListing.files)) : null;
    if (!sequence) throw new ToolError(`${pyReprString(path)} is not a frame of a numbered image sequence (this file is a sequence)`);
    return { mediaPath: file, sequence };
  }
  if (listing.kind !== "file") throw new ToolError(`no file at ${pyReprString(path)}`);
  return { mediaPath: listing.files[0]!, sequence: null };
}

interface Relinked {
  mediaPath: string;
  record: Data;
  sameContent: boolean | null;
}

/** `_relinked`: the file's new record after pointing it at the new media (probes it). */
async function relinked(call: ToolCall, data: Data, target: RelinkTarget): Promise<Relinked> {
  const media = call.host.media!;
  const oldSha = data.fingerprint && typeof data.fingerprint === "object" ? (data.fingerprint as Data).sha256 : undefined;
  if (target.sequence) {
    const reader = await probeReader(call, target.sequence.path);
    const [num, den] = fpsParts(data);
    const record = relinkedFileData(data, reader, "video", null) as Data;
    const start = record.start;
    const end = record.end;
    delete record.start;
    delete record.end;
    record.fps = { ...((reader.fps as unknown as Data | undefined) ?? { num: 25, den: 1 }) };
    // The sequence reader counts 25 fps; keep the frame rate the file had.
    const rescaled = withSequenceFps(record, { num: num || 25, den: den || 1 });
    if (start !== undefined && end !== undefined) {
      rescaled.start = start;
      rescaled.end = Math.min(Number(end), Number(rescaled.duration));
    }
    return { mediaPath: target.mediaPath, record: rescaled, sameContent: null };
  }
  let imported;
  try {
    imported = await media.importPath!(target.mediaPath);
  } catch (error) {
    throw new ToolError(`libopenshot cannot read ${pyReprString(target.mediaPath)} as media (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!(Number(imported.info.duration) > 0)) throw new ToolError(`libopenshot cannot read ${pyReprString(target.mediaPath)} as media`);
  const { media_type: _mt, ...reader } = imported.info as ReaderInfo & { media_type?: unknown };
  const fingerprint = imported.fingerprint as Data | undefined;
  const mediaType = detectMediaType({ path: imported.path, info: imported.info, name: imported.name });
  const record = relinkedFileData(data, { ...reader, path: imported.path }, mediaType, fingerprint ?? null) as Data;
  const sameContent = !(oldSha && fingerprint) ? null : oldSha === fingerprint.sha256;
  return { mediaPath: imported.path, record, sameContent };
}

/** `_probe_reader`: libopenshot's reader JSON for a media path (an image sequence pattern too). */
async function probeReader(call: ToolCall, path: string): Promise<Data> {
  let info: ReaderInfo;
  try {
    info = await call.host.media!.probe(path);
  } catch {
    throw new ToolError(`libopenshot cannot read ${pyReprString(path)} as media`);
  }
  if (!(Number(info.duration) > 0)) throw new ToolError(`libopenshot cannot read ${pyReprString(path)} as media`);
  const { media_type: _mt, ...reader } = info as ReaderInfo & { media_type?: unknown };
  return reader as Data;
}

async function updateProjectFiles(call: ToolCall, input: ContractInput<"update_project_files_tool">) {
  const files = resolveFiles(call.doc.project, input.file_ids, input.file_query);
  const name = String(input.name ?? "").trim();
  const add = (input.add_tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  const drop = new Set((input.remove_tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean));
  const replace = input.tags === undefined || input.tags === null ? null : input.tags.map((t) => String(t).trim()).filter(Boolean);
  const startArg = input.source_start_seconds ?? null;
  const endArg = input.source_end_seconds ?? null;
  const inOut = startArg !== null || endArg !== null;
  const path = String(input.path ?? "").trim();
  const searchFolder = String(input.search_folder ?? "").trim();
  const relink = Boolean(path || searchFolder);
  const resetInOut = input.reset_in_out ?? false;
  const fps = input.fps ?? 0;
  const renameClips = input.rename_clips ?? false;
  if (!(name || add.length > 0 || drop.size > 0 || replace !== null || relink || inOut || resetInOut || fps)) {
    throw new ToolError(
      "nothing to change: pass name, tags/add_tags/remove_tags, path or search_folder, source_start/end_seconds, reset_in_out or fps",
    );
  }
  const single = ([["name", name], ["path", path], ["source_start/end_seconds", inOut]] as const).filter(([, used]) => used).map(([label]) => label);
  if (single.length > 0 && files.length > 1) throw new ToolError(`${single.join(" and ")} apply to one file; ${files.length} were chosen`);
  if (input.path && input.search_folder) throw new ToolError("pass path or search_folder, not both");
  if (inOut && resetInOut) throw new ToolError("pass source_start/end_seconds or reset_in_out, not both");
  if (renameClips && !name) throw new ToolError("rename_clips needs a name");
  let sequenceFps = { num: 0, den: 1 };
  if (fps) {
    const notSequences = files.filter((f) => !isImageSequence(f)).map((f) => displayName(f));
    if (notSequences.length > 0) {
      throw new ToolError(`only image sequences can change frame rate; ${notSequences.join(", ")} keep the rate their media was recorded at`);
    }
    sequenceFps = fpsFraction(fps);
  }

  // Relink targets and probes first: they read the disk and can take a while.
  const relinkedById = new Map<string, Relinked>();
  const notFound: string[] = [];
  if (relink) {
    if (!call.host.media?.importPath || !call.host.media.listPaths) {
      return unavailable(
        call.tool,
        "relinking to a path (path, search_folder) needs local file access: use the zenvi CLI or Zenvi desktop, or Relink… on the file in the web editor's Project Files.",
      );
    }
    for (const f of files) {
      const target = await relinkTarget(call, f as Data, path, searchFolder);
      if (!target) {
        notFound.push(displayName(f));
        continue;
      }
      relinkedById.set(f.id, await relinked(call, f as Data, target));
    }
    if (relinkedById.size === 0) throw new ToolError(`no media named like ${notFound.join(", ")} under ${pyReprString(searchFolder)}`);
  }

  // Build every new record, then decide whether anything changes (a no-op adds no undo step).
  const project = call.doc.project;
  const plans: [ProjectFile, Data][] = [];
  for (const stale of files) {
    const f = project.files.find((x) => x.id === stale.id);
    if (!f) throw new ToolError(`no project file with id=${pyReprString(stale.id)} (list_project_files_tool lists them)`);
    const old = f as Data;
    let next: Data = structuredClone(relinkedById.get(f.id)?.record ?? old);
    if (name) next.name = name;
    if (replace !== null || add.length > 0 || drop.size > 0) {
      const current = replace ?? tagsOf(next);
      const merged: string[] = [];
      const seen = new Set<string>();
      for (const t of [...current, ...add]) {
        if (!seen.has(t.toLowerCase()) && !drop.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          merged.push(t);
        }
      }
      if (merged.length > 0 || "tags" in next) next.tags = merged.join(", ");
    }
    if (fps) next = withSequenceFps(next, sequenceFps);
    if (resetInOut) {
      delete next.start;
      delete next.end;
    }
    if (inOut) {
      const [num, den] = fpsParts(next);
      const rate = num ? num / den : gridOf(project).fps;
      const mediaLength = Number(next.duration) || 0;
      const [curStart, curEnd] = sourceWindowForFile(next);
      const start = startArg !== null ? Number(startArg) : curStart;
      let end = endArg !== null ? Number(endArg) : curEnd;
      if (mediaLength > 0 && end > mediaLength + 1 / rate) {
        throw new ToolError(`source_end_seconds ${pyFixed(end, 3)} is past the end of the media (${pyFixed(mediaLength, 3)}s)`);
      }
      end = mediaLength > 0 ? Math.min(end, mediaLength) : end;
      if (end - start < 1 / rate) throw new ToolError(`the in-point (${pyFixed(start, 3)}s) must be before the out-point (${pyFixed(end, 3)}s)`);
      next = withInOutFrames(next, pyRoundInt(start * rate) + 1, Math.max(1, pyRoundInt(end * rate)));
    }
    if (!sameJson(next, old) || (renameClips && name)) plans.push([f, next]);
  }

  const receiptFiles: Record<string, unknown>[] = files.map((f) => {
    const entry: Record<string, unknown> = { file_id: f.id };
    const r = relinkedById.get(f.id);
    if (r) {
      entry.path = r.mediaPath;
      entry.same_content = r.sameContent;
    }
    return entry;
  });
  if (plans.length === 0) {
    return nothingChanged(call, "No change: the file(s) already have those settings.", { files: receiptFiles, not_found: notFound });
  }

  const results = call.commit((tx) =>
    plans.map(([f, next]) => writeFile(tx, f.id, next, renameClips && name ? { clipTitle: name } : {})),
  );
  const updatedClips = [...new Set(results.flatMap((r) => r.updatedClipIds))];
  const renamedClips = results.flatMap((r) => r.renamedClipIds);
  for (const entry of receiptFiles) {
    const result = results.find((r) => r.file.id === entry.file_id);
    if (!result) continue;
    const data = result.file as Data;
    entry.name = displayName(data);
    entry.tags = tagsOf(data);
    const [s, e] = sourceWindowForFile(data);
    entry.duration = r3(e - s);
    if ("start" in data) {
      entry.source_in = r3(s);
      entry.source_out = r3(e);
    }
    if (fps) entry.fps = `${sequenceFps.num}/${sequenceFps.den}`;
  }
  const what = (
    [
      ["renamed", Boolean(name)],
      ["tagged", add.length > 0 || drop.size > 0 || replace !== null],
      ["relinked", relinkedById.size > 0],
      ["in/out set", inOut || resetInOut],
      ["frame rate set", Boolean(fps)],
    ] as const
  )
    .filter(([, used]) => used)
    .map(([label]) => label);
  let summary = `Updated ${plans.length} file(s): ${what.join(", ")}.`;
  if (updatedClips.length > 0) summary += ` Refreshed ${updatedClips.length} timeline clip(s).`;
  if (notFound.length > 0) summary += ` Not found under the folder: ${notFound.join(", ")}.`;
  if (receiptFiles.some((e) => e.same_content === false)) summary += " Note: the new media is not the same file as before (content differs).";
  return ok(call, summary, {
    changed: true,
    files: receiptFiles,
    updated_clip_ids: [...updatedClips].sort(),
    renamed_clip_ids: renamedClips,
    not_found: notFound,
  });
}

/** Python `int(round(x))`. */
function pyRoundInt(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  const r = diff > 0.5 ? f + 1 : diff < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return r === 0 ? 0 : r;
}

// ---------------------------------------------------------------------------
// import_image_sequence_tool
// ---------------------------------------------------------------------------

async function importImageSequence(call: ToolCall, input: ContractInput<"import_image_sequence_tool">) {
  if (!call.host.media?.listPaths) {
    return unavailable(call.tool, "it cannot open local folders of frames. Import image sequences with the zenvi CLI or Zenvi desktop.");
  }
  const list = listPathsOf(call);
  const given = String(input.path);
  const listing = await list(given.trim());
  let first: string;
  let sequence: ImageSequence;
  let names: Set<string>;
  if (listing.kind === "directory") {
    const folder = listing.path ?? folderAndName(listing.files[0] ?? "").folder;
    names = namesIn(folder, listing.files);
    const found = firstSequenceFrame(folder, names);
    if (!found) throw new ToolError(`no numbered image sequence (name0001.png, name0002.png...) in ${pyReprString(given)}`);
    first = found.first;
    sequence = found.sequence;
  } else if (listing.kind === "file") {
    first = listing.files[0]!;
    const folder = folderAndName(first).folder;
    names = namesIn(folder, (await list(folder)).files);
    const found = detectImageSequence(first, names);
    if (!found) {
      throw new ToolError(`${pyReprString(folderAndName(first).name)} has no neighbouring numbered frames; import a single image with import_files_tool`);
    }
    sequence = found;
  } else {
    throw new ToolError(`no file or folder at ${pyReprString(given)}`);
  }
  const frames = sequenceFrameNumbers(sequence, names);
  if (frames.length < 2) throw new ToolError(`${sequence.pattern} has only ${frames.length} frame(s); a sequence needs at least 2`);

  const existing = call.doc.project.files.find((f) => f.path === sequence.path);
  if (existing) {
    return nothingChanged(call, `That sequence is already in the project as ${pyReprString(displayName(existing))}.`, {
      file_id: existing.id,
      path: sequence.path,
    });
  }
  const projectFps = call.doc.project.fps ?? { num: 30, den: 1 };
  const fps = input.fps ? fpsFraction(input.fps) : { num: Math.trunc(Number(projectFps.num) || 30), den: Math.trunc(Number(projectFps.den) || 1) };
  // Like Import Files: a first frame already in the project is skipped, so nothing opens as a sequence.
  if (call.doc.project.files.some((f) => f.path === first)) {
    throw new ToolError(`libopenshot could not open ${sequence.pattern} as an image sequence`);
  }
  let reader: Data;
  try {
    reader = await probeReader(call, sequence.path);
  } catch {
    throw new ToolError(`libopenshot could not open ${sequence.pattern} as an image sequence`);
  }
  // files_model.add_files: the sequence reader counts 25 fps; play it at the chosen rate.
  const info = {
    ...reader,
    duration: (Number(reader.duration) || 0) * (25.0 / (fps.num / fps.den)),
    fps: { num: fps.num, den: fps.den },
    video_timebase: { num: fps.den, den: fps.num },
  } as unknown as ReaderInfo;
  const name = String(input.name ?? "").trim();
  const file = call.commit((tx) =>
    addFile(tx, { path: sequence.path, info, ...(name ? { name } : {}) }, { dedupe: false, mediaType: "video" }),
  );
  const data = file as Data;
  const duration = Number(data.duration) || 0;
  // A host listing may stop at a few thousand files; ffmpeg counted every frame it can play.
  const playable = Math.trunc(Number(data.video_length) || 0);
  const count = Math.max(frames.length, playable);
  const last = playable > frames.length ? frames[0]! + playable - 1 : frames[frames.length - 1]!;
  return ok(
    call,
    `Imported ${count} frames of ${sequence.pattern} as one ${pyG(fps.num / fps.den)} fps sequence (${pyFixed(duration, 2)}s). ` +
      "Place it with add_clip_to_timeline_tool.",
    {
      file_id: file.id,
      name: displayName(data),
      path: sequence.path,
      frames: count,
      first_frame: frames[0],
      last_frame: last,
      fps: `${fps.num}/${fps.den}`,
      duration: r3(duration),
      width: data.width ?? null,
      height: data.height ?? null,
    },
  );
}

// ---------------------------------------------------------------------------
// remove_files_from_project_tool
// ---------------------------------------------------------------------------

async function removeFilesFromProject(call: ToolCall, input: ContractInput<"remove_files_from_project_tool">) {
  const project = call.doc.project;
  const scope = input.scope ?? "";
  if (scope && ((input.file_ids ?? []).length > 0 || String(input.file_query ?? "").trim())) {
    throw new ToolError("pass scope or file_ids/file_query, not both");
  }
  const usage = clipUsage(project);
  let files: ProjectFile[];
  if (scope === "unused") {
    files = project.files.filter((f) => (usage.get(String(f.id)) ?? []).length === 0);
    if (files.length === 0) {
      return nothingChanged(call, "Every project file is used on the timeline; nothing to remove.", { removed_file_ids: [] });
    }
  } else if (scope === "missing") {
    if (!call.host.media?.missing) {
      return unavailable(call.tool, "it cannot check whether media files are missing here; name the files with file_ids instead.");
    }
    const missing = await missingFlags(call, project.files);
    files = call.doc.project.files.filter((f) => missing.get(f.id));
    if (files.length === 0) {
      return nothingChanged(call, "No project file is missing its media; nothing to remove.", { removed_file_ids: [] });
    }
  } else {
    files = resolveFiles(project, input.file_ids, input.file_query);
  }

  const current = call.doc.project;
  const used = new Map(files.map((f) => [f.id, usage.get(String(f.id)) ?? []] as const).filter(([, ids]) => ids.length > 0));
  if (used.size > 0) {
    const lockedLayers = new Set(current.layers.filter((l) => l.lock).map((l) => l.number));
    const clips = [...used.values()].flat().map((id) => current.clips.find((c) => c.id === id));
    const locked = [
      ...new Set(clips.filter((c) => c && lockedLayers.has(Number(c.layer))).map((c) => uiTrack(current, Number(c!.layer)) || Number(c!.layer))),
    ].sort((a, b) => a - b);
    if (locked.length > 0) throw new ToolError(`clips of these files sit on locked track(s) ${pyRepr(locked)}; unlock them first`);
    if (!input.confirm_remove_clips) {
      const names = files
        .filter((f) => used.has(f.id))
        .map((f) => `${pyReprString(displayName(f))} (${used.get(f.id)!.length} clip(s))`)
        .join(", ");
      const one = used.size === 1;
      const total = [...used.values()].reduce((n, ids) => n + ids.length, 0);
      throw new ToolError(
        `${names} ${one ? "is" : "are"} used on the timeline; removing ${one ? "it" : "them"} also deletes those ${total} timeline clip(s). ` +
          "Ask the user, then call again with confirm_remove_clips=true (or remove only unused files).",
      );
    }
  }
  const names = new Map(files.map((f) => [f.id, displayName(f)]));
  const removed = call.commit((tx) => files.map((f) => removeFile(tx, f.id)));
  const removedFiles = removed.map((r) => r.fileId);
  const removedClips = removed.flatMap((r) => r.removedClipIds);
  const gone = new Set(removedFiles);
  const keptSubclips = call.doc.project.files.filter((f) => gone.has(String(f.parent_file_id || ""))).map((f) => f.id);
  let summary = `Removed ${removedFiles.length} file(s) from the project`;
  summary += removedClips.length > 0 ? ` and ${removedClips.length} timeline clip(s) that used them.` : ".";
  summary += " The media files stay on disk.";
  return ok(call, summary, {
    changed: true,
    removed_file_ids: removedFiles,
    removed_names: removedFiles.map((id) => names.get(id) ?? id),
    removed_clip_ids: removedClips,
    subclips_kept: keptSubclips,
  });
}

// ---------------------------------------------------------------------------
// create_subclips_tool (Split Clip dialog, explicit times)
// ---------------------------------------------------------------------------

/** `_compact_time`: SS;FF, MM:SS;FF or HH:MM:SS;FF. */
function compactTime(seconds: number, num: number, den: number, hours: boolean, minutes: boolean): string {
  const t = secondsToTimeParts(Math.max(0, seconds), num, den);
  if (hours) return `${t.hour}:${t.min}:${t.sec};${t.frame}`;
  if (minutes) return `${t.min}:${t.sec};${t.frame}`;
  return `${t.sec};${t.frame}`;
}

function createSubclips(call: ToolCall, input: ContractInput<"create_subclips_tool">) {
  const project = call.doc.project;
  const source = project.files.find((f) => f.id === String(input.file_id).trim());
  if (!source) throw new ToolError(`no project file with id=${pyReprString(String(input.file_id))}`);
  if (input.subclips.length === 0) throw new ToolError("give at least one sub-clip with source_start_seconds and source_end_seconds");
  const data = source as Data;
  const [num, den] = fpsParts(data);
  const rate = num ? num / den : gridOf(project).fps;
  const [mediaStart, mediaEnd] = sourceWindowForFile(data);
  if (kindOf(data) === "image" || pyTruthy(data.has_single_image)) throw new ToolError("a still image has no time range to split");
  const plans: [number, number, string][] = [];
  input.subclips.forEach((sub, i) => {
    let s = Number(sub.source_start_seconds);
    let e = Number(sub.source_end_seconds);
    if (e <= s) throw new ToolError(`sub-clip ${i + 1}: source_end_seconds must be after source_start_seconds`);
    if (s < mediaStart - 1e-3 || e > mediaEnd + 1 / rate) {
      throw new ToolError(
        `sub-clip ${i + 1}: ${pyFixed(s, 2)}-${pyFixed(e, 2)}s is outside the file's ${pyFixed(mediaStart, 2)}-${pyFixed(mediaEnd, 2)}s`,
      );
    }
    // Snap to the file's frames, like the dialog's Start/End buttons.
    s = pyRoundInt(s * rate) / rate;
    e = Math.min(pyRoundInt(e * rate) / rate, mediaEnd);
    if (e - s < 1 / rate) throw new ToolError(`sub-clip ${i + 1} is shorter than one frame`);
    plans.push([s, e, String(sub.name ?? "").trim()]);
  });
  const base = stemOf(baseName(data)) || displayName(data);
  const ai = data.ai_metadata;
  const subclips = plans.map(([s, e, given]) => {
    let subName = given;
    if (!subName) {
      const hours = s >= 3600 || e >= 3600;
      const minutes = hours || s >= 60 || e >= 60;
      subName = `${base} (${compactTime(s, num || 30, den, hours, minutes)} to ${compactTime(e, num || 30, den, hours, minutes)})`;
    }
    const aiMetadata = ai && typeof ai === "object" && !Array.isArray(ai) ? (materializeClipAiMetadata(ai, s, e, { rebased: true }) as Data) : undefined;
    return { start: s, end: e, name: subName, ...(aiMetadata ? { aiMetadata } : {}) };
  });
  const created = call.commit((tx) => addSubclipFiles(tx, source.id, subclips));
  return ok(call, `Created ${created.length} sub-clip(s) of ${pyReprString(displayName(data))}. Place one with add_clip_to_timeline_tool(file_id=...).`, {
    subclips: created.map((f, i) => ({
      file_id: f.id,
      name: subclips[i]!.name,
      source_in: r3(subclips[i]!.start),
      source_out: r3(subclips[i]!.end),
      duration: r3(subclips[i]!.end - subclips[i]!.start),
    })),
    parent_file_id: source.id,
  });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const mediaFilesTools: CatalogTool[] = [
  contractTool("list_project_files_tool", {
    annotations: READ,
    run: (call, input) => editorRun(() => listProjectFiles(call, input)),
  }),
  contractTool("update_project_files_tool", {
    annotations: EDIT,
    run: (call, input) => editorRun(() => updateProjectFiles(call, input)),
  }),
  contractTool("import_image_sequence_tool", {
    annotations: EDIT,
    requires: ["media"],
    run: (call, input) => editorRun(() => importImageSequence(call, input)),
  }),
  contractTool("remove_files_from_project_tool", {
    annotations: REMOVE,
    run: (call, input) => editorRun(() => removeFilesFromProject(call, input)),
  }),
  contractTool("create_subclips_tool", {
    annotations: EDIT,
    run: (call, input) => editorRun(() => createSubclips(call, input)),
  }),
  contractTool("manage_optimized_previews_tool", {
    annotations: EDIT,
    // ProxyService builds small H.264 copies on the desktop and its preview plays them;
    // no web renderer has optimized copies (each decodes the original media).
    run: (call) =>
      unavailable(
        call.tool,
        "optimized previews exist only in Zenvi desktop, which builds and plays them. The web editor, the CLI and " +
          "Zenvi Cloud always play and export the original media.",
      ),
  }),
];
