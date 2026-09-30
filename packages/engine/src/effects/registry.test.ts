import { describe, expect, it } from "vitest";
import { EFFECTS, createEffect, defaultEffectJson, effectsByCategory, getEffect, getEffectParam } from "./registry.js";

describe("effect registry", () => {
  it("lists every libopenshot 1.0 effect", () => {
    expect(EFFECTS).toHaveLength(43);
    expect(effectsByCategory("audio").map((e) => e.className)).toEqual([
      "Noise",
      "Delay",
      "Echo",
      "Distortion",
      "ParametricEQ",
      "Compressor",
      "Expander",
      "Robotization",
      "Whisperization",
    ]);
    expect(getEffect("chromakey")?.name).toBe("Chroma Key (Greenscreen)");
  });

  it("marks OpenCV and dialog effects", () => {
    for (const name of ["Stabilizer", "Tracker", "ObjectDetection", "ObjectMask", "Outline"]) {
      expect(getEffect(name)?.supported.web, name).toBe(false);
      expect(getEffect(name)?.requiresOpenCV, name).toBe(true);
    }
    expect(getEffect("Outline")?.needsDialog).toBe(false);
    expect(getEffect("Tracker")?.needsDialog).toBe(true);
    expect(getEffect("Blur")?.supported).toEqual({ web: true, node: true });
  });

  it("describes parameters with libopenshot metadata", () => {
    const sigma = getEffectParam("Blur", "sigma")!;
    expect(sigma).toMatchObject({ type: "keyframe", keyframable: true, default: 3, min: 0, max: 100, common: false });
    const keymethod = getEffectParam("ChromaKey", "keymethod")!;
    expect(keymethod.type).toBe("choice");
    expect(keymethod.choices?.length).toBe(12);
    expect(getEffectParam("Caption", "color")).toMatchObject({ type: "color", default: [255, 255, 255, 255] });
    expect(getEffectParam("Blur", "apply_before_clip")).toMatchObject({ type: "bool", common: true });
    expect(getEffectParam("ColorGrade", "curve_all")?.type).toBe("object");
    expect(getEffectParam("Blur", "mask_reader")?.type).toBe("reader");
    expect(getEffect("Blur")!.params[0]!.common).toBe(false);
  });

  it("creates the exact libopenshot JSON with an id", () => {
    const blur = defaultEffectJson("Blur", "ABCDEFGHIJ");
    expect(blur).toMatchObject({ id: "ABCDEFGHIJ", class_name: "Blur", type: "Blur", apply_before_clip: true, order: 0 });
    expect(blur.sigma).toEqual({
      Points: [{ co: { X: 1, Y: 3 }, handle_left: { X: 0.5, Y: 1 }, handle_right: { X: 0.5, Y: 0 }, handle_type: 0, interpolation: 0 }],
    });
    // Float-narrowed defaults survive exactly.
    expect((defaultEffectJson("FilmGrain", "X").clump as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y).toBe(
      Math.fround(0.2),
    );
    // Tracked-object keys carry the new id.
    expect(Object.keys(defaultEffectJson("Tracker", "TRK").objects as object)).toEqual(["TRK-0"]);
  });

  it("applies overrides like the desktop presets", () => {
    const glow = createEffect("Glow", { opacity: 0.35, color: "#ffd28cff", mode: 1 }, { id: "G" });
    expect((glow.opacity as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y).toBe(Math.fround(0.35));
    expect((glow.color as Record<string, { Points: { co: { Y: number } }[] }>).green!.Points[0]!.co.Y).toBe(210);
    expect(() => createEffect("Glow", { nope: 1 }, { id: "G" })).toThrow(/no parameter/);
    expect(() => createEffect("Nope", {}, { id: "G" })).toThrow(/Unknown effect/);
    expect(() => createEffect("ChromaKey", { keymethod: 99 }, { id: "C" })).toThrow(/one of/);
  });
});
