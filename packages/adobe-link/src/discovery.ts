/**
 * Finding running Zenvi Link servers (SPEC §3.1) for the `zenvi` CLI and
 * other clients: `<desktopDir>/link/{aftereffects,premiere}.json`, where
 * desktopDir is `~/.openshot_qt` (Windows `%USERPROFILE%\.openshot_qt`).
 *
 * A file is trusted only when its `pid` is alive, its URL is loopback HTTP
 * (127.0.0.1 or localhost) and one `initialize` with the token answers
 * within 1.5 s as `zenvi-link-<app>`. Only the exact URL a file names is
 * ever contacted: no port scans. Files are never deleted unless their pid
 * is dead and the caller asks (`removeStale`).
 */

import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { HOST_IDS, type HostId } from "./catalog/types.js";
import { LINK_PROTOCOL } from "./version.js";

export interface HostEndpoint {
  host: HostId;
  url: string;
  token: string;
  pid: number;
  /** Absolute path of the open project; null while untitled. */
  project: string | null;
  /** Zenvi Link version. */
  version: string;
  /** "Adobe After Effects 2026". */
  appName: string;
  appVersion: string;
  protocol: number;
  startedAt: string;
  lastActiveAt: string;
  /** The discovery file. */
  source: string;
}

/**
 * connected: trusted endpoint. absent: no discovery file. invalid: unreadable
 * or not a Zenvi Link file. dead: its process is gone. unreachable: the
 * process lives but the server did not answer (or refused the token).
 */
export type HostDiscoveryStatus = "connected" | "absent" | "invalid" | "dead" | "unreachable";

export interface HostDiscovery {
  host: HostId;
  status: HostDiscoveryStatus;
  /** Why it is not connected, for status output. */
  detail: string;
  file: string;
  endpoint?: HostEndpoint;
}

export interface DiscoverHostsOptions {
  /** Probe each endpoint with one initialize (default true). */
  verify?: boolean;
  /** Probe timeout (default 1500 ms, SPEC §3.1). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  clientVersion?: string;
  /** Delete discovery and token files whose pid is dead (default false). */
  removeStale?: boolean;
}

/** `<desktopDir>/link`. */
export function linkDirOf(desktopDir: string): string {
  return path.join(desktopDir, "link");
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** SPEC §3.1: plain HTTP to 127.0.0.1 or localhost only. */
export function isLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port !== "";
  } catch {
    return false;
  }
}

/** One initialize to the exact URL; true when it answers as zenvi-link-<host>. */
export async function probeHost(url: string, token: string, host: HostId, options: DiscoverHostsOptions = {}): Promise<boolean> {
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
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "zenvi-cli", version: options.clientVersion ?? "0" } },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    const message = (await response.json()) as { result?: { serverInfo?: { name?: string } } };
    return message.result?.serverInfo?.name === `zenvi-link-${host}`;
  } catch {
    return false;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function removeQuietly(file: string): Promise<void> {
  await unlink(file).catch(() => undefined);
}

/** One app's discovery file, checked. */
export async function inspectHost(desktopDir: string, host: HostId, options: DiscoverHostsOptions = {}): Promise<HostDiscovery> {
  const dir = linkDirOf(desktopDir);
  const file = path.join(dir, `${host}.json`);
  const result = (status: HostDiscoveryStatus, detail: string, endpoint?: HostEndpoint): HostDiscovery => ({ host, status, detail, file, ...(endpoint ? { endpoint } : {}) });
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return result("absent", "no discovery file (the app is not running, or Zenvi Link is not installed)");
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return result("invalid", "the discovery file is not JSON");
  }
  const url = text(data.url);
  const pid = Number(data.pid);
  if (data.app !== host || !url || !Number.isInteger(pid)) return result("invalid", "the discovery file is not a Zenvi Link file for this app");
  if (typeof data.protocol === "number" && data.protocol > LINK_PROTOCOL) {
    return result("invalid", `Zenvi Link speaks protocol ${data.protocol}; this client knows ${LINK_PROTOCOL} (update the zenvi CLI)`);
  }
  if (!isLinkUrl(url)) return result("invalid", `refusing a non-loopback URL (${url})`);
  const tokenFile = text(data.token_file);
  const tokenPath = tokenFile ? (path.isAbsolute(tokenFile) ? tokenFile : path.join(dir, tokenFile)) : path.join(dir, `${host}.token`);
  if (!pidAlive(pid)) {
    if (options.removeStale) {
      await removeQuietly(file);
      if (path.dirname(tokenPath) === dir && path.basename(tokenPath) === `${host}.token`) await removeQuietly(tokenPath);
    }
    return result("dead", `process ${pid} is gone (left over from a crash)`);
  }
  let token: string;
  try {
    token = (await readFile(tokenPath, "utf8")).trim();
  } catch {
    return result("invalid", `cannot read the token file ${tokenPath}`);
  }
  if (!token) return result("invalid", "the token file is empty");
  const endpoint: HostEndpoint = {
    host,
    url,
    token,
    pid,
    project: text(data.project) ?? null,
    version: text(data.version) ?? "",
    appName: text(data.app_name) ?? "",
    appVersion: text(data.app_version) ?? "",
    protocol: typeof data.protocol === "number" ? data.protocol : LINK_PROTOCOL,
    startedAt: text(data.started_at) ?? "",
    lastActiveAt: text(data.last_active_at) ?? "",
    source: file,
  };
  if (options.verify !== false && !(await probeHost(url, token, host, options))) {
    return result("unreachable", `the server at ${url} did not answer as Zenvi Link (process ${pid} is alive)`);
  }
  return result("connected", "connected", endpoint);
}

/** Both apps' discovery state (After Effects, then Premiere Pro). */
export function inspectHosts(desktopDir: string, options: DiscoverHostsOptions = {}): Promise<HostDiscovery[]> {
  return Promise.all(HOST_IDS.map((host) => inspectHost(desktopDir, host, options)));
}

/** Connected Zenvi Link servers, most recently active first. */
export async function discoverHosts(desktopDir: string, options: DiscoverHostsOptions = {}): Promise<HostEndpoint[]> {
  const found = (await inspectHosts(desktopDir, options)).flatMap((entry) => (entry.endpoint ? [entry.endpoint] : []));
  return found.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}
