import { describe, expect, test } from "vitest";
import { BlendingMode, LightType, TrackMatteType, type AVLayer, type FootageItem, type LightLayer, type Property, type PropertyGroup, type ShapeLayer, type SolidSource } from "../testing/ae-mock.js";
import { aeHarness } from "../testing/ae-harness.js";

describe("ae_import_files", () => {
  test("imports into Zenvi Imports, reuses what is already imported, all in one undo step", () => {
    const h = aeHarness();
    const clip = h.file("beach.mov");
    const still = h.file("logo.png");
    const first = h.callValidated("ae_import_files", { paths: [clip, still] });
    expect(first).toMatchObject({ status: "applied", undoSteps: 1, data: { folder: "Zenvi Imports" } });
    expect(first.data.items).toEqual([
      expect.objectContaining({ name: "beach.mov", type: "footage", reused: false, parent_folder: expect.objectContaining({ name: "Zenvi Imports" }) }),
      expect.objectContaining({ name: "logo.png", is_still: true, reused: false }),
    ]);
    const again = h.callValidated("ae_import_files", { paths: [clip] });
    expect(again).toMatchObject({ status: "unchanged", undoSteps: 0 });
    expect(h.mock.project.allItems.filter((item) => item.name === "beach.mov")).toHaveLength(1);
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Import files", "Zenvi: Import files"]);
  });

  test("checks every path first: one missing or unsupported file imports nothing", () => {
    const h = aeHarness();
    const good = h.file("a.mov");
    const missing = h.callValidated("ae_import_files", { paths: [good, `${h.dir}/nope.mov`] });
    expect(missing).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "NOT_FOUND" } });
    expect(missing.summary).toContain("nope.mov");
    const unsupported = h.callValidated("ae_import_files", { paths: [good, h.file("notes.txt")] });
    expect(unsupported).toMatchObject({ status: "refused", error: { code: "UNSUPPORTED" } });
    expect(h.mock.project.numItems).toBe(0);
  });
});

describe("ae_add_layer", () => {
  test("footage from a path is imported once and added on top", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const clip = h.file("beach.mov");
    const receipt = h.callValidated("ae_add_layer", { kind: "footage", path: clip, name: "Beach", start: 1 });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { name: "Beach", layer_index: 1, type: "footage", source: { type: "footage" } } });
    expect(comp.layer(1).startTime).toBe(1);
    h.callValidated("ae_add_layer", { kind: "footage", path: clip });
    expect(h.mock.project.allItems.filter((item) => item.name === "beach.mov")).toHaveLength(1);
  });

  test("solid defaults to the comp size in ink; adjustment; null with parent; transform; blend mode; label", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const solid = h.callValidated("ae_add_layer", { kind: "solid" });
    const solidLayer = comp.layer(1) as AVLayer;
    expect(solid.data).toMatchObject({ type: "solid", name: "Solid" });
    expect(solidLayer.source).toMatchObject({ width: 1920, height: 1080 });
    expect(((solidLayer.source as FootageItem).mainSource as SolidSource).color.map((c) => Math.round(c * 255))).toEqual([11, 11, 15]);

    expect(h.callValidated("ae_add_layer", { kind: "adjustment" }).data).toMatchObject({ type: "adjustment", name: "Adjustment Layer" });
    const nullLayer = h.callValidated("ae_add_layer", {
      kind: "null",
      name: "Rig",
      parent: solidLayer.id,
      position: [100, 200],
      scale: 50,
      rotation: 15,
      opacity: 80,
      label: 4,
    });
    const rig = comp.layer(1);
    expect(nullLayer.data).toMatchObject({ type: "null", name: "Rig" });
    expect(rig.parent?.name).toBe("Solid");
    expect(rig.position.value).toEqual([100, 200, 0]);
    expect(rig.scale.value).toEqual([50, 50, 50]);
    expect(rig.rotation.value).toBe(15);
    expect(rig.opacity.value).toBe(80);
    expect(rig.label).toBe(4);
    h.callValidated("ae_add_layer", { kind: "solid", blend_mode: "screen", three_d: true });
    expect(comp.layer(1)).toMatchObject({ blendingMode: BlendingMode.SCREEN, threeDLayer: true });
  });

  test("shape: rect with roundness, stroke over fill, TASTE accent fill by default", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    h.callValidated("ae_add_layer", { kind: "shape", size: [400, 200], roundness: 24, stroke: "#FFFFFF" });
    const shape = comp.layer(1) as ShapeLayer;
    const group = (shape.property("ADBE Root Vectors Group") as PropertyGroup).property(1) as PropertyGroup;
    const contents = group.property("ADBE Vectors Group") as PropertyGroup;
    expect(contents.children.map((child) => child.matchName)).toEqual(["ADBE Vector Shape - Rect", "ADBE Vector Graphic - Stroke", "ADBE Vector Graphic - Fill"]);
    const rect = contents.property(1) as PropertyGroup;
    expect((rect.property("ADBE Vector Rect Size") as Property).value).toEqual([400, 200]);
    expect((rect.property("ADBE Vector Rect Roundness") as Property).value).toBe(24);
    const fill = contents.property(3) as PropertyGroup;
    expect(Array.from((fill.property("ADBE Vector Fill Color") as Property).value as number[], (c) => Math.round(c * 255))).toEqual([255, 90, 54, 255]);
    const stroke = contents.property(2) as PropertyGroup;
    expect((stroke.property("ADBE Vector Stroke Width") as Property).value).toBe(4);
  });

  test("camera and light (point by default)", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    expect(h.callValidated("ae_add_layer", { kind: "camera" }).data).toMatchObject({ type: "camera", name: "Camera 1" });
    expect(h.callValidated("ae_add_layer", { kind: "light", name: "Key" }).data).toMatchObject({ type: "light", name: "Key" });
    expect((comp.layer(1) as LightLayer).lightType).toBe(LightType.POINT);
  });

  test("refusals before any change", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    expect(h.callValidated("ae_add_layer", { kind: "footage" })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(h.callValidated("ae_add_layer", { kind: "footage", item: comp.id })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(h.callValidated("ae_add_layer", { kind: "null", path: h.file("x.mov") })).toMatchObject({ status: "refused" });
    expect(h.callValidated("ae_add_layer", { kind: "camera", blend_mode: "add" })).toMatchObject({ status: "refused" });
    // Solids take 4-30000 px (LayerCollection.addSolid), and the colour is checked before anything is added.
    expect(() => h.callValidated("ae_add_layer", { kind: "solid", width: 2 })).toThrow(/catalog schema refused/);
    expect(h.call("ae_add_layer", { kind: "solid", width: 2 })).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "INVALID_ARGUMENT" } });
    expect(h.call("ae_add_layer", { kind: "solid", height: 40000 })).toMatchObject({ status: "refused", undoSteps: 0 });
    expect(h.call("ae_add_layer", { kind: "solid", color: "teal-ish" })).toMatchObject({ status: "refused", undoSteps: 0 });
    expect(comp.numLayers).toBe(0);
    expect(h.mock.state.undoDepth).toBe(0);
  });
});

describe("ae_set_layer", () => {
  test("timing, switches, blend mode, parent, label and quality in one step; unchanged when equal", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const parent = comp.layers.addNull();
    const layer = comp.layers.addSolid([1, 0, 0], "Red", 1920, 1080, 1);
    const receipt = h.callValidated("ae_set_layer", {
      layer: layer.id,
      name: "Red BG",
      start: 0.5,
      in_point: 1,
      out_point: 4,
      shy: true,
      motion_blur: true,
      blend_mode: "multiply",
      parent: parent.id,
      label: 9,
      quality: "draft",
    });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(layer).toMatchObject({ name: "Red BG", startTime: 0.5, inPoint: 1, outPoint: 4, shy: true, motionBlur: true, label: 9 });
    expect(layer.blendingMode).toBe(BlendingMode.MULTIPLY);
    expect(layer.parent?.name).toBe("Null 1");
    expect(h.callValidated("ae_set_layer", { layer: layer.id, shy: true, label: 9 })).toMatchObject({ status: "unchanged", undoSteps: 0 });
    expect(h.callValidated("ae_set_layer", { layer: layer.id, parent: null }).data.changed).toEqual(["no parent"]);
    expect(layer.parent).toBeNull();
  });

  test("a locked layer: refused unless unlocked in the same call", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const layer = comp.layers.addNull();
    layer.locked = true;
    expect(h.callValidated("ae_set_layer", { layer: layer.id, name: "X" })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(h.callValidated("ae_set_layer", { layer: layer.id, name: "X", locked: false }).data.changed).toEqual(["unlocked", "name \"X\""]);
    expect(layer).toMatchObject({ name: "X", locked: false });
  });

  test("track matte: After Effects 2023+ takes any matte layer; before 2023 only the layer above", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const fill = comp.layers.addSolid([1, 0, 0], "Fill", 100, 100, 1);
    comp.layers.addNull();
    const matte = comp.layers.addText("Matte");
    h.callValidated("ae_set_layer", { layer: fill.id, track_matte: { type: "alpha", layer: matte.id } });
    expect(fill.trackMatteType).toBe(TrackMatteType.ALPHA);
    expect(fill.trackMatteLayer?.name).toBe("Matte");

    const old = aeHarness({ version: "22.6x5" });
    const oldComp = old.mock.addComp();
    const oldFill = oldComp.layers.addSolid([1, 0, 0], "Fill", 100, 100, 1);
    oldComp.layers.addNull();
    const oldMatte = oldComp.layers.addText("Matte");
    expect(old.callValidated("ae_set_layer", { layer: oldFill.id, track_matte: { type: "luma", layer: oldMatte.id } })).toMatchObject({
      status: "refused",
      error: { code: "UNSUPPORTED" },
    });
    expect(old.callValidated("ae_set_layer", { layer: oldFill.id, track_matte: { type: "luma" } })).toMatchObject({ status: "applied" });
    expect(oldFill.trackMatteType).toBe(TrackMatteType.LUMA);
    expect(old.callValidated("ae_set_layer", { layer: oldFill.id, track_matte: { type: "luma" } })).toMatchObject({ status: "unchanged" });
    expect(old.callValidated("ae_set_layer", { layer: oldFill.id, track_matte: { type: "none" } })).toMatchObject({ status: "applied" });
    expect(oldFill.hasTrackMatte).toBe(false);
  });

  test("track matte none on After Effects 2023+ removes the matte (setTrackMatte with NO_TRACK_MATTE does nothing); the same matte again is unchanged", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const fill = comp.layers.addSolid([1, 0, 0], "Fill", 100, 100, 1);
    const matte = comp.layers.addText("Matte");
    expect(h.callValidated("ae_set_layer", { layer: fill.id, track_matte: { type: "alpha", layer: matte.id } }).data.changed).toEqual(['track matte alpha from "Matte"']);
    expect(h.callValidated("ae_set_layer", { layer: fill.id, track_matte: { type: "alpha", layer: matte.id } })).toMatchObject({ status: "unchanged", undoSteps: 0 });
    expect(h.callValidated("ae_set_layer", { layer: fill.id, track_matte: { type: "alpha" } })).toMatchObject({ status: "unchanged" });
    expect(h.callValidated("ae_set_layer", { layer: fill.id, track_matte: { type: "luma", layer: matte.id } }).data.changed).toEqual(['track matte luma from "Matte"']);
    const removed = h.callValidated("ae_set_layer", { layer: fill.id, track_matte: { type: "none" } });
    expect(removed).toMatchObject({ status: "applied", undoSteps: 1, data: { changed: ["no track matte"] } });
    expect(fill.hasTrackMatte).toBe(false);
    expect(fill.trackMatteLayer).toBeNull();
    expect(h.callValidated("ae_set_layer", { layer: fill.id, track_matte: { type: "none" } })).toMatchObject({ status: "unchanged" });
  });

  test("refuses switches a layer type does not have, and parent loops", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const camera = comp.layers.addCamera("Cam", [960, 540]);
    const a = comp.layers.addNull();
    const b = comp.layers.addNull();
    b.parent = a;
    expect(h.callValidated("ae_set_layer", { layer: camera.id, motion_blur: true })).toMatchObject({ status: "refused" });
    expect(h.callValidated("ae_set_layer", { layer: a.id, parent: b.id })).toMatchObject({ status: "refused", error: { message: expect.stringContaining("loop") } });
    expect(h.callValidated("ae_set_layer", { layer: a.id, collapse: true })).toMatchObject({ status: "refused", error: { code: "UNSUPPORTED" } });
  });
});

describe("ae_arrange_layers", () => {
  function stack() {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const d = comp.layers.addNull();
    d.name = "D";
    const c = comp.layers.addNull();
    c.name = "C";
    const b = comp.layers.addNull();
    b.name = "B";
    const a = comp.layers.addNull();
    a.name = "A";
    const names = () => comp.layerList.map((layer) => layer.name).join("");
    return { h, comp, a, b, c, d, names };
  }

  test("move to top, bottom, an index, before and after a layer", () => {
    const { h, a, b, d, names } = stack();
    expect(names()).toBe("ABCD");
    h.callValidated("ae_arrange_layers", { layer: d.id, action: "move", to: "top" });
    expect(names()).toBe("DABC");
    h.callValidated("ae_arrange_layers", { layer: d.id, action: "move", to: "bottom" });
    expect(names()).toBe("ABCD");
    expect(h.callValidated("ae_arrange_layers", { layer: a.id, action: "move", to: { index: 3 } }).data).toMatchObject({ layer_index: 3, from_index: 1 });
    expect(names()).toBe("BCAD");
    h.callValidated("ae_arrange_layers", { layer: d.id, action: "move", to: { before: b.id } });
    expect(names()).toBe("DBCA");
    h.callValidated("ae_arrange_layers", { layer: d.id, action: "move", to: { after: a.id } });
    expect(names()).toBe("BCAD");
    expect(h.callValidated("ae_arrange_layers", { layer: d.id, action: "move", to: "bottom" })).toMatchObject({ status: "unchanged" });
  });

  test("duplicate copies keyframes and goes above; split cuts at a time; delete unparents children", () => {
    const { h, comp, a, b, names } = stack();
    a.opacity.setValueAtTime(0, 0);
    a.opacity.setValueAtTime(1, 100);
    const dup = h.callValidated("ae_arrange_layers", { layer: a.id, action: "duplicate", name: "A copy" });
    expect(dup.data).toMatchObject({ name: "A copy", layer_index: 1, original: { layer_index: 2 } });
    expect(comp.layer(1).opacity.numKeys).toBe(2);
    expect(comp.layer(1).id).not.toBe(a.id);

    const split = h.callValidated("ae_arrange_layers", { layer: b.id, action: "split", time: 4 });
    expect(split.data).toMatchObject({ time: 4, first: { name: "B" }, second: { name: "B" } });
    expect(b.outPoint).toBe(4);
    const second = comp.layerList.find((layer) => layer.name === "B" && layer.inPoint === 4);
    expect(second).toBeDefined();

    comp.layer(1).parent = a;
    const deleted = h.callValidated("ae_arrange_layers", { layer: a.id, action: "delete" });
    expect(deleted).toMatchObject({ status: "applied", data: { name: "A" } });
    expect(deleted.warnings[0]).toContain("Unparented A copy");
    expect(names()).toBe("A copyBBCD");
  });

  test("refusals: move without `to`, split outside the layer, delete a locked layer", () => {
    const { h, a, b } = stack();
    expect(h.callValidated("ae_arrange_layers", { layer: a.id, action: "move" })).toMatchObject({ status: "refused" });
    b.outPoint = 3;
    expect(h.callValidated("ae_arrange_layers", { layer: b.id, action: "split", time: 5 })).toMatchObject({ status: "refused" });
    a.locked = true;
    expect(h.callValidated("ae_arrange_layers", { layer: a.id, action: "delete" })).toMatchObject({ status: "refused" });
    expect(h.mock.state.undoDepth).toBe(0);
  });
});
