import { describe, expect, it } from "vitest";
import { sourceSecondsAt, sourceToCanvas } from "../matchcut/fit.js";
import { findClip } from "../model/query.js";
import { Interpolation } from "../model/types.js";
import { trackAt, type Quad, type Track } from "../tracking/track.js";
import { addClip, setClipKeyframes } from "./clips.js";
import { expectRefused, makeDoc } from "./testkit.js";
import { decomposeAffine, pinToTrack } from "./track-follow.js";

const V1 = 1_000_000;
const V2 = 2_000_000;

const parallelogram = (tl: [number, number], u: [number, number], v: [number, number]): Quad => [
  { x: tl[0], y: tl[1] },
  { x: tl[0] + u[0], y: tl[1] + u[1] },
  { x: tl[0] + u[0] + v[0], y: tl[1] + u[1] + v[1] },
  { x: tl[0] + v[0], y: tl[1] + v[1] },
];

/** A surface that slides, turns and shears over 2 s (0-1 of the footage's frame). */
const surface: Track = {
  model: "affine",
  aspect: 16 / 9,
  samples: [
    { time: 0, quad: parallelogram([0.3, 0.3], [0.25, 0.02], [0.03, 0.4]), lost: false, score: 1 },
    { time: 2, quad: parallelogram([0.4, 0.25], [0.2, 0.08], [-0.06, 0.35]), lost: false, score: 1 },
  ],
};

/** Footage moved, shrunk and turned, with an image clip above it. */
function docWithFootage() {
  const doc = makeDoc();
  doc.transaction("add", (tx) => {
    addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, start: 0, end: 2, id: "FOOTAGE001" });
    addClip(tx, { fileId: "IMAGE00001", position: 0, layer: V2, start: 0, end: 2, id: "OVERLAY001" });
    const constant = (value: number) => [{ frame: 1, value, interpolation: Interpolation.LINEAR }];
    setClipKeyframes(tx, "FOOTAGE001", "scale_x", constant(0.7));
    setClipKeyframes(tx, "FOOTAGE001", "scale_y", constant(0.7));
    setClipKeyframes(tx, "FOOTAGE001", "location_x", constant(0.15));
    setClipKeyframes(tx, "FOOTAGE001", "rotation", constant(12));
  });
  return doc;
}

describe("decomposeAffine", () => {
  it("splits rotation · shear_x · scale back into its parts", () => {
    const r = (25 * Math.PI) / 180;
    const [sx, sy, sh] = [300, 180, 0.4];
    // R(r) · [[1, sh], [0, 1]] · diag(sx, sy)
    const m: [number, number, number, number, number, number] = [Math.cos(r) * sx, (Math.cos(r) * sh - Math.sin(r)) * sy, 7, Math.sin(r) * sx, (Math.sin(r) * sh + Math.cos(r)) * sy, 9];
    const parts = decomposeAffine(m, 100, 60);
    expect(parts.rotation).toBeCloseTo(25, 9);
    expect(parts.shearX).toBeCloseTo(sh, 9);
    expect(parts.scaleX).toBeCloseTo(3, 9);
    expect(parts.scaleY).toBeCloseTo(3, 9);
  });
});

describe("pinToTrack", () => {
  it("surface: the overlay's corners land on a turning, shearing quad of moved footage, in one undo step", () => {
    const doc = docWithFootage();
    const undoBefore = doc.undoLabels.length;
    const result = doc.transaction("pin", (tx) => pinToTrack(tx, { clipId: "OVERLAY001", footageId: "FOOTAGE001", track: surface, follow: "surface" }));
    expect(doc.undoLabels.length).toBe(undoBefore + 1);
    const footage = findClip(doc.project, "FOOTAGE001")!;
    const overlay = findClip(doc.project, "OVERLAY001")!;
    for (const n of [result.frames[0]!, 31, result.frames[result.frames.length - 1]!]) {
      expect(result.frames).toContain(n);
      const want = trackAt(surface, sourceSecondsAt(doc.project, footage, n)).map((p) => sourceToCanvas(doc.project, footage, n)(p.x, p.y));
      const map = sourceToCanvas(doc.project, overlay, n);
      const got = [map(0, 0), map(1, 0), map(1, 1), map(0, 1)];
      got.forEach(([x, y], i) => {
        expect(Math.abs(x - want[i]![0]), `x of corner ${i} at frame ${n}`).toBeLessThan(0.5);
        expect(Math.abs(y - want[i]![1]), `y of corner ${i} at frame ${n}`).toBeLessThan(0.5);
      });
    }
  });

  it("refuses a clip following its own track without an undo step", () => {
    const doc = docWithFootage();
    expectRefused(doc, "invalid_argument", (tx) => pinToTrack(tx, { clipId: "FOOTAGE001", footageId: "FOOTAGE001", track: surface, follow: "position" }));
  });
});
