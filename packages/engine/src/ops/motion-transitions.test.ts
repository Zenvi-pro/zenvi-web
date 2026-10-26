import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../history/document.js";
import { makeKeyframePoint } from "../keyframe/edit.js";
import { evaluate } from "../keyframe/evaluate.js";
import { Interpolation, type Clip, type Project } from "../model/types.js";
import { compositeFrame } from "../render/cpu/compositor.js";
import { planFrame } from "../render/plan/frame-plan.js";
import { frameWindow } from "../timeline/windows.js";
import { MOTION_TRANSITION_IDS } from "../transitions/motion/presets.js";
import { addClip } from "./clips.js";
import { MOTION_TRANSITIONS_KEY, applyMotionTransition, motionRecords, removeMotionTransition, trackCuts } from "./motion-transitions.js";
import { baseProject, expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

/** Clips of 2 s each on track 1, cut back to back. */
function cutsDoc(count = 2, project: Project = baseProject()): ProjectDocument {
  const doc = makeDoc(project);
  doc.transaction("clips", (tx) => {
    for (let i = 0; i < count; i += 1) addClip(tx, { fileId: "VIDEO00001", position: 2 * i, layer: 1, start: 2 * i, end: 2 * i + 2, id: `CLIP${i}` });
  });
  doc.clearHistory();
  return doc;
}

function clip(doc: ProjectDocument, id: string): Clip {
  return doc.project.clips.find((c) => c.id === id)!;
}

/** Ken Burns on the outgoing clip: bezier scale 1 → 1.2 and a drift right over its 60 frames. */
function withKenBurns(doc: ProjectDocument): void {
  doc.transaction("ken burns", (tx) => {
    const c = tx.project.clips.find((x) => x.id === "CLIP0")!;
    const first = frameWindow(c, tx.project.fps).localStartFrame;
    tx.update(["clips", { id: "CLIP0" }], {
      scale_x: { Points: [makeKeyframePoint(first, 1), makeKeyframePoint(first + 59, 1.2)] },
      scale_y: { Points: [makeKeyframePoint(first, 1), makeKeyframePoint(first + 59, 1.2)] },
      location_x: { Points: [makeKeyframePoint(first, -0.05, Interpolation.LINEAR), makeKeyframePoint(first + 59, 0.05, Interpolation.LINEAR)] },
    });
  });
  doc.clearHistory();
}

describe("applyMotionTransition", () => {
  it("splices a whip into both clips as one undo step and lists what it changed", () => {
    const doc = cutsDoc();
    const before = doc.project;
    const result = doc.transaction("whip", (tx) => applyMotionTransition(tx, { outClipId: "CLIP0", inClipId: "CLIP1", preset: "whip", direction: "left" }));
    expect(doc.undoLabels).toEqual(["whip"]);
    expect(result).toMatchObject({ preset: "whip", direction: "left", frames: 8, layer: 1, cut: 2 });
    expect(result.clips.map((c) => [c.id, c.role])).toEqual([
      ["CLIP0", "out"],
      ["CLIP1", "in"],
    ]);
    // Outgoing: rest at its last frame - 4, moving frames up to the last frame (clip frames count from start = 0 s).
    expect(result.clips[0]!.frames).toEqual([56, 60]);
    expect(result.clips[1]!.frames).toEqual([61, 65]);
    expect(result.clips[0]!.properties).toEqual([]);
    const a = clip(doc, "CLIP0");
    expect(a.effects.map((e) => e.type)).toEqual(["Shift", "Blur"]);
    expect(result.clips[0]!.effectIds).toEqual(a.effects.map((e) => e.id));
    const shift = a.effects[0]!;
    expect(evaluate(shift.x as never, 56)).toBe(0);
    expect(evaluate(shift.x as never, 60)).toBe(-0.5);
    expect(evaluate(shift.x as never, 1)).toBe(0);
    expect(motionRecords(a)[0]).toMatchObject({ id: result.id, role: "out", partner: "CLIP1", preset: "whip", window: [56, 60] });
    expect(result.sfxCues).toEqual([{ time: 1.867, kind: "whoosh", duration: 0.267 }]);
    expectUndoRedo(doc, before);
  });

  it("keeps a Ken Burns curve outside the window and rides on top of it inside", () => {
    const doc = cutsDoc();
    withKenBurns(doc);
    const original = clip(doc, "CLIP0");
    doc.transaction("zoom", (tx) => applyMotionTransition(tx, { outClipId: "CLIP0", inClipId: "CLIP1", preset: "zoom_in" }));
    const a = clip(doc, "CLIP0");
    for (let f = 1; f <= 56; f += 1) {
      expect(evaluate(a.scale_x, f), `frame ${f}`).toBeCloseTo(evaluate(original.scale_x, f), 3);
      expect(evaluate(a.location_x, f)).toBe(evaluate(original.location_x, f));
    }
    // On the cut the punch multiplies the Ken Burns zoom (1.2 × 1.6).
    // On the cut the punch multiplies the Ken Burns zoom (1.2 × 1.6, snapped up to a whole-pixel decode box at 1280×720).
    expect(evaluate(a.scale_x, 60)).toBe(1.925);
    expect(a.location_x).toEqual(original.location_x);
  });

  it("keeps the track's current for auto directions and never alternates", () => {
    const doc = cutsDoc(4);
    const auto = (out: string, inn: string, preset: "whip" | "spin" | "squash") =>
      doc.transaction("auto", (tx) => applyMotionTransition(tx, { outClipId: out, inClipId: inn, preset, direction: "auto" })).direction;
    expect(auto("CLIP0", "CLIP1", "whip")).toBe("left");
    doc.transaction("right", (tx) => applyMotionTransition(tx, { outClipId: "CLIP0", inClipId: "CLIP1", preset: "whip", direction: "right" }));
    // The cut after a right whip keeps going right, whatever the preset that can.
    expect(auto("CLIP1", "CLIP2", "squash")).toBe("right");
    expect(auto("CLIP2", "CLIP3", "whip")).toBe("right");
    expect(auto("CLIP2", "CLIP3", "spin")).toBe("cw");
  });

  it("is deterministic", () => {
    const run = (): unknown => {
      const doc = cutsDoc();
      doc.transaction("glitch", (tx) => applyMotionTransition(tx, { outClipId: "CLIP0", inClipId: "CLIP1", preset: "glitch", intensity: 1.4 }));
      // Effect and transition ids are fresh random ids; everything else must repeat exactly.
      return JSON.parse(JSON.stringify(doc.project.clips).replace(/"(MT)?[0-9A-Z]{10}"/g, '"ID"'));
    };
    expect(run()).toEqual(run());
  });

  it("refuses without touching history: gaps, overlaps, short clips, wrong direction", () => {
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1, start: 0, end: 2, id: "A" });
      addClip(tx, { fileId: "VIDEO00001", position: 2.5, layer: 1, start: 0, end: 0.1, id: "B" });
      addClip(tx, { fileId: "VIDEO00001", position: 2.6, layer: 1, start: 0, end: 2, id: "C" });
    });
    expect(expectRefused(doc, "conflict", (tx) => applyMotionTransition(tx, { outClipId: "A", inClipId: "B", preset: "whip" })).message).toMatch(/gap/);
    expect(expectRefused(doc, "invalid_argument", (tx) => applyMotionTransition(tx, { outClipId: "B", inClipId: "C", preset: "whip" })).message).toMatch(/too short/);
    expectRefused(doc, "invalid_argument", (tx) => applyMotionTransition(tx, { outClipId: "B", inClipId: "C", preset: "zoom_in", direction: "left" }));
    expectRefused(doc, "not_found", (tx) => applyMotionTransition(tx, { outClipId: "A", inClipId: "NOPE", preset: "whip" }));
  });

  it("finds the seamless cuts on a track", () => {
    const doc = cutsDoc(3);
    expect(trackCuts(doc.project, 1).map((c) => [c.outClip.id, c.inClip.id, c.cut])).toEqual([
      ["CLIP0", "CLIP1", 2],
      ["CLIP1", "CLIP2", 4],
    ]);
  });
});

describe("removeMotionTransition", () => {
  it("restores the original JSON exactly", () => {
    const doc = cutsDoc();
    withKenBurns(doc);
    const original = JSON.stringify(doc.project.clips);
    for (const preset of MOTION_TRANSITION_IDS) {
      const r = doc.transaction(preset, (tx) => applyMotionTransition(tx, { outClipId: "CLIP0", inClipId: "CLIP1", preset }));
      doc.transaction("remove", (tx) => removeMotionTransition(tx, r.id));
      expect(JSON.stringify(doc.project.clips), preset).toBe(original);
    }
  });

  it("restores a middle clip with transitions on both ends, removed in either order", () => {
    for (const order of [0, 1]) {
      const doc = cutsDoc(3);
      withKenBurns(doc);
      const original = JSON.stringify(doc.project.clips);
      const first = doc.transaction("a", (tx) => applyMotionTransition(tx, { outClipId: "CLIP0", inClipId: "CLIP1", preset: "zoom_out" }));
      const second = doc.transaction("b", (tx) => applyMotionTransition(tx, { outClipId: "CLIP1", inClipId: "CLIP2", preset: "spin" }));
      expect(motionRecords(clip(doc, "CLIP1")).map((r) => r.role)).toEqual(["in", "out"]);
      const ids = order === 0 ? [first.id, second.id] : [second.id, first.id];
      doc.transaction("r1", (tx) => removeMotionTransition(tx, ids[0]!));
      doc.transaction("r2", (tx) => removeMotionTransition(tx, ids[1]!));
      expect(JSON.stringify(doc.project.clips), `order ${order}`).toBe(original);
    }
  });

  it("keeps user edits made after the transition and refuses unknown ids", () => {
    const doc = cutsDoc();
    const r = doc.transaction("whip", (tx) => applyMotionTransition(tx, { outClipId: "CLIP0", inClipId: "CLIP1", preset: "whip" }));
    doc.transaction("edit", (tx) => {
      const c = tx.project.clips.find((x) => x.id === "CLIP0")!;
      tx.update(["clips", { id: "CLIP0" }], { scale_x: { Points: [...c.scale_x.Points, makeKeyframePoint(20, 1.5)] } });
    });
    doc.transaction("remove", (tx) => removeMotionTransition(tx, r.id));
    const a = clip(doc, "CLIP0");
    expect(a.scale_x.Points.map((p) => p.co.X)).toEqual([1, 20]);
    expect(MOTION_TRANSITIONS_KEY in a).toBe(false);
    expect(a.effects).toEqual([]);
    expectRefused(doc, "not_found", (tx) => removeMotionTransition(tx, r.id));
  });
});

/** Opaque, bright, non-uniform source pictures (no pixel near black). */
function paint(width: number, height: number, hue: number): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = 90 + ((x * 3 + hue) % 160);
      data[i + 1] = 90 + ((y * 5 + hue) % 160);
      data[i + 2] = 90 + (((x + y) * 2 + hue) % 160);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("motion transitions cover the canvas", () => {
  // flash_black dims the picture on purpose; every other preset must keep every border pixel lit.
  const presets = MOTION_TRANSITION_IDS.filter((p) => p !== "flash_black");
  it.each(presets)("%s leaves no black edge on any frame", (preset) => {
    // Small canvas, rendered at its own size: the clip's picture covers it exactly at rest.
    const W = 160;
    const H = 90;
    const doc = cutsDoc(2, { ...baseProject(), width: W, height: H });
    const r = doc.transaction(preset, (tx) => applyMotionTransition(tx, { outClipId: "CLIP0", inClipId: "CLIP1", preset, intensity: 2, direction: preset === "whip" ? "up" : undefined }));
    const project = doc.project;
    const cutFrame = Math.round(r.cut * 30) + 1;
    const bad: string[] = [];
    for (let frame = cutFrame - 8; frame <= cutFrame + 9; frame += 1) {
      const plan = planFrame(project, frame);
      const layers = plan.layers.map((layer) => (layer.source.kind === "color" ? null : paint(layer.drawWidth, layer.drawHeight, layer.source.kind === "video" ? Math.round(layer.source.time * 30) : 0)));
      const image = compositeFrame(plan, { layers });
      for (let i = 0; i < W * H; i += 1) {
        const x = i % W;
        const y = Math.floor(i / W);
        if (x !== 0 && x !== W - 1 && y !== 0 && y !== H - 1) continue;
        const d = image.data;
        if (d[i * 4]! + d[i * 4 + 1]! + d[i * 4 + 2]! < 60) bad.push(`frame ${frame} (${x},${y})`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
