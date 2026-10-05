import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AE_TOOLS } from "./catalog/aftereffects.js";
import { PREMIERE_TOOLS } from "./catalog/premiere.js";
import { toCatalogJson } from "./catalog/types.js";
import { discoverHosts, inspectHost, inspectHosts, isLinkUrl } from "./discovery.js";
import { discoveryModule, serverModule, type LinkServer } from "./testing/link-server.js";

const servers: LinkServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

const okBridge = { evalScript: async () => "" };

function desktopDir(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "zenvi-link-client-")), ".openshot_qt");
}

async function publish(dir: string, host: "aftereffects" | "premiere", overrides: { pid?: number; url?: string; token?: string; lastActive?: string } = {}) {
  const server = serverModule.createLinkServer({ host, catalog: toCatalogJson(host, host === "aftereffects" ? AE_TOOLS : PREMIERE_TOOLS), bridge: okBridge });
  servers.push(server);
  await server.start();
  const file = new discoveryModule.DiscoveryFile({
    host,
    dir: path.join(dir, "link"),
    pid: overrides.pid,
    now: overrides.lastActive ? () => new Date(overrides.lastActive as string) : undefined,
  });
  file.publish({ url: overrides.url ?? server.url, token: overrides.token ?? server.token, project: null, version: "1.0.0", appName: "App", appVersion: "26.0.0" });
  return { server, file };
}

/** A pid that certainly belonged to a process that has exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid as number;
}

describe("inspectHost / discoverHosts", () => {
  test("absent when there is no file", async () => {
    const dir = desktopDir();
    expect(await inspectHosts(dir)).toEqual([
      expect.objectContaining({ host: "aftereffects", status: "absent" }),
      expect.objectContaining({ host: "premiere", status: "absent" }),
    ]);
    expect(await discoverHosts(dir)).toEqual([]);
  });

  test("connected when the pid lives and the exact URL answers initialize as zenvi-link-<app>", async () => {
    const dir = desktopDir();
    const { server } = await publish(dir, "aftereffects");
    const fetched: string[] = [];
    const entry = await inspectHost(dir, "aftereffects", { fetchImpl: (url, init) => (fetched.push(String(url)), fetch(url, init)) });
    expect(entry.status).toBe("connected");
    expect(entry.endpoint).toMatchObject({ host: "aftereffects", url: server.url, token: server.token, pid: process.pid, appName: "App", protocol: 1 });
    expect(fetched).toEqual([server.url]);
  });

  test("a server for the other app does not count", async () => {
    const dir = desktopDir();
    const { server } = await publish(dir, "premiere");
    const linkDir = path.join(dir, "link");
    writeFileSync(path.join(linkDir, "aftereffects.token"), server.token);
    writeFileSync(path.join(linkDir, "aftereffects.json"), JSON.stringify({ url: server.url, token_file: path.join(linkDir, "aftereffects.token"), pid: process.pid, app: "aftereffects", protocol: 1 }));
    expect((await inspectHost(dir, "aftereffects")).status).toBe("unreachable");
  });

  test("dead pids are ignored, and removed only on request", async () => {
    const dir = desktopDir();
    const { file } = await publish(dir, "aftereffects", { pid: deadPid() });
    expect((await inspectHost(dir, "aftereffects")).status).toBe("dead");
    expect(existsSync(file.file)).toBe(true);
    await inspectHost(dir, "aftereffects", { removeStale: true });
    expect(existsSync(file.file)).toBe(false);
    expect(existsSync(file.tokenFile)).toBe(false);
  });

  test("non-loopback URLs are never contacted", async () => {
    const dir = desktopDir();
    await publish(dir, "aftereffects", { url: "http://192.168.1.20:53012/mcp" });
    const fetched: string[] = [];
    const entry = await inspectHost(dir, "aftereffects", { fetchImpl: (url, init) => (fetched.push(String(url)), fetch(url, init)) });
    expect(entry.status).toBe("invalid");
    expect(fetched).toEqual([]);
  });

  test("a wrong token is unreachable; a newer protocol is invalid", async () => {
    const dir = desktopDir();
    const { file } = await publish(dir, "aftereffects", { token: "00".repeat(32) });
    expect((await inspectHost(dir, "aftereffects")).status).toBe("unreachable");
    mkdirSync(path.dirname(file.file), { recursive: true });
    const { server } = await publish(dir, "premiere");
    writeFileSync(path.join(dir, "link", "premiere.json"), JSON.stringify({ url: server.url, token_file: path.join(dir, "link", "premiere.token"), pid: process.pid, app: "premiere", protocol: 2 }));
    expect((await inspectHost(dir, "premiere")).detail).toContain("protocol 2");
  });

  test("most recently active host first", async () => {
    const dir = desktopDir();
    await publish(dir, "aftereffects", { lastActive: "2026-10-04T21:00:00.000Z" });
    await publish(dir, "premiere", { lastActive: "2026-10-04T21:05:00.000Z" });
    expect((await discoverHosts(dir)).map((endpoint) => endpoint.host)).toEqual(["premiere", "aftereffects"]);
  });
});

test("isLinkUrl accepts only http loopback with a port", () => {
  expect(isLinkUrl("http://127.0.0.1:53012/mcp")).toBe(true);
  expect(isLinkUrl("http://localhost:53012/mcp")).toBe(true);
  for (const url of ["https://127.0.0.1:53012/mcp", "http://[::1]:53012/mcp", "http://127.0.0.1/mcp", "http://example.com:53012/mcp", "nonsense"]) {
    expect(isLinkUrl(url)).toBe(false);
  }
});
