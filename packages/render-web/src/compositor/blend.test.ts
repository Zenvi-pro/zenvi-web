import { describe, expect, it } from "vitest";
import { layerComposite } from "./blend.js";
import { cssColor, opaqueCssColor } from "./color.js";

describe("layerComposite", () => {
  it("maps the blend modes the desktop UI offers", () => {
    const modes: Record<number, string> = {
      0: "source-over",
      12: "lighter",
      13: "multiply",
      14: "screen",
      15: "overlay",
      16: "darken",
      17: "lighten",
      18: "color-dodge",
      19: "color-burn",
      20: "hard-light",
      21: "soft-light",
      22: "difference",
      23: "exclusion",
    };
    for (const [code, op] of Object.entries(modes)) {
      expect(layerComposite(Number(code))).toEqual({ kind: "draw", operation: op });
    }
  });

  it("handles Porter-Duff modes, Clear, Destination and unknown codes", () => {
    expect(layerComposite(3)).toEqual({ kind: "draw", operation: "copy" });
    expect(layerComposite(2)).toEqual({ kind: "clear" });
    expect(layerComposite(4)).toEqual({ kind: "skip" });
    expect(layerComposite(undefined)).toEqual({ kind: "draw", operation: "source-over" });
    expect(layerComposite(99)).toEqual({ kind: "draw", operation: "source-over" });
  });
});

describe("colors", () => {
  it("formats 0–255 channels, dropping alpha for the opaque background", () => {
    expect(cssColor([255, 128, 0, 51])).toBe("rgba(255, 128, 0, 0.2)");
    expect(opaqueCssColor([10, 20, 30, 0])).toBe("rgb(10, 20, 30)");
    expect(cssColor([300, -5, Number.NaN, 255])).toBe("rgba(255, 0, 0, 1)");
  });
});
