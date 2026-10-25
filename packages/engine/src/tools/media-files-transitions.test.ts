/**
 * The timeline transition tools, ported from zenvi-core develop
 * tests/test_editor_tools_media_files_transitions.py and called through
 * runTool with the Assistant's string arguments: list, update (length, mask,
 * curves, flags), reverse, remove, copy, and transitions between every pair
 * of clips. Every change is one undo step; a refusal records none.
 */

import { describe, expect, it } from "vitest";
import type { Keyframe, Transition } from "../model/types.js";
import { addMaskTransition, maskReader, reversedTransitionCurves, transitionDirection } from "../ops/transitions.js";
import { lookupTransition } from "../transitions/catalog.js";
import { EditHarness } from "./test-support/edit-harness.js";
import { L1, L2 } from "./test-support/fixture.js";

type Row = Record<string, unknown>;

/** A Mask transition like the desktop's tests build it (transition_ops.new_mask_transition). */
function addTransition(ed: EditHarness, position: number, duration: number, opts: { layer?: number; mask?: string; reversed?: boolean } = {}): string {
  const entry = lookupTransition(opts.mask ?? "fade").entry!;
  const id = ed.doc.transaction("setup", (tx) => {
    const t = addMaskTransition(tx, { layer: opts.layer ?? L1, position, duration, reader: maskReader(entry.storedPath), title: entry.file.replace(/\.[^.]+$/, "") });
    if (opts.reversed) tx.update(["effects", { id: t.id }], reversedTransitionCurves(t));
    return t.id;
  });
  ed.mark();
  return id;
}

function transition(ed: EditHarness, id: string): Transition | undefined {
  return ed.transition(id);
}

function lastX(kf: Keyframe | undefined): number {
  return Math.max(...(kf?.Points ?? []).map((p) => p.co.X));
}

/** A [0,10) B [9,19) C [18,28) on track 1 with 1 s crossfades A|B and B|C. */
function crossfaded() {
  const ed = new EditHarness();
  const f = ed.addFile("video", { duration: 30 });
  const a = ed.addClip(f, { position: 0, end: 10 });
  const b = ed.addClip(f, { position: 9, end: 10 });
  const c = ed.addClip(f, { position: 18, end: 10 });
  const t1 = addTransition(ed, 9, 1);
  const t2 = addTransition(ed, 18, 1);
  return { ed, a, b, c, t1, t2 };
}

function byId(rows: unknown): Record<string, Row> {
  return Object.fromEntries((rows as Row[]).map((r) => [String(r.transition_id), r]));
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("list_timeline_transitions_tool", () => {
  it("describes pairs, edges and direction", async () => {
    const { ed, a, b, c, t1, t2 } = crossfaded();
    const fadeOut = addTransition(ed, 27, 1, { mask: "circle_in_to_out", reversed: true });
    const rows = byId((await ed.receipt("list_timeline_transitions_tool")).transitions);
    expect(rows[t1]).toMatchObject({ between_clip_ids: [a, b], clip_overlap: 1, mask: "fade", direction: "default", track: 1, order: "earlier_to_later" });
    expect(rows[fadeOut]).toMatchObject({ on_clip_end: c, direction: "reversed", mask: "circle_in_to_out" });
    const forA = (await ed.receipt("list_timeline_transitions_tool", { timeline_clip_id: a })).transitions as Row[];
    expect(forA.map((r) => r.transition_id)).toEqual([t1]);
    const at = (await ed.receipt("list_timeline_transitions_tool", { at_seconds: "18.5" })).transitions as Row[];
    expect(at[0]!.transition_id).toBe(t2);
    expect((await ed.receipt("list_timeline_transitions_tool", { track: "2" })).transitions).toEqual([]);
    const all = await ed.call("list_timeline_transitions_tool", { track: "1" });
    expect(all.summary).toBe("3 transition(s) on track 1.");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("reports the contrast, the audio crossfade and a fade at a clip's start", async () => {
    const ed = new EditHarness();
    const clip = ed.addClip(ed.addFile("video", { duration: 20 }), { position: 2, end: 8 });
    const fadeIn = addTransition(ed, 2, 1);
    const row = ((await ed.receipt("list_timeline_transitions_tool")).transitions as Row[])[0]!;
    expect(row).toMatchObject({ transition_id: fadeIn, on_clip_start: clip, contrast: 3, audio_crossfade: false, invert_mask: false, position: 2, end: 3, duration: 1 });
    expect(row).not.toHaveProperty("between_clip_ids");
  });
});

// ---------------------------------------------------------------------------
// update: duration
// ---------------------------------------------------------------------------

describe("update_transition_tool: length", () => {
  it("a longer crossfade moves the later clip and ripples", async () => {
    const { ed, b, c, t1, t2, a } = crossfaded();
    const r = await ed.receipt("update_transition_tool", { between_clip_ids: [a, b], duration_seconds: "2.0" });
    expect([ed.pos(b), ed.pos(c)]).toEqual([8, 17]);
    expect([transition(ed, t1)!.position, transition(ed, t1)!.end, lastX(transition(ed, t1)!.brightness)]).toEqual([8, 2, 61]);
    expect(transition(ed, t2)!.position).toBe(17);
    expect((r.transitions as Row[])[0]!.clip_overlap).toBe(2);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([ed.pos(b), ed.pos(c), transition(ed, t1)!.end, transition(ed, t2)!.position]).toEqual([9, 18, 1, 18]);
    ed.doc.redo();
    expect(ed.pos(c)).toBe(17);
  });

  it("every crossfade on a track ripples cumulatively", async () => {
    const { ed, b, c, t2 } = crossfaded();
    const receipt = await ed.call("update_transition_tool", { scope: "track", track: "1", duration_seconds: 2 });
    expect(receipt.summary).toMatch(/^Updated 2 transition\(s\); moved clip \w+ and later items by -1\.00s; moved clip \w+ and later items by -1\.00s\.$/);
    expect([ed.pos(b), ed.pos(c)]).toEqual([8, 16]);
    expect([transition(ed, t2)!.position, transition(ed, t2)!.end]).toEqual([16, 2]);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("a shorter crossfade without ripple, and keep_overlap", async () => {
    const { ed, b, c, t1, t2 } = crossfaded();
    await ed.receipt("update_transition_tool", { transition_ids: [t1], duration_seconds: "0.5", ripple: "false" });
    expect([ed.pos(b), ed.pos(c), transition(ed, t1)!.position]).toEqual([9.5, 18, 9.5]);
    ed.mark();
    await ed.receipt("update_transition_tool", { transition_ids: [t2], duration_seconds: 1.5, keep_overlap: true });
    expect([ed.pos(c), transition(ed, t2)!.end]).toEqual([18, 1.5]);
  });

  it("without ripple, moving the later clip into the next one is refused", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    ed.addClip(f, { position: 0, end: 10 });
    const b = ed.addClip(f, { position: 9, end: 5 });
    ed.addClip(f, { position: 14, end: 5 });
    const t = addTransition(ed, 9, 1);
    await ed.refused("update_transition_tool", { transition_ids: [t], duration_seconds: 0.5, ripple: false }, "moving only the later clip would overlap the next clip; use ripple=true");
    expect(ed.pos(b)).toBe(9);
  });

  it("a fade at a clip's end keeps the end", async () => {
    const ed = new EditHarness();
    ed.addClip(ed.addFile("video"), { position: 0, end: 10 });
    const t = addTransition(ed, 9, 1, { reversed: true });
    await ed.receipt("update_transition_tool", { transition_ids: [t], duration_seconds: "3.0" });
    const data = transition(ed, t)!;
    expect([data.position, data.end, transitionDirection(data)]).toEqual([7, 3, "reversed"]);
  });

  it("refusals are not undoable", async () => {
    const { ed, a, b, c, t1, t2 } = crossfaded();
    const cases: [Row, string][] = [
      [{ transition_ids: [t1] }, "nothing to change"],
      [{ transition_ids: [t1], duration_seconds: 12 }, "a 12.00s crossfade needs both clips to be longer; the shorter clip is 10.00s"],
      [{ transition_ids: ["NOPE"], contrast: 5 }, "no transition with id='NOPE'"],
      [{ contrast: 5 }, "2 transitions match"],
      [{ transition_ids: [t1, t2], position_seconds: 3 }, "position_seconds moves one transition; several were chosen"],
      [{ transition_ids: [t1], mask: "not-a-real-transition-name" }, "unknown transition 'not-a-real-transition-name'"],
      [{ transition_ids: [t1], mask: "fade", mask_file_id: "X" }, "pass mask or mask_file_id, not both"],
      [{ between_clip_ids: [a], contrast: 5 }, "between_clip_ids takes exactly two timeline clip ids"],
      [{ between_clip_ids: [a, c], contrast: 5 }, "no transition joins those two clips"],
      [{ transition_ids: [t1], duration_seconds: 0.01 }, "duration_seconds must be at least one frame"],
      [{ transition_ids: [t1], flip_wipe_side: true, invert_mask: false }, "pass flip_wipe_side or invert_mask, not both"],
    ];
    for (const [args, fragment] of cases) await ed.refused("update_transition_tool", args, fragment);
    ed.lockTrack(L1);
    await ed.refused("update_transition_tool", { transition_ids: [t1], contrast: 5 }, "track(s) [1] are locked; unlock them first");
    expect(ed.pos(b)).toBe(9);
  });

  it("a call that changes nothing adds no undo step", async () => {
    const { ed, t1 } = crossfaded();
    const receipt = await ed.call("update_transition_tool", { transition_ids: [t1], duration_seconds: 1 });
    expect(receipt.status).toBe("unchanged");
    expect(receipt.summary).toBe("No change: the transition(s) already have those settings.");
    expect((receipt.data as Row).changed).toBe(false);
    expect(ed.stepsSinceMark()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// update: mask, curves, flags
// ---------------------------------------------------------------------------

describe("update_transition_tool: mask, curves and flags", () => {
  it("a new mask keeps the direction and the curve; undo brings the old one back", async () => {
    const { ed, t1 } = crossfaded();
    await ed.receipt("reverse_transition_tool", { transition_ids: [t1] });
    ed.mark();
    await ed.receipt("update_transition_tool", { transition_ids: [t1], mask: "circle" });
    const data = transition(ed, t1)!;
    expect([data.reader.path, data.title, transitionDirection(data)]).toEqual(["@transitions/common/circle_in_to_out.svg", "circle_in_to_out", "reversed"]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(transition(ed, t1)!.reader.path).toBe("@transitions/common/fade.svg");
  });

  it("flags, contrast, keyframes and interpolation", async () => {
    const { ed, t1 } = crossfaded();
    await ed.receipt("update_transition_tool", { transition_ids: [t1], invert_mask: "true", contrast: "12", audio_crossfade: "yes", interpolation: "Linear" });
    let data = transition(ed, t1)!;
    expect([data.mask_invert, data.fade_audio_hint]).toEqual([true, true]);
    expect(data.contrast.Points.map((p) => p.co.Y)).toEqual([12]);
    expect(new Set(data.brightness.Points.map((p) => p.interpolation))).toEqual(new Set([1]));
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    data = transition(ed, t1)!;
    expect([data.mask_invert, data.fade_audio_hint]).toEqual([undefined, undefined]);
    ed.mark();
    await ed.receipt("update_transition_tool", {
      transition_ids: [t1],
      brightness_keyframes: JSON.stringify([{ seconds: 0, value: 1 }, { seconds: 0.5, value: 0, interpolation: "linear" }, { seconds: 1, value: -1 }]),
    });
    expect(transition(ed, t1)!.brightness.Points.map((p) => [p.co.X, p.co.Y])).toEqual([
      [1, 1],
      [16, 0],
      [31, -1],
    ]);
    ed.mark();
    await ed.refused("update_transition_tool", { transition_ids: [t1], brightness_keyframes: [{ seconds: 5, value: 1 }] }, "keyframe at 5.000s is past the end of the 1.000s transition");
  });

  it("a project image as the mask; an audio file is refused", async () => {
    const { ed, t1 } = crossfaded();
    const img = ed.addFile("image", { name: "gradient.png" });
    await ed.receipt("update_transition_tool", { transition_ids: [t1], mask_file_id: img });
    const data = transition(ed, t1)!;
    expect([data.reader.path, data.title]).toEqual(["/media/gradient.png", "gradient"]);
    expect(data.reader).not.toHaveProperty("ai_metadata");
    const audio = ed.addFile("audio");
    await ed.refused("update_transition_tool", { transition_ids: [t1], mask_file_id: audio }, "the mask must be an image or video file");
    await ed.refused("update_transition_tool", { transition_ids: [t1], mask_file_id: "NOPE" }, "no project file with id='NOPE'");
  });

  it("an image file path is read where the host has local files", async () => {
    const { ed, t1 } = crossfaded();
    await ed.receipt("update_transition_tool", { transition_ids: [t1], mask: "/masks/Logo_Wipe.png" });
    expect([transition(ed, t1)!.reader.path, transition(ed, t1)!.title]).toEqual(["/masks/Logo_Wipe.png", "logo_wipe"]);
    ed.mark();
    await ed.refused("update_transition_tool", { transition_ids: [t1], mask: "/masks/missing.png" }, "unknown transition '/masks/missing.png'");
  });

  it("flip_wipe_side keeps the clip order; reverse or invert alone shows the later clip first", async () => {
    const { ed, a, t1 } = crossfaded();
    let rows = byId((await ed.receipt("list_timeline_transitions_tool")).transitions);
    expect(rows[t1]!.order).toBe("earlier_to_later");
    await ed.receipt("update_transition_tool", { transition_ids: [t1], mask: "wipe_left_to_right", flip_wipe_side: true });
    const data = transition(ed, t1)!;
    expect([data.mask_invert, transitionDirection(data)]).toEqual([true, "reversed"]);
    rows = byId((await ed.receipt("list_timeline_transitions_tool", { timeline_clip_id: a })).transitions);
    expect(rows[t1]!.order).toBe("earlier_to_later");
    await ed.receipt("reverse_transition_tool", { transition_ids: [t1] });
    rows = byId((await ed.receipt("list_timeline_transitions_tool", { timeline_clip_id: a })).transitions);
    expect(rows[t1]!.order).toBe("later_first");
  });
});

// ---------------------------------------------------------------------------
// reverse / remove / copy
// ---------------------------------------------------------------------------

describe("reverse_transition_tool / remove_transition_tool / copy_transition_tool", () => {
  it("reverse flips a whole track in one step and undoes; refused on a locked track", async () => {
    const { ed, t1 } = crossfaded();
    const r = await ed.receipt("reverse_transition_tool", { scope: "track", track: "1" });
    expect((r.transitions as Row[]).map((x) => x.direction)).toEqual(["reversed", "reversed"]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(transitionDirection(transition(ed, t1)!)).toBe("default");
    ed.lockTrack(L1);
    await ed.refused("reverse_transition_tool", { transition_ids: [t1] }, "locked");
  });

  it("remove keeps the clips; one undo step brings it back", async () => {
    const { ed, a, b, t1, t2 } = crossfaded();
    const r = await ed.receipt("remove_transition_tool", { at_seconds: "9.5", track: "1" });
    expect(r.removed_transition_ids).toEqual([t1]);
    expect(transition(ed, t1)).toBeUndefined();
    expect([ed.clip(a) !== undefined, ed.pos(b), transition(ed, t2) !== undefined]).toEqual([true, 9, true]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(transition(ed, t1)).toBeDefined();
    await ed.refused("remove_transition_tool", { at_seconds: 3 }, "no transition at 3.00s");
  });

  it("an ambiguous target is refused", async () => {
    const { ed } = crossfaded();
    await ed.refused("remove_transition_tool", {}, "2 transitions match");
    await ed.refused("remove_transition_tool", { scope: "selected" }, "no transitions are selected in the timeline");
  });

  it("scope=selected reads the editor's selection", async () => {
    const { ed, t2 } = crossfaded();
    ed.host.editor.selection = { clips: [], transitions: [t2], effects: [] };
    const r = await ed.receipt("remove_transition_tool", { scope: "selected" });
    expect(r.removed_transition_ids).toEqual([t2]);
  });

  it("copy all fits each target's length; mask copies only the wipe", async () => {
    const { ed, t1, t2 } = crossfaded();
    await ed.receipt("update_transition_tool", { transition_ids: [t2], duration_seconds: 2, keep_overlap: true });
    await ed.receipt("update_transition_tool", { transition_ids: [t1], mask: "wipe_left_to_right", contrast: 15 });
    await ed.receipt("reverse_transition_tool", { transition_ids: [t1] });
    ed.mark();
    const r = await ed.receipt("copy_transition_tool", { source_transition_id: t1, scope: "track", track: "1" });
    const target = transition(ed, t2)!;
    expect((r.transitions as Row[]).map((x) => x.transition_id)).toEqual([t2]);
    expect([target.reader.path, target.end, transitionDirection(target), lastX(target.brightness), target.position]).toEqual([
      "@transitions/common/wipe_left_to_right.svg",
      2,
      "reversed",
      61,
      18,
    ]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.mark();
    await ed.receipt("update_transition_tool", { transition_ids: [t2], mask: "circle" });
    await ed.receipt("copy_transition_tool", { source_transition_id: t1, transition_ids: [t2], what: "mask" });
    expect(transition(ed, t2)!.reader.path).toBe("@transitions/common/wipe_left_to_right.svg");
    ed.mark();
    await ed.refused("copy_transition_tool", { source_transition_id: t1, transition_ids: [t1] }, "choose at least one other transition to paste onto");
    await ed.refused("copy_transition_tool", { source_transition_id: "NOPE", transition_ids: [t2] }, "no transition with id='NOPE'");
    const same = await ed.call("copy_transition_tool", { source_transition_id: t1, transition_ids: [t2], what: "mask" });
    expect([same.status, same.summary]).toEqual(["unchanged", "No change: the targets already match."]);
  });
});

// ---------------------------------------------------------------------------
// add_transitions_between_clips_tool
// ---------------------------------------------------------------------------

function butting(ed: EditHarness, opts: { n?: number; length?: number; start?: number; layer?: number; fileDuration?: number } = {}): string[] {
  const { n = 3, length = 5, start = 0, layer = L1, fileDuration = 30 } = opts;
  const f = ed.addFile("video", { duration: fileDuration });
  return Array.from({ length: n }, (_, i) => ed.addClip(f, { position: i * length, start, end: start + length, layer }));
}

describe("add_transitions_between_clips_tool", () => {
  it("crossfades between all clips with ripple, in one undo step", async () => {
    const ed = new EditHarness();
    const [a, b, c] = butting(ed);
    const receipt = await ed.call("add_transitions_between_clips_tool", { track: "1", duration_seconds: "1.0" });
    expect(receipt.summary).toBe("Added 2 transition(s) on track 1; moved 2 clip(s) earlier to make the overlaps.");
    const r = receipt.data as Row;
    expect((r.added as Row[]).map((x) => x.between_clip_ids)).toEqual([
      [a, b],
      [b, c],
    ]);
    expect([ed.pos(b!), ed.pos(c!)]).toEqual([4, 8]);
    const trans = [...ed.doc.project.effects].sort((x, y) => x.position - y.position);
    expect(trans.map((t) => t.position)).toEqual([4, 8]);
    for (const t of trans) {
      expect([t.fade_audio_hint, t.end, t.reader.path, t.title]).toEqual([true, 1, "@transitions/common/fade.svg", "fade"]);
      expect(t).not.toHaveProperty("resource");
    }
    expect(r.moved_clips).toEqual([
      { timeline_clip_id: b, position: 4 },
      { timeline_clip_id: c, position: 8 },
    ]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([ed.doc.project.effects, ed.pos(c!)]).toEqual([[], 10]);
    ed.doc.redo();
    expect(ed.doc.project.effects).toHaveLength(2);
  });

  it("handles keep the cuts in place; joins without spare media are refused", async () => {
    const ed = new EditHarness();
    const [a, b, c] = butting(ed, { start: 2 });
    const r = await ed.receipt("add_transitions_between_clips_tool", { track: "1", duration_seconds: 1, method: "handles" });
    expect(r.added as Row[]).toHaveLength(2);
    expect([ed.clip(a!)!.end, ed.pos(b!), ed.clip(b!)!.start, ed.pos(c!)]).toEqual([7.5, 4.5, 1.5, 9.5]);
    expect(ed.doc.project.effects.map((t) => t.position).sort((x, y) => x - y)).toEqual([4.5, 9.5]);
    const noHandles = butting(ed, { layer: L2, start: 0, fileDuration: 5 });
    ed.mark();
    await ed.refused("add_transitions_between_clips_tool", { timeline_clip_ids: noHandles.slice(0, 2), method: "handles" }, "spare media");
  });

  it("existing overlaps, gaps, existing transitions and clamping", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const a = ed.addClip(f, { position: 0, end: 4 });
    const b = ed.addClip(f, { position: 3.5, end: 4 }); // overlaps a by 0.5
    const c = ed.addClip(f, { position: 9, end: 0.6 }); // a gap after b, very short
    const d = ed.addClip(f, { position: 9.6, end: 4 }); // butts c
    let r = await ed.receipt("add_transitions_between_clips_tool", { track: "1", method: "existing_overlaps" });
    expect((r.added as Row[]).map((x) => x.between_clip_ids)).toEqual([[a, b]]);
    expect((r.added as Row[])[0]!.duration).toBe(0.5);
    expect(new Set((r.skipped as Row[]).map((s) => s.reason))).toContain("clips do not overlap");
    ed.mark();
    r = await ed.receipt("add_transitions_between_clips_tool", { track: "1", duration_seconds: 2 });
    const reasons = Object.fromEntries((r.skipped as Row[]).map((s) => [s.join, s.reason]));
    expect(reasons[`${a}->${b}`]).toBe("already has a transition");
    expect(String(reasons[`${b}->${c}`])).toContain("gap");
    expect((r.added as Row[])[0]!.between_clip_ids).toEqual([c, d]);
    expect((r.added as Row[])[0]!.duration).toBeCloseTo(0.3, 9);
    ed.mark();
    r = await ed.receipt("add_transitions_between_clips_tool", { timeline_clip_ids: [a, b], replace_existing: true, transition: "circle" });
    expect((r.replaced_transition_ids as string[]).length).toBe(1);
    expect((r.added as Row[])[0]!.mask).toBe("circle_in_to_out");
  });

  it("refusals", async () => {
    const ed = new EditHarness();
    const [a] = butting(ed, { n: 2 });
    const one = butting(ed, { n: 1, layer: L2 });
    const cases: [Row, string][] = [
      [{}, "say which track (track) or which clips (timeline_clip_ids)"],
      [{ track: "2" }, "track 2 has fewer than two clips to join"],
      [{ track: "1", transition: "no-such-transition-zz" }, "unknown transition 'no-such-transition-zz'"],
      [{ timeline_clip_ids: [a, one[0]] }, "timeline_clip_ids must all be on one track"],
      [{ timeline_clip_ids: ["NOPE"] }, "no timeline clip with id='NOPE'"],
      [{ track: "1", transition: "wipe" }, "did you mean wipe_bottom_to_top, wipe_left_to_right"],
    ];
    for (const [args, fragment] of cases) await ed.refused("add_transitions_between_clips_tool", args, fragment);
    ed.lockTrack(L1);
    await ed.refused("add_transitions_between_clips_tool", { track: "1" }, "track 1 is locked; unlock it first");
  });

  it("random transitions and the default length", async () => {
    const ed = new EditHarness();
    butting(ed);
    const r = await ed.receipt("add_transitions_between_clips_tool", { track: "1", transition: "random", duration_seconds: 0 });
    const added = r.added as Row[];
    expect(added).toHaveLength(2);
    // duration_seconds=0: the engine's default transition length (the desktop's preference).
    for (const x of added) {
      expect(x.duration).toBe(1);
      expect(String(x.mask)).toMatch(/\w/);
    }
  });

  it("handles across a small gap keep both clips in sync", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const a = ed.addClip(f, { position: 0, start: 2, end: 7 }); // 0-5
    const b = ed.addClip(f, { position: 5, start: 10, end: 15 });
    ed.setClip(b, { position: 5.04 }); // 5.04-10.04: a tiny gap, off the frame grid like the desktop test
    const offset = 5.04 - 10.0; // timeline - source
    await ed.receipt("add_transitions_between_clips_tool", { track: "1", method: "handles", duration_seconds: 1 });
    const ca = ed.clip(a)!;
    const cb = ed.clip(b)!;
    expect(cb.position - cb.start).toBeCloseTo(offset, 6);
    expect(cb.position + (cb.end - cb.start)).toBeCloseTo(10.04, 9);
    expect([ca.position, ca.start]).toEqual([0, 2]);
    expect(ca.position + ca.end - ca.start - cb.position).toBeCloseTo(1, 1);
  });
});
