/**
 * A short edit made only through Zenvi Cloud's remote MCP server, the way a
 * ChatGPT or Claude connector makes one, with the Zenvi Motion tools: two
 * generated clips and a beat track are imported, the first is speed-ramped,
 * the cut gets a whip, a kinetic headline (a Zenvi Motion block, rendered in
 * the cloud with headless Chrome) goes over the video, captions, the music
 * and an auto sound design pass go under it, the first clip gets a subject
 * matte, and the project is rendered to MP4. Zenvi 3D is asked for too: the
 * cloud does not list it (no Blender there).
 *
 *   npx tsx packages/cloud/scripts/motion-edit.ts <out dir>
 *   ZENVI_CLOUD_URL=https://… ZENVI_TOKEN=zvn_pat_… npx tsx packages/cloud/scripts/motion-edit.ts <out dir>
 *
 * Without ZENVI_CLOUD_URL it drives a Zenvi Cloud in this process (this
 * checkout's code, memory storage, this machine's ffmpeg, Chrome and
 * onnxruntime-node) and serves the clips to its URL import from 127.0.0.1.
 * With it, the clips go up through the REST upload (SAS) and come in through
 * import_media_from_url from their signed links.
 *
 * Writes <out dir>/transcript.jsonl (every call: arguments, answer, seconds),
 * transcript.md, frame.png (preview_frame) and edit.mp4. Needs ffmpeg.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { SCOPE_READ, SCOPE_WRITE } from "../src/auth/scopes.js";
import { createSupabaseVerifier } from "../src/auth/supabase.js";
import { loadConfig } from "../src/config.js";
import { createServices } from "../src/container.js";
import { loadEngineRegistry } from "../src/mcp/engine.js";
import {
  nodeAnalyzeAudio,
  nodeAssetResolver,
  nodeAssetSource,
  nodeDecodePcm,
  nodeFontFamilies,
  nodeMatteHosts,
  nodeMotionHosts,
  nodeProber,
  nodeRenderer,
} from "../src/render/node.js";
import { MemoryBlobStore, MemoryTableStore } from "../src/storage/memory.js";

const outDir = resolve(process.argv[2] ?? join(tmpdir(), `zenvi-motion-edit-${Date.now()}`));
mkdirSync(outDir, { recursive: true });

interface Cloud {
  where: string;
  client: Client;
  /** A URL import_media_from_url can fetch the file from. */
  publish(file: string, contentType: string): Promise<string>;
  download(url: string): Promise<Buffer>;
  close(): Promise<void>;
}

function ffmpeg(args: string[]): void {
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

/** Two 3 s test clips (the second hue-shifted, its own tone) and an 8 s 120 BPM pulse. */
function makeMedia(dir: string): { a: string; b: string; beat: string } {
  const a = join(dir, "clip-a.mp4");
  const b = join(dir, "clip-b.mp4");
  const beat = join(dir, "beat.wav");
  const clip = (out: string, hue: number, tone: number) =>
    ffmpeg([
      ...["-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=3,hue=h=${hue}`],
      ...["-f", "lavfi", "-i", `sine=frequency=${tone}:sample_rate=48000:duration=3`],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out],
    ]);
  clip(a, 0, 330);
  clip(b, 140, 495);
  // A kick-like 60 Hz thump on every beat (120 BPM) under a quiet 220 Hz pad.
  ffmpeg([
    ...["-f", "lavfi", "-i", "sine=frequency=60:sample_rate=48000:duration=8"],
    ...["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=8"],
    ...["-filter_complex", "[0]volume='if(lt(mod(t,0.5),0.12),1.6*(1-mod(t,0.5)/0.12),0)':eval=frame[k];[1]volume=0.08[p];[k][p]amix=inputs=2:normalize=0"],
    beat,
  ]);
  return { a, b, beat };
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A deployed Zenvi Cloud: MCP and REST over HTTPS with a personal access token. */
async function remoteCloud(url: string, token: string): Promise<Cloud> {
  if (!token.startsWith("zvn_")) throw new Error("ZENVI_TOKEN must be a Zenvi personal access token (zvn_pat_…)");
  const base = url.replace(/\/+$/, "");
  const rest = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
  const client = new Client({ name: "zenvi-motion-edit", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return {
    where: base,
    client,
    async publish(file, contentType) {
      const bytes = readFileSync(file);
      const hash = sha256(bytes);
      const name = file.split("/").pop()!;
      const declared = await rest("/v1/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: hash, size: bytes.length, name, contentType }) });
      const ticket = (await declared.json()) as { exists?: boolean; uploadUrl?: string; uploadHeaders?: Record<string, string> };
      if (!declared.ok) throw new Error(`POST /v1/media: ${declared.status} ${JSON.stringify(ticket)}`);
      if (!ticket.exists) {
        const put = await fetch(ticket.uploadUrl!, { method: "PUT", headers: ticket.uploadHeaders, body: bytes });
        if (!put.ok) throw new Error(`upload of ${name}: ${put.status}`);
        const done = await rest(`/v1/media/${hash}/complete`, { method: "POST" });
        if (!done.ok) throw new Error(`complete ${name}: ${done.status} ${await done.text()}`);
      }
      const link = (await (await rest(`/v1/media/${hash}/url`)).json()) as { url: string };
      return link.url;
    },
    download: async (link) => Buffer.from(await (await fetch(link)).arrayBuffer()),
    close: () => client.close(),
  };
}

/** Zenvi Cloud in this process with memory storage; URL imports may reach 127.0.0.1, where the clips are served. */
async function localCloud(mediaDir: string): Promise<Cloud> {
  const files = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname.slice(1));
    if (!/^[\w.-]+$/.test(name)) return void res.writeHead(404).end();
    try {
      res.writeHead(200, { "content-length": readFileSync(join(mediaDir, name)).length }).end(readFileSync(join(mediaDir, name)));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => files.listen(0, "127.0.0.1", done));
  const port = (files.address() as { port: number }).port;

  const config = loadConfig({ STORAGE: "memory", PUBLIC_BASE_URL: "https://cloud.local", ZENVI_EDITOR_URL: "https://zenvi.pro/editor", LOG_LEVEL: "warn" });
  const { renderer, reason } = await nodeRenderer();
  if (reason) throw new Error(`renderer: ${reason}`);
  const motion = await nodeMotionHosts();
  if (motion.reason) throw new Error(`motion blocks: ${motion.reason}`);
  const mattes = nodeMatteHosts();
  if (mattes.reason) console.warn(`subject mattes: ${mattes.reason}`);
  const blobs = new MemoryBlobStore();
  const services = createServices({
    config,
    blobs,
    tables: new MemoryTableStore(),
    engine: await loadEngineRegistry(),
    renderer,
    prober: nodeProber,
    resolveAsset: nodeAssetResolver(),
    assets: nodeAssetSource(),
    analyzeAudio: nodeAnalyzeAudio,
    decodePcm: nodeDecodePcm,
    fontFamilies: nodeFontFamilies,
    motion: motion.factory,
    mattes: mattes.factory,
    supabase: createSupabaseVerifier({ supabaseUrl: config.supabaseUrl }),
    network: { policy: { protocols: ["http:"], isAllowedAddress: (ip) => ip === "127.0.0.1", allowAnyPort: true } },
  });
  const app = createApp(services);
  const token = (await services.tokens.createPat({ userId: "motion-edit-user", name: "motion-edit", scopes: [SCOPE_READ, SCOPE_WRITE], ttlDays: 1 })).token;
  const client = new Client({ name: "zenvi-motion-edit", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://cloud.local/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (url, init) => app.request(url.toString(), init),
    }),
  );
  return {
    where: "in this process",
    client,
    publish: async (file) => `http://127.0.0.1:${port}/${encodeURIComponent(file.split("/").pop()!)}`,
    download: (link) => blobs.acceptSignedRead(link),
    async close() {
      await client.close();
      files.close();
    },
  };
}

type Answer = { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[]; structuredContent?: Record<string, unknown> };

const transcript: Record<string, unknown>[] = [];

async function main(): Promise<void> {
  const mediaDir = join(outDir, "media");
  mkdirSync(mediaDir, { recursive: true });
  const media = makeMedia(mediaDir);
  const remote = process.env.ZENVI_CLOUD_URL;
  const cloud = remote ? await remoteCloud(remote, process.env.ZENVI_TOKEN ?? "") : await localCloud(mediaDir);
  console.log(`Zenvi Cloud ${cloud.where}; writing ${outDir}`);
  const tools = new Set((await cloud.client.listTools()).tools.map((t) => t.name));
  transcript.push({ step: "tools/list", count: tools.size, motion: ["list_motion_blocks_tool", "add_motion_block_tool", "update_motion_block_tool"].filter((t) => tools.has(t)), scenes3d: ["add_3d_scene_tool", "rerender_3d_scene_tool"].filter((t) => tools.has(t)) });

  /** One tool call, logged; an error answer stops the edit unless it was expected. */
  const call = async (name: string, args: Record<string, unknown>, expectError = false): Promise<Answer> => {
    const started = Date.now();
    let answer: Answer;
    try {
      answer = (await cloud.client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 })) as Answer;
    } catch (error) {
      answer = { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
    const text = answer.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    transcript.push({ tool: name, args, ok: !answer.isError, seconds, text: text.slice(0, 1200), data: answer.structuredContent?.data ?? answer.structuredContent });
    console.log(`${answer.isError ? "✗" : "✓"} ${name} (${seconds}s): ${text.split("\n")[0]!.slice(0, 160)}`);
    if (answer.isError && !expectError) throw new Error(`${name} failed: ${text}`);
    return answer;
  };
  const data = (answer: Answer): Record<string, unknown> => {
    const structured = answer.structuredContent ?? {};
    const inner = structured.data as Record<string, unknown> | undefined;
    // Engine receipts nest the tool's own data under data.data.
    return { ...structured, ...(inner ?? {}), ...((inner?.data as Record<string, unknown> | undefined) ?? {}) };
  };

  try {
    await call("create_project", { name: "Zenvi Motion cloud edit", profile: "HD 720p 30 fps" });
    const a = String(data(await call("import_media_from_url", { url: await cloud.publish(media.a, "video/mp4"), name: "clip-a.mp4" })).file_id);
    const b = String(data(await call("import_media_from_url", { url: await cloud.publish(media.b, "video/mp4"), name: "clip-b.mp4" })).file_id);
    const beat = String(data(await call("import_media_from_url", { url: await cloud.publish(media.beat, "audio/wav"), name: "beat.wav" })).file_id);

    const placed = data(await call("add_clip_to_timeline_tool", { file_id: a, position_seconds: 0, track: "1" }));
    // A contract-3 receipt lists what it created.
    const first = String(placed.timeline_clip_id ?? (placed.clips as { id: string }[] | undefined)?.[0]?.id);
    await call("add_clip_to_timeline_tool", { file_id: b, position_seconds: 3, track: "1" });
    await call("speed_ramp_tool", { clip_id: first, preset: "ramp_out", ripple: true, audio: "mute" });
    await call("apply_motion_transitions_tool", { track: "1", preset: "whip", direction: "left" });

    const blocks = await call("list_motion_blocks_tool", {});
    transcript.push({ note: "blocks", text: blocks.content[0]?.text?.slice(0, 400) });
    await call("add_motion_block_tool", { block: "kinetic_headline", params: { text: "Made in Zenvi Cloud" }, position_seconds: 0.3, duration_seconds: 2.4, placement: "over_video" });
    await call("add_captions_tool", { cues: [{ start: 3.2, end: 4.6, text: "every cut lands" }, { start: 4.6, end: 5.8, text: "on a sound" }], style: "reels" });
    await call("add_clip_to_timeline_tool", { file_id: beat, position_seconds: 0, start_seconds: 0, duration_seconds: 6.5, track: "4" });
    await call("auto_sound_design_tool", { intensity: "hype" });
    if (tools.has("generate_subject_matte_tool")) await call("generate_subject_matte_tool", { clip_id: first, size: "half" });
    await call("add_3d_scene_tool", { scene: "title_3d", text: "3D" }, true);

    const frame = await call("preview_frame", { time_seconds: 1.2, width: 960 });
    const image = frame.content.find((c) => c.type === "image");
    if (image?.data) writeFileSync(join(outDir, "frame.png"), Buffer.from(image.data, "base64"));

    const started = data(await call("render_project", { quality: "medium" }));
    const renderId = String(started.render_id);
    let status: Record<string, unknown> = started;
    for (let i = 0; i < 40 && status.status !== "done" && status.status !== "failed"; i += 1) {
      status = data(await call("get_render_status", { render_id: renderId, wait_seconds: 30 }));
    }
    if (status.status !== "done") throw new Error(`render ${renderId} ended ${String(status.status)}: ${String(status.error ?? "")}`);
    writeFileSync(join(outDir, "edit.mp4"), await cloud.download(String(status.url)));
    console.log(`rendered ${join(outDir, "edit.mp4")}`);
  } finally {
    writeFileSync(join(outDir, "transcript.jsonl"), transcript.map((line) => JSON.stringify(line)).join("\n") + "\n");
    writeFileSync(join(outDir, "transcript.md"), markdown(cloud.where));
    await cloud.close();
  }
}

function markdown(where: string): string {
  const rows = transcript
    .filter((line) => typeof line.tool === "string")
    .map((line) => `| \`${String(line.tool)}\` | ${line.ok ? "ok" : "error"} | ${String(line.seconds)} | ${String(line.text).split("\n")[0]!.replace(/\|/g, "\\|").slice(0, 200)} |`);
  return [`# Zenvi Motion edit through the remote MCP server (${where})`, "", "| Tool | Result | Seconds | Answer |", "| --- | --- | --- | --- |", ...rows, ""].join("\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
