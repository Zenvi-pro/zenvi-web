import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AE_TOOLS } from "./catalog/aftereffects.js";
import { toCatalogJson } from "./catalog/types.js";
import { discoveryModule, serverModule, type LinkServer } from "./testing/link-server.js";
import { panelCore } from "./testing/panel-module.js";

const servers: LinkServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

function home(): string {
  return mkdtempSync(path.join(os.tmpdir(), "zenvi-link-panel-"));
}

test("mcpConfig gives a claude mcp add line and a JSON snippet with the bearer header", () => {
  const config = panelCore.mcpConfig("aftereffects", "http://127.0.0.1:53012/mcp", "abc123");
  expect(config.name).toBe("zenvi-aftereffects");
  expect(config.claude).toBe('claude mcp add --transport http zenvi-aftereffects http://127.0.0.1:53012/mcp --header "Authorization: Bearer abc123"');
  expect(JSON.parse(config.json)).toEqual({
    mcpServers: { "zenvi-aftereffects": { type: "http", url: "http://127.0.0.1:53012/mcp", headers: { Authorization: "Bearer abc123" } } },
  });
});

test("skin variables follow the host panel colour", () => {
  const dark = panelCore.skinVariables({ panelBackgroundColor: { color: { red: 35, green: 35, blue: 35 } }, baseFontFamily: "Helvetica", baseFontSize: 10 });
  expect(dark).toMatchObject({ "--bg": "#232323", "--fg": "#dedede", "--font": "Helvetica", "--font-size": "10px" });
  const light = panelCore.skinVariables({ panelBackgroundColor: { color: { red: 240, green: 240, blue: 240 } } });
  expect(light["--fg"]).toBe("#1c1c1c");
  expect(panelCore.skinVariables(undefined)["--bg"]).toBe("#232323");
});

describe("desktopStatus", () => {
  test("running when gui_mcp.json names a live pid", () => {
    const dir = home();
    mkdirSync(path.join(dir, ".openshot_qt"));
    writeFileSync(path.join(dir, ".openshot_qt", "gui_mcp.json"), JSON.stringify({ url: "http://127.0.0.1:7434/mcp", token_file: "mcp_token", pid: process.pid, project: "/x/trip.zvn" }));
    writeFileSync(path.join(dir, ".openshot_qt", "mcp_token"), "tok\n");
    expect(panelCore.desktopStatus(dir)).toEqual({ running: true, pid: process.pid, project: "/x/trip.zvn", url: "http://127.0.0.1:7434/mcp", token: "tok" });
  });

  test("not running without a file or with a dead pid", () => {
    const dir = home();
    expect(panelCore.desktopStatus(dir)).toEqual({ running: false });
    mkdirSync(path.join(dir, ".openshot_qt"));
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(path.join(dir, ".openshot_qt", "gui_mcp.json"), JSON.stringify({ url: "http://127.0.0.1:7434/mcp", pid: dead }));
    expect(panelCore.desktopStatus(dir)).toEqual({ running: false });
  });
});

describe("findLiveEndpoint", () => {
  async function published(appVersion = "26.3.0") {
    const dir = home();
    const server = serverModule.createLinkServer({ host: "aftereffects", catalog: toCatalogJson("aftereffects", AE_TOOLS), bridge: { evalScript: async () => "" } });
    servers.push(server);
    await server.start();
    const file = new discoveryModule.DiscoveryFile({ host: "aftereffects", dir: discoveryModule.linkDir(dir) });
    file.publish({ url: server.url, token: server.token, project: null, version: "1.0.0", appName: "Adobe After Effects 2026", appVersion });
    return { dir, server };
  }

  test("finds this app's live server and its token", async () => {
    const { dir, server } = await published();
    expect(await panelCore.findLiveEndpoint({ host: "aftereffects", home: dir, appVersion: "26.3.0" })).toMatchObject({ url: server.url, token: server.token });
  });

  test("ignores another version of the app, and missing files", async () => {
    const { dir } = await published("25.6.0");
    expect(await panelCore.findLiveEndpoint({ host: "aftereffects", home: dir, appVersion: "26.3.0" })).toBeNull();
    expect(await panelCore.findLiveEndpoint({ host: "premiere", home: dir })).toBeNull();
  });

  test("callTool talks to the server over Node http", async () => {
    const { server } = await published();
    const result = await panelCore.callTool(server.url, server.token, "ae_get_state", { nope: 1 });
    expect(result.isError).toBe(true);
    expect(result.receipt?.error?.code).toBe("INVALID_ARGUMENT");
  });
});

test("parseRpcBody reads plain JSON and SSE-framed replies", () => {
  expect(panelCore.parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{}}')).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  expect(panelCore.parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n')).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
});

test("clock shows local hh:mm:ss", () => {
  expect(panelCore.clock(new Date(2026, 9, 4, 9, 5, 7).toISOString())).toBe("09:05:07");
});
