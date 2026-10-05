#!/usr/bin/env node
/**
 * Assemble the Zenvi Link extension folder, dist/pro.zenvi.link/:
 *   CSXS/manifest.xml   version from src/version.ts
 *   host/aeft.jsx       common + aeft host scripts with ZenviLink.TASTE/CATALOG injected (src/host-bundle.ts)
 *   host/ppro.jsx       common + ppro host scripts, likewise
 *   catalog/*.json      checked against src/catalog (run gen:catalog when stale)
 *   server/ panel/ icons/ package.json, and .debug for dev builds
 *
 *   npm run build -w @zenvi/adobe-link                # dev build
 *   npm run build -w @zenvi/adobe-link -- --release   # without .debug (what package:zxp signs)
 *   npm run build -w @zenvi/adobe-link -- --out DIR   # another output folder
 *
 * Runs under tsx (it imports the TypeScript sources).
 */

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_APPS, PACKAGE_ROOT, bundleHostScript } from "../src/host-bundle.ts";
import { HOST_IDS, catalogFileName, catalogFileText } from "../src/catalog/index.ts";
import { LINK_VERSION } from "../src/version.ts";
import { BUNDLE_ID } from "../src/install.ts";

export { BUNDLE_ID };
export const DEFAULT_OUT = path.join(PACKAGE_ROOT, "dist");
const SOURCE = path.join(PACKAGE_ROOT, "extension");

function listFiles(dir, base = dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join("/")];
    })
    .sort();
}

/** Build into `<outDir>/pro.zenvi.link`; returns {dir, files}. Throws when a catalog is stale. */
export function buildExtension({ outDir = DEFAULT_OUT, release = false } = {}) {
  for (const host of HOST_IDS) {
    const file = path.join(SOURCE, "catalog", catalogFileName(host));
    if (readFileSync(file, "utf8") !== catalogFileText(host)) {
      throw new Error(`${path.relative(process.cwd(), file)} is stale: run npm run gen:catalog -w @zenvi/adobe-link`);
    }
  }
  const dir = path.join(outDir, BUNDLE_ID);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "CSXS"), { recursive: true });
  mkdirSync(path.join(dir, "host"));
  const manifest = readFileSync(path.join(SOURCE, "CSXS", "manifest.xml"), "utf8").replaceAll("__VERSION__", LINK_VERSION);
  writeFileSync(path.join(dir, "CSXS", "manifest.xml"), manifest);
  for (const folder of ["server", "panel", "icons", "catalog"]) {
    cpSync(path.join(SOURCE, folder), path.join(dir, folder), { recursive: true });
  }
  cpSync(path.join(SOURCE, "package.json"), path.join(dir, "package.json"));
  for (const app of HOST_APPS) writeFileSync(path.join(dir, "host", `${app}.jsx`), bundleHostScript(app).text);
  if (!release) cpSync(path.join(SOURCE, ".debug"), path.join(dir, ".debug"));
  return { dir, files: listFiles(dir) };
}

function main(argv) {
  const out = argv.indexOf("--out");
  const { dir, files } = buildExtension({ outDir: out >= 0 ? path.resolve(argv[out + 1]) : DEFAULT_OUT, release: argv.includes("--release") });
  console.log(`Built Zenvi Link ${LINK_VERSION}${argv.includes("--release") ? " (release)" : ""}: ${dir} (${files.length} files)`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
