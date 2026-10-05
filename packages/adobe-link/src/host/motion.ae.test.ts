import { describe, expect, test } from "vitest";
import type { AVLayer, CompItem, Property, PropertyGroup, TextLayer } from "../testing/ae-mock.js";
import { aeHarness } from "../testing/ae-harness.js";

const r = (value: number) => Math.round(value * 1000) / 1000 || 0;
const keys = (property: Property) => property.keys.map((key) => [r(key.time), Array.isArray(key.value) ? Array.from(key.value as number[], r) : r(key.value as number)]);

function setup(text?: string) {
  const h = aeHarness();
  const comp = h.mock.addComp({ name: "Main" });
  const layer = text !== undefined ? comp.layers.addText(text) : comp.layers.addSolid([1, 0, 0], "Red", 400, 400, 1);
  return { h, comp, layer };
}

function animator(layer: TextLayer, name: string): PropertyGroup {
  const animators = (layer.property("ADBE Text Properties") as PropertyGroup).property("ADBE Text Animators") as PropertyGroup;
  return animators.property(name) as PropertyGroup;
}

function selector(group: PropertyGroup): PropertyGroup {
  return (group.property("ADBE Text Selectors") as PropertyGroup).property(1) as PropertyGroup;
}

function advanced(group: PropertyGroup, matchName: string): number {
  return ((selector(group).property("ADBE Text Range Advanced") as PropertyGroup).property(matchName) as Property).value as number;
}

describe("ae_apply_motion_preset", () => {
  test("fade-in: TASTE entrance 0.6 s from the in point, eased out, one undo step", () => {
    const { h, layer } = setup();
    layer.inPoint = 1;
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "fade-in" });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { preset: "fade-in", start: 1, end: 1.6, duration: 0.6, properties: ["Transform/Opacity"] } });
    expect(keys(layer.opacity)).toEqual([[1, 0], [1.6, 100]]);
    expect(r(layer.opacity.key(1).outEase[0]?.influence as number)).toBe(16);
    expect(r(layer.opacity.key(1).outEase[0]?.speed as number)).toBe(1041.667);
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Apply motion preset"]);
  });

  test("fade-out: TASTE exit 0.4 s ending at the out point, eased in", () => {
    const { h, layer } = setup();
    layer.outPoint = 8;
    h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "fade-out" });
    expect(keys(layer.opacity)).toEqual([[7.6, 100], [8, 0]]);
    expect(r(layer.opacity.key(2).inEase[0]?.influence as number)).toBe(16);
  });

  test("slide-in travels 4 % of the frame width upwards with a fade; intensity spans 3-6 %", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "slide-in" });
    expect(receipt.data).toMatchObject({ distance: 76.8, direction: "up", properties: ["Transform/Position", "Transform/Opacity"] });
    expect(keys(layer.position)).toEqual([[0, [960, 616.8, 0]], [0.6, [960, 540, 0]]]);
    expect(keys(layer.opacity)).toEqual([[0, 0], [0.6, 100]]);

    const strong = setup();
    strong.h.callValidated("ae_apply_motion_preset", { layer: strong.layer.id, preset: "slide-in", intensity: 1, direction: "right" });
    expect(keys(strong.layer.position)[0]).toEqual([0, [844.8, 540, 0]]);
  });

  test("a layer running past the comp's end exits, and holds end, with the comp", () => {
    const { h, comp, layer } = setup();
    layer.outPoint = 14;
    h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "fade-out" });
    expect(keys(layer.opacity)).toEqual([[9.6, 100], [10, 0]]);
    h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "push-in" });
    expect(keys(layer.scale).map(([t]) => t)).toEqual([0, comp.duration]);
  });

  test("slide-out moves down and away, eased in, ending at the out point", () => {
    const { h, layer } = setup();
    h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "slide-out" });
    expect(keys(layer.position)).toEqual([[9.6, [960, 540, 0]], [10, [960, 616.8, 0]]]);
  });

  test("scale-pop: 92 % to 100 % in 8 frames with snap easing", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "scale-pop" });
    expect(receipt.data).toMatchObject({ scale_from: 92, end: 0.2667 });
    expect(keys(layer.scale)).toEqual([[0, [92, 92, 100]], [0.267, [100, 100, 100]]]);
    expect(layer.scale.key(2).inEase.map((e) => r(e.influence))).toEqual([100, 100, 100]);
  });

  test("blur-in adds a named Gaussian Blur with edge repeat, 3 % of the short side to 0", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "blur-in" });
    expect(receipt.data).toMatchObject({ effect: "Zenvi Blur In", blur: 32.4 });
    const blur = (layer.property("ADBE Effect Parade") as PropertyGroup).property("Zenvi Blur In") as PropertyGroup;
    expect(keys(blur.property("Blurriness") as Property)).toEqual([[0, 32.4], [0.6, 0]]);
    expect((blur.property("Repeat Edge Pixels") as Property).value).toBe(1);
    h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "blur-in" });
    expect((layer.property("ADBE Effect Parade") as PropertyGroup).numProperties).toBe(1);
  });

  test("whip-in: a quarter-frame push with snap easing and motion blur switched on", () => {
    const { h, comp, layer } = setup();
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "whip-in" });
    expect(receipt.data).toMatchObject({ distance: 480, direction: "right", motion_blur: true, end: 0.3667 });
    expect(keys(layer.position)[0]).toEqual([0, [480, 540, 0]]);
    expect(keys(layer.opacity)).toEqual([[0, 0], [0.133, 100]]);
    expect((layer as AVLayer).motionBlur).toBe(true);
    expect((comp as CompItem).motionBlur).toBe(true);
    expect(receipt.warnings).toContain('Turned on motion blur for comp "Main" so the whip blurs');
  });

  test("ken-burns scales 4 % and pans less than the overscan over the whole layer, in-out; push-in scales to 104 %", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "ken-burns" });
    expect(receipt.data).toMatchObject({ start: 0, end: 10, scale_to: 104, pan: 30.72, direction: "left" });
    expect(keys(layer.scale)).toEqual([[0, [100, 100, 100]], [10, [104, 104, 100]]]);
    expect(keys(layer.position)).toEqual([[0, [960, 540, 0]], [10, [929.28, 540, 0]]]);
    const push = setup();
    push.layer.outPoint = 4;
    push.h.callValidated("ae_apply_motion_preset", { layer: push.layer.id, preset: "push-in" });
    expect(keys(push.layer.scale)).toEqual([[0, [100, 100, 100]], [4, [104, 104, 100]]]);
  });

  test("drift is procedural: a marked, editable expression on Position", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "drift" });
    expect(receipt.data).toMatchObject({ expression: true, amplitude: 9.6 });
    expect(layer.position.expression.startsWith("// Zenvi drift")).toBe(true);
    expect(layer.position.expressionError).toBe("");
    h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "drift", intensity: 1 });
    expect(layer.position.expression).toContain("var a = 19.2;");
    layer.position.expression = "wiggle(2, 10)";
    expect(h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "drift" })).toMatchObject({ status: "refused" });
  });

  test("typewriter: a Range Selector animator, one character every 0.04 s, square and crisp", () => {
    const { h, layer } = setup("Hello world");
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "typewriter" });
    expect(receipt.data).toMatchObject({ animator: "Zenvi Typewriter", units: 10, start: 0, end: 0.4, stagger: 0.04 });
    const group = animator(layer as TextLayer, "Zenvi Typewriter");
    expect(((group.property("ADBE Text Animator Properties") as PropertyGroup).property("ADBE Text Opacity") as Property).value).toBe(0);
    expect(keys(selector(group).property("ADBE Text Percent Start") as Property)).toEqual([[0, 0], [0.4, 100]]);
    expect([advanced(group, "ADBE Text Range Type2"), advanced(group, "ADBE Text Range Shape"), advanced(group, "ADBE Text Selector Smoothness")]).toEqual([2, 1, 0]);
  });

  test("word-cascade with few words widens the stagger and says so; many words keep 0.06 s", () => {
    const { h, layer } = setup("Launch day is here");
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "word-cascade" });
    expect(receipt.data).toMatchObject({ animator: "Zenvi Word Cascade", units: 4, window: 100, stagger: 0.15, end: 1.2 });
    expect(receipt.warnings.join(" ")).toContain("4 words are too few for a 0.06 s stagger");
    const group = animator(layer as TextLayer, "Zenvi Word Cascade");
    const properties = group.property("ADBE Text Animator Properties") as PropertyGroup;
    expect(Array.from((properties.property("ADBE Text Position 3D") as Property).value as number[])).toEqual([0, 76.8, 0]);
    expect(keys(selector(group).property("ADBE Text Percent Offset") as Property)).toEqual([[0, -100], [1.2, 100]]);
    expect([advanced(group, "ADBE Text Range Type2"), advanced(group, "ADBE Text Range Shape"), advanced(group, "ADBE Text Levels Max Ease"), advanced(group, "ADBE Text Levels Min Ease")]).toEqual([3, 2, 50, 100]);

    const many = setup("one two three four five six seven eight nine ten eleven twelve");
    const twelve = many.h.callValidated("ae_apply_motion_preset", { layer: many.layer.id, preset: "word-cascade" });
    expect(twelve.data).toMatchObject({ units: 12, window: 83.33, stagger: 0.06, end: 1.3333 });
    expect(twelve.warnings).toEqual([]);
  });

  test("line-rise staggers lines by 0.12 s; a single line animates the animator's own values", () => {
    const { h, layer } = setup("First line\rSecond line\rThird line");
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "line-rise" });
    expect(receipt.data).toMatchObject({ animator: "Zenvi Line Rise", units: 3, stagger: 0.2 });
    expect(advanced(animator(layer as TextLayer, "Zenvi Line Rise"), "ADBE Text Range Type2")).toBe(4);

    const one = setup("Only line");
    const single = one.h.callValidated("ae_apply_motion_preset", { layer: one.layer.id, preset: "line-rise", start: 2 });
    expect(single.data).toMatchObject({ units: 1, stagger: 0, start: 2, end: 2.6 });
    const properties = animator(one.layer as TextLayer, "Zenvi Line Rise").property("ADBE Text Animator Properties") as PropertyGroup;
    expect(keys(properties.property("ADBE Text Opacity") as Property)).toEqual([[2, 0], [2.6, 100]]);
    expect(keys(properties.property("ADBE Text Position 3D") as Property)).toEqual([[2, [0, 76.8, 0]], [2.6, [0, 0, 0]]]);
  });

  test("re-applying a text preset replaces its animator instead of stacking", () => {
    const { h, layer } = setup("Hello world");
    h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "typewriter" });
    h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "typewriter", duration: 1 });
    const animators = (layer.property("ADBE Text Properties") as PropertyGroup).property("ADBE Text Animators") as PropertyGroup;
    expect(animators.numProperties).toBe(1);
  });

  test("separated position dimensions: only the moving axis is keyed", () => {
    const { h, layer } = setup();
    layer.position.dimensionsSeparated = true;
    const receipt = h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "slide-in" });
    expect(receipt.data.properties).toEqual(["Transform/Y Position", "Transform/Opacity"]);
    const y = (layer.property("ADBE Transform Group") as PropertyGroup).property("ADBE Position_1") as Property;
    expect(keys(y)).toEqual([[0, 616.8], [0.6, 540]]);
  });

  test("refusals: text presets need text, cameras have no opacity, intensity is 0-1", () => {
    const { h, comp, layer } = setup();
    const camera = comp.layers.addCamera("Cam", [960, 540]);
    expect(h.callValidated("ae_apply_motion_preset", { layer: layer.id, preset: "word-cascade" })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(h.callValidated("ae_apply_motion_preset", { layer: camera.id, preset: "fade-in" })).toMatchObject({ status: "refused" });
    expect(h.call("ae_apply_motion_preset", { layer: layer.id, preset: "fade-in", intensity: 2 })).toMatchObject({ status: "refused" });
    expect(h.call("ae_apply_motion_preset", { layer: layer.id, preset: "spin" })).toMatchObject({ status: "refused" });
    expect(h.mock.state.undoDepth).toBe(0);
    expect(layer.opacity.numKeys).toBe(0);
  });
});
