import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/title-readers.json" with { type: "json" };
import {
  DEFAULT_TITLE_FONT_FAMILY,
  bestContrastColor,
  buildTitleSvg,
  detectTitleFont,
  pickFontFamily,
  readTitleBackgroundColor,
  readTitleTextColor,
  type TitleColor,
  type TitleFont,
} from "./svg.js";

interface DesktopColor {
  color: string;
  alphaF: number;
  /** The button style sheet, null when the editor never set it. */
  button: string | null;
}
interface DesktopFont {
  family: string;
  italic: boolean;
  bold: boolean;
  pixelSize: number | null;
  pointSize: number | null;
}
interface Reading {
  name: string;
  font: DesktopFont | null;
  text: DesktopColor;
  background: DesktopColor | null;
}
const templates = fixture.templates as unknown as (Reading & { sha256: string })[];
const synthetic = fixture.synthetic as unknown as (Reading & { svg: string })[];

const ASSETS = new URL("../../assets/titles/", import.meta.url);

function expectColor(ours: TitleColor, desktop: DesktopColor): void {
  expect(ours.color).toBe(desktop.color);
  // QColor stores alpha in 16 bits; the reader keeps the exact style value.
  expect(Math.abs(ours.opacity - desktop.alphaF)).toBeLessThanOrEqual(1 / 65535);
  if (desktop.button !== null) {
    expect(`background-color: ${ours.color}; opacity: 1; color: ${bestContrastColor(ours.color)};`).toBe(desktop.button);
  }
}

function expectFont(ours: TitleFont | null, desktop: DesktopFont | null): void {
  if (desktop === null) {
    expect(ours).toBeNull();
    return;
  }
  const expected: TitleFont = { family: desktop.family, italic: desktop.italic, bold: desktop.bold };
  if (desktop.pixelSize !== null) expected.pixelSize = desktop.pixelSize;
  if (desktop.pointSize !== null) expected.pointSize = desktop.pointSize;
  expect(ours).toEqual(expected);
}

function expectReading(svg: string, desktop: Reading): void {
  expectFont(detectTitleFont(svg), desktop.font);
  expectColor(readTitleTextColor(svg), desktop.text);
  const background = readTitleBackgroundColor(svg);
  if (desktop.background === null) expect(background).toBeNull();
  else expectColor(background!, desktop.background);
}

describe("title editor readers match title_editor.py on every desktop template", () => {
  it.each(templates.map((t) => [t.name, t] as const))("%s", (name, desktop) => {
    const svg = readFileSync(new URL(name, ASSETS), "utf8");
    expect(createHash("sha256").update(svg).digest("hex"), "template differs from the desktop's").toBe(desktop.sha256);
    expectReading(svg, desktop);
  });

  it("covers gradients and named colors", () => {
    const colors = new Set(templates.map((t) => t.text.color));
    expect(colors.size).toBeGreaterThan(4);
  });
});

describe("title editor readers on edge cases (gen-title-readers.py)", () => {
  it.each(synthetic.map((s) => [s.name, s] as const))("%s", (_name, desktop) => {
    expectReading(desktop.svg, desktop);
  });
});

describe("reader details", () => {
  it("reads back what buildTitleSvg wrote", () => {
    const svg = '<svg><rect style="fill:#000"/><text><tspan style="font-size:20px">A</tspan></text></svg>';
    const out = buildTitleSvg(svg, {
      textColor: "#336699",
      textOpacity: 0.25,
      backgroundColor: "#ffcc00",
      backgroundOpacity: 0.5,
      fontFamily: "Open Sans",
      bold: true,
      italic: true,
      fontSizeRatio: 2,
    });
    expect(readTitleTextColor(out)).toEqual({ color: "#336699", opacity: 0.25 });
    expect(readTitleBackgroundColor(out)).toEqual({ color: "#ffcc00", opacity: 0.5 });
    expect(detectTitleFont(out)).toEqual({ family: "Open Sans", italic: true, bold: true, pixelSize: 40 });
  });

  it("reads an unparseable opacity as opaque instead of failing", () => {
    expect(readTitleTextColor('<svg><text style="fill:red;opacity:half">A</text></svg>')).toEqual({ color: "#ff0000", opacity: 1 });
    expect(readTitleTextColor('<svg><text style="opacity:nan">A</text></svg>').opacity).toBe(0);
    expect(readTitleTextColor('<svg><text style="opacity: 1_0e-1 ">A</text></svg>').opacity).toBe(1);
  });

  it("stops at gradient reference cycles", () => {
    const svg =
      '<svg><defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>' +
      '<text><tspan style="fill:url(#a)">A</tspan></text></svg>';
    expect(readTitleTextColor(svg)).toEqual({ color: "#000000", opacity: 1 });
  });

  it("pickFontFamily follows get_font: substring match, then the fallback list", () => {
    const installed = ["Helvetica Neue", "Liberation Sans Narrow", "DejaVu Sans Mono", "Arial"];
    expect(pickFontFamily("Helvetica", installed)).toBe("Helvetica Neue");
    expect(pickFontFamily("Comic Sans", installed)).toBe("DejaVu Sans Mono");
    expect(pickFontFamily("Comic Sans", ["Arial", "Liberation Sans"])).toBe("Liberation Sans");
    expect(pickFontFamily("Comic Sans", ["Papyrus"])).toBeUndefined();
    expect(DEFAULT_TITLE_FONT_FAMILY).toBe("DejaVu Sans");
  });

  it("bestContrastColor uses perceived luminance", () => {
    expect(bestContrastColor("#ffffff")).toBe("#000000");
    expect(bestContrastColor("#0000ff")).toBe("#ffffff");
    expect(bestContrastColor("#00ff00")).toBe("#000000");
    expect(bestContrastColor("url(#x)")).toBe("#ffffff");
  });
});
