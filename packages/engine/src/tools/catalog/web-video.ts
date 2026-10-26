/**
 * ingest_web_video_tool: a YouTube (or other site's) video into Project
 * Files, and onto the timeline only when the person asked for that.
 *
 * Port of zenvi-core develop (1f80cb3d0) src/classes/tool_handlers.py
 * ingest_web_video, _ingest_web_video_impl, _run_ingest_job,
 * _ingest_job_public and _ingest_web_video_fail: the intents (reference =
 * Project Files only, for colour; timeline = placed; recreate = a watch-only
 * reference), direct media links, the long-poll jobs (the first call waits
 * about 25 s, then answers status=running with a job_id; a call with that
 * job_id waits up to about 45 s; a second call for the same link joins the
 * running download), the JSON answers, tags and names. The pure rules are in
 * web-video/web-video.ts.
 *
 * The download is the host's (`MediaHost.fetchWebVideo`): yt-dlp on the
 * person's own computer, which the CLI and `zenvi mcp` have. Zenvi Cloud and
 * the web editor have none and refuse in words: a hosted server or a browser
 * fetching third-party pages is a different terms-of-service position, and
 * it gets server addresses blocked.
 *
 * Unlike the desktop, whose download thread imports the video the moment it
 * lands, the import (and the placement) happens in the call that finds the
 * download finished, as that call's one undo step: a tool never changes the
 * project outside its own call.
 */

import type { ProjectFile } from "../../model/types.js";
import { addFile } from "../../ops/files.js";
import {
  NOT_HTTP_URL_MESSAGE,
  humanizeIngestFailure,
  isProbableWebVideoUrl,
  isWebVideoError,
  normalizeWebVideoIntent,
  type WebVideoDownload,
  type WebVideoIntent,
} from "../../web-video/web-video.js";
import { generateId } from "../../model/ids.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall, type ToolOutcome } from "../define.js";
import { parseSecondsArg, TimeArgError } from "../placement.js";
import { pyFixed, pyLen, pySlice } from "../pyfmt.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import { lockedTrackError, resolvePlacementTrack } from "../tracks.js";
import type { ImportedMedia, MediaHost } from "../types.js";
import { applyPlacement, planPlacement, placementText, provisionalFile } from "./clips.js";
import { text } from "./common.js";

const TOOL = "ingest_web_video_tool";

/**
 * How long calls wait for a download (_INGEST_SYNC_BUDGET_S, _INGEST_POLL_BUDGET_S)
 * and how long a finished job is remembered (_INGEST_JOB_TTL_S). MCP clients
 * give up on a call after about 60 s, so no call waits longer than 45 s.
 */
export const INGEST_WAIT = { firstSeconds: 25, pollSeconds: 45, jobTtlSeconds: 30 * 60 };

/** Why the hosted surfaces refuse, and what to do there instead. */
export const HOSTED_WEB_VIDEO_REASON =
  "hosted Zenvi (Zenvi Cloud, the web editor) does not download videos from web pages such as YouTube: that runs only on your own computer, " +
  "in Zenvi desktop or the zenvi CLI (with yt-dlp). Use a direct link to the media file instead (import_media_from_url in Zenvi Cloud; " +
  "import_video_url_and_add_to_timeline_tool also places it), or upload the file.";

const PAGE_NOTE = "User-initiated local cache for personal reference/edit in Zenvi. Do not re-upload the original as your own content.";
const DIRECT_NOTE = "User-initiated local import. Do not re-upload the original as your own.";
const FAIL_NEXT = "Tell the user what failed in one short sentence. Do not retry the same URL in a loop.";
const RUNNING_MESSAGE = "YouTube/web download still in progress — long videos can take a few minutes. This is not a failure.";

type Payload = Record<string, unknown>;

/** What a finished job answers: the call that imported it gets `fresh`, later calls `replay`. */
interface Final {
  fresh: ToolOutcome;
  replay: () => ToolOutcome;
}

interface IngestJob {
  readonly id: string;
  readonly url: string;
  readonly intent: WebVideoIntent;
  readonly place: boolean;
  readonly track: unknown;
  readonly positionSeconds: unknown;
  readonly key: string;
  /** Settles when the download does; never rejects. */
  readonly fetched: Promise<void>;
  download?: WebVideoDownload;
  error?: unknown;
  settled: boolean;
  /** A call importing the download right now. */
  importing?: Promise<Final>;
  final?: Final;
  updatedAt: number;
}

/** The jobs of one host (the desktop's _ingest_jobs / _ingest_inflight; a `zenvi mcp` server keeps one host). */
class IngestJobs {
  private readonly byId = new Map<string, IngestJob>();
  private readonly inflight = new Map<string, string>();

  get(id: string): IngestJob | undefined {
    return this.byId.get(id);
  }

  /** The unfinished job for this link, intent and placement, if any: a second call joins it. */
  open(key: string): IngestJob | undefined {
    const id = this.inflight.get(key);
    const job = id ? this.byId.get(id) : undefined;
    return job && !job.final ? job : undefined;
  }

  add(job: IngestJob): void {
    this.byId.set(job.id, job);
    this.inflight.set(job.key, job.id);
  }

  finish(job: IngestJob, final: Final): void {
    job.final = final;
    job.updatedAt = Date.now();
    if (this.inflight.get(job.key) === job.id) this.inflight.delete(job.key);
  }

  /** Forget downloads that ended more than the TTL ago (_purge_stale_ingest_jobs). */
  purge(now = Date.now()): void {
    const cutoff = now - INGEST_WAIT.jobTtlSeconds * 1000;
    for (const [id, job] of this.byId) {
      if (!job.settled || (job.importing && !job.final) || job.updatedAt >= cutoff) continue;
      this.byId.delete(id);
      if (this.inflight.get(job.key) === id) this.inflight.delete(job.key);
    }
  }
}

const JOBS = new WeakMap<MediaHost, IngestJobs>();

function jobsOf(media: MediaHost): IngestJobs {
  let jobs = JOBS.get(media);
  if (!jobs) {
    jobs = new IngestJobs();
    JOBS.set(media, jobs);
  }
  return jobs;
}

function newJobId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : generateId(undefined, 32).toLowerCase();
}

/** Wait up to `ms` for the download, or until the caller gives up. */
async function waitFor(job: IngestJob, ms: number, signal?: AbortSignal): Promise<void> {
  if (job.settled || ms <= 0 || signal?.aborted) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  await Promise.race([
    job.fetched,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
    new Promise<void>((resolve) => {
      if (!signal) return;
      onAbort = () => resolve();
      signal.addEventListener("abort", onAbort, { once: true });
    }),
  ]);
  clearTimeout(timer);
  if (onAbort) signal?.removeEventListener("abort", onAbort);
}

// ---------------------------------------------------------------------------
// Answers (the desktop's JSON objects)
// ---------------------------------------------------------------------------

/** _ingest_web_video_fail: one short line, never a stack. */
function failPayload(reason: string, url = "", intent = ""): Payload {
  let msg = (reason || "Ingest failed.").trim().split(/\s+/).filter(Boolean).join(" ");
  if (pyLen(msg) > 280) msg = `${pySlice(msg, 0, 277)}...`;
  return { ok: false, status: "failed", error: msg, url, intent, file_id: "", placed: false, message: msg, next: FAIL_NEXT };
}

/** A refusal before anything was downloaded. */
function refuse(reason: string, url = "", intent = ""): ToolOutcome {
  const data = failPayload(reason.replace(/^Error:\s*/, ""), url, intent);
  return refused(TOOL, `Error: ${String(data.error)}`, { data });
}

function runningPayload(job: IngestJob): Payload {
  return {
    ok: true,
    status: "running",
    job_id: job.id,
    url: job.url,
    intent: job.intent,
    file_id: "",
    placed: false,
    message: RUNNING_MESSAGE,
    next:
      `Call ingest_web_video_tool(job_id="${job.id}") again — the tool waits until the download finishes or ~45s, then returns. ` +
      "Do not start another download of the same URL. A client 'operation timed out' is not failure — keep calling this job_id.",
  };
}

function summaryOf(data: Payload): string {
  const lines = [String(data.message ?? "")];
  if (data.placed === true && typeof data.placement === "string" && data.placement) lines.push(data.placement);
  if (typeof data.error === "string" && data.error) lines.push(data.error);
  if (typeof data.next === "string" && data.next) lines.push(data.next);
  return lines.filter(Boolean).join("\n");
}

/** A finished job's answer: its own payload with status and job_id (_ingest_job_public). */
function jobPayload(job: IngestJob, payload: Payload): Payload {
  return { ...payload, status: payload.ok === true ? "completed" : "failed", job_id: job.id };
}

function failure(job: IngestJob, reason: string): Final {
  const data = jobPayload(job, failPayload(reason, job.url, job.intent));
  const answer = (): ToolOutcome => failed(TOOL, `Error: ${String(data.error)}`, { data });
  return { fresh: answer(), replay: answer };
}

// ---------------------------------------------------------------------------
// Import and placement
// ---------------------------------------------------------------------------

function sizeMb(media: ImportedMedia): number {
  const bytes = Number(media.fingerprint?.size ?? media.info.file_size ?? 0);
  return Number.isFinite(bytes) ? bytes / (1024 * 1024) : 0;
}

/** Tags of a web reference (tags web_video, the intent, youtube|web; recreate adds reference_only). */
export function webVideoTags(intent: WebVideoIntent, isYoutube: boolean): string {
  const tags: string[] = [];
  for (const tag of ["web_video", intent, isYoutube ? "youtube" : "web"]) if (!tags.includes(tag)) tags.push(tag);
  if (intent === "recreate") tags.push("reference_only");
  return tags.join(", ");
}

/** The import (and placement) of a finished download: this call's one undo step. */
async function importDownload(call: ToolCall, job: IngestJob): Promise<Final> {
  if (job.error !== undefined) {
    if (isWebVideoError(job.error) && job.error.code === "unavailable") {
      const reason = job.error.message;
      const answer = (): ToolOutcome => unavailable(TOOL, reason);
      return { fresh: answer(), replay: answer };
    }
    return failure(job, humanizeIngestFailure(job.error));
  }
  const download = job.download!;
  const direct = download.direct;
  let media: ImportedMedia;
  try {
    media = await call.host.media!.importPath!.call(call.host.media, download.path);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return failure(job, direct ? `Could not import the file into the media bin: ${why}` : `Downloaded OK but import into the project failed: ${why}`);
  }

  // A web page's video is named after the page and tagged as a web reference; a direct link keeps its file name.
  const patch: Partial<ProjectFile> = direct
    ? {}
    : { tags: webVideoTags(job.intent, download.isYoutube), ...(download.title ? { name: pySlice(download.title, 0, 120) } : {}) };
  let placementError = "";
  let plan: Awaited<ReturnType<typeof planPlacement>> | undefined;
  if (job.place) {
    plan = await planPlacement(call, provisionalFile(media, patch), { position_seconds: job.positionSeconds ?? "", track: job.track ?? "" });
    placementError = typeof plan === "string" ? plan : lockedTrackError(plan.layer, call.doc.project.layers);
  }
  const { file, clip } = call.commit((tx) => {
    const added = addFile(tx, media, { ...(patch.name ? { name: patch.name } : {}), ...(patch.tags ? { tags: patch.tags } : {}) });
    if (!plan || typeof plan === "string" || placementError) return { file: added, clip: undefined };
    return { file: added, clip: applyPlacement(tx, String(added.id), plan) };
  });
  const fileId = String(file.id);
  const placement = clip && plan && typeof plan !== "string" ? placementText(call.doc.project, plan, clip) : placementError;
  const placed = Boolean(clip);

  let payload: Payload;
  if (direct) {
    payload = placed
      ? {
          ok: true,
          intent: job.intent,
          file_id: fileId,
          placed: true,
          url: job.url,
          message: `✅ Video imported (file_id: ${fileId}, ${pyFixed(sizeMb(media), 1)} MB) and added to the timeline.\n${placement}`,
          next: "Direct media URL imported and placed on the timeline.",
          product_note: DIRECT_NOTE,
        }
      : {
          ok: true,
          intent: job.intent,
          file_id: fileId,
          placed: false,
          url: job.url,
          message: "Direct media URL imported to media bin.",
          next: "Colour: match_color_to_reference_tool(referenceFileId=file_id). Timeline: add_clip_to_timeline_tool(file_id=...).",
          product_note: DIRECT_NOTE,
        };
  } else {
    const next: string[] = [];
    if (job.intent === "reference" || job.intent === "recreate") next.push(`Colour match: match_color_to_reference_tool(referenceFileId="${fileId}").`);
    if (job.intent === "recreate") {
      next.push("Recreate with the user's clips / stock_video / video_gen — do not leave the YouTube original on the story cut unless asked.");
    }
    if (job.intent === "timeline" && !placed) next.push(`Place with add_clip_to_timeline_tool(file_id="${fileId}").`);
    if (download.subtitlePaths.length > 0) next.push("Subtitles cached (paths in subtitle_paths); caption tool can consume later.");
    payload = {
      ok: !job.place || placed,
      intent: job.intent,
      file_id: fileId,
      placed,
      url: download.webpageUrl || job.url,
      title: download.title,
      duration_seconds: download.durationSeconds,
      extractor: download.extractor,
      is_youtube: download.isYoutube,
      subtitle_paths: download.subtitlePaths,
      cache_purged: download.cachePurged,
      placement: job.place ? placement : "",
      message: `Ingested “${download.title || "video"}” as media_bin file_id=${fileId}.`,
      next: next.join(" "),
      product_note: PAGE_NOTE,
      undo: "one step",
    };
  }
  if (job.place && !placed) {
    payload.ok = false;
    payload.error = placementError || "Timeline placement failed after import.";
    payload.message = `Imported to media bin as file_id=${fileId}, but timeline placement failed.`;
    payload.next = `Place with add_clip_to_timeline_tool(file_id="${fileId}").`;
  }
  const data = jobPayload(job, payload);
  const summary = summaryOf(data);
  const warnings = placed || !job.place ? [] : [String(data.error)];
  // The import is this call's change; the answer repeats it, unchanged, to later calls with the job_id.
  return {
    fresh: applied(TOOL, summary, { data, warnings }),
    replay: () => unchanged(TOOL, summary, { data, warnings }),
  };
}

/** Wait for the job, then answer: running, or the finished job (importing it now if nobody has). */
async function settle(call: ToolCall, jobs: IngestJobs, job: IngestJob, waitSeconds: number): Promise<ToolOutcome> {
  await waitFor(job, waitSeconds * 1000, call.signal);
  if (job.final) return job.final.replay();
  if (!job.settled) {
    const data = runningPayload(job);
    return unchanged(TOOL, `${String(data.message)} ${String(data.next)}`, { data });
  }
  if (job.importing) return (await job.importing).replay();
  job.importing = importDownload(call, job)
    .catch((error: unknown) => failure(job, `Downloaded OK but import into the project failed: ${error instanceof Error ? error.message : String(error)}`))
    .then((final) => {
      jobs.finish(job, final);
      return final;
    });
  return (await job.importing).fresh;
}

/** "1/true/yes/on" (str(x or "").strip().lower()). */
function truthy(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export const webVideoTools: CatalogTool[] = [
  contractTool("ingest_web_video_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requires: ["media"],
    run: async (call, input) => {
      const media = call.host.media!;
      if (!media.fetchWebVideo) return unavailable(TOOL, HOSTED_WEB_VIDEO_REASON);
      if (!media.importPath) return unavailable(TOOL, "it cannot import downloaded files into the project.");
      const jobs = jobsOf(media);
      jobs.purge();

      const jobId = text(input.job_id);
      const rawUrl = text(input.url) || text(input.video_url);
      if (jobId) {
        const job = jobs.get(jobId);
        if (!job) {
          return refuse(
            `Unknown ingest job_id '${jobId}'. Pass the job_id from the status=running reply, or call again with url= to start fresh.`,
            rawUrl,
            text(input.intent),
          );
        }
        return settle(call, jobs, job, INGEST_WAIT.pollSeconds);
      }

      if (!rawUrl) return refuse("Paste a YouTube (or other site) video link — url is required.");
      let intent: WebVideoIntent;
      try {
        intent = normalizeWebVideoIntent(input.intent || "reference");
      } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error), rawUrl);
      }
      if (!isProbableWebVideoUrl(rawUrl)) return refuse(NOT_HTTP_URL_MESSAGE, rawUrl, intent);
      // Only the timeline intent places; recreate never does, whatever place says.
      const place = intent === "timeline" || (intent !== "recreate" && truthy(input.place));
      const subsArg = String(input.write_subs || "").trim();
      const writeSubs = subsArg === "" ? intent === "reference" || intent === "recreate" : truthy(subsArg);

      if (place) {
        // A placement that cannot work is refused before anything is downloaded (the desktop finds out after).
        try {
          parseSecondsArg(input.position_seconds, null, "position_seconds");
        } catch (error) {
          if (error instanceof TimeArgError) return refuse(error.message, rawUrl, intent);
          throw error;
        }
        const track = resolvePlacementTrack(input.track === undefined ? "" : String(input.track), call.doc.project.layers);
        if (track.error) return refuse(track.error, rawUrl, intent);
        if (track.layer !== undefined) {
          const locked = lockedTrackError(track.layer, call.doc.project.layers);
          if (locked) return refuse(locked, rawUrl, intent);
        }
      }

      const key = `${rawUrl}\u0000${intent}\u0000${place}`;
      const running = jobs.open(key);
      if (running) return settle(call, jobs, running, INGEST_WAIT.pollSeconds);
      const fetchVideo = media.fetchWebVideo.bind(media);
      const job: IngestJob = {
        id: newJobId(),
        url: rawUrl,
        intent,
        place,
        track: input.track,
        positionSeconds: input.position_seconds,
        key,
        settled: false,
        updatedAt: Date.now(),
        // The download outlives this call (no signal): later calls with the job_id collect it.
        fetched: fetchVideo({ url: rawUrl, intent, writeSubs }).then(
          (download) => {
            job.download = download;
          },
          (error: unknown) => {
            job.error = error;
          },
        ).finally(() => {
          job.settled = true;
          job.updatedAt = Date.now();
        }),
      };
      jobs.add(job);
      return settle(call, jobs, job, INGEST_WAIT.firstSeconds);
    },
  }),
];
