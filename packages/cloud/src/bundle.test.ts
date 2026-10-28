/**
 * The deployed service is one esbuild bundle, which orders module
 * initialisation differently from the sources the other tests load (modules
 * reached through the engine's dynamic import are initialised lazily). Bundle
 * it the way the image does and check it starts and answers /health.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs build helper without types
import { serverBundleOptions } from "../scripts/bundle-options.mjs";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Workspace modules esbuild wrapped for lazy initialisation. A dynamic import
 * of a bundled module causes it; static importers reaching such a module
 * through `export *` then never initialise it (W53 B1).
 */
async function lazyWorkspaceModules(bundle: string): Promise<string[]> {
  const text = await readFile(bundle, "utf8");
  return [...text.matchAll(/__esm\(\{\n\s*"([^"]+)"/g)].map((m) => m[1]!).filter((module) => !module.includes("node_modules/"));
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe("service bundle", () => {
  it("starts and answers /health", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-cloud-bundle-"));
    dirs.push(dir);
    const outfile = path.join(dir, "server.mjs");
    await build({ ...serverBundleOptions(outfile), logLevel: "silent", sourcemap: false });
    expect(await lazyWorkspaceModules(outfile)).toEqual([]);
    const port = await freePort();
    const child = spawn(process.execPath, [outfile], { env: { ...process.env, STORAGE: "memory", PORT: String(port), LOG_LEVEL: "error" }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    try {
      let health: { status?: string; mcpTools?: number } | null = null;
      for (let attempt = 0; attempt < 60 && !health && child.exitCode === null; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => (r.ok ? (r.json() as Promise<{ status?: string; mcpTools?: number }>) : null), () => null);
      }
      expect(health, stderr.slice(0, 2000)).not.toBeNull();
      expect(health!.status).toBe("ok");
      expect(health!.mcpTools).toBeGreaterThan(10);
    } finally {
      child.kill();
    }
  }, 60_000);

  it("bundles the render worker, which refuses to run without Azure storage and a queue and renders its self-test", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-render-job-bundle-"));
    dirs.push(dir);
    const outfile = path.join(dir, "render-job.mjs");
    await build({ ...serverBundleOptions(outfile, "src/render-job.ts"), logLevel: "silent", sourcemap: false });
    expect(await lazyWorkspaceModules(outfile)).toEqual([]);
    const refused = spawnSync(process.execPath, [outfile], { env: { ...process.env, STORAGE: "memory", LOG_LEVEL: "error" }, encoding: "utf8", timeout: 30_000 });
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toContain("a render worker needs Azure storage and ZENVI_RENDER_QUEUE");

    const video = path.join(dir, "self-test.mp4");
    const rendered = spawnSync(process.execPath, [outfile, "--self-test", video], { env: { ...process.env, STORAGE: "memory", LOG_LEVEL: "error" }, encoding: "utf8", timeout: 60_000 });
    expect(rendered.status, rendered.stderr).toBe(0);
    const probe = spawnSync(process.env.ZENVI_FFPROBE ?? "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", video], { encoding: "utf8" });
    const info = JSON.parse(probe.stdout) as { streams: { codec_type: string }[]; format: { duration: string } };
    expect(info.streams.map((stream) => stream.codec_type).sort()).toEqual(["audio", "video"]);
    expect(Number(info.format.duration)).toBeCloseTo(1, 1);
  }, 90_000);
});
