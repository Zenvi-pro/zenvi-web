/**
 * zenvi mcp as a host-aware server: Adobe families from the Zenvi Link
 * catalogs routed to a real Zenvi Link server (fake ExtendScript bridge), the
 * desktop's handoff tools forwarded to a fake desktop app (open / launch
 * paths included), bring_from_* across both, resources and prompts.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { AE_TOOLS, PREMIERE_TOOLS, toCatalogJson } from "@zenvi/adobe-link";
import { applied, refused } from "@zenvi/engine/tools";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LauncherDeps } from "../desktop/launcher.js";
import { defaultDetectDeps } from "../hosts/extension.js";
import { DESKTOP_HANDOFF_TOOLS } from "../hosts/handoff.js";
import { TASTE_MARKDOWN } from "../hosts/guides.js";
import { createContext } from "../program.js";
import { fakeLinkHost, realAfterEffects, type FakeLinkHostOptions } from "../test-support/adobe.js";
import { fakeDesktop, testEnv, writeDiscovery, zenvi, type FakeDesktop, type FakeDesktopOptions } from "../test-support/harness.js";
import { testRegistry } from "../test-support/registry.js";
import { createZenviMcpServer, type ZenviMcpServer } from "./server.js";

let home: string;
let work: string;
let desktopDir: string;
const cleanup: Array<() => Promise<void>> = [];

beforeEach(async () => {
  home = await makeTempDir("zenvi-mcp-hosts-home-");
  work = await makeTempDir("zenvi-mcp-hosts-work-");
  desktopDir = path.join(home, ".openshot_qt");
});

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  await removeDir(home);
  await removeDir(work);
});

interface Launcher {
  deps: LauncherDeps;
  log: string[];
}

/** A pretend machine (Linux, so nothing is focused) where ZENVI_DESKTOP_CMD "installs" the app; launching runs `onLaunch`. */
function launcher(options: { installed?: boolean; onLaunch?: (project: string) => Promise<void> } = {}): Launcher {
  const log: string[] = [];
  return {
    log,
    deps: {
      platform: "linux",
      env: options.installed === false ? {} : { ZENVI_DESKTOP_CMD: "zenvi-desktop-test" },
      home,
      exists: async () => false,
      readText: async () => undefined,
      listDir: async () => [],
      run: async (command, args) => {
        log.push(`run ${command} ${args.join(" ")}`);
        return { code: 1, stdout: "" };
      },
      spawnDetached: async (command, args) => {
        log.push(`spawn ${command} ${args.join(" ")}`);
        await options.onLaunch?.(args.at(-1)!);
      },
      selfPaths: [],
    },
  };
}

async function connect(options: { env?: NodeJS.ProcessEnv; project?: string; launch?: Launcher; desktopWaitMs?: number; keepAliveMs?: number } = {}): Promise<{ client: Client; server: ZenviMcpServer; notifications: string[] }> {
  const env = testEnv(home, { ZENVI_MCP_ADOBE: "auto", ...options.env });
  const ctx = createContext({ env, cwd: work, registry: testRegistry() });
  const server = await createZenviMcpServer(ctx, options.project, {
    launcher: (options.launch ?? launcher()).deps,
    desktopWaitMs: options.desktopWaitMs ?? 5000,
    keepAliveMs: options.keepAliveMs,
    // Real files in the temp home, but no CEP or app folders: discovery files decide the auto listing.
    detect: { ...defaultDetectDeps(home, env), platform: "linux" },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.server.connect(b);
  const client = new Client({ name: "test", version: "1" });
  const notifications: string[] = [];
  client.setNotificationHandler(ToolListChangedNotificationSchema, async (n) => void notifications.push(n.method));
  await client.connect(a);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, server, notifications };
}

type Receipt = { contract: number; status: string; tool: string; summary: string; host?: string; data?: Record<string, unknown>; notes?: string[]; warnings?: string[]; clips?: unknown[]; error?: { code: string } };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string; mimeType?: string; data?: string }>;
  return { result, content, receipt: JSON.parse(content[0]!.text!) as Receipt, structured: result.structuredContent as Receipt & { engine?: string } };
}

async function ae(options: Partial<FakeLinkHostOptions> = {}) {
  const host = await fakeLinkHost({ host: "aftereffects", desktopDir, ...options });
  cleanup.push(() => host.stop());
  return host;
}

async function premiere(options: Partial<FakeLinkHostOptions> = {}) {
  const host = await fakeLinkHost({ host: "premiere", desktopDir, ...options });
  cleanup.push(() => host.stop());
  return host;
}

async function desktopWith(project: string | undefined, options: FakeDesktopOptions = {}, write = true): Promise<FakeDesktop> {
  const desktop = await fakeDesktop("tok-mcp-hosts", project, { home, ...options });
  cleanup.push(() => desktop.close());
  if (write) await writeDiscovery(home, desktop);
  return desktop;
}

async function projectFile(name = "cut.zvn"): Promise<string> {
  const file = path.join(work, name);
  expect((await zenvi(["new", file], { cwd: work, env: testEnv(home), registry: testRegistry() })).code).toBe(0);
  return file;
}

describe("listing", () => {
  it("ZENVI_MCP_ADOBE=on lists every catalog tool with its schema, annotations and an app prefix", async () => {
    const { client } = await connect({ env: { ZENVI_MCP_ADOBE: "on" } });
    const tools = (await client.listTools()).tools;
    for (const [defs, host, label] of [[AE_TOOLS, "aftereffects", "After Effects"], [PREMIERE_TOOLS, "premiere", "Premiere Pro"]] as const) {
      const catalog = toCatalogJson(host, defs).tools;
      for (const def of catalog) {
        const listed = tools.find((t) => t.name === def.name);
        expect(listed, def.name).toBeDefined();
        expect(listed!.description).toBe(`${label}: ${def.description}`);
        expect(listed!.inputSchema).toEqual(def.inputSchema);
        expect(listed!.annotations).toMatchObject({ title: def.title, ...def.annotations });
      }
    }
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_hosts", "bring_from_after_effects", "bring_from_premiere", ...DESKTOP_HANDOFF_TOOLS.map((t) => t.name)]));
    expect(names).not.toContain("list_link_hosts_tool");
    expect(names).not.toContain("call_link_host_tool");
    // Every desktop handoff tool is listed with the desktop's own schema (zenvi-core's manifest).
    for (const def of DESKTOP_HANDOFF_TOOLS) {
      const listed = tools.find((t) => t.name === def.name)!;
      expect(listed.description, def.name).toBe(`Zenvi desktop app: ${def.description}`);
      expect(listed.inputSchema, def.name).toEqual(def.inputSchema);
      expect(listed.annotations, def.name).toMatchObject({ title: def.title, ...def.annotations });
    }
    const remotion = tools.find((t) => t.name === "export_to_remotion_tool")!;
    expect(Object.keys(remotion.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["output_dir", "replace_edits"]));
    expect(Object.keys(tools.find((t) => t.name === "export_to_premiere_tool")!.inputSchema.properties ?? {})).toContain("overwrite");
    expect(client.getServerCapabilities()).toMatchObject({ tools: { listChanged: true }, resources: {}, prompts: {} });
  });

  it("auto lists a family only once its app can be used; off never; list_hosts says how to enable it", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith("ae_") || n.startsWith("premiere_"))).toBe(false);
    const hosts = await call(client, "list_hosts");
    expect(hosts.receipt).toMatchObject({ status: "applied", tool: "list_hosts" });
    const ae = (hosts.receipt.data!.hosts as Array<Record<string, unknown>>).find((h) => h.id === "after-effects")!;
    expect(ae).toMatchObject({ connected: false, tools_listed: false });
    expect(String(ae.enable_hint)).toMatch(/zenvi adobe install.*ZENVI_MCP_ADOBE=on/);

    await premiere();
    const { client: off } = await connect({ env: { ZENVI_MCP_ADOBE: "off" } });
    expect((await off.listTools()).tools.some((t) => t.name.startsWith("premiere_"))).toBe(false);
    const turnedOff = await call(off, "premiere_get_state");
    expect(turnedOff.receipt).toMatchObject({ status: "refused", host: "premiere", error: { code: "UNSUPPORTED" } });
    expect(turnedOff.receipt.summary).toMatch(/turned off .*ZENVI_MCP_ADOBE=off/);
  });

  it("tells the client to list tools again when an app with Zenvi Link appears", async () => {
    const { client, server, notifications } = await connect();
    expect((await client.listTools()).tools.some((t) => t.name === "ae_get_state")).toBe(false);
    await ae();
    server.state.hosts.invalidate(); // instead of waiting out the 2 s discovery cache
    await call(client, "list_hosts");
    await expect.poll(() => notifications).toEqual(["notifications/tools/list_changed"]);
    expect((await client.listTools()).tools.some((t) => t.name === "ae_get_state")).toBe(true);
  });
});

describe("After Effects / Premiere Pro tools", () => {
  it("routes to the live app through Zenvi Link and returns its receipt (structuredContent.host)", async () => {
    const host = await ae({ handlers: { ae_get_state: () => ({ status: "ok", summary: "After Effects 26.3: promo.aep, comp Promo", data: { active_comp: { name: "Promo" } } }) } });
    const { client } = await connect();
    const r = await call(client, "ae_get_state");
    expect(r.result.isError).toBeFalsy();
    expect(r.receipt).toMatchObject({ contract: 3, status: "ok", tool: "ae_get_state", host: "aftereffects", data: { active_comp: { name: "Promo" } } });
    expect(r.structured).toMatchObject({ host: "aftereffects", status: "ok" });
    expect(host.calls).toEqual([{ tool: "ae_get_state", args: {} }]);
  });

  it("drives the real After Effects host script (ExtendScript on the mock DOM) end to end", async () => {
    const tmp = await makeTempDir("zenvi-real-ae-");
    cleanup.push(() => removeDir(tmp));
    const real = await realAfterEffects({ desktopDir, tempDir: tmp });
    cleanup.push(() => real.stop());
    const { client } = await connect();
    expect((await client.listTools()).tools.some((t) => t.name === "ae_get_state")).toBe(true);
    const r = await call(client, "ae_get_state");
    expect(r.result.isError).toBeFalsy();
    expect(r.receipt).toMatchObject({ contract: 3, status: "ok", tool: "ae_get_state", host: "aftereffects", data: { active_comp: { name: "Promo" } } });
  });

  it("coerces string arguments by the schema and passes frame captures through as images", async () => {
    const tmp = await makeTempDir("zenvi-capture-");
    cleanup.push(() => removeDir(tmp));
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    // Like the real ae_capture_frame: a PNG directly in Zenvi Link's temp folder, deleted once sent.
    const file = path.join(tmp, "zenvi-link", "frame.png");
    const host = await ae({
      tempDir: tmp,
      handlers: {
        ae_capture_frame: async (args) => {
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, png);
          return { status: "ok", summary: `Frame at ${String(args.time)} s`, data: { image_path: file, time: args.time } };
        },
      },
    });
    const { client } = await connect();
    const r = await call(client, "ae_capture_frame", { time: "1.5" });
    // The real catalog's defaults (max_width 1280) are filled in by Zenvi Link.
    expect(host.calls).toEqual([{ tool: "ae_capture_frame", args: expect.objectContaining({ time: 1.5, max_width: 1280 }) }]);
    expect(r.content.map((c) => [c.type, c.mimeType])).toEqual([["text", undefined], ["image", "image/png"]]);
    expect(Buffer.from(r.content[1]!.data!, "base64")).toEqual(png);
    expect(r.receipt.data).not.toHaveProperty("image_path");
    expect(existsSync(file)).toBe(false);
  });

  it("keeps null (remove) and \"\" (clear), and reads digits as ids at any depth", async () => {
    // Review W2-1 #1: the engine's coercion dropped null / "" and looked one anyOf level deep.
    const host = await ae();
    const { client } = await connect();
    const sent: Array<[string, Record<string, unknown>]> = [
      ["ae_set_layer", { layer: 3, parent: null }],
      ["ae_set_text", { layer: 2, stroke: null }],
      ["ae_add_expression", { layer: 1, property: "Transform/Position", expression: "" }],
      ["ae_set_layer", { layer: "3", parent: "5", name: "7", comment: "" }],
      ["ae_add_layer", { kind: "null", parent: "5" }],
      ["ae_arrange_layers", { layer: "3", action: "move", to: { before: "7" } }],
      ["ae_set_layer", { layer: "Title 2", parent: "null" }],
    ];
    for (const [tool, args] of sent) {
      const r = await call(client, tool, args);
      expect(r.receipt.status, `${tool} ${JSON.stringify(args)}: ${r.receipt.summary}`).toBe("ok");
    }
    const got = host.calls.map((c) => c.args);
    expect(got[0]).toMatchObject({ layer: 3, parent: null });
    expect(got[1]).toMatchObject({ layer: 2, stroke: null });
    expect(got[2]).toMatchObject({ expression: "" });
    expect(got[3]).toMatchObject({ layer: 3, parent: 5, name: "7", comment: "" });
    expect(got[4]).toMatchObject({ kind: "null", parent: 5 });
    expect(got[5]).toMatchObject({ layer: 3, to: { before: 7 } });
    expect(got[6]).toMatchObject({ layer: "Title 2", parent: null });
  });

  it("refuses when the app is not connected, with how to connect it", async () => {
    const { client } = await connect({ env: { ZENVI_MCP_ADOBE: "on" } });
    const r = await call(client, "premiere_get_state");
    expect(r.result.isError).toBe(true);
    expect(r.receipt).toMatchObject({ status: "refused", host: "premiere", error: { code: "NOT_CONNECTED" } });
    expect(r.receipt.summary).toMatch(/^Error: Premiere Pro is not connected/);
    expect(r.receipt.summary).toMatch(/Window > Extensions > Zenvi Link/);
    expect(r.receipt.summary).toMatch(/zenvi adobe install/);
    expect(r.receipt.summary).toMatch(/zenvi adobe doctor/);
  });

  it("refuses unknown argument names before anything runs; the app validates the rest", async () => {
    const host = await ae({ tools: [{ name: "ae_set_thing", inputSchema: { type: "object", properties: { amount: { type: "number", minimum: 0 } }, required: ["amount"], additionalProperties: false } }] });
    const { client } = await connect();
    const unknown = await call(client, "ae_get_state", { comp: "Promo" });
    expect(unknown.receipt).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(unknown.receipt.summary).toBe("Error: unknown argument for ae_get_state: comp. Accepted: none.");
    // A tool this zenvi's catalog lacks is checked against the app's own tools/list.
    const typo = await call(client, "ae_set_thing", { amont: 1 });
    expect(typo.receipt.summary).toMatch(/unknown argument for ae_set_thing: amont\. Accepted: amount/);
    const invalid = await call(client, "ae_set_thing", { amount: -1 });
    expect(invalid.receipt).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    // A catalog tool: Zenvi Link's own schema check refuses the value before any ExtendScript runs.
    const negative = await call(client, "ae_capture_frame", { time: -1 });
    expect(negative.receipt).toMatchObject({ status: "refused", host: "aftereffects", error: { code: "INVALID_ARGUMENT" } });
    const missing = await call(client, "ae_no_such_tool");
    expect(missing.receipt).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    expect(host.calls).toEqual([]);
  });
});

/** The vendored desktop schema of a handoff tool, as a desktop build publishes it in tools/list. */
function liveSchema(tool: string, extra: Record<string, unknown> = {}): { type: "object"; properties: Record<string, unknown> } {
  const def = DESKTOP_HANDOFF_TOOLS.find((t) => t.name === tool)!;
  return { type: "object", properties: { ...(def.inputSchema.properties as Record<string, unknown>), ...extra } };
}

describe("desktop handoff tools", () => {
  it("refuse on an untitled session", async () => {
    const desktop = await desktopWith(undefined, { tools: ["export_to_remotion_tool"] });
    const { client } = await connect();
    const r = await call(client, "export_to_remotion_tool", { output_dir: "out" });
    expect(r.receipt.status).toBe("refused");
    expect(r.receipt.summary).toMatch(/call open_project_file first/);
    expect(desktop.calls).toEqual([]);
  });

  it("forward to the desktop app that has the project open, with relative paths made absolute", async () => {
    const file = await projectFile();
    const desktop = await desktopWith(file, {
      tools: ["export_to_remotion_tool"],
      schemas: { export_to_remotion_tool: liveSchema("export_to_remotion_tool") },
      handlers: { export_to_remotion_tool: (args) => applied("export_to_remotion_tool", `Exported to ${String(args.output_dir)}`, { data: { output_dir: args.output_dir } }, 0) },
    });
    const { client } = await connect({ project: file });
    const r = await call(client, "export_to_remotion_tool", { output_dir: "remotion-cut", copy_media: false, replace_edits: true });
    expect(r.receipt).toMatchObject({ status: "applied", summary: `Exported to ${path.join(work, "remotion-cut")}` });
    expect(r.structured.engine).toBe("desktop");
    expect(desktop.calls).toEqual([{ tool: "export_to_remotion_tool", args: { output_dir: path.join(work, "remotion-cut"), copy_media: false, replace_edits: true } }]);
    const unknown = await call(client, "export_to_remotion_tool", { output: "x" });
    expect(unknown.receipt.summary).toBe("Error: unknown argument for export_to_remotion_tool: output. Accepted: copy_media, install, output_dir, replace_edits.");
    expect(desktop.calls).toHaveLength(1);
  });

  it("check argument names against the running desktop's own schema, so a newer desktop's arguments are never blocked", async () => {
    // Review W2-1 #2: a stale vendored schema refused replace_edits with no way through.
    const file = await projectFile();
    const desktop = await desktopWith(file, {
      tools: ["export_to_hyperframes_tool"],
      schemas: { export_to_hyperframes_tool: liveSchema("export_to_hyperframes_tool", { brand_new_option: { type: "boolean" } }) },
    });
    const { client } = await connect({ project: file });
    const newer = await call(client, "export_to_hyperframes_tool", { output_dir: "/tmp/hf", brand_new_option: true });
    expect(newer.receipt.status).toBe("applied");
    const typo = await call(client, "export_to_hyperframes_tool", { output_dir: "/tmp/hf", replace_edit: true });
    expect(typo.receipt.summary).toMatch(/^Error: unknown argument for export_to_hyperframes_tool: replace_edit\. Accepted: .*brand_new_option/);
    expect(desktop.calls.map((c) => c.args)).toEqual([{ output_dir: "/tmp/hf", brand_new_option: true }]);
  });

  it("refuse an unknown argument before starting the app when none runs", async () => {
    const file = await projectFile();
    const launch = launcher();
    const { client } = await connect({ project: file, launch });
    const r = await call(client, "export_to_after_effects_tool", { outputdir: "x" });
    expect(r.receipt.summary).toMatch(/unknown argument for export_to_after_effects_tool: outputdir\..*open the project in it first with launch_editor/);
    expect(launch.log).toEqual([]);
  });

  it("open the session's project in a running app that shows another one for tools that act on it", async () => {
    const file = await projectFile();
    const desktop = await desktopWith(path.join(work, "elsewhere.zvn"), { tools: ["rerender_linked_clip_tool"] });
    const { client } = await connect({ project: file });
    const r = await call(client, "rerender_linked_clip_tool", { clip_id: "C1" });
    expect(r.receipt.status).toBe("applied");
    expect(desktop.calls).toEqual([
      { tool: "open_project_tool", args: { file_path: file } },
      { tool: "rerender_linked_clip_tool", args: { clip_id: "C1" } },
    ]);
    expect(r.receipt.notes!.join(" ")).toMatch(/Opened .*cut\.zvn in the running Zenvi app\. This session's Zenvi edits now go through the app\./);
  });

  it("never switch the app's project for tools that only read it or do not need it", async () => {
    // Review W2-1: get_linked_clip_tool / list_remotion_compositions_tool switched a running desktop away from its project.
    const file = await projectFile();
    const elsewhere = path.join(work, "elsewhere.zvn");
    const desktop = await desktopWith(elsewhere, { tools: ["get_linked_clip_tool", "list_remotion_compositions_tool"] });
    const { client } = await connect({ project: file });
    const read = await call(client, "get_linked_clip_tool", { clip_id: "C1" });
    expect(read.receipt.status).toBe("refused");
    expect(read.receipt.summary).toMatch(/has .*elsewhere\.zvn open, not .*cut\.zvn\. get_linked_clip_tool reads this session's project there and does not switch projects on its own: call launch_editor/);
    const free = await call(client, "list_remotion_compositions_tool", { project_dir: "/code/promo" });
    expect(free.receipt.status).toBe("applied");
    expect(desktop.calls).toEqual([{ tool: "list_remotion_compositions_tool", args: { project_dir: "/code/promo" } }]);
    expect(desktop.project).toBe(elsewhere);
  });

  it("check the Adobe app before opening the desktop for send_to_* tools", async () => {
    const file = await projectFile();
    const desktop = await desktopWith(path.join(work, "elsewhere.zvn"), { tools: ["send_to_after_effects_tool"] });
    const { client } = await connect({ project: file });
    const r = await call(client, "send_to_after_effects_tool");
    expect(r.receipt.status).toBe("refused");
    expect(r.receipt.summary).toMatch(/After Effects is not connected: .*zenvi adobe install/);
    expect(desktop.calls).toEqual([]);
    await ae();
    const sent = await call(client, "send_to_after_effects_tool");
    expect(sent.receipt.status).toBe("applied");
    expect(desktop.calls.map((c) => c.tool)).toEqual(["open_project_tool", "send_to_after_effects_tool"]);
  });

  it("start the app on the project when it is not running, wait for it, then forward", async () => {
    const file = await projectFile();
    const desktop = await desktopWith(undefined, { tools: ["import_hyperframes_project_tool"] }, false);
    const launch = launcher({ onLaunch: async (project) => writeDiscovery(home, desktop, { project }) });
    const { client } = await connect({ project: file, launch });
    const r = await call(client, "import_hyperframes_project_tool", { project_dir: "~/hf", mode: "native" });
    expect(r.receipt.status).toBe("applied");
    expect(launch.log).toEqual([`spawn zenvi-desktop-test ${file}`]);
    expect(desktop.calls).toEqual([{ tool: "import_hyperframes_project_tool", args: { project_dir: path.join(home, "hf"), mode: "native" } }]);
    expect(r.receipt.notes!.join(" ")).toMatch(/Started Zenvi on .*cut\.zvn/);
  });

  it("start the app once when calls arrive while it is coming up", async () => {
    const file = await projectFile();
    const desktop = await desktopWith(undefined, { tools: ["export_to_premiere_tool"] }, false);
    const launch = launcher({
      onLaunch: async (project) => {
        setTimeout(() => void writeDiscovery(home, desktop, { project }), 400);
      },
    });
    const { client } = await connect({ project: file, launch });
    const [a, b] = await Promise.all([call(client, "export_to_premiere_tool"), call(client, "export_to_premiere_tool")]);
    expect([a.receipt.status, b.receipt.status]).toEqual(["applied", "applied"]);
    expect(launch.log.filter((line) => line.startsWith("spawn"))).toHaveLength(1);
  });

  it("say so when the app is not installed, does not show the project in time, lacks the tool, or is turned off", async () => {
    const file = await projectFile();
    const notInstalled = await connect({ project: file, launch: launcher({ installed: false }) });
    const r1 = await call(notInstalled.client, "export_to_after_effects_tool");
    expect(r1.receipt).toMatchObject({ status: "refused" });
    expect(r1.receipt.summary).toMatch(/not installed on this machine\. Get it at https:\/\/zenvi\.pro\/download/);

    const neverShows = await connect({ project: file, launch: launcher(), desktopWaitMs: 300 });
    const r2 = await call(neverShows.client, "export_to_after_effects_tool");
    expect(r2.receipt).toMatchObject({ status: "error" });
    expect(r2.receipt.summary).toMatch(/did not show .*cut\.zvn within 0 s/);

    await desktopWith(file);
    const old = await connect({ project: file });
    const r3 = await call(old.client, "export_to_premiere_tool");
    expect(r3.receipt).toMatchObject({ status: "refused" });
    expect(r3.receipt.summary).toMatch(/has no export_to_premiere_tool yet: update Zenvi/);

    const portable = await connect({ project: file, env: { ZENVI_MCP_ENGINE: "portable" } });
    const r4 = await call(portable.client, "send_to_premiere_tool");
    expect(r4.receipt.summary).toMatch(/ZENVI_MCP_ENGINE=portable/);
  });
});

describe("bring_from_after_effects", () => {
  const RENDER = { path: "/tmp/zenvi-link/renders/Promo-1.mov", comp_id: 12, comp_name: "Promo", project: "/Work/promo.aep", width: 1920, height: 1080, fps: 29.97, duration: 5.005, codec: "prores4444" };

  it("renders the comp in After Effects and adds it to the Zenvi project as a linked clip, both receipts in one", async () => {
    const file = await projectFile();
    const host = await ae({ handlers: { ae_render_for_zenvi: () => ({ status: "applied", summary: "Rendered Promo", data: RENDER, warnings: ["snapped the work area"] }) } });
    const desktop = await desktopWith(file, {
      tools: ["import_linked_media_tool"],
      handlers: { import_linked_media_tool: () => applied("import_linked_media_tool", "Added linked After Effects clip 'Promo' at 2.00-7.00s.", { clips: [{ id: "CLIP000001", track: 3, position: 2 }] }) },
    });
    const { client } = await connect({ project: file });
    const r = await call(client, "bring_from_after_effects", { comp: "Promo", alpha: true, position: 2, track: 3 });
    expect(r.result.isError).toBeFalsy();
    expect(r.receipt).toMatchObject({ status: "applied", tool: "bring_from_after_effects", clips: [{ id: "CLIP000001" }], warnings: ["snapped the work area"] });
    expect(r.receipt.summary).toMatch(/^Rendered "Promo" in After Effects and added it to the Zenvi project as a linked clip\. Added linked/);
    expect(r.receipt.data).toMatchObject({ after_effects: { status: "applied", tool: "ae_render_for_zenvi" }, zenvi: { status: "applied", tool: "import_linked_media_tool" } });
    // (Zenvi Link fills its schema defaults, e.g. work_area_only, before the ExtendScript runs.)
    expect(host.calls).toEqual([{ tool: "ae_render_for_zenvi", args: expect.objectContaining({ comp: "Promo", alpha: true }) }]);
    expect(desktop.calls).toEqual([
      {
        tool: "import_linked_media_tool",
        args: {
          path: RENDER.path,
          link: {
            version: 1,
            kind: "aftereffects",
            source: { project_dir: null, entry: null, composition: "Promo", composition_key: 12, file: null, line: null, aep: "/Work/promo.aep" },
            props: {},
            render: { codec: "prores4444", width: 1920, height: 1080, fps: { num: 30000, den: 1001 }, duration_frames: 150 },
          },
          position: 2,
          track: "3",
        },
      },
    ]);
  });

  it("reports increasing progress for its steps", async () => {
    const file = await projectFile();
    await ae({ handlers: { ae_render_for_zenvi: () => ({ status: "applied", data: RENDER }) } });
    await desktopWith(file, { tools: ["import_linked_media_tool"] });
    const { client } = await connect({ project: file });
    const seen: Array<{ progress: number; message?: string }> = [];
    await client.callTool({ name: "bring_from_after_effects", arguments: {} }, undefined, { onprogress: (p) => void seen.push({ progress: p.progress, message: p.message }) });
    expect(seen.map((p) => p.message)).toEqual(["Rendering in After Effects…", "Adding it to the Zenvi project…"]);
    expect(seen.every((p, i) => i === 0 || p.progress > seen[i - 1]!.progress)).toBe(true);
  });

  it("sends keep-alive progress while After Effects renders", async () => {
    const file = await projectFile();
    await ae({ handlers: { ae_render_for_zenvi: async () => (await new Promise((r) => setTimeout(r, 400)), { status: "applied", data: RENDER }) } });
    await desktopWith(file, { tools: ["import_linked_media_tool"] });
    const { client } = await connect({ project: file, keepAliveMs: 50 });
    const seen: string[] = [];
    await client.callTool({ name: "bring_from_after_effects", arguments: {} }, undefined, { onprogress: (p) => void seen.push(String(p.message)) });
    expect(seen.filter((m) => /^Rendering in After Effects \(\d+ s\)$/.test(m)).length).toBeGreaterThanOrEqual(2);
  });

  it("re-checks the open project before importing: a desktop that switched projects meanwhile gets nothing", async () => {
    // Review W2-1 #3: the import went to whatever project the desktop showed after the render.
    const file = await projectFile();
    const holder: { desktop?: FakeDesktop } = {};
    await ae({
      handlers: {
        ae_render_for_zenvi: async () => {
          holder.desktop!.project = path.join(work, "other.zvn");
          await writeDiscovery(home, holder.desktop!);
          return { status: "applied", summary: "Rendered Promo", data: RENDER };
        },
      },
    });
    holder.desktop = await desktopWith(file, { tools: ["import_linked_media_tool"] });
    const { client } = await connect({ project: file });
    const r = await call(client, "bring_from_after_effects");
    expect(r.receipt).toMatchObject({ status: "refused", data: { after_effects: { status: "applied" }, retry: { tool: "import_linked_media_tool", arguments: { path: RENDER.path } } } });
    expect(r.receipt.summary).toMatch(/no longer has .*cut\.zvn open/);
    expect(holder.desktop.calls.map((c) => c.tool)).not.toContain("import_linked_media_tool");
  });

  it("does not import after the client cancelled the call", async () => {
    // Review W2-1 #4: a cancelled intent still added an undo step in Zenvi.
    const file = await projectFile();
    let rendered!: () => void;
    const done = new Promise<void>((resolve) => (rendered = resolve));
    await ae({
      handlers: {
        ae_render_for_zenvi: async () => {
          await new Promise((r) => setTimeout(r, 500));
          rendered();
          return { status: "applied", data: RENDER };
        },
      },
    });
    const desktop = await desktopWith(file, { tools: ["import_linked_media_tool"] });
    const { client } = await connect({ project: file });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("user pressed Esc")), 150);
    await expect(client.callTool({ name: "bring_from_after_effects", arguments: {} }, undefined, { signal: controller.signal })).rejects.toThrow();
    await done;
    await new Promise((r) => setTimeout(r, 300));
    expect(desktop.calls.map((c) => c.tool)).not.toContain("import_linked_media_tool");
  });

  it("keeps the After Effects result when the desktop import fails", async () => {
    // Review W2-1 #5: only "MCP error -32603" came back; the render was orphaned.
    const file = await projectFile();
    await ae({ handlers: { ae_render_for_zenvi: () => ({ status: "applied", summary: "Rendered Promo", data: RENDER }) } });
    await desktopWith(file, {
      tools: ["import_linked_media_tool"],
      handlers: {
        import_linked_media_tool: () => {
          throw new Error("desktop crashed mid-import");
        },
      },
    });
    const { client } = await connect({ project: file });
    const r = await call(client, "bring_from_after_effects");
    expect(r.result.isError).toBe(true);
    expect(r.receipt).toMatchObject({
      status: "error",
      data: { after_effects: { status: "applied", data: { path: RENDER.path } }, retry: { tool: "import_linked_media_tool", arguments: { path: RENDER.path, link: { kind: "aftereffects" } } } },
    });
    expect(r.receipt.summary).toMatch(/rendered "Promo" to .*Promo-1\.mov, but the Zenvi desktop app failed during import_linked_media_tool: .*desktop crashed mid-import/);
  });

  it("uses Zenvi Link's own link object when it sends one", async () => {
    const file = await projectFile();
    const link = { version: 1, kind: "aftereffects", source: { aep: "/Work/promo.aep", composition: "Logo", composition_key: 4 }, render: { codec: "h264" } };
    await ae({ handlers: { ae_render_for_zenvi: () => ({ status: "applied", data: { path: "/tmp/Logo.mp4", link } }) } });
    const desktop = await desktopWith(file, { tools: ["import_linked_media_tool"] });
    const { client } = await connect({ project: file });
    await call(client, "bring_from_after_effects");
    expect(desktop.calls[0]).toEqual({ tool: "import_linked_media_tool", args: { path: "/tmp/Logo.mp4", link } });
  });

  it("refuses without touching Zenvi when After Effects is not connected or cannot render", async () => {
    const file = await projectFile();
    const desktop = await desktopWith(file, { tools: ["import_linked_media_tool"] });
    const { client } = await connect({ project: file });
    const offline = await call(client, "bring_from_after_effects");
    expect(offline.receipt.status).toBe("refused");
    expect(offline.receipt.summary).toMatch(/After Effects is not connected/);

    await ae({ handlers: { ae_render_for_zenvi: () => ({ status: "refused", summary: "Error: no active comp", error: { code: "NO_ACTIVE_COMP", message: "no active comp" } }) } });
    const noComp = await call(client, "bring_from_after_effects");
    expect(noComp.receipt).toMatchObject({ status: "refused", data: { after_effects: { error: { code: "NO_ACTIVE_COMP" } } } });
    expect(noComp.receipt.summary).toMatch(/no active comp \(rendering in After Effects; nothing was added to the Zenvi project\)/);
    expect(desktop.calls).toEqual([]);
    const untitled = await connect();
    expect((await call(untitled.client, "bring_from_after_effects")).receipt.summary).toMatch(/open_project_file first/);
  });
});

describe("bring_from_premiere", () => {
  it("exports the sequence from Premiere and imports it into the Zenvi project", async () => {
    const file = await projectFile();
    const host = await premiere({ handlers: { premiere_export_xml: () => ({ status: "applied", summary: 'Exported "Cut" as FCP XML to /tmp/Cut.xml', data: { path: "/tmp/Cut.xml", sequence_id: "8d1c-seq", name: "Cut" } }) } });
    const desktop = await desktopWith(file, {
      tools: ["import_timeline_xml_tool"],
      handlers: { import_timeline_xml_tool: (args) => applied("import_timeline_xml_tool", `Imported ${String(args.path)}: 4 clips on 2 new tracks`, {}, 1) },
    });
    const { client } = await connect({ project: file });
    const r = await call(client, "bring_from_premiere", { sequence: "Cut", placement: "at_playhead" });
    expect(r.receipt).toMatchObject({ status: "applied", tool: "bring_from_premiere", data: { premiere: { status: "applied" }, zenvi: { status: "applied" } } });
    expect(r.receipt.summary).toBe('Exported "Cut" from Premiere Pro and imported it into the Zenvi project. Imported /tmp/Cut.xml: 4 clips on 2 new tracks');
    expect(host.calls).toEqual([{ tool: "premiere_export_xml", args: expect.objectContaining({ sequence: "Cut" }) }]);
    expect(desktop.calls).toEqual([{ tool: "import_timeline_xml_tool", args: { path: "/tmp/Cut.xml", placement: "at_playhead" } }]);
  });

  it("checks the desktop can import before exporting anything", async () => {
    const file = await projectFile();
    const host = await premiere();
    await desktopWith(file);
    const { client } = await connect({ project: file });
    const r = await call(client, "bring_from_premiere");
    expect(r.receipt.summary).toMatch(/has no import_timeline_xml_tool yet: update Zenvi/);
    expect(host.calls).toEqual([]);
    const bad = await call(client, "bring_from_premiere", { placement: "end" });
    expect(bad.receipt.summary).toBe("Error: placement must be new_tracks or at_playhead");
  });
});

describe("resources and prompts", () => {
  it("serves zenvi://hosts, zenvi://taste (docs/TASTE.md) and zenvi://handoff", async () => {
    await ae();
    const { client } = await connect();
    expect((await client.listResources()).resources.map((r) => [r.uri, r.mimeType])).toEqual([
      ["zenvi://hosts", "application/json"],
      ["zenvi://taste", "text/markdown"],
      ["zenvi://handoff", "text/markdown"],
    ]);
    const hosts = JSON.parse(((await client.readResource({ uri: "zenvi://hosts" })).contents[0] as { text: string }).text) as { hosts: Array<{ id: string }>; active: string };
    expect(hosts.hosts.map((h) => h.id)).toEqual(["zenvi-desktop", "zenvi-portable", "after-effects", "premiere-pro"]);
    expect(hosts.active).toBe("after-effects");
    const taste = ((await client.readResource({ uri: "zenvi://taste" })).contents[0] as { text: string }).text;
    expect(taste).toBe(await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs/TASTE.md"), "utf8"));
    const guide = ((await client.readResource({ uri: "zenvi://handoff" })).contents[0] as { text: string }).text;
    expect(guide).toMatch(/## Linked clips/);
    await expect(client.readResource({ uri: "zenvi://nope" })).rejects.toThrow(/Resource not found/);
  });

  it("prompts embed the taste guide and the host's own tools; the host defaults to the active one", async () => {
    await ae();
    const { client } = await connect();
    expect((await client.listPrompts()).prompts.map((p) => [p.name, p.arguments?.map((a) => `${a.name}${a.required ? "!" : ""}`)])).toEqual([
      ["taste_motion_design", ["brief!", "host"]],
      ["edit_review", ["host", "focus"]],
    ]);
    const motion = await client.getPrompt({ name: "taste_motion_design", arguments: { brief: "a lower third for Ana Ruiz" } });
    const text = (motion.messages[0]!.content as { text: string }).text;
    expect(text).toMatch(/^Design and build this in After Effects: a lower third for Ana Ruiz/);
    expect(text).toContain("ae_capture_frame");
    expect(text).toContain(TASTE_MARKDOWN);
    const review = await client.getPrompt({ name: "edit_review", arguments: { host: "premiere", focus: "typography" } });
    const reviewText = (review.messages[0]!.content as { text: string }).text;
    expect(reviewText).toMatch(/^Review the current edit in Premiere Pro, focusing on typography\./);
    expect(reviewText).toContain("premiere_capture_frame");
    const zenviReview = await client.getPrompt({ name: "edit_review", arguments: { host: "zenvi" } });
    expect((zenviReview.messages[0]!.content as { text: string }).text).toContain("preview_frame");
    await expect(client.getPrompt({ name: "taste_motion_design", arguments: { host: "zenvi" } })).rejects.toThrow(/needs a brief/);
    await expect(client.getPrompt({ name: "nope" })).rejects.toThrow(/Unknown prompt/);
  });
});

describe("refusal receipts keep the contract", () => {
  it("a refused orchestration is a contract-3 receipt with isError", async () => {
    const { client } = await connect();
    const r = await call(client, "bring_from_premiere");
    expect(r.result.isError).toBe(true);
    expect(r.receipt).toMatchObject(refused("bring_from_premiere", r.receipt.summary));
  });
});
