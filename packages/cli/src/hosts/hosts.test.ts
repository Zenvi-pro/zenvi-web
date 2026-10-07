import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { fakeLinkHost, type FakeLinkHost } from "../test-support/adobe.js";
import { fakeDesktop, testEnv, writeDiscovery, type FakeDesktop } from "../test-support/harness.js";
import { bundledExtension, defaultDetectDeps, findAdobeApps, findInstalledExtensions, manifestVersion, type DetectDeps } from "./extension.js";
import { adobeDoctor, tooOldApps } from "./doctor.js";
import { decideFamilies, decideHandoff } from "./policy.js";
import { HostRegistry, describeHosts } from "./registry.js";

let home: string;
let desktopDir: string;
const stops: Array<() => Promise<void>> = [];

beforeEach(async () => {
  home = await makeTempDir("zenvi-hosts-home-");
  desktopDir = path.join(home, ".openshot_qt");
  await mkdir(desktopDir, { recursive: true });
});

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  await removeDir(home);
});

/** Detection on a pretend machine: `files` exist (directories are implied by their children). */
function fakeDetect(platform: string, files: Record<string, string>, env: NodeJS.ProcessEnv = {}): DetectDeps {
  const dirs = new Set<string>();
  for (const file of Object.keys(files)) for (let d = path.posix.dirname(file); d !== "/" && d !== "."; d = path.posix.dirname(d)) dirs.add(d);
  return {
    platform,
    home: "/Users/me",
    env,
    exists: async (f) => f in files || dirs.has(f),
    listDir: async (dir) => {
      const prefix = `${dir}/`;
      const names = [...Object.keys(files), ...dirs].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length).split("/")[0]!);
      return dirs.has(dir) ? [...new Set(names)] : undefined;
    },
    readText: async (f) => files[f],
    isLink: async (f) => f.endsWith("linked/pro.zenvi.link"),
  };
}

const USER_EXT = "/Users/me/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link/CSXS/manifest.xml";
const SYSTEM_EXT = "/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link/CSXS/manifest.xml";
const MANIFEST = '<ExtensionManifest ExtensionBundleId="pro.zenvi.link" ExtensionBundleVersion="1.0.0" Version="7.0">';

describe("which Adobe families zenvi mcp lists (ZENVI_MCP_ADOBE)", () => {
  it("off lists none, on lists both, whatever is installed", async () => {
    const off = await decideFamilies(desktopDir, fakeDetect("darwin", { [USER_EXT]: MANIFEST }, { ZENVI_MCP_ADOBE: "off" }));
    expect([off.aftereffects.listed, off.premiere.listed]).toEqual([false, false]);
    expect(off.aftereffects.enable).toMatch(/ZENVI_MCP_ADOBE/);
    const on = await decideFamilies(desktopDir, fakeDetect("linux", {}, { ZENVI_MCP_ADOBE: "ON" }));
    expect([on.aftereffects.listed, on.premiere.listed]).toEqual([true, true]);
  });

  it("auto: nothing without Zenvi Link, and says how to get it", async () => {
    const none = await decideFamilies(desktopDir, fakeDetect("darwin", { "/Applications/Adobe After Effects 2026/x": "" }));
    expect(none.aftereffects).toMatchObject({ listed: false, reason: "Zenvi Link is not installed" });
    expect(none.aftereffects.enable).toMatch(/zenvi adobe install/);
  });

  it("auto: an installed extension lists the families of the apps that are installed", async () => {
    const aeOnly = await decideFamilies(desktopDir, fakeDetect("darwin", { [USER_EXT]: MANIFEST, "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app": "" }));
    expect(aeOnly.aftereffects).toMatchObject({ listed: true, reason: "Zenvi Link and Adobe After Effects 2026 are installed" });
    expect(aeOnly.premiere).toMatchObject({ listed: false, reason: "Zenvi Link is installed but Premiere Pro was not found" });
    // No app in the standard folders (a custom install location): both rather than guessing.
    const neither = await decideFamilies(desktopDir, fakeDetect("darwin", { [SYSTEM_EXT]: MANIFEST }));
    expect([neither.aftereffects.listed, neither.premiere.listed]).toEqual([true, true]);
  });

  it("auto: a discovery file lists that app's family even without a detected install", async () => {
    await mkdir(path.join(desktopDir, "link"), { recursive: true });
    await writeFile(path.join(desktopDir, "link", "premiere.json"), "{}");
    const real = { ...fakeDetect("linux", {}), exists: async (f: string) => f === path.join(desktopDir, "link", "premiere.json") };
    const decided = await decideFamilies(desktopDir, real);
    expect(decided.premiere.listed).toBe(true);
    expect(decided.aftereffects.listed).toBe(false);
  });
});

describe("which desktop handoff tools zenvi mcp lists (ZENVI_MCP_HANDOFF)", () => {
  const deps = (env: NodeJS.ProcessEnv, files: string[], installed: boolean) => ({
    env,
    exists: async (f: string) => files.includes(f),
    appInstalled: async () => installed,
  });

  it("auto: when the desktop app has run here or is installed; on / off override", async () => {
    expect(await decideHandoff(desktopDir, deps({}, [], false))).toMatchObject({ listed: false, reason: "the Zenvi desktop app is not installed" });
    expect(await decideHandoff(desktopDir, deps({}, [], true))).toMatchObject({ listed: true, reason: "the Zenvi desktop app is installed" });
    expect(await decideHandoff(desktopDir, deps({}, [path.join(desktopDir, "headless_mcp.json")], false))).toMatchObject({ listed: true });
    expect(await decideHandoff(desktopDir, deps({ ZENVI_MCP_HANDOFF: "on" }, [], false))).toMatchObject({ listed: true });
    expect(await decideHandoff(desktopDir, deps({ ZENVI_MCP_HANDOFF: "off" }, [], true))).toMatchObject({ listed: false, reason: "ZENVI_MCP_HANDOFF=off" });
  });
});

describe("Zenvi Link on disk", () => {
  it("finds per-user and machine-wide copies with their versions; reads the bundled one from ZENVI_ADOBE_EXTENSION", async () => {
    const linkedManifest = "/Users/me/linked/pro.zenvi.link/CSXS/manifest.xml";
    const deps = fakeDetect("darwin", { [USER_EXT]: MANIFEST, [SYSTEM_EXT]: MANIFEST.replace("1.0.0", "0.9.0"), [linkedManifest]: MANIFEST });
    expect(await findInstalledExtensions(deps)).toEqual([
      { dir: path.posix.dirname(path.posix.dirname(USER_EXT)), version: "1.0.0", scope: "user", linked: false },
      { dir: path.posix.dirname(path.posix.dirname(SYSTEM_EXT)), version: "0.9.0", scope: "system", linked: false },
    ]);
    expect(await findInstalledExtensions(fakeDetect("linux", { [USER_EXT]: MANIFEST }))).toEqual([]);
    const bundled = await bundledExtension({ ...deps, env: { ZENVI_ADOBE_EXTENSION: "/Users/me/linked/pro.zenvi.link" } });
    expect(bundled).toEqual({ dir: "/Users/me/linked/pro.zenvi.link", version: "1.0.0" });
    expect(manifestVersion('<X ExtensionBundleVersion = "2.1.0">')).toBe("2.1.0");
  });

  it("detects Adobe apps by their folders", async () => {
    const found = await findAdobeApps(fakeDetect("darwin", { "/Applications/Adobe Premiere Pro 2026/a": "", "/Applications/Adobe Premiere Pro (Beta)/b": "", "/Applications/Other/c": "" }));
    expect(found).toEqual({ apps: { aftereffects: [], premiere: ["Adobe Premiere Pro 2026", "Adobe Premiere Pro (Beta)"] }, looked: true });
    expect((await findAdobeApps(fakeDetect("linux", {}))).looked).toBe(false);
  });
});

describe("adobe doctor", () => {
  it("flags an app older than the 2021 releases Zenvi Link loads in", async () => {
    // Review W2-1 #6: the manifest loads only After Effects 18.0+ / Premiere Pro 15.0+.
    const detect = fakeDetect("darwin", { "/Applications/Adobe After Effects 2020/Adobe After Effects 2020.app": "", "/Applications/Adobe Premiere Pro 2026/x": "" });
    const checks = await adobeDoctor({ desktopDir, detect, run: () => ({ code: 1, stdout: "" }) });
    expect(checks.find((c) => c.name === "after effects")!.hint).toBe(
      "Adobe After Effects 2020 is older than Zenvi Link supports: it loads in After Effects 2021 (18.0) or newer.",
    );
    expect(checks.find((c) => c.name === "premiere pro")!.hint).toMatch(/^Open Premiere Pro/);
    expect(tooOldApps("aftereffects", ["Adobe After Effects CC 2019", "Adobe After Effects 2021", "Adobe After Effects (Beta)"])).toEqual(["Adobe After Effects CC 2019"]);
  });
});

describe("listHosts (SPEC §3.8)", () => {
  async function aeHost(lastActive: string, project: string | null = "/Work/promo.aep"): Promise<FakeLinkHost> {
    const host = await fakeLinkHost({ host: "aftereffects", desktopDir, lastActive, project });
    stops.push(() => host.stop());
    return host;
  }

  async function desktopApp(project: string): Promise<FakeDesktop> {
    const desktop = await fakeDesktop("tok-hosts", project);
    stops.push(() => desktop.close());
    await writeDiscovery(home, desktop);
    return desktop;
  }

  const registry = (project: string | null, lastCallAt?: number) =>
    new HostRegistry({
      config: loadConfig(testEnv(home)),
      env: testEnv(home, { ZENVI_MCP_ADOBE: "auto" }),
      clientVersion: "test",
      cacheMs: 0,
      // Real files (the discovery files in the temp home), but no CEP or app folders: only discovery files count.
      detect: { ...defaultDetectDeps(home, testEnv(home)), platform: "linux" },
      portable: () => ({ project, lastCallAt }),
    });

  it("reports all four hosts; nothing running: the portable engine is active", async () => {
    const reg = registry(null);
    const report = await reg.list();
    expect(report.hosts.map((h) => [h.id, h.kind, h.connected])).toEqual([
      ["zenvi-desktop", "zenvi", false],
      ["zenvi-portable", "zenvi", true],
      ["after-effects", "aftereffects", false],
      ["premiere-pro", "premiere", false],
    ]);
    expect(report.active).toBe("zenvi-portable");
    expect(report.hosts[3]).toMatchObject({ install_hint: "zenvi adobe install", status: "absent", tools_listed: false });
    expect(String(report.hosts[3]!.how_to_connect)).toMatch(/Window > Extensions > Zenvi Link/);
    expect(describeHosts(report)).toMatch(/^Active: Portable Zenvi engine\. Connected: Portable Zenvi engine\. Not connected: Zenvi desktop app/);
    await reg.close();
  });

  it("the most recently active connected host wins: After Effects after its activation, then the portable engine after a call", async () => {
    const project = path.join(home, "trip.zvn");
    await desktopApp(project);
    // The desktop's discovery file is fresh (mtime now); After Effects was activated later.
    const later = new Date(Date.now() + 60_000).toISOString();
    await aeHost(later);
    const first = await registry(project).list();
    expect(first.active).toBe("after-effects");
    const ae = first.hosts.find((h) => h.id === "after-effects")!;
    expect(ae).toMatchObject({ connected: true, active: true, app_version: "26.3.0", project: "/Work/promo.aep", last_active_at: later, tools_listed: true });
    expect(ae.tools).toBeGreaterThan(0);
    const desktop = first.hosts.find((h) => h.id === "zenvi-desktop")!;
    expect(desktop).toMatchObject({ connected: true, active: false, project, version: "1.0.0-test", pid: process.pid });
    // The portable engine forwards to the desktop while it has the project open, so it is never active then.
    expect(first.hosts.find((h) => h.id === "zenvi-portable")).toMatchObject({ routes_to: "zenvi-desktop" });
    expect((await registry(project, Date.now() + 120_000).list()).active).toBe("after-effects");
    // ZENVI_MCP_ENGINE=portable: never forwarded, so a newer portable call makes the portable engine active.
    const portableOnly = new HostRegistry({
      config: loadConfig(testEnv(home)),
      env: testEnv(home, { ZENVI_MCP_ENGINE: "portable" }),
      clientVersion: "test",
      cacheMs: 0,
      detect: { ...defaultDetectDeps(home, testEnv(home)), platform: "linux" },
      portable: () => ({ project, lastCallAt: Date.now() + 120_000 }),
    });
    const forced = await portableOnly.list();
    expect(forced.hosts.find((h) => h.id === "zenvi-portable")!.routes_to).toBeUndefined();
    expect(forced.active).toBe("zenvi-portable");
    // Another project: the portable engine edits it itself, and a newer call makes it active.
    const other = path.join(home, "other.zvn");
    expect((await registry(other, Date.now() + 120_000).list()).active).toBe("zenvi-portable");
  });

  it("a dead After Effects is reported (and its stale file removed); a wrong token is unreachable", async () => {
    const host = await fakeLinkHost({ host: "aftereffects", desktopDir, pid: 2_000_000_000 });
    stops.push(() => host.stop());
    const report = await registry(null).list();
    expect(report.hosts.find((h) => h.id === "after-effects")).toMatchObject({ connected: false, status: "dead" });
    await expect(readFile(host.discoveryFile, "utf8")).rejects.toThrow();
    // ...together with that instance's own token file (aftereffects.<pid>.token).
    expect(path.basename(host.tokenFile)).toBe("aftereffects.2000000000.token");
    await expect(readFile(host.tokenFile, "utf8")).rejects.toThrow();

    const live = await fakeLinkHost({ host: "premiere", desktopDir });
    stops.push(() => live.stop());
    // The discovery file names this instance's token file (<app>.<pid>.token); a wrong token there is refused.
    const named = (JSON.parse(await readFile(live.discoveryFile, "utf8")) as { token_file: string }).token_file;
    expect(named).toBe(live.tokenFile);
    expect(path.basename(named)).toBe(`premiere.${process.pid}.token`);
    await writeFile(named, "00".repeat(32));
    const unreachable = (await registry(null).list()).hosts.find((h) => h.id === "premiere-pro")!;
    expect(unreachable).toMatchObject({ connected: false, status: "unreachable" });
    expect(String(unreachable.how_to_connect)).toMatch(/did not answer/);
  });

  it("reuses one client per app while the discovery file names the same server", async () => {
    await aeHost(new Date().toISOString());
    const reg = registry(null);
    const a = await reg.connect("aftereffects");
    const b = await reg.connect("aftereffects");
    expect(a.ok && b.ok && a.client === b.client).toBe(true);
    await reg.close();
  });
});
