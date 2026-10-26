/** Prebuild every block page + fonts into a folder (the CLI bundle's `motion/`): `npx tsx packages/motion/scripts/build-pages.ts --out <dir>`. */

import { parseArgs } from "node:util";
import { writeBlockPages } from "../src/node/index.js";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (!values.out) throw new Error("usage: build-pages.ts --out <dir>");
const ids = await writeBlockPages(values.out);
console.log(`motion pages: ${ids.join(", ")}`);
