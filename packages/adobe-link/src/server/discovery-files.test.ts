import { spawnSync } from "node:child_process";
import fs, { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { inspectHost } from "../discovery.js";
import { AE_TOOLS } from "../catalog/aftereffects.js";
import { toCatalogJson } from "../catalog/types.js";
import { discoveryModule, serverModule, type LinkServer } from "../testing/link-server.js";

const { DiscoveryFile, DISCOVERY_KEYS } = discoveryModule;

function desktopDir(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "zenvi-link-discovery-")), ".openshot_qt");
}

const details = { url: "http://127.0.0.1:53012/mcp", token: "ab".repeat(32), project: "/Users/me/promo.aep", version: "1.0.0", appName: "Adobe After Effects 2026", appVersion: "26.3.0" };

const servers: LinkServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("DiscoveryFile", () => {
  test("writes its own token (0600) before the discovery file, atomically, with exactly the SPEC keys", async () => {
    const linkDir = path.join(desktopDir(), "link");
    const renames: string[] = [];
    const rename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementation(((from: string, to: string, done: (error: Error | null) => void) => {
      renames.push(path.basename(String(to)));
      rename(from, to, done);
    }) as typeof fs.rename);
    const file = new DiscoveryFile({ host: "aftereffects", dir: linkDir, now: () => new Date("2026-10-04T21:00:00.000Z") });
    expect(await file.publish(details)).toBe("written");
    expect(file.tokenFile).toBe(path.join(linkDir, `aftereffects.${process.pid}.token`));
    expect(renames).toEqual([`aftereffects.${process.pid}.token`, "aftereffects.json"]);
    expect(readdirSync(linkDir).sort()).toEqual(["aftereffects.json", `aftereffects.${process.pid}.token`].sort());
    expect(readFileSync(file.tokenFile, "utf8")).toBe(details.token);
    if (process.platform !== "win32") {
      expect(statSync(file.tokenFile).mode & 0o777).toBe(0o600);
      expect(statSync(linkDir).mode & 0o777).toBe(0o700);
    }
    const json = readJson(file.file);
    expect(Object.keys(json)).toEqual(DISCOVERY_KEYS);
    expect(json).toEqual({
      url: details.url,
      token_file: file.tokenFile,
      pid: process.pid,
      project: "/Users/me/promo.aep",
      version: "1.0.0",
      app: "aftereffects",
      app_name: "Adobe After Effects 2026",
      app_version: "26.3.0",
      protocol: 1,
      started_at: "2026-10-04T21:00:00.000Z",
      last_active_at: "2026-10-04T21:00:00.000Z",
    });
  });

  test("project changes are written; unchanged projects are not", async () => {
    const file = new DiscoveryFile({ host: "premiere", dir: path.join(desktopDir(), "link") });
    await file.publish({ ...details, project: null });
    expect(readJson(file.file).project).toBeNull();
    expect(await file.setProject("/Users/me/trip.prproj")).toBe(true);
    expect(await file.setProject("/Users/me/trip.prproj")).toBe(false);
    expect(readJson(file.file).project).toBe("/Users/me/trip.prproj");
  });

  test("touch refreshes last_active_at off the caller's path, at most one write per interval", async () => {
    let clock = Date.parse("2026-10-04T21:00:00.000Z");
    const file = new DiscoveryFile({ host: "aftereffects", dir: path.join(desktopDir(), "link"), minIntervalMs: 40, now: () => new Date(clock) });
    await file.publish(details);
    clock += 5000;
    file.touch();
    clock += 1000;
    file.touch();
    expect(readJson(file.file).last_active_at).toBe("2026-10-04T21:00:00.000Z");
    await file.settled();
    expect(readJson(file.file).last_active_at).toBe("2026-10-04T21:00:06.000Z");
  });

  test("a rename Windows refuses for a moment is retried with backoff", async () => {
    const file = new DiscoveryFile({ host: "aftereffects", dir: path.join(desktopDir(), "link") });
    const rename = fs.rename;
    let refusals = 2;
    vi.spyOn(fs, "rename").mockImplementation(((from: string, to: string, done: (error: Error | null) => void) => {
      if (String(to).endsWith(".json") && refusals > 0) {
        refusals -= 1;
        done(Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }));
        return;
      }
      rename(from, to, done);
    }) as typeof fs.rename);
    expect(await file.publish(details)).toBe("written");
    expect(refusals).toBe(0);
    expect(readJson(file.file).url).toBe(details.url);
    expect(readdirSync(path.dirname(file.file)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("a failed write is logged and reported, never thrown, and leaves no temp file", async () => {
    const linkDir = path.join(desktopDir(), "link");
    const lines: string[] = [];
    const file = new DiscoveryFile({ host: "aftereffects", dir: linkDir, log: (line) => lines.push(line) });
    vi.spyOn(fs, "rename").mockImplementation(((_from: string, _to: string, done: (error: Error | null) => void) =>
      done(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }))) as typeof fs.rename);
    expect(await file.publish(details)).toBe("failed");
    expect(file.problem).toContain("ENOSPC");
    expect(lines.join("\n")).toContain("could not write");
    expect(readdirSync(linkDir)).toEqual([]);
    file.touch();
    await file.settled();
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("touch and setProject on a read-only folder do not throw", async () => {
    const linkDir = path.join(desktopDir(), "link");
    const file = new DiscoveryFile({ host: "aftereffects", dir: linkDir, minIntervalMs: 0 });
    await file.publish(details);
    chmodSync(linkDir, 0o500);
    try {
      file.touch();
      expect(await file.setProject("/x/other.aep")).toBe(false);
      await file.settled();
      expect(file.problem).toMatch(/EACCES|EPERM/);
    } finally {
      chmodSync(linkDir, 0o700);
    }
  });
});

describe("several instances for one app", () => {
  async function server(): Promise<LinkServer> {
    const created = serverModule.createLinkServer({
      host: "aftereffects",
      catalog: toCatalogJson("aftereffects", AE_TOOLS),
      bridge: { evalScript: async () => "" },
    });
    servers.push(created);
    await created.start();
    return created;
  }

  // inspectHost checks real processes: this test process and its parent are alive, an exited child is not.
  const live = [process.pid, process.ppid] as const;
  const dead = () => spawnSync(process.execPath, ["-e", ""]).pid as number;
  const instance = (linkDir: string, pid: number) => new DiscoveryFile({ host: "aftereffects", dir: linkDir, pid, minIntervalMs: 0 });

  test("the newest publish wins; the older instance's refreshes leave the file alone while the owner lives", async () => {
    const desktop = desktopDir();
    const linkDir = path.join(desktop, "link");
    const [a, b] = [await server(), await server()];
    const older = instance(linkDir, live[1]);
    const newer = instance(linkDir, live[0]);
    await older.publish({ ...details, url: a.url, token: a.token });
    await newer.publish({ ...details, url: b.url, token: b.token });
    older.touch();
    await older.setProject("/x/older.aep");
    await older.settled();
    const entry = await inspectHost(desktop, "aftereffects");
    expect(entry.status).toBe("connected");
    expect(entry.endpoint).toMatchObject({ url: b.url, token: b.token, pid: live[0], project: details.project });
  });

  test("when the owner leaves, it removes only its own files and the other instance takes the file back", async () => {
    const desktop = desktopDir();
    const linkDir = path.join(desktop, "link");
    const [a, b] = [await server(), await server()];
    const service = instance(linkDir, live[1]);
    const panel = instance(linkDir, live[0]);
    await service.publish({ ...details, url: a.url, token: a.token });
    await panel.publish({ ...details, url: b.url, token: b.token });
    expect(panel.remove()).toBe(true);
    expect(readdirSync(linkDir)).toEqual([`aftereffects.${live[1]}.token`]);
    service.touch();
    await service.settled();
    const entry = await inspectHost(desktop, "aftereffects");
    expect(entry.status).toBe("connected");
    expect(entry.endpoint).toMatchObject({ url: a.url, token: a.token, pid: live[1] });
  });

  test("an instance whose owner died takes the file back, and stale token files are cleaned up", async () => {
    const desktop = desktopDir();
    const linkDir = path.join(desktop, "link");
    const [a, b] = [await server(), await server()];
    const gone = dead();
    const survivor = instance(linkDir, live[0]);
    await survivor.publish({ ...details, url: a.url, token: a.token });
    await instance(linkDir, gone).publish({ ...details, url: b.url, token: b.token });
    survivor.touch();
    await survivor.settled();
    expect((await inspectHost(desktop, "aftereffects")).endpoint).toMatchObject({ pid: live[0], url: a.url });
    await instance(linkDir, live[1]).publish({ ...details, url: b.url, token: b.token });
    expect(readdirSync(linkDir).sort()).toEqual([`aftereffects.${live[0]}.token`, `aftereffects.${live[1]}.token`, "aftereffects.json"].sort());
  });

  test("with yieldToLive (the panel fallback) a live owner keeps the file", async () => {
    const linkDir = path.join(desktopDir(), "link");
    const alive = new Set([111, 222]);
    const make = (pid: number) => new DiscoveryFile({ host: "aftereffects", dir: linkDir, pid, minIntervalMs: 0, isAlive: (candidate) => alive.has(candidate) });
    const service = make(111);
    await service.publish(details);
    const panel = make(222);
    expect(await panel.publish({ ...details, url: "http://127.0.0.1:1/mcp" }, { yieldToLive: true })).toBe("yielded");
    expect(readJson(service.file).pid).toBe(111);
    expect(readdirSync(linkDir).sort()).toEqual(["aftereffects.111.token", "aftereffects.json"]);
    alive.delete(111);
    expect(await panel.publish(details, { yieldToLive: true })).toBe("written");
  });

  test("an unreadable discovery file is never removed by another instance", async () => {
    const linkDir = path.join(desktopDir(), "link");
    const file = new DiscoveryFile({ host: "aftereffects", dir: linkDir });
    await file.publish(details);
    writeFileSync(file.file, "{broken");
    expect(file.remove()).toBe(false);
    expect(readdirSync(linkDir)).toEqual(["aftereffects.json"]);
  });
});
