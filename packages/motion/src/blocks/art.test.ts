import { describe, expect, it } from "vitest";
import { ART_KINDS, ART_THEMES, artSvg, artUrl } from "./art.js";

describe("drawn art", () => {
  it("is a pure function of kind, theme, size and seed", () => {
    for (const kind of ART_KINDS) {
      const a = artSvg(kind, ART_THEMES[0]!, 600, 800, 7);
      expect(artSvg(kind, ART_THEMES[0]!, 600, 800, 7), kind).toBe(a);
      expect(a, kind).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="600" height="800"/);
      // Drawn shapes only: no text, no external references.
      expect(a, kind).not.toMatch(/<text|href=/);
    }
    expect(artSvg("hills", ART_THEMES[0]!, 600, 800, 8)).not.toBe(artSvg("hills", ART_THEMES[0]!, 600, 800, 7));
  });

  it("encodes as an image URL", () => {
    expect(artUrl("orb", ART_THEMES[3]!, 320.4, 480.6, 1)).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg[^,]*width%3D%22320%22%20height%3D%22481%22/);
  });
});
