/**
 * add_clip_to_timeline_tool placement rules (zenvi-core develop #168) and the
 * explicit-time slice / watch rules, through runTool.
 */

import { describe, expect, it } from "vitest";
import { blindTrimRejected, buttAgainstPreviousClip, endBoundsKeepWindow, parseSecondsArg, TimeArgError } from "./placement.js";
import { runTool } from "./registry.js";
import { fakeHost, type FakeHostOptions } from "./test-support/fake-host.js";
import { IDS, L1, fixtureDoc } from "./test-support/fixture.js";

async function place(args: Record<string, unknown>, host: FakeHostOptions = {}, doc = fixtureDoc()) {
  const result = await runTool({ doc, host: fakeHost(host) }, "add_clip_to_timeline_tool", args);
  const id = /timeline_clip_id=(\w+)/.exec(result.data!.summary)?.[1];
  return { result, doc, clip: doc.project.clips.find((c) => c.id === id) };
}

const NO_WATCH: FakeHostOptions = { without: ["frames"] };

describe("placement helpers", () => {
  it("treat an end_seconds that agrees with start + duration as the out-point", () => {
    expect(endBoundsKeepWindow(0, null, 8.5)).toBe(true);
    expect(endBoundsKeepWindow(0, 8.5, 8.5)).toBe(true);
    expect(endBoundsKeepWindow(1, 7.53, 8.5)).toBe(true);
    expect(endBoundsKeepWindow(0, 3, 8.5)).toBe(false);
    expect(endBoundsKeepWindow(0, 3, null)).toBe(false);
  });

  it("only refuse a trim with no boundary at all", () => {
    expect(blindTrimRejected({ trimDur: 3, watchedStart: null })).toBe(true);
    expect(blindTrimRejected({ trimDur: 3, watchedStart: null, hasExplicitStart: true })).toBe(false);
    expect(blindTrimRejected({ trimDur: 3, watchedStart: null, hasExplicitEnd: true })).toBe(false);
    expect(blindTrimRejected({ trimDur: 3, watchedStart: 1 })).toBe(false);
    expect(blindTrimRejected({ trimDur: 3, watchedStart: null, isAudio: true })).toBe(false);
    expect(blindTrimRejected({ trimDur: null, watchedStart: null })).toBe(false);
  });

  it("butt only a position planned on a resized clip's planned end", () => {
    const resized = [{ plannedEnd: 5, actualEnd: 4.5 }];
    expect(buttAgainstPreviousClip(5.05, resized)).toBe(4.5);
    expect(buttAgainstPreviousClip(6, resized)).toBe(6);
    expect(buttAgainstPreviousClip(5, [])).toBe(5);
  });

  it("refuse nan and inf as times", () => {
    for (const bad of ["nan", "inf", "-inf", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseSecondsArg(bad, null, "start")).toThrow(TimeArgError);
    }
    expect(parseSecondsArg("0:14", null, "start")).toBe(14);
    expect(parseSecondsArg("12s", null, "start")).toBe(12);
  });
});

describe("add_clip_to_timeline_tool", () => {
  it("appends right after the last clip on the track, without the desktop's one-frame gap", async () => {
    const { clip } = await place({ file_id: IDS.broll, full_file: "true", track: "1" });
    // Track 1 ends at 19 s (CLIPINTV02 at 15 s, 4 s long).
    expect(clip?.position).toBe(19);
    expect(clip?.layer).toBe(L1);
  });

  it("refuses a blind duration-only trim on a file nothing has looked at", async () => {
    const { result, doc } = await place({ file_id: IDS.broll, duration_seconds: "3" }, NO_WATCH);
    expect(result.data!.summary).toBe(
      "Error: duration_seconds alone cannot trim the first N seconds of a file nothing has looked at. Name both edges of the " +
        "section you want: pass start_seconds and end_seconds (the keep window search_clips returned), or place_moment with that window.",
    );
    expect(doc.undoLabels).toEqual([]);
  });

  it("names the overridden end_seconds instead of asking for it again", async () => {
    const { result } = await place({ file_id: IDS.broll, duration_seconds: "3", end_seconds: "8.5" }, NO_WATCH);
    expect(result.data!.summary).toMatch(/^Error: duration_seconds=3 overrides end_seconds=8\.5, so this would keep the first 3s/);
  });

  it("places a named keep window without a watch", async () => {
    const { result, clip } = await place({ file_id: IDS.broll, start_seconds: "0", end_seconds: "4", position_seconds: "20" }, NO_WATCH);
    expect(result.ok).toBe(true);
    expect(clip).toMatchObject({ start: 0, end: 4, position: 20 });
    expect(result.data!.summary).not.toContain("(watched)");
  });

  it("accepts start + duration that agree with end_seconds", async () => {
    const { result, clip } = await place({ file_id: IDS.broll, start_seconds: "0", end_seconds: "8.5", duration_seconds: "8.5", position_seconds: "20" }, NO_WATCH);
    expect(result.ok).toBe(true);
    expect(clip!.end - clip!.start).toBeCloseTo(8.5, 1);
  });

  it("keeps the rest of the file from start_seconds alone, and refuses one past the end", async () => {
    const { clip } = await place({ file_id: IDS.broll, start_seconds: "4", position_seconds: "20" }, NO_WATCH);
    expect(clip).toMatchObject({ start: 4, end: 12 });
    const past = await place({ file_id: IDS.broll, start_seconds: "30", position_seconds: "20" }, NO_WATCH);
    expect(past.result.data!.summary).toBe("Error: start_seconds 30 is past the end of this file (12.00s long).");
  });

  it("places the whole file for full_file, never a watched sub-window", async () => {
    const { clip, result } = await place({ file_id: IDS.broll, full_file: "true", position_seconds: "20" });
    expect(clip).toMatchObject({ start: 0, end: 12 });
    expect(result.data!.summary).not.toContain("(watched)");
  });

  it("butts a position planned on a resized clip's end against its real end, and says so", async () => {
    // Watch (fake backend) returns in/out = the asked window minus nothing; resize comes from cue snapping:
    // the interview's 0-3 s window ends inside the cue 2.5-4.5 s, so the placement is snapped shorter or longer.
    const doc = fixtureDoc();
    const first = await place({ file_id: IDS.interview, start_seconds: "0", end_seconds: "3", position_seconds: "30", track: "4" }, NO_WATCH, doc);
    const resizedEnd = first.clip!.position + (first.clip!.end - first.clip!.start);
    expect(resizedEnd).not.toBeCloseTo(33, 3);
    const second = await place({ file_id: IDS.broll, start_seconds: "0", end_seconds: "2", position_seconds: "33", track: "4" }, NO_WATCH, doc);
    expect(second.clip!.position).toBeCloseTo(resizedEnd, 3);
    expect(second.result.data!.summary).toContain(", moved from 33.0s to butt against the previous clip");
    // A deliberate gap elsewhere is kept.
    const third = await place({ file_id: IDS.broll, start_seconds: "0", end_seconds: "2", position_seconds: "50", track: "4" }, NO_WATCH, doc);
    expect(third.clip!.position).toBe(50);
  });
});

describe("explicit times on slice and watch", () => {
  it("redirects a cut outside the clip to the sibling clip from the same file", async () => {
    const doc = fixtureDoc();
    const result = await runTool({ doc, host: fakeHost() }, "slice_clip_at_best_match_tool", { query: "x", timeline_clip_id: IDS.clipA, start_seconds: "11" });
    expect(result.data!.summary).toBe("Sliced at 0:01 (requested time, on the clip that holds it: timeline_clip_id=CLIPINTV02).");
    expect(doc.project.clips.filter((c) => c.file_id === IDS.interview)).toHaveLength(3);
  });

  it("says 'Nothing to slice' for a cut on the clip's own edge", async () => {
    const doc = fixtureDoc();
    const result = await runTool({ doc, host: fakeHost() }, "slice_clip_at_best_match_tool", { query: "x", timeline_clip_id: IDS.clipA, end_seconds: "10" });
    expect(result.data!.status).toBe("unchanged");
    expect(result.data!.summary).toBe("Nothing to slice: 10.00s is already the end of this clip (source window [0.00s–10.00s]).");
    expect(doc.undoLabels).toEqual([]);
  });

  it("refuses half a watch window and times written into the query", async () => {
    const host = fakeHost();
    const half = await runTool({ doc: fixtureDoc(), host }, "watch_clip_window_tool", { timeline_clip_id: IDS.clipA, start: "2" });
    expect(half.data!.summary).toBe("Error: Pass both start and end (source seconds), or neither to watch the best search match.");
    const inQuery = await runTool({ doc: fixtureDoc(), host }, "watch_clip_window_tool", { timeline_clip_id: IDS.clipA, query: "visible at 72.5 seconds" });
    expect(inQuery.data!.summary).toMatch(/^Error: The query names a time but start\/end are empty\./);
    const outside = await runTool({ doc: fixtureDoc(), host }, "watch_clip_window_tool", { timeline_clip_id: IDS.clipA, start: "12", end: "14" });
    expect(outside.data!.summary).toBe("Error: Window 12.00-14.00s is outside this clip's source range 0.00-10.00s (start/end are source seconds).");
  });

  it("always watches the edges of the asked window", async () => {
    const host = fakeHost();
    await runTool({ doc: fixtureDoc(), host }, "watch_clip_window_tool", { timeline_clip_id: IDS.clipA, start: "1.3", end: "2.7" });
    const rendered = host.calls.filter((c) => c.startsWith("renderFrame")).map((c) => c.split(" ")[1]);
    expect(rendered).toEqual(expect.arrayContaining(["1.30", "2.70"]));
  });
});
