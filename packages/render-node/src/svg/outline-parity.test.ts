/**
 * Outlined type draws the same in Zenvi desktop (libopenshot's QtImageReader)
 * and resvg: every bundled family, set by the engine and drawn by both, within
 * 35 dB (the frame parity bar). Needs the desktop's Python with the libopenshot
 * 1.0 bindings (ZENVI_PARITY_PYTHON / ZENVI_PARITY_PYTHONPATH, as the engine's
 * frame parity test); skipped without them. The browser leg and a contact
 * sheet are in scripts/outline-parity.ts.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { FONT_FAMILIES, FONT_FAMILY_IDS, FontLibrary, bundledFamily, outlineSvgText } from "@zenvi/engine";
import { afterAll, describe, expect, it } from "vitest";
import { createAssetHost } from "../host/node-host.js";
import { engineAssetsDir } from "../resources.js";
import { rasterizeSvg } from "./rasterize.js";

const python = process.env.ZENVI_PARITY_PYTHON ?? `${homedir()}/Projects/zenvi/.venv/bin/python`;
const env = {
  ...process.env,
  PYTHONPATH: process.env.ZENVI_PARITY_PYTHONPATH ?? `${homedir()}/zenvi-deps-1.0/python`,
  DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH ?? `${homedir()}/zenvi-deps-1.0/lib`,
};
const reader = path.resolve(import.meta.dirname, "../../../engine/scripts/parity/svg_reader.py");
const enabled = existsSync(python) && spawnSync(python, ["-c", "import openshot, PyQt5"], { env, timeout: 120000 }).status === 0;

const dir = mkdtempSync(path.join(tmpdir(), "zenvi-outline-parity-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function psnrRgb(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c += 1) sum += (a[i + c]! - b[i + c]!) ** 2;
  const mse = sum / ((a.length / 4) * 3);
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

describe.skipIf(!enabled)("outlined type: desktop (Qt) vs resvg", () => {
  it("draws every bundled family within 35 dB", async () => {
    const assets = createAssetHost(engineAssetsDir()!);
    const lib = await FontLibrary.load((p) => assets.readBytes!(p), FONT_FAMILY_IDS);
    const files: string[] = [];
    for (const id of FONT_FAMILY_IDS) {
      const name = FONT_FAMILIES[id].name;
      const text =
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160"><rect width="640" height="160" fill="#101216"/>' +
        `<text x="320" y="100" text-anchor="middle" font-family="${name}" font-size="72" fill="#ffffff">Wave ${name.slice(0, 6)} 42</text></svg>`;
      const svg = outlineSvgText(text, lib, { family: bundledFamily }).svg;
      expect(svg, id).toContain("<path");
      const file = path.join(dir, `${id}.svg`);
      writeFileSync(file, svg);
      files.push(file);
    }
    const r = spawnSync(python, [reader, path.join(dir, "qt"), ...files], { env, encoding: "utf8", timeout: 300000 });
    expect(r.status, r.stderr).toBe(0);
    const failures: string[] = [];
    for (const line of r.stdout.trim().split("\n")) {
      const rec = JSON.parse(line) as { svg: string; path: string; width: number; height: number };
      const qt = readFileSync(rec.path);
      const resvg = await rasterizeSvg(readFileSync(rec.svg, "utf8"));
      expect([resvg.width, resvg.height]).toEqual([rec.width, rec.height]);
      const db = psnrRgb(qt, resvg.data);
      if (db < 35) failures.push(`${path.basename(rec.svg)}: ${db.toFixed(2)} dB`);
    }
    expect(failures).toEqual([]);
  }, 600000);
});
