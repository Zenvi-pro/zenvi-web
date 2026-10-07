import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AE_TOOLS } from "@zenvi/adobe-link";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GEN_FILE, HANDOFF_TOOLS, syncText } from "../../scripts/sync-desktop-handoff-tools.mjs";
import { tasteModule } from "../../scripts/sync-taste.mjs";
import { DESKTOP_HANDOFF_TOOLS } from "../hosts/handoff.js";
import { fakeLinkHost } from "../test-support/adobe.js";
import { fakeDesktop, testEnv, writeDiscovery, zenvi } from "../test-support/harness.js";
import { testRegistry } from "../test-support/registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let home: string;
let work: string;
const cleanup: Array<() => Promise<void>> = [];

beforeEach(async () => {
  home = await makeTempDir("zenvi-hosts-cli-home-");
  work = await makeTempDir("zenvi-hosts-cli-work-");
});

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  await removeDir(home);
  await removeDir(work);
});

const run = (args: string[], env: NodeJS.ProcessEnv = {}) => zenvi(args, { cwd: work, env: testEnv(home, env), registry: testRegistry() });

async function fakeExtension(version = "1.0.0"): Promise<string> {
  const dir = path.join(work, "build", "pro.zenvi.link");
  await mkdir(path.join(dir, "CSXS"), { recursive: true });
  await writeFile(path.join(dir, "CSXS", "manifest.xml"), `<ExtensionManifest ExtensionBundleId="pro.zenvi.link" ExtensionBundleVersion="${version}">`);
  return dir;
}

describe("zenvi hosts", () => {
  it("prints the SPEC §3.8 host list (--json) and a table", async () => {
    const ae = await fakeLinkHost({ host: "aftereffects", desktopDir: path.join(home, ".openshot_qt"), project: "/Work/promo.aep" });
    cleanup.push(() => ae.stop());
    const desktop = await fakeDesktop("tok-hosts-cli", path.join(work, "trip.zvn"));
    cleanup.push(() => desktop.close());
    await writeDiscovery(home, desktop);
    const json = await run(["hosts", "--json"]);
    expect(json.code).toBe(0);
    const report = json.json<{ hosts: Array<Record<string, unknown>>; active: string }>();
    expect(report.hosts.map((h) => [h.id, h.connected])).toEqual([
      ["zenvi-desktop", true],
      ["zenvi-portable", true],
      ["after-effects", true],
      ["premiere-pro", false],
    ]);
    expect(report.hosts[2]).toMatchObject({ kind: "aftereffects", app_version: "26.3.0", project: "/Work/promo.aep", tools: AE_TOOLS.length });
    expect(report.hosts[3]).toMatchObject({ install_hint: "zenvi adobe install" });
    expect(["zenvi-desktop", "after-effects"]).toContain(report.active);
    const table = await run(["hosts"]);
    expect(table.stdout).toMatch(/after-effects\s.*connected\s+Adobe After Effects 2026 26\.3\.0 · \/Work\/promo\.aep/);
    expect(table.stdout).toMatch(/premiere-pro\s+not connected/);
  });
});

describe("zenvi adobe install", () => {
  it("--dry-run plans a copy into the CEP folder plus PlayerDebugMode, and changes nothing", async () => {
    const source = await fakeExtension();
    const r = await run(["adobe", "install", "--dry-run", "--platform", "darwin"], { ZENVI_ADOBE_EXTENSION: source });
    expect(r.code).toBe(0);
    const target = path.posix.join(home, "Library", "Application Support", "Adobe", "CEP", "extensions", "pro.zenvi.link");
    expect(r.stdout).toContain(`Would install Zenvi Link 1.0.0 at ${target}:`);
    expect(r.stdout).toContain(`  copy ${source} -> ${target}`);
    expect(r.stdout).toContain("  run defaults write com.adobe.CSXS.12 PlayerDebugMode 1");
    expect(r.stdout).toMatch(/Restart After Effects \/ Premiere Pro/);
    expect(existsSync(path.join(home, "Library"))).toBe(false);

    // Review W2-1: --uninstall claimed a removal when nothing was installed.
    const win = await run(["adobe", "install", "--dry-run", "--uninstall", "--platform", "win32", "--json"], { ZENVI_ADOBE_EXTENSION: source, APPDATA: "C:\\Users\\me\\AppData\\Roaming" });
    expect(win.json()).toMatchObject({
      status: "unchanged",
      dryRun: true,
      target: "C:\\Users\\me\\AppData\\Roaming\\Adobe\\CEP\\extensions\\pro.zenvi.link",
      summary: "Zenvi Link is not installed at C:\\Users\\me\\AppData\\Roaming\\Adobe\\CEP\\extensions\\pro.zenvi.link; nothing to remove",
      actions: [],
    });
    await mkdir(path.join(target, "CSXS"), { recursive: true });
    await writeFile(path.join(target, "CSXS", "manifest.xml"), '<ExtensionManifest ExtensionBundleVersion="0.9.0">');
    const mac = await run(["adobe", "install", "--dry-run", "--uninstall", "--platform", "darwin", "--json"], { ZENVI_ADOBE_EXTENSION: source });
    expect(mac.json()).toMatchObject({ status: "unchanged", summary: `Would uninstall Zenvi Link at ${target}`, actions: [`remove ${target}`] });
  });

  it.runIf(process.platform === "darwin")("--uninstall removes the per-user copy and says when there was none (macOS, inside a temp HOME)", async () => {
    const target = path.posix.join(home, "Library", "Application Support", "Adobe", "CEP", "extensions", "pro.zenvi.link");
    await mkdir(path.join(target, "CSXS"), { recursive: true });
    await writeFile(path.join(target, "CSXS", "manifest.xml"), '<ExtensionManifest ExtensionBundleVersion="1.0.0">');
    const removed = await run(["adobe", "install", "--uninstall", "--json"]);
    expect(removed.json()).toMatchObject({ status: "applied", summary: `Removed Zenvi Link from ${target}` });
    expect(existsSync(target)).toBe(false);
    const again = await run(["adobe", "install", "--uninstall", "--json"]);
    expect(again.json()).toMatchObject({ status: "unchanged", summary: `Zenvi Link is not installed at ${target}; nothing to remove`, actions: [] });
  });

  it("explains a build without the extension, and --platform without --dry-run is a usage error", async () => {
    const missing = await run(["adobe", "install", "--dry-run", "--platform", "darwin"], { ZENVI_ADOBE_EXTENSION: path.join(work, "nowhere") });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/no Zenvi Link extension to install/);
    expect(missing.stderr).toMatch(/npm run build -w @zenvi\/adobe-link/);
    expect((await run(["adobe", "install", "--platform", "darwin"])).code).toBe(2);
  });
});

describe("zenvi adobe doctor", () => {
  it("reports the extension, both apps and what zenvi mcp lists", async () => {
    const source = await fakeExtension("0.9.0");
    const r = await run(["adobe", "doctor", "--json"], { ZENVI_ADOBE_EXTENSION: source, ZENVI_MCP_ADOBE: "on" });
    const { checks } = r.json<{ checks: Array<{ name: string; level: string; detail: string }> }>();
    expect(checks.map((c) => c.name)).toEqual(expect.arrayContaining(["zenvi link", "after effects", "premiere pro", "zenvi mcp"]));
    expect(checks.find((c) => c.name === "zenvi link")).toMatchObject({ level: "ok", detail: expect.stringMatching(/^0\.9\.0 ships with this zenvi/) });
    expect(checks.find((c) => c.name === "after effects")).toMatchObject({ level: "warn", detail: expect.stringMatching(/^not connected/) });
    expect(checks.find((c) => c.name === "zenvi mcp")!.detail).toMatch(/lists ae_\* \(ZENVI_MCP_ADOBE=on\), premiere_\*/);
    const missing = await run(["adobe", "doctor"], { ZENVI_ADOBE_EXTENSION: path.join(work, "nowhere") });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toMatch(/✗ zenvi link/);
  });
});

describe("zenvi ae / zenvi premiere / zenvi call", () => {
  it("run one tool in the app (prefix optional), save frame captures, and list the family", async () => {
    const tmp = await makeTempDir("zenvi-ae-cli-");
    cleanup.push(() => removeDir(tmp));
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const ae = await fakeLinkHost({
      host: "aftereffects",
      desktopDir: path.join(home, ".openshot_qt"),
      tempDir: tmp,
      handlers: {
        ae_get_state: () => ({ status: "ok", summary: "After Effects 26.3", data: { project: { path: "/Work/promo.aep" } } }),
        ae_capture_frame: async () => {
          const file = path.join(tmp, "f.png");
          await writeFile(file, png);
          return { status: "ok", summary: "Frame", data: { image_path: file } };
        },
      },
    });
    cleanup.push(() => ae.stop());

    const state = await run(["ae", "get_state", "--json"]);
    expect(state.code).toBe(0);
    expect(state.json()).toMatchObject({ status: "ok", tool: "ae_get_state", host: "aftereffects", data: { project: { path: "/Work/promo.aep" } } });
    const human = await run(["ae", "ae_get_state"]);
    expect(human.stdout).toMatch(/^✓ After Effects 26\.3\n/);

    const captured = await run(["ae", "capture_frame", "time=2", "--out", "frame.png", "--json"]);
    expect(captured.json()).toMatchObject({ status: "ok", images: 1, saved: [path.join(work, "frame.png")] });
    expect(await readFile(path.join(work, "frame.png"))).toEqual(png);
    expect(ae.calls.at(-1)).toEqual({ tool: "ae_capture_frame", args: expect.objectContaining({ time: 2 }) });

    // Command-line text: digits are ids (also inside a nullable layer ref), "null" removes, "" clears.
    expect((await run(["ae", "set_layer", "layer=3", "parent=5"])).code).toBe(0);
    expect(ae.calls.at(-1)!.args).toMatchObject({ layer: 3, parent: 5 });
    expect((await run(["ae", "set_layer", "layer=3", "parent=null"])).code).toBe(0);
    expect(ae.calls.at(-1)!.args).toMatchObject({ layer: 3, parent: null });
    expect((await run(["ae", "add_expression", "layer=1", "property=Transform/Position", "expression="])).code).toBe(0);
    expect(ae.calls.at(-1)!.args).toMatchObject({ layer: 1, expression: "" });

    const viaCall = await run(["call", "ae_get_state", "--json"]);
    expect(viaCall.json()).toMatchObject({ tool: "ae_get_state", status: "ok" });

    const listing = await run(["ae"]);
    expect(listing.stdout).toMatch(/ae_get_state/);
    expect(listing.stdout).toMatch(/After Effects tools?\. Run one with: zenvi ae <tool>/);
  });

  it("fail with how to connect when the app is not running", async () => {
    const r = await run(["premiere", "get_state"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/error: Premiere Pro is not connected: no discovery file.*zenvi adobe install/);
    const unknown = await run(["ae", "get_state", "comp=Promo", "--json"]);
    expect(unknown.code).toBe(1);
    expect(unknown.json()).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
  });
});

describe("generated files", () => {
  it("taste.gen.ts embeds docs/TASTE.md exactly", async () => {
    const markdown = await readFile(path.resolve(here, "..", "..", "..", "..", "docs", "TASTE.md"), "utf8");
    expect(await readFile(path.resolve(here, "..", "hosts", "taste.gen.ts"), "utf8")).toBe(tasteModule(markdown));
  });

  it("desktop-handoff-tools.gen.json lists SPEC §3.5's forwarded tools in order with strict object schemas", async () => {
    expect(DESKTOP_HANDOFF_TOOLS.map((t) => t.name)).toEqual(HANDOFF_TOOLS);
    for (const tool of DESKTOP_HANDOFF_TOOLS) {
      expect(tool.inputSchema, tool.name).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.description.length, tool.name).toBeGreaterThan(80);
      expect(tool.source, tool.name).toBe("zenvi-core");
    }
    // Regenerating from a manifest takes the desktop's entries and keeps hand-written ones for the rest.
    const current = await readFile(GEN_FILE, "utf8");
    const manifest = {
      manifest_version: 1,
      source: "zenvi-core src/classes/editor_tools",
      tools: [{ name: "send_to_premiere_tool", label: "Send to Premiere", description: "D".repeat(90), input_schema: { type: "object", properties: {}, additionalProperties: false }, read_only: false }],
    };
    const { text, kept } = syncText(manifest, current, "test");
    const doc = JSON.parse(text) as { tools: Array<{ name: string; title: string; source: string; annotations: Record<string, boolean> }> };
    expect(doc.tools.find((t) => t.name === "send_to_premiere_tool")).toMatchObject({ title: "Send to Premiere", source: "zenvi-core", annotations: { readOnlyHint: false, openWorldHint: true } });
    expect(kept).toHaveLength(HANDOFF_TOOLS.length - 1);
    expect(kept).not.toContain("send_to_premiere_tool");
    // Tools this manifest lacks keep their current entries exactly (source included).
    const before = JSON.parse(current) as { tools: Array<{ name: string }> };
    for (const name of kept) expect(doc.tools.find((t) => t.name === name)).toEqual(before.tools.find((t) => t.name === name));
    expect(doc.tools.map((t) => t.name)).toEqual(HANDOFF_TOOLS);
    expect(await readdir(path.dirname(GEN_FILE))).toContain("desktop-handoff-tools.gen.json");
  });
});
