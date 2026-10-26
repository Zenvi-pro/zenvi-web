import { describe, expect, it } from "vitest";
import { getLong } from "../keyframe/evaluate.js";
import { findClip } from "../model/query.js";
import type { Clip } from "../model/types.js";
import { addClip, setClipSpeed } from "./clips.js";
import { applySpeedRamp, planSpeedRamp, type RampRequest } from "./speed-ramp.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

const V1 = 1_000_000;
const FPS = 30;

/** A 20 s, 30 fps source with a 6 s clip (source 2-8 s) at 1 s on the timeline. */
function docWithClip(start = 2, end = 8, position = 1) {
  const doc = makeDoc();
  doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position, layer: V1, start, end, id: "CLIP000001" }));
  return doc;
}

const clipOf = (doc: ReturnType<typeof makeDoc>): Clip => findClip(doc.project, "CLIP000001")!;

/** Source frame shown on each output frame, read back through the real time curve. */
function shown(clip: Clip, frames: number): number[] {
  const startX = Math.round(clip.start * FPS) + 1;
  const out: number[] = [];
  for (let i = 0; i < frames; i += 1) out.push(getLong(clip.time, startX + i));
  return out;
}

function ramp(doc: ReturnType<typeof makeDoc>, request: RampRequest, mute = true) {
  const plan = planSpeedRamp(doc.project, "CLIP000001", request);
  doc.transaction("ramp", (tx) => applySpeedRamp(tx, "CLIP000001", plan, { muteAudio: mute }));
  return plan;
}

describe("planSpeedRamp / applySpeedRamp", () => {
  it("velocity: the slowest moment lands on hit_at within one frame, in one undo step", () => {
    const doc = docWithClip();
    const before = doc.project;
    const plan = ramp(doc, { preset: "velocity", hitAt: 3 });
    const c = clipOf(doc);
    expect(doc.undoLabels).toEqual(["add", "ramp"]);
    expect(c.position).toBe(1);
    // The clip's length is the curve's, rounded to frames.
    expect(Math.round((c.end - c.start) * FPS)).toBe(plan.frames);
    expect(c.duration).toBeCloseTo(plan.duration, 9);
    // Seen through the real (integer) time curve: the 8 frames that spend the least footage are centred on the beat.
    const y = shown(c, plan.frames);
    const spent = (i: number) => y[i + 8]! - y[i]!;
    let best = Infinity;
    const starts: number[] = [];
    for (let i = 0; i + 8 < y.length; i += 1) {
      if (spent(i) < best) {
        best = spent(i);
        starts.length = 0;
      }
      if (spent(i) === best) starts.push(i);
    }
    const middle = (starts[0]! + starts[starts.length - 1]!) / 2 + 4;
    expect(Math.abs(1 + middle / FPS - 3)).toBeLessThanOrEqual(2 / FPS);
    expect(Math.abs(1 + plan.slowestAt - 3)).toBeLessThanOrEqual(1 / FPS);
    expectUndoRedo(doc, before);
  });

  it("integrates the speed: output frames step through the source at the planned speed, and the footage is spent exactly", () => {
    const doc = docWithClip();
    const plan = ramp(doc, { preset: "velocity", hitAt: 3 });
    const y = shown(clipOf(doc), plan.frames);
    const first = 2 * FPS + 1;
    expect(y[0]).toBe(first);
    for (let i = 0; i < plan.frames; i += 1) {
      // Cumulative source frames == the sum of the per-frame speeds, to a rounded frame.
      const expected = first + plan.speeds.slice(0, i).reduce((a, b) => a + b, 0);
      expect(Math.abs(y[i]! - expected)).toBeLessThanOrEqual(1);
      expect(Number.isInteger(y[i]!)).toBe(true);
    }
    // Never past the clip's out point (source frame 8 s * 30 = 240), and it gets there.
    expect(Math.max(...y)).toBeLessThanOrEqual(8 * FPS);
    expect(plan.sourceOut).toBe(8 * FPS);
    // 2.5x rush, 0.1x near-freeze.
    expect(plan.maxSpeed).toBeCloseTo(2.5, 6);
    expect(plan.minSpeed).toBeLessThan(0.15);
    // The speed is continuous: no frame-to-frame jump anywhere on the curve.
    for (let i = 1; i < plan.speeds.length - 1; i += 1) expect(Math.abs(plan.speeds[i]! - plan.speeds[i - 1]!)).toBeLessThan(0.5);
  });

  it("without hit_at the slow moment sits on the middle of the footage", () => {
    const doc = docWithClip();
    const plan = ramp(doc, { preset: "hero" });
    const y = shown(clipOf(doc), plan.frames);
    const at = Math.round(plan.slowestAt * FPS);
    expect(Math.abs(y[at]! - (2 * FPS + 1 + 90))).toBeLessThanOrEqual(6);
    expect(plan.minSpeed).toBeCloseTo(0.25, 6);
  });

  it("ramp_in starts slow and reaches full speed; the clip gets longer", () => {
    const doc = docWithClip();
    const plan = ramp(doc, { preset: "ramp_in", slow: 0.25, rampSeconds: 1 });
    expect(plan.speeds[0]!).toBeLessThan(0.3);
    expect(plan.speeds[plan.frames - 2]!).toBeCloseTo(1, 6);
    expect(plan.duration).toBeGreaterThan(6.2);
    expect(plan.duration).toBeLessThan(7);
    expect(plan.sourceOut).toBe(8 * FPS);
  });

  it("ramp_out slows to the last frame and spends the same footage", () => {
    const doc = docWithClip();
    const plan = ramp(doc, { preset: "ramp_out", slow: 0.2, rampSeconds: 1.5, ease: "in-out" });
    expect(plan.speeds[0]!).toBeCloseTo(1, 6);
    expect(plan.speeds[plan.frames - 1]!).toBeLessThan(0.3);
    expect(plan.sourceOut).toBe(8 * FPS);
    expect(plan.duration).toBeGreaterThan(6.2);
  });

  it("custom points: speeds follow the points on the clip's clock", () => {
    const doc = docWithClip();
    const plan = ramp(doc, {
      preset: "custom",
      ease: "linear",
      points: [
        { atSeconds: 0, speed: 1 },
        { atSeconds: 1, speed: 1 },
        { atSeconds: 2, speed: 0.5 },
        { atSeconds: 3, speed: 2 },
      ],
    });
    expect(plan.frames).toBe(3 * FPS);
    expect(plan.speeds[15]).toBeCloseTo(1, 6);
    expect(plan.speeds[45]).toBeCloseTo(0.75, 1);
    expect(plan.speeds[75]).toBeCloseTo(1.25, 1);
  });

  it("custom points that read past the media are clamped with a warning, not run off the source", () => {
    const doc = docWithClip(15, 19);
    const plan = ramp(doc, { preset: "custom", ease: "linear", points: [{ atSeconds: 0, speed: 1 }, { atSeconds: 10, speed: 1 }] });
    // Source ends at 20 s: 5 s from the in point at 15 s.
    expect(plan.duration).toBeCloseTo(5, 1);
    expect(plan.warnings.join(" ")).toMatch(/media ends/);
    expect(Math.max(...shown(clipOf(doc), plan.frames))).toBeLessThanOrEqual(20 * FPS);
  });

  it("warns that slow motion on a 30 fps source is choppy", () => {
    const doc = docWithClip();
    const plan = planSpeedRamp(doc.project, "CLIP000001", { preset: "hero", slow: 0.2 });
    expect(plan.warnings.join(" ")).toMatch(/choppy.*optical-flow/);
    expect(planSpeedRamp(doc.project, "CLIP000001", { preset: "hero", slow: 0.6 }).warnings).toEqual([]);
  });

  it("mutes the clip by default and keeps its sound on request", () => {
    const muted = docWithClip();
    ramp(muted, { preset: "hero" });
    expect(getLong(clipOf(muted).volume, 1)).toBe(0);
    const kept = docWithClip();
    ramp(kept, { preset: "hero" }, false);
    expect(clipOf(kept).volume.Points[0]!.co.Y).toBe(1);
  });

  it("rescales the clip's other keyframes to its new length, like retime_clip", () => {
    const doc = docWithClip();
    doc.transaction("fade", (tx) => {
      tx.update(["clips", { id: "CLIP000001" }], {
        alpha: { Points: [{ co: { X: 61, Y: 0 }, interpolation: 1 }, { co: { X: 241, Y: 1 }, interpolation: 1 }] },
      });
    });
    const plan = ramp(doc, { preset: "ramp_in" });
    const xs = clipOf(doc).alpha.Points.map((p) => p.co.X);
    expect(xs[0]).toBe(61);
    expect(xs[1]).toBe(61 + plan.frames);
  });

  it("a ramped clip can be ramped again from the same footage", () => {
    const doc = docWithClip();
    ramp(doc, { preset: "ramp_in" });
    const again = ramp(doc, { preset: "hero" });
    expect(again.sourceIn).toBe(2 * FPS + 1);
    expect(again.sourceOut).toBe(8 * FPS);
    expect(clipOf(doc)).toHaveProperty("zenvi_speed_ramp");
  });

  it("works on a clip already sped up by set_clip_speed", () => {
    const doc = docWithClip(0, 10);
    doc.transaction("2x", (tx) => setClipSpeed(tx, "CLIP000001", 2));
    const plan = planSpeedRamp(doc.project, "CLIP000001", { preset: "ramp_in" });
    // 2x on a 10 s clip plays 300 source frames in 5 s; the ramp spends those.
    expect(plan.sourceIn).toBe(1);
    expect(plan.sourceOut).toBe(300);
  });

  describe("refusals leave the project untouched", () => {
    const refuse = (doc: ReturnType<typeof makeDoc>, request: RampRequest) =>
      expectRefused(doc, "invalid_argument", () => planSpeedRamp(doc.project, "CLIP000001", request));

    it("hit_at before the clip, or too soon for the ease", () => {
      const doc = docWithClip();
      expect(refuse(doc, { preset: "velocity", hitAt: 0.5 }).message).toMatch(/before the clip starts/);
      expect(refuse(doc, { preset: "hero", hitAt: 1.03, holdSeconds: 1 }).message).toMatch(/lead-in/);
    });

    it("hit_at on ramp_in / ramp_out", () => {
      expect(refuse(docWithClip(), { preset: "ramp_in", hitAt: 3 }).message).toMatch(/hit_at needs hero, velocity or custom/);
    });

    it("footage that runs out before the beat", () => {
      const doc = docWithClip(2, 4);
      expect(refuse(doc, { preset: "velocity", hitAt: 6, fast: 4 }).message).toMatch(/runs out/);
    });

    it("a ramp-out longer than the footage", () => {
      expect(refuse(docWithClip(2, 3), { preset: "ramp_out", rampSeconds: 20 }).message).toMatch(/too short/);
    });

    it("bad speeds, points and eases", () => {
      const doc = docWithClip();
      expect(refuse(doc, { preset: "hero", slow: 0 }).message).toMatch(/slow must be between/);
      expect(refuse(doc, { preset: "hero", slow: 2, fast: 1 }).message).toMatch(/must not be faster/);
      expect(refuse(doc, { preset: "custom" }).message).toMatch(/at least two/);
      expect(refuse(doc, { preset: "custom", points: [{ atSeconds: 1, speed: 1 }, { atSeconds: 1, speed: 2 }] }).message).toMatch(/strictly increasing/);
      expect(refuse(doc, { preset: "hero", ease: "wobble" as never }).message).toMatch(/ease must be one of/);
    });

    it("reversed, looped, image and freeze-frame clips", () => {
      const reversed = docWithClip();
      reversed.transaction("rev", (tx) => setClipSpeed(tx, "CLIP000001", 1, { direction: "backward" }));
      expect(refuse(reversed, { preset: "hero" }).message).toMatch(/plays backwards/);

      const custom = docWithClip();
      custom.transaction("pts", (tx) =>
        tx.update(["clips", { id: "CLIP000001" }], {
          time: { Points: [1, 2, 3].map((x) => ({ co: { X: x, Y: x }, interpolation: 1 })) },
        }),
      );
      expect(refuse(custom, { preset: "hero" }).message).toMatch(/custom time curve/);

      const image = makeDoc();
      image.transaction("add", (tx) => addClip(tx, { fileId: "IMAGE00001", position: 0, layer: V1, id: "CLIP000001" }));
      expect(refuse(image, { preset: "hero" }).message).toMatch(/no moving picture/);
    });

    it("an unknown clip", () => {
      expectRefused(docWithClip(), "not_found", () => planSpeedRamp(docWithClip().project, "NOPE", { preset: "hero" }));
    });
  });
});
