/**
 * The web video rules, ported with the cases of zenvi-core develop
 * tests/test_web_video_ingest.py that need no download.
 */

import { describe, expect, it } from "vitest";
import {
  WebVideoError,
  cacheSatisfiesRequest,
  cooldownMessage,
  formatSelectorForIntent,
  humanizeIngestFailure,
  isDirectMediaUrl,
  isProbableWebVideoUrl,
  isRateLimitError,
  isYoutubeUrl,
  normalizeWebVideoIntent,
  requestedHeightForIntent,
  wantsSubtitles,
} from "./web-video.js";

describe("web video URLs", () => {
  it("knows page URLs, YouTube hosts and direct media links (test_url_helpers)", () => {
    expect(isProbableWebVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isProbableWebVideoUrl("http://example.com/watch?v=1")).toBe(true);
    expect(isProbableWebVideoUrl("/tmp/local.mp4")).toBe(false);
    expect(isProbableWebVideoUrl("file:///tmp/x.mp4")).toBe(false);
    expect(isProbableWebVideoUrl("")).toBe(false);
    expect(isYoutubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isYoutubeUrl("https://youtu.be/abc")).toBe(true);
    expect(isYoutubeUrl("https://gaming.youtube.com/watch?v=abc")).toBe(true);
    expect(isYoutubeUrl("https://vimeo.com/1")).toBe(false);
    expect(isDirectMediaUrl("https://cdn.example.com/clip.MP4?sig=1")).toBe(true);
    expect(isDirectMediaUrl("https://cdn.example.com/clip.webm")).toBe(true);
    expect(isDirectMediaUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
    expect(isDirectMediaUrl("https://cdn.example.com/song.mp3")).toBe(false);
  });
});

describe("normalizeWebVideoIntent", () => {
  it("maps the aliases; vague words never mean timeline (test_normalize_intent_aliases)", () => {
    expect(normalizeWebVideoIntent("ref")).toBe("reference");
    expect(normalizeWebVideoIntent("grade")).toBe("reference");
    expect(normalizeWebVideoIntent(" Colour ")).toBe("reference");
    expect(normalizeWebVideoIntent("place")).toBe("timeline");
    expect(normalizeWebVideoIntent("ADD")).toBe("timeline");
    expect(normalizeWebVideoIntent("remake")).toBe("recreate");
    expect(normalizeWebVideoIntent("")).toBe("reference");
    expect(normalizeWebVideoIntent(undefined)).toBe("reference");
    expect(() => normalizeWebVideoIntent("edit")).toThrow(WebVideoError);
    expect(() => normalizeWebVideoIntent("Explode")).toThrow("Unknown intent 'Explode'. Use reference, timeline, or recreate.");
  });
});

describe("format selection", () => {
  it("caps reference lower than timeline (test_format_selector_caps_reference_lower_than_timeline)", () => {
    expect(requestedHeightForIntent("reference")).toBe(720);
    expect(requestedHeightForIntent("recreate")).toBe(720);
    expect(requestedHeightForIntent("timeline")).toBe(1080);
    expect(formatSelectorForIntent("reference")).toContain("720");
    expect(formatSelectorForIntent("timeline")).toContain("1080");
    expect(formatSelectorForIntent("timeline")).toBe("bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best");
  });

  it("asks for single files without ffmpeg (test_format_selector_without_ffmpeg_avoids_plus_merge)", () => {
    const selector = formatSelectorForIntent("reference", false);
    expect(selector).not.toContain("+");
    expect(selector).toContain("720");
  });

  it("wants subtitles for reference and recreate, or when asked", () => {
    expect(wantsSubtitles("reference", false)).toBe(true);
    expect(wantsSubtitles("recreate", false)).toBe(true);
    expect(wantsSubtitles("timeline", false)).toBe(false);
    expect(wantsSubtitles("timeline", true)).toBe(true);
  });
});

describe("cacheSatisfiesRequest", () => {
  it("rejects a cache too low for the intent or without wanted subtitles (test_cache_satisfies_request_rejects_low_height_and_missing_subs)", () => {
    const low = { height: 720, requested_height: 720, subtitle_paths: [], write_subs_requested: false };
    expect(cacheSatisfiesRequest(low, "reference", false)).toBe(false);
    expect(cacheSatisfiesRequest(low, "timeline", false)).toBe(false);
    const hi = { height: 1080, requested_height: 1080, subtitle_paths: ["/a.vtt"], write_subs_requested: true };
    expect(cacheSatisfiesRequest(hi, "timeline", false)).toBe(true);
    expect(cacheSatisfiesRequest(hi, "reference", true)).toBe(true);
    const tried = { height: 720, requested_height: 720, subtitle_paths: [], write_subs_requested: true };
    expect(cacheSatisfiesRequest(tried, "reference", true)).toBe(true);
  });

  it("reuses a cache of unknown height only for the height it was asked at", () => {
    expect(cacheSatisfiesRequest({ requested_height: 720 }, "timeline", false)).toBe(false);
    expect(cacheSatisfiesRequest({ requested_height: 1080 }, "timeline", false)).toBe(true);
    expect(cacheSatisfiesRequest({}, "timeline", false)).toBe(true);
  });
});

describe("humanizeIngestFailure", () => {
  it("is brief, and keeps a WebVideoError's own words (test_humanize_ingest_failure_is_brief)", () => {
    expect(humanizeIngestFailure(new Error("Merging requires ffmpeg")).toLowerCase()).toContain("ffmpeg");
    const unavailable = humanizeIngestFailure(new Error("ERROR: [youtube] abc: Video unavailable")).toLowerCase();
    expect(unavailable).toContain("unavailable");
    expect(unavailable).toContain("mp4");
    const restricted = humanizeIngestFailure(new Error("This video is age-restricted")).toLowerCase();
    expect(restricted).toContain("restricted");
    expect(restricted).toContain("import");
    expect(humanizeIngestFailure(new WebVideoError("failed", "Paste a link."))).toBe("Paste a link.");
    expect(humanizeIngestFailure(new Error("line1\nline2\nTRACE"))).not.toContain("\n");
    expect(humanizeIngestFailure(new Error("HTTP Error 429: Too Many Requests")).toLowerCase()).toContain("rate-limited");
    expect(humanizeIngestFailure(new Error("Connection timed out"))).toBe("Pull timed out. Check the network and try again, or upload an MP4 yourself.");
    expect(humanizeIngestFailure(new Error("x".repeat(300)))).toBe(`Pull failed (${"x".repeat(177)}...). Download the MP4 yourself and import it (Imports / import_files_tool).`);
    expect(humanizeIngestFailure(new TypeError(""))).toBe("Pull failed (TypeError). Download the MP4 yourself and import it (Imports / import_files_tool).");
  });

  it("knows a rate limit, and how long the link cools down", () => {
    expect(isRateLimitError("HTTP Error 429: Too Many Requests")).toBe(true);
    expect(isRateLimitError("Video unavailable")).toBe(false);
    expect(cooldownMessage(590)).toBe("YouTube is still rate-limiting this link. Wait about 10 minute(s), or upload an MP4 yourself.");
    expect(cooldownMessage(5)).toContain("about 1 minute(s)");
  });
});
