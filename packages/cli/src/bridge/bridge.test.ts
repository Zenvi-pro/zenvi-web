import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createProject } from "@zenvi/engine";
import { makeImage, makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineRegistry } from "../engine/registry.js";
import { testEnv, zenvi } from "../test-support/harness.js";
import { BRIDGE_PROTOCOL, bridgeHost, runBridgeCall, type BridgeAnswer } from "./run.js";
import { bridgeTools, serveBridge } from "./server.js";

const registry = engineRegistry();
let work: string;
let home: string;
let projectFile: string;

/** The project as the desktop holds it in memory: absolute paths, no history. */
function snapshot(): Record<string, unknown> {
  const { history: _history, ...project } = createProject({ profile: "HD 1080p 30 fps" }) as unknown as Record<string, unknown>;
  return { ...project, clips: [], files: [] };
}

beforeAll(async () => {
  work = await makeTempDir("zenvi-bridge-");
  home = await makeTempDir("zenvi-bridge-home-");
  projectFile = path.join(work, "promo.zvn");
});

afterAll(async () => {
  await removeDir(work);
  await removeDir(home);
});

describe("runBridgeCall", () => {
  it("answers a motion template as desktop inserts, its drawings written to the project's assets", async () => {
    const answer = await runBridgeCall(
      { tool: "add_motion_template_tool", args: { template: "grid_background", variant: "paper", duration_seconds: "2" }, project: snapshot(), project_file: projectFile },
      { registry },
    );
    expect(answer.ok, answer.text).toBe(true);
    expect(answer).toMatchObject({ protocol: BRIDGE_PROTOCOL, label: expect.stringMatching(/motion template/i) });
    const byKey = (key: string) => answer.actions.filter((a) => a.type === "insert" && a.key[0] === key);
    expect(byKey("files").length).toBeGreaterThan(0);
    expect(byKey("clips").length).toBe(byKey("files").length);
    // Every action is one the desktop applies as is: top-level inserts and parent-object updates.
    for (const a of answer.actions) expect(a.key.every((p) => typeof p !== "string" || p === p.toLowerCase())).toBe(true);
    const assets = path.join(work, "promo_assets");
    expect(answer.files.length).toBeGreaterThan(0);
    for (const f of answer.files) expect(f.startsWith(assets)).toBe(true);
    const filePaths = byKey("files").map((a) => (a.value as { path: string }).path);
    expect(filePaths.every((p) => answer.files.includes(p))).toBe(true);
    expect(answer.receipt?.status).toBe("applied");
  });

  it("changes nothing and leaves no files behind when the tool refuses", async () => {
    const before = existsSync(path.join(work, "promo_assets", "title")) ? await readdir(path.join(work, "promo_assets", "title")) : [];
    const answer = await runBridgeCall({ tool: "add_motion_template_tool", args: { template: "word_scroll", words: ["Only"] }, project: snapshot(), project_file: projectFile }, { registry });
    expect(answer.ok).toBe(false);
    expect(answer.actions).toEqual([]);
    expect(answer.files).toEqual([]);
    const after = existsSync(path.join(work, "promo_assets", "title")) ? await readdir(path.join(work, "promo_assets", "title")) : [];
    expect(after).toEqual(before);
  });

  it("never lists, or removes, a file the project's assets folder already held", async () => {
    const media = path.join(work, "promo_assets", "media");
    await mkdir(media, { recursive: true });
    const image = await makeImage(media, "logo.png");
    const written: string[] = [];
    const imported = await bridgeHost(projectFile, written).media!.importPath!(image);
    expect(imported.path).toBe(image);
    expect(written).toEqual([]);

    const answer = await runBridgeCall({ tool: "import_files_tool", args: { paths: [image] }, project: snapshot(), project_file: projectFile }, { registry });
    expect(answer.ok, answer.text).toBe(true);
    expect(answer.actions.some((a) => a.type === "insert" && a.key[0] === "files")).toBe(true);
    expect(answer.files).toEqual([]);
    expect(existsSync(image)).toBe(true);
  });

  it("refuses tools that replace the project, unknown tools and bad requests", async () => {
    const created = await runBridgeCall({ tool: "new_project_tool", args: {}, project: snapshot(), project_file: projectFile }, { registry });
    expect(created).toMatchObject({ ok: false, actions: [] });
    const unknown = await runBridgeCall({ tool: "no_such_tool", project: snapshot(), project_file: projectFile }, { registry });
    expect(unknown).toMatchObject({ ok: false, actions: [] });
    const relative = await runBridgeCall({ tool: "add_motion_template_tool", project: snapshot(), project_file: "promo.zvn" }, { registry });
    expect(relative.text).toMatch(/absolute/);
    const broken = await runBridgeCall({ tool: "add_motion_template_tool", project: { clips: "nope" }, project_file: projectFile }, { registry });
    expect(broken.text).toMatch(/could not be read/);
  });

  it("lists tools with what the bridge host lacks", () => {
    const tools = bridgeTools(registry);
    expect(tools.find((t) => t.name === "add_motion_template_tool")).toMatchObject({ available: true });
    // The desktop saves and exports itself.
    const exportTool = tools.find((t) => t.missing?.includes("exporter"));
    expect(exportTool?.available).toBe(false);
  });
});

describe("zenvi bridge (stdio)", () => {
  it("serves hello, tools and run as JSON-RPC lines, NaN tokens tolerated", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (c: Buffer) => (text += c.toString()));
    const served = serveBridge({ registry, input, output, hostFor: () => ({}) });
    const request = { tool: "add_motion_template_tool", args: { template: "grid_background", duration_seconds: 2 }, project: snapshot(), project_file: projectFile };
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hello" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "run", params: request }).replace('"tick_pixels":100', '"tick_pixels":100,"unknown_number":NaN')}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "nope" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "shutdown" })}\n`);
    await served;
    const answers = text.trim().split("\n").map((l) => JSON.parse(l) as { id: number; result?: unknown; error?: { code: number } });
    expect(answers.map((a) => a.id)).toEqual([1, 2, 3, 4]);
    expect(answers[0]!.result).toMatchObject({ protocol: BRIDGE_PROTOCOL });
    expect((answers[1]!.result as BridgeAnswer).ok).toBe(true);
    expect(answers[2]!.error?.code).toBe(-32601);
  });
});

describe("zenvi tool-run / bridge --tools", () => {
  it("prints the catalog with the protocol", async () => {
    const r = await zenvi(["bridge", "--tools"], { cwd: work, env: testEnv(home), registry });
    expect(r.code, r.stderr).toBe(0);
    const listed = r.json<{ protocol: number; tools: { name: string }[] }>();
    expect(listed.protocol).toBe(BRIDGE_PROTOCOL);
    expect(listed.tools.some((t) => t.name === "add_motion_template_tool")).toBe(true);
  });

  it("reads a snapshot file and prints the answer", async () => {
    const snap = path.join(work, "snapshot.json");
    await writeFile(snap, JSON.stringify(snapshot()));
    const r = await zenvi(["tool-run", "add_motion_template_tool", "template=end_card", "--args", '{"text":"Northwind"}', "--snapshot", snap, "--project-file", projectFile], {
      cwd: work,
      env: testEnv(home),
      registry,
    });
    expect(r.code, r.stderr).toBe(0);
    const answer = r.json<BridgeAnswer>();
    expect(answer.ok).toBe(true);
    expect(answer.actions.length).toBeGreaterThan(0);
  });
});
