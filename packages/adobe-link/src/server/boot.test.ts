import { chmodSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PACKAGE_ROOT } from "../host-bundle.js";
import { HostClient } from "../client.js";
import { discoverHosts } from "../discovery.js";
import { createAeMock } from "../testing/ae-mock.js";
import { FakeCep, evalInHostScript } from "../testing/fake-cep.js";
import { loadHostScript } from "../testing/host-script.js";
import { bootModule, discoveryModule, type BootedLink } from "../testing/link-server.js";
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

/** Waits (up to 5 s) for a condition that background work makes true. */
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition(); waited += 20) {
    if (waited > 5000) throw new Error("condition not reached within 5 s");
    await tick(20);
  }
}

async function bootAe(options: { evalScript?: (script: string) => string } = {}) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-boot-"));
  const home = path.join(temp, "home");
  const mock = createAeMock({ tempDir: temp });
  mock.project.save(new mock.es.File(path.join(temp, "promo.aep")));
  const host = loadHostScript("aeft", mock.globals);
  const cep = new FakeCep({ appName: "AEFT", appVersion: "26.3.0", extensionDir: EXTENSION_DIR, evalScript: options.evalScript ?? evalInHostScript(host) });
  const link = await boot({ cep, mode: "service", home, tempDir: temp, pollMs: 60_000, touchIntervalMs: 0, log: () => undefined });
  running.push(link);
  return { link, cep, mock, host, temp, home, desktopDir: path.join(home, ".openshot_qt") };
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
      token_file: path.join(home, ".openshot_qt", "link", `aftereffects.${process.pid}.token`),
    });
    expect(readFileSync(json.token_file, "utf8")).toBe(link.server.token);
    expect(link.status()).toMatchObject({ mode: "service", ready: true, host: "aftereffects", url: link.server.url, host_script: { ok: true } });
  });

  test("tells the host script where Zenvi Link's temp folder is", async () => {
    const { link, host, temp } = await bootAe();
    expect(link.server.tempDir).toBe(path.join(temp, "zenvi-link"));
    expect(host.evaluate("ZenviLink.tempDir()")).toBe(link.server.tempDir);
    const file = String(host.evaluate('ZenviLink.tempFile("capture", "png")'));
    expect(path.dirname(file)).toBe(link.server.tempDir);
    expect(path.basename(file)).toMatch(/^capture-\d+-\d+\.png$/);
  });

  test("a configure call that did not get through at boot is retried on the next refresh", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-boot-"));
    const mock = createAeMock({ tempDir: temp });
    const host = loadHostScript("aeft", mock.globals);
    const evaluate = evalInHostScript(host);
    let refusals = 1;
    const cep = new FakeCep({
      appName: "AEFT",
      appVersion: "26.3.0",
      extensionDir: EXTENSION_DIR,
      evalScript: (script) => (script.startsWith("ZenviLink.configure(") && refusals-- > 0 ? "EvalScript error." : evaluate(script)),
    });
    const link = await boot({ cep, home: path.join(temp, "home"), tempDir: path.join(temp, "system"), pollMs: 60_000, log: () => undefined });
    running.push(link);
    expect(host.evaluate("ZenviLink.state.config.temp_dir")).toBeUndefined();
    cep.fire(EVENTS.activate);
    await until(() => host.evaluate("ZenviLink.state.config.temp_dir") === link.server.tempDir);
  });

  test("answers status requests from the first moment, then broadcasts once ready", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-boot-"));
    const mock = createAeMock({ tempDir: temp });
    const cep = new FakeCep({ appName: "AEFT", appVersion: "26.3.0", extensionDir: EXTENSION_DIR, evalScript: evalInHostScript(loadHostScript("aeft", mock.globals)) });
    const booting = boot({ cep, home: path.join(temp, "home"), pollMs: 60_000, log: () => undefined });
    cep.fire(EVENTS.statusRequest, { from: "panel" });
    const link = await booting;
    running.push(link);
    const statuses = cep.dispatched.filter((event) => event.type === EVENTS.status).map((event) => JSON.parse(event.data ?? "{}"));
    expect(statuses.map((status) => [status.ready, status.url])).toEqual([
      [false, null],
      [true, link.server.url],
    ]);
  });

  test("a panel never publishes over a live service", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-boot-"));
    const home = path.join(temp, "home");
    const linkDir = path.join(home, ".openshot_qt", "link");
    // The service runs in another (live) process: this test's parent.
    const service = new discoveryModule.DiscoveryFile({ host: "aftereffects", dir: linkDir, pid: process.ppid });
    await service.publish({ url: "http://127.0.0.1:1/mcp", token: "t".repeat(64), project: null, version: "1.0.0", appName: "x", appVersion: "26.3.0" });
    const before = readFileSync(path.join(linkDir, "aftereffects.json"), "utf8");
    const mock = createAeMock({ tempDir: temp });
    const cep = new FakeCep({ appName: "AEFT", appVersion: "26.3.0", extensionDir: EXTENSION_DIR, evalScript: evalInHostScript(loadHostScript("aeft", mock.globals)) });
    await expect(boot({ cep, mode: "panel", home, pollMs: 60_000, log: () => undefined })).rejects.toMatchObject({ code: "SERVICE_RUNNING" });
    expect(readFileSync(path.join(linkDir, "aftereffects.json"), "utf8")).toBe(before);
    expect(existsSync(path.join(linkDir, `aftereffects.${process.pid}.token`))).toBe(false);
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a discovery write that fails never fails a tool call or an app event", async () => {
    const { link, cep, home, desktopDir } = await bootAe();
    const [endpoint] = await discoverHosts(desktopDir);
    const client = new HostClient(endpoint!);
    clients.push(client);
    const linkDir = path.join(home, ".openshot_qt", "link");
    chmodSync(linkDir, 0o500);
    try {
      expect((await client.callTool("ae_get_state")).receipt?.status).toBe("ok");
      cep.fire(EVENTS.activate);
      await tick();
      await link.discovery.settled();
      expect(link.discovery.problem).toMatch(/EACCES|EPERM/);
      expect(link.status().discovery.problem).toMatch(/EACCES|EPERM/);
    } finally {
      chmodSync(linkDir, 0o700);
    }
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
    cep.dispatched.splice(0);
    cep.fire(EVENTS.statusRequest, { from: "panel" });
    const status = cep.dispatched.filter((event) => event.type === EVENTS.status).map((event) => JSON.parse(event.data ?? "{}"));
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ mode: "service", ready: true, url: link.server.url, token_file: link.discovery.tokenFile, tools: expect.any(Number) });
    expect(status[0]).not.toHaveProperty("token");
  });

  test("activation refreshes last_active_at and the open project", async () => {
    const { home, mock, cep, temp } = await bootAe();
    const before = discoveryJson(home, "aftereffects").last_active_at;
    mock.project.save(new mock.es.File(path.join(temp, "other.aep")));
    await tick(5);
    cep.fire(EVENTS.activate);
    // The refresh runs off the event: wait for it rather than for a fixed time.
    await until(() => discoveryJson(home, "aftereffects").project === path.join(temp, "other.aep"));
    expect(discoveryJson(home, "aftereffects").last_active_at >= before).toBe(true);
  });

  test("the older activate event name refreshes too", async () => {
    const { home, mock, cep, temp } = await bootAe();
    mock.project.save(new mock.es.File(path.join(temp, "legacy.aep")));
    cep.fire(EVENTS.activateLegacy);
    await until(() => discoveryJson(home, "aftereffects").project === path.join(temp, "legacy.aep"));
  });

  test("the page's unload (the cleanup CEP really does) removes the files and stops the server", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-boot-"));
    const home = path.join(temp, "home");
    const mock = createAeMock({ tempDir: temp });
    const cep = new FakeCep({ appName: "AEFT", appVersion: "26.3.0", extensionDir: EXTENSION_DIR, evalScript: evalInHostScript(loadHostScript("aeft", mock.globals)) });
    const unloads: (() => void)[] = [];
    const window = { addEventListener: (type: string, listener: () => void) => type === "unload" && unloads.push(listener), removeEventListener: () => undefined };
    const link = await boot({ cep, window, home, tempDir: temp, pollMs: 60_000, log: () => undefined });
    running.push(link);
    expect(unloads).toHaveLength(1);
    unloads[0]?.();
    expect(existsSync(path.join(home, ".openshot_qt", "link", "aftereffects.json"))).toBe(false);
    expect(existsSync(link.discovery.tokenFile)).toBe(false);
    expect(await discoverHosts(path.join(home, ".openshot_qt"))).toEqual([]);
  });

  test("quitting removes the discovery and token files and stops the server", async () => {
    const { link, home, cep, desktopDir } = await bootAe();
    const tokenFile = link.discovery.tokenFile;
    cep.fire(EVENTS.beforeQuit);
    expect(existsSync(path.join(home, ".openshot_qt", "link", "aftereffects.json"))).toBe(false);
    expect(existsSync(tokenFile)).toBe(false);
    expect(await discoverHosts(desktopDir)).toEqual([]);
    expect(cep.listenerCount(EVENTS.activate)).toBe(0);
  });

  test("a missing host script is reported, loaded from disk once, and the server still starts", async () => {
    const { link, home, cep } = await bootAe({ evalScript: () => "EvalScript error." });
    expect(link.status().host_script).toEqual({ ok: false, problem: "the host script is not loaded (EvalScript error.)" });
    expect(discoveryJson(home, "aftereffects").project).toBeNull();
    const count = (wanted: string) => cep.scripts.filter((script) => script === wanted).length;
    const checks = () => count("ZenviLink.listTools()");
    const infos = () => count("ZenviLink.hostInfo()");
    const [checksAtBoot, infosAtBoot] = [checks(), infos()];
    // Status probes run only when the queue is idle, so let each refresh finish before the next activation.
    cep.fire(EVENTS.activate);
    await until(() => infos() > infosAtBoot);
    cep.fire(EVENTS.activate);
    await until(() => infos() > infosAtBoot + 1);
    expect(checks()).toBe(checksAtBoot + 2);
    expect(cep.scripts.filter((script) => script.startsWith("$.evalFile(")).length).toBe(1);
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

describe("hostScriptLoader", () => {
  test("an attempt that could not run (busy queue) does not count; one that ran is the only one", async () => {
    const log: string[] = [];
    let busy = true;
    let ok = false;
    const ensure = bootModule.hostScriptLoader(
      async () => {
        log.push("check");
        return ok;
      },
      async () => {
        log.push(busy ? "load (busy)" : "load");
        return !busy;
      },
    );
    await ensure();
    busy = false;
    await ensure();
    await ensure();
    expect(log).toEqual(["check", "load (busy)", "check", "load", "check", "check"]);
    ok = true;
    await ensure();
    expect(log.at(-1)).toBe("check");
  });

  test("no load while the check itself could not run", async () => {
    let loads = 0;
    const ensure = bootModule.hostScriptLoader(async () => null, async () => (loads += 1) > 0);
    await ensure();
    expect(loads).toBe(0);
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
