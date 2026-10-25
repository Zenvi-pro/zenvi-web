import { describe, expect, it } from "vitest";
import { elementsByTagName, getAttr, parseXml, type XmlElement } from "../titles/xml.js";
import { Drawing, num } from "./svg.js";
import { balanceLines, clampText, fitBlock, fitSize, textWidth } from "./text.js";

/** Every element of a drawing, depth first. */
function allElements(root: XmlElement): XmlElement[] {
  return [root, ...root.children.filter((c): c is XmlElement => c.kind === "element").flatMap(allElements)];
}

describe("Drawing", () => {
  it("writes only the SVG every renderer draws alike, scaled by k, sized in whole pixels", () => {
    const d = new Drawing(100.4, 50, 1.5);
    d.rect(10, 10, 40, 20, { fill: "#ff0000", rx: 6, fillOpacity: 0.5 });
    d.line(0, 0, 100, 50, { stroke: "#000000", strokeWidth: 2, linecap: "round" });
    d.polyline([[0, 0], [10, 10]], { stroke: "#000000" });
    d.path(Drawing.roundedRect(5, 5, 30, 30, 8), { fill: "#00ff00", fillRule: "evenodd" });
    d.circle(50, 25, 10, { fill: "#0000ff" });
    d.text(50, 40, [{ text: "A & B" }, { text: "|", fill: "#4f46e5", bold: false, opacity: 0 }], { size: 20, font: "sans", bold: true, fill: "#111111", anchor: "middle", tracking: 0.05 });
    const doc = parseXml(d.svg());
    expect(getAttr(doc.root, "width")).toBe("151");
    expect(getAttr(doc.root, "height")).toBe("75");
    expect(getAttr(doc.root, "viewBox")).toBe("0 0 151 75");
    const allowed = new Set(["svg", "rect", "line", "polyline", "path", "circle", "text", "tspan"]);
    for (const el of allElements(doc.root)) {
      expect(allowed.has(el.name), el.name).toBe(true);
      for (const [attr] of el.attrs) expect(["style", "filter", "clip-path", "mask", "href", "xlink:href", "class", "transform"]).not.toContain(attr);
    }
    const rect = elementsByTagName(doc, "rect")[0]!;
    expect(getAttr(rect, "x")).toBe("15");
    expect(getAttr(rect, "rx")).toBe("9");
    expect(getAttr(rect, "fill-opacity")).toBe("0.5");
    const text = elementsByTagName(doc, "text")[0]!;
    expect(getAttr(text, "font-size")).toBe("30");
    expect(getAttr(text, "letter-spacing")).toBe("1.5");
    expect(getAttr(text, "font-family")).toContain("sans-serif");
    const tspan = elementsByTagName(doc, "tspan")[0]!;
    expect(getAttr(tspan, "fill-opacity")).toBe("0");
    expect(d.svg()).toContain("A &amp; B");
  });

  it("formats numbers to two decimals and refuses non-finite ones", () => {
    expect(num(1.005)).toBe("1");
    expect(num(2.5)).toBe("2.5");
    expect(num(-0.004)).toBe("0");
    expect(() => num(Number.NaN)).toThrow();
  });
});

describe("text metrics", () => {
  it("measures Helvetica widths, monospace exactly, and letter spacing", () => {
    expect(textWidth("M", { size: 100, font: "sans", bold: true })).toBeCloseTo(83.3, 1);
    expect(textWidth("il", { size: 100, font: "sans" })).toBeCloseTo(44.4, 1);
    expect(textWidth("ABCD", { size: 10, font: "mono" })).toBeCloseTo(24, 6);
    expect(textWidth("ABCD", { size: 10, font: "mono", tracking: 0.1 })).toBeCloseTo(28, 6);
  });

  it("fits and balances lines", () => {
    const size = fitSize(["WIDE HEADLINE"], { font: "sans", bold: true }, 500, 400);
    expect(textWidth("WIDE HEADLINE", { size, font: "sans", bold: true })).toBeLessThanOrEqual(500);
    expect(balanceLines("one two three four", 2)).toEqual(["one two", "three four"]);
    const block = fitBlock("Film better reels at home", { font: "sans", bold: true }, 900, 600, 200, 3);
    for (const line of block.lines) expect(textWidth(line, { size: block.size, font: "sans", bold: true })).toBeLessThanOrEqual(900);
    expect(clampText("A very long label indeed", { size: 20, font: "mono" }, 120)).toMatch(/…$/);
  });
});
