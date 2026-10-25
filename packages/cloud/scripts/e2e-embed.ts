/**
 * End to end: the Zenvi editor embedded in a chat, against a local Zenvi Cloud.
 *
 * Starts the cloud on this machine (real engine tools, ffprobe, the built web
 * editor, blobs in the `zenvi-e2e` container of the storage account named by
 * AZURE_STORAGE_CONNECTION_STRING so signed media URLs really play, tokens in
 * memory), a stand-in chat host that speaks MCP Apps to the editor view the
 * way ChatGPT and Claude do, and drives both with Playwright:
 *
 *   1. open_in_editor: the view frames the editor; the project and its clips show
 *   2. a tool edit (add_title_tool) appears in the open editor within seconds
 *   3. an edit made in the editor (delete a clip) reaches the cloud project
 *   4. "Edit full screen" asks the host for full screen; the full editor shows
 *   5. the token never stays in the frame's address
 *
 *   npm run build -w @zenvi/editor
 *   AZURE_STORAGE_CONNECTION_STRING=… npx tsx packages/cloud/scripts/e2e-embed.ts [--headed] [--shots <dir>]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { chromium, type FrameLocator } from "@playwright/test";
import { createApp } from "../src/app.js";
import { SCOPE_READ, SCOPE_WRITE } from "../src/auth/scopes.js";
import { createSupabaseVerifier } from "../src/auth/supabase.js";
import { loadConfig } from "../src/config.js";
import { createServices } from "../src/container.js";
import { EDITOR_WIDGET_HTML } from "../src/mcp/editor-widget.js";
import { loadEngineRegistry } from "../src/mcp/engine.js";
import { nodeAnalyzeAudio, nodeAssetResolver, nodeAssetSource, nodeProber } from "../src/render/node.js";
import { AzureBlobStore } from "../src/storage/azure.js";
import { MemoryTableStore } from "../src/storage/memory.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const DIST = join(ROOT, "apps/editor/dist/editor");
const USER = "e2e-embed-0000-4000-8000-000000000001";
const args = process.argv.slice(2);
const headed = args.includes("--headed");
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;

type CallResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };

const results: { step: string; ok: boolean; detail?: string }[] = [];
function check(step: string, ok: boolean, detail?: string): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? `  (${detail})` : ""}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await new Promise((r) => server.close(r));
  return port;
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const start = Date.now();
  let value = await read();
  while (!done(value) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 250));
    value = await read();
  }
  return value;
}

function hostPage(widgetUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stand-in chat host</title>
<style>
  body { margin: 0; background: #212121; color: #ececec; font: 14px system-ui; }
  #chat { padding: 12px 16px; }
  #widget { display: block; width: 780px; height: 560px; margin: 0 16px; border: 1px solid #3a3a3a; border-radius: 14px; background: #000; }
  body.full #widget { position: fixed; inset: 0; width: 100vw; height: 100vh; margin: 0; border: 0; border-radius: 0; }
</style></head><body>
<div id="chat">You: Turn these clips into a 12-second highlight reel.<br>Zenvi: Here is your reel.</div>
<iframe id="widget" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" src="${widgetUrl}"></iframe>
<script>
  const widget = document.getElementById("widget");
  window.__log = []; window.__links = []; window.__mode = "inline";
  let result = null, initialized = false;
  const send = (m) => widget.contentWindow.postMessage(m, "*");
  const flush = () => { if (initialized && result) send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result }); };
  fetch("/result.json").then((r) => r.json()).then((r) => { result = r; flush(); });
  window.addEventListener("message", async (e) => {
    if (e.source !== widget.contentWindow) return;
    const m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    window.__log.push(m.method || "response");
    if (m.method === "ui/initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "stand-in", version: "1" }, hostCapabilities: {}, hostContext: { theme: "dark", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] } } });
    else if (m.method === "ui/notifications/initialized") { initialized = true; flush(); }
    else if (m.method === "ui/request-display-mode") { window.__mode = m.params.mode; document.body.classList.toggle("full", m.params.mode === "fullscreen"); send({ jsonrpc: "2.0", id: m.id, result: { mode: m.params.mode } }); }
    else if (m.method === "ui/open-link") { window.__links.push(m.params.url); send({ jsonrpc: "2.0", id: m.id, result: {} }); }
    else if (m.method === "tools/call") { const r = await fetch("/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m.params) }).then((x) => x.json()); send({ jsonrpc: "2.0", id: m.id, result: r }); }
    else if (m.id !== undefined && m.method) send({ jsonrpc: "2.0", id: m.id, result: {} });
  });
</script></body></html>`;
}

async function main(): Promise<void> {
  const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connection) throw new Error("AZURE_STORAGE_CONNECTION_STRING is required (blobs go to the zenvi-e2e container)");
  if (!existsSync(join(DIST, "index.html"))) throw new Error(`build the editor first: npm run build -w @zenvi/editor (${DIST})`);

  const media = mkdtempSync(join(tmpdir(), "zenvi-e2e-embed-"));
  const ffmpeg = (out: string, source: string, tone: number) =>
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `${source}=size=720x1280:rate=30`, "-f", "lavfi", "-i", `sine=frequency=${tone}`, "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(media, out)]);
  ffmpeg("huddle.mp4", "testsrc2", 440);
  ffmpeg("strike.mp4", "smptehdbars", 660);

  const cloudPort = await freePort();
  const hostPort = await freePort();
  const cloudOrigin = `http://127.0.0.1:${cloudPort}`;
  const config = loadConfig({
    STORAGE: "memory",
    PUBLIC_BASE_URL: cloudOrigin,
    ZENVI_EDITOR_DIST: DIST,
    ZENVI_EDITOR_URL: "https://zenvi.pro/editor",
    ZENVI_BACKEND_URL: "",
    LOG_LEVEL: "warn",
  });
  const services = createServices({
    config,
    blobs: new AzureBlobStore(connection, "zenvi-e2e"),
    tables: new MemoryTableStore(),
    engine: await loadEngineRegistry(),
    prober: nodeProber,
    resolveAsset: nodeAssetResolver(),
    assets: nodeAssetSource(),
    analyzeAudio: nodeAnalyzeAudio,
    supabase: createSupabaseVerifier({ supabaseUrl: config.supabaseUrl }),
    // The stand-in host serves the clips from loopback.
    network: { policy: { protocols: ["http:", "https:"], isAllowedAddress: (ip: string) => ip === "127.0.0.1", allowAnyPort: true } },
  });
  const cloud = serve({ fetch: createApp(services).fetch, port: cloudPort, hostname: "127.0.0.1" });
  const pat = (await services.tokens.createPat({ userId: USER, name: "e2e", scopes: [SCOPE_READ, SCOPE_WRITE], ttlDays: 1 })).token;

  const client = new Client({ name: "e2e-embed", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${cloudOrigin}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${pat}` } } }));
  const call = async (name: string, a: Record<string, unknown> = {}): Promise<CallResult> => {
    const r = (await client.callTool({ name, arguments: a })) as CallResult;
    if (r.isError) throw new Error(`${name}: ${r.content[0]?.text}`);
    return r;
  };

  let openResult: CallResult | null = null;
  const host = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/host.html") return void res.writeHead(200, { "content-type": "text/html" }).end(hostPage(`http://localhost:${hostPort}/widget.html`));
    if (url.pathname === "/widget.html") return void res.writeHead(200, { "content-type": "text/html" }).end(EDITOR_WIDGET_HTML);
    if (url.pathname === "/result.json") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(openResult));
    if (url.pathname === "/call" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const params = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { name: string; arguments?: Record<string, unknown> };
      const r = await client.callTool({ name: params.name, arguments: params.arguments ?? {} });
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(r));
    }
    const file = join(media, url.pathname.replace(/^\//, ""));
    if (/^\/[a-z]+\.mp4$/.test(url.pathname) && existsSync(file)) return void res.writeHead(200, { "content-type": "video/mp4" }).end(readFileSync(file));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => host.listen(hostPort, "127.0.0.1", r));

  const browser = await chromium.launch({ headless: !headed });
  try {
    // The project the chat built: two clips on the timeline.
    const created = await call("create_project", { name: "Match day reel", format: "vertical_1080p", fps: 30 });
    const projectId = created.structuredContent?.project_id as string;
    for (const name of ["huddle", "strike"]) {
      const imported = await call("import_media_from_url", { url: `http://127.0.0.1:${hostPort}/${name}.mp4` });
      await call("add_clip_to_timeline_tool", { file_id: imported.structuredContent?.file_id as string, full_file: "true" });
    }
    openResult = await call("open_in_editor");
    const token = (openResult._meta?.["zenvi/editor"] as { token?: string } | undefined)?.token ?? "";
    check("open_in_editor carries an embed token only in _meta", token.startsWith("zvn_emb_") && !JSON.stringify(openResult.content).includes(token));

    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${hostPort}/host.html`);
    const editor: FrameLocator = page.frameLocator("#widget").frameLocator("#frame");
    const clips = editor.locator("[data-clip-id]");

    await editor.getByText("Match day reel").first().waitFor({ state: "visible", timeout: 90_000 });
    const count = await until(() => clips.count(), (n) => n === 2, 30_000);
    check("the view frames the editor with the project and its clips", count === 2, `${count} clips`);
    if (shotsDir) {
      // Give the preview time to decode its first frame (signed blob URLs, range reads).
      await page.waitForTimeout(4000);
      await page.screenshot({ path: join(shotsDir, "embed-inline.png") });
    }

    const frame = page.frames().find((f) => f.url().startsWith(`${cloudOrigin}/editor/embed/`));
    check("the token is gone from the frame's address", Boolean(frame) && !(frame?.url() ?? "").includes("token="), frame?.url());

    // A chat edit shows up live.
    await call("add_title_tool", { text: "GOAL!", position_seconds: 3, duration_seconds: 3 });
    const afterTitle = await until(() => clips.count(), (n) => n === 3, 20_000);
    check("an edit from the chat appears in the open editor", afterTitle === 3, `${afterTitle} clips`);

    // An edit in the editor reaches the cloud.
    await clips.first().click();
    await page.keyboard.press("Delete");
    const stored = await until(
      async () => {
        const res = await fetch(`${cloudOrigin}/v1/projects/${projectId}`, { headers: { Authorization: `Bearer ${pat}` } });
        const body = (await res.json()) as { project?: { clips?: unknown[] } };
        return body.project?.clips?.length ?? -1;
      },
      (n) => n === 2,
      20_000,
    );
    check("an edit in the editor is saved to the cloud project", stored === 2, `${stored} clips in the cloud`);

    // Full screen: the host is asked, then the whole editor shows.
    await editor.getByRole("button", { name: "Edit full screen" }).click();
    const mode = await until(() => page.evaluate(() => (globalThis as unknown as { __mode: string }).__mode), (m) => m === "fullscreen", 10_000);
    const library = editor.getByRole("navigation", { name: "Library sections" });
    await library.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    check("Edit full screen asks the host and shows the full editor", mode === "fullscreen" && (await library.isVisible()), mode);
    if (shotsDir) await page.screenshot({ path: join(shotsDir, "embed-fullscreen.png") });

    // "Open in Zenvi" goes through the host to zenvi.pro.
    await editor.getByRole("button", { name: "Open in Zenvi (full editor)" }).click();
    const links = await until(() => page.evaluate(() => (globalThis as unknown as { __links: string[] }).__links), (l) => l.length > 0, 5000);
    check("Open in Zenvi asks the host to open zenvi.pro", links[0] === `https://zenvi.pro/editor/p/${projectId}`, links[0]);

    check("no uncaught errors in the page", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    host.close();
    cloud.close();
    rmSync(media, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
