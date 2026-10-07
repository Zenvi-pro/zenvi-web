import { describe, expect, it } from "vitest";
import { parseSvgSize, svgRasterSize } from "./svg.js";

const svg = (attrs: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="10" height="10"/></svg>`;

describe("parseSvgSize matches QtSvg as measured through libopenshot QtImageReader", () => {
  it.each([
    ['width="720" height="576" viewBox="0 0 720 576"', { width: 720, height: 576 }],
    ['viewBox="0 0 100 50"', { width: 100, height: 50 }],
    ['width="2in" height="10mm"', { width: 180, height: 35 }],
    ['width="72pt" height="36pt"', { width: 72, height: 36 }],
    ['width="10pc" height="5pc"', { width: 10, height: 5 }],
    ['width="2.5cm" height="1cm"', { width: 88, height: 35 }],
    ['width="99.9" height="10.5"', { width: 99, height: 10 }],
    ['viewBox="0 0 100.6 50.4"', { width: 101, height: 50 }],
    ['width="300" viewBox="0 0 100 50"', { width: 100, height: 50 }],
    ['width="64px" height="32px" viewBox="0 0 10 10"', { width: 64, height: 32 }],
    ['width="50%" height="100%" viewBox="0 0 400 200"', { width: 200, height: 200 }],
  ])("%s", (attrs, expected) => {
    expect(parseSvgSize(svg(attrs))).toEqual(expected);
  });

  it("returns null when the size depends on content bounds", () => {
    expect(parseSvgSize(svg(""))).toBeNull();
    expect(parseSvgSize(svg('width="10em" height="5em"'))).toBeNull();
    expect(parseSvgSize("not svg")).toBeNull();
  });

  it("handles prologs, comments, newlines and spaces around '='", () => {
    const text = '<?xml version="1.0"?>\n<!-- c -->\n<svg\n  version="1.1"\n  height="120"\n  width = \'240\' xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(parseSvgSize(text)).toEqual({ width: 240, height: 120 });
  });
});

describe("svgRasterSize", () => {
  it("fits the document into the box keeping aspect (QSize::scale KeepAspectRatio)", () => {
    expect(svgRasterSize({ width: 720, height: 576 }, { width: 1920, height: 1080 })).toEqual({ width: 1350, height: 1080 });
    expect(svgRasterSize({ width: 1920, height: 1080 }, { width: 640, height: 640 })).toEqual({ width: 640, height: 360 });
  });
});
