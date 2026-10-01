import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TITLE_TEMPLATE, TITLE_TEMPLATES, getTitleTemplate } from "./templates.js";
import { setSvgText, titleLines } from "./svg.js";

const asset = (assetPath: string): string => readFileSync(new URL(`../../assets/${assetPath}`, import.meta.url), "utf8");

describe("title templates", () => {
  it("lists the desktop's 50 templates, sorted, with Bar_1 as the default", () => {
    expect(TITLE_TEMPLATES).toHaveLength(50);
    expect(TITLE_TEMPLATES.map((t) => t.file)).toEqual([...TITLE_TEMPLATES.map((t) => t.file)].sort());
    expect(TITLE_TEMPLATES.filter((t) => t.default)).toEqual([DEFAULT_TITLE_TEMPLATE]);
    expect(DEFAULT_TITLE_TEMPLATE).toEqual({ id: "Bar_1", name: "Bar 1", file: "Bar_1.svg", assetPath: "titles/Bar_1.svg", default: true });
  });

  it("names templates like titles_model.py", () => {
    const names = Object.fromEntries(TITLE_TEMPLATES.map((t) => [t.id, t.name]));
    expect(names.Creative_Commons_2).toBe("Creative commons 2");
    expect(names.TV_Rating).toBe("Tv rating");
    expect(names.OpenShot).toBe("Openshot");
    expect(names.Post_it).toBe("Post it");
  });

  it("bundles every template under its desktop name", () => {
    expect(readdirSync(new URL("../../assets/titles/", import.meta.url)).sort()).toEqual(TITLE_TEMPLATES.map((t) => t.file));
  });

  it("finds templates the way add_title_tool names them", () => {
    expect(getTitleTemplate()).toBe(DEFAULT_TITLE_TEMPLATE);
    expect(getTitleTemplate("  ")).toBe(DEFAULT_TITLE_TEMPLATE);
    expect(getTitleTemplate("Standard_1")!.file).toBe("Standard_1.svg");
    expect(getTitleTemplate("standard_1.SVG")!.file).toBe("Standard_1.svg");
    expect(getTitleTemplate("titles/Footer_1.svg")!.file).toBe("Footer_1.svg");
    expect(getTitleTemplate("Footer 1")!.file).toBe("Footer_1.svg");
    expect(getTitleTemplate("/home/me/My_Title.svg")).toBeUndefined();
    expect(getTitleTemplate("C:\\Titles\\Bar_1.svg")).toBeUndefined();
    expect(getTitleTemplate("Nope")).toBeUndefined();
  });

  it("works with the desktop text substitution on every bundled template", () => {
    for (const t of TITLE_TEMPLATES) {
      const svg = asset(t.assetPath);
      const lines = titleLines(svg);
      const out = setSvgText(svg, "Hello & welcome");
      if (lines.length === 0) {
        // Solid_Color has no text.
        expect(out).toBe(svg);
        continue;
      }
      // First line replaced, every other line blanked (_set_svg_text).
      const after = titleLines(out);
      expect(after[0]).toBe("Hello & welcome");
      expect(after.slice(1).every((line) => line === "")).toBe(true);
    }
  });
});
