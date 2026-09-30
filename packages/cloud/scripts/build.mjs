// Bundle the service into one ESM file: dist/server.mjs (+ source map).
// Everything, including node_modules, goes into the bundle, so the runtime
// image needs only Node and ffmpeg.
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, "dist");

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: [join(root, "src/main.ts")],
  outfile: join(outdir, "server.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  // CommonJS dependencies bundled into ESM still call require() for Node built-ins.
  banner: { js: "import { createRequire as __zenviCreateRequire } from 'node:module'; const require = __zenviCreateRequire(import.meta.url);" },
});
