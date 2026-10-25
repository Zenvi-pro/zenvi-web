// esbuild options for the service bundle (dist/server.mjs) and the render
// worker's (dist/render-job.mjs), shared by scripts/build.mjs and the bundle
// smoke test (src/bundle.test.ts).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * @param {string} outfile
 * @param {string} [entry] source entry, relative to the package
 */
export function serverBundleOptions(outfile, entry = "src/main.ts") {
  return {
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: true,
    legalComments: "none",
    logLevel: "info",
    define: { __ZENVI_BUNDLE__: "true" },
    // CommonJS dependencies bundled into ESM still call require() for Node built-ins.
    banner: { js: "import { createRequire as __zenviCreateRequire } from 'node:module'; const require = __zenviCreateRequire(import.meta.url);" },
  };
}
