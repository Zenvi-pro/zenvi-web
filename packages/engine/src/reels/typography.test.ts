import { describe, expect, it } from "vitest";
import { estimatedTextWidth } from "../titles/title-svg.js";
import { elementsByTagName, getAttr, parseXml } from "../titles/xml.js";
import { REEL_STYLES, REEL_STYLE_IDS } from "./styles.js";
import { cardSvg, type CardRole } from "./typography.js";

const FRAMES: [string, number, number][] = [
  ["9:16", 1080, 1920],
  ["1:1", 1080, 1080],
  ["4:5", 1080, 1350],
  ["16:9", 1920, 1080],
  ["4:3", 1440, 1080],
  ["21:9", 2560, 1080],
];

describe.each(FRAMES)("reel title cards, %s", (_name, width, height) => {
  it.each(REEL_STYLE_IDS)("%s: hook, label and end card are the frame's size, every line inside title-safe", (style) => {
    for (const role of ["hook", "label", "end"] as CardRole[]) {
      const svg = cardSvg({ width, height, text: role === "label" ? "Chapter one" : "The bet became the future of computing", role, typography: REEL_STYLES[style].typography, subtitle: role === "end" ? "nvidia.com" : undefined });
      const doc = parseXml(svg);
      expect([getAttr(doc.root, "width"), getAttr(doc.root, "height"), getAttr(doc.root, "viewBox")]).toEqual([String(width), String(height), `0 0 ${width} ${height}`]);
      const lines = elementsByTagName(doc, "text");
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const x = Number(getAttr(line, "x"));
        const y = Number(getAttr(line, "y"));
        const size = Number(getAttr(line, "font-size"));
        const text = line.children.map((c) => (c.kind === "text" ? c.data : "")).join("");
        const w = estimatedTextWidth(text, size, Number(getAttr(line, "font-weight")) >= 600);
        const anchor = getAttr(line, "text-anchor") || "start";
        const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
        expect(left / width, `${role} "${text}" left`).toBeGreaterThanOrEqual(0.05);
        expect((left + w) / width, `${role} "${text}" right`).toBeLessThanOrEqual(0.95);
        expect(y / height, `${role} "${text}" baseline`).toBeGreaterThanOrEqual(0.05);
        expect(y / height, `${role} "${text}" baseline`).toBeLessThanOrEqual(0.95);
      }
    }
  });
});
