/**
 * Finding a running Zenvi desktop app's MCP server.
 *
 * Contract (zenvi-core #233, classes/mcp_discovery.py): the GUI writes
 * `~/.openshot_qt/gui_mcp.json`, `launch.py --headless`
 * `~/.openshot_qt/headless_mcp.json` (Windows: %USERPROFILE%\.openshot_qt),
 * exactly `{"url","token_file","pid","project","version"}`; the bearer is the
 * token file's contents; `project` is null while untitled. The files are
 * removed on a clean exit but a crash leaves them, so `pid` and `url` are a
 * claim: an endpoint counts only when its pid is alive AND its URL answers
 * one `initialize` (the desktop's server is stateless, so this leaves
 * nothing behind).
 *
 * Safety: generic port probes have crashed running desktop apps (SIGPIPE).
 * So this module only ever contacts the exact URL a discovery file names,
 * and only after checking its `pid` is alive; the legacy fallback (desktop
 * builds without discovery files) is ONE well-formed JSON-RPC `initialize`
 * POST to http://127.0.0.1:7434/mcp with the bearer from
 * `~/.openshot_qt/mcp_token` and a short timeout. No other ports, no raw TCP.
 */

import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { ZenviConfig } from "../config.js";

export type DesktopKind = "gui" | "headless" | "legacy";

export interface DesktopEndpoint {
  kind: DesktopKind;
  url: string;
  token: string;
  pid?: number;
  /** Absolute path of the project the app has open, when it says. */
  project?: string;
  version?: string;
  /** Discovery file (or token file for legacy). */
  source: string;
}

export const LEGACY_URL = "http://127.0.0.1:7434/mcp";

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Only loopback HTTP URLs are trusted from discovery files. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function readToken(file: string): Promise<string | undefined> {
  try {
    const token = (await readFile(file, "utf8")).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

interface DiscoveryFile {
  url?: unknown;
  token_file?: unknown;
  pid?: unknown;
  project?: unknown;
  version?: unknown;
}

async function fromFile(config: ZenviConfig, name: string, kind: "gui" | "headless", options: DiscoverOptions): Promise<DesktopEndpoint | undefined> {
  const file = path.join(config.desktopDir, name);
  let data: DiscoveryFile;
  try {
    data = JSON.parse(await readFile(file, "utf8")) as DiscoveryFile;
  } catch {
    return undefined;
  }
  const pid = Number(data.pid);
  if (typeof data.url !== "string" || !isLoopbackUrl(data.url) || !pidAlive(pid)) return undefined;
  const tokenFile =
    typeof data.token_file === "string" && data.token_file
      ? path.isAbsolute(data.token_file)
        ? data.token_file
        : path.join(config.desktopDir, data.token_file)
      : path.join(config.desktopDir, "mcp_token");
  const token = await readToken(tokenFile);
  if (!token) return undefined;
  if (options.verify !== false && !(await probeEndpoint(data.url, token, options))) return undefined;
  const project = typeof data.project === "string" && data.project ? data.project : undefined;
  return {
    kind,
    url: data.url,
    token,
    pid,
    project,
    version: typeof data.version === "string" ? data.version : undefined,
    source: file,
  };
}

export interface DiscoverOptions {
  /** Also try the legacy fixed endpoint (one initialize request). */
  legacy?: boolean;
  /** Check that a discovery file's URL answers (default true). */
  verify?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  clientVersion?: string;
}

/** One JSON-RPC initialize to the legacy endpoint; true when it answers like an MCP server. */
export function probeLegacy(token: string, options: DiscoverOptions = {}): Promise<boolean> {
  return probeEndpoint(LEGACY_URL, token, options);
}

/** One JSON-RPC initialize to `url` (an exact discovery URL); true when it answers like an MCP server. */
export async function probeEndpoint(url: string, token: string, options: DiscoverOptions = {}): Promise<boolean> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "zenvi-cli", version: options.clientVersion ?? "0" },
        },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    const text = await response.text();
    // JSON response, or one SSE event carrying it.
    const json = text.trim().startsWith("{") ? text : (/^data:\s*(\{.*\})\s*$/m.exec(text)?.[1] ?? "");
    const parsed = JSON.parse(json) as { result?: unknown };
    return parsed.result !== undefined;
  } catch {
    return false;
  }
}

/** True when `<desktopDir>/<kind>_mcp.json` names a process that is alive (answering or not). */
export async function desktopProcessAlive(config: ZenviConfig, kind: "gui" | "headless" = "gui"): Promise<boolean> {
  try {
    const data = JSON.parse(await readFile(path.join(config.desktopDir, `${kind}_mcp.json`), "utf8")) as DiscoveryFile;
    return pidAlive(Number(data.pid));
  } catch {
    return false;
  }
}

/** Live desktop MCP endpoints, GUI first. */
export async function discoverDesktop(config: ZenviConfig, options: DiscoverOptions = {}): Promise<DesktopEndpoint[]> {
  const found: DesktopEndpoint[] = [];
  for (const [name, kind] of [
    ["gui_mcp.json", "gui"],
    ["headless_mcp.json", "headless"],
  ] as const) {
    const endpoint = await fromFile(config, name, kind, options);
    if (endpoint) found.push(endpoint);
  }
  if (found.length === 0 && options.legacy) {
    const tokenFile = path.join(config.desktopDir, "mcp_token");
    const token = await readToken(tokenFile);
    if (token && (await probeLegacy(token, options))) {
      found.push({ kind: "legacy", url: LEGACY_URL, token, source: tokenFile });
    }
  }
  return found;
}

async function canonical(file: string): Promise<string> {
  const abs = path.resolve(file);
  try {
    return await realpath(abs);
  } catch {
    return abs;
  }
}

/** True when `endpoint` has `projectFile` open (compared by real path). */
export async function hasProjectOpen(endpoint: DesktopEndpoint, projectFile: string): Promise<boolean> {
  if (!endpoint.project) return false;
  const [a, b] = await Promise.all([canonical(endpoint.project), canonical(projectFile)]);
  return process.platform === "win32" || process.platform === "darwin" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
