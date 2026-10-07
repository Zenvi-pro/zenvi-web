import { describe, expect, it } from "vitest";
import type { Clip, Project, Transition } from "../model/types.js";
import {
  bottomLayer,
  clipsAt,
  clipsAtFrame,
  clipsOnLayer,
  findGap,
  gapsOnLayer,
  layerAbove,
  layerBelow,
  layerIndex,
  maxFrame,
  overlapping,
  sortClips,
  sortTransitions,
  sortedLayers,
  timelineEnd,
  timelineStart,
  topClipAt,
  topClipOnLayerAtFrame,
  topLayer,
  transitionsAt,
  transitionsAtFrame,
} from "./queries.js";

const clip = (id: string, layer: number, position: number, start: number, end: number): Clip =>
  ({ id, layer, position, start, end }) as Clip;
const transition = (id: string, layer: number, position: number, duration: number, order = 0): Transition =>
  ({ id, layer, position, start: 0, end: duration, order, type: "Mask", class_name: "Mask" }) as Transition;

function project(clips: Clip[], effects: Transition[] = []): Project {
  return {
    fps: { num: 30, den: 1 },
    clips,
    effects,
    layers: [
      { id: "L3", number: 3000000, label: "", y: 0, lock: false },
      { id: "L1", number: 1000000, label: "", y: 0, lock: false },
      { id: "L2", number: 2000000, label: "", y: 0, lock: false },
    ],
  } as unknown as Project;
}

describe("stacking order", () => {
  it("sorts clips by layer then position, ties in JSON order", () => {
    const clips = [clip("c", 2, 5, 0, 1), clip("a", 1, 9, 0, 1), clip("b", 2, 5, 0, 1), clip("d", 1, 0, 0, 1)];
    expect(sortClips(clips).map((c) => c.id)).toEqual(["d", "a", "c", "b"]);
  });

  it("sorts transitions by layer, position, then order descending", () => {
    const ts = [transition("x", 1, 0, 1, 0), transition("y", 1, 0, 1, 5), transition("z", 0, 3, 1)];
    expect(sortTransitions(ts).map((t) => t.id)).toEqual(["z", "y", "x"]);
  });
});

describe("what is where", () => {
  const p = project(
    [clip("A", 1000000, 0, 0, 5), clip("B", 1000000, 4, 0, 5), clip("C", 2000000, 2, 10, 13)],
    [transition("T", 1000000, 4, 1)],
  );

  it("clipsAt uses [position, end) in seconds", () => {
    expect(clipsAt(p, 4.5).map((c) => c.id)).toEqual(["A", "B", "C"]);
    expect(clipsAt(p, 5).map((c) => c.id)).toEqual(["B"]);
    expect(clipsAt(p, 4.5, { layer: 1000000 }).map((c) => c.id)).toEqual(["A", "B"]);
    expect(topClipAt(p, 4.5)?.id).toBe("C");
    expect(topClipAt(p, 1)?.id).toBe("A");
    expect(topClipAt(p, 100)).toBeUndefined();
    expect(transitionsAt(p, 4.2).map((t) => t.id)).toEqual(["T"]);
  });

  it("frame queries reproduce GetFrame intersection and is_top_clip", () => {
    // Frame 136 = 4.5 s.
    expect(clipsAtFrame(p, 136).map((c) => c.id)).toEqual(["A", "B", "C"]);
    // The later-starting clip on the layer gets the transition.
    expect(topClipOnLayerAtFrame(p, 1000000, 136)?.id).toBe("B");
    expect(topClipOnLayerAtFrame(p, 1000000, 10)?.id).toBe("A");
    expect(transitionsAtFrame(p, 1000000, 121).map((t) => t.id)).toEqual(["T"]);
    expect(transitionsAtFrame(p, 1000000, 151).map((t) => t.id)).toEqual([]);
  });

  it("clipsOnLayer, overlapping", () => {
    expect(clipsOnLayer(p, 1000000).map((c) => c.id)).toEqual(["A", "B"]);
    expect(overlapping(p, 1000000, 4.5, 6).map((c) => c.id)).toEqual(["A", "B"]);
    expect(overlapping(p, 1000000, 4.5, 6, new Set(["A"])).map((c) => c.id)).toEqual(["B"]);
  });

  it("timeline extent", () => {
    expect(timelineEnd(p)).toBe(9);
    expect(timelineStart(p)).toBe(0);
    expect(maxFrame(p)).toBe(270);
    expect(maxFrame(project([]))).toBe(0);
  });
});

describe("gaps (desktop ShowTimelineMenu / RemoveGap)", () => {
  const p = project([clip("A", 1, 0, 0, 5), clip("B", 1, 10, 0, 5), clip("C", 1, 20, 0, 2)]);

  it("finds the first gap that ends after the position", () => {
    expect(findGap(p, 1, 7)).toEqual({ start: 5, end: 10 });
    expect(findGap(p, 1, 3)).toEqual({ start: 5, end: 10 });
    expect(findGap(p, 1, 12)).toEqual({ start: 15, end: 20 });
    expect(findGap(p, 1, 21)).toBeNull();
  });

  it("a gap before the first clip counts", () => {
    expect(findGap(project([clip("A", 1, 3, 0, 1)]), 1, 1)).toEqual({ start: 0, end: 3 });
  });

  it("lists all gaps", () => {
    expect(gapsOnLayer(p, 1)).toEqual([
      { start: 5, end: 10 },
      { start: 15, end: 20 },
    ]);
  });
});

describe("layers", () => {
  const p = project([]);
  it("orders tracks bottom to top", () => {
    expect(sortedLayers(p).map((l) => l.number)).toEqual([1000000, 2000000, 3000000]);
    expect(topLayer(p)?.id).toBe("L3");
    expect(bottomLayer(p)?.id).toBe("L1");
    expect(layerAbove(p, 1000000)?.id).toBe("L2");
    expect(layerBelow(p, 1000000)).toBeUndefined();
    expect(layerBelow(p, 3000000)?.id).toBe("L2");
    expect(layerIndex(p, 2000000)).toBe(2);
    expect(layerIndex(p, 5)).toBe(0);
  });
});
