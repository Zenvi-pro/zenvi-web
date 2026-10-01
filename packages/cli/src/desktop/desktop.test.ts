import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProject } from "@zenvi/engine";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { writeProjectFile } from "@zenvi/render-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { fakeDesktop, testEnv, writeDiscovery, zenvi, type FakeDesktop } from "../test-support/harness.js";
import { testRegistry } from "../test-support/registry.js";
import { discoverDesktop, hasProjectOpen, isLoopbackUrl, LEGACY_URL, probeLegacy } from "./discovery.js";
import type { LauncherDeps } from "./launcher.js";
import { openInDesktop } from "./open.js";

let root: string;
let home: string;
let desktop: FakeDesktop;
let projectFile: string;

beforeAll(async () => {
  root = await makeTempDir("zenvi-desktop-");
  projectFile = path.join(root, "work", "cut.zvn");
  await mkdir(path.dirname(projectFile), { recursive: true });
  await writeProjectFile(projectFile, createProject());
  desktop = await fakeDesktop("secret-token", projectFile);
});

afterAll(async () => {
  await desktop.close();
  await removeDir(root);
});

beforeEach(async () => {
  home = await makeTempDir("zenvi-home-");
  desktop.calls.length = 0;
  desktop.project = projectFile;
});

const config = () => loadConfig(testEnv(home));

describe("discovery", () => {
  it("trusts a discovery file only when its pid is alive and its URL is loopback", async () => {
    expect(await discoverDesktop(config())).toEqual([]);
    await writeDiscovery(home, desktop);
    const found = await discoverDesktop(config());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "gui", url: desktop.url, token: "secret-token", pid: process.pid, project: projectFile });
    expect(await hasProjectOpen(found[0]!, projectFile)).toBe(true);
    expect(await hasProjectOpen(found[0]!, path.join(root, "other.zvn"))).toBe(false);

    await writeDiscovery(home, desktop, { pid: 2_000_000_000 });
    expect(await discoverDesktop(config())).toEqual([]);

    await writeFile(path.join(home, ".openshot_qt", "gui_mcp.json"), JSON.stringify({ url: "http://example.com/mcp", pid: process.pid }));
    expect(await discoverDesktop(config())).toEqual([]);
    expect(isLoopbackUrl("http://localhost:7434/mcp")).toBe(true);
    expect(isLoopbackUrl("http://10.0.0.2:7434/mcp")).toBe(false);
  });

  it("lists the GUI before the headless runtime", async () => {
    await writeDiscovery(home, desktop, { kind: "headless" });
    await writeDiscovery(home, desktop, { kind: "gui" });
    expect((await discoverDesktop(config())).map((e) => e.kind)).toEqual(["gui", "headless"]);
  });

  it("probes the legacy endpoint with exactly one well-formed initialize request", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fake: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "zenvi-editor" } } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    expect(await probeLegacy("tok", { fetchImpl: fake })).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(LEGACY_URL);
    expect((requests[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(requests[0]!.init.body))).toMatchObject({ jsonrpc: "2.0", method: "initialize" });
    // Without a token file nothing is sent at all.
    const none: typeof fetch = async () => {
      throw new Error("must not be called");
    };
    expect(await discoverDesktop(config(), { legacy: true, fetchImpl: none })).toEqual([]);
  });
});

describe("desktop attach", () => {
  it("runs edits in the desktop app when it has the project open", async () => {
    await writeDiscovery(home, desktop);
    const run = await zenvi(["-p", projectFile, "info", "--json"], { cwd: root, env: testEnv(home), registry: testRegistry() });
    expect(run.code).toBe(0);
    expect(run.json()).toMatchObject({ contract: 3, status: "applied", tool: "get_project_info_tool", engine: "desktop", project: projectFile });
    expect(desktop.calls.map((c) => c.tool)).toEqual(["get_project_info_tool"]);
    expect(desktop.rejected).toBe(0);
  });

  it("edits the file directly when the app has another project open, and warns with --engine portable", async () => {
    await writeDiscovery(home, desktop, { project: path.join(root, "elsewhere.zvn") });
    const run = await zenvi(["-p", projectFile, "info", "--json"], { cwd: root, env: testEnv(home), registry: testRegistry() });
    expect(run.json()).toMatchObject({ engine: "portable" });
    expect(desktop.calls).toEqual([]);
    await writeDiscovery(home, desktop);
    const forced = await zenvi(["-p", projectFile, "--engine", "portable", "info", "--json"], { cwd: root, env: testEnv(home), registry: testRegistry() });
    expect(forced.json()).toMatchObject({ engine: "portable" });
    expect(forced.stderr).toMatch(/desktop app has .* open/);
  });

  it("--desktop refuses when no app is running, or when it has a different project", async () => {
    const none = await zenvi(["-p", projectFile, "--desktop", "info"], { cwd: root, env: testEnv(home), registry: testRegistry() });
    expect(none.code).toBe(1);
    expect(none.stderr).toMatch(/No running Zenvi desktop app/);
    await writeDiscovery(home, desktop, { project: path.join(root, "elsewhere.zvn") });
    const other = await zenvi(["-p", projectFile, "--desktop", "info"], { cwd: root, env: testEnv(home), registry: testRegistry() });
    expect(other.code).toBe(1);
    expect(other.stderr).toMatch(/has .*elsewhere\.zvn open/);
  });
});

describe("open in the desktop app", () => {
  function deps(log: string[]): LauncherDeps {
    return {
      platform: "darwin",
      env: {},
      home,
      exists: async (f) => f === "/Applications/Zenvi.app",
      readText: async () => undefined,
      listDir: async () => [],
      run: async (command, args) => {
        log.push(`run ${command} ${args.join(" ")}`);
        return { code: 0, stdout: "" };
      },
      spawnDetached: async (command, args) => {
        log.push(`spawn ${command} ${args.join(" ")}`);
      },
      selfPaths: [],
    };
  }

  it("launches the installed app on the project when it is not running", async () => {
    const log: string[] = [];
    const result = await openInDesktop({ config: config(), project: projectFile, deps: deps(log) });
    expect(result.method).toBe("launched");
    expect(log).toEqual([`spawn open -a /Applications/Zenvi.app --args ${projectFile}`]);
  });

  it("focuses a running app that already shows the project", async () => {
    await writeDiscovery(home, desktop);
    const log: string[] = [];
    const result = await openInDesktop({ config: config(), project: projectFile, deps: deps(log) });
    expect(result.method).toBe("focused");
    expect(log).toEqual(["run open -a /Applications/Zenvi.app"]);
    expect(desktop.calls).toEqual([]);
  });

  it("loads the project into a running app through its open_project_tool", async () => {
    const other = path.join(root, "work", "second.zvn");
    await writeDiscovery(home, desktop, { project: path.join(root, "elsewhere.zvn") });
    const log: string[] = [];
    const result = await openInDesktop({ config: config(), project: other, deps: deps(log) });
    expect(result.method).toBe("loaded");
    expect(desktop.calls).toEqual([{ tool: "open_project_tool", args: { path: other } }]);
    expect(log).toEqual(["run open -a /Applications/Zenvi.app"]);
  });

  it("explains how to get the app when it is not installed", async () => {
    const log: string[] = [];
    const missing = { ...deps(log), exists: async () => false };
    await expect(openInDesktop({ config: config(), project: projectFile, deps: missing })).rejects.toThrow(/not installed/);
  });
});
