import { expect, test } from "vitest";
import { createAeMock, KeyframeInterpolationType, type Property, type PropertyGroup } from "./ae-mock.js";
import { loadHostScript } from "./host-script.js";

function setup() {
  const mock = createAeMock();
  const comp = mock.addComp({ name: "Main" });
  const layer = comp.layers.addSolid([1, 0, 0], "Red", 1920, 1080, 1);
  const host = loadHostScript("aeft", mock.globals);
  return { mock, comp, layer, host };
}

test("keyframes are recorded with interpolation and per-dimension ease", () => {
  const { layer, host } = setup();
  host.evaluate(`(function () {
    var scale = app.project.activeItem.layer(1).property("Transform").property("Scale");
    scale.setValueAtTime(0, [92, 92, 100]);
    scale.setValueAtTime(0.6, [100, 100, 100]);
    scale.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    var ease = new KeyframeEase(0, 84);
    scale.setTemporalEaseAtKey(1, [ease, ease, ease], [ease, ease, ease]);
  }())`);
  const scale = layer.scale;
  expect(scale.numKeys).toBe(2);
  expect(scale.key(1)).toMatchObject({ time: 0, value: [92, 92, 100], outInterpolation: KeyframeInterpolationType.BEZIER });
  expect(scale.key(1).outEase.map((e) => e.influence)).toEqual([84, 84, 84]);
  expect(scale.key(2).inInterpolation).toBe(KeyframeInterpolationType.LINEAR);
});

test("enforces After Effects' rules: ease array size, influence range, setValue with keys, value ranges", () => {
  const { host } = setup();
  const attempt = (code: string) => () => host.evaluate(`(function () { var p = app.project.activeItem.layer(1).property("Transform"); ${code} }())`);
  expect(attempt('var s = p.property("Scale"); s.setValueAtTime(0, [1, 1, 1]); s.setTemporalEaseAtKey(1, [new KeyframeEase(0, 50)]);')).toThrow(/array of 3 KeyframeEase/);
  expect(attempt('var o = p.property("Position"); o.setValueAtTime(0, [0, 0, 0]); o.setTemporalEaseAtKey(1, [new KeyframeEase(0, 50)]);')).not.toThrow();
  expect(attempt("new KeyframeEase(0, 0);")).toThrow(/out of range/);
  expect(attempt('p.property("Opacity").setValue(120);')).toThrow(/out of range/);
  expect(attempt('var o = p.property("Opacity"); o.setValueAtTime(1, 50); o.setValue(20);')).toThrow(/has keyframes/);
});

test("values reach scripts as realm arrays (no ES5 array methods), like ExtendScript", () => {
  const { host } = setup();
  expect(host.evaluate('typeof app.project.activeItem.layer(1).property("Transform").property("Position").value.map')).toBe("undefined");
  expect(host.evaluate('app.project.activeItem.layer(1).property("Transform").property("Position").value[0]')).toBe(960);
});

test("missing properties are null and effects are added by match name or display name", () => {
  const { layer, host } = setup();
  expect(host.evaluate('app.project.activeItem.layer(1).property("Nope")')).toBeNull();
  host.evaluate('app.project.activeItem.layer(1).property("ADBE Effect Parade").addProperty("Gaussian Blur").property("Blurriness").setValue(12);');
  const blur = (layer.property("ADBE Effect Parade") as PropertyGroup).property(1) as PropertyGroup;
  expect(blur.matchName).toBe("ADBE Gaussian Blur 2");
  expect((blur.property("Blurriness") as Property).value).toBe(12);
});

test("undo groups must pair", () => {
  const { mock, host } = setup();
  expect(() => host.evaluate("app.endUndoGroup();")).toThrow(/without a matching/);
  host.evaluate('app.beginUndoGroup("a"); app.beginUndoGroup("b"); app.endUndoGroup(); app.endUndoGroup();');
  expect(mock.state.undoGroups).toEqual(["a"]);
});
