/**
 * Effects-color tools, part 1: list_effects_tool, get_clip_effects_tool,
 * update_effect_tool, remove_effect_tool, copy_effects_tool and the
 * process_clip_effect_tool refusal. Ported from zenvi-core develop
 * tests/test_editor_tools_effects_color.py, through runTool with string
 * arguments; one undo step per change, none per refusal.
 */

import { describe, expect, it } from "vitest";
import type { Effect, Keyframe } from "../model/types.js";
import { mergeEffectsByClass } from "../ops/effects.js";
import { runTool } from "./registry.js";
import { EditHarness } from "./test-support/edit-harness.js";
import { fakeHost } from "./test-support/fake-host.js";

type Row = Record<string, unknown>;

const T2 = 2_000_000;

function y(kf: unknown): number[] {
  return (kf as Keyframe).Points.map((p) => p.co.Y);
}

function x(kf: unknown): number[] {
  return (kf as Keyframe).Points.map((p) => p.co.X);
}

function effectsOf(ed: EditHarness, clipId: string, className?: string): Effect[] {
  return (ed.clip(clipId)?.effects ?? []).filter((e) => className === undefined || e.class_name === className);
}

describe("list_effects_tool", () => {
  it("lists all 43 effects, by kind and by query, and changes nothing", async () => {
    const ed = new EditHarness();
    const all = await ed.receipt("list_effects_tool");
    expect(all.effects as Row[]).toHaveLength(43);
    expect((await ed.receipt("list_effects_tool", { kind: "video" })).effects as Row[]).toHaveLength(34);
    const audio = (await ed.receipt("list_effects_tool", { kind: "AUDIO" })).effects as Row[];
    expect(audio).toHaveLength(9);
    expect(audio.map((e) => e.effect)).toEqual(expect.arrayContaining(["Compressor", "Echo", "ParametricEQ"]));
    expect(((await ed.receipt("list_effects_tool", { query: "blur" })).effects as Row[]).map((e) => e.effect)).toContain("Blur");
    expect((await ed.call("list_effects_tool", { query: "blur" })).summary).toBe("1 effect(s) matching 'blur'");
    expect(all.common_properties).toEqual(["apply_before_clip", "mask_invert", "mask_loop_mode", "mask_time_mode", "mask_reader", "mask_source_id"]);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("still takes the web's older category argument", async () => {
    const ed = new EditHarness();
    expect((await ed.receipt("list_effects_tool", { category: "audio" })).effects as Row[]).toHaveLength(9);
  });

  it("describes one effect by alias, without the hidden keys", async () => {
    const ed = new EditHarness();
    const r = await ed.receipt("list_effects_tool", { effect: "greenscreen" });
    const effect = r.effect as Row;
    const props = effect.properties as Record<string, Row>;
    expect(effect.effect).toBe("ChromaKey");
    expect(props.fuzz).toMatchObject({ min: 0, max: 125, default: 20 });
    expect(props.keymethod!.choices).toContainEqual({ name: "HSV/HSL hue", value: 1 });
    expect(props).not.toHaveProperty("id");
    expect(props).not.toHaveProperty("position");
    expect((r.common_properties as Row).mask_source_id).toMatchObject({ type: "string" });
  });

  it("says which effects the web renderers cannot draw", async () => {
    const ed = new EditHarness();
    const rows = (await ed.receipt("list_effects_tool", { include_properties: "true" })).effects as Row[];
    expect(rows.find((e) => e.effect === "Stabilizer")).toMatchObject({ needs_processing: true, renders_on_web: false });
    expect(rows.find((e) => e.effect === "Blur")).not.toHaveProperty("renders_on_web");
    expect(rows.find((e) => e.effect === "Blur")!.properties as Row).toHaveProperty("sigma");
  });

  it("refuses an unknown name with the closest one", async () => {
    const ed = new EditHarness();
    await ed.refused("list_effects_tool", { effect: "Blurr" }, "unknown effect 'Blurr'", "Blur");
    await ed.refused("list_effects_tool", { kind: "audio", query: "sparkle" }, "no audio effect matches 'sparkle'");
  });
});

describe("get_clip_effects_tool", () => {
  it("lists ids, classes and current values, keyframes in timeline seconds", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { position: 5 });
    const eid = ed.addEffect(c, "Blur");
    const r = await ed.receipt("get_clip_effects_tool", { timeline_clip_id: c });
    const row = ((r.clips as Row[])[0]!.effects as Row[])[0]!;
    expect(row).toMatchObject({ effect_id: eid, effect: "Blur", name: "Blur", kind: "video" });
    expect((row.values as Row).horizontal_radius).toBe(6.0);
    expect((await ed.call("get_clip_effects_tool", { timeline_clip_id: c })).summary).toBe(`Clip ${c} has 1 effect(s): Blur`);
    await ed.receipt("update_effect_tool", { effect_id: eid, properties: '{"sigma": [{"time": 5, "value": 8}, {"time": "7", "value": 0}]}' });
    const values = ((((await ed.receipt("get_clip_effects_tool", { timeline_clip_id: c, detail: "full" })).clips as Row[])[0]!.effects as Row[])[0]!.values) as Row;
    expect(values.sigma).toEqual({ keyframes: [{ time: 5, value: 8 }, { time: 7, value: 0 }] });
    const summary = ((((await ed.receipt("get_clip_effects_tool", { timeline_clip_id: c, detail: "summary" })).clips as Row[])[0]!.effects as Row[])[0]!) as Row;
    expect(summary).not.toHaveProperty("values");
  });

  it("covers every clip with scope=all", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video");
    ed.addClip(f, { position: 0 });
    ed.addClip(f, { position: 20 });
    expect((await ed.call("get_clip_effects_tool", { scope: "all" })).summary).toBe("0 effect(s) on 2 clip(s)");
  });
});

describe("add_effect_tool", () => {
  it("adds an effect with its properties as one undo step", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const r = await ed.call("add_effect_tool", { timeline_clip_id: c, effect: "Blur", properties: '{"horizontal_radius": 12, "sigma": "4"}' });
    expect(r.summary).toBe("Added Blur to 1 clip(s).");
    const blur = effectsOf(ed, c, "Blur")[0]!;
    const data = r.data as Row;
    expect([data.effect, data.effect_id, data.timeline_clip_id, data.changed]).toEqual(["Blur", blur.id, c, true]);
    expect((data.clips as Row[])[0]).toEqual({ timeline_clip_id: c, effect_id: blur.id, action: "added" });
    expect([y(blur.horizontal_radius), y(blur.sigma)]).toEqual([[12], [4]]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(effectsOf(ed, c, "Blur")).toEqual([]);
    ed.doc.redo();
    expect(effectsOf(ed, c, "Blur")[0]!.id).toBe(blur.id);
  });

  it("takes #183's arguments: a clip by description, effect_name and occurrence", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { name: "sample_video.mp4" });
    ed.addClip(f, { position: 0 });
    const c2 = ed.addClip(f, { position: 30 });
    const r = await ed.receipt("add_effect_tool", { clip_query: "sample_video", effect_name: "crop", occurrence: "2" });
    expect(r.timeline_clip_id).toBe(c2);
    expect(effectsOf(ed, c2, "Crop")).toHaveLength(1);
  });

  it("keyframes properties at clip frames that count the trim", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { position: 10, start: 2, end: 8 });
    await ed.receipt("add_effect_tool", {
      timeline_clip_id: c,
      effect: "Pixelate",
      properties: { pixelization: [{ time: 10, value: 0.9 }, { time: 12, value: 0, interpolation: "linear" }] },
    });
    const kf = effectsOf(ed, c, "Pixelate")[0]!.pixelization as Keyframe;
    expect([x(kf), y(kf), kf.Points[1]!.interpolation]).toEqual([[61, 121], [0.9, 0], 1]);
  });

  it("adds to several clips in one undo step, and with scope=all skips the clips that cannot take it", async () => {
    const ed = new EditHarness();
    const v1 = ed.addClip(ed.addFile("video"));
    const v2 = ed.addClip(ed.addFile("video"), { position: 20 });
    const ids = await ed.call("add_effect_tool", { timeline_clip_ids: `${v1}, ${v2}`, effect: "Negate" });
    expect(ids.summary).toBe("Added Negative to 2 clip(s).");
    expect(ed.stepsSinceMark()).toBe(1);
    const a = ed.addClip(ed.addFile("audio"), { layer: T2 });
    const all = await ed.call("add_effect_tool", { scope: "all", effect: "Pixelate" });
    expect(all.summary).toBe("Added Pixelate to 2 clip(s). Skipped 1 clip(s).");
    expect(effectsOf(ed, v1, "Pixelate")).toHaveLength(1);
    expect(effectsOf(ed, a, "Pixelate")).toEqual([]);
    expect(((all.data as Row).skipped as Row[])[0]).toMatchObject({ timeline_clip_id: a });
    expect(String(((all.data as Row).skipped as Row[])[0]!.reason)).toContain("is a video effect and clip");
  });

  it("updates the effect a clip has by default, stacks a copy on request, and changes nothing for the same values", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.receipt("add_effect_tool", { timeline_clip_id: c, effect: "Blur", properties: { sigma: 2 } });
    ed.mark();
    const same = await ed.call("add_effect_tool", { timeline_clip_id: c, effect: "Blur", properties: { sigma: 2 } });
    expect([same.status, same.summary, (same.data as Row).changed]).toEqual(["unchanged", "Blur is already on 1 clip(s) with these settings; nothing changed.", false]);
    expect(ed.stepsSinceMark()).toBe(0);
    const updated = await ed.call("add_effect_tool", { timeline_clip_id: c, effect: "Blur", properties: { sigma: 5 } });
    expect(updated.summary).toBe("Updated the existing Blur on 1 clip(s).");
    expect(((updated.data as Row).clips as Row[])[0]!.action).toBe("updated");
    expect(effectsOf(ed, c, "Blur").map((e) => y(e.sigma))).toEqual([[5]]);
    await ed.receipt("add_effect_tool", { timeline_clip_id: c, effect: "Blur", if_exists: "add" });
    expect(effectsOf(ed, c, "Blur")).toHaveLength(2);
    expect(ed.stepsSinceMark()).toBe(2);
  });

  it.each([
    [{ effect: "Blur", properties: { horizontal_radius: 500 } }, "between 0 and 100"],
    [{ effect: "Blur", properties: { radius: 3 } }, "no property"],
    [{ effect: "ChromaKey", properties: { keymethod: "magic" } }, "must be one of"],
    [{ effect: "Blur", properties: { id: "x" } }, "not settable"],
    [{ effect: "Blur", properties: { sigma: [{ time: 99, value: 1 }] } }, "outside the clip"],
    [{ effect: "NotAnEffect" }, "unknown effect"],
    [{ effect: "Compressor" }, "has no sound"],
    [{ effect: "" }, "needs effect"],
  ])("refuses %j before anything changes", async (args, needle) => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.refused("add_effect_tool", { timeline_clip_id: c, ...args }, needle);
    expect(ed.clip(c)!.effects).toEqual([]);
  });

  it("refuses a clip on a locked track and a video effect on an audio-only clip", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    ed.lockTrack(1_000_000);
    await ed.refused("add_effect_tool", { timeline_clip_id: c, effect: "Blur" }, "locked");
    const a = ed.addClip(ed.addFile("audio"), { layer: T2 });
    await ed.refused("add_effect_tool", { timeline_clip_id: a, effect: "Sharpen" }, "audio-only");
  });

  it("puts audio effects on clips with sound and the visualizer on an audio clip", async () => {
    const ed = new EditHarness();
    const a = ed.addClip(ed.addFile("audio"));
    await ed.receipt("add_effect_tool", { timeline_clip_id: a, effect: "Echo", properties: { mix: 0.2, echo_time: "0.3s" } });
    const echo = effectsOf(ed, a, "Echo")[0]!;
    expect([y(echo.mix), y(echo.echo_time)]).toEqual([[0.2], [0.3]]);
    await ed.receipt("add_effect_tool", { timeline_clip_id: a, effect: "AudioVisualization" });
  });

  it("takes colours, choice names and curves", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.receipt("add_effect_tool", { timeline_clip_id: c, effect: "ChromaKey", properties: { color: "#00ff00", keymethod: "hsv/hsl hue", fuzz: 30 } });
    const ck = effectsOf(ed, c, "ChromaKey")[0]! as unknown as { color: Record<string, Keyframe>; keymethod: number; fuzz: Keyframe };
    expect([y(ck.color.green), y(ck.color.red), ck.keymethod, y(ck.fuzz)]).toEqual([[255], [0], 1, [30]]);
    await ed.receipt("add_effect_tool", { timeline_clip_id: c, effect: "ColorGrade", properties: { curve_all: [[0, 0], [0.5, 0.6], [1, 1]], saturation: 0 } });
    const cg = effectsOf(ed, c, "ColorGrade")[0]! as unknown as { curve_all: { nodes: unknown[] }; saturation: Keyframe };
    expect([cg.curve_all.nodes.length, y(cg.saturation)]).toEqual([3, [0]]);
  });

  it("refuses the OpenCV analysis effects as desktop-only, and processing as not ported", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const r = await ed.refused("add_effect_tool", { timeline_clip_id: c, effect: "stabilize" }, "not available in this Zenvi surface", "Stabilizer analysis", "Zenvi desktop");
    expect(r.status).toBe("refused");
    await ed.refused("add_effect_tool", { timeline_clip_id: c, effect: "Tracker", processing: { tracker_type: "KCF" } }, "cannot use processing in this Zenvi surface yet");
    // Outline is drawn by Zenvi desktop only: added, with a warning.
    const outline = await ed.call("add_effect_tool", { timeline_clip_id: c, effect: "Outline" });
    expect(outline.status).toBe("applied");
    expect(outline.warnings).toEqual(["Outline is drawn by Zenvi desktop only (OpenCV): the web editor, the zenvi CLI and Zenvi Cloud render these clips without it."]);
    expect(ed.clip(c)!.effects.map((e) => e.class_name)).toEqual(["Outline"]);
  });
});

describe("update_effect_tool", () => {
  it("changes a property by effect id, then keyframes it by class: one undo step each", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { position: 5 });
    const eid = ed.addEffect(c, "Blur");
    const r = await ed.receipt("update_effect_tool", { effect_id: eid, properties: '{"sigma": "8"}' });
    expect((r.effects as Row[])[0]!.changed).toEqual(["sigma"]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.mark();
    await ed.receipt("update_effect_tool", { timeline_clip_id: c, effect: "blur", properties: { sigma: [{ time: 5, value: 8 }, { time: 7, value: 0 }] } });
    const blur = effectsOf(ed, c, "Blur")[0]!;
    expect(x(blur.sigma)).toEqual([1, 61]);
    expect(y(blur.sigma)).toEqual([8, 0]);
    ed.doc.undo();
    expect(y(effectsOf(ed, c, "Blur")[0]!.sigma)).toEqual([8]);
  });

  it("refuses unknown ids, out-of-range values, a clip without the effect and a missing properties argument", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const eid = ed.addEffect(c, "Blur");
    await ed.refused("update_effect_tool", { effect_id: "nope", properties: '{"sigma": 1}' }, "no effect with id='nope'");
    await ed.refused("update_effect_tool", { effect_id: eid, properties: '{"sigma": -1}' }, "between");
    await ed.refused("update_effect_tool", { timeline_clip_id: c, effect: "Sharpen", properties: '{"amount": 2}' }, "no Sharpen effect");
    await ed.refused("update_effect_tool", { effect_id: eid }, "'properties' is a required property");
    await ed.refused("update_effect_tool", { effect_id: eid, properties: '{"radius": 3}' }, "Blur has no property 'radius'");
    const same = await ed.call("update_effect_tool", { effect_id: eid, properties: '{"sigma": 3}' });
    expect(same.status).toBe("unchanged");
    expect((same.data as Row).changed).toBe(false);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("refuses an effect on a locked track", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const eid = ed.addEffect(c, "Blur");
    ed.lockTrack(1_000_000);
    await ed.refused("update_effect_tool", { effect_id: eid, properties: '{"sigma": 1}' }, "is on a locked track; unlock the track first");
  });

  it("colours, choice names and LUTs", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const key = ed.addEffect(c, "ChromaKey");
    await ed.receipt("update_effect_tool", { effect_id: key, properties: '{"color": "#00ff00", "keymethod": "hsv/hsl hue", "fuzz": "30"}' });
    const ck = effectsOf(ed, c, "ChromaKey")[0]!;
    expect(y((ck.color as Record<string, unknown>).green)).toEqual([255]);
    expect(ck.keymethod).toBe(1);
    expect(y(ck.fuzz)).toEqual([30]);
    const map = ed.addEffect(c, "ColorMap");
    await ed.receipt("update_effect_tool", { effect_id: map, properties: '{"lut_path": "teal cinema"}' });
    expect(effectsOf(ed, c, "ColorMap")[0]!.lut_path).toBe("@colors/cinematic_&_blockbuster/teal_cinema.cube");
    ed.mark();
    await ed.refused("update_effect_tool", { effect_id: map, properties: '{"lut_path": "no such lut"}' }, "no LUT named 'no such lut'");
  });

  it("takes a .cube file only where the host can read local files", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const map = ed.addEffect(c, "ColorMap");
    const cube = "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";
    const host = fakeHost({ texts: { "/luts/mine.cube": cube } });
    const r = await runTool({ doc: ed.doc, host }, "update_effect_tool", { effect_id: map, properties: '{"lut_path": "/luts/mine.cube"}' });
    expect(r.data!.summary).toBe("Updated lut_path on 1 effect(s).");
    expect(effectsOf(ed, c, "ColorMap")[0]!.lut_path).toBe("/luts/mine.cube");
    const cloud = fakeHost({ omit: ["media.importPath"], texts: { "/luts/mine.cube": cube } });
    const refused = await runTool({ doc: ed.doc, host: cloud }, "update_effect_tool", { effect_id: map, properties: '{"lut_path": "/luts/other.cube"}' });
    expect(refused.data!.summary).toMatch(/needs local file access/);
  });
});

describe("remove_effect_tool", () => {
  it("removes by id, by class and all, never a clip; nothing to remove is unchanged", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const b = ed.addEffect(c, "Blur");
    ed.addEffect(c, "Sharpen");
    ed.addEffect(c, "Negate");
    await ed.receipt("remove_effect_tool", { effect_ids: b });
    expect(effectsOf(ed, c).map((e) => e.class_name)).toEqual(["Sharpen", "Negate"]);
    await ed.receipt("remove_effect_tool", { timeline_clip_id: c, effect: "Sharpen" });
    const all = await ed.receipt("remove_effect_tool", { timeline_clip_id: c, all_effects: "true" });
    expect((all.removed as Row[])[0]).toMatchObject({ timeline_clip_id: c, effect: "Negate" });
    expect(effectsOf(ed, c)).toEqual([]);
    expect(ed.doc.project.clips).toHaveLength(1);
    expect(ed.stepsSinceMark()).toBe(3);
    ed.doc.undo();
    expect(effectsOf(ed, c).map((e) => e.class_name)).toEqual(["Negate"]);
    ed.mark();
    const none = await ed.call("remove_effect_tool", { timeline_clip_id: c, effect: "Blur" });
    expect(none.summary).toBe("No clip has a Blur effect to remove; nothing changed.");
    expect(none.status).toBe("unchanged");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("still takes the web's older effect_id argument", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const b = ed.addEffect(c, "Blur");
    expect((await ed.call("remove_effect_tool", { effect_id: b })).summary).toBe("Removed 1 effect(s) from 1 clip(s).");
    ed.mark();
    await ed.refused("remove_effect_tool", { effect_id: "NOPE" }, "no effect with id='NOPE' on the timeline");
    await ed.refused("remove_effect_tool", {}, "give effect_ids, an effect name with the clip(s), or all_effects=true");
  });
});

describe("copy_effects_tool", () => {
  it("merges like Paste, replaces and appends, with new ids, one undo step", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video");
    const src = ed.addClip(f);
    const dst = ed.addClip(f, { position: 30 });
    const blur = ed.addEffect(src, "Blur");
    await ed.receipt("update_effect_tool", { effect_id: blur, properties: '{"sigma": 7}' });
    ed.addEffect(src, "Sharpen");
    const oldBlur = ed.addEffect(dst, "Blur");
    ed.addEffect(dst, "Negate");
    ed.mark();
    await ed.receipt("copy_effects_tool", { source_clip_id: src, timeline_clip_ids: dst });
    expect(effectsOf(ed, dst).map((e) => e.class_name)).toEqual(["Blur", "Negate", "Sharpen"]);
    expect(y(effectsOf(ed, dst, "Blur")[0]!.sigma)).toEqual([7]);
    const ids = new Set([...effectsOf(ed, dst), ...effectsOf(ed, src)].map((e) => e.id));
    expect(ids.size).toBe(5);
    expect(ids.has(oldBlur)).toBe(false);
    expect(ed.stepsSinceMark()).toBe(1);
    await ed.receipt("copy_effects_tool", { source_clip_id: src, timeline_clip_ids: dst, mode: "replace", effects: "Blur" });
    expect(effectsOf(ed, dst).map((e) => e.class_name)).toEqual(["Blur"]);
    await ed.receipt("copy_effects_tool", { source_clip_id: src, timeline_clip_ids: dst, mode: "APPEND" });
    expect(effectsOf(ed, dst).map((e) => e.class_name)).toEqual(["Blur", "Blur", "Sharpen"]);
    ed.mark();
    await ed.refused("copy_effects_tool", { source_clip_id: dst, timeline_clip_ids: src, effects: '["ChromaKey"]' }, "has no ChromaKey to copy");
    await ed.refused("copy_effects_tool", { source_clip_id: src }, "name the target clips");
  });

  it("skips clips that cannot take the effects with scope=all", async () => {
    const ed = new EditHarness();
    const src = ed.addClip(ed.addFile("video"));
    const other = ed.addClip(ed.addFile("video"), { position: 20 });
    const song = ed.addClip(ed.addFile("audio"), { layer: T2 });
    ed.addEffect(src, "Negate");
    const r = await ed.receipt("copy_effects_tool", { source_clip_id: src, scope: "all" });
    expect((r.clips as Row[]).map((row) => row.timeline_clip_id)).toEqual([other]);
    expect((r.skipped as Row[])[0]!.timeline_clip_id).toBe(song);
    expect(r.copied).toEqual(["Negate"]);
  });

  it("merge_effects_by_class matches the editor's paste", () => {
    const next = ["N1", "N2"];
    const out = mergeEffectsByClass(
      [{ id: "A", class_name: "Blur", sigma: 1 }, { id: "B", class_name: "Negate" }] as unknown as Effect[],
      [{ id: "S1", class_name: "Blur", sigma: 9 }, { id: "S2", class_name: "Hue" }] as unknown as Effect[],
      () => next.shift()!,
    );
    expect(out).toEqual([{ id: "N1", class_name: "Blur", sigma: 9 }, { id: "B", class_name: "Negate" }, { id: "N2", class_name: "Hue" }]);
  });
});

describe("process_clip_effect_tool", () => {
  it("is refused on the web surfaces, before anything changes", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const r = await ed.refused("process_clip_effect_tool", { timeline_clip_id: c, effect: "stabilizer" }, "not available in this Zenvi surface", "OpenCV");
    expect(r.status).toBe("refused");
  });
});
