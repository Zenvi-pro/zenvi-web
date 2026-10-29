import { describe, expect, it } from "vitest";
import { getTool } from "../tools/registry.js";
import {
  fixToolsFor,
  isWatchError,
  normalizeCritique,
  WATCH_DIMENSION_NAMES,
  WATCH_FIX_TOOLS,
  WatchError,
  watchHttpError,
  watchUserText,
} from "./watch.js";

describe("watch critique", () => {
  it("normalizes like the backend: clamped scores and times, unknown names folded, worst first, six at most", () => {
    const issue = { start: -3, end: 99, dimension: "Vibes", severity: "urgent", problem: "p", fix: "f" };
    const out = normalizeCritique(
      {
        overall: 14,
        scores: { hook: 0, pacing: "7.26" },
        issues: [{ ...issue, severity: "low" }, ...Array(8).fill(issue), { start: 1, problem: "no fix" }, "junk"],
        strengths: ["a", "", "b", "c", "d"],
        would_post: true,
      },
      12,
    );
    expect(out.overall).toBe(10);
    expect(out.scores.hook).toBe(1);
    expect(out.scores.pacing).toBe(7.3);
    expect(out.scores.mix).toBeNull();
    expect(Object.keys(out.scores)).toEqual(WATCH_DIMENSION_NAMES);
    expect(out.issues).toHaveLength(6);
    expect(out.issues[0]).toEqual({ start: 0, end: 12, dimension: "other", severity: "medium", problem: "p", fix: "f" });
    expect(out.issues.every((i) => i.severity === "medium")).toBe(true);
    expect(out.strengths).toEqual(["a", "b", "c"]);
    expect(out.wouldPost).toBe(true);
    expect(normalizeCritique({ scores: { hook: 4, pacing: 6 } }, 5).overall).toBe(5);
    expect(normalizeCritique(null, 5).issues).toEqual([]);
  });

  it("asks in seconds, with the focus, the brief and the timeline", () => {
    const text = watchUserText(14.5, { brief: "SaaS promo", focus: ["typography"], timelineNotes: "shot 1 0.00-3.20 a.mp4" });
    expect(text).toContain("14.50 seconds long");
    expect(text).toContain("put their issues first: typography.");
    expect(text).toContain("SaaS promo");
    expect(text).toContain("shot 1 0.00-3.20 a.mp4");
    expect(watchUserText(3)).not.toContain("asked to make");
  });

  it("maps the backend's refusals to codes and words", () => {
    expect(watchHttpError(401, {}).code).toBe("sign_in");
    expect(watchHttpError(402, { detail: { code: "insufficient_credits", message: "Need 7, have 0" } }).message).toBe("not enough Zenvi credits to watch this render: Need 7, have 0.");
    expect(watchHttpError(413, { detail: { code: "video_too_large", message: "Video is over 25 MB; downscale it first" } }).code).toBe("too_large");
    expect(watchHttpError(422, { detail: { code: "video_too_long", message: "Video is 95.0 s; watch takes at most 90 s" } }).code).toBe("too_long");
    expect(watchHttpError(422, { detail: { code: "unreadable_video", message: "not a video" } }).code).toBe("rejected");
    expect(watchHttpError(404, "Not Found").code).toBe("unavailable");
    expect(watchHttpError(502, { detail: { code: "watch_failed", message: "Gemini returned no critique" } }).message).toBe("the watch failed (HTTP 502): Gemini returned no critique.");
    const copy = Object.assign(new Error("x"), { name: "WatchError", code: "credits" });
    expect(isWatchError(copy)).toBe(true);
    expect(isWatchError(new WatchError("failed", "x"))).toBe(true);
    expect(isWatchError(new Error("x"))).toBe(false);
  });

  it("names the tools a fix asks for before its dimension's, and only tools that exist", () => {
    expect(fixToolsFor({ dimension: "pacing", problem: "", fix: "Add a whoosh on the cut at 2 s" })).toEqual(["add_sfx_tool", "trim_clip_tool", "detect_beats_tool"]);
    expect(fixToolsFor({ dimension: "mix", problem: "", fix: "Duck the music 8 dB under the voice" })).toEqual(["duck_tool", "master_audio_tool", "set_clip_volume_tool"]);
    expect(fixToolsFor({ dimension: "other", problem: "", fix: "Something vague" })).toEqual(["review_edit_tool"]);
    expect(fixToolsFor({ dimension: "sound_design", problem: "", fix: "Add sub-bass hits on the downbeats" })[0]).toBe("add_sfx_tool");
    const named = new Set(Object.values(WATCH_FIX_TOOLS).flat());
    for (const words of ["whoosh", "duck", "louder", "trim", "speed ramp", "whip", "match cut", "grade", "captions", "title", "end card", "swap the shot"]) {
      for (const tool of fixToolsFor({ dimension: "other", problem: "", fix: words })) named.add(tool);
    }
    expect([...named].filter((tool) => !getTool(tool))).toEqual([]);
  });
});
