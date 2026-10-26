/**
 * Render one motion block from the command line (development and review):
 *
 *   npx tsx packages/motion/scripts/render.ts prompt_bar --size 1080x1920 --out /tmp/pb.mp4 \
 *     [--fps 30] [--seconds 5] [--alpha] [--opaque] [--blur 4] [--draft] \
 *     [--params '{"prompt":"…"}'] [--media background=photo.jpg]
 */

import { parseArgs } from "node:util";
import { renderBlock } from "../src/node/index.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: "string", default: "1080x1920" },
    fps: { type: "string", default: "30" },
    seconds: { type: "string" },
    out: { type: "string" },
    params: { type: "string", default: "{}" },
    media: { type: "string", multiple: true },
    alpha: { type: "boolean" },
    opaque: { type: "boolean" },
    blur: { type: "string" },
    draft: { type: "boolean" },
    workers: { type: "string" },
  },
});
const id = positionals[0];
if (!id) throw new Error("usage: render.ts <block> [--size WxH] [--out file]");
const [width, height] = values.size.split("x").map(Number) as [number, number];
const media = Object.fromEntries((values.media ?? []).map((m) => m.split("=", 2) as [string, string]));
const params = { ...(JSON.parse(values.params) as Record<string, unknown>), ...Object.fromEntries(Object.keys(media).map((k) => [k, k])) };
const result = await renderBlock(id, params, {
  width,
  height,
  fps: Number(values.fps),
  seconds: values.seconds ? Number(values.seconds) : undefined,
  alpha: values.alpha ? true : values.opaque ? false : undefined,
  motionBlurSamples: values.blur ? Number(values.blur) : undefined,
  draft: values.draft,
  media,
  output: values.out,
  workers: values.workers ? Number(values.workers) : undefined,
  onProgress: (done, total) => {
    if (done === total || done % 30 === 0) process.stderr.write(`\r${done}/${total} frames`);
  },
});
process.stderr.write("\n");
console.log(JSON.stringify({ path: result.path, codec: result.codec, size: `${result.width}x${result.height}`, frames: result.frames, cached: result.cached, renderSeconds: result.renderSeconds }));
