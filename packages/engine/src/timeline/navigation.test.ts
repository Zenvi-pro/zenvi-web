import { describe, expect, it } from "vitest";
import { createProject } from "../model/defaults.js";
import type { Clip, Project } from "../model/types.js";
import { adjacentPosition, clipEdges, navigationPositions, pickAdjacent, secondsToSeekFrame } from "./navigation.js";

function project(): Project {
  const p = createProject({ id: "P" });
  p.markers = [{ id: "M1", position: 4.0 }];
  p.clips = [
    {
      id: "C1",
      layer: 1_000_000,
      position: 10,
      start: 2,
      end: 6,
      // A keyframe 3.0 s into the source: timeline 10 + (3.0 - 2.0) = 11.
      alpha: { Points: [{ co: { X: 91, Y: 1 }, interpolation: 0 }] },
      effects: [{ id: "FX1", class_name: "Blur", type: "Blur", horizontal_radius: { Points: [{ co: { X: 121, Y: 5 }, interpolation: 0 }] } }],
    } as unknown as Clip,
  ];
  return p;
}

describe("marker navigation (track_ops.py)", () => {
  it("stops at the start, markers and the end with nothing selected", () => {
    expect(navigationPositions(project(), {}, 301).sort((a, b) => a - b)).toEqual([0, 4, 10]);
  });

  it("stops at the selected clip's edges and keyframes, or an effect's keyframes", () => {
    const withClip = navigationPositions(project(), { clips: ["C1"] }).sort((a, b) => a - b);
    // start 10, keyframes at 11 (alpha) and 12 (the Blur's), last frame 14 - 1/30.
    expect(withClip.slice(0, 5)).toEqual([0, 4, 10, 11, 12]);
    expect(withClip[5]).toBeCloseTo(14 - 1 / 30, 9);
    const withEffect = navigationPositions(project(), { effects: ["FX1"] }).sort((a, b) => a - b);
    expect(withEffect.slice(0, 4)).toEqual([0, 4, 10, 12]);
  });

  it("picks the nearest stop that moves the playhead", () => {
    expect(adjacentPosition([0, 4, 10, 11], 10, 1)).toBe(11);
    expect(adjacentPosition([0, 4, 10, 11], 10, -1)).toBe(4);
    expect(adjacentPosition([0], 0, -1)).toBeUndefined();
    // 10.01 s and 10.012 s land on the current frame (301): the next stop that moves is 11 s.
    expect(pickAdjacent(project(), [10.01, 10.012, 11], 10, 301, 1, 1000)).toEqual([11, 331]);
    expect(pickAdjacent(project(), [10.01, 10.02], 10, 301, 1, 1000)).toEqual([10.02, 302]);
    expect(secondsToSeekFrame(project(), 50, 1199)).toBe(1199);
    expect(clipEdges(project())).toEqual([10, 14]);
    expect(clipEdges(project(), 2_000_000)).toEqual([]);
  });
});
