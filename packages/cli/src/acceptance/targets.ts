/**
 * The MCP servers a scenario drives, reached exactly as agents reach them:
 * `zenvi mcp` over stdio (the portable engine) and the desktop app's
 * headless MCP server over Streamable HTTP with its bearer token
 * (zenvi-core `launch.py --headless` advertises it in
 * ~/.openshot_qt/headless_mcp.json).
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { cacheDir } from "@zenvi/render-node";
import type { RunnerKind } from "./scenario.js";

export interface McpImage {
  mimeType: string;
  data: string;
}

export interface CallOutcome {
  /** The server answered without isError. */
  ok: boolean;
  /** The JSON receipt (structuredContent, else the first text block parsed). */
  receipt?: Record<string, unknown>;
  text: string;
  images: McpImage[];
  ms: number;
  /** The call never got an answer (timeout, crash, protocol error). */
  transportError?: string;
}

export interface McpTarget {
  kind: RunnerKind;
  /** e.g. "zenvi mcp (tsx)" or the desktop URL. */
  label: string;
  /** The folder relative paths resolve against (the server's cwd). */
  work: string;
  tools(): Promise<Set<string>>;
  call(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<CallOutcome>;
  /** Server stderr so far (portable only), for failure reports. */
  stderrTail(): string;
  close(): Promise<void>;
}

class ClientTarget implements McpTarget {
  private listed?: Set<string>;
  constructor(
    readonly kind: RunnerKind,
    readonly label: string,
    readonly work: string,
    private readonly client: Client,
    private readonly stderr: () => string,
  ) {}

  async tools(): Promise<Set<string>> {
    this.listed ??= new Set((await this.client.listTools()).tools.map((t) => t.name));
    return this.listed;
  }

  async call(name: string, args: Record<string, unknown>, timeoutMs = 300_000): Promise<CallOutcome> {
    const started = performance.now();
    try {
      const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs, resetTimeoutOnProgress: true });
      const content = (result.content ?? []) as Array<{ type: string; text?: string; mimeType?: string; data?: string }>;
      const text = content.find((c) => c.type === "text")?.text ?? "";
      let receipt = result.structuredContent as Record<string, unknown> | undefined;
      if (!receipt) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) receipt = parsed as Record<string, unknown>;
        } catch {
          // Plain-text tools (some desktop ones) answer without a receipt.
        }
      }
      const images = content.filter((c) => c.type === "image" && c.data).map((c) => ({ mimeType: c.mimeType ?? "", data: c.data! }));
      return { ok: !result.isError, receipt, text, images, ms: performance.now() - started };
    } catch (error) {
      return { ok: false, text: "", images: [], ms: performance.now() - started, transportError: (error as Error).message || String(error) };
    }
  }

  stderrTail(): string {
    return this.stderr().slice(-2000);
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined);
  }
}

export interface PortableOptions {
  /** The server's working folder (projects and exports land here). */
  work: string;
  /** A temp HOME so the run never reads or writes the person's Zenvi settings. */
  home: string;
  /** Run a built bundle (`plugins/zenvi/dist/zenvi.mjs`, `packages/cli/dist/zenvi.mjs`) instead of the source through tsx. */
  bundle?: string;
  /** Extra environment (ZENVI_* switches). */
  env?: Record<string, string>;
}

/**
 * `zenvi mcp` over stdio with an isolated HOME. The real cache folder is kept
 * so Chrome, Blender scene caches and matte models the person installed are
 * found; nothing else of theirs is visible to the server.
 */
export async function startPortable(options: PortableOptions): Promise<McpTarget> {
  await mkdir(options.work, { recursive: true });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const command = process.execPath;
  const args = options.bundle
    ? [path.resolve(options.bundle), "mcp"]
    : [createRequire(import.meta.url).resolve("tsx/cli"), path.resolve(here, "..", "bin.ts"), "mcp"];
  let stderr = "";
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: options.work,
    stderr: "pipe",
    env: {
      ...(process.env as Record<string, string>),
      HOME: options.home,
      USERPROFILE: options.home,
      ZENVI_CONFIG_DIR: path.join(options.home, ".config", "zenvi"),
      ZENVI_DESKTOP_DIR: path.join(options.home, ".openshot_qt"),
      ZENVI_CACHE_DIR: process.env.ZENVI_CACHE_DIR ?? cacheDir(process.env),
      ZENVI_MCP_ENGINE: "portable",
      ZENVI_MCP_ADOBE: "off",
      ZENVI_MCP_HANDOFF: "off",
      ZENVI_NO_BROWSER: "1",
      ...options.env,
    },
  });
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const client = new Client({ name: "zenvi-acceptance", version: "1" });
  await client.connect(transport, { timeout: 120_000 });
  return new ClientTarget("portable", options.bundle ? `zenvi mcp (${path.basename(options.bundle)})` : "zenvi mcp (tsx)", options.work, client, () => stderr);
}

export interface DesktopDiscovery {
  url: string;
  token_file: string;
  pid?: number;
}

/** Where headless Zenvi advertises its MCP server. */
export function desktopDiscoveryFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.ZENVI_DESKTOP_DIR ?? path.join(os.homedir(), ".openshot_qt"), "headless_mcp.json");
}

function alive(pid: number | undefined): boolean {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The advertised headless server, or why there is none (the runner then skips the desktop cleanly). */
export async function findDesktop(env: NodeJS.ProcessEnv = process.env): Promise<{ found: DesktopDiscovery } | { reason: string }> {
  const file = desktopDiscoveryFile(env);
  if (!existsSync(file)) return { reason: `no headless desktop advertised (${file} missing): start zenvi-core \`src/launch.py --headless\` signed in, then rerun` };
  let info: DesktopDiscovery;
  try {
    info = JSON.parse(await readFile(file, "utf8")) as DesktopDiscovery;
  } catch (error) {
    return { reason: `${file} is not JSON: ${(error as Error).message}` };
  }
  if (!info.url || !info.token_file) return { reason: `${file} lacks url/token_file` };
  if (!alive(info.pid)) return { reason: `headless desktop pid ${info.pid} from ${file} is not running` };
  return { found: info };
}

/** Connect to the headless desktop's MCP server. `work` is where fixtures and exports go (the desktop reads absolute paths). */
export async function connectDesktop(info: DesktopDiscovery, work: string): Promise<McpTarget> {
  await mkdir(work, { recursive: true });
  const token = (await readFile(info.token_file, "utf8")).trim();
  const transport = new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: "zenvi-acceptance", version: "1" });
  await client.connect(transport, { timeout: 30_000 });
  return new ClientTarget("desktop", `desktop ${info.url}`, work, client, () => "");
}
