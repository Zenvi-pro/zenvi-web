/**
 * zenvi mcp as a host-aware server: Adobe families from the Zenvi Link
 * catalogs routed to a real Zenvi Link server (fake ExtendScript bridge), the
 * desktop's handoff tools forwarded to a fake desktop app (open / launch
 * paths included), bring_from_* across both, resources and prompts.
 */

import { readFile, writeFile } from "node:fs/promises";
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
import { CAPTURE_FRAME_TOOL, EXPORT_XML_TOOL, fakeLinkHost, RENDER_FOR_ZENVI_TOOL, type FakeLinkHostOptions } from "../test-support/adobe.js";
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

async function connect(options: { env?: NodeJS.ProcessEnv; project?: string; launch?: Launcher; desktopWaitMs?: number } = {}): Promise<{ client: Client; server: ZenviMcpServer; notifications: string[] }> {
  const env = testEnv(home, { ZENVI_MCP_ADOBE: "auto", ...options.env });
  const ctx = createContext({ env, cwd: work, registry: testRegistry() });
  const server = await createZenviMcpServer(ctx, options.project, {
    launcher: (options.launch ?? launcher()).deps,
    desktopWaitMs: options.desktopWaitMs ?? 5000,
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
    const handoff = tools.find((t) => t.name === "import_linked_media_tool")!;
    expect(handoff.description).toMatch(/^Zenvi desktop app: /);
    expect(handoff.inputSchema).toEqual(DESKTOP_HANDOFF_TOOLS.find((t) => t.name === "import_linked_media_tool")!.inputSchema);
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

  it("coerces string arguments by the schema and passes frame captures through as images", async () => {
    const tmp = await makeTempDir("zenvi-capture-");
    cleanup.push(() => removeDir(tmp));
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const host = await ae({
      tempDir: tmp,
      tools: [CAPTURE_FRAME_TOOL],
      handlers: {
        ae_capture_frame: async (args) => {
          const file = path.join(tmp, "frame.png");
          await writeFile(file, png);
          return { status: "ok", summary: `Frame at ${String(args.time)} s`, data: { image_path: file, time: args.time } };
        },
      },
    });
    const { client } = await connect();
    const r = await call(client, "ae_capture_frame", { time: "1.5" });
    expect(host.calls).toEqual([{ tool: "ae_capture_frame", args: expect.objectContaining({ time: 1.5 }) }]);
    expect(r.content.map((c) => [c.type, c.mimeType])).toEqual([["text", undefined], ["image", "image/png"]]);
    expect(Buffer.from(r.content[1]!.data!, "base64")).toEqual(png);
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
    const missing = await call(client, "ae_no_such_tool");
    expect(missing.receipt).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    expect(host.calls).toEqual([]);
  });
});

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
      handlers: { export_to_remotion_tool: (args) => applied("export_to_remotion_tool", `Exported to ${String(args.output_dir)}`, { data: { output_dir: args.output_dir } }, 0) },
    });
    const { client } = await connect({ project: file });
    const r = await call(client, "export_to_remotion_tool", { output_dir: "remotion-cut", copy_media: false });
    expect(r.receipt).toMatchObject({ status: "applied", summary: `Exported to ${path.join(work, "remotion-cut")}` });
    expect(r.structured.engine).toBe("desktop");
    expect(desktop.calls).toEqual([{ tool: "export_to_remotion_tool", args: { output_dir: path.join(work, "remotion-cut"), copy_media: false } }]);
    const unknown = await call(client, "export_to_remotion_tool", { output: "x" });
    expect(unknown.receipt.summary).toMatch(/unknown argument for export_to_remotion_tool: output\. Accepted: output_dir, copy_media, install/);
  });

  it("open the session's project in a running app that shows another one, then forward", async () => {
    const file = await projectFile();
    const desktop = await desktopWith(path.join(work, "elsewhere.zvn"), { tools: ["get_linked_clip_tool"] });
    const { client } = await connect({ project: file });
    const r = await call(client, "get_linked_clip_tool", { clip_id: "C1" });
    expect(r.receipt.status).toBe("applied");
    expect(desktop.calls).toEqual([
      { tool: "open_project_tool", args: { file_path: file } },
      { tool: "get_linked_clip_tool", args: { clip_id: "C1" } },
    ]);
    expect(r.receipt.notes!.join(" ")).toMatch(/Opened .*cut\.zvn in the running Zenvi app\. This session's Zenvi edits now go through the app\./);
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
    const r3 = await call(old.client, "send_to_premiere_tool");
    expect(r3.receipt).toMatchObject({ status: "refused" });
    expect(r3.receipt.summary).toMatch(/has no send_to_premiere_tool yet: update Zenvi/);

    const portable = await connect({ project: file, env: { ZENVI_MCP_ENGINE: "portable" } });
    const r4 = await call(portable.client, "send_to_premiere_tool");
    expect(r4.receipt.summary).toMatch(/ZENVI_MCP_ENGINE=portable/);
  });
});

describe("bring_from_after_effects", () => {
  const RENDER = { path: "/tmp/zenvi-link/renders/Promo-1.mov", comp_id: 12, comp_name: "Promo", project: "/Work/promo.aep", width: 1920, height: 1080, fps: 29.97, duration: 5.005, codec: "prores4444" };

  it("renders the comp in After Effects and adds it to the Zenvi project as a linked clip, both receipts in one", async () => {
    const file = await projectFile();
    const host = await ae({ tools: [RENDER_FOR_ZENVI_TOOL], handlers: { ae_render_for_zenvi: () => ({ status: "applied", summary: "Rendered Promo", data: RENDER, warnings: ["snapped the work area"] }) } });
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

  it("uses Zenvi Link's own link object when it sends one", async () => {
    const file = await projectFile();
    const link = { version: 1, kind: "aftereffects", source: { aep: "/Work/promo.aep", composition: "Logo", composition_key: 4 }, render: { codec: "h264" } };
    await ae({ tools: [RENDER_FOR_ZENVI_TOOL], handlers: { ae_render_for_zenvi: () => ({ status: "applied", data: { path: "/tmp/Logo.mp4", link } }) } });
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

    await ae({ tools: [RENDER_FOR_ZENVI_TOOL], handlers: { ae_render_for_zenvi: () => ({ status: "refused", summary: "Error: no active comp", error: { code: "NO_ACTIVE_COMP", message: "no active comp" } }) } });
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
    const host = await premiere({ tools: [EXPORT_XML_TOOL], handlers: { premiere_export_xml: () => ({ status: "applied", summary: "Wrote Cut.xml", data: { path: "/tmp/Cut.xml", sequence_name: "Cut" } }) } });
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
    const host = await premiere({ tools: [EXPORT_XML_TOOL] });
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
