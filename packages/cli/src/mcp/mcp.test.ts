import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createProject } from "@zenvi/engine";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeTempDir, makeVideo, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { engineRegistry } from "../engine/registry.js";
import { createContext } from "../program.js";
import { fakeDesktop, testEnv, writeDiscovery, zenvi, type FakeDesktop } from "../test-support/harness.js";
import { testRegistry } from "../test-support/registry.js";
import { createZenviMcpServer, SERVER_INSTRUCTIONS, type ZenviMcpServer } from "./server.js";

let home: string;
let work: string;
let desktop: FakeDesktop;
const open: Array<{ client: Client; server: ZenviMcpServer }> = [];

async function connect(projectFile?: string, env: NodeJS.ProcessEnv = {}, registry = testRegistry()): Promise<Client> {
  const ctx = createContext({ env: testEnv(home, env), cwd: work, registry });
  const server = await createZenviMcpServer(ctx, projectFile);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.server.connect(b);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(a);
  open.push({ client, server });
  return client;
}

type Receipt = { contract: number; status: string; summary: string; notes: string[]; data?: Record<string, unknown>; engine?: string };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return { result, receipt: JSON.parse(content[0]!.text!) as Receipt, structured: result.structuredContent as Receipt };
}

beforeAll(async () => {
  home = await makeTempDir("zenvi-mcp-home-");
  work = await makeTempDir("zenvi-mcp-work-");
  desktop = await fakeDesktop("tok-mcp");
});

afterEach(async () => {
  for (const { client, server } of open.splice(0)) {
    await client.close();
    await server.close();
  }
});

afterAll(async () => {
  await desktop.close();
  await removeDir(home);
  await removeDir(work);
});

describe("zenvi mcp", () => {
  it("lists the tools agents use whole and the specialist ones short; a refused short one lists its arguments in full", async () => {
    const full = (await (await connect(undefined, { ZENVI_MCP_LISTING: "full" }, engineRegistry())).listTools()).tools;
    const client = await connect(undefined, {}, engineRegistry());
    const lean = (await client.listTools()).tools;
    const byName = (tools: typeof lean, name: string) => tools.find((t) => t.name === name)!;
    expect(lean.map((t) => t.name)).toEqual(full.map((t) => t.name));
    // A tool the bench uses keeps its whole text; a specialist one keeps its first sentence and its argument names, types and enums.
    expect(byName(lean, "add_clip_to_timeline_tool")).toEqual(byName(full, "add_clip_to_timeline_tool"));
    const split = byName(lean, "split_clip_tool");
    expect(split.description.length).toBeLessThan(byName(full, "split_clip_tool").description.length + 1);
    expect(Object.keys(split.inputSchema.properties ?? {})).toEqual(Object.keys(byName(full, "split_clip_tool").inputSchema.properties ?? {}));
    expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(full).length * 0.85);
    expect(SERVER_INSTRUCTIONS).toContain("a call refused for its arguments lists them in full");

    const refused = await call(client, "split_clip_tool", { no_such_argument: 1 });
    expect(refused.receipt.status).toBe("refused");
    expect(refused.receipt.notes.join("\n")).toMatch(/^split_clip_tool arguments in full:\n/m);
  });

  it("never refuses for a missing brief: the first import saves a minimal one and says so", async () => {
    const client = await connect(undefined, { ZENVI_MCP_BRIEF: "on" });
    await call(client, "open_project_file", { path: "auto.zvn" });
    await makeVideo(work, "auto.mp4", { duration: 1, width: 160, height: 90 });
    const first = await call(client, "import_files_tool", { paths: JSON.stringify([path.join(work, "auto.mp4")]) });
    expect(first.receipt.status).toBe("applied");
    expect(first.receipt.notes.join(" ")).toMatch(/Saved a minimal brief for this project \(auto: style \S+ matched from the styles index, 16:9, 15 s, one beat\)/);
    const again = await call(client, "import_files_tool", { paths: JSON.stringify([path.join(work, "auto.mp4")]) });
    expect(again.receipt.notes.join(" ")).not.toMatch(/minimal brief/);
  });

  it("puts the director's plan on a new project's receipt and hands out the recipes as a tool", async () => {
    const client = await connect();
    const opened = await call(client, "open_project_file", { path: "plan.zvn" });
    expect(opened.receipt.notes.join(" ")).toMatch(/^A new edit\. Before the first edit, read its style's recipe .*get_style_tool \{"style": "<id>".*save_brief_tool, get_brief_tool \(optional\).*Finish, in order: unify_grade_tool/);
    const recipe = await call(client, "read_director_recipe", { recipe: "match-cut-montage" });
    expect(recipe.receipt.status).toBe("applied");
    expect(recipe.receipt.summary).toMatch(/match_cut_montage_tool/);
    // No brief saved yet: one line points at the brief compiler (never all of it); once one is saved, the recipe alone.
    expect(recipe.receipt.summary).toMatch(/^No brief saved yet\. A short one plans the edit/);
    expect(recipe.receipt.summary).not.toContain("# The brief compiler");
    const briefed = createProject({ id: "BRIEFEDXXX" });
    briefed.settings = { zenvi_brief: { goal: "g", platform: "Reels", aspect: "16:9", length_seconds: 10, style: "match-cut-montage", hook: "h", beats: [{ start: 0, end: 10, name: "all" }] } };
    await writeFile(path.join(work, "briefed.zvn"), JSON.stringify(briefed));
    expect((await call(client, "open_project_file", { path: "briefed.zvn" })).receipt.status).toBe("applied");
    expect((await call(client, "read_director_recipe", { recipe: "match-cut-montage" })).receipt.summary).toMatch(/^# Match-cut montage/);
    expect((await call(client, "read_director_recipe", { sound_palette: "hype" })).receipt.summary.length).toBeGreaterThan(200);
    expect((await call(client, "read_director_recipe", {})).receipt.status).toBe("refused");
    expect((await call(client, "read_director_recipe", { styles: "brief" })).receipt.summary).toMatch(/^# The brief compiler/);
    expect((await call(client, "read_director_recipe", { styles: "index" })).receipt.summary).toContain("| [hype-reel](");
    expect((await call(client, "read_director_recipe", { styles: "hype-reel" })).receipt.summary).toContain("build_reel_tool");
    expect((await call(client, "read_director_recipe", { styles: "nope" })).receipt.status).toBe("refused");
    expect((await call(client, "read_director_recipe", { styles: "brief", recipe: "hype-reel" })).receipt.status).toBe("refused");
  });

  it("lists catalog tools plus the local extras, with workflow instructions", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["import_files_tool", "add_marker_tool", "open_project_file", "render_video", "preview_frame", "launch_editor", "push_to_cloud"]));
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    const tool = (await client.listTools()).tools.find((t) => t.name === "preview_frame")!;
    // seconds, or Zenvi Cloud's time_seconds (W53 B7).
    expect(Object.keys((tool.inputSchema as { properties: object }).properties)).toEqual(expect.arrayContaining(["seconds", "time_seconds"]));
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("says how to sign in, without sending the token, when the sign-in is a personal token", async () => {
    // Stands in for the backend: every route needs a Supabase session.
    const seen: Array<string | undefined> = [];
    const stub = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ detail: "auth required: missing Authorization: Bearer header" }));
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const env = testEnv(home, { ZENVI_BACKEND_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}` });
    const configDir = env.ZENVI_CONFIG_DIR!;
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "auth.json"), JSON.stringify({ kind: "pat", token: "zvn_pat_abc", user_email: "p@q.r", saved_at: "x" }));
    try {
      // The real catalog: the test registry stubs the generation tools.
      const ctx = createContext({ env, cwd: work });
      const server = await createZenviMcpServer(ctx);
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.server.connect(b);
      const client = new Client({ name: "test", version: "1" });
      await client.connect(a);
      open.push({ client, server });

      // One health tool is listed (W54: #53's mcp_health_tool and #58's mcp_health were both); the old name still answers.
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("mcp_health_tool");
      expect(names).not.toContain("mcp_health");
      const health = await call(client, "mcp_health_tool");
      expect(health.receipt.status).toBe("applied");
      expect(health.receipt.summary).toMatch(/^Zenvi is up\./);
      expect((await call(client, "mcp_health")).receipt.summary).toBe(health.receipt.summary);
      expect(health.receipt.summary).toMatch(/personal token: Zenvi Cloud only/);
      expect(health.receipt.summary).toMatch(/AI voice \(text to speech\): off\. .*zenvi login/);
      expect(health.receipt.summary).toMatch(/Zenvi Cloud .*: on/);

      const tts = await call(client, "generate_tts_and_add_to_timeline_tool", { text: "hello" });
      expect(tts.receipt.summary).toMatch(/personal tokens \(zvn_…\).*zenvi login/);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((auth) => auth === undefined)).toBe(true);
    } finally {
      stub.close();
      await rm(path.join(configDir, "auth.json"), { force: true });
    }
  });

  it("works untitled, then saves those edits when a file is chosen; later edits autosave", async () => {
    const client = await connect();
    const first = await call(client, "add_marker_tool", { position_seconds: "1.5", label: "a" });
    expect(first.receipt).toMatchObject({ contract: 3, status: "applied" });
    expect(first.structured).toMatchObject({ status: "applied", engine: "portable" });
    expect(first.receipt.notes.join(" ")).toMatch(/Not saved yet/);
    const opened = await call(client, "open_project_file", { path: "edit" });
    expect(opened.receipt.summary).toMatch(/Saved the unsaved project as .*edit\.zvn/);
    const file = path.join(work, "edit.zvn");
    expect(JSON.parse(await readFile(file, "utf8")).markers).toHaveLength(1);

    await makeVideo(work, "shot.mp4", { duration: 1, width: 160, height: 90 });
    await call(client, "import_files_tool", { paths: JSON.stringify([path.join(work, "shot.mp4")]) });
    const saved = JSON.parse(await readFile(file, "utf8")) as { files: Array<{ path: string }>; history: { undo: unknown[] } };
    expect(saved.files[0]!.path).toBe("shot.mp4");
    expect(saved.history.undo.length).toBeGreaterThan(0);
  });

  it("creates a project from a social preset name (W25a E2E bug 9)", async () => {
    const client = await connect();
    const opened = await call(client, "open_project_file", { path: "reel", profile: "instagram_reel" });
    expect(opened.receipt.status).toBe("applied");
    const saved = JSON.parse(await readFile(path.join(work, "reel.zvn"), "utf8")) as { profile: string; width: number; height: number };
    expect([saved.profile, saved.width, saved.height]).toEqual(["FHD Vertical 1080p 30 fps", 1080, 1920]);
    const bad = await call(client, "open_project_file", { path: "bad", profile: "betamax" });
    expect(bad.receipt.summary).toMatch(/Unknown profile "betamax"/);
  });

  it("picks up edits other processes made to the file", async () => {
    const file = path.join(work, "shared.zvn");
    expect((await zenvi(["new", file], { cwd: work, env: testEnv(home), registry: testRegistry() })).code).toBe(0);
    const client = await connect(file);
    await call(client, "add_marker_tool", { position_seconds: 1, label: "from-mcp" });
    expect((await zenvi(["-p", file, "marker", "add", "2", "from-cli"], { cwd: work, env: testEnv(home), registry: testRegistry() })).code).toBe(0);
    const listed = await call(client, "list_markers_tool");
    expect(listed.receipt.summary).toMatch(/from-mcp/);
    expect(listed.receipt.summary).toMatch(/from-cli/);
  });

  it("reports failures as error receipts with isError", async () => {
    const client = await connect();
    const bad = await call(client, "open_project_file", { path: "missing.zvn", create: false });
    expect(bad.result.isError).toBe(true);
    expect(bad.receipt.summary).toMatch(/^Error: .*does not exist/);
    const unknown = await call(client, "no_such_tool");
    expect(unknown.result.isError).toBe(true);
    expect(unknown.receipt.summary).toBe("Error: no_such_tool is not available in this Zenvi surface");
    const refused = await call(client, "preview_frame", { seconds: -2 });
    expect(refused.receipt.status).toBe("refused");
  });

  it("routes calls to the desktop app while it has the session's project open", async () => {
    const file = path.join(work, "live.zvn");
    expect((await zenvi(["new", file], { cwd: work, env: testEnv(home), registry: testRegistry() })).code).toBe(0);
    desktop.project = file;
    await writeDiscovery(home, desktop);
    const client = await connect(file);
    const r = await call(client, "add_marker_tool", { position_seconds: 3 });
    expect(r.structured).toMatchObject({ engine: "desktop", status: "applied" });
    expect(desktop.calls.map((c) => c.tool)).toEqual(["add_marker_tool"]);
    const frame = await call(client, "preview_frame", { time_seconds: 1 });
    expect((frame.result.content as Array<{ type: string }>).map((c) => c.type)).toEqual(["text", "image"]);
    expect(desktop.calls.at(-1)).toMatchObject({ tool: "inspect_timeline_tool", args: { start: 1, end: 1, maxFrames: 1 } });
  });
});
