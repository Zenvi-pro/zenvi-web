import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeTempDir, makeVideo, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integratedLoudness } from "../acceptance/media.js";
import { engineRegistry } from "../engine/registry.js";
import { createContext } from "../program.js";
import { testEnv, zenvi } from "../test-support/harness.js";
import { createZenviMcpServer } from "./server.js";

let home: string;
let work: string;

async function connect(projectFile: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const ctx = createContext({ env: testEnv(home), cwd: work, registry: engineRegistry() });
  const server = await createZenviMcpServer(ctx, projectFile);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.server.connect(b);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(a);
  return { client, close: async () => (await client.close(), await server.close()) };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string; mimeType?: string }>;
  return { content, receipt: JSON.parse(content[0]!.text!) as { status: string; summary: string; notes: string[]; data?: Record<string, unknown> } };
}

beforeAll(async () => {
  home = await makeTempDir("zenvi-mcp-review-home-");
  work = await makeTempDir("zenvi-mcp-review-work-");
  await makeVideo(path.join(work, "footage"), "a.mp4", { duration: 1, width: 160, height: 90 });
  const run = (args: string[]) => zenvi(args, { cwd: work, env: testEnv(home), registry: engineRegistry() });
  await run(["new", "cut.zvn", "--profile", "HD 720p 30 fps"]);
  for (let i = 0; i < 4; i += 1) await run(["add", "footage/a.mp4", "--at", String(i)]);
}, 90_000);

afterAll(async () => {
  await removeDir(home);
  await removeDir(work);
});

describe("review_edit_tool over MCP", () => {
  it("returns the contact sheet as image content next to the receipt", async () => {
    const { client, close } = await connect(path.join(work, "cut.zvn"));
    try {
      const { content, receipt } = await call(client, "review_edit_tool", { audio: false });
      expect(receipt.status).toBe("applied");
      expect(content.filter((c) => c.type === "image")).toHaveLength(1);
      expect(content.find((c) => c.type === "image")!.mimeType).toBe("image/jpeg");
      expect(receipt.data).toMatchObject({ shots: { count: 4 }, cuts: { count: 3 } });
    } finally {
      await close();
    }
  }, 60_000);

  it("reminds the agent at render time until it has reviewed the cut it made", async () => {
    const { client, close } = await connect(path.join(work, "cut.zvn"));
    try {
      const out = { output: path.join(work, "out.mp4"), width: 160 };
      const first = await call(client, "render_video", out);
      expect(first.receipt.status).toBe("applied");
      expect(first.receipt.notes.join(" ")).toMatch(/not been reviewed/);

      await call(client, "review_edit_tool", { audio: false, image: false });
      const reviewed = await call(client, "render_video", out);
      expect(reviewed.receipt.notes.join(" ")).not.toMatch(/not been reviewed/);

      // Editing again makes the review stale.
      await call(client, "add_marker_tool", { position_seconds: 1, name: "x" });
      const stale = await call(client, "render_video", out);
      expect(stale.receipt.notes.join(" ")).toMatch(/not been reviewed/);
    } finally {
      await close();
    }
  }, 120_000);

  it("normalises the export's loudness when asked, as master_audio_tool advises when peaks hold the mix down", async () => {
    await makeVideo(path.join(work, "footage"), "tone.mp4", { duration: 2, width: 160, height: 90, audioHz: 440 });
    const run = (args: string[]) => zenvi(args, { cwd: work, env: testEnv(home), registry: engineRegistry() });
    await run(["new", "loud.zvn", "--profile", "HD 720p 30 fps"]);
    await run(["add", "footage/tone.mp4", "--project", "loud.zvn"]);
    const { client, close } = await connect(path.join(work, "loud.zvn"));
    try {
      const output = path.join(work, "loud.mp4");
      const rendered = await call(client, "render_video", { output, width: 160, quality: "low", loudness: "social" });
      expect(rendered.receipt.status, rendered.receipt.summary).toBe("applied");
      expect(await integratedLoudness(output)).toBeCloseTo(-14, 0);
      const bad = await call(client, "render_video", { output, loudness: "very loud" });
      expect(bad.receipt.status).toBe("refused");
      expect(bad.receipt.summary).toMatch(/loudness must be social, broadcast, podcast/);
    } finally {
      await close();
    }
  }, 120_000);
});
