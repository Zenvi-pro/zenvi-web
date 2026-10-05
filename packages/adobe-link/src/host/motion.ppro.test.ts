import { describe, expect, test } from "vitest";
import { loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";
import { LEVEL_0DB } from "../testing/ppro-components.js";

describe("dB <-> Premiere audio Level", () => {
  test.each([
    [0, LEVEL_0DB],
    [15, 1],
    [-6, Math.pow(10, -21 / 20)],
    [-96, 0],
  ])("%s dB is level %s, and back", (db, level) => {
    const fx = loadPremiere();
    expect(fx.host.evaluate(`ZenviLink.ppro.dbToLevel(${db})`)).toBeCloseTo(level, 10);
    expect(fx.host.evaluate(`ZenviLink.ppro.levelToDb(${level})`)).toBeCloseTo(db, 2);
  });
});

describe("premiere_set_clip_properties", () => {
  test("Motion in sequence pixels, opacity, blend mode; only changed values are written", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_set_clip_properties", {
      clip: edit.v.b.nodeId,
      position: [960, 300],
      scale: 104,
      rotation: 0,
      anchor: [0.5, 0.25],
      opacity: 85,
      blend_mode: "screen",
    });
    expect(receipt.status).toBe("applied");
    const motion = edit.v.b.componentList[1];
    const opacity = edit.v.b.componentList[0];
    expect(motion?.param("Position").value).toEqual([0.5, 300 / 1080]);
    expect(motion?.param("Scale").value).toBe(104);
    expect(motion?.param("Anchor Point").value).toEqual([0.5, 0.25]);
    expect(motion?.param("Rotation").calls).toEqual([]);
    expect(opacity?.param("Opacity").value).toBe(85);
    expect(opacity?.param("Blend Mode").value).toBe(22);
    expect(receipt.data).toMatchObject({ values: { position: [960, 300], scale: 104, opacity: 85, blend_mode: "screen" }, before: { scale: 100, blend_mode: "normal" } });
    expect(receipt.undoSteps).toBe(5);
    expect(fx.call("premiere_set_clip_properties", { clip: edit.v.b.nodeId, scale: 104 }).status).toBe("unchanged");
  });

  test("audio volume in dB on an audio clip", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_set_clip_properties", { clip: edit.audio.music.nodeId, volume_db: -18 });
    expect(receipt.data).toMatchObject({ values: { volume_db: -18 }, before: { volume_db: 0 } });
    expect(edit.audio.music.componentList[0]?.param("Level").value).toBeCloseTo(Math.pow(10, -33 / 20), 10);
  });

  test("animated properties are refused unless clear_keyframes", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const scale = edit.v.a.componentList[1]?.param("Scale");
    scale?.setTimeVarying(true);
    scale?.addKey(1);
    const refused = fx.call("premiere_set_clip_properties", { clip: edit.v.a.nodeId, scale: 90 });
    expect(refused.summary).toBe("Error: Motion > Scale is animated (has keyframes); change the keyframes with premiere_animate, or pass clear_keyframes: true");
    const cleared = fx.call("premiere_set_clip_properties", { clip: edit.v.a.nodeId, scale: 90, clear_keyframes: true });
    expect(cleared.status).toBe("applied");
    expect(scale?.timeVarying).toBe(false);
    expect(scale?.value).toBe(90);
  });

  test("refusals: wrong media kind, nothing to set, bad values", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_set_clip_properties", { clip: edit.audio.a.nodeId, scale: 50 }).summary).toContain("scale applies to video clips");
    expect(fx.call("premiere_set_clip_properties", { clip: edit.v.a.nodeId, volume_db: -6 }).summary).toContain("Volume applies to audio clips");
    expect(fx.call("premiere_set_clip_properties", { clip: edit.v.a.nodeId }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_set_clip_properties", { clip: edit.v.a.nodeId, opacity: 120 }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_set_clip_properties", { clip: edit.v.a.nodeId, position: [1] }).error?.code).toBe("INVALID_ARGUMENT");
  });
});

describe("TASTE easings -> Premiere interpolation", () => {
  const cases: [string, string[], string[]][] = [
    ["smooth eases out of the first key and into the last", ["smooth"], ["ease-out", "ease-in"]],
    ["out / entrance arrives softly", ["out"], ["bezier", "ease-in"]],
    ["in / exit leaves softly", ["in"], ["ease-out", "bezier"]],
    ["linear stays linear", ["linear"], ["linear", "linear"]],
    ["hold holds", ["hold"], ["hold", "linear"]],
    ["a resting middle key eases both ways", ["smooth", "in-out"], ["ease-out", "ease-in-out", "ease-in"]],
    ["snap then linear", ["snap", "linear"], ["ease-out", "ease-in", "linear"]],
  ];
  test.each(cases)("%s", (_label, easings, expected) => {
    const fx = loadPremiere();
    const modes = fx.host.evaluate(
      `(function () { var P = ZenviLink.ppro; var curves = []; var names = ${JSON.stringify(easings)};
        for (var i = 0; i < names.length; i += 1) { curves.push(P.easingCurve(names[i], "e")); }
        var modes = P.interpolationModes(curves); var out = [];
        var labels = ["linear", "ease-in", "ease-out", "ease-in-out", "hold", "bezier"];
        for (var j = 0; j < modes.length; j += 1) { out.push(labels[modes[j]]); }
        return out.join(","); }())`,
    );
    expect(String(modes).split(",")).toEqual(expected);
  });

  test("custom curves: a resting start eases out, a fast start does not", () => {
    const fx = loadPremiere();
    const modes = fx.host.evaluate(
      `ZenviLink.ppro.interpolationModes([ZenviLink.ppro.easingCurve({x1: 0.4, y1: 0, x2: 0.9, y2: 0.6}, "e")]).join(",")`,
    );
    expect(modes).toBe("2,5");
  });
});

describe("premiere_animate", () => {
  test("a TASTE entrance: scale 92 -> 100 over 0.6 s, smooth, in source time", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_animate", {
      clip: edit.v.b.nodeId,
      property: "scale",
      keyframes: [
        { time: 0, value: 92 },
        { time: 0.6, value: 100 },
      ],
    });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Animated Motion > Scale on "b.mov": 2 keyframes 0-0.6 s (ease-out, ease-in)');
    // Clip b starts at 4 s with its in point at 1 s: keyframes sit at source 1.0 and 1.6 s.
    expect(edit.v.b.componentList[1]?.param("Scale").keyList()).toEqual([
      { seconds: 1, value: 92, interpolation: 2 },
      { seconds: 1.6, value: 100, interpolation: 1 },
    ]);
    expect(receipt.data.keyframes).toEqual([
      { time: 0, sequence_time: 4, value: 92, interpolation: "ease-out" },
      { time: 0.6, sequence_time: 4.6, value: 100, interpolation: "ease-in" },
    ]);
  });

  test("position in pixels with per-segment easings; replace removes older keys", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const position = edit.v.a.componentList[1]?.param("Position");
    position?.setTimeVarying(true);
    position?.addKey(5);
    fx.call("premiere_animate", {
      clip: edit.v.a.nodeId,
      property: "position",
      easing: "out",
      keyframes: [
        { time: 1, value: [1152, 540], easing: "hold" },
        { time: 0, value: [960, 540] },
        { time: 2, value: [960, 540] },
      ],
    });
    expect(position?.keyList()).toEqual([
      { seconds: 2, value: [0.5, 0.5], interpolation: 5 },
      { seconds: 3, value: [0.6, 0.5], interpolation: 4 },
      { seconds: 4, value: [0.5, 0.5], interpolation: 0 },
    ]);
  });

  test("volume fades in dB with linear easing", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.call("premiere_animate", {
      clip: edit.audio.music.nodeId,
      property: "volume",
      easing: "linear",
      keyframes: [
        { time: 10.5, value: 0 },
        { time: 12, value: -96 },
      ],
    });
    const keys = edit.audio.music.componentList[0]?.param("Level").keyList();
    expect(keys?.map((key) => key.seconds)).toEqual([10.5, 12]);
    expect(keys?.[0]?.value).toBeCloseTo(LEVEL_0DB, 10);
    expect(keys?.[1]).toMatchObject({ value: 0, interpolation: 0 });
  });

  test("an effect parameter by name", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.call("premiere_apply_effect", { clip: edit.v.c.nodeId, effect: "Gaussian Blur" });
    const receipt = fx.call("premiere_animate", {
      clip: edit.v.c.nodeId,
      property: { effect: "gaussian blur", param: "Blurriness" },
      keyframes: [
        { time: 0, value: 40 },
        { time: 0.6, value: 0 },
      ],
    });
    expect(receipt.data.property).toBe("Gaussian Blur > Blurriness");
    expect(edit.v.c.componentList[2]?.param("Blurriness").keyList().map((key) => key.value)).toEqual([40, 0]);
    expect(fx.call("premiere_animate", { clip: edit.v.c.nodeId, property: { effect: "Glow", param: "x" }, keyframes: [{ time: 0, value: 1 }, { time: 1, value: 2 }] }).summary).toContain(
      'has no effect "Glow"',
    );
  });

  test("when Premiere rejects the legacy ease modes the keys use Bezier and the receipt says so", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.mock.state.rejectLegacyEase = true;
    const receipt = fx.call("premiere_animate", { clip: edit.v.b.nodeId, property: "opacity", keyframes: [{ time: 0, value: 0 }, { time: 0.6, value: 100 }] });
    expect(receipt.status).toBe("applied");
    expect(edit.v.b.componentList[0]?.param("Opacity").keyList().map((key) => key.interpolation)).toEqual([5, 5]);
    expect(receipt.warnings).toEqual(["Premiere rejected the ease-in/ease-out interpolation on 2 keys; those keys use Bezier instead"]);
  });

  test("refusals: past the clip end, same frame, retimed clip, one keyframe", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const keys = (a: number, b: number) => [{ time: a, value: 0 }, { time: b, value: 100 }];
    expect(fx.call("premiere_animate", { clip: edit.v.b.nodeId, property: "opacity", keyframes: keys(0, 6) }).summary).toContain("past the end of the clip");
    expect(fx.call("premiere_animate", { clip: edit.v.b.nodeId, property: "opacity", keyframes: keys(1, 1.01) }).summary).toContain("same frame");
    edit.v.a.speed = 0.5;
    expect(fx.call("premiere_animate", { clip: edit.v.a.nodeId, property: "opacity", keyframes: keys(0, 1) }).error?.code).toBe("UNSUPPORTED");
    expect(fx.call("premiere_animate", { clip: edit.v.b.nodeId, property: "opacity", keyframes: [{ time: 0, value: 1 }] }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_animate", { clip: edit.v.b.nodeId, property: "volume", keyframes: keys(0, 1) }).summary).toContain("Volume applies to audio clips");
  });
});
