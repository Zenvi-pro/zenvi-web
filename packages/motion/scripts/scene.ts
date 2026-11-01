/**
 * Check or render a scene from the command line (development and review):
 *
 *   npx tsx packages/motion/scripts/scene.ts packages/motion/src/scene/examples/launch.ts --out /tmp/scene \
 *     [--size 1920x1080] [--fps 30] [--render] [--draft] [--blur 4] [--params '{"headline":"…"}'] [--media hero=photo.jpg]
 *
 * Writes <out>/contact.jpg and <out>/problems.json; with --render also <out>/scene.mp4 (.mov with alpha).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { draftScene, renderScene } from "../src/node/scene-render.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "/tmp/zenvi-scene" },
    size: { type: "string", default: "1920x1080" },
    fps: { type: "string", default: "30" },
    params: { type: "string", default: "{}" },
    media: { type: "string", multiple: true },
    render: { type: "boolean" },
    draft: { type: "boolean" },
    blur: { type: "string" },
    strobe: { type: "boolean" },
  },
});
const file = positionals[0];
if (!file) throw new Error("usage: scene.ts <scene.ts> [--out dir] [--size WxH] [--render]");
const [width, height] = values.size.split("x").map(Number) as [number, number];
const job = {
  code: await readFile(file, "utf8"),
  params: JSON.parse(values.params) as Record<string, unknown>,
  media: Object.fromEntries((values.media ?? []).map((m) => m.split("=", 2) as [string, string])),
  width,
  height,
  fps: Number(values.fps),
  allowStrobe: values.strobe === true,
};
await mkdir(values.out, { recursive: true });
const draft = await draftScene({ ...job, sheetPath: path.join(values.out, "contact.jpg") });
await writeFile(path.join(values.out, "problems.json"), JSON.stringify({ info: draft.info, problems: draft.problems, cells: draft.cells }, null, 2));
console.log(`checked in ${draft.checkSeconds}s: ${draft.problems.length} problem(s)`);
for (const p of draft.problems) console.log(`  ${p.severity} ${p.code}${p.frames ? ` [${p.frames.from}-${p.frames.to}]` : ""}${p.line ? ` line ${p.line}` : ""}: ${p.message}`);
if (values.render) {
  const out = path.join(values.out, "scene.mp4");
  const result = await renderScene({ ...job, draft: values.draft, motionBlurSamples: values.blur ? Number(values.blur) : 1, output: out, onProgress: (d, t) => d % 60 === 0 && process.stdout.write(`\r${d}/${t}`) });
  if (!result.ok) console.log("render refused:", result.problems.map((p) => p.message).join("; "));
  else console.log(`\nrendered ${result.path} (${result.frames} frames, ${result.renderSeconds}s${result.cached ? ", cached" : ""}); ${result.events.length} picture events`);
}
