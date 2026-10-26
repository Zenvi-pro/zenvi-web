import { describe, expect, it } from "vitest";
import { createClip, createProject } from "../model/defaults.js";
import { makeKeyframePoint } from "../keyframe/edit.js";
import { Gravity, Interpolation, ScaleMode, type Clip } from "../model/types.js";
import { videoFile } from "../ops/testkit.js";
import { clipGeometry, coverScale, fitRotation, fitScale, solveLocation, subjectOnCanvas, type CanvasSubject, type FitMode, type SubjectBox } from "./fit.js";

const constant = (value: number) => ({ Points: [makeKeyframePoint(1, value, Interpolation.LINEAR)] });

function setup(opts: { scale: number; gravity: number; srcW: number; srcH: number; originX?: number; margin?: number }) {
  const project = createProject();
  project.width = 1280;
  project.height = 720;
  const file = videoFile("VID", { width: opts.srcW, height: opts.srcH });
  const clip: Clip = { ...createClip({ id: "C1", file, position: 0, layer: project.layers[0]!.number, fps: project.fps }), scale: opts.scale as ScaleMode, gravity: opts.gravity as Gravity };
  if (opts.originX !== undefined) clip.origin_x = constant(opts.originX);
  if (opts.margin !== undefined) clip.margin = constant(opts.margin);
  project.files = [file];
  project.clips = [clip];
  return { project, clip };
}

/** The clip with the solved values written as constant keyframes. */
function solved(clip: Clip, v: { scale: number; locationX: number; locationY: number; rotation: number }): Clip {
  return { ...clip, scale_x: constant(v.scale), scale_y: constant(v.scale), location_x: constant(v.locationX), location_y: constant(v.locationY), rotation: constant(v.rotation) };
}

describe("subject fit", () => {
  const box: SubjectBox = { x: 0.62, y: 0.18, w: 0.2, h: 0.3, angle: 12 };
  const target: CanvasSubject = { cx: 0.5, cy: 0.5, size: 0.4, angle: 0 };
  const cases: Array<[string, Parameters<typeof setup>[0], FitMode]> = [
    ["fit, centre", { scale: ScaleMode.FIT, gravity: Gravity.CENTER, srcW: 1920, srcH: 1080 }, "position_scale"],
    ["crop, portrait source", { scale: ScaleMode.CROP, gravity: Gravity.CENTER, srcW: 1080, srcH: 1920 }, "position_scale"],
    ["crop, top-left gravity", { scale: ScaleMode.CROP, gravity: Gravity.TOP_LEFT, srcW: 1920, srcH: 1080 }, "position_scale"],
    ["stretch, bottom-right", { scale: ScaleMode.STRETCH, gravity: Gravity.BOTTOM_RIGHT, srcW: 640, srcH: 480 }, "position_scale"],
    ["none, right", { scale: ScaleMode.NONE, gravity: Gravity.RIGHT, srcW: 640, srcH: 480 }, "position_scale"],
    ["rotation about an off-centre origin", { scale: ScaleMode.CROP, gravity: Gravity.CENTER, srcW: 1920, srcH: 1080, originX: 0.2 }, "position_scale_rotation"],
    ["margin", { scale: ScaleMode.FIT, gravity: Gravity.TOP, srcW: 1920, srcH: 1080, margin: 0.1 }, "position_scale_rotation"],
  ];
  for (const [name, opts, fit] of cases) {
    it(`puts the subject on the target through clipTransform (${name})`, () => {
      const { project, clip } = setup(opts);
      const g = clipGeometry(project, clip, 1);
      const rotation = fitRotation(g, box, target, fit);
      const scale = fitScale(g, box, target, fit);
      // The decode size follows the scale curve (calculate_max_size): place the subject with the scale written.
      const scaled = solved(clip, { scale, locationX: 0, locationY: 0, rotation });
      const written = solved(clip, solveLocation(clipGeometry(project, scaled, 1), box, target, scale, rotation));
      const on = subjectOnCanvas(project, written, 1, box);
      expect(Math.abs(on.cx - target.cx) * 1280).toBeLessThan(0.05);
      expect(Math.abs(on.cy - target.cy) * 720).toBeLessThan(0.05);
      expect(on.size).toBeCloseTo(target.size, 3);
      if (fit === "position_scale_rotation") expect(on.angle).toBeCloseTo(target.angle, 6);
    });
  }

  it("finds the smallest scale that keeps the canvas covered", () => {
    const { project, clip } = setup({ scale: ScaleMode.CROP, gravity: Gravity.CENTER, srcW: 1920, srcH: 1080 });
    const g = clipGeometry(project, clip, 1);
    // Subject at the source's right third, moved to the centre: the right edge runs out first.
    const subject: SubjectBox = { x: 0.6, y: 0.4, w: 0.1, h: 0.2 };
    const need = coverScale(g, subject, target, 0);
    // Right edge: (1280 − 640) / (1280 · (1 − 0.65)).
    expect(need).toBeCloseTo(640 / (1280 * 0.35), 9);
    const check = (scale: number) => {
      const v = solveLocation(g, subject, target, scale, 0);
      const t = solved(clip, v);
      const on = subjectOnCanvas(project, t, 1, { x: 1, y: 0, w: 0, h: 0 });
      return on.cx * 1280; // canvas x of the source's right edge
    };
    expect(check(need)).toBeCloseTo(1280, 3);
    expect(check(need * 0.95)).toBeLessThan(1280);
    // Rotated, a centred full-frame subject needs a zoom to hide the corners.
    const centred: SubjectBox = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    expect(coverScale(g, centred, target, 0)).toBeCloseTo(1, 9);
    expect(coverScale(g, centred, target, 10)).toBeGreaterThan(1.1);
    expect(coverScale(g, { x: 0.95, y: 0.4, w: 0.1, h: 0.2 }, target, 0)).toBe(Infinity);
  });
});
