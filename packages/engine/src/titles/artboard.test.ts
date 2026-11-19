import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { artboardBox, textSpan } from "./artboard.js";
import { parseTitleSvg } from "./title-svg.js";
import { setAttr } from "./xml.js";

const template = (file: string) => readFileSync(new URL(`../../assets/titles/${file}`, import.meta.url), "utf8");

describe("textSpan", () => {
  it("fits a 16:9 title's text to its artboard, and a reshaped one's to title-safe", () => {
    const doc = parseTitleSvg(template("Standard_1.svg"));
    expect(textSpan(doc)).toEqual({ left: 0, width: 1920 });
    // A title reshaped to 4:3 by an earlier zenvi-web keeps that viewBox.
    setAttr(doc.root, "viewBox", "-480 0 2880 2160");
    const box = artboardBox(doc);
    expect(box).toEqual({ x: -480, y: 0, width: 2880, height: 2160 });
    expect(textSpan(doc)).toEqual({ left: box.x + box.width * 0.05, width: box.width * 0.9 });
  });
});
