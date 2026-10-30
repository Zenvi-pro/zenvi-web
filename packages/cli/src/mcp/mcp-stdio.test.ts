/**
 * The MCP server end to end over stdio, as Claude Code runs it: a real
 * `zenvi mcp` process (the source through tsx, or the plugin bundle with
 * ZENVI_MCP_E2E_BUNDLE=<path to zenvi.mjs>), the real tool catalog, ffmpeg,
 * a temp HOME and no desktop app.
 */

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ffprobeJson, makeTempDir, makeVideo, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

function serverCommand(): { command: string; args: string[] } {
  const bundle = process.env.ZENVI_MCP_E2E_BUNDLE?.trim();
  if (bundle) return { command: process.execPath, args: [path.resolve(bundle), "mcp"] };
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  return { command: process.execPath, args: [tsx, path.resolve(here, "..", "bin.ts"), "mcp"] };
}

type Receipt = { status: string; summary: string; clips: Array<{ id: string }>; data?: Record<string, unknown> };

let home: string;
let work: string;
let client: Client;
let stderr = "";

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ receipt: Receipt; images: Array<{ mimeType: string; data: string }> }> {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
  const content = result.content as Array<{ type: string; text?: string; mimeType?: string; data?: string }>;
  const receipt = JSON.parse(content[0]!.text!) as Receipt;
  if (result.isError) throw new Error(`${name} failed: ${receipt.summary}\n${stderr.slice(-2000)}`);
  return { receipt, images: content.filter((c) => c.type === "image").map((c) => ({ mimeType: c.mimeType!, data: c.data! })) };
}

beforeAll(async () => {
  home = await makeTempDir("zenvi-mcp-e2e-home-");
  work = await makeTempDir("zenvi-mcp-e2e-work-");
  const { command, args } = serverCommand();
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: work,
    stderr: "pipe",
    env: {
      ...(process.env as Record<string, string>),
      HOME: home,
      USERPROFILE: home,
      ZENVI_CONFIG_DIR: path.join(home, ".config", "zenvi"),
      ZENVI_DESKTOP_DIR: path.join(home, ".openshot_qt"),
      ZENVI_MCP_ENGINE: "portable",
      ZENVI_NO_BROWSER: "1",
    },
  });
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  client = new Client({ name: "zenvi-e2e", version: "1" });
  await client.connect(transport, { timeout: 120_000 });
}, 180_000);

afterAll(async () => {
  await client?.close();
  await removeDir(home);
  await removeDir(work);
});

describe("zenvi mcp over stdio (real catalog)", () => {
  it("lists tools, creates a project, imports, adds, splits, previews and renders", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["open_project_file", "import_files_tool", "add_clip_to_timeline_tool", "split_clip_tool", "add_title_tool", "preview_frame", "render_video"]),
    );
    expect(names.length).toBeGreaterThan(60);
    // Host-aware: list_hosts and the resources over stdio.
    expect(names).toContain("list_hosts");
    expect((await client.listResources()).resources.map((r) => r.uri).slice(0, 4)).toEqual(["zenvi://hosts", "zenvi://taste", "zenvi://handoff", "zenvi://director"]);
    const hosts = await call("list_hosts");
    expect(hosts.receipt.data).toMatchObject({ active: "zenvi-portable" });

    const created = await call("open_project_file", { path: "e2e.zvn" });
    expect(created.receipt.status).toBe("applied");
    const clipFile = await makeVideo(work, "clip.mp4", { width: 320, height: 180, duration: 2, audioHz: 440 });

    const imported = await call("import_files_tool", { paths: JSON.stringify([clipFile]), skip_indexing: "true" });
    const fileId = (imported.receipt.data?.fileIds as string[] | undefined)?.[0];
    expect(fileId).toBeTruthy();
    const added = await call("add_clip_to_timeline_tool", { file_id: fileId, position_seconds: "0", full_file: "true" });
    const clipId = added.receipt.clips[0]!.id;
    const split = await call("split_clip_tool", { clip_id: clipId, at_seconds: 1 });
    expect(split.receipt.clips.map((c) => c.id)).toHaveLength(2);
    const title = await call("add_title_tool", { text: "Hello", position_seconds: "0", duration_seconds: "1" });
    expect(title.receipt.status).toBe("applied");

    const preview = await call("preview_frame", { seconds: 1.5, width: 320 });
    expect(preview.images).toHaveLength(1);
    expect(preview.images[0]!.mimeType).toBe("image/jpeg");
    expect(Buffer.from(preview.images[0]!.data, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const rendered = await call("render_video", { output: "out.mp4", width: 320, quality: "low" });
    expect(rendered.receipt.status).toBe("applied");
    const probe = await ffprobeJson(path.join(work, "out.mp4"));
    expect(probe.streams.map((s) => s.codec_type).sort()).toEqual(["audio", "video"]);
    expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.1);

    // The desktop's argument name works too, and unknown arguments are refused
    // instead of silently dropped (a real Claude Code session sent output_path).
    const aliased = await call("render_video", { output_path: "alias.mp4", width: 160, quality: "low" });
    expect(aliased.receipt.status).toBe("applied");
    expect((await ffprobeJson(path.join(work, "alias.mp4"))).format.duration).toBeDefined();
    await expect(call("render_video", { destination: "x.mp4" })).rejects.toThrow(/unknown argument for render_video: destination/);

    // Every edit autosaved to the project file, in the desktop format.
    const saved = JSON.parse(await readFile(path.join(work, "e2e.zvn"), "utf8")) as { clips: unknown[]; files: unknown[] };
    expect(saved.clips).toHaveLength(3);
    expect(saved.files).toHaveLength(2);
  }, 600_000);
});
