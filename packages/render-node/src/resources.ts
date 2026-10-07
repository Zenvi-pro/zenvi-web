/**
 * Where render-node's non-JS resources live.
 *
 * In the monorepo they are resolved from node_modules and this package's
 * `fonts/` folder. In the single-file CLI bundle (`packages/cli/dist`) the
 * build copies them next to `zenvi.mjs`; the build defines
 * `__ZENVI_BUNDLE__` so this module knows to look there. `ZENVI_RESOURCES_DIR`
 * overrides both.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

declare const __ZENVI_BUNDLE__: boolean | undefined;

/** Directory of the running bundle, when running from the CLI bundle. */
export function bundleDir(): string | undefined {
  if (typeof __ZENVI_BUNDLE__ !== "undefined" && __ZENVI_BUNDLE__) {
    return path.dirname(fileURLToPath(import.meta.url));
  }
  return undefined;
}

function resourcesOverride(): string | undefined {
  const dir = process.env.ZENVI_RESOURCES_DIR?.trim();
  return dir ? dir : undefined;
}

const packageRoot = (): string => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Path to resvg's WebAssembly module. */
export function resvgWasmPath(): string {
  const override = resourcesOverride();
  if (override && existsSync(path.join(override, "resvg.wasm"))) return path.join(override, "resvg.wasm");
  const bundle = bundleDir();
  if (bundle) return path.join(bundle, "resvg.wasm");
  return createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
}

/** Folder holding the bundled fallback fonts (OFL, see fonts/OFL.txt). */
export function bundledFontsDir(): string {
  const override = resourcesOverride();
  if (override && existsSync(path.join(override, "fonts"))) return path.join(override, "fonts");
  const bundle = bundleDir();
  if (bundle) return path.join(bundle, "fonts");
  return path.join(packageRoot(), "fonts");
}

/**
 * Engine assets (transition masks, title templates, emojis) on disk. The
 * engine is pure and cannot read files; Node hosts resolve `@transitions/…`
 * style paths against this folder.
 */
export function engineAssetsDir(): string | undefined {
  const override = process.env.ZENVI_ASSETS_DIR?.trim();
  if (override) return override;
  const res = resourcesOverride();
  if (res && existsSync(path.join(res, "assets"))) return path.join(res, "assets");
  const bundle = bundleDir();
  if (bundle) return path.join(bundle, "assets");
  const dev = path.resolve(packageRoot(), "..", "engine", "assets");
  return existsSync(dev) ? dev : undefined;
}
