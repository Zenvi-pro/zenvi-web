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

  it("leaves titles alone by default, adds no step when nothing changes, and refuses a locked clip", async () => {
    const ed = new EditHarness();
    const a = ed.addClip(ed.addFile("video"), { position: 0, end: 5, layer: 1 });
    const title = ed.addClip(ed.addFile("image", { name: "title.svg" }), { position: 0, end: 5, layer: 2 });
    await ed.receipt("add_vignette_tool", {});
    expect(looksOf(ed, a, "vignette")).toHaveLength(1);
    expect(looksOf(ed, title, "vignette")).toHaveLength(0);
    ed.mark();
    expect((await ed.call("add_vignette_tool", {})).status).toBe("unchanged");
    expect((await ed.call("add_shape_mask_tool", { remove: true })).status).toBe("unchanged");
    expect(ed.stepsSinceMark()).toBe(0);
    ed.lockTrack(1);
    await ed.refused("add_shape_mask_tool", { clip_ids: [a] }, "locked");
    await ed.refused("add_vignette_tool", { clip_ids: ["nope"] }, "no timeline clip");
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

  it("reads keyframe times counted from an overlay's own start as such, and refuses times outside the clip", async () => {
    // Bench round 5 (masking): a slit on an overlay placed at 2 s keyed 0-1.8 s; all four keys clamped to its first frame and it never opened.
    const ed = new EditHarness();
    const slit = ed.addClip(ed.addFile("video"), { position: 2, start: 3, end: 7, layer: 2 });
    ed.mark();
    const r = await ed.call("add_shape_mask_tool", { clip_ids: [slit], width: 0.08, height: 0.8, keyframes: [{ seconds: 0, grow: -0.04 }, { seconds: 0.3, grow: 0 }, { seconds: 1.8, grow: 0.5 }, { seconds: 4, grow: -0.04 }] });
    expect(r.status).toBe("applied");
    expect(r.summary).toContain("read from the start of clip");
    expect(ed.stepsSinceMark()).toBe(1);
    // 3 s into the source at 30 fps is frame 91; the keys spread from there instead of piling on it.
    expect(points(looksOf(ed, slit, "shape_mask")[0]!, "brightness").map((p) => p[0])).toEqual([91, 100, 145, 211]);
    // Timeline times inside the clip stay timeline times.
    await ed.receipt("add_shape_mask_tool", { clip_ids: [slit], keyframes: [{ seconds: 2.5, grow: -0.2 }, { seconds: 3, grow: 0 }] });
    expect(points(looksOf(ed, slit, "shape_mask")[0]!, "brightness").map((p) => p[0])).toEqual([106, 121]);
    ed.mark();
    await ed.refused("add_shape_mask_tool", { clip_ids: [slit], keyframes: [{ seconds: 1, grow: 0 }, { seconds: 9, grow: 0.2 }] }, "outside clip");
    expect(ed.stepsSinceMark()).toBe(0);
  });
});
