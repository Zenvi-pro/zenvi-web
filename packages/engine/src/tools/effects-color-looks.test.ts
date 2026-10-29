/**
 * Effects-color tools, part 2: apply_look_preset_tool, color_grade_clip_tool,
 * list_luts_tool, apply_audio_effect_tool and chroma_key_clip_tool. Ported
 * from zenvi-core develop tests/test_editor_tools_effects_color_looks.py,
 * through runTool with string arguments; chroma key's screen sampling and
 * keyed share run on frames the engine's own compositor renders.
 */

import { describe, expect, it } from "vitest";
import type { Effect, Keyframe } from "../model/types.js";
import { moveClip } from "../ops/clips.js";
import { EditHarness } from "./test-support/edit-harness.js";
import { fakeHost } from "./test-support/fake-host.js";
import { pixelFrameHost, screenShot, solid } from "./test-support/pixel-host.js";

type Row = Record<string, unknown>;

const L1 = 1_000_000;
const L2 = 2_000_000;
const L3 = 3_000_000;

function kf(effect: Effect, key: string): number {
  return (effect[key] as Keyframe).Points[0]!.co.Y;
}

function effectsOf(ed: EditHarness, clipId: string, className?: string): Effect[] {
  return (ed.clip(clipId)?.effects ?? []).filter((e) => className === undefined || e.class_name === className);
}

/** A harness whose host renders frames of a green screen with a grey subject. */
function greenScreen(screen: [number, number, number] = [30, 180, 60]): EditHarness {
  const ed = new EditHarness();
  ed.host.frames = pixelFrameHost((_path, w, h) => screenShot(w, h, screen));
  return ed;
}

describe("apply_look_preset_tool", () => {
  it("tags Look effects, replaces the same family in place, and Reset Look removes them all in one step", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.receipt("apply_look_preset_tool", { timeline_clip_id: c, look: "blur_soft_focus" });
    const blur = effectsOf(ed, c, "Blur")[0]!;
    expect(blur["ui-menu"]).toBe("look");
    expect(kf(blur, "horizontal_radius")).toBe(3.0);
    expect(ed.stepsSinceMark()).toBe(1);
    await ed.receipt("apply_look_preset_tool", { timeline_clip_id: c, look: "BLUR_HEAVY" });
    const blurs = effectsOf(ed, c, "Blur");
    expect(blurs).toHaveLength(1);
    expect(blurs[0]!.id).toBe(blur.id);
    expect(kf(blurs[0]!, "horizontal_radius")).toBe(20.0);
    await ed.receipt("apply_look_preset_tool", { timeline_clip_id: c, look: "film_grain_super_8" });
    await ed.receipt("apply_look_preset_tool", { timeline_clip_id: c, look: "color_warm_up" });
    expect(kf(effectsOf(ed, c, "ColorGrade")[0]!, "temperature")).toBeCloseTo(0.18);
    expect(kf(effectsOf(ed, c, "ColorGrade")[0]!, "vibrance")).toBeCloseTo(0.1);
    expect(kf(effectsOf(ed, c, "FilmGrain")[0]!, "amount")).toBeCloseTo(0.62);
    ed.mark();
    expect((await ed.call("apply_look_preset_tool", { timeline_clip_id: c, look: "reset_look" })).summary).toBe("Removed look reset_look on 1 clip(s).");
    expect(effectsOf(ed, c)).toEqual([]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(new Set(effectsOf(ed, c).map((e) => e.class_name))).toEqual(new Set(["Blur", "FilmGrain", "ColorGrade"]));
  });

  it("keeps the user's own effects; removing a look that is not there changes nothing", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const userBlur = ed.addEffect(c, "Blur");
    await ed.receipt("apply_look_preset_tool", { timeline_clip_id: c, look: "blur_medium" });
    expect(effectsOf(ed, c, "Blur")).toHaveLength(2);
    await ed.receipt("apply_look_preset_tool", { timeline_clip_id: c, look: "remove_blur" });
    expect(effectsOf(ed, c, "Blur").map((e) => e.id)).toEqual([userBlur]);
    ed.mark();
    const r = await ed.call("apply_look_preset_tool", { timeline_clip_id: c, look: "remove_glow" });
    expect(r.status).toBe("unchanged");
    expect(r.summary).toBe("Every target clip has no such look to remove; nothing changed.");
    expect(ed.stepsSinceMark()).toBe(0);
    await ed.receipt("apply_look_preset_tool", { timeline_clip_id: c, look: "glow_neon" });
    ed.mark();
    expect((await ed.call("apply_look_preset_tool", { timeline_clip_id: c, look: "glow_neon" })).summary).toBe(
      "Every target clip already has this look; nothing changed.",
    );
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("refuses audio-only clips and unknown looks", async () => {
    const ed = new EditHarness();
    const a = ed.addClip(ed.addFile("audio"));
    await ed.refused("apply_look_preset_tool", { timeline_clip_id: a, look: "glow_neon" }, "audio-only");
    await ed.refused("apply_look_preset_tool", { timeline_clip_id: a, look: "sparkle" }, "Invalid arguments");
  });

  it("skips clips that cannot take a look with scope=all", async () => {
    const ed = new EditHarness();
    const v = ed.addClip(ed.addFile("video"));
    const a = ed.addClip(ed.addFile("audio"), { layer: L2 });
    const r = await ed.receipt("apply_look_preset_tool", { scope: "all", look: "sharpen_subtle" });
    expect(effectsOf(ed, v, "Sharpen")).toHaveLength(1);
    expect((r.skipped as Row[])[0]!.timeline_clip_id).toBe(a);
  });
});

describe("color_grade_clip_tool", () => {
  it("cinematic: the LUT at half strength, the contrast curve, ONE Color Grade", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    ed.addEffect(c, "ColorGrade");
    ed.addEffect(c, "ColorGrade");
    const r = await ed.receipt("color_grade_clip_tool", { timeline_clip_id: c, look: "cinematic" });
    const grades = effectsOf(ed, c, "ColorGrade");
    expect(grades).toHaveLength(1);
    expect(ed.stepsSinceMark()).toBe(1);
    const g = grades[0]!;
    expect(g.lut_path).toBe("@colors/cinematic_&_blockbuster/teal_&_orange_cinema.cube");
    expect(kf(g, "lut_intensity")).toBe(0.5);
    expect(kf(g, "saturation")).toBe(0.95);
    expect(kf(g, "contrast")).toBeCloseTo(0.18);
    expect(((r.clips as Row[])[0]!.grade as Row).lut).toBe("cinematic_&_blockbuster/teal_&_orange_cinema");
    expect((await ed.call("color_grade_clip_tool", { timeline_clip_id: c, look: "cinematic" })).summary).toBe(
      "The grade already has these values; nothing changed.",
    );
  });

  it("explicit controls keep the rest of the grade; reset starts from neutral", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.receipt("color_grade_clip_tool", { timeline_clip_id: c, look: "black_and_white" });
    const g0 = effectsOf(ed, c, "ColorGrade")[0]!;
    expect(kf(g0, "saturation")).toBe(0.0);
    ed.mark();
    expect((await ed.call("color_grade_clip_tool", { timeline_clip_id: c, exposure: "0.4", lut: "warm correction", lut_intensity: "0.5" })).summary).toBe(
      "Graded 1 clip(s): exposure, lut.",
    );
    const g = effectsOf(ed, c, "ColorGrade")[0]!;
    expect(g.id).toBe(g0.id);
    expect([kf(g, "saturation"), kf(g, "exposure"), kf(g, "lut_intensity")]).toEqual([0.0, 0.4, 0.5]);
    expect(g.lut_path).toBe("@colors/utility_&_correction/warm_correction.cube");
    await ed.receipt("color_grade_clip_tool", { timeline_clip_id: c, reset: "true" });
    const neutral = effectsOf(ed, c, "ColorGrade")[0]!;
    expect(kf(neutral, "saturation")).toBe(1.0);
    expect(neutral.lut_path).toBe("");
    expect(ed.stepsSinceMark()).toBe(2);
    ed.doc.undo();
    ed.doc.undo();
    expect(kf(effectsOf(ed, c, "ColorGrade")[0]!, "exposure")).toBe(0.0);
  });

  it("names wheels and curves in the summary, and warns when a wheel is too faint to see", async () => {
    // Regression (sk2-product-brand): wheels were left out of "Graded ...", and greyish colours at 0.05-0.1 tinted nothing visible.
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const faint = await ed.call("color_grade_clip_tool", {
      timeline_clip_id: c,
      contrast: 0.2,
      wheels: { shadows: { color: "#3a3a40", amount: 0.1 }, highlights: { color: "#ffb36b", amount: 0.3 } },
      curves: { all: [[0, 0.03], [1, 1]] },
    });
    expect(faint.summary).toBe("Graded 1 clip(s): contrast, wheels (shadows, highlights), curves.");
    expect(faint.warnings).toEqual([expect.stringMatching(/^The shadows wheel moves colour by under 5\/255: too faint to see\./)]);
    const clear = await ed.call("color_grade_clip_tool", { timeline_clip_id: c, wheels: { shadows: { color: "#2a6cff", amount: 0.15 } } });
    expect(clear.summary).toBe("Graded 1 clip(s): wheels (shadows).");
    expect(clear.warnings).toEqual([]);
  });

  it("wheels, curves, and refusals before anything changes", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    await ed.receipt("color_grade_clip_tool", {
      timeline_clip_id: c,
      wheels: '{"shadows": {"color": "#2a6cff", "amount": 0.15}}',
      curves: '{"all": [[0,0],[0.25,0.2],[0.75,0.82],[1,1]]}',
    });
    const g = effectsOf(ed, c, "ColorGrade")[0]!;
    expect((g.wheels as Record<string, Row>).shadows).toMatchObject({ color: "#2a6cff", amount: 0.15 });
    expect(((g.curve_all as Row).nodes as Row[]).length).toBe(4);
    ed.mark();
    for (const [args, needle] of [
      [{ lut: "no such lut" }, "no LUT named"],
      [{}, "say what to change"],
      [{ curves: '{"purple": [[0,0],[1,1]]}' }, "unknown curve"],
      [{ wheels: '{"shadows": {"amount": 3}}' }, "0-1"],
      [{ exposure: "5" }, "(at exposure)"],
      [{ look: "sepia" }, "is not one of"],
    ] as [Row, string][]) {
      await ed.refused("color_grade_clip_tool", { timeline_clip_id: c, ...args }, needle);
    }
    const a = ed.addClip(ed.addFile("audio"), { layer: L2 });
    ed.mark();
    await ed.refused("color_grade_clip_tool", { timeline_clip_id: a, look: "warm" }, "audio-only");
  });
});

describe("list_luts_tool", () => {
  it("lists the 50 built-in LUTs and filters by words", async () => {
    const ed = new EditHarness();
    const all = (await ed.receipt("list_luts_tool")).luts as Row[];
    expect(all).toHaveLength(50);
    expect(all[0]).toEqual({ id: "cinematic_&_blockbuster/bold_red_cinema", name: "Bold Red Cinema", category: "Cinematic & Blockbuster", builtin: true });
    const teal = (await ed.receipt("list_luts_tool", { query: "teal" })).luts as Row[];
    expect(teal.length).toBeGreaterThan(0);
    for (const lut of teal) expect(`${lut.id} ${lut.category}`.toLowerCase()).toContain("teal");
    expect((await ed.call("list_luts_tool", { query: "teal & orange" })).summary).toMatch(/^\d+ LUT\(s\) matching 'teal & orange'$/);
    await ed.refused("list_luts_tool", { query: "glitter" }, "no LUT matches 'glitter'");
  });
});

describe("apply_audio_effect_tool", () => {
  it("adds, updates in place, and refuses clips without sound", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video", { hasAudio: true }));
    const r = await ed.receipt("apply_audio_effect_tool", { timeline_clip_id: c, preset: "voice_compressor" });
    const comp = effectsOf(ed, c, "Compressor")[0]!;
    expect([kf(comp, "ratio"), kf(comp, "threshold")]).toEqual([3.0, -18.0]);
    expect(r.changed).toBe(true);
    expect((r.clips as Row[])[0]!.action).toBe("added");
    await ed.receipt("apply_audio_effect_tool", { timeline_clip_id: c, preset: "strong_compressor", properties: '{"ratio": "10"}' });
    const comps = effectsOf(ed, c, "Compressor");
    expect(comps).toHaveLength(1);
    expect(kf(comps[0]!, "ratio")).toBe(10.0);
    await ed.receipt("apply_audio_effect_tool", { timeline_clip_id: c, preset: "telephone" });
    const eq = effectsOf(ed, c, "ParametricEQ")[0]!;
    expect(eq.filter_type).toBe(4);
    expect(kf(eq, "frequency")).toBe(1500);
    ed.mark();
    const same = await ed.call("apply_audio_effect_tool", { timeline_clip_id: c, preset: "telephone" });
    expect(same.summary).toBe("telephone is already applied with these settings; nothing changed.");
    expect(ed.stepsSinceMark()).toBe(0);
    const img = ed.addClip(ed.addFile("image"), { layer: L2 });
    ed.mark();
    await ed.refused("apply_audio_effect_tool", { timeline_clip_id: img, preset: "echo" }, "no sound");
  });
});

// Real renders through the CPU compositor: a few seconds each under a full parallel run.
describe("chroma_key_clip_tool", { timeout: 30_000 }, () => {
  it("keys the stock green when the screen cannot be sampled, and moves the clip above the background in one step", async () => {
    const ed = new EditHarness();
    ed.host.frames = undefined;
    const fg = ed.addClip(ed.addFile("video"), { position: 40, layer: L1 });
    const bg = ed.addClip(ed.addFile("video"), { position: 0, layer: L1, end: 10 });
    ed.addClip(ed.addFile("video"), { position: 0, layer: L2, end: 30 });
    ed.mark();
    const r = await ed.receipt("chroma_key_clip_tool", { timeline_clip_id: fg, key_color: "green", background_clip_id: bg });
    const ck = effectsOf(ed, fg, "ChromaKey")[0]!;
    expect(kf({ green: (ck.color as Record<string, unknown>).green } as unknown as Effect, "green")).toBe(177);
    expect(ck.keymethod).toBe(11);
    expect(r).toMatchObject({ fuzz: 20, track: 3, layer: L3, new_track: false, keyed_pct: null, key_color: "#00b140" });
    expect(String(r.key_color_source)).toMatch(/^stock green; the screen could not be sampled/);
    expect([ed.clip(fg)!.position, ed.clip(fg)!.layer]).toEqual([0, L3]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([ed.clip(fg)!.layer, ed.clip(fg)!.position, ed.clip(fg)!.effects]).toEqual([L1, 40, []]);
  });

  it("samples the screen, measures what it keyed, and makes a top track when every track above is taken", async () => {
    const ed = greenScreen();
    for (const n of [2, 3, 4, 5]) ed.lockTrack(n * L1);
    const fg = ed.addClip(ed.addFile("video"), { layer: L1 });
    const bg = ed.addClip(ed.addFile("video"), { layer: L1, position: 30 });
    const r = await ed.receipt("chroma_key_clip_tool", { timeline_clip_id: fg, background_clip_id: bg, method: "HSV_HUE", fuzz: "35" });
    expect(r).toMatchObject({ new_track: true, layer: 6 * L1, position: 30, fuzz: 35, key_color: "#1eb43c", method: "hsv_hue" });
    expect(String(r.key_color_source)).toMatch(/^sampled \(green screen at the frame edges at 5\.00s, fuzz \d+ for its unevenness\)$/);
    expect(ed.doc.project.layers.map((l) => l.number)).toContain(6 * L1);
    expect(effectsOf(ed, fg, "ChromaKey")[0]!.keymethod).toBe(1);
    expect(r.keyed_pct as number).toBeGreaterThan(70);
    expect(r.keyed_pct as number).toBeLessThan(95);
    ed.mark();
    await ed.refused("chroma_key_clip_tool", { timeline_clip_id: fg, background_clip_id: fg }, "the background must be a different clip");
    const again = await ed.receipt("chroma_key_clip_tool", { timeline_clip_id: fg });
    expect(again.fuzz).toBe(20);
    expect(effectsOf(ed, fg, "ChromaKey")).toHaveLength(1);
    ed.doc.undo();
    ed.doc.undo();
    expect(ed.doc.project.layers.map((l) => l.number)).not.toContain(6 * L1);
  });

  it("a named colour keys this footage's shade; a key that removes almost nothing says so", async () => {
    const ed = greenScreen([60, 210, 90]);
    const fg = ed.addClip(ed.addFile("video"));
    const out = await ed.call("chroma_key_clip_tool", { timeline_clip_id: fg, key_color: "green" });
    const r = out.data as Row;
    expect(r.key_color).toBe("#3cd25a");
    expect(String(r.key_color_source)).toMatch(/^sampled/);
    expect(out.summary).toContain("% of the frame is now transparent.");
    expect(out.summary).not.toContain("too little");
    const miss = await ed.call("chroma_key_clip_tool", { timeline_clip_id: fg, key_color: "#ff00ff", fuzz: "5" });
    expect(miss.status).toBe("applied");
    expect((miss.data as Row).keyed_pct).toBe(0);
    expect(miss.summary).toContain("too little for a green/blue screen");
    expect(miss.summary).toContain("key_color='auto'");
  });

  it("writes nothing over an edit that lands while it renders", async () => {
    const ed = new EditHarness();
    const fg = ed.addClip(ed.addFile("video"));
    let dragged = false;
    ed.host.frames = pixelFrameHost((_path, w, h) => {
      // The person drags the clip while its frame is rendering.
      if (!dragged) {
        dragged = true;
        ed.doc.transaction("drag", (tx) => moveClip(tx, fg, { position: 3 }));
        ed.mark();
      }
      return screenShot(w, h, [30, 180, 60]);
    });
    await ed.refused(
      "chroma_key_clip_tool",
      { timeline_clip_id: fg },
      `clip ${fg} was edited while chroma_key_clip_tool rendered frames (position); nothing changed, call it again`,
    );
    expect(effectsOf(ed, fg, "ChromaKey")).toHaveLength(0);
    expect(ed.clip(fg)!.position).toBe(3);
  });

  it("refuses auto on a frame with no screen, and auto where frames cannot be rendered", async () => {
    const ed = new EditHarness();
    ed.host.frames = pixelFrameHost((_p, w, h) => solid(w, h, [200, 200, 205, 255]));
    const fg = ed.addClip(ed.addFile("video"));
    await ed.refused("chroma_key_clip_tool", { timeline_clip_id: fg }, "not a green or blue screen; pass key_color");
    const blue = await ed.call("chroma_key_clip_tool", { timeline_clip_id: fg, key_color: "blue" });
    expect((blue.data as Row).key_color).toBe("#0047bb");
    expect(String((blue.data as Row).key_color_source)).toContain("found no blue screen");
    const bare = new EditHarness();
    bare.host.frames = fakeHost({ without: ["frames"] }).frames;
    const clip = bare.addClip(bare.addFile("video"));
    await bare.refused("chroma_key_clip_tool", { timeline_clip_id: clip, key_color: "auto" }, "cannot render");
    await bare.refused("chroma_key_clip_tool", { timeline_clip_id: bare.addClip(bare.addFile("audio"), { layer: L2 }) }, "audio-only");
  });
});
