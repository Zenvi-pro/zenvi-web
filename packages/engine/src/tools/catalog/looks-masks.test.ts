import { describe, expect, it } from "vitest";
import type { Effect, Keyframe } from "../../model/types.js";
import { EditHarness } from "../test-support/edit-harness.js";

const points = (e: Effect, key: string) => (e[key] as Keyframe).Points.map((p) => [p.co.X, p.co.Y]);
const looksOf = (ed: EditHarness, id: string, look: string) => (ed.clip(id)?.effects ?? []).filter((e) => e.zenvi_look === look);

describe("add_vignette_tool", () => {
  it("darkens every picture clip through one masked Brightness each, updated in place, removed with amount 0", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video");
    const a = ed.addClip(f, { position: 0, end: 5 });
    const b = ed.addClip(f, { position: 5, end: 10 });
    ed.mark();
    const r = await ed.receipt("add_vignette_tool", { amount: 0.5 });
    expect(ed.stepsSinceMark()).toBe(1);
    expect((r as { changed_clip_ids: string[] }).changed_clip_ids.sort()).toEqual([a, b].sort());
    const [v] = looksOf(ed, a, "vignette");
    expect(v!.class_name).toBe("Brightness");
    expect(points(v!, "brightness")).toEqual([[1, -0.5]]);
    expect(String((v!.mask_reader as { path: string }).path)).toMatch(/vignette-[0-9a-f]{8}\.svg$/);
    await ed.receipt("add_vignette_tool", { clip_ids: [a], amount: 0.3 });
    expect(looksOf(ed, a, "vignette")).toHaveLength(1);
    expect(looksOf(ed, a, "vignette")[0]!.id).toBe(v!.id);
    expect(points(looksOf(ed, a, "vignette")[0]!, "brightness")).toEqual([[1, -0.3]]);
    await ed.receipt("add_vignette_tool", { amount: 0 });
    expect(looksOf(ed, a, "vignette")).toHaveLength(0);
    expect(looksOf(ed, b, "vignette")).toHaveLength(0);
  });
});

describe("add_shape_mask_tool", () => {
  it("keeps the inside of a feathered ellipse, its edge keyframed for an iris open; the outside on request", async () => {
    const ed = new EditHarness();
    const a = ed.addClip(ed.addFile("video"), { position: 2, start: 1, end: 6 });
    await ed.receipt("add_shape_mask_tool", { clip_ids: [a], shape: "ellipse", width: 0.4, height: 0.4, keyframes: [{ seconds: 2, grow: -0.5 }, { seconds: 2.5, grow: 0 }] });
    const [m] = looksOf(ed, a, "shape_mask");
    expect(m!.class_name).toBe("Mask");
    expect(m!.mask_invert).toBe(true);
    // Clip-local frames: the clip starts 1 s into its source, at 2 s on the timeline (30 fps).
    const bright = points(m!, "brightness");
    expect(bright.map((p) => p[0])).toEqual([31, 46]);
    expect(bright[0]![1]).toBeLessThan(-0.4);
    expect(bright[1]![1]).toBe(0);
    await ed.receipt("add_shape_mask_tool", { clip_ids: [a], outside: true });
    const masks = looksOf(ed, a, "shape_mask");
    expect(masks).toHaveLength(1);
    expect(masks[0]!.mask_invert).toBe(false);
    await ed.receipt("add_shape_mask_tool", { clip_ids: [a], remove: true });
    expect(looksOf(ed, a, "shape_mask")).toHaveLength(0);
  });
});
