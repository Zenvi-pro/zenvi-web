import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { lintScene, sourceLines } from "./scene-lint.js";

const scene = (draw: string, top = ""): string => `${top}\nexport const fps = 30;\nexport const duration = 30;\nexport function draw(ctx, t, api) {\n${draw}\n}\n`;

async function problems(code: string): Promise<string[]> {
  const r = await lintScene(code);
  return r.ok ? [] : r.problems.map((p) => p.message);
}

describe("scene lint", () => {
  it("accepts the demo scene and keeps its exports", async () => {
    const r = await lintScene(await readFile(new URL("../scene/examples/launch.ts", import.meta.url), "utf8"));
    expect(r.ok, r.ok ? "" : r.problems.map((p) => p.message).join("\n")).toBe(true);
    if (r.ok) expect(r.exports.map((e) => e.name).sort()).toEqual(["cues", "draw", "duration", "fps", "params", "title"]);
  });

  it.each([
    ["Math.random()", /Math.random/],
    ["Date.now()", /Date is not available/],
    ["new Date()", /Date is not available/],
    ["performance.now()", /performance is not available/],
    ["fetch('http://example.com')", /fetch is not available/],
    ["window.x = 1", /window is not available/],
    ["document.body", /document is not available/],
    ["globalThis.fetch", /globalThis is not available/],
    ["setTimeout(() => 0, 1)", /setTimeout is not available/],
    ["eval('1')", /eval is not available/],
    ["new Function('return 1')", /Function is not available/],
    ["api.text.constructor('return fetch')", /\.constructor is not allowed/],
    ["api['constructor']", /\.constructor is not allowed/],
    ["({}).__proto__", /__proto__ is not allowed/],
    ["ctx.canvas.width", /\.canvas is not allowed/],
    ["import('x')", /import\(\) is not available/],
    ["requestAnimationFrame(() => 0)", /requestAnimationFrame is not available/],
  ])("refuses %s", async (expr, why) => {
    expect((await problems(scene(`  ${expr};`))).join("\n")).toMatch(why);
  });

  it("refuses imports, async code and unknown exports", async () => {
    expect((await problems(scene("  x();", 'import { x } from "y";'))).join("\n")).toMatch(/imports are not available/);
    expect((await problems(scene("", "export async function helper() {}"))).join("\n")).toMatch(/async functions are not allowed/);
    expect((await problems(scene("", "export const fsp = 30;"))).join("\n")).toMatch(/exports only .* \(got fsp\)/);
    expect((await problems("export const fps = 30;\nexport const duration = 30;\n")).join("\n")).toMatch(/must export draw/);
  });

  it("follows scopes: a local name is fine, the same name elsewhere is the page's", async () => {
    expect(await problems(scene("  const fetch = (x: number) => x * 2;\n  fetch(t);"))).toEqual([]);
    expect(await problems(scene("  for (const [i, open] of [[1, 2]].entries()) api.rng(i, open[0]);"))).toEqual([]);
    expect(await problems(scene("  try { api.cue('x'); } catch (e) { api.rng(String(e).length); }"))).toEqual([]);
    const leak = await problems(scene("  { const open = 1; api.rng(open); }\n  open('x');"));
    expect(leak.join("\n")).toMatch(/open is not available/);
    expect(await problems(scene("  function f(): number { return g(); }\n  function g(): number { return 1; }\n  f();"))).toEqual([]);
  });

  it("strips TypeScript, type-only imports included, and reports lines of the scene's source", async () => {
    expect(await problems(scene("  const n: number = t as number;\n  api.rng(n);", 'import type { SceneApi } from "../kit.js";\ninterface Shot { at: number }'))).toEqual([]);
    const r = await lintScene(scene("  const a: number = 1;\n\n  Math.random();"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatchObject({ code: "banned", line: 7 });
  });

  it("refuses code that is not a module, and very long code", async () => {
    expect((await problems("export function draw( {"))[0]).toBeTruthy();
    expect((await problems(`// ${"x".repeat(130_000)}`))[0]).toMatch(/bytes/);
  });

  it("decodes source-map lines", () => {
    // Line 1 maps to source line 1, line 2 to source line 3.
    expect(sourceLines(JSON.stringify({ mappings: "AAAA;AAEA" }))).toEqual([1, 3]);
  });
});
