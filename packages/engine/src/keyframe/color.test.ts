import { describe, expect, it } from "vitest";
import { Interpolation } from "../model/types.js";
import { colorHexAt, constantColor, evaluateColor, parseHexColor, toHexColor } from "./color.js";
import { makeKeyframePoint } from "./edit.js";

describe("color keyframes", () => {
  it("samples each channel with GetInt and falls back for missing channels", () => {
    const color = {
      red: { Points: [makeKeyframePoint(1, 0, Interpolation.LINEAR), makeKeyframePoint(11, 255, Interpolation.LINEAR)] },
      green: { Points: [makeKeyframePoint(1, 10.5, Interpolation.LINEAR)] },
      blue: { Points: [makeKeyframePoint(1, 200, Interpolation.LINEAR)] },
    };
    // 127.5 rounds half away from zero → 128; 10.5 → 11; alpha missing → fallback
    expect(evaluateColor(color, 6, [0, 0, 0, 77])).toEqual([128, 11, 200, 77]);
    expect(colorHexAt(color, 11)).toBe("#ff0bc8");
  });

  it("constantColor writes Color(r,g,b,a).JsonValue()", () => {
    const c = constantColor([0, 123, 255, 255]);
    expect(evaluateColor(c, 1)).toEqual([0, 123, 255, 255]);
    expect(c.red.Points[0]!.interpolation).toBe(Interpolation.BEZIER);
  });

  it("parses CSS hex colors and Qt #aarrggbb", () => {
    expect(parseHexColor("#fff")).toEqual([255, 255, 255, 255]);
    expect(parseHexColor("#0080ff")).toEqual([0, 128, 255, 255]);
    expect(parseHexColor("#0080ff80")).toEqual([0, 128, 255, 128]);
    expect(parseHexColor("#800080ff", "argb")).toEqual([0, 128, 255, 128]);
    expect(parseHexColor("ffd28c")).toEqual([255, 210, 140, 255]);
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor("red")).toBeNull();
  });

  it("formats hex", () => {
    expect(toHexColor([0, 128, 255, 10])).toBe("#0080ff");
    expect(toHexColor([0, 128, 255, 10], true)).toBe("#0080ff0a");
    expect(toHexColor([300, -5, 12.7, 255])).toBe("#ff000c");
  });
});
