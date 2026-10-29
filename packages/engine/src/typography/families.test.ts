import { describe, expect, it } from "vitest";
import { titleFamily } from "../tools/fonts.js";
import { fallbackFamily } from "./families.js";

describe("bundled fallbacks for fonts a brief names", () => {
  it("map a font's kind to a bundled face", () => {
    expect(fallbackFamily("Arial")).toBe("inter");
    expect(fallbackFamily("'Helvetica Neue'")).toBe("inter");
    expect(fallbackFamily("serif")).toBe("instrument-serif");
    expect(fallbackFamily("Times New Roman")).toBe("instrument-serif");
    expect(fallbackFamily("sans-serif")).toBe("inter");
    expect(fallbackFamily("condensed")).toBe("anton");
    expect(fallbackFamily("Arial Narrow")).toBe("anton");
    expect(fallbackFamily("Impact")).toBe("anton");
    expect(fallbackFamily("Courier New")).toBe("space-mono");
    expect(fallbackFamily("DejaVu Sans Mono")).toBe("space-mono");
    expect(fallbackFamily("Comic Papyrus")).toBeNull();
    // Weights and optical sizes of sans faces stay sans.
    expect(fallbackFamily("SF Pro Display")).toBe("inter");
    expect(fallbackFamily("Avenir Book")).toBe("inter");
    expect(fallbackFamily("Century Gothic")).toBe("inter");
    expect(fallbackFamily("League Gothic")).toBe("anton");
    expect(fallbackFamily("Book Antiqua")).toBe("instrument-serif");
    expect(fallbackFamily("Arial Black")).toBe("archivo-black");
  });

  it("stand in only for fonts the host lacks (or generic ones), keeping bundled and installed fonts", () => {
    expect(titleFamily("Bebas Neue", ["Arial"])).toBe("bebas-neue");
    expect(titleFamily("Arial", ["Arial"])).toBeNull();
    expect(titleFamily("Arial", ["Lato"])).toBe("inter");
    expect(titleFamily("Arial", null)).toBeNull();
    expect(titleFamily("DejaVu Sans", null)).toBe("inter");
    expect(titleFamily("serif", ["Georgia"])).toBe("instrument-serif");
  });
});
