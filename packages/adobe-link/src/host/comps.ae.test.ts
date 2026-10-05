import { describe, expect, test } from "vitest";
import type { CompItem, MarkerValue } from "../testing/ae-mock.js";
import { aeHarness } from "../testing/ae-harness.js";

describe("ae_create_comp", () => {
  test("TASTE defaults: 1080p, 30 fps, 10 s, ink background, opened, one undo step", () => {
    const h = aeHarness();
    const receipt = h.callValidated("ae_create_comp");
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(receipt.data).toMatchObject({ name: "Zenvi Comp", width: 1920, height: 1080, fps: 30, duration: 10, bg_color: "#0B0B0F", opened: true });
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Create comp"]);
    const comp = h.mock.project.activeItem as CompItem;
    expect(comp.openedInViewer).toBe(1);
  });

  test.each([
    ["vertical", 1080, 1920],
    ["square", 1080, 1080],
    ["4k", 3840, 2160],
    ["720p", 1280, 720],
  ])("preset %s is %ix%i", (preset, width, height) => {
    const h = aeHarness();
    expect(h.callValidated("ae_create_comp", { preset, name: "P" }).data).toMatchObject({ width, height });
  });

  test("explicit size, NTSC rate, folder, unique name", () => {
    const h = aeHarness();
    h.mock.addComp({ name: "Promo", active: false });
    const receipt = h.callValidated("ae_create_comp", { name: "Promo", width: 1000, height: 500, fps: 29.97, duration: 5, background: "#FF5A36", folder: "Comps", open: false });
    expect(receipt.data).toMatchObject({ name: "Promo 2", width: 1000, height: 500, fps: 29.97, bg_color: "#FF5A36", folder: { name: "Comps" }, opened: false });
    expect(receipt.warnings).toContain('A comp is already named "Promo"; named this one "Promo 2"');
  });

  test("refuses half a size before creating anything", () => {
    const h = aeHarness();
    const receipt = h.call("ae_create_comp", { width: 1000 });
    expect(receipt).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "INVALID_ARGUMENT" } });
    expect(h.mock.project.numItems).toBe(0);
    expect(h.mock.state.undoDepth).toBe(0);
  });
});

describe("ae_set_comp", () => {
  test("changes only what differs, in one undo step", () => {
    const h = aeHarness();
    const comp = h.mock.addComp({ name: "Main" });
    const receipt = h.callValidated("ae_set_comp", {
      name: "Main v2",
      duration: 12,
      work_area: { start: 1, end: 6 },
      motion_blur: true,
      shutter_angle: 90,
      background: [1, 1, 1],
    });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(comp).toMatchObject({ name: "Main v2", duration: 12, workAreaStart: 1, workAreaDuration: 5, motionBlur: true, shutterAngle: 90, bgColor: [1, 1, 1] });
    expect(receipt.data.changed).toEqual(["name \"Main v2\"", "duration 12 s", "background #FFFFFF", "work area 1-6 s", "motion blur on", "shutter angle 90"]);
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Change comp settings"]);
  });

  test("unchanged when nothing differs; refuses a work area past the end", () => {
    const h = aeHarness();
    h.mock.addComp({ name: "Main", duration: 10 });
    expect(h.callValidated("ae_set_comp", { name: "Main", duration: 10 })).toMatchObject({ status: "unchanged", undoSteps: 0 });
    expect(h.callValidated("ae_set_comp", { work_area: { start: 2, end: 11 } })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
  });
});

describe("ae_precompose", () => {
  test("moves layers into a new comp and returns the precomp layer", () => {
    const h = aeHarness();
    const comp = h.mock.addComp({ name: "Main" });
    const a = comp.layers.addSolid([1, 0, 0], "A", 100, 100, 1);
    const b = comp.layers.addSolid([0, 1, 0], "B", 100, 100, 1);
    comp.layers.addNull();
    const receipt = h.callValidated("ae_precompose", { layers: [a.id, b.id] });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { comp_name: "B Comp", moved_layers: 2 } });
    expect(receipt.data.precomp_layer).toMatchObject({ layer_index: 2, type: "precomp" });
    expect(comp.numLayers).toBe(2);
  });

  test("refuses move_all_attributes: false with several layers", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    comp.layers.addNull();
    comp.layers.addNull();
    expect(h.callValidated("ae_precompose", { layers: [{ index: 1 }, { index: 2 }], move_all_attributes: false })).toMatchObject({
      status: "refused",
      error: { code: "INVALID_ARGUMENT" },
    });
  });
});

describe("ae_add_marker", () => {
  test("comp marker at the current time; layer marker with duration, chapter and label", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    comp.time = 2.5;
    const layer = comp.layers.addNull();
    expect(h.callValidated("ae_add_marker", { comment: "Drop" })).toMatchObject({ status: "applied", data: { time: 2.5, comment: "Drop", layer: null } });
    expect((comp.markerProperty.keyValue(1) as MarkerValue).comment).toBe("Drop");

    const onLayer = h.callValidated("ae_add_marker", { layer: layer.id, time: 1, comment: "Hit", duration: 0.5, chapter: "Intro", label: 3 });
    expect(onLayer.data.layer).toMatchObject({ layer_id: layer.id });
    const marker = layer.marker.keyValue(1) as MarkerValue;
    expect(marker).toMatchObject({ comment: "Hit", duration: 0.5, chapter: "Intro", label: 3 });
  });

  test("replacing a marker warns; protected_region on a layer is refused", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const layer = comp.layers.addNull();
    h.callValidated("ae_add_marker", { time: 1, comment: "One" });
    expect(h.callValidated("ae_add_marker", { time: 1, comment: "Two" }).warnings).toEqual(["Replaced the marker that was at 1 s"]);
    expect(h.callValidated("ae_add_marker", { layer: layer.id, protected_region: true })).toMatchObject({ status: "refused" });
  });
});
