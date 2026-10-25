/**
 * analyze_frame_colors_tool, ported from zenvi-core develop
 * tests/test_editor_tools_effects_color_process.py
 * (test_analyze_tool_renders_clip_alone_and_compares), on frames the engine's
 * own compositor renders: the clip alone with its effects (and its
 * transparency), the composite timeline frame, before/after, regions.
 */

import { describe, expect, it } from "vitest";
import { runTool } from "./registry.js";
import { EditHarness } from "./test-support/edit-harness.js";
import { fakeHost } from "./test-support/fake-host.js";
import { pixelFrameHost, screenShot, solid, type PixelHost } from "./test-support/pixel-host.js";

type Row = Record<string, unknown>;

function harness(paint = (w: number, h: number) => solid(w, h, [200, 200, 200, 255])): { ed: EditHarness; frames: PixelHost } {
  const ed = new EditHarness({ playhead: 0 });
  const frames = pixelFrameHost((_path, w, h) => paint(w, h));
  ed.host.frames = frames;
  return { ed, frames };
}

// Real renders through the CPU compositor: a few seconds each under a full parallel run.
describe("analyze_frame_colors_tool", { timeout: 30_000 }, () => {
  it("renders the clip alone at its middle, with and without its effects, and changes nothing", async () => {
    const { ed, frames } = harness();
    const c = ed.addClip(ed.addFile("video"), { position: 4, start: 1, end: 5 });
    ed.addEffect(c, "Negate");
    const result = await runTool({ doc: ed.doc, host: ed.host }, "analyze_frame_colors_tool", {
      timeline_clip_id: c,
      compare_without_effects: "true",
      region: '{"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5}',
    });
    const r = result.data!.data as Row;
    expect(r).toMatchObject({ time: 6, target: `clip ${c}`, timeline_clip_id: c, effects: ["Negate"], region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } });
    expect(r.frame_size).toEqual([960, 540]);
    const stats = r.stats as { luma: Row; transparent_pct: number; verdict: string[] };
    expect(stats.luma.p50).toBeCloseTo(55 / 255, 2);
    expect(stats.transparent_pct).toBe(0);
    expect(stats.verdict[0]).toBe("underexposed (median luma 0.22)");
    expect(((r.without_effects as Row).luma as Row).p50).toBeCloseTo(200 / 255, 2);
    expect(result.data!.summary).toBe(`Frame at 6.00s of clip ${c}: underexposed (median luma 0.22); flat / low contrast (p5-p95 0.00); black and white`);
    expect(result.images).toBeUndefined();
    // Clip alone = two passes (the colour, and the Negate probe for alpha), twice with the comparison.
    expect(frames.renders).toHaveLength(4);
    expect(frames.renders[0]!.project.clips).toHaveLength(1);
    expect(frames.renders[0]!.project.clips[0]!.position).toBe(0);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("measures what a chroma key made transparent", async () => {
    const { ed } = harness((w, h) => screenShot(w, h, [30, 180, 60]));
    const c = ed.addClip(ed.addFile("video"));
    await ed.receipt("chroma_key_clip_tool", { timeline_clip_id: c, key_color: "#1eb43c" });
    const r = await ed.receipt("analyze_frame_colors_tool", { timeline_clip_id: c });
    const stats = r.stats as Row;
    expect(stats.transparent_pct as number).toBeGreaterThan(75);
    expect(stats.transparent_pct as number).toBeLessThan(90);
    // Only the subject is left to measure: its warm grey, not the green.
    expect(stats.cast).toBe("warm (orange)");
    expect((stats.mean_rgb as number[]).map((v) => Math.round(v * 255))).toEqual([128, 120, 110]);
  });

  it("measures the composite frame at the playhead with whole_timeline", async () => {
    const { ed, frames } = harness();
    ed.addClip(ed.addFile("video"), { position: 0 });
    const r = await ed.receipt("analyze_frame_colors_tool", { whole_timeline: "yes" });
    expect(r).toMatchObject({ target: "timeline", time: 0 });
    expect(r).not.toHaveProperty("timeline_clip_id");
    expect(frames.renders).toHaveLength(1);
    expect(frames.renders[0]!.project).toBe(ed.doc.project);
  });

  it("attaches the frame instead of writing save_frame_path", async () => {
    const { ed } = harness();
    const c = ed.addClip(ed.addFile("video"));
    const result = await runTool({ doc: ed.doc, host: ed.host }, "analyze_frame_colors_tool", { timeline_clip_id: c, save_frame_path: "/tmp/frame.png" });
    expect(result.images).toHaveLength(1);
    expect(result.images![0]!.mimeType).toBe("image/png");
    expect((result.data!.data as Row).frame_attached).toBe(true);
    expect(result.data!.warnings[0]).toContain("attached to this result instead of saved to /tmp/frame.png");
  });

  it("refuses times outside the clip, relative save paths and regions outside the frame", async () => {
    const { ed } = harness();
    const c = ed.addClip(ed.addFile("video"), { position: 4, start: 1, end: 5 });
    await ed.refused("analyze_frame_colors_tool", { timeline_clip_id: c, time: "20" }, "time 20s is outside the clip (4-8s on the timeline)");
    await ed.refused("analyze_frame_colors_tool", { timeline_clip_id: c, save_frame_path: "rel.png" }, "absolute");
    await ed.refused("analyze_frame_colors_tool", { timeline_clip_id: c, region: '{"x": 0.9, "y": 0, "width": 0.5, "height": 1}' }, "inside the frame");
    await ed.refused("analyze_frame_colors_tool", { timeline_clip_id: "NOPE" }, "NOPE");
  });

  it("is not available where frames cannot be rendered", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"));
    const r = await runTool({ doc: ed.doc, host: fakeHost({ without: ["frames"] }) }, "analyze_frame_colors_tool", { timeline_clip_id: c });
    expect(r.data!.summary).toMatch(/^Error: analyze_frame_colors_tool is not available in this Zenvi surface: it needs frame rendering/);
  });
});
