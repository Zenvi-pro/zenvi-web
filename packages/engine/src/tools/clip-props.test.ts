/**
 * Clip property tools: read and set properties, remove and copy keyframes,
 * the clip menu's presets. Ported from zenvi-core develop
 * tests/test_editor_tools_clip_props.py and test_editor_tools_clip_presets.py:
 * every change is exactly one undo step, every refusal adds none. Arguments
 * go in the way the Zenvi Assistant sends them (strings, JSON objects as
 * text, comma lists) where that is what a case checks.
 */

import { describe, expect, it } from "vitest";
import { evaluate } from "../keyframe/evaluate.js";
import type { Clip, Keyframe } from "../model/types.js";
import { CLIP_PRESET_IDS, isClipPresetId } from "../ops/presets.js";
import { CLIP_MENU_PRESETS, enginePreset } from "./catalog/clip-props.js";
import { contractInputs } from "./schemas.gen.js";
import { EditHarness } from "./test-support/edit-harness.js";

const T1 = 1_000_000;
const T2 = 2_000_000;

type Row = Record<string, unknown>;

/** A curve like the desktop tests' `pts`: LINEAR points (interpolation 1) unless given. */
function pts(pairs: [number, number][], interpolation = 1): Keyframe {
  return { Points: pairs.map(([x, y]) => ({ co: { X: x, Y: y }, interpolation: interpolation as 0 | 1 | 2 })) };
}
const xs = (curve: unknown): number[] => (curve as Keyframe).Points.map((p) => p.co.X);
const ys = (curve: unknown): number[] => (curve as Keyframe).Points.map((p) => p.co.Y);

function hd(ed: EditHarness): void {
  ed.doc.setUntracked(["width"], 1920);
  ed.doc.setUntracked(["height"], 1080);
}

describe("get_clip_properties_tool", () => {
  it("reports values, ranges and choices like the Properties dock, changing nothing", async () => {
    const ed = new EditHarness();
    hd(ed);
    const c = ed.addClip(ed.addFile("video", { duration: 30 }), { position: 2 });
    const r = await ed.receipt("get_clip_properties_tool", { timeline_clip_id: c });
    const props = r.properties as Record<string, Row>;
    expect(props.alpha).toMatchObject({ value: 1, keyframable: true, min: 0, max: 1, label: "Alpha", type: "float" });
    expect(props.scale!.value).toBe("Best Fit");
    expect(props.scale!.choices).toContain("Crop");
    expect(props.gravity!.value).toBe("Center");
    expect(props.composite!.choices).toContain("Multiply");
    expect(props.composite!.keyframable).toBe(false);
    expect(props.volume!.max).toBe(1.3); // the Volume menu's 130%
    expect([props.scale_x!.min, props.scale_x!.max]).toEqual([-52, 52]); // the Properties dock's clamp at 1920x1080
    expect(props.wave_color!.value).toBe("#007bffff");
    for (const hidden of ["position", "start", "end", "layer", "id", "perspective_c1_x"]) expect(props[hidden]).toBeUndefined();
    expect(r.timeline_clip_id).toBe(c);
    expect(r.first_frame).toBe(1);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("evaluates keyframes on a trimmed clip at a timeline time, for named properties", async () => {
    const ed = new EditHarness();
    // Trimmed 5 s into the source and placed at 10 s: the first visible frame is X=151.
    const c = ed.addClip(ed.addFile("video", { duration: 30 }), { position: 10, start: 5, end: 15 });
    ed.setClip(c, { scale_x: pts([[151, 1.0], [271, 2.0]]) });
    const r = await ed.receipt("get_clip_properties_tool", { timeline_clip_id: c, at_seconds: "12", properties: "Scale X, alpha" });
    const props = r.properties as Record<string, Row>;
    expect(Object.keys(props).sort()).toEqual(["alpha", "scale_x"]);
    expect([r.frame, r.clip_seconds]).toEqual([211, 2]);
    expect(props.scale_x!.value).toBeCloseTo(1.5, 10);
    expect(props.scale_x!.animated).toBe(true);
    const keyframes = props.scale_x!.keyframes as Row[];
    expect(keyframes.map((k) => k.clip_seconds)).toEqual([0, 4]);
    expect(keyframes.map((k) => k.timeline_seconds)).toEqual([10, 14]);
    expect(props.alpha!.keyframes).toBeUndefined();
    const summary = (await ed.call("get_clip_properties_tool", { timeline_clip_id: c, at_seconds: 12 })).summary;
    expect(summary).toMatch(/^Clip \S+ 'video-\d+\.mp4' \(track 1, 10\.00-20\.00 s\) at 12\.00 s: alpha 1, scale Best Fit, gravity Center, scale_x 1\.5, .*Animated: scale_x\.$/);
  });

  it("reads the playhead when it is over the clip, else the first frame", async () => {
    const ed = new EditHarness({ playhead: 3 });
    const c = ed.addClip(ed.addFile("video", { duration: 30 }), { position: 0, end: 10 });
    expect((await ed.receipt("get_clip_properties_tool", { timeline_clip_id: c, properties: ["alpha"] })).frame).toBe(91);
    ed.host.player!.seek(50);
    expect((await ed.receipt("get_clip_properties_tool", { timeline_clip_id: c, properties: ["alpha"] })).frame).toBe(1);
  });

  it("refuses a time outside the clip and unknown names", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { position: 10, end: 5 });
    await ed.refused("get_clip_properties_tool", { timeline_clip_id: c, at_seconds: 2 }, "outside clip", "(timeline 10.000-15.000 s)");
    await ed.refused("get_clip_properties_tool", { timeline_clip_id: c, properties: ["sparkle"] }, "unknown clip property 'sparkle'; settable: alpha,");
  });
});

describe("set_clip_properties_tool", () => {
  it("takes keys, labels, aliases, choice names and colours in one undo step", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const r = await ed.receipt("set_clip_properties_tool", {
      timeline_clip_ids: c,
      properties: JSON.stringify({ opacity: 0.5, scale: "fit", gravity: "top right", "Blend Mode": "multiply", Rotation: 15, wave_color: "#ff8800" }),
    });
    const d = ed.clip(c)!;
    expect(ys(d.alpha)).toEqual([0.5]);
    expect([d.scale, d.gravity, d.composite]).toEqual([1, 2, 13]);
    expect(ys(d.rotation)).toEqual([15]);
    expect(ys(d.wave_color.red)).toEqual([255]);
    expect(ys(d.wave_color.green)).toEqual([136]);
    expect(((r.clips as Row[])[0]!.changed as Row).composite).toEqual({ before: "Normal", after: "Multiply" });
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    const back = ed.clip(c)!;
    expect(ys(back.alpha)).toEqual([1]);
    expect([back.composite, back.gravity]).toEqual([0, 4]);
  });

  it("sets many clips in one undo step", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video");
    const a = ed.addClip(f, { position: 0 });
    const b = ed.addClip(f, { position: 30 });
    await ed.receipt("set_clip_properties_tool", { scope: "all", properties: { alpha: "0.25" } });
    expect([ys(ed.clip(a)!.alpha), ys(ed.clip(b)!.alpha)]).toEqual([[0.25], [0.25]]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([ys(ed.clip(a)!.alpha), ys(ed.clip(b)!.alpha)]).toEqual([[1], [1]]);
    ed.doc.redo();
    expect(ys(ed.clip(b)!.alpha)).toEqual([0.25]);
  });

  it("flattens an animation to a static value and says so", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    ed.setClip(c, { alpha: pts([[1, 0], [31, 1]]) });
    const receipt = await ed.call("set_clip_properties_tool", { timeline_clip_ids: [c], properties: { alpha: 0.5 } });
    expect(ys(ed.clip(c)!.alpha)).toEqual([0.5]);
    expect(((receipt.data as Row).clips as Row[])[0]!.flattened_animation).toEqual({ alpha: 2 });
    expect(receipt.summary).toBe("Set alpha=0.5 on 1 clip(s). Replaced an animation with a static value on: alpha.");
  });

  it("at_seconds keyframes the value at that timeline time and keeps the other points", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video", { duration: 30 }), { position: 10, start: 4, end: 14 });
    ed.setClip(c, { scale_x: pts([[121, 1.0], [421, 1.0]]) });
    await ed.receipt("set_clip_properties_tool", { timeline_clip_ids: [c], properties: { scale_x: 1.4 }, at_seconds: "12" });
    const curve = ed.clip(c)!.scale_x;
    expect(xs(curve)).toEqual([121, 181, 421]);
    expect(ys(curve)[1]).toBe(1.4);
  });

  it.each([
    [{ position: 3 }, "timeline editing tools"],
    [{ layer: 2 }, "timeline editing tools"],
    [{ id: "X" }, "read-only"],
    [{ perspective_c1_x: 0.2 }, "does not render"],
    [{ sparkle: 1 }, "unknown clip property"],
    [{ alpha: 2 }, "between 0 and 1"],
    [{ alpha: "lots" }, "must be a number"],
    [{ gravity: "sideways" }, "must be one of"],
    [{ scale_x: 60 }, "between -52 and 52"],
    [{ volume: 1.4 }, "between 0 and 1.3"],
    [{ channel_filter: 1.5 }, "whole number"],
    [{ time: 10 }, "speed"],
    [{ wave_color: "not-a-color" }, "unrecognised color"],
    [{ alpha: 0.5, opacity: 0.4 }, "sets alpha, which is already in properties"],
  ])("refuses %j leaving history untouched", async (props, fragment) => {
    const ed = new EditHarness();
    hd(ed);
    const c = ed.addClip(ed.addFile("video"));
    await ed.refused("set_clip_properties_tool", { timeline_clip_ids: [c], properties: props }, fragment);
  });

  it("static properties take no at_seconds", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.refused("set_clip_properties_tool", { timeline_clip_ids: [c], properties: { composite: "screen" }, at_seconds: 1 }, "cannot be animated");
  });

  it("mirrors, takes percents and booleans in the clip's own JSON types", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.receipt("set_clip_properties_tool", { timeline_clip_ids: [c], properties: { scale_x: -1, volume: "80%", waveform: true } });
    const d = ed.clip(c)!;
    expect(ys(d.scale_x)).toEqual([-1]);
    expect(ys(d.volume)).toEqual([0.8]);
    expect(d.waveform).toBe(true);
  });

  it("sets a negative scale on an edge-anchored clip but warns, until it is centred", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    ed.setClip(c, { gravity: 2 });
    const r = await ed.receipt("set_clip_properties_tool", { timeline_clip_ids: [c], properties: { scale_x: -0.5 } });
    expect(ys(ed.clip(c)!.scale_x)).toEqual([-0.5]);
    expect(((r.clips as Row[])[0]!.warnings as string[])[0]).toContain("off-screen");
    const centred = await ed.receipt("set_clip_properties_tool", { timeline_clip_ids: [c], properties: { gravity: "Top Center" } });
    expect((centred.clips as Row[])[0]!.warnings).toBeUndefined();
  });

  it("refuses clips on locked tracks by id and skips them by scope", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video");
    const a = ed.addClip(f, { layer: T1 });
    const b = ed.addClip(f, { layer: T2 });
    ed.lockTrack(T2);
    await ed.refused("set_clip_properties_tool", { timeline_clip_ids: [b], properties: { alpha: 0.5 } }, "locked");
    const r = await ed.receipt("set_clip_properties_tool", { scope: "all", properties: { alpha: 0.5 } });
    expect((r.skipped as Row[]).map((s) => s.timeline_clip_id)).toEqual([b]);
    expect([ys(ed.clip(a)!.alpha), ys(ed.clip(b)!.alpha)]).toEqual([[0.5], [1]]);
  });

  it("setting what is already there adds no undo step", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const receipt = await ed.call("set_clip_properties_tool", { timeline_clip_ids: [c], properties: { alpha: 1.0, scale: "Best Fit" } });
    expect(receipt.status).toBe("unchanged");
    expect((receipt.data as Row).changed).toBe(false);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("sets parentObjectId to another clip and refuses itself", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video");
    const a = ed.addClip(f, { layer: T1 });
    const b = ed.addClip(f, { layer: T2 });
    await ed.receipt("set_clip_properties_tool", { timeline_clip_ids: [b], properties: { parent: a } });
    expect(ed.clip(b)!.parentObjectId).toBe(a);
    ed.mark();
    await ed.refused("set_clip_properties_tool", { timeline_clip_ids: [a], properties: { parentObjectId: a } }, "its own parent");
  });
});

describe("remove_keyframes_tool", () => {
  it("removing every point falls back to the dock default", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    ed.setClip(c, { scale_x: pts([[1, 1.0], [301, 1.2]]), alpha: pts([[1, 0.0], [31, 1.0]]) });
    const r = await ed.receipt("remove_keyframes_tool", { timeline_clip_ids: [c], properties: "scale_x" });
    expect(ys(ed.clip(c)!.scale_x)).toEqual([1]);
    expect(ys(ed.clip(c)!.alpha)).toEqual([0, 1]);
    expect(((r.clips as Row[])[0]!.properties as Row).scale_x).toEqual({ removed: 2, remaining: 1, reset_to: 1 });
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ys(ed.clip(c)!.scale_x)).toEqual([1, 1.2]);
  });

  it("removing a timeline range keeps the rest", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { position: 10 });
    ed.setClip(c, { location_x: pts([[1, 0.0], [61, 0.5], [121, 0.0], [181, 0.5]]) });
    await ed.receipt("remove_keyframes_tool", { timeline_clip_ids: [c], properties: ["Location X"], start_seconds: "11.5", end_seconds: "14" });
    expect(xs(ed.clip(c)!.location_x)).toEqual([1, 181]);
  });

  it("all clears every animated property only", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    ed.setClip(c, { scale_x: pts([[1, 0.5]]), alpha: pts([[1, 0.0], [31, 1.0]]), rotation: pts([[1, 0.0], [91, 90.0]]) });
    const r = await ed.receipt("remove_keyframes_tool", { timeline_clip_ids: [c], properties: ["all"] });
    const d = ed.clip(c)!;
    expect([ys(d.alpha), ys(d.rotation), ys(d.scale_x)]).toEqual([[1], [0], [0.5]]);
    expect(Object.keys((r.clips as Row[])[0]!.properties as Row).sort()).toEqual(["alpha", "rotation"]);
  });

  it("nothing to remove is an error without an undo step; time is refused", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.refused("remove_keyframes_tool", { timeline_clip_ids: [c], properties: ["all"] }, "no keyframes");
    await ed.refused("remove_keyframes_tool", { timeline_clip_ids: [c], properties: ["time"] }, "speed tools");
    await ed.refused("remove_keyframes_tool", { timeline_clip_ids: [c], properties: ["composite"] }, "holds a single value");
  });
});

describe("copy_clip_keyframes_tool", () => {
  it("stretches a whole-clip zoom onto a shorter trimmed clip, with its gravity", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const src = ed.addClip(f, { end: 10 });
    ed.setClip(src, { gravity: 2, scale_x: pts([[1, 1.0], [301, 1.2]]), scale_y: pts([[1, 1.0], [301, 1.2]]) });
    const dst = ed.addClip(f, { position: 20, start: 2, end: 7 });
    const r = await ed.receipt("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: dst, groups: "scale" });
    const d = ed.clip(dst)!;
    expect([xs(d.scale_x), ys(d.scale_x)]).toEqual([
      [61, 211],
      [1, 1.2],
    ]);
    expect(d.gravity).toBe(2);
    expect(ys(d.alpha)).toEqual([1]);
    expect((r.clips as Row[])[0]!.properties).toEqual(["gravity", "scale_x", "scale_y"]);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("offset and exact timing", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const src = ed.addClip(f, { end: 10 });
    ed.setClip(src, { alpha: pts([[1, 0.0], [31, 1.0]]) });
    const dst = ed.addClip(f, { position: 20, start: 2, end: 7 });
    await ed.receipt("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst], groups: ["alpha"], timing: "Offset" });
    expect(xs(ed.clip(dst)!.alpha)).toEqual([61, 91]);
    await ed.receipt("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst], groups: ["alpha"], timing: "exact" });
    expect(xs(ed.clip(dst)!.alpha)).toEqual([1, 31]);
  });

  it("copying a fade from a trimmed clip keeps its start", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const src = ed.addClip(f, { start: 2, end: 12.5 });
    ed.setClip(src, { alpha: pts([[1, 1.0], [61, 0.0], [121, 1.0], [316, 1.0], [376, 0.0]]) });
    const dst = ed.addClip(f, { position: 20, end: 6 });
    await ed.receipt("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst], groups: ["alpha"] });
    const curve = ed.clip(dst)!.alpha;
    expect([xs(curve)[0], ys(curve)[0]]).toEqual([1, 0]);
    expect(ys(curve)).toEqual([0, 1, 1, 0]);
    expect(xs(curve).at(-1)).toBe(181);
  });

  it("points outside the source's visible range become exact edge values", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const src = ed.addClip(f, { start: 2, end: 12 }); // visible 61-361
    ed.setClip(src, { scale_x: pts([[1, 1.0], [661, 2.0]]) });
    const dst = ed.addClip(f, { position: 20, end: 10 });
    await ed.receipt("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst], groups: ["scale"], timing: "offset" });
    const curve = ed.clip(dst)!.scale_x;
    expect(xs(curve)).toEqual([1, 301]);
    expect(ys(curve)[0]).toBeCloseTo(1 + 60 / 660, 10);
    expect(ys(curve)[1]).toBeCloseTo(1 + 360 / 660, 10);
  });

  it("all leaves the speed curve unless exact", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const src = ed.addClip(f, { end: 10 });
    ed.setClip(src, { time: pts([[1, 1.0], [301, 150.0]]), volume: pts([[1, 0.2]]) });
    const dst = ed.addClip(f, { position: 20, end: 10 });
    const r = await ed.receipt("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst] });
    expect([ys(ed.clip(dst)!.time), ys(ed.clip(dst)!.volume)]).toEqual([[1], [0.2]]);
    expect(r.not_copied).toEqual(["time"]);
    ed.mark();
    await ed.refused("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst], groups: ["time"] }, "timing='exact'");
    await ed.receipt("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst], groups: ["time"], timing: "exact" });
    expect(ys(ed.clip(dst)!.time)).toEqual([1, 150]);
  });

  it("refuses bad targets", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const src = ed.addClip(f, { end: 10 });
    await ed.refused("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [src] }, "source clip itself");
    await ed.refused("copy_clip_keyframes_tool", { source_clip_id: src }, "name the target clips");
    const dst = ed.addClip(f, { position: 20 });
    ed.lockTrack(T1);
    await ed.refused("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst] }, "locked");
  });

  it("copying identical keyframes is a no-op", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const src = ed.addClip(f, { end: 10 });
    const dst = ed.addClip(f, { position: 20, end: 10 });
    const receipt = await ed.call("copy_clip_keyframes_tool", { source_clip_id: src, timeline_clip_ids: [dst] });
    expect(receipt.status).toBe("unchanged");
    expect((receipt.data as Row).changed).toBe(false);
    expect(ed.stepsSinceMark()).toBe(0);
  });
});

describe("apply_clip_preset_tool", () => {
  it("the preset table is the contract's list, and every preset is an engine preset", () => {
    const schema = contractInputs.apply_clip_preset_tool.shape.preset;
    expect([...CLIP_MENU_PRESETS.keys()]).toEqual(schema.options);
    for (const spec of CLIP_MENU_PRESETS.values()) {
      const engine = enginePreset(spec);
      if ("id" in engine) expect(isClipPresetId(engine.id), spec.name).toBe(true);
    }
    expect(CLIP_PRESET_IDS).toContain("crop.resize");
  });

  it.each([...CLIP_MENU_PRESETS.keys()])("%s changes the clip in one undo step (or nothing)", async (name) => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video", { hasAudio: true, duration: 30 }), { end: 10 });
    const receipt = await ed.call("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: name, ...(name === "volume_level" ? { level_percent: "60" } : {}) });
    expect(receipt.summary).not.toMatch(/^Error/);
    if (["fade_none", "volume_reset", "motion_none", "rotate_none", "crop_none", "layout_reset", "transform_none"].includes(name)) {
      // Already like that on a fresh clip: no undo step.
      expect(receipt.status).toBe("unchanged");
      expect(ed.stepsSinceMark()).toBe(0);
      return;
    }
    expect(receipt.status).toBe("applied");
    expect(ed.stepsSinceMark()).toBe(1);
    expect(((receipt.data as Row).clips as Row[])[0]!.timeline_clip_id).toBe(c);
  });

  it("duration_seconds sets the fade length; a short clip keeps room between in and out", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video", { duration: 30 }), { position: 5, end: 5 });
    const r = await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "fade_in_out", duration_seconds: "2" });
    // 5 s = 150 frames: each fade takes at most a third (50 frames) of it.
    expect([xs(ed.clip(c)!.alpha), ys(ed.clip(c)!.alpha)]).toEqual([
      [1, 51, 101, 151],
      [0, 1, 1, 0],
    ]);
    expect(r.fade_seconds).toBe(2);
    const long = ed.addClip(ed.addFile("video", { duration: 30 }), { position: 20, end: 20 });
    await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [long], preset: "fade_in", duration_seconds: 2.5 });
    expect(xs(ed.clip(long)!.alpha)).toEqual([1, 76]);
  });

  it("emphasis starts at at_seconds and lasts duration_seconds", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video", { duration: 30 }), { position: 5, end: 10 });
    const r = await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "tada", at_seconds: 8, duration_seconds: 0.5 });
    expect(r.emphasis_starts_at).toEqual({ [c]: 8 });
    expect(r.zone_seconds).toBe(0.5);
    // Clip frames 91 (3 s in) to 91 + 15; the clip's own point at X=1 stays.
    const frames = xs(ed.clip(c)!.scale_x);
    expect(frames).toContain(91);
    expect(frames.at(-1)).toBe(106);
    expect(frames.filter((x) => x > 1 && x < 91)).toEqual([]);
  });

  it("volume_level takes the percent", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("audio"));
    const r = await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "volume_level", level_percent: 60 });
    expect(ys(ed.clip(c)!.volume)[0]).toBeCloseTo(0.6, 6);
    expect(r.level_percent).toBe(60);
  });

  it.each([
    [{ preset: "zoom_in", duration_seconds: 3 }, "whole clip"],
    [{ preset: "rotate_90_right", duration_seconds: 3 }, "no length"],
    [{ preset: "zoom_in", at_seconds: 1 }, "Emphasis"],
    [{ preset: "volume_level" }, "needs level_percent"],
    [{ preset: "fade_in", level_percent: 50 }, "only goes with"],
    [{ preset: "wobble", at_seconds: 99 }, "not over any"],
  ])("refuses %j", async (args, fragment) => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { end: 10 });
    await ed.refused("apply_clip_preset_tool", { timeline_clip_ids: [c], ...args }, fragment);
  });

  it("refuses an unknown preset at validation", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { end: 10 });
    await ed.refused("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "sparkle" }, "preset");
  });

  it("skips clips a preset does not apply to", async () => {
    const ed = new EditHarness();
    const video = ed.addClip(ed.addFile("video"), { end: 10 });
    const audio = ed.addClip(ed.addFile("audio"), { position: 20 });
    let r = await ed.receipt("apply_clip_preset_tool", { scope: "all", preset: "zoom_in" });
    expect(r.skipped).toEqual([{ timeline_clip_id: audio, reason: "audio-only clip (no picture to move or transform)" }]);
    expect((r.clips as Row[]).map((c) => c.timeline_clip_id)).toEqual([video]);
    r = await ed.receipt("apply_clip_preset_tool", { scope: "all", preset: "volume_fade_out" });
    expect((r.clips as Row[]).map((c) => c.timeline_clip_id)).toEqual([audio]); // the silent video is skipped
    ed.mark();
    await ed.refused("apply_clip_preset_tool", { timeline_clip_ids: [audio], preset: "ken_burns_in" }, "does not apply");
  });

  it("fades apply to every kind of clip", async () => {
    const ed = new EditHarness();
    const a = ed.addClip(ed.addFile("video"), { end: 10 });
    const b = ed.addClip(ed.addFile("audio"), { position: 20 });
    const i = ed.addClip(ed.addFile("image"), { position: 40 });
    const r = await ed.receipt("apply_clip_preset_tool", { scope: "all", preset: "fade_in" });
    expect((r.clips as Row[]).map((c) => c.timeline_clip_id).sort()).toEqual([a, b, i].sort());
  });

  it("refuses locked clips by id and skips them by scope", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video");
    const a = ed.addClip(f, { end: 10 });
    const b = ed.addClip(f, { end: 10, layer: T2 });
    ed.lockTrack(T2);
    await ed.refused("apply_clip_preset_tool", { timeline_clip_ids: [b], preset: "rotate_90_left" }, "locked");
    const r = await ed.receipt("apply_clip_preset_tool", { scope: "all", preset: "rotate_90_left" });
    expect((r.clips as Row[]).map((c) => c.timeline_clip_id)).toEqual([a]);
    expect((r.skipped as Row[])[0]!.timeline_clip_id).toBe(b);
    expect(evaluate(ed.clip(a)!.rotation, 1)).toBe(-90);
  });

  it("the receipt lists the changed properties and the Crop effect it added", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { end: 10 });
    const r = await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "crop_resize" });
    const crop = ed.clip(c)!.effects.find((e) => e.class_name === "Crop")!;
    expect(crop.resize).toBe(true);
    expect((r.clips as Row[])[0]!.effects_added).toEqual([{ id: crop.id, class_name: "Crop" }]);
    await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "crop_none" });
    expect(ed.clip(c)!.effects).toEqual([]);
  });

  it("a preset that changes nothing leaves no undo step and keeps redo", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { end: 10 });
    await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "rotate_90_right" });
    ed.doc.undo();
    expect(ed.doc.canRedo).toBe(true);
    ed.mark();
    const receipt = await ed.call("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "rotate_none" });
    expect(receipt.status).toBe("unchanged");
    expect(ed.stepsSinceMark()).toBe(0);
    expect(ed.doc.canRedo).toBe(true);
    ed.doc.redo();
    expect(evaluate(ed.clip(c)!.rotation, 1)).toBe(90);
  });

  it("flip negates scale and keeps the animation", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { end: 10 });
    ed.setClip(c, { scale_x: { Points: [{ co: { X: 1, Y: 1 } }, { co: { X: 301, Y: 1.2 } }] } });
    await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "flip_horizontal" });
    expect(ys(ed.clip(c)!.scale_x)).toEqual([-1, -1.2]);
    await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "FLIP_HORIZONTAL" });
    expect(ys(ed.clip(c)!.scale_x)).toEqual([1, 1.2]);
    expect(ed.stepsSinceMark()).toBe(2);
  });

  it.each([
    [2, "flip_horizontal", false],
    [2, "flip_vertical", false],
    [5, "flip_horizontal", false],
    [5, "flip_vertical", true],
    [1, "flip_horizontal", true],
    [1, "flip_vertical", false],
    [4, "flip_horizontal", true],
    [4, "flip_vertical", true],
  ])("gravity %i: %s mirrors in place only when centred on that axis (%s)", async (gravity, preset, allowed) => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { end: 10 });
    ed.setClip(c, { gravity, scale_x: pts([[1, 0.5]], 0), scale_y: pts([[1, 0.5]], 0) });
    const receipt = await ed.call("apply_clip_preset_tool", { timeline_clip_ids: [c], preset });
    if (allowed) {
      expect(receipt.status).toBe("applied");
      const key = preset === "flip_horizontal" ? "scale_x" : "scale_y";
      expect(ys(ed.clip(c)![key])[0]).toBe(-0.5);
      expect(ed.stepsSinceMark()).toBe(1);
    } else {
      expect(receipt.summary).toMatch(/^Error/);
      expect(receipt.summary).toContain("off-screen");
      expect(receipt.summary).toContain("set gravity to");
      expect(ed.stepsSinceMark()).toBe(0);
    }
  });

  it.each([
    ["slide_in_from_left", true],
    ["pulse", true],
    ["pop_out", true],
    ["zoom_in", false],
    ["credits_scroll_up", false],
    ["motion_none", false],
  ])("%s keeps a corner picture-in-picture in its corner: %s", async (preset, kept) => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { end: 10 });
    ed.setClip(c, { gravity: 2 });
    const r = await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset });
    expect(ed.clip(c)!.gravity).toBe(kept ? 2 : 4);
    expect("kept_gravity" in r).toBe(kept);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.clip(c)!.gravity).toBe(2);
  });

  it("wipe-out circles use the reversed masks (OpenShot ac9621a02)", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { end: 10 });
    await ed.receipt("apply_clip_preset_tool", { timeline_clip_ids: [c], preset: "wipe_out_circle_expand" });
    const mask = (ed.clip(c) as Clip).effects.find((e) => e.class_name === "Mask")!;
    expect(String((mask.reader as { path: string }).path)).toBe("@transitions/common/circle_out_to_in.svg");
  });
});
