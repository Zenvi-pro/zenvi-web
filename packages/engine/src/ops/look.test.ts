import { describe, expect, it } from "vitest";
import colorFixture from "./__fixtures__/color-grade-presets.json";
import type { Keyframe } from "../model/types.js";
import { findClip } from "../model/query.js";
import { addClip } from "./clips.js";
import { addEffect } from "./effects.js";
import { LOOK_PRESET_IDS, applyLookPreset, colorGradePresetValues, lookEffectPresetEffects, resetLookEffects } from "./look.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

function setup() {
  const doc = makeDoc();
  doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1_000_000, id: "C" }));
  return doc;
}
const effects = (doc: ReturnType<typeof makeDoc>) => findClip(doc.project, "C")!.effects;
const y = (kf: unknown) => (kf as Keyframe).Points[0]!.co.Y;

describe("Look menu presets", () => {
  it("color_presets.py port matches the desktop output exactly", () => {
    for (const [name, expected] of Object.entries(colorFixture)) {
      expect(colorGradePresetValues(name as "warm_up"), name).toEqual(expected);
    }
  });

  it("Color presets replace one ColorGrade effect in place", () => {
    const doc = setup();
    const before = doc.project;
    doc.transaction("warm", (tx) => applyLookPreset(tx, "C", "color.warm_up"));
    const [grade] = effects(doc);
    expect(grade!.class_name).toBe("ColorGrade");
    expect(y(grade!.temperature)).toBe(0.18);
    expectUndoRedo(doc, before);
    doc.transaction("boost", (tx) => applyLookPreset(tx, "C", "color.boost_color"));
    expect(effects(doc)).toHaveLength(1);
    expect(effects(doc)[0]!.id).toBe(grade!.id);
    expect(y(effects(doc)[0]!.saturation)).toBe(1.18);
    doc.transaction("reset", (tx) => applyLookPreset(tx, "C", "color.reset"));
    expect(effects(doc)).toEqual([]);
  });

  it("Film Grain keeps the existing effect's other settings and seed", () => {
    const doc = setup();
    doc.transaction("grain", (tx) => applyLookPreset(tx, "C", "film_grain.super_8"));
    expect(y(effects(doc)[0]!.amount)).toBe(0.62);
    expect(effects(doc)[0]!.seed).toBe(1);
    doc.transaction("grain2", (tx) => applyLookPreset(tx, "C", "film_grain.35mm_fine"));
    expect(effects(doc)).toHaveLength(1);
    expect(y(effects(doc)[0]!.amount)).toBe(0.14);
  });

  it("effect presets are tagged ui-menu=look; none removes only look-managed ones", () => {
    const doc = setup();
    doc.transaction("user blur", (tx) => addEffect(tx, "C", "Blur", {}, { id: "USER" }));
    doc.transaction("glow", (tx) => applyLookPreset(tx, "C", "glow.neon"));
    doc.transaction("blur", (tx) => applyLookPreset(tx, "C", "blur.soft_focus"));
    const glow = effects(doc).find((e) => e.class_name === "Glow")!;
    expect(glow["ui-menu"]).toBe("look");
    // develop look_presets.py writes Python floats (it no longer goes through openshot.Point).
    expect(y(glow.opacity)).toBe(0.65);
    expect(y((glow.color as Record<string, unknown>).blue)).toBe(255);
    doc.transaction("no blur", (tx) => applyLookPreset(tx, "C", "blur.none"));
    expect(effects(doc).map((e) => e.id)).toContain("USER");
    expect(effects(doc).filter((e) => e.class_name === "Blur")).toHaveLength(1);
    doc.transaction("reset", (tx) => applyLookPreset(tx, "C", "reset"));
    expect(effects(doc).map((e) => e.id)).toEqual(["USER"]);
    const labels = doc.undoLabels.length;
    doc.transaction("noop", (tx) => applyLookPreset(tx, "C", "reset"));
    expect(doc.undoLabels.length).toBe(labels);
  });

  it("lists ids and refuses audio-only clips and unknown presets", () => {
    expect(LOOK_PRESET_IDS).toContain("analog_tape.vhs");
    expect(LOOK_PRESET_IDS).toContain("shadow.long");
    const doc = setup();
    doc.transaction("song", (tx) => addClip(tx, { fileId: "AUDIO00001", position: 0, layer: 2_000_000, id: "S" }));
    expectRefused(doc, "invalid_argument", (tx) => applyLookPreset(tx, "S", "color.warm_up"));
    expectRefused(doc, "invalid_argument", (tx) => applyLookPreset(tx, "C", "glow.disco" as never));
  });
});

describe("look_presets.py (pure effect lists)", () => {
  it("keeps the replaced effect's id and order, and says null when nothing changes", () => {
    const made: string[] = [];
    const create = (cn: string) => {
      made.push(cn);
      return { id: "NEW", class_name: cn, sigma: { Points: [{ co: { X: 1, Y: 0 } }] }, horizontal_radius: { Points: [] }, vertical_radius: { Points: [] }, iterations: { Points: [] } } as never;
    };
    const effects = [{ id: "L1", class_name: "Blur", "ui-menu": "look", order: 3 }] as never[];
    const out = lookEffectPresetEffects(effects, "Blur", "medium", create)!;
    expect(out[0]).toMatchObject({ id: "L1", order: 3, "ui-menu": "look" });
    expect(y(out[0]!.sigma)).toBe(4.0);
    expect(lookEffectPresetEffects([], "Blur", "none", create)).toBeNull();
    expect(resetLookEffects([{ class_name: "Hue" }] as never[])).toBeNull();
    expect(made).toEqual(["Blur"]);
  });

  it("has the Assistant's sunny and gloomy grades, and the neutral grade", () => {
    expect(y(colorGradePresetValues("sunny").exposure)).toBe(0.05);
    expect(y(colorGradePresetValues("gloomy").saturation)).toBe(0.88);
    expect(colorGradePresetValues("neutral").lut_path).toBe("");
    expect(y(colorGradePresetValues("neutral").saturation)).toBe(1.0);
  });
});
