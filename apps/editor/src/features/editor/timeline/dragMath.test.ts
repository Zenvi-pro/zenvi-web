// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeMove, computeTrim, edgeAt, marqueeHits, type DragItem } from "./dragMath";

const clip = (id: string, position: number, duration: number, trackIndex = 0): DragItem => ({ id, kind: "clip", position, duration, trackIndex });

describe("computeMove", () => {
  it("moves by the pointer delta without snapping", () => {
    expect(computeMove([clip("a", 5, 2)], 1.5, 0, 3, null)).toEqual({ dx: 1.5, dTracks: 0, snapAt: null });
  });

  it("never moves the group before 0", () => {
    expect(computeMove([clip("a", 2, 2), clip("b", 6, 1)], -5, 0, 3, null).dx).toBe(-2);
  });

  it("keeps every item on an existing track", () => {
    const items = [clip("a", 0, 1, 1), clip("b", 0, 1, 2)];
    expect(computeMove(items, 0, 5, 4, null).dTracks).toBe(1);
    expect(computeMove(items, 0, -5, 4, null).dTracks).toBe(-1);
    expect(computeMove(items, 0, 0.6, 4, null).dTracks).toBe(1);
  });

  it("snaps the nearest dragged edge to a target within tolerance", () => {
    const targets = [{ seconds: 10, kind: "clip-start" as const }];
    // End edge lands at 9.9 → snaps to 10.
    const result = computeMove([clip("a", 5, 2)], 2.9, 0, 1, { targets, tolerance: 0.2 });
    expect(result.dx).toBeCloseTo(3);
    expect(result.snapAt).toBe(10);
    // Out of tolerance: no snap.
    expect(computeMove([clip("a", 5, 2)], 2.5, 0, 1, { targets, tolerance: 0.2 }).snapAt).toBeNull();
  });

  it("uses the engine's per-target tolerance (keyframes)", () => {
    const targets = [{ seconds: 3, kind: "keyframe" as const, tolerance: 0.01 }];
    expect(computeMove([clip("a", 0, 1)], 2.95, 0, 1, { targets, tolerance: 0.5 }).snapAt).toBeNull();
  });
});

describe("computeTrim", () => {
  const subject = { position: 10, start: 2, end: 6, mediaDuration: 8 };

  it("left edge moves position and start together", () => {
    expect(computeTrim(subject, "left", 9, 1 / 30, null)).toMatchObject({ time: 9, position: 9, start: 1, end: 6 });
  });

  it("left edge stops at the media start and before the right edge", () => {
    expect(computeTrim(subject, "left", 0, 1 / 30, null)).toMatchObject({ position: 8, start: 0 });
    expect(computeTrim(subject, "left", 20, 0.1, null).position).toBeCloseTo(13.9);
  });

  it("right edge stops at the media end and a one-frame minimum", () => {
    expect(computeTrim(subject, "right", 30, 1 / 30, null)).toMatchObject({ time: 16, end: 8 });
    expect(computeTrim(subject, "right", 0, 0.5, null)).toMatchObject({ time: 10.5, end: 2.5 });
  });

  it("images have no media limit", () => {
    expect(computeTrim({ ...subject, mediaDuration: null }, "right", 100, 1 / 30, null).end).toBe(92);
  });

  it("snaps the edge and drops the snap line when clamped", () => {
    const snap = { targets: [{ seconds: 12, kind: "playhead" as const }], tolerance: 0.3 };
    expect(computeTrim(subject, "right", 11.8, 1 / 30, snap)).toMatchObject({ time: 12, snapAt: 12 });
    const far = { targets: [{ seconds: 30, kind: "marker" as const }], tolerance: 0.5 };
    expect(computeTrim(subject, "right", 29.8, 1 / 30, far)).toMatchObject({ time: 16, snapAt: null });
  });
});

describe("marqueeHits", () => {
  it("selects intersecting clips and transitions, in any drag direction", () => {
    const boxes = [
      { id: "a", kind: "clip" as const, left: 0, right: 100, top: 0, bottom: 50 },
      { id: "b", kind: "clip" as const, left: 200, right: 300, top: 0, bottom: 50 },
      { id: "t", kind: "transition" as const, left: 80, right: 120, top: 0, bottom: 50 },
    ];
    expect(marqueeHits({ x0: 150, y0: 40, x1: 90, y1: 10 }, boxes)).toEqual({ clips: ["a"], transitions: ["t"] });
  });
});

describe("edgeAt", () => {
  it("finds trim zones and shrinks them on narrow clips", () => {
    expect(edgeAt(3, 0, 100)).toBe("left");
    expect(edgeAt(96, 0, 100)).toBe("right");
    expect(edgeAt(50, 0, 100)).toBeNull();
    expect(edgeAt(5, 0, 12)).toBeNull();
    expect(edgeAt(1, 0, 12)).toBe("left");
  });
});
