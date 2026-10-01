#!/usr/bin/env node
/**
 * Build the single-file `zenvi` CLI: packages/cli/dist/zenvi.mjs plus the
 * resources it loads at runtime (resvg WebAssembly, the OFL fallback font,
 * engine assets such as transition masks and title templates), then mirror
 * the result into plugins/zenvi/dist (committed: marketplace installs of the
 * Claude Code plugin do not build).
 *
 *   npm run build -w @zenvi/cli            # build + copy into the plugin
 *   node packages/cli/scripts/build.mjs --no-plugin
 */

import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..");
const repoRoot = path.resolve(cliRoot, "..", "..");
const dist = path.join(cliRoot, "dist");
const pluginDist = path.join(repoRoot, "plugins", "zenvi", "dist");
const withPlugin = !process.argv.includes("--no-plugin");

const pkg = JSON.parse(await readFile(path.join(cliRoot, "package.json"), "utf8"));
const require = createRequire(import.meta.url);

/** Engine asset folders the Node runtime reads (effect icons ship for tools that list effects). */
const ENGINE_ASSETS = ["transitions", "titles", "effects", "emojis", "colors"];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await build({
  entryPoints: [path.join(cliRoot, "src", "bin.ts")],
  outfile: path.join(dist, "zenvi.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "eof",
  metafile: true,
  logLevel: "warning",
  define: {
    __ZENVI_BUNDLE__: "true",
    __ZENVI_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    // Bundled CommonJS dependencies (ajv, …) call require() for Node built-ins.
    // (esbuild keeps src/bin.ts's hashbang as the first line.)
    js: [
      "import { createRequire as __zenviCreateRequire } from 'node:module';",
      "const require = __zenviCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});

// The compositor worker (render-node CompositePool) is its own file next to the bundle.
await build({
  entryPoints: [path.join(repoRoot, "packages", "render-node", "src", "render", "composite-worker.ts")],
  outfile: path.join(dist, "composite-worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "eof",
  logLevel: "warning",
  define: { __ZENVI_BUNDLE__: "true", __ZENVI_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    js: ["import { createRequire as __zenviCreateRequire } from 'node:module';", "const require = __zenviCreateRequire(import.meta.url);"].join("\n"),
  },
});

// Runtime resources next to the bundle (paths: render-node src/resources.ts).
await cp(require.resolve("@resvg/resvg-wasm/index_bg.wasm"), path.join(dist, "resvg.wasm"));
await cp(path.join(repoRoot, "packages", "render-node", "fonts"), path.join(dist, "fonts"), { recursive: true });
const engineAssets = path.join(repoRoot, "packages", "engine", "assets");
const copiedAssets = [];
for (const folder of ENGINE_ASSETS) {
  const src = path.join(engineAssets, folder);
  if (await exists(src)) {
    await cp(src, path.join(dist, "assets", folder), { recursive: true });
    copiedAssets.push(folder);
  }
}
await writeFile(
  path.join(dist, "LICENSES.md"),
  [
    "# Third-party components in this bundle",
    "",
    "- zenvi (this CLI): GPL-3.0-or-later.",
    "- resvg-wasm (resvg.wasm): MPL-2.0, https://github.com/yisibl/resvg-js.",
    "- Lato (fonts/Lato-Regular.ttf): SIL Open Font License 1.1, see fonts/OFL.txt.",
    "- JavaScript dependencies: license comments at the end of zenvi.mjs.",
    "",
  ].join("\n"),
);
await chmod(path.join(dist, "zenvi.mjs"), 0o755);

const bytes = (await stat(path.join(dist, "zenvi.mjs"))).size;
console.log(`built ${path.relative(repoRoot, path.join(dist, "zenvi.mjs"))} (${(bytes / 1e6).toFixed(2)} MB; assets: ${copiedAssets.join(", ") || "none"})`);
if (process.env.ZENVI_BUILD_METAFILE) await writeFile(process.env.ZENVI_BUILD_METAFILE, JSON.stringify(result.metafile));

if (withPlugin) {
  await rm(pluginDist, { recursive: true, force: true });
  await cp(dist, pluginDist, { recursive: true });
  console.log(`copied to ${path.relative(repoRoot, pluginDist)}`);
}
