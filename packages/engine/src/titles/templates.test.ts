import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TITLE_TEMPLATES } from "./templates.js";
import { setSvgText, titleLines } from "./svg.js";

const asset = (assetPath: string): string => readFileSync(new URL(`../../assets/${assetPath}`, import.meta.url), "utf8");

describe("title templates", () => {
  it("lists the desktop's 51 templates, sorted", () => {
    expect(TITLE_TEMPLATES).toHaveLength(51);
    expect(TITLE_TEMPLATES.map((t) => t.file)).toEqual([...TITLE_TEMPLATES.map((t) => t.file)].sort());
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
      // First line replaced; copies of the same placeholder (reflections)
      // get the text too; every other line is blanked (_set_svg_text).
      const after = titleLines(out);
      expect(after[0]).toBe("Hello & welcome");
      after.slice(1).forEach((line, i) => {
        expect(line).toBe(lines[i + 1]!.trim() === lines[0]!.trim() ? "Hello & welcome" : "");
      });
    }
  });
});
