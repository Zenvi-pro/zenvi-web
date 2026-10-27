import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { artboardBox, fitArtboardToFrame, textSpan } from "./artboard.js";
import { TITLE_TEMPLATES } from "./templates.js";
import { parseTitleSvg, rectNodes, titleSvgText } from "./title-svg.js";
import { getAttr } from "./xml.js";

const template = (file: string) => readFileSync(new URL(`../../assets/titles/${file}`, import.meta.url), "utf8");
const centre = { h: "center", v: "center", lift: 0 } as const;

describe("fitArtboardToFrame", () => {
  it("gives every bundled template the frame's aspect and grows its full-frame background (Bubbles_2's flipped one too)", () => {
    for (const [fw, fh] of [
      [1080, 1920],
      [1440, 1080],
      [2560, 1080],
    ] as const) {
      const grown: string[] = [];
      for (const t of TITLE_TEMPLATES) {
        const doc = parseTitleSvg(template(t.file));
        expect(fitArtboardToFrame(doc, { width: fw, height: fh }, centre), t.file).toBe(true);
        const box = artboardBox(doc);
        expect(box.width * fh, t.file).toBe(box.height * fw);
        const rect = rectNodes(doc)[0];
        if (rect && Number(getAttr(rect, "width")) >= box.width) grown.push(t.file);
      }
      // Every template whose first rectangle is its full-frame background (all but Post_it's note).
      expect(grown.length).toBe(TITLE_TEMPLATES.filter((t) => rectNodes(parseTitleSvg(template(t.file))).length > 0).length - 1);
      expect(grown).toContain("Bubbles_2.svg");
      expect(grown).not.toContain("Post_it.svg");
    }
  });

  it("leaves a 16:9 frame's title untouched, and fits text to title-safe only once reshaped", () => {
    const svg = template("Standard_1.svg");
    const doc = parseTitleSvg(svg);
    expect(fitArtboardToFrame(doc, { width: 1280, height: 720 }, centre)).toBe(false);
    expect(titleSvgText(doc)).toBe(titleSvgText(parseTitleSvg(svg)));
    expect(textSpan(doc)).toEqual({ left: 0, width: 1920 });
    fitArtboardToFrame(doc, { width: 1440, height: 1080 }, centre);
    const box = artboardBox(doc);
    expect(textSpan(doc)).toEqual({ left: box.x + box.width * 0.05, width: box.width * 0.9 });
  });

  it("keeps the drawing where gravity and the vertical lift put it", () => {
    const at = (v: "top" | "center" | "bottom", lift: number) => {
      const doc = parseTitleSvg(template("Standard_1.svg"));
      fitArtboardToFrame(doc, { width: 1080, height: 1920 }, { h: "center", v, lift });
      const box = artboardBox(doc);
      // Where the old artboard's top and bottom edges land on the frame (0-1).
      return [(0 - box.y) / box.height, (1080 - box.y) / box.height];
    };
    const [top] = at("top", 0.06);
    const [, bottom] = at("bottom", -0.12);
    const [mid0, mid1] = at("center", 0);
    expect(top).toBeCloseTo(0.06 + 0.03, 6);
    expect(bottom).toBeCloseTo(1 - 0.12 - 0.03, 6);
    expect((mid0! + mid1!) / 2).toBeCloseTo(0.5, 6);
  });
});
