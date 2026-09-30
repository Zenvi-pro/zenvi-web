import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/desktop-titles.json";
import { buildTitleSvg, dictToStyle, inspectTitleSvg, setSvgText, styleToDict, titleLines } from "./svg.js";

interface Summary {
  nodes: { tag: string; text: string; style: Record<string, string> }[];
  rect: Record<string, string> | null;
}
interface Case {
  name: string;
  svg: string;
  original: Summary;
  agent: Summary;
  editor: Summary;
}
const cases = fixture.cases as unknown as Case[];
const e = fixture.editor;

describe("title SVG substitution (parity with the desktop's minidom edits)", () => {
  for (const c of cases) {
    it(`${c.name}: reads the template like minidom`, () => {
      expect(inspectTitleSvg(c.svg)).toEqual(c.original);
    });

    it(`${c.name}: _set_svg_text`, () => {
      expect(inspectTitleSvg(setSvgText(c.svg, "Hello & <World>"))).toEqual(c.agent);
    });

    it(`${c.name}: title editor lines, font, colors, background`, () => {
      const out = buildTitleSvg(c.svg, {
        lines: e.lines,
        fontFamily: e.family,
        bold: e.bold,
        italic: e.italic,
        fontSizeRatio: e.ratio,
        textColor: e.color,
        textOpacity: e.alpha,
        backgroundColor: e.bg,
        backgroundOpacity: e.bg_alpha,
      });
      expect(inspectTitleSvg(out)).toEqual(c.editor);
    });
  }

  it("leaves everything else untouched", () => {
    const svg = cases[0]!.svg;
    expect(buildTitleSvg(svg, {})).toBe(svg);
    const out = buildTitleSvg(svg, { lines: ["X"] });
    expect(out.length).toBeLessThan(svg.length + 10);
    expect(out.startsWith(svg.slice(0, 200))).toBe(true);
  });

  it("style helpers round-trip like style_tools.py", () => {
    const d = styleToDict("font-size:48px;fill:#fff;;font-family:'Sans'");
    expect([...d.keys()]).toEqual(["font-size", "fill", "font-family"]);
    expect(dictToStyle(d)).toBe("font-size:48px;fill:#fff;font-family:'Sans';");
  });

  it("lists the editor's lines and handles minimal SVGs", () => {
    const svg = '<svg><text style="fill:#000"><tspan>One</tspan><tspan/><tspan>Two &amp; three</tspan></text><rect/></svg>';
    expect(titleLines(svg)).toEqual(["One", "Two & three"]);
    // The desktop indexes every tspan (the empty one is skipped, not renumbered).
    const out = buildTitleSvg(svg, { lines: ["A", "B", "C"], backgroundColor: "#123456" });
    expect(titleLines(out)).toEqual(["A", "C"]);
    expect(inspectTitleSvg(out).rect).toEqual({ fill: "#123456", opacity: "1.0" });
    expect(setSvgText(svg, "Hi")).toBe('<svg><text style="fill:#000"><tspan>Hi</tspan><tspan></tspan><tspan></tspan></text><rect/></svg>');
    expect(() => buildTitleSvg("<svg><text", { lines: ["x"] })).toThrow(/Malformed/);
    expect(() => buildTitleSvg(svg, { textColor: "#fff", textOpacity: 2 })).toThrow(/between 0 and 1/);
  });
});
