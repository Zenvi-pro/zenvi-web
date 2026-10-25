/**
 * Live one-shot reels: what ChatGPT does with the Zenvi app, minus ChatGPT.
 * For each spec, create_reel runs against the real Zenvi backend (Pexels
 * footage, Freesound music) as the given user, then render_project renders
 * it with the cloud renderer and the MP4 is saved next to the spec.
 *
 * Blobs go to the `zenvi-e2e` container; tokens, projects' tables and
 * sessions stay in memory. The backend sees a service assertion for USER.
 *
 *   ZENVI_BACKEND_SERVICE_SECRET=… AZURE_STORAGE_CONNECTION_STRING=… USER_ID=<supabase user id> \
 *   npx tsx packages/cloud/scripts/reel-live.ts <specs.json> <out dir> [height]
 *
 * Remote mode drives a deployed Zenvi Cloud over HTTPS instead (its network,
 * its renderer), the way ChatGPT does:
 *
 *   ZENVI_CLOUD_URL=https://… ZENVI_TOKEN=zvn_pat_… npx tsx packages/cloud/scripts/reel-live.ts <specs.json> <out dir> [height]
 *
 * specs.json: [{ "file": "coffee", "prompt": "…", "style": "hype", "stock_queries": [...], "music_query": "…", "hook": "…", "end_card": "…" }]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectCloud } from "./live-client.js";

type CallResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };
interface Spec extends Record<string, unknown> {
  file: string;
}

async function main(): Promise<void> {
  const [specPath, outDir, heightArg] = process.argv.slice(2);
  if (!specPath || !outDir) throw new Error("usage: reel-live.ts <specs.json> <out dir> [height] (see the header for the environment)");
  const specs = JSON.parse(readFileSync(specPath, "utf8")) as Spec[];
  mkdirSync(outDir, { recursive: true });
  const { client } = await connectCloud("reel-live");
  await runSpecs(client, specs, outDir, Number(heightArg) || 1280);
}

async function runSpecs(client: Client, specs: Spec[], outDir: string, height: number): Promise<void> {
  const call = async (name: string, args: Record<string, unknown>): Promise<CallResult> =>
    (await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as CallResult;

  const summary: Record<string, unknown>[] = [];
  for (const spec of specs) {
    const { file, ...args } = spec;
    const started = Date.now();
    console.log(`\n=== ${file}: ${String(args.prompt)}`);
    const made = await call("create_reel", args);
    const madeMs = Date.now() - started;
    if (made.isError) {
      console.log(`FAILED create_reel (${madeMs} ms): ${made.content[0]?.text}`);
      summary.push({ file, ok: false, error: made.content[0]?.text });
      continue;
    }
    console.log(made.content[0]?.text);
    const data = made.structuredContent as { project_id: string; duration_seconds: number; shots: number; bpm: number };
    const render = await call("render_project", { project_id: data.project_id, height, quality: "medium" });
    if (render.isError) {
      console.log(`FAILED render_project: ${render.content[0]?.text}`);
      summary.push({ file, ok: false, error: render.content[0]?.text });
      continue;
    }
    let status = render.structuredContent as { render_id: string; status: string; progress: number; url?: string; error?: string };
    while (status.status === "queued" || status.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const polled = await call("get_render_status", { render_id: status.render_id, wait_seconds: 20 });
      if (polled.isError || !polled.structuredContent) {
        status = { ...status, status: "error", error: polled.content[0]?.text ?? "no status" };
        break;
      }
      status = polled.structuredContent as typeof status;
      process.stdout.write(`\rrendering ${Math.round((status.progress ?? 0) * 100)}%   `);
    }
    const totalMs = Date.now() - started;
    if (status.status !== "done" || !status.url) {
      console.log(`\nFAILED render: ${status.error ?? status.status}`);
      summary.push({ file, ok: false, error: status.error ?? status.status });
      continue;
    }
    const bytes = Buffer.from(await (await fetch(status.url)).arrayBuffer());
    const target = path.join(outDir, `${file}.mp4`);
    writeFileSync(target, bytes);
    console.log(`\nsaved ${target} (${(bytes.length / 1e6).toFixed(1)} MB) — create_reel ${madeMs} ms, total ${totalMs} ms`);
    summary.push({ file, ok: true, project_id: data.project_id, seconds: data.duration_seconds, shots: data.shots, bpm: data.bpm, create_ms: madeMs, total_ms: totalMs, output: target, structured: made.structuredContent });
  }
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  await client.close();
  process.exit(summary.every((s) => s.ok) ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
