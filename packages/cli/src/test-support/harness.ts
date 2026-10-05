/**
 * Test helpers: run the CLI in-process with captured output, and a fake
 * desktop MCP server (stateless Streamable HTTP + bearer token, like
 * zenvi-core's in-app FastMCP server). Test-only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { applied, type ToolReceipt } from "@zenvi/engine/tools";
import type { Registry } from "../engine/registry.js";
import { runCli } from "../program.js";

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  json<T = Record<string, unknown>>(): T;
}

export async function zenvi(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; registry?: Registry }): Promise<CliRun> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (c: Buffer) => (out += c.toString()));
  stderr.on("data", (c: Buffer) => (err += c.toString()));
  const code = await runCli({ args, cwd: options.cwd, env: options.env, stdout, stderr, registry: options.registry });
  return {
    code,
    stdout: out,
    stderr: err,
    json<T>() {
      return JSON.parse(out) as T;
    },
  };
}

/** Environment for a CLI run with every per-user folder inside `home`. */
export function testEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    ZENVI_CONFIG_DIR: path.join(home, ".config", "zenvi"),
    ZENVI_CACHE_DIR: process.env.ZENVI_CACHE_DIR,
    ZENVI_NO_BROWSER: "1",
    ZENVI_FFMPEG: process.env.ZENVI_FFMPEG,
    ZENVI_FFPROBE: process.env.ZENVI_FFPROBE,
    ...extra,
  };
}

export interface FakeDesktopCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface FakeDesktop {
  url: string;
  token: string;
  calls: FakeDesktopCall[];
  /** Requests that arrived without the right bearer token. */
  rejected: number;
  /** The project the fake app has open (changed by open_project_tool). */
  project?: string;
  close(): Promise<void>;
}

export interface FakeDesktopOptions {
  /** More tool names to list (handoff tools…). */
  tools?: string[];
  /** Receipts for particular tools (default: an applied receipt naming the tool). */
  handlers?: Record<string, (args: Record<string, unknown>) => ToolReceipt | Promise<ToolReceipt>>;
  /** Rewrite `<home>/.openshot_qt/gui_mcp.json` when open_project_tool switches projects, like the real app. */
  home?: string;
}

/** A desktop app MCP server answering contract-3 receipts. */
export async function fakeDesktop(token: string, project?: string, options: FakeDesktopOptions = {}): Promise<FakeDesktop> {
  const state: FakeDesktop = { url: "", token, calls: [], rejected: 0, project, close: async () => undefined };
  const makeServer = () => {
    const server = new Server({ name: "zenvi-editor", version: "1.0.0-test" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: ["get_project_info_tool", "open_project_tool", "add_marker_tool", "inspect_timeline_tool", ...(options.tools ?? [])].map((name) => ({ name, inputSchema: { type: "object" as const } })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      state.calls.push({ tool: request.params.name, args });
      if (request.params.name === "open_project_tool") {
        state.project = String(args.file_path);
        if (options.home) await writeDiscovery(options.home, state);
      }
      const handler = options.handlers?.[request.params.name];
      const receipt = handler
        ? await handler(args)
        : applied(request.params.name, `desktop ran ${request.params.name}`, { data: { project: state.project ?? null } }, request.params.name === "add_marker_tool" ? 1 : 0);
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [{ type: "text", text: JSON.stringify(receipt) }];
      if (request.params.name === "inspect_timeline_tool") content.push({ type: "image", data: Buffer.from("fake-jpeg").toString("base64"), mimeType: "image/jpeg" });
      return { content };
    });
    return server;
  };
  const http: HttpServer = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      state.rejected += 1;
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("Unauthorized");
      return;
    }
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", async () => {
      const server = makeServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  state.url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  state.close = () => new Promise((r) => http.close(() => r()));
  return state;
}

/** Write `~/.openshot_qt/gui_mcp.json` (+ token file) for a fake desktop. */
export async function writeDiscovery(home: string, desktop: FakeDesktop, options: { pid?: number; kind?: "gui" | "headless"; project?: string } = {}): Promise<void> {
  const dir = path.join(home, ".openshot_qt");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "mcp_token"), `${desktop.token}\n`, { mode: 0o600 });
  await writeFile(
    path.join(dir, `${options.kind ?? "gui"}_mcp.json`),
    JSON.stringify({ url: desktop.url, token_file: path.join(dir, "mcp_token"), pid: options.pid ?? process.pid, project: options.project ?? desktop.project ?? null, version: "1.0.0-test" }),
  );
}
