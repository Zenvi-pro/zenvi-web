// Bundle the service into one ESM file, dist/server.mjs (+ source map), the
// render worker into dist/render-job.mjs (Azure Container Apps job executions,
// src/render-job.ts), plus the non-JS resources @zenvi/render-node loads at
// runtime, next to them:
//   dist/composite-worker.mjs  compositor worker threads (render-node CompositePool)
//   dist/resvg.wasm   SVG rasterizer (titles, transition masks)
//   dist/fonts/       bundled fallback fonts (OFL)
//   dist/assets/      engine assets (transition masks, title templates), when present
//   dist/motion/      Zenvi Motion block pages, prebuilt, and their OFL fonts
// `__ZENVI_BUNDLE__` tells render-node to look for them there
// (packages/render-node/src/resources.ts). The runtime image then needs only
// Node and ffmpeg.
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { serverBundleOptions } from "./bundle-options.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = dirname(root);
const outdir = join(root, "dist");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await rm(outdir, { recursive: true, force: true });
await build(serverBundleOptions(join(outdir, "server.mjs")));
await build(serverBundleOptions(join(outdir, "render-job.mjs"), "src/render-job.ts"));

// The compositor worker (render-node CompositePool) loads composite-worker.mjs
// next to the bundle; without it cloud renders composite on one thread.
await build({
  entryPoints: [join(packages, "render-node", "src", "render", "composite-worker.ts")],
  outfile: join(outdir, "composite-worker.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  legalComments: "none",
  logLevel: "warning",
  define: { __ZENVI_BUNDLE__: "true" },
  banner: { js: "import { createRequire as __zenviCreateRequire } from 'node:module'; const require = __zenviCreateRequire(import.meta.url);" },
});

await mkdir(outdir, { recursive: true });
const renderNodeRequire = createRequire(join(packages, "render-node", "package.json"));
await cp(renderNodeRequire.resolve("@resvg/resvg-wasm/index_bg.wasm"), join(outdir, "resvg.wasm"));
for (const [from, to] of [
  [join(packages, "render-node", "fonts"), join(outdir, "fonts")],
  [join(packages, "engine", "assets"), join(outdir, "assets")],
]) {
  if (await exists(from)) await cp(from, to, { recursive: true });
}

// Zenvi Motion: every block page prebuilt, and its fonts (packages/motion/src/node/page.ts motionDir).
// The page builder is TypeScript: bundle it, then run it on the motion package's sources. Its folder is
// inside the package, so the esbuild it loads to build each page resolves from the workspace's node_modules.
const pagesTmp = await mkdtemp(join(root, ".motion-pages-"));
try {
  const builder = join(pagesTmp, "build-pages.mjs");
  await build({
    entryPoints: [join(packages, "motion", "scripts", "build-pages.ts")],
    outfile: builder,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    logLevel: "warning",
    external: ["esbuild", "onnxruntime-node"],
    banner: { js: "import { createRequire as __zenviCreateRequire } from 'node:module'; const require = __zenviCreateRequire(import.meta.url);" },
  });
  const pages = spawnSync(process.execPath, [builder, "--out", join(outdir, "motion")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ZENVI_MOTION_DIR: join(packages, "motion") },
  });
  if (pages.status !== 0) throw new Error(`building the Zenvi Motion pages failed (exit ${pages.status})`);
} finally {
  await rm(pagesTmp, { recursive: true, force: true });
}
