import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundledFontsDir } from "../resources.js";
import { FontIndex, readFontFamilies, resolveFonts } from "./fonts.js";
import { appendFontFallbacks, extractFontFamilies, rasterizeSvg, svgIntrinsicSize } from "./rasterize.js";

const rect = (fill: string, opacity = 1) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="${fill}" fill-opacity="${opacity}"/></svg>`;

describe("svg rasterization", () => {
  it("renders at the intrinsic size or an exact requested size", async () => {
    expect(await svgIntrinsicSize(rect("red"))).toEqual({ width: 40, height: 20 });
    const native = await rasterizeSvg(rect("red"));
    expect([native.width, native.height]).toEqual([40, 20]);
    const scaled = await rasterizeSvg(rect("red"), { width: 80 });
    expect([scaled.width, scaled.height]).toEqual([80, 40]);
    const stretched = await rasterizeSvg(rect("red"), { width: 30, height: 30 });
    expect([stretched.width, stretched.height]).toEqual([30, 30]);
    expect(Array.from(stretched.data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("returns straight (non-premultiplied) alpha", async () => {
    const img = await rasterizeSvg(rect("rgb(200,100,50)", 0.5));
    const [r, g, b, a] = Array.from(img.data.subarray(0, 4));
    expect(a).toBe(128);
    expect(Math.abs(r! - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(g! - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(b! - 50)).toBeLessThanOrEqual(2);
  });

  it("draws text with the bundled fallback font when nothing else is installed", async () => {
    const fonts = new FontIndex([{ path: path.join(bundledFontsDir(), "Lato-Regular.ttf"), families: ["lato"], size: 1 }]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#000"/><text x="10" y="45" font-size="40" fill="#fff" style="font-family:DejaVu Sans">Zenvi</text></svg>`;
    const img = await rasterizeSvg(svg, { fonts });
    let white = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i]! > 200) white += 1;
    expect(white).toBeGreaterThan(200);
  });

  it("finds font families and appends installed fallbacks", () => {
    const svg = [
      `<text font-family="DejaVu Sans">a</text>`,
      `<text style="font-size:12px;font-family:'Missing Face', Other;fill:#fff">b</text>`,
      `<style>.t { font-family: "Sheet Face", serif; }</style>`,
    ].join("");
    expect(extractFontFamilies(svg)).toEqual([["DejaVu Sans"], ["Missing Face", "Other"], ["Sheet Face", "serif"]]);
    const out = appendFontFallbacks(svg, (families) => (families.includes("serif") ? undefined : "Lato"));
    expect(out).toContain(`font-family="DejaVu Sans, Lato"`);
    expect(out).toContain(`font-family:'Missing Face', Other, Lato;`);
    expect(out).toContain(`font-family: "Sheet Face", serif;`);
  });

  it("resolves aliases before generic fallbacks", () => {
    const index = new FontIndex([
      { path: "/f/verdana.ttf", families: ["verdana"], size: 10 },
      { path: "/f/arial.ttf", families: ["arial"], size: 10 },
      { path: "/f/lato.ttf", families: ["lato"], size: 10 },
    ]);
    const resolved = resolveFonts(index, [["DejaVu Sans"], ["Unknown"]]);
    expect(resolved.fallbackFor(["DejaVu Sans"])).toBe("verdana");
    expect(resolved.fallbackFor(["Unknown"])).toBe("arial");
    expect(resolved.fallbackFor(["Arial"])).toBeUndefined();
    expect(resolved.files).toEqual(expect.arrayContaining(["/f/verdana.ttf", "/f/arial.ttf"]));
  });

  it("reads family names from the OpenType name table, as the font spells them", async () => {
    expect(await readFontFamilies(path.join(bundledFontsDir(), "Lato-Regular.ttf"))).toContain("Lato");
  });

  it("lists the fonts an installed metric twin draws in their place, as rendering resolves them", () => {
    const index = new FontIndex([
      { path: "/f/liberation-sans.ttf", families: ["Liberation Sans"], size: 10 },
      { path: "/f/lato.ttf", families: ["Lato"], size: 10 },
    ]);
    expect(index.renderableFamilyNames()).toEqual(["Arial", "Helvetica", "Lato", "Liberation Sans"]);
    const resolved = resolveFonts(index, [["Arial"], ["Helvetica"]]);
    expect(resolved.fallbackFor(["Arial"])).toBe("liberation sans");
    expect(resolved.fallbackFor(["Helvetica"])).toBe("liberation sans");
    // Nothing stands in for Georgia: not listed.
    expect(index.renderableFamilyNames()).not.toContain("Georgia");
  });

  it("lists the installed families once each, in the fonts' spelling, without hidden system faces", () => {
    const index = new FontIndex([
      { path: "/f/lato.ttf", families: ["Lato"], size: 10 },
      { path: "/f/lato-bold.ttf", families: ["lato"], size: 12 },
      { path: "/f/sf.ttf", families: [".SF NS"], size: 10 },
      { path: "/f/arial-black.ttf", families: ["Arial Black", "Arial"], size: 10 },
    ]);
    expect(index.familyNames()).toEqual(["Arial", "Arial Black", "Lato"]);
    expect(index.has("LATO")).toBe(true);
    expect(index.files("lato")).toEqual(["/f/lato.ttf", "/f/lato-bold.ttf"]);
  });
});
