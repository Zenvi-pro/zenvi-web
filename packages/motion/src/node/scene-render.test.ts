import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome } from "./chrome.js";
import { draftScene, renderScene, sceneHtml, SCENE_CSP, wrapScene } from "./scene-render.js";

let dir: string;
let env: NodeJS.ProcessEnv;
let chrome: string | undefined;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "zenvi-scene-test-"));
  chrome = process.env.ZENVI_CHROME ?? (await findChrome());
  env = { ...process.env, ZENVI_CACHE_DIR: dir, ...(chrome ? { ZENVI_CHROME: chrome } : {}) };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const scene = (draw: string, top = "", head = "export const fps = 30;\nexport const duration = 24;"): string => `${top}\n${head}\nexport function draw(ctx, t, api) {\n${draw}\n}\n`;
const job = (code: string, more: object = {}) => ({ code, width: 320, height: 180, fps: 30, env, frameMs: 400, ...more });
const codes = (r: { problems: { code: string; severity: string }[] }): string[] => r.problems.map((p) => `${p.severity} ${p.code}`);

describe("scene page", () => {
  it("hides the page's globals from the scene and hands its exports over", () => {
    const wrapped = wrapScene("const fps = 30;", [{ name: "fps", local: "fps" }]);
    expect(wrapped).toContain("function (window, self, globalThis, document");
    expect(wrapped).toContain("return { fps: fps }");
    expect(SCENE_CSP).toContain("connect-src 'none'");
    expect(SCENE_CSP).not.toContain("unsafe-eval");
    // A param cannot close the config's script element.
    expect(sceneHtml({ width: 2, height: 2, designWidth: 2, designHeight: 2, params: { x: "</script><script>" }, media: {}, renderFps: 30, alpha: false, seed: 1 })).not.toContain("</script><script>");
  });
});

describe("scenes in the sandbox", () => {
  it("checks the demo scene: every frame drawn, no problems, a contact sheet", async (t) => {
    if (!chrome) t.skip();
    const code = await readFile(new URL("../scene/examples/launch.ts", import.meta.url), "utf8");
    const r = await draftScene(job(code, { width: 640, height: 360, sheetPath: path.join(dir, "sheet.jpg") }));
    expect(codes(r)).toEqual([]);
    expect(r.info).toMatchObject({ fps: 60, duration: 360, alpha: false });
    expect(r.info!.cues.find((c) => c.name === "click")).toMatchObject({ kind: "click", frame: 135 });
    expect(r.cells.length).toBeGreaterThan(6);
    expect([...r.sheet!.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect(existsSync(path.join(dir, "sheet.jpg"))).toBe(true);
  });

  it("finds a scene that keeps state between frames", async (t) => {
    if (!chrome) t.skip();
    const r = await draftScene(job(scene("  n += 1;\n  api.rect(0, 0, (n * 37) % 900, 200, { fill: '#f00' });", "let n = 0;")));
    expect(codes(r)).toContain("error nondeterministic");
  });

  it("stops a scene that never finishes a frame", async (t) => {
    if (!chrome) t.skip();
    const started = Date.now();
    const r = await draftScene(job(scene("  if (t > 3) for (;;) {}")));
    expect(codes(r)).toEqual(["error timeout"]);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("finds nothing outside the walls: computed escapes throw, the canvas leads nowhere", async (t) => {
    if (!chrome) t.skip();
    const escape = await draftScene(job(scene("  const k = ['constr', 'uctor'].join('');\n  const F = (api.rect as any)[k];\n  F('return 1')();")));
    expect(codes(escape)).toEqual(["error draw-error"]);
    expect(escape.problems[0]!.message).toMatch(/not available in a scene/);
    const canvas = await draftScene(job(scene("  const c = (ctx as any)[['can', 'vas'].join('')];\n  api.rect(0, 0, c.width, 10);")));
    expect(codes(canvas)).toEqual(["error draw-error"]);
    const thrown = await draftScene(job(scene("  if (t >= 12) throw new Error('nope');")));
    expect(thrown.problems[0]).toMatchObject({ code: "draw-error", frames: { from: 12, to: 12 } });
    expect(thrown.problems[0]!.message).toMatch(/nope/);
  });

  it("holds flashes to WCAG 2.3.1 unless the user asked for a strobe", async (t) => {
    if (!chrome) t.skip();
    const strobe = scene("  ctx.fillStyle = Math.floor(t / 2) % 2 ? '#fff' : '#000';\n  ctx.fillRect(0, 0, api.W, api.H);");
    expect(codes(await draftScene(job(strobe)))).toContain("error flashing");
    const allowed = await draftScene(job(strobe, { allowStrobe: true }));
    expect(codes(allowed)).toContain("warning flashing");
    expect(codes(allowed)).not.toContain("error flashing");
  });

  it("audits the layout of the text it draws", async (t) => {
    if (!chrome) t.skip();
    const r = await draftScene(job(scene("  api.text('Off the edge', { x: 0, y: 40, size: 64 });\n  api.text('tiny', { x: 900, y: 500, size: 12 });", "", "export const fps = 30;\nexport const duration = 24;\nexport const cues = { hit: { at: 6, kind: 'impact' } };")));
    expect(codes(r).sort()).toEqual(["warning blank", "warning safe-area", "warning small-text"]);
  });

  it("renders a scene with its picture events, cached by fingerprint, and refuses one with errors", async (t) => {
    if (!chrome) t.skip();
    const code = scene("  api.rect(api.tween(0, 20, 0, 1600), 400, 200, 200, { fill: api.palette.accent, radius: 30 });", "", "export const fps = 30;\nexport const duration = 24;\nexport const cues = { land: { at: 20, kind: 'land', weight: 0.6, cut: true } };");
    const out = await renderScene({ ...job(code), motionBlurSamples: 2 });
    expect(out.ok, out.ok ? "" : out.problems.map((p) => p.message).join("; ")).toBe(true);
    if (!out.ok) return;
    expect(out).toMatchObject({ codec: "h264", width: 320, height: 180, frames: 24, cached: false });
    expect(out.events).toEqual([{ t: 0.667, kind: "land", weight: 0.6, x: 0.5, y: 0.5 }]);
    const frames = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out.path]).toString().trim();
    expect(frames).toBe("24");
    const again = await renderScene({ ...job(code), motionBlurSamples: 2 });
    expect(again).toMatchObject({ ok: true, cached: true, path: out.path });
    const bad = await renderScene({ ...job(scene("  Math.random();")), motionBlurSamples: 1 });
    expect(bad).toMatchObject({ ok: false, problems: [expect.objectContaining({ code: "lint" })] });
  });
});
