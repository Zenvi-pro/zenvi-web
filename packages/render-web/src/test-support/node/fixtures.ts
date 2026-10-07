/**
 * Node-only test helpers: generate media with ffmpeg and read libopenshot's
 * reader JSON for it through the desktop's Python bindings.
 *
 * Nothing here ships: only `*.node.test.ts` files import it. Child processes
 * are asynchronous so the Vitest worker's event loop stays responsive.
 */

import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

export function hasFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

export interface TempDir {
  dir: string;
  path(name: string): string;
  read(name: string): Uint8Array;
  cleanup(): void;
}

export function makeTempDir(prefix = "zenvi-render-web-"): TempDir {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    path: (name) => join(dir, name),
    read: (name) => new Uint8Array(readFileSync(join(dir, name))),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: options.cwd, env: options.env, encoding: "utf8", maxBuffer: 1 << 26 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
}

/** Run ffmpeg quietly in `cwd`; rejects with stderr on failure. */
export async function ffmpeg(cwd: string, args: string[]): Promise<void> {
  const result = await run("ffmpeg", ["-v", "error", "-y", "-nostdin", ...args], { cwd });
  if (result.code !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed: ${result.stderr}`);
}

/** Run `jobs` with at most `limit` in flight. */
export async function inParallel<T>(jobs: (() => Promise<T>)[], limit = 3): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      results[index] = await jobs[index]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

function libopenshotPython(): { python: string; env: NodeJS.ProcessEnv } | null {
  const home = homedir();
  const python = process.env.ZENVI_LIBOPENSHOT_PYTHON ?? join(home, "Projects/zenvi/.venv/bin/python");
  const deps = process.env.ZENVI_DEPS ?? join(home, "zenvi-deps-1.0");
  if (!existsSync(python) || !existsSync(join(deps, "python"))) return null;
  return {
    python,
    env: { ...process.env, PYTHONPATH: join(deps, "python"), DYLD_LIBRARY_PATH: join(deps, "lib") },
  };
}

const READ_JSON = `
import json, sys, openshot
out = {}
for f in sys.argv[1:]:
    image = f.lower().endswith(('.png', '.jpg', '.jpeg', '.svg', '.webp', '.bmp'))
    r = openshot.QtImageReader(f) if image else openshot.FFmpegReader(f)
    r.Open()
    out[f] = json.loads(r.Json())
    r.Close()
print("@@JSON@@" + json.dumps(out))
`;

/**
 * libopenshot 1.0 reader JSON for each file (keyed by base name), or null when
 * the bindings are not installed on this machine.
 */
export async function libopenshotReaderJson(cwd: string, files: string[]): Promise<Record<string, Record<string, unknown>> | null> {
  const py = libopenshotPython();
  if (!py) return null;
  const result = await run(py.python, ["-c", READ_JSON, ...files], { cwd, env: py.env });
  const line = result.stdout.split("\n").find((l) => l.startsWith("@@JSON@@"));
  if (result.code !== 0 || !line) return null;
  const parsed = JSON.parse(line.slice("@@JSON@@".length)) as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(parsed).map(([file, json]) => [basename(file), json]));
}
