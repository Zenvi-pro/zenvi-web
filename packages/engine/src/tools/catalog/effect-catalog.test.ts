/**
 * The effects-color tools' effect catalog against the desktop's
 * (`effects_color._build_catalog` run on libopenshot 1.0 by
 * scripts/parity/effect_catalog_golden.py), and effect-name resolution.
 */

import { describe, expect, it } from "vitest";
import golden from "../__fixtures__/desktop-effect-catalog.json";
import { effectCatalog, effectKind, resolveEffectName } from "./effect-catalog.js";
import { ToolError } from "./timeline-edit-common.js";

describe("effectCatalog", () => {
  it("is exactly the desktop's catalog: effects, properties, ranges, defaults, choices and key order", () => {
    const ours = JSON.parse(JSON.stringify(Object.fromEntries(effectCatalog())));
    expect(Object.keys(ours)).toEqual(Object.keys(golden.catalog));
    for (const [name, spec] of Object.entries(golden.catalog)) {
      expect(JSON.stringify(ours[name]), name).toBe(JSON.stringify(spec));
    }
  });

  it("has libopenshot 1.0's 34 video and 9 audio effects", () => {
    const kinds = [...effectCatalog().values()].map((e) => e.kind);
    expect(kinds.filter((k) => k === "video")).toHaveLength(34);
    expect(kinds.filter((k) => k === "audio")).toHaveLength(9);
    expect(effectKind("Compressor")).toBe("audio");
    expect(effectKind("Blur")).toBe("video");
  });
});

describe("resolveEffectName", () => {
  it("takes class names, display names, prefixes and aliases", () => {
    expect(resolveEffectName("blur")).toBe("Blur");
    expect(resolveEffectName("Chroma Key (Greenscreen)")).toBe("ChromaKey");
    expect(resolveEffectName("chroma key")).toBe("ChromaKey");
    expect(resolveEffectName("greenscreen")).toBe("ChromaKey");
    expect(resolveEffectName("VHS")).toBe("AnalogTape");
    expect(resolveEffectName("equaliser")).toBe("ParametricEQ");
  });

  it("refuses unknown names with the closest ones", () => {
    expect(() => resolveEffectName("Blurr")).toThrow(ToolError);
    expect(() => resolveEffectName("Blurr")).toThrow("unknown effect 'Blurr'; did you mean Blur? list_effects_tool lists all 43 effects");
    expect(() => resolveEffectName("  ")).toThrow("name the effect (see list_effects_tool)");
  });
});
