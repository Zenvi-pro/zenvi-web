/**
 * The deployed service is one esbuild bundle, which orders module
 * initialisation differently from the sources the other tests load (modules
 * reached through the engine's dynamic import are initialised lazily). Bundle
 * it the way the image does and check it starts and answers /health.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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

  it("bundles the render worker, which loads and refuses to run without Azure storage and a queue", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-render-job-bundle-"));
    dirs.push(dir);
    const outfile = path.join(dir, "render-job.mjs");
    await build({ ...serverBundleOptions(outfile, "src/render-job.ts"), logLevel: "silent", sourcemap: false });
    const result = spawnSync(process.execPath, [outfile], { env: { ...process.env, STORAGE: "memory", LOG_LEVEL: "error" }, encoding: "utf8", timeout: 30_000 });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("a render worker needs Azure storage and ZENVI_RENDER_QUEUE");
  }, 60_000);
});
