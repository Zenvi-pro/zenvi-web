/**
 * Timeline-edit tools: add many, move/nudge/reorder, trim, slice, gaps,
 * duplicate, align. Ported from zenvi-core develop
 * tests/test_editor_tools_timeline_edit.py: every mutating call is exactly one
 * undo step, every refusal adds none. Arguments go in as the Assistant sends
 * them (strings, comma lists) where that is what a case checks.
 */

import { describe, expect, it } from "vitest";
import { EditHarness } from "./test-support/edit-harness.js";

const T1 = 1_000_000;
const T2 = 2_000_000;
const T3 = 3_000_000;

/** n clips of d seconds back to back on a track (one 10 s file). */
function seq(ed: EditHarness, n = 3, d = 4, layer = T1): string[] {
  const f = ed.addFile("video", { duration: 10 });
  return Array.from({ length: n }, (_, i) => ed.addClip(f, { position: i * d, end: d, layer }));
}

/** A 0-4, B 3.5-7.5, C 7-11 on track 1 with 0.5 s transitions at 3.5 and 7 (all `at` later). */
function crossfaded(ed: EditHarness, at = 0): { a: string; b: string; c: string; tab: string; tbc: string } {
  const f = ed.addFile("video", { duration: 10 });
  const a = ed.addClip(f, { position: at, end: 4 });
  const b = ed.addClip(f, { position: at + 3.5, end: 4 });
  const c = ed.addClip(f, { position: at + 7, end: 4 });
  const tab = ed.addTransition(T1, at + 3.5, 0.5);
  const tbc = ed.addTransition(T1, at + 7, 0.5);
  return { a, b, c, tab, tbc };
}

type Row = Record<string, unknown>;

describe("add_clips_to_timeline_tool", () => {
  it("places files back to back on an empty track, one undo step", async () => {
    const ed = new EditHarness();
    const files = [4, 6, 5].map((d) => ed.addFile("video", { duration: d }));
    const r = await ed.receipt("add_clips_to_timeline_tool", { file_ids: files, track: "1" });
    expect((r.clips as Row[]).map((c) => c.position)).toEqual([0, 4, 10]);
    expect(r).toMatchObject({ total_seconds: 15, track: 1 });
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.doc.project.clips).toEqual([]);
    ed.doc.redo();
    expect(ed.doc.project.clips).toHaveLength(3);
  });

  it("appends after the last clip on the track and defaults to the bottom track; takes a comma list", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 5 });
    const g = ed.addFile("video", { duration: 2 });
    ed.addClip(f, { position: 0, end: 3 });
    const r = await ed.receipt("add_clips_to_timeline_tool", { file_ids: `${f}, ${g}` });
    expect((r.clips as Row[]).map((c) => [c.position, c.layer])).toEqual([
      [3, T1],
      [8, T1],
    ]);
  });

  it("fits a total length with crossfades, trimming evenly and keeping the middle", async () => {
    const ed = new EditHarness();
    const files = Array.from({ length: 6 }, () => ed.addFile("video", { duration: 10 }));
    const r = await ed.receipt("add_clips_to_timeline_tool", { file_ids: files, fit_total_seconds: "30", transition: "fade", transition_seconds: "0.5" });
    expect(Math.abs((r.total_seconds as number) - 30)).toBeLessThanOrEqual(1 / 30 + 1e-6);
    expect(r.transition_ids).toHaveLength(5);
    const lengths = (r.clips as Row[]).map((c) => c.duration as number);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(2 / 30 + 1e-6);
    const c0 = (r.clips as Row[])[0]!;
    expect(Math.abs((c0.source_in as number) - (10 - (c0.duration as number)) / 2)).toBeLessThanOrEqual(1 / 30 + 1e-6);
    const t = ed.transition((r.transition_ids as string[])[0]!)!;
    expect(String(t.reader.path)).toMatch(/fade\.svg$/);
    expect(t.brightness.Points.map((p) => p.co.Y)).toEqual([1, -1]);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("never trims short clips or clips with explicit in/out points", async () => {
    const ed = new EditHarness();
    const long = ed.addFile("video", { duration: 30 });
    const short = ed.addFile("video", { duration: 2 });
    const r = await ed.receipt("add_clips_to_timeline_tool", {
      items: [{ file_id: long }, { file_id: short }, { file_id: long, source_start: 5, source_end: 13 }],
      fit_total_seconds: 20,
    });
    const d = (r.clips as Row[]).map((c) => c.duration as number);
    expect(d[1]).toBe(2);
    expect(d[2]).toBe(8);
    expect(Math.abs(d.reduce((a, b) => a + b, 0) - 20)).toBeLessThan(1e-6);
  });

  it("refuses an unreachable total", async () => {
    const ed = new EditHarness();
    const files = Array.from({ length: 8 }, () => ed.addFile("video", { duration: 10 }));
    await ed.refused("add_clips_to_timeline_tool", { file_ids: files, fit_total_seconds: 5 }, "cannot fit 8 clips", "8.0 s");
  });

  it("gives still images their on-screen length", async () => {
    const ed = new EditHarness();
    const img = ed.addFile("image");
    const r = await ed.receipt("add_clips_to_timeline_tool", { file_ids: [img, img], image_seconds: "3" });
    expect((r.clips as Row[]).map((c) => [c.position, c.duration])).toEqual([
      [0, 3],
      [3, 3],
    ]);
  });

  it("refuses bad requests without touching history", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 5 });
    await ed.refused("add_clips_to_timeline_tool", {}, "file_ids or items");
    await ed.refused("add_clips_to_timeline_tool", { file_ids: [f], items: [{ file_id: f }] }, "not both");
    await ed.refused("add_clips_to_timeline_tool", { file_ids: ["nope"] }, "no project file");
    await ed.refused("add_clips_to_timeline_tool", { file_ids: [f], transition: "sparkle_swirl" }, "unknown transition");
    await ed.refused("add_clips_to_timeline_tool", { file_ids: [f], transition: "fade", fade: "in" }, "not both");
    await ed.refused("add_clips_to_timeline_tool", { items: [{ file_id: f, source_start: 3, source_end: 9 }] }, "outside the file");
    await ed.refused("add_clips_to_timeline_tool", { items: [{ file_id: f, bogus: 1 }] }, "bogus");
    ed.lockTrack(T1);
    await ed.refused("add_clips_to_timeline_tool", { file_ids: [f], track: "1" }, "track 1 is locked");
  });

  it("refuses to cover clips already on the track unless allowed", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 5 });
    ed.addClip(f, { position: 2, end: 5 });
    await ed.refused("add_clips_to_timeline_tool", { file_ids: [f], start_seconds: 0, track: "1" }, "would overlap", "allow_overlap");
    const r = await ed.receipt("add_clips_to_timeline_tool", { file_ids: [f], start_seconds: 0, track: "1", allow_overlap: "true" });
    expect((r.clips as Row[])[0]!.position).toBe(0);
  });

  it("refuses a transition longer than a clip", async () => {
    const ed = new EditHarness();
    const a = ed.addFile("video", { duration: 5 });
    const b = ed.addFile("video", { duration: 0.5 });
    await ed.refused("add_clips_to_timeline_tool", { file_ids: [a, b, a], transition: "fade", transition_seconds: 1 }, "too short");
  });

  it("orders by name and picks random transitions", async () => {
    const ed = new EditHarness();
    const files = ["c.mp4", "a.mp4", "b.mp4"].map((name) => ed.addFile("video", { duration: 4, name }));
    const r = await ed.receipt("add_clips_to_timeline_tool", { file_ids: files, order: "Name", transition: "random" });
    expect((r.clips as Row[]).map((c) => c.file_id)).toEqual([files[1], files[2], files[0]]);
    expect(r.transition_ids).toHaveLength(2);
  });

  it("fades and zooms each clip like the Add to Timeline dialog", async () => {
    const ed = new EditHarness();
    const files = [4, 4].map((d) => ed.addFile("video", { duration: d }));
    const r = await ed.receipt("add_clips_to_timeline_tool", { file_ids: files, fade: "in_out", fade_seconds: 1, zoom: "in" });
    // The fades cross: the second clip starts one fade length before the first ends.
    expect((r.clips as Row[]).map((c) => c.position)).toEqual([0, 3]);
    const first = ed.clip((r.clips as Row[])[0]!.timeline_clip_id as string)!;
    expect(first.alpha.Points.map((p) => [p.co.X, p.co.Y])).toEqual([
      [1, 0],
      [31, 1],
      [91, 1],
      [121, 0],
    ]);
    expect(first.scale_x.Points.map((p) => [p.co.X, p.co.Y])).toEqual([
      [1, 1],
      [121, 1.25],
    ]);
  });

  it("snaps every placed clip to a 24 fps grid", async () => {
    const ed = new EditHarness({ fps: { num: 24, den: 1 } });
    const f = ed.addFile("video", { duration: 10 });
    const r = await ed.receipt("add_clips_to_timeline_tool", { file_ids: [f, f, f], fit_total_seconds: 17.3 });
    for (const row of r.clips as Row[]) {
      const clip = ed.clip(row.timeline_clip_id as string)!;
      for (const key of ["position", "start", "end"] as const) expect(Math.abs(clip[key] * 24 - Math.round(clip[key] * 24))).toBeLessThan(1e-6);
    }
  });
});

describe("move_clips_tool", () => {
  it("moves to a time; undo and redo", async () => {
    const ed = new EditHarness();
    const [a] = seq(ed, 1);
    const r = await ed.receipt("move_clips_tool", { timeline_clip_ids: [a], position_seconds: "12.5" });
    expect(ed.pos(a!)).toBe(12.5);
    expect((r.moved as Row[])[0]!.to).toMatchObject({ position: 12.5 });
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.pos(a!)).toBe(0);
    ed.doc.redo();
    expect(ed.pos(a!)).toBe(12.5);
  });

  it("nudges by frames", async () => {
    const ed = new EditHarness();
    const [a] = seq(ed, 1);
    await ed.call("move_clips_tool", { timeline_clip_ids: [a], position_seconds: 1 });
    ed.mark();
    await ed.receipt("move_clips_tool", { timeline_clip_ids: a, by_frames: "-3" });
    expect(Math.abs(ed.clip(a!)!.position - (1 - 3 / 30))).toBeLessThan(1e-9);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("moves to another track and keeps the time", async () => {
    const ed = new EditHarness();
    const [a] = seq(ed, 1);
    await ed.receipt("move_clips_tool", { timeline_clip_ids: [a], to_track: "3" });
    expect(ed.clip(a!)!.layer).toBe(T3);
    expect(ed.pos(a!)).toBe(0);
  });

  it("refuses to overlap unless allowed, and reports what it covers", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed);
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a], position_seconds: 5 }, "would overlap", "ripple=true");
    const r = await ed.receipt("move_clips_tool", { timeline_clip_ids: [a], position_seconds: 5, allow_overlap: true });
    expect((r.overlaps as Row[]).map((h) => h.overlaps)).toContain(b);
  });

  it("refuses bad requests", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed);
    await ed.refused("move_clips_tool", { position_seconds: 1 }, "say which clips");
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a] }, "nothing to do");
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a], position_seconds: 1, by_frames: 2 }, "only one");
    await ed.refused("move_clips_tool", { timeline_clip_ids: [b], by_seconds: -10 }, "before the timeline start");
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a], after_clip_id: a }, "anchor clip is one");
    await ed.refused("move_clips_tool", { timeline_clip_ids: ["nope"], by_seconds: 1 }, "no timeline clip");
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a], to_track: "9" });
    ed.lockTrack(T2);
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a], to_track: "2" }, "track 2 is locked");
    ed.lockTrack(T2, false);
    ed.lockTrack(T1);
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a], to_track: "2" }, "track 1 is locked");
  });

  it("ripple-moves the intro to the end", async () => {
    const ed = new EditHarness();
    const [a, b, c] = seq(ed);
    const r = await ed.receipt("move_clips_tool", { timeline_clip_ids: [a], after_clip_id: c, ripple: true });
    expect([b, c, a].map((id) => ed.pos(id!))).toEqual([0, 4, 8]);
    expect(new Set(r.shifted as string[])).toEqual(new Set([b, c]));
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([a, b, c].map((id) => ed.pos(id!))).toEqual([0, 4, 8]);
  });

  it("ripple-moves before a clip, and to a position counted before the move", async () => {
    const ed = new EditHarness();
    const [a, b, c] = seq(ed);
    await ed.receipt("move_clips_tool", { timeline_clip_ids: [c], before_clip_id: a, ripple: true });
    expect([c, a, b].map((id) => ed.pos(id!))).toEqual([0, 4, 8]);
    await ed.receipt("move_clips_tool", { timeline_clip_ids: [c], position_seconds: 12, ripple: true });
    expect([a, b, c].map((id) => ed.pos(id!))).toEqual([0, 4, 8]);
  });

  it("refuses a ripple of a broken run, or into the middle of a clip", async () => {
    const ed = new EditHarness();
    const [a, , c] = seq(ed);
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a, c], position_seconds: 20, ripple: true }, "contiguous");
    await ed.refused("move_clips_tool", { timeline_clip_ids: [a], position_seconds: 6, ripple: true }, "falls inside");
  });

  it("keeps the spacing and relative tracks of several clips", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 10 });
    const a = ed.addClip(f, { position: 1, end: 2, layer: T1 });
    const b = ed.addClip(f, { position: 2, end: 2, layer: T2 });
    await ed.receipt("move_clips_tool", { timeline_clip_ids: [a, b], position_seconds: 10, to_track: "3" });
    expect([ed.clip(a)!.layer, ed.pos(a)]).toEqual([T2, 10]);
    expect([ed.clip(b)!.layer, ed.pos(b)]).toEqual([T3, 11]);
  });
});

describe("trim_clips_tool", () => {
  it("trims the start and keeps the picture in place", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    const r = await ed.receipt("trim_clips_tool", { timeline_clip_ids: [a], trim_start_seconds: "2s" });
    expect([ed.clip(a!)!.start, ed.pos(a!), ed.clip(a!)!.end]).toEqual([2, 2, 4]);
    expect(((r.clips as Row[])[0]!.after as Row).duration).toBe(2);
    expect(ed.pos(b!)).toBe(4);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([ed.clip(a!)!.start, ed.pos(a!)]).toEqual([0, 0]);
  });

  it("ripple-trims and pulls the later clips", async () => {
    const ed = new EditHarness();
    const [a, b, c] = seq(ed);
    const r = await ed.receipt("trim_clips_tool", { timeline_clip_ids: [a], trim_start_seconds: 1.5, ripple: true });
    expect([ed.pos(a!), ed.clip(a!)!.start]).toEqual([0, 1.5]);
    expect([ed.pos(b!), ed.pos(c!)]).toEqual([2.5, 6.5]);
    expect(new Set(r.shifted as string[])).toEqual(new Set([b, c]));
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("reports the limits", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    await ed.refused("trim_clips_tool", { timeline_clip_ids: [b], source_end: 12 }, "at most 10.00 s");
    await ed.refused("trim_clips_tool", { timeline_clip_ids: [b], trim_start_seconds: -1 }, "at most 0.00 s");
    await ed.refused("trim_clips_tool", { timeline_clip_ids: [a], trim_end_seconds: -2 }, "would overlap");
    await ed.refused("trim_clips_tool", { timeline_clip_ids: [a], trim_start_seconds: 4 }, "one frame");
    await ed.refused("trim_clips_tool", { timeline_clip_ids: [a] }, "nothing to trim");
    await ed.refused("trim_clips_tool", { timeline_clip_ids: [a], trim_end_seconds: 1, duration_seconds: 2 }, "only one");
    ed.lockTrack(T1);
    await ed.refused("trim_clips_tool", { timeline_clip_ids: [a], trim_end_seconds: 1 }, "locked");
  });

  it("extends a trimmed clip back into its source", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 10 });
    const a = ed.addClip(f, { position: 5, start: 3, end: 6 });
    await ed.receipt("trim_clips_tool", { timeline_clip_ids: [a], trim_start_seconds: -1, duration_seconds: 5 });
    expect([ed.clip(a)!.start, ed.clip(a)!.end, ed.pos(a)]).toEqual([2, 7, 4]);
  });

  it("extends the end with ripple and pushes the next clip", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    await ed.receipt("trim_clips_tool", { timeline_clip_ids: [a], trim_end_seconds: -2, ripple: true });
    expect(ed.clip(a!)!.end).toBe(6);
    expect(ed.pos(b!)).toBe(6);
  });

  it("lets a still image grow past its default length", async () => {
    const ed = new EditHarness();
    const img = ed.addFile("image");
    const a = ed.addClip(img);
    await ed.receipt("trim_clips_tool", { timeline_clip_ids: [a], duration_seconds: 25 });
    expect(ed.clip(a)!.end).toBe(25);
  });

  it("adds no history when nothing changes", async () => {
    const ed = new EditHarness();
    const [a] = seq(ed, 1);
    const receipt = await ed.call("trim_clips_tool", { timeline_clip_ids: [a], source_start: 0 });
    expect(receipt.status).toBe("unchanged");
    expect(receipt.data).toMatchObject({ changed: false });
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("ripple-trims a crossfaded clip and keeps the next crossfade", async () => {
    const ed = new EditHarness();
    const { b, c, tab, tbc } = crossfaded(ed);
    await ed.receipt("trim_clips_tool", { timeline_clip_ids: [b], trim_end_seconds: 1, ripple: true });
    expect(ed.pos(c)).toBe(6);
    expect(ed.transition(tbc)!.position).toBe(6);
    expect(ed.transition(tab)!.position).toBe(3.5);
    expect(ed.pos(b)).toBe(3.5);
    expect(ed.stepsSinceMark()).toBe(1);
  });
});

describe("slice_clips_tool", () => {
  it("cuts one clip in two; undo", async () => {
    const ed = new EditHarness();
    const [a] = seq(ed, 2);
    const r = await ed.receipt("slice_clips_tool", { timeline_clip_ids: [a], at_seconds: "1.5" });
    const right = (r.pieces as Row[])[0]!.right as string;
    expect(ed.pos(right)).toBe(1.5);
    expect(ed.clip(a!)!.end).toBe(1.5);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.clip(right)).toBeUndefined();
    expect(ed.clip(a!)!.end).toBe(4);
  });

  it("cuts at the playhead, keeps the right side and closes the gap", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    ed.host.player!.seek(1);
    await ed.receipt("slice_clips_tool", { timeline_clip_ids: [a], keep: "right", ripple: true });
    expect([ed.pos(a!), ed.clip(a!)!.start, ed.pos(b!)]).toEqual([0, 1, 3]);
  });

  it("keeps the frame at the cut with keep='left'", async () => {
    const ed = new EditHarness();
    const [a] = seq(ed, 1);
    await ed.receipt("slice_clips_tool", { timeline_clip_ids: [a], at_seconds: 2, keep: "left" });
    expect(ed.clip(a!)!.end).toBeCloseTo(2 + 1 / 30, 9);
  });

  it("cuts through every unlocked track with scope='all' and reports the locked ones", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 10 });
    const a = ed.addClip(f, { position: 0, end: 4, layer: T1 });
    const b = ed.addClip(f, { position: 0, end: 4, layer: T2 });
    const t = ed.addTransition(T1, 1, 2);
    ed.lockTrack(T2);
    const r = await ed.receipt("slice_clips_tool", { scope: "all", at_seconds: 2 });
    expect((r.pieces as Row[]).map((p) => p.timeline_clip_id)).toEqual([a]);
    expect((r.skipped_locked as Row[]).map((s) => s.timeline_clip_id)).toEqual([b]);
    expect(r.transition_ids).toEqual([t]);
    expect(ed.doc.project.effects).toHaveLength(2);
    expect(ed.doc.project.clips).toHaveLength(3);
  });

  it("cuts the selected clips and the selected transitions under the time", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    const t = ed.addTransition(T1, 3, 2);
    ed.selectIds([a!, t]);
    const r = await ed.receipt("slice_clips_tool", { scope: "selected", at_seconds: 3.5 });
    expect(r.transition_ids).toEqual([t]);
    expect((r.pieces as Row[]).map((p) => p.timeline_clip_id)).toEqual([a]);
    expect(ed.transition(t)!.end).toBe(0.5);
    expect(ed.doc.project.effects).toHaveLength(2);
    // Every selected clip must be under the time.
    ed.selectIds([a!, b!]);
    ed.mark();
    await ed.refused("slice_clips_tool", { scope: "selected", at_seconds: 1 }, "is not under 1.00 s");
  });

  it("refuses bad requests", async () => {
    const ed = new EditHarness();
    const [a] = seq(ed, 2);
    await ed.refused("slice_clips_tool", { timeline_clip_ids: [a], at_seconds: 6 }, "not under");
    await ed.refused("slice_clips_tool", { timeline_clip_ids: [a], at_seconds: 0 }, "not under");
    await ed.refused("slice_clips_tool", { timeline_clip_ids: [a], at_seconds: 1, ripple: true }, "one side is kept");
    await ed.refused("slice_clips_tool", { at_seconds: 1 }, "say what to slice");
    await ed.refused("slice_clips_tool", { scope: "track", track: "3", at_seconds: 1 }, "nothing to slice");
    ed.lockTrack(T1);
    await ed.refused("slice_clips_tool", { timeline_clip_ids: [a], at_seconds: 1 }, "locked");
    await ed.refused("slice_clips_tool", { scope: "track", track: "1", at_seconds: 1 }, "locked");
  });
});

describe("remove_gaps_tool", () => {
  it("closes every gap on a track; undo", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 10 });
    const a = ed.addClip(f, { position: 1, end: 2 });
    const b = ed.addClip(f, { position: 5, end: 2 });
    const r = await ed.receipt("remove_gaps_tool", { track: "1" });
    expect([ed.pos(a), ed.pos(b)]).toEqual([0, 2]);
    expect((r.closed as Row[])[0]!.gaps).toEqual([
      [0, 1],
      [3, 5],
    ]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([ed.pos(a), ed.pos(b)]).toEqual([1, 5]);
  });

  it("closes the first gap after a time: the hole a delete leaves", async () => {
    const ed = new EditHarness();
    const [a, b, c] = seq(ed);
    await ed.call("delete_from_timeline_tool", { timeline_clip_id: b });
    ed.mark();
    await ed.receipt("remove_gaps_tool", { track: "1", from_seconds: 4, only_first: "yes" });
    expect([ed.pos(a!), ed.pos(c!)]).toEqual([0, 4]);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("has nothing to do without gaps, and refuses several tracks or a locked one", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 10 });
    ed.addClip(f, { position: 0, end: 2, layer: T1 });
    const receipt = await ed.call("remove_gaps_tool", { track: "1" });
    expect(receipt.status).toBe("unchanged");
    expect(receipt.data).toMatchObject({ changed: false });
    expect(ed.stepsSinceMark()).toBe(0);
    ed.addClip(f, { position: 4, end: 2, layer: T1 });
    ed.addClip(f, { position: 3, end: 2, layer: T2 });
    await ed.refused("remove_gaps_tool", {}, "say which track");
    ed.lockTrack(T1);
    await ed.refused("remove_gaps_tool", { track: "1" }, "locked");
  });

  it("picks the only track that has gaps", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 10 });
    ed.addClip(f, { position: 0, end: 2, layer: T1 });
    const b = ed.addClip(f, { position: 4, end: 2, layer: T1 });
    ed.addClip(f, { position: 0, end: 9, layer: T2 });
    await ed.receipt("remove_gaps_tool");
    expect(ed.pos(b)).toBe(2);
  });

  it("moves crossfaded clips and their transitions together", async () => {
    const ed = new EditHarness();
    const { a, b, c, tab, tbc } = crossfaded(ed, 2);
    const r = await ed.receipt("remove_gaps_tool", { track: "1" });
    expect([ed.pos(a), ed.pos(b), ed.pos(c), ed.transition(tab)!.position, ed.transition(tbc)!.position]).toEqual([0, 3.5, 7, 3.5, 7]);
    expect(r.moved).toHaveLength(5);
  });
});

describe("duplicate_clips_tool", () => {
  it("copies after the original with new effect ids; undo", async () => {
    const ed = new EditHarness();
    const [a] = seq(ed, 1);
    const eid = ed.addEffect(a!, "Blur");
    const r = await ed.receipt("duplicate_clips_tool", { timeline_clip_ids: [a] });
    const copy = ((r.copies as Row[][])[0]![0]! as Row).timeline_clip_id as string;
    expect(copy).not.toBe(a);
    expect(ed.pos(copy)).toBe(4);
    expect(ed.clip(copy)!.effects[0]!.id).not.toBe(eid);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.clip(copy)).toBeUndefined();
  });

  it("inserts three copies with ripple", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    const r = await ed.receipt("duplicate_clips_tool", { timeline_clip_ids: [a], copies: "3", ripple: true });
    expect((r.copies as Row[][]).map((batch) => batch[0]!.position)).toEqual([4, 8, 12]);
    expect(ed.pos(b!)).toBe(16);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("refuses to cover clips, and copies the transitions between the copied clips", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    await ed.refused("duplicate_clips_tool", { timeline_clip_ids: [a] }, "would overlap");
    await ed.call("trim_clips_tool", { timeline_clip_ids: [a], trim_end_seconds: -0.5, allow_overlap: true });
    ed.addTransition(T1, 4, 0.5);
    const r = await ed.receipt("duplicate_clips_tool", { timeline_clip_ids: [a, b], to_track: "2" });
    expect(r.transition_ids).toHaveLength(1);
    const copied = ed.transition((r.transition_ids as string[])[0]!)!;
    expect([copied.position, copied.layer]).toEqual([12, T2]);
    expect(new Set((r.copies as Row[][])[0]!.map((c) => c.track))).toEqual(new Set([2]));
    ed.mark();
    ed.lockTrack(T3);
    await ed.refused("duplicate_clips_tool", { timeline_clip_ids: [a], to_track: "3" }, "locked");
  });

  it("leaves a clip's incoming crossfade behind", async () => {
    const ed = new EditHarness();
    const { a, b, c } = crossfaded(ed);
    expect((await ed.receipt("duplicate_clips_tool", { timeline_clip_ids: [c] })).transition_ids).toEqual([]);
    const r = await ed.receipt("duplicate_clips_tool", { timeline_clip_ids: [a, b], position_seconds: 20 });
    expect(r.transition_ids).toHaveLength(1);
    expect(ed.transition((r.transition_ids as string[])[0]!)!.position).toBe(23.5);
  });
});

describe("align_clips_tool", () => {
  it("lines up starts, ends and a given time", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 10 });
    const a = ed.addClip(f, { position: 2, end: 4, layer: T1 });
    const b = ed.addClip(f, { position: 5, end: 2, layer: T2 });
    await ed.receipt("align_clips_tool", { timeline_clip_ids: [a, b] });
    expect([ed.pos(a), ed.pos(b)]).toEqual([2, 2]);
    expect(ed.stepsSinceMark()).toBe(1);
    await ed.receipt("align_clips_tool", { timeline_clip_ids: [a, b], edge: "END" });
    expect([ed.pos(a), ed.pos(b)]).toEqual([2, 4]);
    await ed.receipt("align_clips_tool", { timeline_clip_ids: [a, b], to_seconds: 10 });
    expect([ed.pos(a), ed.pos(b)]).toEqual([10, 10]);
  });

  it("refuses one clip without a time and clips that would pile up; a no-op adds no history", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    await ed.refused("align_clips_tool", { timeline_clip_ids: [a] }, "at least two");
    await ed.refused("align_clips_tool", { timeline_clip_ids: [a, b] }, "would overlap");
    const f = ed.addFile("video", { duration: 10 });
    const c = ed.addClip(f, { position: 0, end: 2, layer: T2 });
    const receipt = await ed.call("align_clips_tool", { timeline_clip_ids: [a, c] });
    expect(receipt.status).toBe("unchanged");
    expect(ed.stepsSinceMark()).toBe(0);
  });
});

describe("targets", () => {
  it("acts on the timeline selection, a whole track, or every clip", async () => {
    const ed = new EditHarness();
    const [a, b] = seq(ed, 2);
    const f = ed.addFile("video", { duration: 10 });
    const c = ed.addClip(f, { position: 0, end: 2, layer: T2 });
    ed.selectIds([b!]);
    await ed.receipt("move_clips_tool", { scope: "selected", by_seconds: 1 });
    expect(ed.pos(b!)).toBe(5);
    await ed.receipt("move_clips_tool", { scope: "track", track: "2", by_seconds: 1 });
    expect(ed.pos(c)).toBe(1);
    const r = await ed.receipt("move_clips_tool", { scope: "all", by_seconds: 1 });
    expect((r.moved as Row[]).map((m) => m.timeline_clip_id)).toEqual([a, c, b]);
    ed.selectIds([]);
    ed.mark();
    await ed.refused("move_clips_tool", { scope: "selected", by_seconds: 1 }, "no clips are selected");
  });
});
