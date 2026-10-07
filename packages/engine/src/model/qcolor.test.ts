import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/qcolor-names.json" with { type: "json" };
import { parseQColor, qcolorName, qcolorRgbF } from "./qcolor.js";
import { QCOLOR_NAMED } from "./qcolor.data.js";

interface Case {
  input: string;
  valid: boolean;
  name: string;
  rgbF: number[] | null;
}

describe("QColor string parsing (Qt 5.15, gen-title-readers.py)", () => {
  it.each((fixture as unknown as { cases: Case[] }).cases.map((c) => [JSON.stringify(c.input), c] as const))(
    "%s",
    (_label, c) => {
      expect(parseQColor(c.input) !== null).toBe(c.valid);
      expect(qcolorName(c.input)).toBe(c.name);
      expect(qcolorRgbF(c.input)).toEqual(c.rgbF ? c.rgbF.slice(0, 3) : null);
    },
  );

  it("knows every SVG color keyword, case- and space-insensitively", () => {
    expect(Object.keys(QCOLOR_NAMED)).toHaveLength(148);
    expect(qcolorName("Medium Sea Green")).toBe("#3cb371");
    expect(parseQColor("transparent")).toEqual({ red: 0, green: 0, blue: 0, alpha: 0 });
    // Object prototype keys are not colors.
    expect(parseQColor("constructor")).toBeNull();
    expect(parseQColor("__proto__")).toBeNull();
  });

  it("keeps 16-bit precision for the 9- and 12-digit forms", () => {
    expect(parseQColor("#123456789abc")).toEqual({ red: 0x1234, green: 0x5678, blue: 0x9abc, alpha: 0xffff });
    expect(parseQColor("#80ff0000")).toEqual({ red: 0xffff, green: 0, blue: 0, alpha: 0x80 * 257 });
  });
});
