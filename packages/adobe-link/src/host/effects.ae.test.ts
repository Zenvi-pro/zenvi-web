import { describe, expect, test } from "vitest";
import { MaskMode, type AVLayer, type MaskPropertyGroup, type Property, type PropertyGroup, type Shape } from "../testing/ae-mock.js";
import { aeHarness } from "../testing/ae-harness.js";

function setup() {
  const h = aeHarness();
  const comp = h.mock.addComp({ name: "Main" });
  const layer = comp.layers.addSolid([1, 0, 0], "Red", 400, 400, 1);
  return { h, comp, layer };
}

function effects(layer: AVLayer): PropertyGroup {
  return layer.property("ADBE Effect Parade") as PropertyGroup;
}

function param(effect: PropertyGroup, name: string): number {
  return (effect.property(name) as Property).value as number;
}

describe("ae_apply_effect", () => {
  test("fuzzy display name, params and eased keyframes in one undo step", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_apply_effect", {
      layer: layer.id,
      effect: "gaussian",
      name: "Soft",
      params: [{ param: "Repeat Edge Pixels", value: true }],
      keyframes: [{ param: "blurriness", keyframes: [{ time: 0, value: 20 }, { time: 1, value: 0 }] }],
    });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(receipt.data).toMatchObject({ effect: { index: 1, name: "Soft", match_name: "ADBE Gaussian Blur 2" }, params: [{ param: "Repeat Edge Pixels", value: 1 }] });
    const blur = effects(layer).property(1) as PropertyGroup;
    expect((blur.property("Blurriness") as Property).keys.map((key) => [key.time, key.value])).toEqual([[0, 20], [1, 0]]);
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Apply effect"]);
  });

  test("match names and colours; Lumetri's repeated names by section", () => {
    const { h, layer } = setup();
    h.callValidated("ae_apply_effect", { layer: layer.id, effect: "ADBE Fill", params: [{ param: "Color", value: "#FF5A36" }] });
    const fill = effects(layer).property(1) as PropertyGroup;
    expect(Array.from((fill.property("Color") as Property).value as number[], (c) => Math.round(c * 255))).toEqual([255, 90, 54, 255]);
    h.callValidated("ae_apply_effect", { layer: layer.id, effect: "Lumetri Color", params: [{ param: "Creative/Saturation", value: 120 }, { param: "Basic Correction/Saturation", value: 80 }] });
    const lumetri = effects(layer).property(2) as PropertyGroup;
    const saturations = lumetri.children.filter((child) => child.name === "Saturation").map((child) => (child as Property).value);
    expect(saturations).toEqual([80, 120]);
  });

  test("an ambiguous or unknown effect is refused before anything is added", () => {
    const { h, layer } = setup();
    h.mock.registerEffect({ displayName: "Fast Box Blur", matchName: "ADBE Box Blur2", category: "Blur & Sharpen", params: [] });
    const ambiguous = h.callValidated("ae_apply_effect", { layer: layer.id, effect: "blur" });
    expect(ambiguous).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(ambiguous.summary).toContain("Gaussian Blur (ADBE Gaussian Blur 2), Fast Box Blur (ADBE Box Blur2)");
    expect(h.callValidated("ae_apply_effect", { layer: layer.id, effect: "Glowify" })).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    expect(effects(layer).numProperties).toBe(0);
    expect(h.mock.state.undoDepth).toBe(0);
  });

  test("a bad parameter takes the effect off again", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_apply_effect", { layer: layer.id, effect: "Gaussian Blur", params: [{ param: "Glow", value: 3 }] });
    expect(receipt).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    expect(receipt.summary).toContain("it has: Blurriness, Blur Dimensions, Repeat Edge Pixels");
    expect(effects(layer).numProperties).toBe(0);
    expect(receipt.warnings.join(" ")).toContain("Undo");
  });
});

describe("ae_set_effect", () => {
  test("params, switch and name; unchanged when equal; remove", () => {
    const { h, layer } = setup();
    effects(layer).addProperty("ADBE Gaussian Blur 2");
    const changed = h.callValidated("ae_set_effect", { layer: layer.id, effect: 1, params: [{ param: "Blurriness", value: 8 }], enabled: false, name: "Haze" });
    expect(changed).toMatchObject({ status: "applied", data: { changed: ["Blurriness", "turned off", 'renamed "Haze"'] } });
    const blur = effects(layer).property(1) as PropertyGroup;
    expect(param(blur, "Blurriness")).toBe(8);
    expect(blur).toMatchObject({ enabled: false, name: "Haze" });
    expect(h.callValidated("ae_set_effect", { layer: layer.id, effect: "haze", params: [{ param: "Blurriness", value: 8 }] })).toMatchObject({ status: "unchanged" });
    expect(h.callValidated("ae_set_effect", { layer: layer.id, effect: "ADBE Gaussian Blur 2", remove: true })).toMatchObject({ status: "applied", data: { removed: true } });
    expect(effects(layer).numProperties).toBe(0);
  });

  test("refuses keyframed params, a missing effect and remove mixed with changes", () => {
    const { h, layer } = setup();
    const blur = effects(layer).addProperty("ADBE Gaussian Blur 2") as PropertyGroup;
    (blur.property("Blurriness") as Property).setValueAtTime(0, 3);
    expect(h.callValidated("ae_set_effect", { layer: layer.id, effect: 1, params: [{ param: "Blurriness", value: 1 }] }).error?.message).toContain("is keyframed");
    expect(h.callValidated("ae_set_effect", { layer: layer.id, effect: "Glow" })).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    expect(h.callValidated("ae_set_effect", { layer: layer.id, effect: 1, remove: true, enabled: false })).toMatchObject({ status: "refused" });
  });
});

describe("ae_apply_look", () => {
  function lookLayer(comp: { layerList: unknown[] }) {
    return (comp.layerList as AVLayer[]).filter((layer) => layer.comment === "zenvi:look");
  }

  test("warm-film at the TASTE default strength 0.6 on one adjustment layer over the whole comp", () => {
    const { h, comp } = setup();
    const receipt = h.callValidated("ae_apply_look", { look: "warm-film" });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { look: "warm-film", strength: 0.6, created_layer: true } });
    expect(receipt.data.values).toEqual([
      { param: "Basic Correction/Temperature", value: 4.8 },
      { param: "Basic Correction/Tint", value: 1.2 },
      { param: "Creative/Faded Film", value: 4.8 },
      { param: "Basic Correction/Saturation", value: 96.4 },
    ]);
    const [adjustment] = lookLayer(comp);
    expect(adjustment).toMatchObject({ name: "Zenvi Look (warm-film)", adjustmentLayer: true, inPoint: 0, outPoint: 10, index: 1 });
  });

  test("trying another look reuses the layer; moody, clean and bw-contrast values; bw stays black and white at any strength", () => {
    const { h, comp } = setup();
    h.callValidated("ae_apply_look", { look: "moody" });
    const moody = h.callValidated("ae_apply_look", { look: "moody", strength: 1 });
    expect(moody.data.values).toEqual([
      { param: "Basic Correction/Exposure", value: -0.3 },
      { param: "Basic Correction/Contrast", value: 12 },
      { param: "Basic Correction/Saturation", value: 85 },
      { param: "Vignette/Amount", value: -0.8 },
    ]);
    expect(h.callValidated("ae_apply_look", { look: "clean" }).data.values).toEqual([
      { param: "Basic Correction/Contrast", value: 3 },
      { param: "Creative/Vibrance", value: 3 },
    ]);
    expect(h.callValidated("ae_apply_look", { look: "bw-contrast", strength: 0.5 }).data.values).toEqual([
      { param: "Basic Correction/Saturation", value: 0 },
      { param: "Basic Correction/Contrast", value: 12.5 },
    ]);
    const layers = lookLayer(comp);
    expect(layers).toHaveLength(1);
    expect(effects(layers[0] as AVLayer).children.map((child) => child.name)).toEqual(["Zenvi Look"]);
  });

  test("teal-orange splits the tone with Color Balance; a given layer is graded directly", () => {
    const { h, comp, layer } = setup();
    const receipt = h.callValidated("ae_apply_look", { look: "teal-orange", layer: layer.id });
    expect(receipt.data).toMatchObject({ created_layer: false });
    expect(receipt.data.values).toEqual([
      { param: "Basic Correction/Saturation", value: 103.6 },
      { param: "Zenvi Split Tone/Shadow Red Balance", value: -12 },
      { param: "Zenvi Split Tone/Shadow Green Balance", value: 3.6 },
      { param: "Zenvi Split Tone/Shadow Blue Balance", value: 12 },
      { param: "Zenvi Split Tone/Highlight Red Balance", value: 12 },
      { param: "Zenvi Split Tone/Highlight Green Balance", value: 3.6 },
      { param: "Zenvi Split Tone/Highlight Blue Balance", value: -12 },
    ]);
    expect(param(effects(layer).property("Zenvi Split Tone") as PropertyGroup, "Preserve Luminosity")).toBe(1);
    expect(lookLayer(comp)).toHaveLength(0);
  });

  test("a non-English After Effects (no English Lumetri names) is refused and the look taken off again", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    // This mock only: a copy of Lumetri whose parameters have other names.
    const index = h.mock.state.effects.findIndex((fx) => fx.matchName === "ADBE Lumetri");
    const lumetri = h.mock.state.effects[index] as (typeof h.mock.state.effects)[number];
    h.mock.state.effects[index] = { ...lumetri, params: lumetri.params.map((param) => ({ ...param, name: `${param.name} (de)` })) };
    const receipt = h.callValidated("ae_apply_look", { look: "clean" });
    expect(receipt).toMatchObject({ status: "refused", error: { code: "UNSUPPORTED" } });
    expect(receipt.summary).toContain("ae_apply_effect and match names");
    expect(comp.numLayers).toBe(0);
  });

  test("refuses when Lumetri is not installed", () => {
    const h = aeHarness();
    h.mock.addComp();
    h.mock.state.effects.splice(h.mock.state.effects.findIndex((fx) => fx.matchName === "ADBE Lumetri"), 1);
    expect(h.callValidated("ae_apply_look", { look: "clean" })).toMatchObject({ status: "refused", error: { code: "UNSUPPORTED" } });
    expect(h.mock.state.undoDepth).toBe(0);
  });
});

describe("ae_add_mask", () => {
  function mask(layer: AVLayer, index = 1): MaskPropertyGroup {
    return (layer.property("ADBE Mask Parade") as PropertyGroup).property(index) as MaskPropertyGroup;
  }

  test("a rect over the whole layer by default; feather, expansion, opacity, mode and inversion", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_add_mask", { layer: layer.id, feather: 30, expansion: -10, opacity: 80, mode: "subtract", inverted: true, name: "Vignette" });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { mask: { index: 1, name: "Vignette", vertices: 4, path: "Masks/Vignette" } } });
    const m = mask(layer);
    expect(m).toMatchObject({ maskMode: MaskMode.SUBTRACT, inverted: true });
    const shape = (m.property("ADBE Mask Shape") as Property).value as Shape;
    expect(Array.from(shape.vertices, (v) => Array.from(v))).toEqual([[0, 0], [400, 0], [400, 400], [0, 400]]);
    expect(Array.from((m.property("ADBE Mask Feather") as Property).value as number[])).toEqual([30, 30]);
    expect((m.property("ADBE Mask Offset") as Property).value).toBe(-10);
    expect((m.property("ADBE Mask Opacity") as Property).value).toBe(80);
  });

  test("an ellipse is four Bezier vertices; a reveal animates expansion with the out easing", () => {
    const { h, layer } = setup();
    h.callValidated("ae_add_mask", { layer: layer.id, shape: "ellipse", bounds: { left: 0, top: 0, width: 200, height: 100 }, animate: { property: "expansion", from: -200 } });
    const m = mask(layer);
    const shape = (m.property("ADBE Mask Shape") as Property).value as Shape;
    expect(Array.from(shape.vertices, (v) => Array.from(v))).toEqual([[100, 0], [200, 50], [100, 100], [0, 50]]);
    expect(Math.round((Array.from(shape.outTangents[0] as number[])[0] as number) * 1000) / 1000).toBe(55.228);
    const expansion = m.property("ADBE Mask Offset") as Property;
    expect(expansion.keys.map((key) => [Math.round(key.time * 1000) / 1000, key.value])).toEqual([[0, -200], [0.6, 0]]);
    expect(Math.round((expansion.key(1).outEase[0]?.influence ?? 0) * 1000) / 1000).toBe(16);
  });

  test("a free path; refusals for a missing path and layers without masks", () => {
    const { h, comp, layer } = setup();
    const receipt = h.callValidated("ae_add_mask", { layer: layer.id, shape: "path", path: { vertices: [[0, 0], [100, 0], [50, 80]], closed: true } });
    expect(receipt.data).toMatchObject({ mask: { vertices: 3 } });
    expect(h.callValidated("ae_add_mask", { layer: layer.id, shape: "path" })).toMatchObject({ status: "refused" });
    const camera = comp.layers.addCamera("Cam", [960, 540]);
    expect(h.callValidated("ae_add_mask", { layer: camera.id })).toMatchObject({ status: "refused", error: { code: "UNSUPPORTED" } });
  });
});
