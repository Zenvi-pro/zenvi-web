import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TITLE_TEMPLATES } from "./templates.js";
import {
  BLANK,
  applyFont,
  artboardSize,
  backgroundColor,
  duplicatePattern,
  fitField,
  freeName,
  lineTexts,
  nodeStyle,
  parseTitleSvg,
  rectNodes,
  safeBaseName,
  setBackground,
  setFieldText,
  setTextColor,
  textColor,
  textNodes,
  textZone,
  titleFields,
  titleSvgText,
  tspanNodes,
  uniqueTitleName,
  versionName,
  type TitleDoc,
  titleLook,
} from "./title-svg.js";
import { parseXml, serializeXml } from "./xml.js";

function doc(name: string): TitleDoc {
  return parseTitleSvg(readFileSync(new URL(`../../assets/titles/${name}.svg`, import.meta.url), "utf8"));
}

// Ported from zenvi-core develop tests/test_editor_tools_titles_text.py (title_svg section).
describe("title_svg: fields, text, font, colours, names", () => {
  it("parses every bundled template and round-trips it", () => {
    expect(TITLE_TEMPLATES).toHaveLength(50);
    for (const t of TITLE_TEMPLATES) {
      const d = doc(t.id);
      titleFields(d);
      artboardSize(d);
      const again = parseTitleSvg(titleSvgText(d));
      expect(titleSvgText(again), t.id).toBe(titleSvgText(d));
      expect(lineTexts(again), t.id).toEqual(lineTexts(d));
    }
  });

  it("joins reflection copies into one field and gives roles by font size", () => {
    const bar = titleFields(doc("Bar_1"));
    expect(bar).toHaveLength(1);
    expect(bar[0]!.nodes).toHaveLength(2);
    expect(bar[0]!.role).toBe("title");
    expect(titleFields(doc("Standard_1")).map((f) => [f.role, f.text])).toEqual([
      ["title", "The Title"],
      ["subtitle", "Sub-Title"],
    ]);
    // The subtitle comes first in Ribbon_1's document.
    expect(titleFields(doc("Ribbon_1")).map((f) => f.role)).toEqual(["subtitle", "title"]);
    expect(titleFields(doc("Standard_3")).map((f) => f.text)).toEqual(["Line 1", "Line 2", "Line 3"]);
    expect(titleFields(doc("Solid_Color"))).toEqual([]);
  });

  it("keeps a line for a blanked field and puts newlines on one line", () => {
    const d = doc("Standard_1");
    const slots = titleFields(d);
    setFieldText(slots[1]!, "");
    expect(lineTexts(d)).toEqual(["The Title", BLANK]);
    setFieldText(slots[0]!, "Two\nlines");
    expect(lineTexts(d)[0]).toBe("Two lines");
  });

  it("writes the font into style and scales attribute sizes", () => {
    const box = doc("Box"); // font-size lives in an attribute, not style=""
    applyFont([...textNodes(box), ...tspanNodes(box)], { family: "Georgia", bold: true, italic: false, sizeRatio: 0.5 });
    const style = nodeStyle(textNodes(box)[0]!);
    expect(style.get("font-family")).toBe("'Georgia'");
    expect(style.get("font-weight")).toBe("bold");
    expect(style.get("font-size")).toBe("60px"); // 120px attribute * 0.5
    const std = doc("Standard_1");
    applyFont(tspanNodes(std), { sizeRatio: 2 });
    expect(nodeStyle(tspanNodes(std)[0]!).get("font-size")!.startsWith("262.5")).toBe(true);
  });

  it("applies text opacity once, not squared", () => {
    const d = doc("Standard_1");
    setTextColor(d, "#ff0000", 0.5);
    for (const text of textNodes(d)) expect(nodeStyle(text).get("opacity")).toBe("1");
    for (const tspan of tspanNodes(d)) {
      expect(nodeStyle(tspan).get("fill")).toBe("#ff0000");
      expect(nodeStyle(tspan).get("opacity")).toBe("0.5");
    }
    expect(textColor(d)).toEqual(["#ff0000", 0.5]);
  });

  it("reads the background and text colours back", () => {
    const d = doc("Standard_1");
    expect(backgroundColor(d)[1]).toBe(0); // transparent full-frame rect
    setBackground(d, "#000000", 0.75);
    expect(backgroundColor(d)).toEqual(["#000000", 0.75]);
    expect(textColor(doc("Box"))[0].toLowerCase()).toBe("#0fffff"); // presentation attribute
    expect(rectNodes(doc("Box")).length).toBeGreaterThan(0);
  });

  it("names copies with the duplicate rule", () => {
    expect(uniqueTitleName("Tokyo: Day 1", [])).toBe("Tokyo Day 1.svg");
    expect(uniqueTitleName("Tokyo Day 1", ["Tokyo Day 1.svg"])).toBe("Tokyo Day 1 (1).svg");
    expect(duplicatePattern("Title (3).svg")).toEqual(["Title (", 3]);
    expect(duplicatePattern("Title.svg")).toEqual(["Title (", 0]);
    expect(freeName("TitleFileName (", 0, [])).toBe("TitleFileName (1)");
    expect(versionName("/titles/Day 1.svg", [])).toBe("Day 1 v2.svg");
    expect(versionName("Day 1 v2.svg", ["Day 1 v3.svg"])).toBe("Day 1 v4.svg");
    expect(safeBaseName("  a/b:c?.svg ")).toBe("a b c");
  });

  it("shrinks text that would run off the artboard", () => {
    const d = doc("Standard_1");
    const slot = titleFields(d)[0]!;
    setFieldText(slot, "An extremely long title that cannot possibly fit on one line");
    const ratio = fitField(slot, 1920);
    expect(ratio).toBeGreaterThanOrEqual(0.35);
    expect(ratio).toBeLessThan(0.8);
    expect(fitField(titleFields(doc("Standard_1"))[0]!, 1920)).toBe(1);
  });

  it("knows where a template's text sits", () => {
    const zone = (name: string): string => {
      const d = doc(name);
      return textZone(titleFields(d), artboardSize(d)[1]);
    };
    expect(zone("Gray_Box_4")).toBe("bottom");
    expect(zone("Header_2")).toBe("top");
    expect(zone("Standard_1")).toBe("center");
  });
});

describe("xml", () => {
  it("keeps the prolog, comments, CDATA and entities", () => {
    const text = '<?xml version="1.0"?>\n<!-- c --><svg a="1 &amp; 2"><!--x--><text>&lt;b&gt;</text><style><![CDATA[a>b]]></style><g/></svg>\n';
    const d = parseXml(text);
    expect(serializeXml(d)).toBe('<?xml version="1.0"?>\n<!-- c --><svg a="1 &amp; 2"><!--x--><text>&lt;b&gt;</text><style><![CDATA[a>b]]></style><g/></svg>\n');
  });
});

describe("titleLook", () => {
  it("reads a template's own colours, font and weight, as the Title Editor shows them before any change", () => {
    const svg = (name: string) => readFileSync(new URL(`../../assets/titles/${name}.svg`, import.meta.url), "utf8");
    // Bar 1's full-frame background is transparent; the bar is a shape of its own.
    expect(titleLook(svg("Bar_1"))).toEqual({ textColor: "#324da7", backgroundColor: "", fontFamily: "DejaVu Sans", bold: true, italic: false });
    expect(titleLook(svg("Box"))).toMatchObject({ textColor: "#0fffff", backgroundColor: "#5014B4" });
  });
});
