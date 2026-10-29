import { describe, expect, it } from "vitest";
import { evaluate } from "../../keyframe/evaluate.js";
import type { Keyframe } from "../../model/types.js";
import { plateSvg } from "../../transitions/plates.js";
import { EditHarness } from "../test-support/edit-harness.js";

/** Two shots cut at 2 s on the bottom track (30 fps, 1920×1080). */
function cutAt2(): { ed: EditHarness; a: string; b: string } {
  const ed = new EditHarness();
  const f = ed.addFile("video", { duration: 10 });
  const a = ed.addClip(f, { position: 0, end: 2 });
  const b = ed.addClip(f, { position: 2, start: 4, end: 7 });
  return { ed, a, b };
}

const kf = (clip: Record<string, unknown>, prop: string) => clip[prop] as Keyframe;

describe("add_plate_wipe_tool", () => {
  it("grows a drawn blob over the cut until it covers the frame on the cut's frame, the next clip pulling back, in one undo step", async () => {
    const { ed, a, b } = cutAt2();
    ed.mark();
    const data = (await ed.receipt("add_plate_wipe_tool", { clip1_id: a, x: 0.3, y: 0.6 })) as Record<string, unknown> & { frames: { cover: number; hold: number; exit: number }; sfx_cues: { kind: string; time: number }[] };
    expect(ed.stepsSinceMark()).toBe(1);
    expect(data.clip2_id).toBe(b);
    expect(data.frames).toEqual({ cover: 6, hold: 2, exit: 9 });
    const plate = ed.clip(String(data.plate_clip_id))! as unknown as Record<string, unknown> & { position: number; layer: number; end: number; start: number };
    // Above both clips, starting 6 frames before the cut.
    expect(plate.layer).toBeGreaterThan(ed.clip(a)!.layer);
    expect(plate.position).toBeCloseTo(2 - 6 / 30, 6);
    expect(plate.end - plate.start).toBeCloseTo(17 / 30, 6);
    // On the cut's frame (clip frame 7) the plate's inner circle reaches the farthest corner from its point.
    const scale = evaluate(kf(plate, "scale_x"), 7);
    expect(scale).toBeCloseTo(Number(data.cover_scale), 3);
    const inner = (plateSvg("blob", "#000000", 100).inscribed * 1080) / 2;
    expect(inner * scale).toBeGreaterThanOrEqual(Math.hypot(0.7 * 1920, 0.6 * 1080));
    expect(evaluate(kf(plate, "scale_x"), 1)).toBeLessThan(0.1);
    expect(evaluate(kf(plate, "location_x"), 1)).toBeCloseTo(-0.2, 6);
    // through: it fades as it passes the lens.
    expect(evaluate(kf(plate, "alpha"), 17)).toBe(0);
    // The pull-back is the zoom_out motion transition on the same cut.
    expect(data.pull_back_transition_id).toBeTruthy();
    const list = (await ed.receipt("list_motion_transitions_tool", {})) as { on_timeline: { preset: string; clip2_id: string }[] };
    expect(list.on_timeline).toEqual([expect.objectContaining({ preset: "zoom_out", clip2_id: b })]);
    expect(data.sfx_cues.map((c) => c.kind)).toEqual(["whoosh", "hit"]);
    expect(data.sfx_cues[1]!.time).toBe(2);
    ed.doc.undo();
    expect(ed.clip(String(data.plate_clip_id))).toBeUndefined();
  });

  it("uses a bin sprite with Screen blend and flies it off a side", async () => {
    const { ed, a } = cutAt2();
    const sprite = ed.addFile("image");
    const data = (await ed.receipt("add_plate_wipe_tool", { track: "1", time: 2.01, plate_file_id: sprite, blend: "screen", exit: "fly", direction: "right", pull_back: false, cover_scale: 2.5 })) as Record<string, unknown>;
    expect(data.clip1_id).toBe(a);
    expect(data.pull_back_transition_id).toBeUndefined();
    const plate = ed.clip(String(data.plate_clip_id))! as unknown as Record<string, unknown>;
    expect(plate.file_id).toBe(sprite);
    expect(plate.composite).toBe(14);
    expect(plate.rotation === undefined || (plate.rotation as Keyframe).Points.length === 1).toBe(true);
    // Off the right edge on its last frame: centre past the frame by half its width at the cover scale.
    expect(evaluate(kf(plate, "location_x"), 17)).toBeGreaterThan(1.5);
  });

  it("refuses what it cannot do without touching history", async () => {
    const { ed, a, b } = cutAt2();
    const sprite = ed.addFile("image");
    ed.mark();
    await ed.refused("add_plate_wipe_tool", { clip1_id: b }, "no clip is cut back to back");
    await ed.refused("add_plate_wipe_tool", { track: "1", time: 5 }, "No cut");
    await ed.refused("add_plate_wipe_tool", { clip1_id: a, plate_file_id: sprite, shape: "burst" }, "drawn plates");
    await ed.refused("add_plate_wipe_tool", { clip1_id: a, direction: "left" }, "exit=fly");
    // A cover longer than the time before the cut, and longer than the outgoing clip.
    const early = new EditHarness();
    const f = early.addFile("video", { duration: 10 });
    const first = early.addClip(f, { position: 0.5, end: 1 });
    early.addClip(f, { position: 1.5, start: 2, end: 4.5 });
    await early.refused("add_plate_wipe_tool", { clip1_id: first, cover_seconds: 1.8 }, "timeline starts sooner");
    await early.refused("add_plate_wipe_tool", { clip1_id: first, cover_seconds: 1.2 }, "shorter than the plate's 36 frames");
    await early.refused("add_plate_wipe_tool", { clip1_id: first, exit_seconds: 2, hold_seconds: 1 }, "shorter than the plate's 90 frames after the cut");
    expect(ed.stepsSinceMark()).toBe(0);
  });
});
