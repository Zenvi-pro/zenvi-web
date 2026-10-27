import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BlenderJob } from "./job.js";
import { BlenderWorker, parseWorkerLine } from "./worker.js";

/** A stand-in for Blender speaking worker.py's protocol: "crash" exits, "hang" never answers, "fail" reports an error. */
const FAKE = `
const rl = require("node:readline").createInterface({ input: process.stdin });
const say = (e) => process.stdout.write("@@zenvi3d " + JSON.stringify(e) + "\\n");
console.log("Blender noise line");
say({ event: "ready", blender: process.env.FAKE_VERSION || "5.2.3 LTS", pid: process.pid });
rl.on("line", (line) => {
  const cmd = JSON.parse(line);
  if (cmd.cmd === "quit") process.exit(0);
  const job = cmd.job;
  if (job.scene === "crash") { console.error("Segmentation fault"); process.exit(3); }
  if (job.scene === "hang") return;
  if (job.scene === "fail") return say({ event: "error", id: job.id, message: "KeyError: 'text'" });
  for (let f = 1; f <= job.frames; f++) say({ event: "frame", id: job.id, frame: f, frames: job.frames });
  say({ event: "done", id: job.id, frames: job.frames, backdrop: null, build_seconds: 0.1, render_seconds: process.pid });
});
`;

async function fakeWorker(env: NodeJS.ProcessEnv = {}): Promise<{ worker: BlenderWorker; spawned: () => number }> {
  const dir = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-worker-"));
  const script = path.join(dir, "fake-blender.cjs");
  await writeFile(script, FAKE);
  let count = 0;
  const worker = new BlenderWorker({
    blender: "blender",
    scriptsDir: dir,
    idleMs: 60_000,
    spawnProcess: () => {
      count += 1;
      return spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    },
  });
  return { worker, spawned: () => count };
}

const job = (scene: string, frames = 3): BlenderJob => ({ id: `${scene}-${Math.random()}`, scene: scene as BlenderJob["scene"], params: {} as BlenderJob["params"], width: 8, height: 8, fps: 30, frames, quality: "draft", output_dir: "/tmp/x", media: {}, files: {}, font: null });

describe("parseWorkerLine", () => {
  it("reads the worker's events and ignores Blender's own output", () => {
    expect(parseWorkerLine('@@zenvi3d {"event":"frame","frame":2}')).toEqual({ event: "frame", frame: 2 });
    expect(parseWorkerLine("Fra:1 Mem:12M")).toBeNull();
    expect(parseWorkerLine("@@zenvi3d {broken")).toBeNull();
  });
});

describe("BlenderWorker", () => {
  it("keeps one process for consecutive jobs and reports frames", async () => {
    const { worker, spawned } = await fakeWorker();
    const frames: number[] = [];
    const a = await worker.run(job("title_3d", 4), { onFrame: (f) => frames.push(f) });
    const b = await worker.run(job("glass_hero"));
    expect(frames).toEqual([1, 2, 3, 4]);
    expect(a.blender).toBe("5.2.3 LTS");
    // Same process: the fake reports its pid as render_seconds.
    expect(b.renderSeconds).toBe(a.renderSeconds);
    expect(spawned()).toBe(1);
    worker.close();
  });

  it("reports a scene error and stays usable", async () => {
    const { worker, spawned } = await fakeWorker();
    await expect(worker.run(job("fail"))).rejects.toThrow("KeyError: 'text'");
    await expect(worker.run(job("title_3d"))).resolves.toMatchObject({ buildSeconds: 0.1 });
    expect(spawned()).toBe(1);
    worker.close();
  });

  it("starts a new Blender after a crash, with the crash's last output in the error", async () => {
    const { worker, spawned } = await fakeWorker();
    await expect(worker.run(job("crash"))).rejects.toThrow(/Blender exited \(code 3\).*Segmentation fault/);
    await expect(worker.run(job("title_3d"))).resolves.toBeTruthy();
    expect(spawned()).toBe(2);
    worker.close();
  });

  it("kills a cancelled render; the next job runs in a fresh process", async () => {
    const { worker, spawned } = await fakeWorker();
    const controller = new AbortController();
    const hung = worker.run(job("hang"), { signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    await expect(hung).rejects.toThrow("Cancelled.");
    await expect(worker.run(job("title_3d"))).resolves.toBeTruthy();
    expect(spawned()).toBe(2);
    worker.close();
  });

  it("refuses a Blender older than the scripts need", async () => {
    const { worker } = await fakeWorker({ FAKE_VERSION: "3.6.2" });
    await expect(worker.run(job("title_3d"))).rejects.toThrow(/Blender 3\.6\.2 is too old.*4\.2/);
    worker.close();
  });
});
