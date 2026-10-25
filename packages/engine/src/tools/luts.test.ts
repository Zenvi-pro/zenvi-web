/**
 * The built-in LUTs (the 50 .cube files zenvi-core ships, bundled as engine
 * assets) and LUT name resolution: effect_ops.list_luts / resolve_lut and the
 * older colour tools' color_agent LUT paths (tests/test_editor_tools_effects_color_looks.py
 * test_list_luts_and_resolve).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinLutForPath, listLuts } from "../effects/luts.js";
import { parseCubeLut } from "../render/kernels/cube-lut.js";
import type { ToolCall } from "./define.js";
import { checkLutFile, colorAgentLutPath, LutError, resolveLut } from "./luts.js";
import { fakeHost } from "./test-support/fake-host.js";
import { fixtureDoc } from "./test-support/fixture.js";

const ASSETS = join(import.meta.dirname, "..", "..", "assets", "colors");

function call(host = fakeHost()): ToolCall {
  return { doc: fixtureDoc(), host, tool: "color_grade_clip_tool", session: "default", commit: () => undefined as never };
}

describe("the built-in LUTs", () => {
  it("are the desktop's 50 LUTs in 6 categories, in its order and names", () => {
    const luts = listLuts();
    expect(luts).toHaveLength(50);
    expect(new Set(luts.map((l) => l.category)).size).toBe(6);
    expect(luts[0]).toMatchObject({
      id: "cinematic_&_blockbuster/bold_red_cinema",
      name: "Bold Red Cinema",
      category: "Cinematic & Blockbuster",
      path: "@colors/cinematic_&_blockbuster/bold_red_cinema.cube",
      builtin: true,
    });
    expect(luts.find((l) => l.id === "teal_&_orange_vibes/signature_teal_&_orange")!.name).toBe("Signature Teal & Orange");
    expect(luts.find((l) => l.id === "film_stock_&_vintage/vintage_400_film")!.name).toBe("Vintage 400 Film");
  });

  it("are exactly the .cube files bundled in assets/colors, and libopenshot's loader reads each of them", () => {
    const onDisk = readdirSync(ASSETS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(join(ASSETS, d.name)).map((f) => `${d.name}/${f}`))
      .sort();
    expect(listLuts().map((l) => l.assetPath.slice("colors/".length)).sort()).toEqual(onDisk);
    const parsedCategories = new Set<string>();
    for (const lut of listLuts()) {
      const text = readFileSync(join(ASSETS, lut.assetPath.slice("colors/".length)), "utf8");
      // Every file: a 3D table with size³ rows. One per category: the full parse (37 MB in all is slow).
      const size = Number(/^LUT_3D_SIZE\s+(\d+)/m.exec(text)?.[1]);
      const rows = text.split("\n").filter((line) => /^\s*[-+.\d]\S*\s+\S+\s+\S+/.test(line)).length;
      expect(rows, lut.id).toBe(size ** 3);
      if (!parsedCategories.has(lut.category)) {
        parsedCategories.add(lut.category);
        const parsed = parseCubeLut(text);
        expect([parsed?.kind, parsed?.size], lut.id).toEqual(["3d", size]);
      }
    }
    expect(parsedCategories.size).toBe(6);
  });

  it("are found from the alias and from a desktop install path", () => {
    expect(builtinLutForPath("@colors/dark_&_moody/cold_shadows.cube")?.id).toBe("dark_&_moody/cold_shadows");
    expect(builtinLutForPath("/Applications/Zenvi.app/Contents/Resources/colors/dark_&_moody/cold_shadows.cube")?.id).toBe("dark_&_moody/cold_shadows");
    expect(builtinLutForPath("C:\\Program Files\\Zenvi\\colors\\dark_&_moody\\COLD_SHADOWS.cube")?.id).toBe("dark_&_moody/cold_shadows");
    expect(builtinLutForPath("/home/me/colors/mine.cube")).toBeUndefined();
  });
});

describe("resolveLut (effect_ops.resolve_lut)", () => {
  it("takes ids, display names, file names, aliases and paths", () => {
    expect(resolveLut("Signature Teal & Orange").path).toBe("@colors/teal_&_orange_vibes/signature_teal_&_orange.cube");
    expect(resolveLut("warm correction").path).toBe("@colors/utility_&_correction/warm_correction.cube");
    expect(resolveLut("film_stock_&_vintage/classic_film").path).toBe("@colors/film_stock_&_vintage/classic_film.cube");
    expect(resolveLut("teal_cinema.cube").path).toBe("@colors/cinematic_&_blockbuster/teal_cinema.cube");
    expect(resolveLut("@colors/vibrant_&_colorful/color_pop.cube").path).toBe("@colors/vibrant_&_colorful/color_pop.cube");
    expect(resolveLut("none")).toEqual({ kind: "none", path: "" });
    expect(resolveLut("")).toEqual({ kind: "none", path: "" });
    expect(resolveLut("/Users/me/looks/mine.cube")).toEqual({ kind: "file", path: "/Users/me/looks/mine.cube" });
  });

  it("refuses what is not a LUT, with the closest ids", () => {
    expect(() => resolveLut("/tmp/not-a-lut.txt")).toThrow("LUT file not found or not a .cube file: /tmp/not-a-lut.txt");
    expect(() => resolveLut("@colors/nope/none.cube")).toThrow(LutError);
    expect(() => resolveLut("no such lut")).toThrow(/^no LUT named 'no such lut'.* \(list_luts_tool lists them\)$/);
    expect(() => resolveLut("teal")).toThrow(/closest: .*teal/);
  });

  it("color_agent paths: relative, alias or absolute; unknown ones are not found", () => {
    expect(colorAgentLutPath("cinematic_&_blockbuster/teal_cinema.cube")?.path).toBe("@colors/cinematic_&_blockbuster/teal_cinema.cube");
    expect(colorAgentLutPath("@colors/dark_&_moody/noir_era.cube")?.path).toBe("@colors/dark_&_moody/noir_era.cube");
    expect(colorAgentLutPath("/opt/zenvi/colors/dark_&_moody/noir_era.cube")?.kind).toBe("builtin");
    expect(colorAgentLutPath("/Users/me/mine.cube")).toEqual({ kind: "file", path: "/Users/me/mine.cube" });
    expect(colorAgentLutPath("nope/missing.cube")).toBeUndefined();
  });
});

describe("checkLutFile", () => {
  it("reads a LUT file outside the built-ins through the host and checks it loads", async () => {
    const lut = "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";
    const host = fakeHost({ texts: { "/luts/mine.cube": lut, "/luts/bad.cube": "hello" } });
    await expect(checkLutFile(call(host), "/luts/mine.cube")).resolves.toBeUndefined();
    await expect(checkLutFile(call(host), "/luts/bad.cube")).rejects.toThrow("is not a LUT libopenshot can load");
    await expect(checkLutFile(call(host), "/luts/missing.cube")).rejects.toThrow("LUT file not found or not a .cube file");
    await expect(checkLutFile(call(fakeHost({ omit: ["media.importPath"] })), "/luts/mine.cube")).rejects.toThrow("needs local file access");
  });
});
