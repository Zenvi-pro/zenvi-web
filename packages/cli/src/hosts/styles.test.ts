/**
 * The zenvi-styles index is generated from front matter
 * (plugins/zenvi/scripts/gen-styles-index.mjs): CI fails when SKILL.md or the
 * MCP copy is stale, when a front matter is invalid, or when a style names a
 * tool that does not exist. The library reaches MCP clients as zenvi://styles
 * resources, read_director_recipe {styles} and the zenvi_brief prompt.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTool } from "@zenvi/engine/tools";
import { briefSchema, methodProblems } from "@zenvi/engine";
import { STYLE_FILES, STYLE_RESOURCES } from "@zenvi/engine/styles";
import { describe, expect, it } from "vitest";
import { generate, indexTable, parseFrontMatter, readLibrary } from "../../../../plugins/zenvi/scripts/gen-styles-index.mjs";
import { guideText, promptText, RESOURCES } from "./guides.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../../..");

describe("zenvi-styles index", () => {
  it("SKILL.md and library.gen.ts are current and every front matter is valid", () => {
    const out = generate();
    expect(out.errors).toEqual([]);
    expect(readFileSync(path.join(ROOT, "plugins/zenvi/skills/zenvi-styles/SKILL.md"), "utf8")).toBe(out.skill);
    expect(readFileSync(path.join(ROOT, "packages/engine/src/styles/library.gen.ts"), "utf8")).toBe(out.module);
  });

  it("seeds a style per director recipe, each naming only tools that exist", () => {
    const { entries } = readLibrary();
    const styles = entries.filter((e) => e.kind === "style").map((e) => e.id);
    expect(styles).toEqual(expect.arrayContaining(["hype-reel", "saas-ui-promo", "kinetic-captions", "match-cut-montage", "documentary"]));
    for (const e of entries) expect(e.tools.filter((t) => !getTool(t)), e.path).toEqual([]);
  });

  it("BRIEF.md's example brief passes the motif method it teaches", () => {
    const md = readFileSync(path.join(ROOT, "plugins/zenvi/skills/zenvi-styles/BRIEF.md"), "utf8");
    const example = /^save_brief_tool (\{.*\})$/m.exec(md)![1]!;
    expect(methodProblems(briefSchema.parse(JSON.parse(example)))).toEqual([]);
  });

  it("serves METHOD-<name>.md files as methods and lists them in the index", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zenvi-styles-methods-"));
    writeFileSync(path.join(dir, "METHOD-motif.md"), "# The motif method\n");
    const library = readLibrary(dir, path.join(dir, "recipes"));
    expect(library.methods).toEqual([{ id: "method-motif", path: "METHOD-motif.md", markdown: "# The motif method\n" }]);
    expect(indexTable(library)).toContain("- [method-motif](METHOD-motif.md)");
  });

  it("reads flow and block lists, quoted aspects and colons inside values", () => {
    const parsed = parseFrontMatter('---\nid: a\nsummary: When x - then y: z\naspect: ["9:16", "1:1"]\ntools:\n  - add_sfx_tool\n  - "speed_ramp_tool"\n---\n# Body\n');
    expect(parsed?.meta).toEqual({ id: "a", summary: "When x - then y: z", aspect: ["9:16", "1:1"], tools: ["add_sfx_tool", "speed_ramp_tool"] });
    expect(parsed?.body).toBe("# Body\n");
  });

  it("refuses an invalid or duplicate entry with the file and the reason", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zenvi-styles-"));
    const recipes = path.join(dir, "recipes");
    for (const sub of ["styles", "techniques", "recipes"]) mkdirSync(path.join(dir, sub));
    writeFileSync(path.join(dir, "techniques", "flash.md"), "---\nid: flash\nkind: technique\nsummary: When the drop lands\npace: fast\ntools: [add_sfx_tool]\n---\n");
    writeFileSync(path.join(dir, "techniques", "bad.md"), "---\nid: bad\nkind: style\nsummary: x\npace: slow\n---\n");
    writeFileSync(path.join(dir, "styles", "flash.md"), "---\nid: flash\nkind: style\nsummary: s\npace: calm\n---\n");
    const library = readLibrary(dir, recipes);
    expect(library.entries.map((e) => e.id)).toEqual(["flash", "flash"]);
    expect(library.errors.join("\n")).toMatch(/techniques\/bad\.md: a file in techniques\/ must be kind technique; pace must be/);
    expect(library.errors.join("\n")).toMatch(/id flash is also/);
  });
});

describe("the styles on MCP", () => {
  it("serves the index, the brief compiler and every file as zenvi://styles resources", () => {
    expect(guideText("zenvi://styles")).toContain("## The index");
    expect(guideText("zenvi://styles/brief")).toContain("# The brief compiler");
    for (const file of STYLE_FILES) expect(guideText(`zenvi://styles/${file.id}`), file.id).toBe(file.markdown);
    const listed = new Set(RESOURCES.map((r) => r.uri));
    for (const r of STYLE_RESOURCES) expect(listed.has(r.uri), r.uri).toBe(true);
  });

  it("the zenvi_brief prompt carries the brief compiler and the index, and needs the prompt", () => {
    const { text } = promptText("zenvi_brief", { prompt: "a reel of my Lisbon trip" });
    expect(text).toContain("The person asked: a reel of my Lisbon trip");
    expect(text).toContain("save_brief_tool");
    expect(text).toContain("| [hype-reel](");
    expect(() => promptText("zenvi_brief", {})).toThrow(/needs the prompt/);
  });
});
