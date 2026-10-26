/**
 * Type specimen and renderer parity for the engine's outlined type.
 *
 *   npx tsx packages/render-node/scripts/outline-parity.ts OUT_DIR
 *
 * Writes OUT_DIR/specimen.png (every bundled family) and a parity check: the
 * same title SVG once as `<text>` naming the bundled families and once
 * outlined (`outlineSvgText`), drawn by
 *   - Zenvi desktop's reader (libopenshot 1.0 QtImageReader, Qt SVG), through
 *     packages/engine/scripts/parity/svg_reader.py
 *     (ZENVI_PARITY_PYTHON / ZENVI_PARITY_PYTHONPATH as in the frame parity test),
 *   - resvg (CLI, Zenvi Cloud), and
 *   - Chromium drawing it through `<img>` like the web editor (Playwright's
 *     headless shell, when installed: `npx playwright install chromium-headless-shell`).
 * OUT_DIR/parity.png puts the six renders side by side; parity.json has the PSNR
 * of every pair. Outlines should agree (≥ 35 dB); `<text>` falls back to other
 * fonts wherever the family is not installed.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_FAMILIES, FONT_FAMILY_IDS, FontLibrary, outlineCommands, outlineSvgText, typeset, bundledFamily, type FontFamilyId, type RgbaImage } from "@zenvi/engine";
import { encodePng, rasterizeSvg } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const assets = path.join(repo, "packages/engine/assets");
const out = path.resolve(process.argv[2] ?? "outline-parity");
mkdirSync(out, { recursive: true });

const lib = await FontLibrary.load(async (p) => new Uint8Array(readFileSync(path.join(assets, p))), FONT_FAMILY_IDS);

const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function pathOf(text: string, family: FontFamilyId, size: number, x: number, y: number, extra: { weight?: number; italic?: boolean; tracking?: number } = {}): string {
  const block = typeset(lib, text, { family, size, ...extra });
  return outlineCommands(block.glyphs, x, y - block.ascent)
    .map((c) => (typeof c === "number" ? fmt(c) : c))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Specimen
// ---------------------------------------------------------------------------

const SAMPLES: Record<FontFamilyId, string> = {
  inter: "Every word lands on the beat — 0123",
  anton: "STOP SCROLLING. 3X FASTER",
  "bebas-neue": "THE ONLY EDIT YOU NEED",
  "archivo-black": "Big. Bold. Loud.",
  "instrument-serif": "A quiet, editorial voice",
  "space-mono": "frame 0042 / 24 fps / 9:16",
  "varela-round": "friendly rounded captions",
  "caveat-brush": "handwritten, on the marker",
  silkscreen: "PIXEL HUD 8-BIT",
};

function specimen(): string {
  const W = 1600;
  const rows: string[] = [];
  let y = 70;
  const label = (text: string, yy: number) => `<path d="${pathOf(text, "inter", 20, 60, yy, { weight: 500, tracking: 0.04 })}" fill="#8a8f98"/>`;
  rows.push(`<path d="${pathOf("Zenvi bundled type — outlines, identical in Qt, resvg and the browser", "inter", 34, 60, y, { weight: 700 })}" fill="#ffffff"/>`);
  y += 70;
  for (const id of FONT_FAMILY_IDS) {
    const f = FONT_FAMILIES[id];
    rows.push(label(`${f.name.toUpperCase()} · ${f.category.toUpperCase()} · OFL 1.1`, y));
    y += 84;
    rows.push(`<path d="${pathOf(SAMPLES[id], id, 72, 60, y)}" fill="${id === "anton" || id === "bebas-neue" ? "#ff3b30" : "#f4f4f2"}"/>`);
    if (id === "instrument-serif") rows.push(`<path d="${pathOf("in italic", id, 72, 60 + typeset(lib, SAMPLES[id], { family: id, size: 72 }).width + 24, y, { italic: true })}" fill="#ffd60a"/>`);
    y += 44;
  }
  rows.push(label("INTER VARIABLE · WEIGHT 200 / 400 / 600 / 900 · OPTICAL SIZE 14 → 32", y + 10));
  y += 90;
  let x = 60;
  for (const weight of [200, 400, 600, 900]) {
    rows.push(`<path d="${pathOf("Aa", "inter", 72, x, y, { weight })}" fill="#f4f4f2"/>`);
    x += typeset(lib, "Aa", { family: "inter", size: 72, weight }).width + 40;
  }
  for (const opsz of [14, 32]) {
    const block = typeset(lib, "Rag", { family: "inter", size: 72, opticalSize: opsz });
    rows.push(`<path d="${outlineCommands(block.glyphs, x, y - block.ascent).map((c) => (typeof c === "number" ? fmt(c) : c)).join(" ")}" fill="#64d2ff"/>`);
    x += block.width + 40;
  }
  y += 50;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}"><rect width="${W}" height="${y}" fill="#0f1013"/>${rows.join("")}</svg>\n`;
}

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

const PARITY_W = 960;
const PARITY_H = 640;

function parityText(): string {
  const lines: [FontFamilyId, string, number, string][] = [
    ["anton", "THIS CHANGES EVERYTHING", 64, "#ff3b30"],
    ["inter", "Kerning: AVATAR Type Wave", 48, "#ffffff"],
    ["bebas-neue", "TWO WORDS", 80, "#ffd60a"],
    ["instrument-serif", "Editorial serif, gently", 54, "#ffffff"],
    ["archivo-black", "HEAVY DISPLAY", 50, "#64d2ff"],
    ["space-mono", "00:42 / REC", 40, "#30d158"],
    ["caveat-brush", "marker hand", 56, "#ffffff"],
    ["silkscreen", "PIXEL 8BIT", 40, "#ff9f0a"],
  ];
  let y = 0;
  const body = lines
    .map(([id, text, size, fill]) => {
      y += size * 1.12;
      return `<text x="${PARITY_W / 2}" y="${fmt(y)}" text-anchor="middle" font-family="${FONT_FAMILIES[id].name}" font-size="${size}" fill="${fill}">${esc(text)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PARITY_W}" height="${PARITY_H}" viewBox="0 0 ${PARITY_W} ${PARITY_H}"><rect width="${PARITY_W}" height="${PARITY_H}" fill="#14161c"/>${body}</svg>\n`;
}

function qtRender(files: string[]): Map<string, RgbaImage> | null {
  const python = process.env.ZENVI_PARITY_PYTHON ?? `${homedir()}/Projects/zenvi/.venv/bin/python`;
  const env = {
    ...process.env,
    PYTHONPATH: process.env.ZENVI_PARITY_PYTHONPATH ?? `${homedir()}/zenvi-deps-1.0/python`,
    DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH ?? `${homedir()}/zenvi-deps-1.0/lib`,
  };
  const r = spawnSync(python, [path.join(repo, "packages/engine/scripts/parity/svg_reader.py"), path.join(out, "qt"), ...files], { env, encoding: "utf8" });
  if (r.status !== 0) {
    console.warn(`libopenshot reader unavailable: ${(r.stderr || r.error?.message || "").trim().split("\n").pop()}`);
    return null;
  }
  const images = new Map<string, RgbaImage>();
  for (const line of r.stdout.trim().split("\n")) {
    const rec = JSON.parse(line) as { svg: string; path: string; width: number; height: number };
    images.set(rec.svg, { width: rec.width, height: rec.height, data: new Uint8ClampedArray(readFileSync(rec.path)) });
  }
  return images;
}

function decodePng(png: Buffer): RgbaImage {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", "-i", "pipe:0"], { input: png, encoding: "utf8" });
  const [width, height] = probe.stdout.trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { input: png, maxBuffer: 1 << 28 });
  return { width: width!, height: height!, data: new Uint8ClampedArray(r.stdout) };
}

async function chromiumRender(svgs: string[]): Promise<RgbaImage[] | null> {
  let pw: typeof import("playwright");
  try {
    pw = await import("playwright");
  } catch {
    return null;
  }
  let browser;
  try {
    browser = await pw.chromium.launch();
  } catch (error) {
    console.warn(`Chromium unavailable: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return null;
  }
  const page = await browser.newPage({ viewport: { width: PARITY_W, height: PARITY_H }, deviceScaleFactor: 1 });
  const images: RgbaImage[] = [];
  for (const svg of svgs) {
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    await page.setContent(`<html><body style="margin:0;background:#000"><img src="${src}" width="${PARITY_W}" height="${PARITY_H}" style="display:block"></body></html>`);
    await page.waitForFunction(() => document.images[0]?.complete);
    images.push(decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: PARITY_W, height: PARITY_H } })));
  }
  await browser.close();
  return images;
}

function psnr(a: RgbaImage, b: RgbaImage): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const d = a.data[i + c]! - b.data[i + c]!;
      sum += d * d;
      n += 1;
    }
  }
  const mse = sum / n;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** Images side by side in a grid (each `cols` wide), on black. */
function sheet(images: (RgbaImage | null)[], cols: number): RgbaImage {
  const w = PARITY_W;
  const h = PARITY_H;
  const rows = Math.ceil(images.length / cols);
  const gap = 8;
  const width = cols * w + (cols - 1) * gap;
  const height = rows * h + (rows - 1) * gap;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  images.forEach((img, k) => {
    if (!img) return;
    const ox = (k % cols) * (w + gap);
    const oy = Math.floor(k / cols) * (h + gap);
    for (let y = 0; y < h; y += 1) data.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * width + ox) * 4);
  });
  return { width, height, data };
}

const spec = specimen();
writeFileSync(path.join(out, "specimen.svg"), spec);
writeFileSync(path.join(out, "specimen.png"), encodePng(await rasterizeSvg(spec)));

const text = parityText();
const outlined = outlineSvgText(text, lib, { family: (css) => bundledFamily(css) }).svg;
const files = { text: path.join(out, "parity-text.svg"), outline: path.join(out, "parity-outline.svg") };
writeFileSync(files.text, text);
writeFileSync(files.outline, outlined);

const renders: Record<string, Record<string, RgbaImage | null>> = { text: {}, outline: {} };
const qt = qtRender([files.text, files.outline]);
const chrome = await chromiumRender([text, outlined]);
for (const [variant, svg] of [["text", text], ["outline", outlined]] as const) {
  renders[variant]!.qt = qt?.get(files[variant]) ?? null;
  renders[variant]!.resvg = await rasterizeSvg(svg);
  renders[variant]!.chromium = chrome ? chrome[variant === "text" ? 0 : 1]! : null;
}

const report: Record<string, Record<string, number | null>> = {};
for (const variant of ["text", "outline"] as const) {
  const r = renders[variant]!;
  const pair = (a: string, b: string) => (r[a] && r[b] ? Math.round(psnr(r[a]!, r[b]!) * 100) / 100 : null);
  report[variant] = { "qt-resvg": pair("qt", "resvg"), "qt-chromium": pair("qt", "chromium"), "resvg-chromium": pair("resvg", "chromium") };
  for (const [name, img] of Object.entries(r)) if (img) writeFileSync(path.join(out, `parity-${variant}-${name}.png`), encodePng(img));
}
// Rows: Qt (desktop), resvg (CLI / cloud), Chromium (web editor); columns: <text>, outlines.
const grid = ["qt", "resvg", "chromium"].flatMap((name) => [renders.text![name] ?? null, renders.outline![name] ?? null]);
writeFileSync(path.join(out, "parity.png"), encodePng(sheet(grid, 2)));
writeFileSync(path.join(out, "parity.json"), `${JSON.stringify({ psnr_db: report, rows: ["qt", "resvg", "chromium"], columns: ["text", "outline"] }, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
