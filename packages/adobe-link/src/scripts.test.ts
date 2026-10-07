import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { buildExtension } from "../scripts/build-extension.mjs";
import { describeAction, planInstall } from "../scripts/install-dev.mjs";
import { MISSING_HELP, findZxpSignCmd, packageZxp } from "../scripts/package-zxp.mjs";
import { PACKAGE_ROOT, bundleHostScript } from "./host-bundle.js";
import { HostClient } from "./client.js";
import { discoverHosts } from "./discovery.js";
import { LINK_VERSION } from "./version.js";
import { createAeMock } from "./testing/ae-mock.js";
import { checkEs3 } from "./testing/es3.js";
import { FakeCep, evalInHostScript } from "./testing/fake-cep.js";
import { createHostRealm, loadHostScript } from "./testing/host-script.js";
import type { BootedLink } from "./testing/link-server.js";

function temp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "zenvi-link-scripts-"));
}

const booted: BootedLink[] = [];
const clients: HostClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(booted.splice(0).map((link) => link.stop()));
});

describe("build-extension", () => {
  test("assembles dist/pro.zenvi.link with the manifest version, host bundles and catalogs", () => {
    const { dir, files } = buildExtension({ outDir: temp() });
    expect(files).toEqual([
      ".debug",
      "CSXS/manifest.xml",
      "catalog/aftereffects.json",
      "catalog/premiere.json",
      "host/aeft.jsx",
      "host/ppro.jsx",
      "icons/icon-dark-normal.png",
      "icons/icon-dark-rollover.png",
      "icons/icon-normal.png",
      "icons/icon-rollover.png",
      "package.json",
      "panel/index.html",
      "panel/panel-core.js",
      "panel/panel.css",
      "panel/panel.js",
      "panel/send-to-zenvi-aftereffects.js",
      "panel/send-to-zenvi-premiere.js",
      "server/bridge.js",
      "server/discovery.js",
      "server/index.js",
      "server/queue.js",
      "server/schema.js",
      "server/server.js",
      "server/service.html",
      "server/service.js",
      "server/titles.js",
    ]);
    const manifest = readFileSync(path.join(dir, "CSXS", "manifest.xml"), "utf8");
    expect(manifest).not.toContain("__VERSION__");
    expect(manifest).toContain(`ExtensionBundleVersion="${LINK_VERSION}"`);
    expect(manifest.match(new RegExp(`Version="${LINK_VERSION.replace(/\./g, "\\.")}"`, "g"))).toHaveLength(3);
    for (const app of ["aeft", "ppro"] as const) {
      const text = readFileSync(path.join(dir, "host", `${app}.jsx`), "utf8");
      expect(text).toBe(bundleHostScript(app).text);
      expect(checkEs3(text)).toBeUndefined();
    }
    expect(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).type).toBe("commonjs");
  });

  test("release builds leave out .debug", () => {
    const { files } = buildExtension({ outDir: temp(), release: true });
    expect(files).not.toContain(".debug");
  });

  test("the built extension boots from its own folder and serves tools", async () => {
    const { dir } = buildExtension({ outDir: temp() });
    const { boot } = createRequire(import.meta.url)(path.join(dir, "server", "index.js")) as { boot: (options: unknown) => Promise<BootedLink> };
    const home = temp();
    const mock = createAeMock({ tempDir: home });
    mock.addComp({ name: "Built" });
    const cep = new FakeCep({ appName: "AEFT", appVersion: "26.3.0", extensionDir: dir, evalScript: evalInHostScript(loadHostScript("aeft", mock.globals)) });
    const link = await boot({ cep, home, pollMs: 60_000, log: () => undefined });
    booted.push(link);
    const [endpoint] = await discoverHosts(path.join(home, ".openshot_qt"));
    const client = new HostClient(endpoint!);
    clients.push(client);
    expect((await client.callTool("ae_get_state")).receipt?.data).toMatchObject({ active_comp: { name: "Built" } });
  });
});

test("a host script CEP did not load is loaded from the extension folder", async () => {
  const { dir } = buildExtension({ outDir: temp() });
  const { boot } = createRequire(import.meta.url)(path.join(dir, "server", "index.js")) as { boot: (options: unknown) => Promise<BootedLink> };
  const home = temp();
  const mock = createAeMock({ tempDir: home });
  const realm = createHostRealm(mock.globals);
  const cep = new FakeCep({ appName: "AEFT", appVersion: "26.3.0", extensionDir: dir, evalScript: evalInHostScript(realm) });
  const link = await boot({ cep, home, pollMs: 60_000, log: () => undefined });
  booted.push(link);
  expect(link.status().host_script).toEqual({ ok: true, problem: null });
  expect(cep.scripts.filter((script) => script.startsWith("$.evalFile("))).toEqual([`$.evalFile(new File(${JSON.stringify(path.join(dir, "host", "aeft.jsx").split(path.sep).join("/"))}))`]);
});

describe("install-dev", () => {
  test("macOS: link into ~/Library/Application Support/Adobe/CEP/extensions and set PlayerDebugMode for CSXS 9-12", () => {
    const plan = planInstall({ platform: "darwin", home: "/Users/me", outDir: "/repo/dist" });
    expect(plan.target).toBe("/Users/me/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link");
    expect(plan.actions.map(describeAction)).toEqual([
      "build /repo/dist/pro.zenvi.link",
      "remove /Users/me/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link",
      "link /Users/me/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link -> /repo/dist/pro.zenvi.link (dir)",
      "run defaults write com.adobe.CSXS.9 PlayerDebugMode 1",
      "run defaults write com.adobe.CSXS.10 PlayerDebugMode 1",
      "run defaults write com.adobe.CSXS.11 PlayerDebugMode 1",
      "run defaults write com.adobe.CSXS.12 PlayerDebugMode 1",
    ]);
  });

  test("Windows: a junction in %APPDATA% and reg add for CSXS 9-12; --copy copies", () => {
    const plan = planInstall({ platform: "win32", home: "C:\\Users\\me", appData: "C:\\Users\\me\\AppData\\Roaming", outDir: "C:\\repo\\dist", copy: true });
    expect(plan.target).toBe("C:\\Users\\me\\AppData\\Roaming\\Adobe\\CEP\\extensions\\pro.zenvi.link");
    expect(plan.actions.map(describeAction).slice(2)).toEqual([
      `copy ${path.join("C:\\repo\\dist", "pro.zenvi.link")} -> C:\\Users\\me\\AppData\\Roaming\\Adobe\\CEP\\extensions\\pro.zenvi.link`,
      "run reg add HKCU\\Software\\Adobe\\CSXS.9 /v PlayerDebugMode /t REG_SZ /d 1 /f",
      "run reg add HKCU\\Software\\Adobe\\CSXS.10 /v PlayerDebugMode /t REG_SZ /d 1 /f",
      "run reg add HKCU\\Software\\Adobe\\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f",
      "run reg add HKCU\\Software\\Adobe\\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f",
    ]);
    expect(planInstall({ platform: "win32", home: "C:\\Users\\me", appData: "C:\\x" }).actions[2]).toMatchObject({ kind: "link", type: "junction" });
  });

  test("--uninstall only removes the extension and says how to turn debug mode off", () => {
    const plan = planInstall({ platform: "darwin", home: "/Users/me", uninstall: true });
    expect(plan.actions.map(describeAction)).toEqual(["remove /Users/me/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link"]);
    expect(plan.notes.join("\n")).toContain("defaults delete com.adobe.CSXS.12 PlayerDebugMode");
  });

  test("other platforms are refused", () => {
    expect(() => planInstall({ platform: "linux", home: "/home/me" })).toThrow(/macOS and Windows/);
  });

  test("--dry-run with a temp HOME prints the plan and changes nothing", () => {
    const home = temp();
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/install-dev.mjs", "--dry-run", "--platform", "darwin"], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Would install Zenvi Link at ${path.join(home, "Library", "Application Support", "Adobe", "CEP", "extensions", "pro.zenvi.link")}`);
    expect(result.stdout).toContain("run defaults write com.adobe.CSXS.9 PlayerDebugMode 1");
    expect(readdirSync(home)).toEqual([]);
  });
});

describe("package-zxp", () => {
  test("without ZXPSignCmd it explains and exits 0", () => {
    const empty = temp();
    expect(findZxpSignCmd({ PATH: empty })).toBeUndefined();
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/package-zxp.mjs", "--out", temp()], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, PATH: empty, ZXP_SIGN_CMD: "" },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(MISSING_HELP);
  });

  test.skipIf(process.platform === "win32")("with ZXPSignCmd: self-signed certificate, sign, verify", () => {
    const bin = temp();
    const out = temp();
    const calls = path.join(bin, "calls.log");
    const signer = path.join(bin, "ZXPSignCmd");
    // A stand-in for Adobe's tool: records its arguments, creates the files it would.
    writeFileSync(
      signer,
      `#!/bin/sh\necho "$@" >> "${calls}"\nif [ "$1" = "-selfSignedCert" ]; then echo cert > "$7"; fi\nif [ "$1" = "-sign" ]; then echo zxp > "$3"; fi\nexit 0\n`,
    );
    chmodSync(signer, 0o755);
    expect(findZxpSignCmd({ PATH: bin })).toBe(signer);
    const zxp = packageZxp({ env: { PATH: bin }, outDir: out, log: () => undefined });
    expect(zxp).toBe(path.join(out, `pro.zenvi.link-${LINK_VERSION}.zxp`));
    expect(existsSync(zxp as string)).toBe(true);
    const lines = readFileSync(calls, "utf8").trim().split("\n");
    expect(lines.map((line) => line.split(" ")[0])).toEqual(["-selfSignedCert", "-sign", "-verify"]);
    expect(lines[1]).toContain(path.join(out, "zxp", "zenvi-link-selfsigned.p12"));
    expect(existsSync(path.join(out, "zxp", "zenvi-link-selfsigned.password"))).toBe(true);
  });
});
