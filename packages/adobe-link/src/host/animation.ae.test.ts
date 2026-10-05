import { describe, expect, test } from "vitest";
import { KeyframeInterpolationType, TextDocument, type Property, type PropertyGroup, type TextLayer } from "../testing/ae-mock.js";
import { aeHarness } from "../testing/ae-harness.js";

/** Rounded, with -0 as 0. */
const round = (value: number) => Math.round(value * 1000) / 1000 || 0;
const ease = (list: { speed: number; influence: number }[]) => list.map((e) => ({ speed: round(e.speed), influence: round(e.influence) }));

function setup() {
  const h = aeHarness();
  const comp = h.mock.addComp({ name: "Main" });
  const layer = comp.layers.addSolid([1, 0, 0], "Red", 400, 400, 1);
  return { h, comp, layer };
}

/** A text layer whose Source Text is keyed "Small" (40 px) at 0 s and "Big" (90 px) at 2 s. */
function keyedText(h: ReturnType<typeof setup>["h"], comp: ReturnType<typeof setup>["comp"]) {
  const text = comp.layers.addText("A") as TextLayer;
  const source = (text.property("ADBE Text Properties") as PropertyGroup).property("ADBE Text Document") as Property;
  const small = new TextDocument("Small");
  small.fontSize = 40;
  const big = new TextDocument("Big");
  big.fontSize = 90;
  source.setValueAtTime(0, small);
  source.setValueAtTime(2, big);
  return { text, source, h };
}

describe("ae_set_property", () => {
  test("static values by display path, match path and shortcut; colours, uniform scale, effect params", () => {
    const { h, layer } = setup();
    expect(h.callValidated("ae_set_property", { layer: layer.id, property: "Transform/Opacity", value: 50 }).data).toMatchObject({ path: "Transform/Opacity", match_path: "ADBE Transform Group/ADBE Opacity", before: 100, value: 50 });
    expect(layer.opacity.value).toBe(50);
    h.callValidated("ae_set_property", { layer: layer.id, property: "Position", value: [100, 200] });
    expect(layer.position.value).toEqual([100, 200, 0]);
    h.callValidated("ae_set_property", { layer: layer.id, property: "ADBE Transform Group/ADBE Scale", value: 120 });
    expect(layer.scale.value).toEqual([120, 120, 120]);
    (layer.property("ADBE Effect Parade") as PropertyGroup).addProperty("ADBE Fill");
    h.callValidated("ae_set_property", { layer: layer.id, property: "Fill/Color", value: "#2F6BFF" });
    const fill = ((layer.property("ADBE Effect Parade") as PropertyGroup).property(1) as PropertyGroup).property("Color") as Property;
    expect(Array.from(fill.value as number[], (c) => Math.round(c * 255))).toEqual([47, 107, 255, 255]);
    expect(h.callValidated("ae_set_property", { layer: layer.id, property: "Opacity", value: 50 })).toMatchObject({ status: "unchanged", undoSteps: 0 });
  });

  test("a keyframe at `time`; Source Text from a string", () => {
    const { h, comp, layer } = setup();
    h.callValidated("ae_set_property", { layer: layer.id, property: "Rotation", value: 45, time: 1.01 });
    expect(layer.rotation.key(1)).toMatchObject({ time: 1, value: 45 });
    const text = comp.layers.addText("Old");
    h.callValidated("ae_set_property", { layer: text.id, property: "Source Text", value: "New" });
    expect((((text.property("ADBE Text Properties") as PropertyGroup).property("ADBE Text Document") as Property).value as TextDocument).text).toBe("New");
  });

  test("refusals name what exists; keyframed properties need a time; ranges and shapes are checked", () => {
    const { h, layer } = setup();
    const missing = h.callValidated("ae_set_property", { layer: layer.id, property: "Transform/Wobble", value: 1 });
    expect(missing).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    expect(missing.summary).toContain("has: Anchor Point, Position, X Position");
    layer.opacity.setValueAtTime(0, 0);
    expect(h.callValidated("ae_set_property", { layer: layer.id, property: "Opacity", value: 10 }).error?.message).toContain("pass `time`");
    expect(h.callValidated("ae_set_property", { layer: layer.id, property: "Rotation", value: [1, 2] })).toMatchObject({ status: "refused" });
    expect(h.callValidated("ae_set_property", { layer: layer.id, property: "Transform", value: 1 }).error?.message).toContain("is a group");
    layer.opacity.removeKey(1);
    expect(h.callValidated("ae_set_property", { layer: layer.id, property: "Opacity", value: 140 }).error?.message).toContain("out of range");
    expect(h.mock.state.undoDepth).toBe(0);
  });

  test("separated Position: refused with the X/Y Position paths to use instead, which work", () => {
    const { h, layer } = setup();
    layer.position.dimensionsSeparated = true;
    const refused = h.callValidated("ae_set_property", { layer: layer.id, property: "Position", value: [10, 20] });
    expect(refused).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "INVALID_ARGUMENT" } });
    expect(refused.summary).toContain('set "Transform/X Position" and "Transform/Y Position"');
    expect(h.callValidated("ae_animate", { layer: layer.id, property: "Position", keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [5, 5] }] })).toMatchObject({ status: "refused" });
    expect(h.callValidated("ae_set_property", { layer: layer.id, property: "Transform/X Position", value: 10 })).toMatchObject({ status: "applied" });
    expect(layer.position.numKeys).toBe(0);
  });

  test("a Source Text keyframe at `time` keeps the style in effect there", () => {
    const { h, comp } = setup();
    const { source } = keyedText(h, comp);
    expect(h.callValidated("ae_set_property", { layer: comp.layer(1).id, property: "Source Text", value: "Bigger", time: 2 })).toMatchObject({ status: "applied" });
    expect(source.keyValue(2) as TextDocument).toMatchObject({ text: "Bigger", fontSize: 90 });
    expect(source.keyValue(1) as TextDocument).toMatchObject({ text: "Small", fontSize: 40 });
  });
});

describe("ae_animate", () => {
  test("TASTE smooth on opacity: out influence 33 % speed 0, in influence 80 % speed 0, bezier both sides", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_animate", { layer: layer.id, property: "Opacity", keyframes: [{ time: 0, value: 0 }, { time: 0.6, value: 100 }] });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { path: "Transform/Opacity" } });
    const [a, b] = [layer.opacity.key(1), layer.opacity.key(2)];
    expect(ease(a.outEase)).toEqual([{ speed: 0, influence: 33 }]);
    expect(ease(b.inEase)).toEqual([{ speed: 0, influence: 80 }]);
    expect(a.outInterpolation).toBe(KeyframeInterpolationType.BEZIER);
    expect(b.inInterpolation).toBe(KeyframeInterpolationType.BEZIER);
    expect(a.temporalAutoBezier || a.temporalContinuous).toBe(false);
  });

  test("spatial position uses the path length: out (0.16, 1, 0.3, 1) over 60 px in 0.6 s gives 625 px/s at 16 %", () => {
    const { h, layer } = setup();
    h.callValidated("ae_animate", {
      layer: layer.id,
      property: "Position",
      easing: "out",
      spatial: "linear",
      keyframes: [{ time: 0, value: [960, 600] }, { time: 0.6, value: [960, 540] }],
    });
    const [a, b] = [layer.position.key(1), layer.position.key(2)];
    expect(ease(a.outEase)).toEqual([{ speed: 625, influence: 16 }]);
    expect(ease(b.inEase)).toEqual([{ speed: 0, influence: 70 }]);
    expect(a).toMatchObject({ spatialAutoBezier: false, spatialContinuous: false, inSpatialTangent: [0, 0, 0], outSpatialTangent: [0, 0, 0] });
  });

  test("non-spatial multi-dimensional scale gets one ease per dimension; negative changes give negative speeds", () => {
    const { h, layer } = setup();
    h.callValidated("ae_animate", {
      layer: layer.id,
      property: "Scale",
      keyframes: [
        { time: 0, value: [100, 100, 100], easing: { x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.8 } },
        { time: 1, value: [80, 120, 100] },
      ],
    });
    expect(ease(layer.scale.key(1).outEase)).toEqual([
      { speed: -8, influence: 50 },
      { speed: 8, influence: 50 },
      { speed: 0, influence: 50 },
    ]);
    expect(ease(layer.scale.key(2).inEase)).toEqual([
      { speed: -8, influence: 50 },
      { speed: 8, influence: 50 },
      { speed: 0, influence: 50 },
    ]);
  });

  test("exit easing on a fade out: in (0.7, 0, 0.84, 0) gives the incoming key -1562.5 %/s at 16 %", () => {
    const { h, layer } = setup();
    h.callValidated("ae_animate", { layer: layer.id, property: "Opacity", easing: "in", keyframes: [{ time: 1, value: 100 }, { time: 1.4, value: 0 }] });
    expect(ease(layer.opacity.key(1).outEase)).toEqual([{ speed: 0, influence: 70 }]);
    expect(ease(layer.opacity.key(2).inEase)).toEqual([{ speed: -1562.5, influence: 16 }]);
  });

  test("per-segment easing, hold and linear; linear on motion warns", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_animate", {
      layer: layer.id,
      property: "Rotation",
      keyframes: [
        { time: 0, value: 0, easing: "hold" },
        { time: 1, value: 90, easing: "linear" },
        { time: 2, value: 180 },
      ],
    });
    const [a, b, c] = [layer.rotation.key(1), layer.rotation.key(2), layer.rotation.key(3)];
    expect(a.outInterpolation).toBe(KeyframeInterpolationType.HOLD);
    expect(b.inInterpolation).toBe(KeyframeInterpolationType.HOLD);
    expect(b.outInterpolation).toBe(KeyframeInterpolationType.LINEAR);
    expect(c.inInterpolation).toBe(KeyframeInterpolationType.LINEAR);
    expect(receipt.warnings.join(" ")).toContain("Linear easing on Transform/Rotation");
  });

  test("keys inside the new span are replaced, others kept; replace: true clears them all", () => {
    const { h, layer } = setup();
    for (const [t, v] of [[0, 0], [1, 50], [3, 100]] as const) layer.opacity.setValueAtTime(t, v);
    const receipt = h.callValidated("ae_animate", { layer: layer.id, property: "Opacity", keyframes: [{ time: 0.5, value: 10 }, { time: 2, value: 90 }] });
    expect(layer.opacity.keys.map((key) => key.time)).toEqual([0, 0.5, 2, 3]);
    expect(receipt.warnings).toContain("Replaced 1 existing keyframe on Transform/Opacity");
    h.callValidated("ae_animate", { layer: layer.id, property: "Opacity", replace: true, keyframes: [{ time: 1, value: 100 }] });
    expect(layer.opacity.keys.map((key) => key.time)).toEqual([1]);
  });

  test("overshoot adds an editable settle keyframe before the end (playful brands only)", () => {
    const { h, layer } = setup();
    h.callValidated("ae_animate", { layer: layer.id, property: "Rotation", easing: "out", overshoot: 0.05, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] });
    expect(layer.rotation.keys.map((key) => [Math.round(key.time * 1000) / 1000, Math.round((key.value as number) * 100) / 100])).toEqual([
      [0, 0],
      [0.767, 105],
      [1, 100],
    ]);
  });

  test("Source Text keyframes keep the style in effect at their time", () => {
    const { h, comp } = setup();
    const { source } = keyedText(h, comp);
    h.callValidated("ae_animate", { layer: comp.layer(1).id, property: "Source Text", keyframes: [{ time: 2, value: "Late" }, { time: 3, value: "Later" }] });
    expect(source.keyValue(2) as TextDocument).toMatchObject({ text: "Late", fontSize: 90 });
    expect(source.keyValue(3) as TextDocument).toMatchObject({ text: "Later", fontSize: 90 });
    expect(source.keyValue(1) as TextDocument).toMatchObject({ fontSize: 40 });
  });

  test("an overshoot needs room for its settle keyframe: a one-frame last segment is refused", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_animate", { layer: layer.id, property: "Rotation", overshoot: 0.05, keyframes: [{ time: 0, value: 0 }, { time: 1 / 30, value: 90 }] });
    expect(receipt).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "INVALID_ARGUMENT" } });
    expect(receipt.summary).toContain("too short for an overshoot");
    expect(layer.rotation.numKeys).toBe(0);
  });

  test("Source Text keyframes hold", () => {
    const { h, comp } = setup();
    const text = comp.layers.addText("A");
    h.callValidated("ae_animate", { layer: text.id, property: "Source Text", keyframes: [{ time: 0, value: "One" }, { time: 1, value: "Two" }] });
    const source = (text.property("ADBE Text Properties") as PropertyGroup).property("ADBE Text Document") as Property;
    expect(source.key(1).outInterpolation).toBe(KeyframeInterpolationType.HOLD);
    expect((source.keyValue(2) as TextDocument).text).toBe("Two");
  });

  test("refuses keyframes out of order (after snapping), bad easings and wrong value shapes", () => {
    const { h, layer } = setup();
    expect(h.callValidated("ae_animate", { layer: layer.id, property: "Opacity", keyframes: [{ time: 1, value: 0 }, { time: 1.01, value: 1 }] }).error?.message).toContain("must increase");
    expect(h.call("ae_animate", { layer: layer.id, property: "Opacity", easing: "bouncy", keyframes: [{ time: 0, value: 0 }] })).toMatchObject({ status: "refused" });
    expect(h.callValidated("ae_animate", { layer: layer.id, property: "Position", keyframes: [{ time: 0, value: 5 }] })).toMatchObject({ status: "refused" });
    expect(layer.opacity.numKeys + layer.position.numKeys).toBe(0);
  });
});

describe("ae_add_expression", () => {
  test("sets, checks and clears an expression", () => {
    const { h, layer } = setup();
    const receipt = h.callValidated("ae_add_expression", { layer: layer.id, property: "Rotation", expression: "time * 36" });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { path: "Transform/Rotation", enabled: true } });
    expect(layer.rotation).toMatchObject({ expression: "time * 36", expressionEnabled: true });
    expect(h.callValidated("ae_add_expression", { layer: layer.id, property: "Rotation", expression: "time * 36" })).toMatchObject({ status: "unchanged" });
    expect(h.callValidated("ae_add_expression", { layer: layer.id, property: "Rotation", expression: "" }).summary).toContain("Cleared");
    expect(layer.rotation.expressionEnabled).toBe(false);
  });

  test("an expression After Effects rejects is removed again and refused with its message", () => {
    const { h, layer } = setup();
    layer.rotation.expression = "wiggle(1, 5)";
    const receipt = h.callValidated("ae_add_expression", { layer: layer.id, property: "Rotation", expression: "time *" });
    expect(receipt).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(receipt.summary).toContain("SyntaxError");
    expect(layer.rotation.expression).toBe("wiggle(1, 5)");
    expect(receipt.warnings.join(" ")).toContain('Undo "Zenvi: Set expression"');
  });

  test("a rejected expression restores the previous one with its switch, off stays off; a new one can start disabled", () => {
    const { h, layer } = setup();
    layer.rotation.expression = "wiggle(1, 5)";
    layer.rotation.expressionEnabled = false;
    expect(h.callValidated("ae_add_expression", { layer: layer.id, property: "Rotation", expression: "wiggle(" })).toMatchObject({ status: "refused" });
    expect(layer.rotation).toMatchObject({ expression: "wiggle(1, 5)", expressionEnabled: false });

    expect(h.callValidated("ae_add_expression", { layer: layer.id, property: "Opacity", expression: "nope(" })).toMatchObject({ status: "refused" });
    expect(layer.opacity).toMatchObject({ expression: "", expressionEnabled: false });

    const disabled = h.callValidated("ae_add_expression", { layer: layer.id, property: "Opacity", expression: "50", enabled: false });
    expect(disabled).toMatchObject({ status: "applied", data: { enabled: false } });
    expect(layer.opacity).toMatchObject({ expression: "50", expressionEnabled: false });
  });
});
