import { describe, expect, test } from "vitest";
import { ImportOptions, MarkerValue, type FootageItem, type Property, type PropertyGroup } from "../testing/ae-mock.js";
import { aeHarness } from "../testing/ae-harness.js";

function footage(h: ReturnType<typeof aeHarness>, name: string): FootageItem {
  return h.mock.project.importFile(new ImportOptions(new h.mock.es.File(h.file(name)))) as FootageItem;
}

describe("ae_list_items", () => {
  test("lists items with type, size and parent folder; filters by type and name; refuses an unknown type", () => {
    const h = aeHarness();
    const comp = h.mock.addComp({ name: "Promo" });
    const folder = h.mock.project.items.addFolder("Media");
    const clip = footage(h, "beach.mov");
    clip.parentFolder = folder;
    comp.layers.addSolid([1, 0, 0], "Red", 100, 100, 1);

    const all = h.callValidated("ae_list_items");
    expect(all.status).toBe("ok");
    expect(all.data.total).toBe(5);
    expect(all.summary).toMatch(/^5 items \(/);
    const items = all.data.items as Record<string, unknown>[];
    expect(items.find((item) => item.name === "beach.mov")).toMatchObject({ type: "footage", parent_folder: { id: folder.id, name: "Media" }, has_video: true });
    expect(items.find((item) => item.name === "Promo")).toMatchObject({ type: "comp", width: 1920, height: 1080, fps: 30, num_layers: 1, parent_folder: null });
    expect(items.find((item) => item.name === "Red")).toMatchObject({ type: "solid", color: "#FF0000" });

    expect(h.callValidated("ae_list_items", { type: "comp" }).data.items).toHaveLength(1);
    expect(h.callValidated("ae_list_items", { name_contains: "BEACH" }).data.total).toBe(1);
    const limited = h.callValidated("ae_list_items", { limit: 2 });
    expect(limited.data).toMatchObject({ total: 5, truncated: true });
    expect(limited.warnings[0]).toContain("first 2 of 5");

    const refused = h.call("ae_list_items", { type: "camera" });
    expect(refused).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(h.mock.state.undoCalls).toEqual([]);
  });
});

describe("ae_get_comp", () => {
  test("settings, markers and layers with switches, parent, effects and animated paths", () => {
    const h = aeHarness();
    const comp = h.mock.addComp({ name: "Main", duration: 8 });
    const bg = comp.layers.addSolid([0, 0, 0], "BG", 1920, 1080, 1);
    const title = comp.layers.addText("Hello");
    title.parent = bg;
    title.opacity.setValueAtTime(0, 0);
    title.opacity.setValueAtTime(0.6, 100);
    (bg.property("ADBE Effect Parade") as PropertyGroup).addProperty("ADBE Gaussian Blur 2");
    comp.markerProperty.setValueAtTime(2, new MarkerValue("Beat"));

    const receipt = h.callValidated("ae_get_comp");
    expect(receipt.status).toBe("ok");
    expect(receipt.summary).toBe(`Comp "Main" (id ${comp.id}): 1920x1080, 30 fps, 8 s, 2 layers`);
    expect(receipt.data.comp).toMatchObject({ comp_id: comp.id, name: "Main", motion_blur: false, frame_blending: false, resolution_factor: [1, 1] });
    expect(receipt.data.markers).toEqual([{ time: 2, comment: "Beat", duration: 0, chapter: null, label: 0 }]);
    const layers = receipt.data.layers as Record<string, unknown>[];
    expect(layers[0]).toMatchObject({
      layer_id: title.id,
      layer_index: 1,
      type: "text",
      parent: { layer_id: bg.id, index: 2, name: "BG" },
      animated: ["Transform/Opacity"],
      blend_mode: "normal",
      quality: "best",
    });
    expect(layers[1]).toMatchObject({ name: "BG", type: "solid", source: { type: "solid" }, effects: [{ index: 1, name: "Gaussian Blur", match_name: "ADBE Gaussian Blur 2", enabled: true }] });
  });

  test("refuses when no comp is active", () => {
    const h = aeHarness();
    expect(h.callValidated("ae_get_comp")).toMatchObject({ status: "refused", error: { code: "NO_ACTIVE_COMP" } });
  });
});

describe("ae_get_layer", () => {
  test("transform at a time, keyframes with ease, effects with params, text document, masks, expressions", () => {
    const h = aeHarness();
    const comp = h.mock.addComp({ name: "Main" });
    const text = comp.layers.addText("Launch day");
    text.position.setValueAtTime(0, [960, 600, 0]);
    text.position.setValueAtTime(1, [960, 540, 0]);
    text.rotation.expression = "time * 10";
    const blur = (text.property("ADBE Effect Parade") as PropertyGroup).addProperty("ADBE Gaussian Blur 2") as PropertyGroup;
    (blur.property("Blurriness") as Property).setValue(12);
    (text.property("ADBE Mask Parade") as PropertyGroup).addProperty("ADBE Mask Atom");

    const receipt = h.callValidated("ae_get_layer", { layer: text.id, time: 0.5 });
    expect(receipt.status).toBe("ok");
    expect(receipt.data.transform).toMatchObject({ Position: [960, 570, 0], Opacity: 100 });
    expect(receipt.data.keyframes).toEqual([
      expect.objectContaining({
        path: "Transform/Position",
        match_name: "ADBE Position",
        num_keys: 2,
        keys: [
          expect.objectContaining({ time: 0, value: [960, 600, 0], in: { type: "linear", ease: [{ speed: 0, influence: 16.667 }] } }),
          expect.objectContaining({ time: 1, value: [960, 540, 0] }),
        ],
      }),
    ]);
    expect(receipt.data.expressions).toEqual([{ path: "Transform/Rotation", expression: "time * 10", enabled: true, error: null }]);
    expect(receipt.data.effects).toEqual([
      expect.objectContaining({ name: "Gaussian Blur", params: expect.arrayContaining([expect.objectContaining({ name: "Blurriness", value: 12, keyframes: 0 })]) }),
    ]);
    expect(receipt.data.text).toMatchObject({ text: "Launch day", font: "ArialMT", size: 36, fill: "#FFFFFF", stroke: null });
    expect(receipt.data.masks).toEqual([expect.objectContaining({ index: 1, name: "Mask 1", mode: "add", inverted: false, vertices: 0 })]);
  });

  test("refuses a missing layer", () => {
    const h = aeHarness();
    h.mock.addComp();
    expect(h.callValidated("ae_get_layer", { layer: "Ghost" })).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
  });
});

describe("ae_list_effects", () => {
  test("searches display name, match name and category; filters by category; refuses a bad limit", () => {
    const h = aeHarness();
    const blur = h.callValidated("ae_list_effects", { search: "blur" });
    expect(blur.data.effects).toEqual([{ display_name: "Gaussian Blur", match_name: "ADBE Gaussian Blur 2", category: "Blur & Sharpen", version: "1.0" }]);
    expect(h.callValidated("ae_list_effects", { category: "color correction" }).data.total).toBe(2);
    expect(h.callValidated("ae_list_effects").data.total).toBeGreaterThan(5);
    expect(h.call("ae_list_effects", { limit: 0 })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
  });
});
