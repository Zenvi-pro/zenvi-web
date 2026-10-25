import { describe, expect, it } from "vitest";
import { Gravity, Interpolation, ScaleMode, type Keyframe } from "../model/types.js";
import { findClip } from "../model/query.js";
import { evaluate } from "../keyframe/evaluate.js";
import { addClip, setClipProperty, setClipSpeed } from "./clips.js";
import { CLIP_PRESET_IDS, applyClipPreset, isClipPresetId, layoutShowAll, repeatClip } from "./presets.js";
import { cameraPanKeyframes, kenBurnsKeyframes, pushPullKeyframes } from "./camera-motion.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

const V1 = 1_000_000;
const xy = (kf: Keyframe) => kf.Points.map((p) => [p.co.X, p.co.Y]);

function setup(position = 1) {
  const doc = makeDoc();
  // 20 s video at 30 fps: clip frames 1..601.
  doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position, layer: V1, id: "C" }));
  return doc;
}
const clip = (doc: ReturnType<typeof makeDoc>) => findClip(doc.project, "C")!;

describe("preset ids", () => {
  it("covers every desktop menu entry", () => {
    expect(CLIP_PRESET_IDS).toContain("fade.in_out_slow");
    expect(CLIP_PRESET_IDS).toContain("animate.ken_burns_out_bottom_to_top");
    expect(CLIP_PRESET_IDS.filter((id) => id.startsWith("animate."))).toHaveLength(89);
    expect(isClipPresetId("animate.nope")).toBe(false);
  });
});

describe("fade / volume / rotate / layout", () => {
  it("fade.in_fast fades alpha and volume over the first second", () => {
    const doc = setup();
    const before = doc.project;
    const c = doc.transaction("fade", (tx) => applyClipPreset(tx, "C", "fade.in_fast"));
    expect(xy(c.alpha)).toEqual([
      [1, 0],
      [31, 1],
    ]);
    expect(xy(c.volume)).toEqual(xy(c.alpha));
    expectUndoRedo(doc, before);
  });

  it("fade.in_out_slow = slow in at the start + slow out at the end; fade.none resets", () => {
    const doc = setup();
    const c = doc.transaction("fade", (tx) => applyClipPreset(tx, "C", "fade.in_out_slow"));
    expect(xy(c.alpha)).toEqual([
      [1, 0],
      [91, 1],
      [511, 1],
      [601, 0],
    ]);
    const reset = doc.transaction("none", (tx) => applyClipPreset(tx, "C", "fade.none"));
    expect(xy(reset.alpha)).toEqual([[1, 1]]);
  });

  it("volume presets touch only volume", () => {
    const doc = setup();
    const c = doc.transaction("lvl", (tx) => applyClipPreset(tx, "C", "volume.level", { level: 0.4 }));
    expect(c.volume.Points[0]!.co.Y).toBe(Math.fround(0.4));
    expect(xy(c.alpha)).toEqual([[1, 1]]);
    const out = doc.transaction("out", (tx) => applyClipPreset(tx, "C", "volume.fade_out_fast"));
    expect(xy(out.volume)).toEqual([
      [1, Math.fround(0.4)],
      [571, Math.fround(0.4)],
      [601, 0],
    ]);
    expectRefused(doc, "invalid_argument", (tx) => applyClipPreset(tx, "C", "volume.level", { level: 2 }));
  });

  it("rotate and layout presets; a no-op preset records nothing", () => {
    const doc = setup();
    const labels = doc.undoLabels.length;
    doc.transaction("noop", (tx) => applyClipPreset(tx, "C", "rotate.none"));
    expect(doc.undoLabels.length).toBe(labels);
    expect(evaluate(doc.transaction("r", (tx) => applyClipPreset(tx, "C", "rotate.right_90")).rotation, 1)).toBe(90);
    const l = doc.transaction("l", (tx) => applyClipPreset(tx, "C", "layout.top_left"));
    expect([l.gravity, l.scale, l.scale_x.Points[0]!.co.Y, l.location_x.Points[0]!.co.Y]).toEqual([Gravity.TOP_LEFT, ScaleMode.FIT, 0.5, 0]);
    const n = doc.transaction("n", (tx) => applyClipPreset(tx, "C", "layout.none"));
    expect([n.gravity, n.scale_x.Points[0]!.co.Y]).toEqual([Gravity.CENTER, 1]);
  });
});

describe("develop 1f80cb3d0: fade and motion lengths, in-and-out, crop, no transform, flip", () => {
  it("fadeSeconds sets Fast and Slow alike and widens the zone old fades are cleared from", () => {
    const doc = setup();
    const c = doc.transaction("fade", (tx) => applyClipPreset(tx, "C", "fade.in_slow", { fadeSeconds: 2 }));
    expect(xy(c.alpha)).toEqual([
      [1, 0],
      [61, 1],
    ]);
    const out = doc.transaction("out", (tx) => applyClipPreset(tx, "C", "volume.fade_out_fast", { fadeSeconds: 4 }));
    expect(xy(out.volume).slice(-2)).toEqual([
      [481, 1],
      [601, 0],
    ]);
  });

  it("in-and-out clears both zones first, gives each fade at most a third, and aims for the clip's level", () => {
    const doc = setup();
    // A short clip: 3 s = 90 frames, so 1 s fades of at most 30 frames each.
    doc.transaction("trim", (tx) => tx.update(["clips", { id: "C" }], { end: 3 }));
    const c = doc.transaction("fade", (tx) => applyClipPreset(tx, "C", "fade.in_out_slow"));
    expect(xy(c.alpha)).toEqual([
      [1, 0],
      [31, 1],
      [61, 1],
      [91, 0],
    ]);
    // Re-applying Fast over a ducked level restores the level, not a value read mid-ramp.
    doc.transaction("duck", (tx) => tx.update(["clips", { id: "C" }], { end: 20, volume: { Points: [{ co: { X: 1, Y: 0.5 }, interpolation: 0 }] } }));
    const v = doc.transaction("vol", (tx) => applyClipPreset(tx, "C", "volume.fade_in_out_slow"));
    const fast = doc.transaction("fast", (tx) => applyClipPreset(tx, "C", "volume.fade_in_out_fast"));
    expect(xy(v.volume).map(([, y]) => y)).toEqual([0, 0.5, 0.5, 0]);
    expect(xy(fast.volume)).toEqual([
      [1, 0],
      [31, 0.5],
      [571, 0.5],
      [601, 0],
    ]);
  });

  it("zoneSeconds sets the In/Out/Emphasis length; the emphasis playhead snaps to a frame", () => {
    const doc = setup(0);
    const c = doc.transaction("slide", (tx) => applyClipPreset(tx, "C", "animate.slide_in_left", { zoneSeconds: 2 }));
    expect(xy(c.location_x).map(([x]) => x)).toEqual([1, 61]);
    const p = doc.transaction("pulse", (tx) => applyClipPreset(tx, "C", "animate.pulse", { playhead: 4.99, zoneSeconds: 0.5 }));
    // 4.99 s is timeline frame 151 (4.9933 s): clip frame 151, a 15-frame zone.
    expect(p.scale_x.Points.map((pt) => pt.co.X).filter((x) => x > 100)).toEqual(expect.arrayContaining([151, 166]));
  });

  it("wipe-out circles use the reversed masks (OpenShot ac9621a02)", () => {
    const doc = setup();
    const c = doc.transaction("wipe", (tx) => applyClipPreset(tx, "C", "animate.wipe_out_circle_shrink"));
    expect((c.effects[0]!.reader as { path: string }).path).toBe("@transitions/common/circle_in_to_out.svg");
  });

  it("crop adds or reuses a Crop effect, none removes it; no transform also resets rotation and layout", () => {
    const doc = setup();
    const c = doc.transaction("crop", (tx) => applyClipPreset(tx, "C", "crop.crop"));
    expect(c.effects.map((e) => [e.class_name, e.resize])).toEqual([["Crop", false]]);
    const r = doc.transaction("resize", (tx) => applyClipPreset(tx, "C", "crop.resize"));
    expect(r.effects.map((e) => [e.id, e.resize])).toEqual([[c.effects[0]!.id, true]]);
    doc.transaction("turn", (tx) => applyClipPreset(tx, "C", "rotate.right_90"));
    doc.transaction("pip", (tx) => applyClipPreset(tx, "C", "layout.top_left"));
    const none = doc.transaction("none", (tx) => applyClipPreset(tx, "C", "transform.none"));
    expect([none.effects, evaluate(none.rotation, 1), none.gravity, none.scale_x.Points[0]!.co.Y]).toEqual([[], 0, Gravity.CENTER, 1]);
  });

  it("flip negates every point of the axis", () => {
    const doc = setup();
    doc.transaction("zoom", (tx) => tx.update(["clips", { id: "C" }], { scale_y: { Points: [{ co: { X: 1, Y: 1 }, interpolation: 0 }, { co: { X: 61, Y: 1.5 }, interpolation: 0 }] } }));
    const c = doc.transaction("flip", (tx) => applyClipPreset(tx, "C", "flip.vertical"));
    expect(xy(c.scale_y)).toEqual([
      [1, -1],
      [61, -1.5],
    ]);
    expect(xy(c.scale_x)).toEqual([[1, 1]]);
  });
});

describe("time presets", () => {
  it("forward/backward speeds, reverse and reset", () => {
    const doc = setup();
    const fast = doc.transaction("2x", (tx) => applyClipPreset(tx, "C", "time.forward", { speed: 2 }));
    expect(fast.end).toBe(10);
    const reset = doc.transaction("reset", (tx) => applyClipPreset(tx, "C", "time.none"));
    expect(reset.end).toBe(20);
    expect(reset.time.Points).toEqual([{ co: { X: 1, Y: 1 }, interpolation: Interpolation.LINEAR }]);
    const rev = doc.transaction("rev", (tx) => applyClipPreset(tx, "C", "time.reverse"));
    expect(xy(rev.time)).toEqual([
      [1, 600],
      [601, 1],
    ]);
    expectRefused(doc, "invalid_argument", (tx) => applyClipPreset(tx, "C", "time.forward"));
  });

  it("freeze holds the frame under the playhead and mutes it", () => {
    const doc = setup(0);
    // Freeze 2 s at timeline 1 s (clip frame 31).
    const c = doc.transaction("freeze", (tx) => applyClipPreset(tx, "C", "time.freeze", { seconds: 2, playhead: 1 }));
    expect(c.end).toBe(22);
    expect(xy(c.time)).toEqual([
      [1, 1],
      [31, 31],
      [91, 31],
      // clamp_timing_to_media keeps source frames within the media's 600.
      [661, 600],
    ]);
    expect(xy(c.volume)).toEqual([
      [1, 1],
      [30, 1],
      [31, 0],
      [90, 0],
      [91, 1],
    ]);
    const z = doc.transaction("zoom", (tx) => applyClipPreset(tx, "C", "time.freeze_zoom", { seconds: 2, playhead: 1 }));
    expect(z.scale_x.Points.some((p) => p.co.Y === Math.fround(1.05))).toBe(true);
  });
});

describe("animate presets", () => {
  it("slide in from the left over the first second, relative to the current location", () => {
    const doc = setup();
    doc.transaction("loc", (tx) => setClipProperty(tx, "C", "location_x", 0.25));
    const c = doc.transaction("slide", (tx) => applyClipPreset(tx, "C", "animate.slide_in_left"));
    expect(xy(c.location_x)).toEqual([
      [1, -0.75],
      [31, 0.25],
    ]);
    expect(c.gravity).toBe(Gravity.CENTER);
  });

  it("JSON presets scale onto the zone with easing handles", () => {
    const doc = setup();
    const c = doc.transaction("bounce", (tx) => applyClipPreset(tx, "C", "animate.bounce_in"));
    // scale_x: 6 preset points over frames 1..31 (zone = 30 frames), anchors at 1 and 31.
    expect(c.scale_x.Points.map((p) => p.co.X)).toEqual([1, 7, 13, 19, 25, 31]);
    expect(c.scale_x.Points[0]!.co.Y).toBe(Math.fround(0.3));
    expect(c.scale_x.Points[0]!.handle_right).toEqual({ X: 0.215, Y: 0.61 });
    expect(c.scale_x.Points[1]!.handle_left).toEqual({ X: 0.355, Y: 1 });
    const pulse = doc.transaction("pulse", (tx) => applyClipPreset(tx, "C", "animate.pulse", { playhead: 5 }));
    // Emphasis starts at the playhead: timeline 5 s on a clip at 1 s → clip frame 121.
    // Only the preset's zone is cleared, so the bounce-in points stay (desktop behavior).
    expect(pulse.scale_x.Points.map((p) => p.co.X)).toEqual([1, 7, 13, 19, 25, 31, 121, 136, 151]);
  });

  it("wipes add a Mask effect with the common mask; none removes motion effects", () => {
    const doc = setup();
    const c = doc.transaction("wipe", (tx) => applyClipPreset(tx, "C", "animate.blur_wipe_in_left"));
    expect(c.effects.map((e) => e.class_name)).toEqual(["Blur", "Mask"]);
    const mask = c.effects[1]!;
    expect((mask.reader as { path: string }).path).toBe("@transitions/common/wipe_left_to_right.svg");
    expect(xy(mask.brightness as Keyframe)).toEqual([
      [1, 1],
      [31, -1],
    ]);
    expect((mask.contrast as Keyframe).Points[0]!.co.Y).toBe(10);
    const none = doc.transaction("none", (tx) => applyClipPreset(tx, "C", "animate.none"));
    expect(none.effects).toEqual([]);
    expect(xy(none.scale_x)).toEqual([[1, 1]]);
  });

  it("camera moves use SCALE_CROP over the whole clip", () => {
    const doc = setup();
    const c = doc.transaction("push", (tx) => applyClipPreset(tx, "C", "animate.cam_push_in"));
    expect(c.scale).toBe(ScaleMode.CROP);
    expect(xy(c.scale_x)).toEqual([
      [1, 1],
      [601, Math.fround(1.2)],
    ]);
    const credits = doc.transaction("credits", (tx) => applyClipPreset(tx, "C", "animate.credits_up"));
    expect(xy(credits.location_y)).toEqual([
      [1, 1],
      [601, -1],
    ]);
  });

  it("camera math matches camera_motion.py", () => {
    expect(pushPullKeyframes(false)).toEqual({ scaleX: [1.2, 1], scaleY: [1.2, 1], locationX: [0, 0], locationY: [0, 0] });
    // 16:9 source in a 16:9 project: no natural room, so it zooms to make 18% pan room.
    const pan = cameraPanKeyframes("pan_left", 1920, 1080, 1920, 1080);
    expect(pan.scaleX[0]).toBeCloseTo(1.18 / 0.82, 10);
    expect(pan.locationX[0]).toBeCloseTo(-0.1791, 4);
    expect(pan.locationX[1]).toBeCloseTo(0.1791, 4);
    // A 4:3 photo cropped into 16:9 has vertical room; auto picks bottom-to-top.
    const kb = kenBurnsKeyframes(true, "auto", 1920, 1080, 1440, 1080);
    expect(kb.locationX).toEqual([0, 0]);
    expect(kb.scaleX[1]).toBeGreaterThan(1.2);
  });
});

describe("layoutShowAll / validation", () => {
  it("arranges selected clips in a grid", () => {
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      for (const id of ["A", "B", "C"]) addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, id });
    });
    const clips = doc.transaction("grid", (tx) => layoutShowAll(tx, ["A", "B", "C"]));
    // 3 clips → 1 row of 3.
    expect(clips.map((c) => [c.location_x.Points[0]!.co.Y, c.location_y.Points[0]!.co.Y])).toEqual([
      [0, 0],
      [Math.fround(1 / 3), 0],
      [Math.fround(2 / 3), 0],
    ]);
    expect(clips[0]!.scale_x.Points[0]!.co.Y).toBe(Math.fround(1 / 3));
    expect(clips[0]!.gravity).toBe(Gravity.TOP_LEFT);
  });

  it("refuses unknown presets and clips", () => {
    const doc = setup();
    expectRefused(doc, "invalid_argument", (tx) => applyClipPreset(tx, "C", "animate.sparkle" as never));
    expectRefused(doc, "not_found", (tx) => applyClipPreset(tx, "NOPE", "fade.in_fast"));
    expectRefused(doc, "invalid_argument", (tx) => applyClipPreset(tx, "C", "fade.in_fast", { range: "middle" as never }));
    // Speed then a preset still works on the retimed clip.
    doc.transaction("speed", (tx) => setClipSpeed(tx, "C", 2));
    expect(clip(doc).end).toBe(10);
  });
});

describe("repeatClip (repeat.py apply_repeat)", () => {
  it("loops the source twice; time.none restores it", () => {
    const doc = setup(0);
    const before = doc.project;
    const c = doc.transaction("loop", (tx) => repeatClip(tx, "C", { pattern: "loop", passes: 2 }));
    expect([c.start, c.end]).toEqual([0, 40]);
    expect(c.time.Points.map((p) => [p.co.X, p.co.Y, p.interpolation])).toEqual([
      [1, 1, Interpolation.LINEAR],
      // clamp_timing_to_media keeps the source frame within the media's 600.
      [600, 600, Interpolation.LINEAR],
      [601, 1, Interpolation.CONSTANT],
      [1200, 600, Interpolation.LINEAR],
    ]);
    expect(c.repeat_cache).toMatchObject({ start: 0, end: 20 });
    expectUndoRedo(doc, before);
    const reset = doc.transaction("reset", (tx) => applyClipPreset(tx, "C", "time.none"));
    expect([reset.start, reset.end]).toEqual([0, 20]);
    expect(reset.repeat_cache).toBeUndefined();
  });

  it("ping-pong alternates direction and repeats animated properties", () => {
    const doc = setup(0);
    doc.transaction("alpha", (tx) => setClipProperty(tx, "C", "alpha", 0, { frame: 300 }));
    const c = doc.transaction("pp", (tx) => repeatClip(tx, "C", { pattern: "pingpong", passes: 2, delayFrames: 30 }));
    expect(c.end).toBe(1230 / 30);
    const ys = c.time.Points.map((p) => p.co.Y);
    expect(ys[0]).toBe(1);
    expect(ys[ys.length - 1]).toBe(1);
    expect(c.alpha.Points.length).toBeGreaterThan(2);
    expectRefused(doc, "invalid_argument", (tx) => repeatClip(tx, "C", { pattern: "spin" as never, passes: 2 }));
    expectRefused(doc, "invalid_argument", (tx) => repeatClip(tx, "C", { pattern: "loop", passes: 1 }));
  });
});
