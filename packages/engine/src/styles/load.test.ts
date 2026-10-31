import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STYLE_FILES } from "./library.gen.js";
import { loadStyleFiles } from "./load.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

describe("the styles library loads lazily", () => {
  it("serves the same files, once", async () => {
    const first = loadStyleFiles();
    expect(loadStyleFiles()).toBe(first);
    expect(await first).toBe(STYLE_FILES);
  });

  it("is imported statically only by the @zenvi/engine/styles subpath, so the editor's bundle splits it off", () => {
    const static_ = sources(SRC).filter((f) => !f.startsWith(path.join(SRC, "styles") + path.sep) && /^import [^;]*from "[./]*(?:\.\.\/)*styles\/(?:index|library\.gen)\.js"/m.test(readFileSync(f, "utf8")));
    expect(static_.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
