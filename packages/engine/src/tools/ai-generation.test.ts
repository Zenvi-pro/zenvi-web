/**
 * AI generation and capture on the web surfaces, through runTool with string
 * arguments the way the Zenvi Assistant sends them:
 * generate_image_and_add_to_timeline_tool (the backend's image generation),
 * ingest_web_video_tool (a web page's video through the host's yt-dlp, with
 * the desktop's long-poll jobs) and the desktop-only ComfyUI and recording
 * tools. Ported from zenvi-core develop
 * tests/test_editor_tools_ai_generation_legacy.py (image generation) and
 * tests/test_web_video_ingest.py (the tool cases).
 */

import { afterEach, describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import { WebVideoError, type WebVideoDownload, type WebVideoRequest } from "../web-video/web-video.js";
import { INGEST_WAIT } from "./catalog/web-video.js";
import type { ToolReceipt } from "./receipt.js";
import { runTool } from "./registry.js";
import { PNG_1PX, fakeHost, fakeWebVideoDownload, type FakeHost, type FakeHostOptions } from "./test-support/fake-host.js";
import { IDS, L1, L2, fixtureDoc, snapshotOf } from "./test-support/fixture.js";

type Data = Record<string, unknown>;

async function call(doc: ProjectDocument, host: FakeHost, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolReceipt> {
  const result = await runTool({ doc, host, ...(signal ? { signal } : {}) }, tool, args);
  expect(result.text).toBe(JSON.stringify(result.data));
  return result.data!;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function lockTrack(doc: ProjectDocument, layer: number): void {
  doc.transaction("lock", (tx) => tx.update(["layers", { number: layer }], { lock: true }));
}

// ---------------------------------------------------------------------------
// generate_image_and_add_to_timeline_tool
// ---------------------------------------------------------------------------

const IMAGE = "generate_image_and_add_to_timeline_tool";

describe("generate_image_and_add_to_timeline_tool", () => {
  it("generates in the project's aspect, imports and places the image as one undo step", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const before = snapshotOf(doc.project);
    const receipt = await call(doc, host, IMAGE, { prompt: "  a red fox in snow ", position_seconds: "4", track: "2", duration_seconds: "3" });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toMatch(/^Added clip to timeline at position 4\.0s on track 2000000 .* duration=3\.00s timeline_clip_id=\w+\.$/);
    expect(receipt.undoSteps).toBe(1);
    expect(host.backendCalls).toEqual([{ path: "/api/v1/generation/image", method: "POST", body: { prompt: "a red fox in snow", width: 1920, height: 1080 } }]);

    const image = doc.project.files.at(-1)!;
    expect(image.media_type).toBe("image");
    expect(String(image.path)).toMatch(/^\/generated\/generated_[a-z0-9]{12}\.png$/);
    expect(image.name).toBe("a red fox in snow");
    expect(image.tags).toBe("ai_generated");
    expect(image.ai_metadata).toEqual({ short_summary: "a red fox in snow", description: "a red fox in snow", analyzed: true, source: "ai_image_generation" });
    expect(host.written.get(String(image.path))).toEqual(Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0)));
    const clip = doc.project.clips.find((c) => c.file_id === image.id)!;
    expect({ position: clip.position, layer: clip.layer, length: Number(clip.end) - Number(clip.start) }).toEqual({ position: 4, layer: L2, length: 3 });
    expect(receipt.clips.map((c) => c.id)).toEqual([clip.id]);

    expect(doc.undo()).toHaveLength(1);
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("stays on screen five seconds by default and goes after the last clip", async () => {
    const doc = fixtureDoc();
    const receipt = await call(doc, fakeHost(), IMAGE, { prompt: "a red fox" });
    expect(receipt.status).toBe("applied");
    const clip = doc.project.clips.find((c) => c.file_id === doc.project.files.at(-1)!.id)!;
    expect(Number(clip.end) - Number(clip.start)).toBeCloseTo(5);
    expect({ position: clip.position, layer: clip.layer }).toEqual({ position: 19, layer: L1 });
  });

  it("asks for the frame's shape: portrait 1080x1920, square 1440x1440", async () => {
    for (const [profile, size] of [
      ["FHD Vertical 1080p 30 fps", { width: 1080, height: 1920 }],
      ["HD Square 1080p 30 fps", { width: 1440, height: 1440 }],
    ] as const) {
      const doc = new ProjectDocument(createProject({ id: "PROJECT001", profile }));
      const host = fakeHost();
      const receipt = await call(doc, host, IMAGE, { prompt: "a red fox" });
      expect(receipt.status, profile).toBe("applied");
      expect(host.backendCalls[0]?.body, profile).toMatchObject(size);
    }
  });

  it("checks its arguments and where the image goes before spending credits", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ prompt: " " }, /^Error: Prompt must be at least 2 characters\.$/],
      [{ prompt: "a fox", duration_seconds: "soon" }, /^Error: duration_seconds='soon' is not a time in seconds/],
      [{ prompt: "a fox", duration_seconds: "0" }, /^Error: duration_seconds must be greater than 0\.$/],
      [{ prompt: "a fox", position_seconds: "later" }, /^Error: position_seconds='later' is not a time in seconds/],
      [{ prompt: "a fox", track: "Nope" }, /^Error: Unknown track or layer 'Nope'/],
    ];
    for (const [args, message] of cases) {
      const doc = fixtureDoc();
      const host = fakeHost();
      const receipt = await call(doc, host, IMAGE, args);
      expect(receipt.status, JSON.stringify(args)).toBe("error");
      expect(receipt.summary, JSON.stringify(args)).toMatch(message);
      expect(host.backendCalls, JSON.stringify(args)).toEqual([]);
      expect(doc.undoLabels).toEqual([]);
    }
    const doc = fixtureDoc();
    lockTrack(doc, L2);
    const host = fakeHost();
    const locked = await call(doc, host, IMAGE, { prompt: "a fox", track: "2" });
    expect(locked.summary).toMatch(/^Error: Track 2000000 .* is locked\.$/);
    expect(host.backendCalls).toEqual([]);
  });

  it("reports the backend's refusal (credits) and bad image data, adding nothing", async () => {
    const cases: [FakeHostOptions, string][] = [
      [{ routes: { "/api/v1/generation/image": () => ({ error: "Out of credits for image generation." }) } }, "Error: Out of credits for image generation."],
      [
        {
          routes: {
            "/api/v1/generation/image": () => {
              throw new Error("Zenvi backend 402: Out of credits for image generation. Need 3, have 0.");
            },
          },
        },
        "Error: Zenvi backend 402: Out of credits for image generation. Need 3, have 0.",
      ],
      [{ routes: { "/api/v1/generation/image": () => ({ image_base64: "not base64!" }) } }, "Error: The backend returned no image data."],
      [{ routes: { "/api/v1/generation/image": () => ({ image_base64: "" }) } }, "Error: The backend returned no image data."],
    ];
    for (const [options, summary] of cases) {
      const doc = fixtureDoc();
      const before = snapshotOf(doc.project);
      const receipt = await call(doc, fakeHost(options), IMAGE, { prompt: "a red fox" });
      expect(receipt.status).toBe("error");
      expect(receipt.summary).toBe(summary);
      expect(receipt.undoSteps).toBe(0);
      expect(snapshotOf(doc.project)).toEqual(before);
      expect(doc.undoLabels).toEqual([]);
    }
  });

  it("names a JPEG .jpg and stores it as image/jpeg", async () => {
    const doc = fixtureDoc();
    const host = fakeHost({ routes: { "/api/v1/generation/image": () => ({ image_base64: "/9j/4AAQ", mime_type: "image/jpeg" }) } });
    const receipt = await call(doc, host, IMAGE, { prompt: "a red fox" });
    expect(receipt.status).toBe("applied");
    expect(String(doc.project.files.at(-1)!.path)).toMatch(/\.jpg$/);
  });

  it("keeps the paid-for image in Project Files when the track was locked while it generated", async () => {
    const doc = fixtureDoc();
    const host = fakeHost({
      routes: {
        "/api/v1/generation/image": () => {
          // The person locks the track in the editor while the image generates.
          lockTrack(doc, L1);
          return { image_base64: PNG_1PX, mime_type: "image/png" };
        },
      },
    });
    const receipt = await call(doc, host, IMAGE, { prompt: "a red fox", duration_seconds: "2.5" });
    const fileId = doc.project.files.at(-1)!.id;
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe(
      `Image imported (file_id=${fileId}) but timeline placement failed: Error: Track 1000000 (stack_from_bottom=1, z_from_bottom=0) is locked.. ` +
        `Do NOT regenerate — call add_clip_to_timeline_tool(file_id='${fileId}', track=<layer_number from list_layers_tool>, position_seconds=..., duration_seconds=2.5).`,
    );
    expect(receipt.data).toEqual({ file_id: fileId });
    expect(doc.project.clips.some((c) => c.file_id === fileId)).toBe(false);
    expect(doc.undoLabels.at(-1)).toBe("Generate image");
  });

  it("is not available where generated media cannot be stored", async () => {
    const receipt = await call(fixtureDoc(), fakeHost({ omit: ["media.writeGenerated"] }), IMAGE, { prompt: "a red fox" });
    expect(receipt.status).toBe("refused");
    expect(receipt.summary).toBe("Error: generate_image_and_add_to_timeline_tool is not available in this Zenvi surface: it cannot store generated images.");
  });
});

// ---------------------------------------------------------------------------
// ingest_web_video_tool
// ---------------------------------------------------------------------------

const INGEST = "ingest_web_video_tool";
const YT = "https://youtu.be/abc";
const DEFAULT_WAIT = { ...INGEST_WAIT };

afterEach(() => Object.assign(INGEST_WAIT, DEFAULT_WAIT));

describe("ingest_web_video_tool", () => {
  it("reference: Project Files only, tagged and named after the page, one undo step (test_ingest_web_video_tool_reference_imports_without_place)", async () => {
    const doc = fixtureDoc();
    const host = fakeHost({ webVideo: async (request) => fakeWebVideoDownload(request, { title: "Look Ref", durationSeconds: 30 }) });
    const receipt = await call(doc, host, INGEST, { url: YT, intent: "reference" });
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(host.calls).toContain(`fetchWebVideo ${YT} reference subs=true`);
    const file = doc.project.files.at(-1)!;
    expect({ name: file.name, tags: file.tags, path: file.path }).toEqual({ name: "Look Ref", tags: "web_video, reference, youtube", path: "/cache/web/abc.mp4" });
    expect(doc.project.clips.some((c) => c.file_id === file.id)).toBe(false);
    const data = receipt.data as Data;
    expect(data).toMatchObject({
      ok: true,
      intent: "reference",
      file_id: file.id,
      placed: false,
      url: YT,
      title: "Look Ref",
      duration_seconds: 30,
      extractor: "youtube",
      is_youtube: true,
      subtitle_paths: [],
      cache_purged: 0,
      placement: "",
      message: `Ingested “Look Ref” as media_bin file_id=${file.id}.`,
      next: `Colour match: match_color_to_reference_tool(referenceFileId="${file.id}").`,
      undo: "one step",
      status: "completed",
    });
    expect(String(data.job_id)).not.toBe("");
    expect(receipt.summary).toBe(`Ingested “Look Ref” as media_bin file_id=${file.id}.\nColour match: match_color_to_reference_tool(referenceFileId="${file.id}").`);
  });

  it("timeline: places it, without subtitles by default; import and placement undo together", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const before = snapshotOf(doc.project);
    const receipt = await call(doc, host, INGEST, { url: YT, intent: "add", position_seconds: "30", track: "2" });
    expect(host.calls).toContain(`fetchWebVideo ${YT} timeline subs=false`);
    expect(receipt.status).toBe("applied");
    const file = doc.project.files.at(-1)!;
    const clip = doc.project.clips.find((c) => c.file_id === file.id)!;
    expect({ position: clip.position, layer: clip.layer }).toEqual({ position: 30, layer: L2 });
    expect(receipt.clips.map((c) => c.id)).toEqual([clip.id]);
    const data = receipt.data as Data;
    expect(data).toMatchObject({ ok: true, intent: "timeline", placed: true, status: "completed", next: "" });
    expect(String(data.placement)).toMatch(/^Added clip to timeline at position 30\.0s on track 2000000 .*timeline_clip_id=\w+\.$/);
    expect(receipt.summary).toBe(`${String(data.message)}\n${String(data.placement)}`);
    expect(file.tags).toBe("web_video, timeline, youtube");
    doc.undo();
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("recreate never places, even with place=true, and marks the file reference_only", async () => {
    const doc = fixtureDoc();
    const receipt = await call(doc, fakeHost(), INGEST, { url: "https://vimeo.com/123", intent: "remake", place: "true" });
    const file = doc.project.files.at(-1)!;
    expect(file.tags).toBe("web_video, recreate, web, reference_only");
    const data = receipt.data as Data;
    expect(data).toMatchObject({ placed: false, intent: "recreate", is_youtube: false, extractor: "generic" });
    expect(String(data.next)).toContain("Recreate with the user's clips / stock_video / video_gen");
    expect(doc.project.clips.some((c) => c.file_id === file.id)).toBe(false);
  });

  it("place=true places a reference too; write_subs and found subtitles are passed on", async () => {
    const doc = fixtureDoc();
    const host = fakeHost({ webVideo: async (request) => fakeWebVideoDownload(request, { subtitlePaths: ["/cache/web/media.en.vtt"] }) });
    const receipt = await call(doc, host, INGEST, { url: YT, place: true, write_subs: "true", track: "2" });
    expect(host.calls).toContain(`fetchWebVideo ${YT} reference subs=true`);
    const data = receipt.data as Data;
    expect(data).toMatchObject({ placed: true, intent: "reference", subtitle_paths: ["/cache/web/media.en.vtt"] });
    expect(String(data.next)).toContain("Subtitles cached (paths in subtitle_paths); caption tool can consume later.");
  });

  it("answers a failed pull with ok=false and a short reason, changing nothing (test_ingest_fail_json_does_not_raise)", async () => {
    const cases: [unknown, string][] = [
      [new WebVideoError("failed", "ffmpeg is required to combine YouTube video+audio."), "ffmpeg is required to combine YouTube video+audio."],
      [new Error("ERROR: [youtube] abc: Video unavailable\nThis video has been removed"), "That video is unavailable (removed, region-blocked, or bad link). Download the MP4 yourself and import it (Imports / import_files_tool)."],
      [new WebVideoError("refused", "That URL points at a private or local network address, which cannot be fetched."), "That URL points at a private or local network address, which cannot be fetched."],
    ];
    for (const [error, reason] of cases) {
      const doc = fixtureDoc();
      const before = snapshotOf(doc.project);
      const receipt = await call(doc, fakeHost({ webVideo: () => Promise.reject(error) }), INGEST, { url: YT, intent: "reference" });
      expect(receipt.status).toBe("error");
      expect(receipt.summary).toBe(`Error: ${reason}`);
      const data = receipt.data as Data;
      expect(data).toMatchObject({ ok: false, status: "failed", error: reason, url: YT, intent: "reference", file_id: "", placed: false });
      expect(String(data.next).toLowerCase()).toContain("do not retry");
      expect(snapshotOf(doc.project)).toEqual(before);
      expect(doc.undoLabels).toEqual([]);
    }
  });

  it("refuses clearly when this computer has no yt-dlp", async () => {
    const doc = fixtureDoc();
    const reason = "fetching videos from web pages needs yt-dlp on this computer, and it was not found.";
    const receipt = await call(doc, fakeHost({ webVideo: () => Promise.reject(new WebVideoError("unavailable", reason)) }), INGEST, { url: YT });
    expect(receipt.status).toBe("refused");
    expect(receipt.summary).toBe(`Error: ingest_web_video_tool is not available in this Zenvi surface: ${reason}`);
    expect(doc.undoLabels).toEqual([]);
  });

  it("is refused in words on hosted surfaces (Zenvi Cloud, the web editor), pointing to a direct link or an upload", async () => {
    const doc = fixtureDoc();
    const host = fakeHost({ omit: ["media.fetchWebVideo", "media.importPath"] });
    for (const args of [{ url: YT }, { job_id: "j1" }]) {
      const receipt = await call(doc, host, INGEST, args);
      expect(receipt.status).toBe("refused");
      expect(receipt.summary).toMatch(/^Error: ingest_web_video_tool is not available in this Zenvi surface: hosted Zenvi \(Zenvi Cloud, the web editor\) does not download videos from web pages/);
      expect(receipt.summary).toContain("import_media_from_url");
      expect(receipt.summary).toContain("upload the file");
    }
    expect(host.calls.filter((c) => c.startsWith("fetchWebVideo"))).toEqual([]);
  });

  it("checks the link, the intent and a placement before downloading anything", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{}, "Error: Paste a YouTube (or other site) video link — url is required."],
      [{ url: YT, intent: "edit" }, "Error: Unknown intent 'edit'. Use reference, timeline, or recreate."],
      [{ url: "/tmp/local.mp4" }, "Error: URL must be http(s). Local paths use import_files_tool; direct MP4s may use import_video_url_and_add_to_timeline_tool."],
      [{ url: "file:///tmp/x.mp4" }, "Error: URL must be http(s). Local paths use import_files_tool; direct MP4s may use import_video_url_and_add_to_timeline_tool."],
      [{ url: YT, intent: "timeline", track: "Nope" }, "Error: Unknown track or layer 'Nope'. Call list_layers_tool and use layer_number (preferred), track_id, ui_track (1=bottom), or the exact label."],
      [{ url: YT, intent: "timeline", position_seconds: "soon" }, "Error: position_seconds='soon' is not a time in seconds (use seconds like 12 or 12.5, or a timecode like 0:12)"],
      [{ job_id: "nope" }, "Error: Unknown ingest job_id 'nope'. Pass the job_id from the status=running reply, or call again with url= to start fresh."],
    ];
    for (const [args, summary] of cases) {
      const doc = fixtureDoc();
      const host = fakeHost();
      const receipt = await call(doc, host, INGEST, args);
      expect(receipt.status, JSON.stringify(args)).toBe("refused");
      expect(receipt.summary, JSON.stringify(args)).toBe(summary);
      expect((receipt.data as Data).ok).toBe(false);
      expect(host.calls.filter((c) => c.startsWith("fetchWebVideo")), JSON.stringify(args)).toEqual([]);
      expect(doc.undoLabels).toEqual([]);
    }
    const doc = fixtureDoc();
    lockTrack(doc, L2);
    const locked = await call(doc, fakeHost(), INGEST, { url: YT, intent: "timeline", track: "2" });
    expect(locked.summary).toMatch(/^Error: Track 2000000 .* is locked\.$/);
  });

  it("answers status=running before a client gives up, joins the running download, and imports when a job_id call finds it done (test_ingest_returns_running_then_completes_via_job_id)", async () => {
    INGEST_WAIT.firstSeconds = 0.05;
    INGEST_WAIT.pollSeconds = 0.05;
    const download = deferred<WebVideoDownload>();
    const requests: WebVideoRequest[] = [];
    const doc = fixtureDoc();
    const host = fakeHost({
      webVideo: (request) => {
        requests.push(request);
        return download.promise;
      },
    });

    const first = await call(doc, host, INGEST, { url: YT, intent: "timeline" });
    expect(first.status).toBe("unchanged");
    expect(first.undoSteps).toBe(0);
    const running = first.data as Data;
    expect(running).toMatchObject({ ok: true, status: "running", url: YT, intent: "timeline", file_id: "", placed: false });
    const jobId = String(running.job_id);
    expect(jobId).not.toBe("");
    expect(String(running.next)).toContain(`ingest_web_video_tool(job_id="${jobId}")`);
    expect(String(running.next)).toContain("~45s");
    expect(first.summary).toContain("This is not a failure.");

    // The same link while it downloads joins the job instead of starting a second download.
    const again = await call(doc, host, INGEST, { url: YT, intent: "timeline" });
    expect((again.data as Data).job_id).toBe(jobId);
    expect((again.data as Data).status).toBe("running");
    expect(requests).toHaveLength(1);
    expect(doc.undoLabels).toEqual([]);

    download.resolve(fakeWebVideoDownload(requests[0]!, { title: "Slow" }));
    const done = await call(doc, host, INGEST, { job_id: jobId });
    expect(done.status).toBe("applied");
    expect(done.undoSteps).toBe(1);
    expect(done.data as Data).toMatchObject({ ok: true, status: "completed", job_id: jobId, placed: true, title: "Slow" });
    const fileId = (done.data as Data).file_id;
    expect(doc.project.files.at(-1)!.id).toBe(fileId);

    // Asking again repeats the answer and changes nothing.
    const replay = await call(doc, host, INGEST, { job_id: jobId });
    expect(replay.status).toBe("unchanged");
    expect(replay.undoSteps).toBe(0);
    expect((replay.data as Data).file_id).toBe(fileId);
    expect(doc.undoLabels).toHaveLength(1);
    // A finished job no longer collects new calls for the link: that is a new download.
    await call(doc, host, INGEST, { url: YT, intent: "timeline" });
    expect(requests).toHaveLength(2);
  });

  it("wakes a job_id call as soon as the download finishes (test_ingest_job_id_returns_as_soon_as_worker_finishes)", async () => {
    INGEST_WAIT.firstSeconds = 0.02;
    INGEST_WAIT.pollSeconds = 3;
    const download = deferred<WebVideoDownload>();
    const doc = fixtureDoc();
    const host = fakeHost({ webVideo: () => download.promise });
    const first = await call(doc, host, INGEST, { url: YT });
    const jobId = String((first.data as Data).job_id);
    const started = Date.now();
    setTimeout(() => download.resolve(fakeWebVideoDownload({ url: YT, intent: "reference", writeSubs: true })), 100);
    const done = await call(doc, host, INGEST, { job_id: jobId });
    expect(Date.now() - started).toBeLessThan(1500);
    expect((done.data as Data).status).toBe("completed");
  });

  it("still answers running after the poll budget, and when the caller gives up (test_ingest_job_id_still_running_after_poll_budget)", async () => {
    INGEST_WAIT.firstSeconds = 0.02;
    INGEST_WAIT.pollSeconds = 0.3;
    const download = deferred<WebVideoDownload>();
    const doc = fixtureDoc();
    const host = fakeHost({ webVideo: () => download.promise });
    const jobId = String(((await call(doc, host, INGEST, { url: YT })).data as Data).job_id);
    const started = Date.now();
    const mid = await call(doc, host, INGEST, { job_id: jobId });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(mid.data as Data).toMatchObject({ status: "running", job_id: jobId });

    INGEST_WAIT.pollSeconds = 30;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const aborted = await call(doc, host, INGEST, { job_id: jobId }, controller.signal);
    expect((aborted.data as Data).status).toBe("running");
    download.reject(new WebVideoError("failed", "Pull timed out. Check the network and try again, or upload an MP4 yourself."));
    const failedPoll = await call(doc, host, INGEST, { job_id: jobId });
    expect(failedPoll.status).toBe("error");
    expect(failedPoll.data as Data).toMatchObject({ ok: false, status: "failed", job_id: jobId, error: "Pull timed out. Check the network and try again, or upload an MP4 yourself." });
    expect(doc.undoLabels).toEqual([]);
  });

  it("imports a direct media link without yt-dlp's page wording, placed when asked", async () => {
    const url = "https://cdn.example.com/clips/surf.mp4?sig=1";
    const doc = fixtureDoc();
    const bin = await call(doc, fakeHost(), INGEST, { url });
    const file = doc.project.files.at(-1)!;
    expect(bin.data as Data).toMatchObject({
      ok: true,
      intent: "reference",
      file_id: file.id,
      placed: false,
      url,
      message: "Direct media URL imported to media bin.",
      next: "Colour: match_color_to_reference_tool(referenceFileId=file_id). Timeline: add_clip_to_timeline_tool(file_id=...).",
      status: "completed",
    });
    expect(file.tags).toBeUndefined();

    const placedDoc = fixtureDoc();
    const placed = await call(placedDoc, fakeHost(), INGEST, { url, intent: "timeline" });
    const data = placed.data as Data;
    expect(data).toMatchObject({ ok: true, placed: true, next: "Direct media URL imported and placed on the timeline." });
    expect(String(data.message)).toMatch(/^✅ Video imported \(file_id: \w+, 0\.0 MB\) and added to the timeline\.\nAdded clip to timeline at position 19\.0s/);
  });

  it("keeps the import when the placement fails at import time, and says so (ok=false, one undo step)", async () => {
    INGEST_WAIT.firstSeconds = 0.02;
    const download = deferred<WebVideoDownload>();
    const doc = fixtureDoc();
    const host = fakeHost({ webVideo: () => download.promise });
    const jobId = String(((await call(doc, host, INGEST, { url: YT, intent: "timeline", track: "2" })).data as Data).job_id);
    lockTrack(doc, L2);
    download.resolve(fakeWebVideoDownload({ url: YT, intent: "timeline", writeSubs: false }));
    const receipt = await call(doc, host, INGEST, { job_id: jobId });
    const fileId = doc.project.files.at(-1)!.id;
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    const data = receipt.data as Data;
    expect(data).toMatchObject({
      ok: false,
      status: "failed",
      placed: false,
      file_id: fileId,
      message: `Imported to media bin as file_id=${fileId}, but timeline placement failed.`,
      next: `Place with add_clip_to_timeline_tool(file_id="${fileId}").`,
    });
    expect(String(data.error)).toMatch(/^Error: Track 2000000 .* is locked\.$/);
    expect(receipt.warnings).toEqual([data.error]);
    expect(doc.project.clips.some((c) => c.file_id === fileId)).toBe(false);
  });

  it("refuses a download it cannot import as a failure, not a crash", async () => {
    const doc = fixtureDoc();
    const receipt = await call(doc, fakeHost({ webVideo: async (request) => fakeWebVideoDownload(request, { path: "/cache/web/missing.mp4" }) }), INGEST, { url: YT });
    expect(receipt.status).toBe("error");
    expect(receipt.summary).toBe("Error: Downloaded OK but import into the project failed: No such file: /cache/web/missing.mp4");
    expect(doc.undoLabels).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ComfyUI and recording
// ---------------------------------------------------------------------------

describe("Zenvi desktop's ComfyUI and recording tools", () => {
  it("are refused in words, naming why and what works here, with no undo step", async () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["list_comfyui_templates_tool", {}, /ComfyUI is an optional AI server on the person's own computer that only Zenvi desktop drives \(Preferences > AI > ComfyUI URL\).*generate_image_and_add_to_timeline_tool/],
      ["list_comfyui_jobs_tool", { job_id: "j1", wait_seconds: "5" }, /no ComfyUI jobs\. Generation jobs started in Zenvi desktop are listed there\./],
      ["create_media_with_comfyui_tool", { kind: "image", prompt: "misty pine forest" }, /generate_video_and_add_to_timeline_tool make images and clips with Zenvi's cloud models/],
      ["enhance_file_with_comfyui_tool", { file_id: IDS.broll, action: "upscale" }, /Project Files > Enhance with AI/],
      ["cancel_comfyui_job_tool", { all_jobs: "true" }, /Project Files > Cancel Job/],
      ["prepare_recording_tool", { sources: ["mic"], timeline_clip_id: IDS.clipA }, /Zenvi desktop's Recording dock, which this surface does not have/],
    ];
    for (const [tool, args, reason] of cases) {
      const doc = fixtureDoc();
      const receipt = await call(doc, fakeHost(), tool, args);
      expect(receipt.status, tool).toBe("refused");
      expect(receipt.summary, tool).toMatch(new RegExp(`^Error: ${tool} is not available in this Zenvi surface: `));
      expect(receipt.summary, tool).toMatch(reason);
      expect(doc.undoLabels, tool).toEqual([]);
    }
  });
});
