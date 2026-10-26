/**
 * render_video's loudness argument: master_audio_tool tells agents to export
 * with loudness normalisation when sparse peaks hold the mix under its
 * target, so the MCP render has to take it (it was refused as unknown).
 */

import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolveBinary, runBinary } from "@zenvi/render-node";
import { makeTempDir, makeVideo, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import { engineRegistry } from "../engine/registry.js";
import { createContext } from "../program.js";
import { testEnv, zenvi } from "../test-support/harness.js";
import { createZenviMcpServer } from "./server.js";

let home: string;
let work: string;

beforeAll(async () => {
  home = await makeTempDir("zenvi-mcp-loud-home-");
  work = await makeTempDir("zenvi-mcp-loud-work-");
  await makeVideo(path.join(work, "footage"), "tone.mp4", { duration: 2, width: 160, height: 90, audioHz: 440 });
  const run = (args: string[]) => zenvi(args, { cwd: work, env: testEnv(home), registry: engineRegistry() });
  await run(["new", "loud.zvn", "--profile", "HD 720p 30 fps"]);
  await run(["add", "footage/tone.mp4", "--project", "loud.zvn"]);
}, 90_000);

afterAll(async () => {
  await removeDir(home);
  await removeDir(work);
});

async function integratedLufs(file: string): Promise<number> {
  const { stderr } = await runBinary(resolveBinary("ffmpeg"), ["-hide_banner", "-nostdin", "-i", file, "-vn", "-af", "ebur128=peak=none", "-f", "null", "-"]);
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf("Summary:")))?.[1]);
}

it("render_video normalises the export's loudness when asked and refuses targets it does not know", async () => {
  const ctx = createContext({ env: testEnv(home), cwd: work, registry: engineRegistry() });
  const server = await createZenviMcpServer(ctx, path.join(work, "loud.zvn"));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.server.connect(b);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(a);
  const receipt = async (args: Record<string, unknown>) => {
    const result = await client.callTool({ name: "render_video", arguments: args });
    return JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { status: string; summary: string };
  };
  try {
    const output = path.join(work, "loud.mp4");
    const rendered = await receipt({ output, width: 160, quality: "low", loudness: "social" });
    expect(rendered.status, rendered.summary).toBe("applied");
    expect(await integratedLufs(output)).toBeCloseTo(-14, 0);
    const bad = await receipt({ output, loudness: "very loud" });
    expect(bad.status).toBe("refused");
    expect(bad.summary).toMatch(/loudness must be social, broadcast, podcast/);
  } finally {
    await client.close();
    await server.close();
  }
}, 120_000);
