/**
 * A block's page: its block.ts bundled with the runtime (esbuild, one IIFE),
 * the shared and block CSS, the bundled fonts, and the render config.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { BlockConfig } from "../config.js";
import { FONT_FACES } from "../tokens.js";

/** The package folder (`packages/motion`); `ZENVI_MOTION_DIR` overrides it for bundled installs. */
export function motionDir(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.ZENVI_MOTION_DIR?.trim();
  if (named) return named;
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
  const dir = path.join(root, "src", "blocks", id);
  const entry = path.join(dir, "block.ts");
  if (!existsSync(entry)) throw new Error(`block ${id} has no block.ts`);
  const runtime = path.join(root, "src", "runtime", "index.ts");
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
  const hash = createHash("sha256").update(script).update("\0").update(css);
  const fonts = path.join(root, "fonts");
  for (const name of (await readdir(fonts)).sort()) hash.update(name).update(await readFile(path.join(fonts, name)));
  return { script, css, codeHash: hash.digest("hex") };
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
