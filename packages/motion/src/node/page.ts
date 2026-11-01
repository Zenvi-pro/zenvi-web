/**
 * A block's page: its block.ts bundled with the runtime (esbuild, one IIFE),
 * the shared and block CSS, the bundled fonts, and the render config.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleDir } from "@zenvi/render-node";
import { BLOCKS } from "../catalog.js";
import type { BlockConfig } from "../config.js";
import { FONT_FACES } from "../tokens.js";

/**
 * Where the blocks and fonts are: `ZENVI_MOTION_DIR`, else `motion/` next to
 * the CLI bundle (prebuilt pages, `writeBlockPages`), else this package.
 */
export function motionDir(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.ZENVI_MOTION_DIR?.trim();
  if (named) return named;
  const bundle = bundleDir();
  if (bundle) return path.join(bundle, "motion");
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export interface BlockPage {
  /** The bundled script. */
  script: string;
  css: string;
  /** Hash of everything that shapes the page (block code, runtime, CSS, fonts): part of the render fingerprint. */
  codeHash: string;
}

const cache = new Map<string, Promise<BlockPage>>();

/** Build (once per process) the page assets of block `id`. */
export function blockPage(id: string, env: NodeJS.ProcessEnv = process.env): Promise<BlockPage> {
  const root = motionDir(env);
  const key = `${root}\0${id}`;
  let page = cache.get(key);
  if (!page) {
    page = buildPage(root, id);
    page.catch(() => cache.delete(key));
    cache.set(key, page);
  }
  return page;
}

async function buildPage(root: string, id: string): Promise<BlockPage> {
  const prebuilt = path.join(root, "pages", id);
  if (existsSync(`${prebuilt}.js`)) {
    const [script, css] = await Promise.all([readFile(`${prebuilt}.js`, "utf8"), readFile(`${prebuilt}.css`, "utf8")]);
    return { script, css, codeHash: await pageHash(root, script, css) };
  }
  const dir = path.join(root, "src", "blocks", id);
  const entry = path.join(dir, "block.ts");
  if (!existsSync(entry)) throw new Error(`block ${id} has no block.ts`);
  const runtime = path.join(root, "src", "runtime", "index.ts");
  // Loaded only to build from source: bundled installs ship prebuilt pages.
  const { build } = await import("esbuild");
  const result = await build({
    stdin: {
      contents: `import { build } from ${JSON.stringify(entry)};\nimport { defineBlock } from ${JSON.stringify(runtime)};\ndefineBlock(build);\n`,
      resolveDir: dir,
      loader: "ts",
      sourcefile: `${id}-entry.ts`,
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    write: false,
    minify: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const script = result.outputFiles[0]!.text;
  const base = await readFile(path.join(root, "src", "blocks", "base.css"), "utf8");
  const own = existsSync(path.join(dir, "block.css")) ? await readFile(path.join(dir, "block.css"), "utf8") : "";
  const css = `${base}\n${own}`;
  return { script, css, codeHash: await pageHash(root, script, css) };
}

/** Hash of a page's script, CSS and the bundled fonts. */
export async function pageHash(root: string, script: string, css: string): Promise<string> {
  const hash = createHash("sha256").update(script).update("\0").update(css);
  const fonts = path.join(root, "fonts");
  for (const name of (await readdir(fonts)).sort()) hash.update(name).update(await readFile(path.join(fonts, name)));
  return hash.digest("hex");
}

export interface ScenePage {
  /** The scene runtime (scene/page.ts and the kit), one IIFE. */
  script: string;
  /** Hash of the runtime and the fonts: part of every scene fingerprint. */
  hash: string;
}

const scenePages = new Map<string, Promise<ScenePage>>();

/** The scene runtime, bundled once per process; prebuilt beside the CLI bundle (`pages/__scene.js`). */
export function scenePage(env: NodeJS.ProcessEnv = process.env): Promise<ScenePage> {
  const root = motionDir(env);
  let page = scenePages.get(root);
  if (!page) {
    page = (async () => {
      const prebuilt = path.join(root, "pages", "__scene.js");
      let script: string;
      if (existsSync(prebuilt)) script = await readFile(prebuilt, "utf8");
      else {
        const { build } = await import("esbuild");
        const result = await build({ entryPoints: [path.join(root, "src", "scene", "page.ts")], bundle: true, format: "iife", platform: "browser", target: "chrome120", write: false, legalComments: "none", logLevel: "silent" });
        script = result.outputFiles[0]!.text;
      }
      return { script, hash: await pageHash(root, script, "") };
    })();
    page.catch(() => scenePages.delete(root));
    scenePages.set(root, page);
  }
  return page;
}

/** Prebuild every block's page and the scene runtime, and copy the fonts into `outDir` (the CLI bundle's `motion/` folder). */
export async function writeBlockPages(outDir: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  await mkdir(path.join(outDir, "pages"), { recursive: true });
  for (const block of BLOCKS) {
    const page = await blockPage(block.id, env);
    await writeFile(path.join(outDir, "pages", `${block.id}.js`), page.script);
    await writeFile(path.join(outDir, "pages", `${block.id}.css`), page.css);
  }
  await writeFile(path.join(outDir, "pages", "__scene.js"), (await scenePage(env)).script);
  await cp(path.join(motionDir(env), "fonts"), path.join(outDir, "fonts"), { recursive: true });
  return BLOCKS.map((b) => b.id);
}

function fontFaces(): string {
  return FONT_FACES.map((f) => `@font-face { font-family: '${f.family}'; src: url('/fonts/${f.file}') format('woff2'); font-weight: ${f.weight}; font-style: ${f.style}; font-display: block; }`).join("\n");
}

/** `<` escaped so the config cannot close the script element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function pageHtml(page: BlockPage, config: BlockConfig): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=${config.width}, height=${config.height}">
<style>${fontFaces()}
${page.css}</style>
</head><body>
<script>window.__ZENVI_BLOCK__ = ${scriptJson(config)};</script>
<script src="/block.js"></script>
</body></html>`;
}
