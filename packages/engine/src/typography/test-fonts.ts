// Test support: the bundled fonts read from disk, as render-node's asset host reads them.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FontBytesReader } from "./library.js";

const ASSETS = join(import.meta.dirname, "..", "..", "assets");

export const readBundledFont: FontBytesReader = async (path) => new Uint8Array(await readFile(join(ASSETS, path)));
