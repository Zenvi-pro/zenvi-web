import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PACKAGE_ROOT } from "../host-bundle.js";
import { HostClient } from "../client.js";
import { discoverHosts } from "../discovery.js";
import { createAeMock } from "../testing/ae-mock.js";
import { FakeCep, evalInHostScript } from "../testing/fake-cep.js";
import { loadHostScript } from "../testing/host-script.js";
import { bootModule, type BootedLink } from "../testing/link-server.js";
import { createPremiereMock } from "../testing/premiere-mock.js";

const EXTENSION_DIR = path.join(PACKAGE_ROOT, "extension");
const { boot, marketingName, EVENTS } = bootModule;
const running: BootedLink[] = [];
const clients: HostClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(running.splice(0).map((link) => link.stop()));
});

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function bootAe(options: { evalScript?: (script: string) => string } = {}) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-boot-"));
  const home = path.join(temp, "home");
  const mock = createAeMock({ tempDir: temp });
  mock.project.save(new mock.es.File(path.join(temp, "promo.aep")));
  const host = loadHostScript("aeft", mock.globals);
  const cep = new FakeCep({ appName: "AEFT", appVersion: "26.3.0", extensionDir: EXTENSION_DIR, evalScript: options.evalScript ?? evalInHostScript(host) });
  const link = await boot({ cep, mode: "service", home, pollMs: 60_000, touchIntervalMs: 0, log: () => undefined });
  running.push(link);
  return { link, cep, mock, temp, home, desktopDir: path.join(home, ".openshot_qt") };
}

function discoveryJson(home: string, host: string) {
  return JSON.parse(readFileSync(path.join(home, ".openshot_qt", "link", `${host}.json`), "utf8"));
}

describe("boot inside CEP (fake __adobe_cep__, real host script on the mock DOM)", () => {
  test("starts the server and publishes the discovery file for the app", async () => {
    const { link, home, temp } = await bootAe();
    const json = discoveryJson(home, "aftereffects");
    expect(json).toMatchObject({
      url: link.server.url,
      pid: process.pid,
      project: path.join(temp, "promo.aep"),
      app: "aftereffects",
      app_name: "Adobe After Effects 2026",
      app_version: "26.3.0",
      protocol: 1,
      token_file: path.join(home, ".openshot_qt", "link", "aftereffects.token"),
    });
    expect(readFileSync(json.token_file, "utf8")).toBe(link.server.token);
    expect(link.status()).toMatchObject({ mode: "service", host: "aftereffects", url: link.server.url, host_script: { ok: true } });
  });

  test("the zenvi CLI side finds it and calls tools through the MCP SDK client", async () => {
    const { desktopDir, cep, temp } = await bootAe();
    const [endpoint] = await discoverHosts(desktopDir);
    expect(endpoint).toMatchObject({ host: "aftereffects", appName: "Adobe After Effects 2026", project: path.join(temp, "promo.aep") });
    const client = new HostClient(endpoint!);
    clients.push(client);
    expect((await client.listTools()).map((tool) => tool.name)).toContain("ae_get_state");
    const result = await client.callTool("ae_get_state");
    expect(result.isError).toBe(false);
    expect(result.receipt).toMatchObject({ status: "ok", host: "aftereffects", data: { project: { path: path.join(temp, "promo.aep") } } });
    const refused = await client.callTool("ae_get_state", { nope: true });
    expect(refused.isError).toBe(true);
    expect(refused.receipt?.error?.code).toBe("INVALID_ARGUMENT");
    const calls = cep.dispatched.filter((event) => event.type === EVENTS.call).map((event) => JSON.parse(event.data ?? "{}").status);
    expect(calls).toEqual(["ok", "refused"]);
  });

  test("answers status requests from the panel", async () => {
    const { link, cep } = await bootAe();
    cep.fire(EVENTS.statusRequest, { from: "panel" });
    const status = cep.dispatched.filter((event) => event.type === EVENTS.status).map((event) => JSON.parse(event.data ?? "{}"));
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ mode: "service", url: link.server.url, token_file: link.discovery.tokenFile, tools: expect.any(Number) });
    expect(status[0]).not.toHaveProperty("token");
  });

  test("activation refreshes last_active_at and the open project", async () => {
    const { home, mock, cep, temp } = await bootAe();
    const before = discoveryJson(home, "aftereffects").last_active_at;
    mock.project.save(new mock.es.File(path.join(temp, "other.aep")));
    await tick(5);
    cep.fire(EVENTS.activate);
    await tick();
    const after = discoveryJson(home, "aftereffects");
    expect(after.project).toBe(path.join(temp, "other.aep"));
    expect(after.last_active_at >= before).toBe(true);
  });

  test("quitting removes the discovery and token files and stops the server", async () => {
    const { link, home, cep, desktopDir } = await bootAe();
    const tokenFile = link.discovery.tokenFile;
    cep.fire(EVENTS.beforeQuit);
    await tick();
    expect(existsSync(path.join(home, ".openshot_qt", "link", "aftereffects.json"))).toBe(false);
    expect(existsSync(tokenFile)).toBe(false);
    expect(await discoverHosts(desktopDir)).toEqual([]);
    expect(cep.listenerCount(EVENTS.activate)).toBe(0);
  });

  test("a missing host script is reported, the server still starts", async () => {
    const { link, home } = await bootAe({ evalScript: () => "EvalScript error." });
    expect(link.status().host_script).toEqual({ ok: false, problem: "the host script is not loaded (EvalScript error.)" });
    expect(discoveryJson(home, "aftereffects").project).toBeNull();
  });

  test("Premiere Pro boots its own server and file", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-boot-"));
    const mock = createPremiereMock({ tempDir: temp });
    mock.project.path = path.join(temp, "trip.prproj");
    const host = loadHostScript("ppro", mock.globals);
    const cep = new FakeCep({ appName: "PPRO", appVersion: "26.0.0", extensionDir: EXTENSION_DIR, evalScript: evalInHostScript(host) });
    const link = await boot({ cep, home: path.join(temp, "home"), pollMs: 60_000, log: () => undefined });
    running.push(link);
    expect(discoveryJson(path.join(temp, "home"), "premiere")).toMatchObject({ app: "premiere", app_name: "Adobe Premiere Pro 2026", project: path.join(temp, "trip.prproj") });
  });

  test("other Adobe apps are refused", async () => {
    const cep = new FakeCep({ appName: "PHXS", appVersion: "27.0.0", extensionDir: EXTENSION_DIR, evalScript: () => "" });
    await expect(boot({ cep, home: mkdtempSync(path.join(os.tmpdir(), "zenvi-link-boot-")), log: () => undefined })).rejects.toThrow(/not PHXS/);
  });
});

test.each([
  ["aftereffects", "26.3.0", "Adobe After Effects 2026"],
  ["aftereffects", "22.0.1", "Adobe After Effects 2022"],
  ["aftereffects", "18.4.1", "Adobe After Effects 2021"],
  ["premiere", "25.6.0", "Adobe Premiere Pro 2025"],
  ["premiere", "15.4.0", "Adobe Premiere Pro 2021"],
  ["premiere", "", "Adobe Premiere Pro"],
])("marketingName(%s, %s) = %s", (host, version, name) => {
  expect(marketingName(host, version)).toBe(name);
});
