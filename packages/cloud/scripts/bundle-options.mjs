// esbuild options for the service bundle (dist/server.mjs) and the render
// worker's (dist/render-job.mjs), shared by scripts/build.mjs and the bundle
// smoke test (src/bundle.test.ts).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The engine loads its styles library with a dynamic import
 * (engine/src/styles/load.ts) so the web editor downloads it on first use. A
 * server has no use for that split, and a dynamically imported module makes
 * esbuild initialise it lazily (W53 B1, src/bundle.test.ts): load it
 * statically here.
 */
const staticStylesLibrary = {
  name: "static-styles-library",
  setup(build) {
    build.onLoad({ filter: /[\\/]engine[\\/]src[\\/]styles[\\/]load\.ts$/ }, (args) => ({
      contents: 'import { STYLE_FILES } from "./library.gen.js";\nexport const loadStyleFiles = () => Promise.resolve(STYLE_FILES);\n',
      loader: "ts",
      resolveDir: dirname(args.path),
    }));
  },
};

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
    // onnxruntime-node: native, optional, loaded on first use (subject mattes), resolved from the image's node_modules.
    // esbuild: Zenvi Motion builds block pages with it only from source; the bundle ships them prebuilt (dist/motion).
    external: ["onnxruntime-node", "esbuild"],
    plugins: [staticStylesLibrary],
    // CommonJS dependencies bundled into ESM still call require() for Node built-ins.
    banner: { js: "import { createRequire as __zenviCreateRequire } from 'node:module'; const require = __zenviCreateRequire(import.meta.url);" },
  };
}
